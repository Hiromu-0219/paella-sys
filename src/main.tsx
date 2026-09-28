import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  actionLabels,
  counts,
  labels,
  MAX_TICKETS,
  parseNumber,
  type Action,
  type State,
  type Status,
} from './domain';
import {
  operate,
  readState,
  archiveEvent,
  startEvent,
  listSavedEvents,
  openSavedEvent,
} from './storage';
import './style.css';

type Notice = { text: string; error: boolean } | null;
type Confirm = { eventId: string; revision: number } & (
  { number: number; action: Action; status: Status } | { action: 'reset' }
);
const formatNumber = (n: number) => String(n).padStart(3, '0');
const time = (s: string | null) =>
  s
    ? new Date(s).toLocaleString('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—';
function Badge({ status }: { status: Status }) {
  return <span className={`badge ${status}`}>{labels[status]}</span>;
}
function Modal({
  title,
  close,
  children,
  notice,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  notice?: Notice;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button aria-label="閉じる" className="icon-button" onClick={close}>
          ×
        </button>
      </div>
      {notice && (
        <p
          className={notice.error ? 'dialog-notice error' : 'dialog-notice'}
          role={notice.error ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}
      {children}
    </dialog>
  );
}
function App() {
  const [state, setState] = useState<State | null>(null),
    [loaded, setLoaded] = useState(false),
    [fatal, setFatal] = useState('');
  const [showEvents, setShowEvents] = useState(false);
  const [page, setPage] = useState<'main' | 'serve' | 'tickets' | 'history'>('main');
  const [notice, setNotice] = useState<Notice>(null),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null),
    [confirm, setConfirm] = useState<Confirm | null>(null),
    [resetName, setResetName] = useState('');
  const [filter, setFilter] = useState<Status | 'ALL'>('ALL'),
    [search, setSearch] = useState(''),
    [ticketPage, setTicketPage] = useState(0),
    [logPage, setLogPage] = useState(0);
  const [persistence, setPersistence] = useState(false);
  const locked = useRef(false),
    channel = useRef<BroadcastChannel | null>(null);
  const refresh = async () => {
    try {
      setState(await readState());
      setFatal('');
    } catch (e) {
      setFatal(e instanceof Error ? e.message : '保存データにアクセスできません。');
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    void refresh();
    navigator.storage
      ?.persisted?.()
      .then(setPersistence)
      .catch(() => {});
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('paella-changes');
      channel.current.onmessage = () => {
        void refresh();
      };
    }
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      channel.current?.close();
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  async function commit(work: () => Promise<State | null>, message: string) {
    if (locked.current) return false;
    locked.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const next = await work();
      setState(next);
      channel.current?.postMessage('changed');
      setNotice({ text: message, error: false });
      return true;
    } catch (e) {
      setNotice({
        text:
          e instanceof Error
            ? e.message
            : '保存できませんでした。空き容量・ブラウザの保存設定を確認してください。',
        error: true,
      });
      void refresh();
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function act(
    number: number,
    action: Action,
    expected?: Status,
    eventId?: string,
    revision?: number,
  ) {
    if (!state) return false;
    return commit(
      () => operate(eventId ?? state.event.id, number, action, expected, revision),
      `整理券 No.${number} ${action === 'issue' ? 'を配布済みにしました' : action === 'serve' ? 'を提供済みにしました' : `：${actionLabels[action]}を行いました`}。`,
    );
  }
  async function submitNumber(value: string, action: 'issue' | 'serve') {
    try {
      return await act(parseNumber(value, state!.event.ticketCount), action);
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true });
      return false;
    }
  }
  async function backup() {
    try {
      const latest = await readState();
      if (!latest) throw new Error('保存されたイベントがありません。');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(latest, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `paella-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({ text: 'イベントと操作履歴のバックアップを保存しました。', error: false });
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true });
    }
  }
  if (!loaded) return <main className="loading">保存データを読み込んでいます…</main>;
  if (fatal)
    return (
      <main className="setup">
        <h1>データを読み込めません</h1>
        <p role="alert">{fatal}</p>
        <p>保存データは削除していません。ブラウザの保存設定と空き容量を確認してください。</p>
        <button onClick={() => void refresh()}>再読み込み</button>
      </main>
    );
  const summary = state ? counts(state) : null;
  const ticket = state?.tickets.find((t) => t.number === selected);
  const shown =
    state?.tickets.filter(
      (t) => (filter === 'ALL' || t.status === filter) && (!search || t.number === Number(search)),
    ) ?? [];
  const confirmationTitle = confirm
    ? confirm.action === 'reset'
      ? '新しいイベントを開始しますか？'
      : `整理券 No.${confirm.number} を${confirm.action === 'undoIssue' ? '未配布に戻しますか？' : confirm.action === 'undoServe' ? '配布済みに戻しますか？' : confirm.action === 'invalidate' ? '無効にしますか？' : '無効化前の状態に戻しますか？'}`
    : '';
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            ▤
          </span>
          <span>
            PAELLA <small>紙整理券の管理</small>
          </span>
        </div>
        <span className="local-label">1台の端末で管理</span>
      </header>
      {notice && !ticket && !confirm && !showEvents && (
        <div
          className={`notice ${notice.error ? 'error' : 'success'}`}
          role={notice.error ? 'alert' : 'status'}
        >
          <span>
            {notice.error ? '！ ' : '✓ '}
            {notice.text}
          </span>
          <button aria-label="通知を閉じる" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
      {!state ? (
        <main className="setup">
          <div className="eyebrow">EVENT SETUP</div>
          <h1>
            今日の整理券を
            <br />
            準備しましょう。
          </h1>
          <p className="muted">
            配布はボタンひとつ。配布から提供まで、
            <br className="desktop-only" />
            この端末で管理できます。
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const raw = String(form.get('count'));
              if (!/^\d+$/.test(raw)) {
                setNotice({ text: '発行枚数は整数で入力してください。', error: true });
                return;
              }
              const ok = await commit(
                () => startEvent(String(form.get('name')), Number(raw)),
                '整理券を準備しました。管理を開始できます。',
              );
              if (ok)
                navigator.storage
                  ?.persist?.()
                  .then(setPersistence)
                  .catch(() => {});
            }}
          >
            <label htmlFor="event-name">イベント名</label>
            <input
              id="event-name"
              name="name"
              placeholder="秋祭り パエリア出店"
              required
              maxLength={100}
            />
            <label htmlFor="count">整理券発行枚数</label>
            <div className="suffix-input">
              <input id="count" name="count" inputMode="numeric" defaultValue="30" required />
              <span>枚</span>
            </div>
            <p className="field-help">
              1番から連番で作成します（最大{MAX_TICKETS.toLocaleString()}枚）。
            </p>
            <button className="primary wide" disabled={busy}>
              管理を開始する <span aria-hidden="true">→</span>
            </button>
          </form>
          <button className="subtle wide" onClick={() => setShowEvents(true)}>
            保存したイベント
          </button>
          <div className="storage-note">
            データはこのブラウザに保存されます。
            <br />
            当日は同じ端末・同じブラウザ・同じURLを使用してください。
          </div>
        </main>
      ) : (
        <main className="workspace">
          <div className="event-heading">
            <div>
              <div className="eyebrow">EVENT WORKSPACE</div>
              <h1>{state.event.name}</h1>
              <p className="muted">
                パエリア整理券管理 <span className="separator">/</span> No.001 —{' '}
                {formatNumber(state.event.ticketCount)}
              </p>
            </div>
            <div className="saved">
              <span aria-hidden="true">✓</span> {busy ? '保存中…' : '端末に保存済み'}
              <small>{persistence ? '永続ストレージ保護あり' : 'ブラウザ内に保存'}</small>
            </div>
          </div>
          <nav className="tabs" aria-label="画面切り替え">
            {(
              [
                ['main', '配布'],
                ['serve', '提供'],
                ['tickets', '整理券一覧'],
                ['history', '操作履歴'],
              ] as const
            ).map(([id, text]) => (
              <button
                key={id}
                className={page === id ? 'active' : ''}
                aria-current={page === id ? 'page' : undefined}
                onClick={() => setPage(id)}
              >
                {text}
              </button>
            ))}
          </nav>
          <section className="stats" aria-label="整理券の集計">
            {[
              ['発行総数', state.event.ticketCount, 'total'],
              ['配布済み数', summary!.ISSUED + summary!.SERVED, 'distributed'],
              ['提供済み', summary!.SERVED, 'served'],
              ['待機中', summary!.ISSUED, 'waiting'],
              ['未配布', summary!.UNISSUED, 'unissued'],
              ['無効', summary!.INVALID, 'invalid'],
            ].map(([label, n, cls]) => (
              <div className={`stat ${cls}`} key={label}>
                <span>{label}</span>
                <strong>
                  {n}
                  <small>枚</small>
                </strong>
              </div>
            ))}
          </section>
          <p className="counts-help">配布済み数＝待機中＋提供済み（無効を除く）</p>
          {(page === 'main' || page === 'serve') && (
            <>
              {page === 'main' && (
                <section className="next-ticket">
                  <div>
                    <span className="eyebrow">NEXT TICKET</span>
                    <h2>次に配布可能な整理券</h2>
                    <p>紙の番号を確認して、配布ボタンを押してください。</p>
                  </div>
                  <div className="next-number">
                    {state.tickets.find((t) => t.status === 'UNISSUED') ? (
                      <>
                        <strong>
                          {formatNumber(state.tickets.find((t) => t.status === 'UNISSUED')!.number)}
                        </strong>
                        <span>番</span>
                      </>
                    ) : (
                      <strong className="finished">未配布なし</strong>
                    )}
                  </div>
                </section>
              )}
              <div className="single-operation">
                {page === 'main' ? (
                  <IssueForm
                    next={state.tickets.find((t) => t.status === 'UNISSUED')?.number}
                    busy={busy}
                    submit={submitNumber}
                  />
                ) : (
                  <NumberForm kind="serve" busy={busy} submit={submitNumber} />
                )}
              </div>
              <section className="recent">
                <div className="section-heading">
                  <h2>直近の操作</h2>
                  <button className="text-button" onClick={() => setPage('history')}>
                    すべての履歴を見る →
                  </button>
                </div>
                <LogRows logs={state.logs.slice(-4).reverse()} select={setSelected} />
              </section>
            </>
          )}
          {page === 'tickets' && (
            <section className="panel">
              <div className="section-heading">
                <h2>整理券一覧</h2>
                <span className="muted">{shown.length}枚</span>
              </div>
              <div className="list-tools">
                <div className="filters" aria-label="状態で絞り込み">
                  {(['ALL', 'UNISSUED', 'ISSUED', 'SERVED', 'INVALID'] as const).map((s) => (
                    <button
                      key={s}
                      aria-pressed={filter === s}
                      onClick={() => {
                        setFilter(s);
                        setTicketPage(0);
                      }}
                    >
                      {s === 'ALL' ? '全て' : labels[s]}
                    </button>
                  ))}
                </div>
                <label className="search">
                  番号で検索
                  <input
                    aria-label="整理券番号で検索"
                    inputMode="numeric"
                    placeholder="例：42"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setTicketPage(0);
                    }}
                  />
                </label>
              </div>
              <div className="ticket-grid">
                {shown.slice(ticketPage * 100, (ticketPage + 1) * 100).map((t) => (
                  <button
                    className={`ticket ${t.status}`}
                    key={t.number}
                    onClick={() => setSelected(t.number)}
                    aria-label={`整理券 No.${t.number} ${labels[t.status]}`}
                  >
                    <strong>{formatNumber(t.number)}</strong>
                    <Badge status={t.status} />
                  </button>
                ))}
              </div>
              {!shown.length && <p className="empty">該当する整理券はありません。</p>}
              <Pagination
                page={ticketPage}
                count={shown.length}
                size={100}
                change={setTicketPage}
              />
            </section>
          )}
          {page === 'history' && (
            <section className="panel">
              <div className="section-heading">
                <h2>操作履歴</h2>
                <span className="muted">全{state.logs.length}件・新しい順</span>
              </div>
              <LogRows
                logs={state.logs
                  .slice()
                  .reverse()
                  .slice(logPage * 50, (logPage + 1) * 50)}
                select={setSelected}
              />
              <Pagination page={logPage} count={state.logs.length} size={50} change={setLogPage} />
            </section>
          )}
          <button className="subtle wide" onClick={() => setShowEvents(true)}>
            保存したイベント
          </button>
          <footer>
            <p>
              この端末・ブラウザに保存しています。
              <br />
              <span>ブラウザのデータ削除やプライベートモードにご注意ください。</span>
            </p>
            <div>
              <button className="subtle" onClick={() => void backup()}>
                バックアップ保存
              </button>
              <button
                className="text-button danger-text"
                onClick={() => {
                  setResetName('');
                  setConfirm({
                    action: 'reset',
                    eventId: state.event.id,
                    revision: state.revision,
                  });
                }}
              >
                新しいイベントを開始
              </button>
            </div>
          </footer>
        </main>
      )}
      {showEvents && (
        <SavedEvents
          current={state}
          busy={busy}
          notice={notice}
          close={() => {
            if (!busy) setShowEvents(false);
          }}
          open={async (id) => {
            const ok = await commit(
              () =>
                openSavedEvent(id, state ? { id: state.event.id, revision: state.revision } : null),
              'イベントを開きました。',
            );
            if (ok) {
              setShowEvents(false);
              setPage('main');
              setSelected(null);
              setConfirm(null);
              setSearch('');
              setFilter('ALL');
              setTicketPage(0);
              setLogPage(0);
            }
          }}
        />
      )}
      {ticket && !confirm && (
        <Modal
          notice={notice}
          title={`整理券 No.${formatNumber(ticket.number)}`}
          close={() => setSelected(null)}
        >
          <div className="detail-status">
            <span>現在の状態</span>
            <Badge status={ticket.status} />
          </div>
          <dl>
            <div>
              <dt>配布日時</dt>
              <dd>{ticket.issuedAt ? time(ticket.issuedAt) : '未配布'}</dd>
            </div>
            <div>
              <dt>提供日時</dt>
              <dd>{ticket.servedAt ? time(ticket.servedAt) : '未提供'}</dd>
            </div>
            {ticket.status === 'INVALID' && (
              <>
                <div>
                  <dt>無効化日時</dt>
                  <dd>{time(ticket.invalidatedAt)}</dd>
                </div>
                <div>
                  <dt>無効化前の状態</dt>
                  <dd>{labels[ticket.previousStatus ?? 'UNISSUED']}</dd>
                </div>
              </>
            )}
          </dl>
          <div className="detail-actions">
            {ticket.status === 'UNISSUED' && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void act(ticket.number, 'issue', ticket.status)}
              >
                配布する
              </button>
            )}
            {ticket.status === 'ISSUED' && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void act(ticket.number, 'serve', ticket.status)}
              >
                提供済みにする
              </button>
            )}
            {(['undoIssue', 'undoServe', 'invalidate', 'restore'] as Action[])
              .filter((a) =>
                a === 'undoIssue'
                  ? ticket.status === 'ISSUED'
                  : a === 'undoServe'
                    ? ticket.status === 'SERVED'
                    : a === 'invalidate'
                      ? ticket.status !== 'INVALID'
                      : ticket.status === 'INVALID',
              )
              .map((a) => (
                <button
                  key={a}
                  className={a === 'invalidate' ? 'danger-text' : ''}
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      number: ticket.number,
                      action: a,
                      status: ticket.status,
                      eventId: state!.event.id,
                      revision: state!.revision,
                    })
                  }
                >
                  {a === 'restore' ? '無効化前の状態に戻す' : actionLabels[a]}
                </button>
              ))}
          </div>
        </Modal>
      )}
      {confirm && state && (
        <Modal
          notice={notice}
          title={confirmationTitle}
          close={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <p>
            {confirm.action === 'reset'
              ? '現在の整理券と操作履歴を保存して、新しいイベントの設定へ進みます。'
              : 'この操作により現在の整理券状態が変更されます。'}
          </p>
          {confirm.action === 'restore' && (
            <p>復元先：{labels[state.tickets[confirm.number - 1]?.previousStatus ?? 'UNISSUED']}</p>
          )}
          {confirm.action === 'reset' && (
            <>
              <p>保存したイベントは「保存したイベント」からいつでも開き直せます。</p>
              <label htmlFor="reset-name">確認のため「{state.event.name}」を入力</label>
              <input
                id="reset-name"
                value={resetName}
                onChange={(e) => setResetName(e.target.value)}
                autoComplete="off"
              />
            </>
          )}
          <div className="confirm-actions">
            <button autoFocus disabled={busy} onClick={() => setConfirm(null)}>
              キャンセル
            </button>
            <button
              className="danger"
              disabled={busy || (confirm.action === 'reset' && resetName !== state.event.name)}
              onClick={async () => {
                const ok =
                  confirm.action === 'reset'
                    ? await commit(
                        () => archiveEvent(confirm.eventId, confirm.revision),
                        'イベントを保存しました。次のイベントを設定してください。',
                      )
                    : await act(
                        confirm.number,
                        confirm.action,
                        confirm.status,
                        confirm.eventId,
                        confirm.revision,
                      );
                if (ok) {
                  setConfirm(null);
                  if (confirm.action === 'reset') {
                    setSelected(null);
                    setPage('main');
                    setSearch('');
                    setFilter('ALL');
                    setLogPage(0);
                    setTicketPage(0);
                  }
                }
              }}
            >
              {confirm.action === 'reset'
                ? '保存して新しく開始'
                : confirm.action === 'invalidate'
                  ? '無効にする'
                  : '戻す'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function SavedEvents({
  current,
  busy,
  notice,
  close,
  open,
}: {
  current: State | null;
  busy: boolean;
  notice: Notice;
  close: () => void;
  open: (id: string) => Promise<void>;
}) {
  const [events, setEvents] = useState<State[] | null>(null),
    [error, setError] = useState(''),
    [chosen, setChosen] = useState<State | null>(null);
  useEffect(() => {
    listSavedEvents()
      .then(setEvents)
      .catch((e) => setError(e instanceof Error ? e.message : '一覧を読み込めませんでした。'));
  }, []);
  return (
    <Modal title="保存したイベント" close={close} notice={notice}>
      {error && <p role="alert">{error}</p>}
      {chosen ? (
        <>
          <h3>「{chosen.event.name}」を開きますか？</h3>
          <p>
            {current
              ? `現在の「${current.event.name}」も整理券・履歴ごと保存して切り替えます。`
              : '保存時の整理券・履歴を復元し、続きから操作できます。'}
          </p>
          <div className="confirm-actions">
            <button disabled={busy} onClick={() => setChosen(null)}>
              キャンセル
            </button>
            <button className="primary" disabled={busy} onClick={() => void open(chosen.event.id)}>
              このイベントを開く
            </button>
          </div>
        </>
      ) : (
        <>
          {current && <p>現在：{current.event.name}</p>}
          {!events && !error && <p>読み込み中…</p>}
          {events?.length === 0 && (
            <p>
              保存したイベントはまだありません。「新しいイベントを開始」で現在のイベントを保存できます。
            </p>
          )}
          {events?.map((event) => {
            const c = counts(event);
            return (
              <section className="saved-event" key={event.event.id}>
                <h3>{event.event.name}</h3>
                <p>
                  {time(event.event.createdAt)} 作成 · {event.event.ticketCount}枚
                </p>
                <p>
                  提供済み {c.SERVED} · 待機中 {c.ISSUED} · 未配布 {c.UNISSUED} · 無効 {c.INVALID}
                </p>
                <button disabled={busy} onClick={() => setChosen(event)}>
                  開く
                </button>
              </section>
            );
          })}
        </>
      )}
    </Modal>
  );
}
function IssueForm({
  next,
  busy,
  submit,
}: {
  next?: number;
  busy: boolean;
  submit: (value: string, action: 'issue' | 'serve') => Promise<boolean>;
}) {
  const [manual, setManual] = useState(false);
  return (
    <div className="issue-container">
      {manual ? (
        <NumberForm kind="issue" busy={busy} submit={submit} />
      ) : (
        <section className="operation issue">
          <div className="operation-title">
            <span className="step" aria-hidden="true">
              01
            </span>
            <div>
              <h2>新しく整理券を配布する</h2>
              <p>紙の番号を確認して、ボタンひとつで配布</p>
            </div>
          </div>
          <div className="sequential-number">
            <span>今回配布する番号</span>
            <strong>
              {next === undefined ? '配布できる整理券はありません' : `No.${formatNumber(next)}`}
            </strong>
          </div>
          <button
            className="primary sequential-button"
            disabled={busy || next === undefined}
            onKeyDown={(e) => {
              if (e.repeat) e.preventDefault();
            }}
            onClick={(e) => {
              if (next !== undefined && e.detail < 2) void submit(String(next), 'issue');
            }}
          >
            {next === undefined ? '配布完了' : `No.${formatNumber(next)} を配布する`}
            <span aria-hidden="true">→</span>
          </button>
          <p className="enter-help">配布後は次の未配布番号に自動で進みます</p>
        </section>
      )}
      <button className="text-button issue-mode" disabled={busy} onClick={() => setManual(!manual)}>
        {manual ? '連番で配布に戻る' : '番号を指定して配布'}
      </button>
    </div>
  );
}
function NumberForm({
  kind,
  busy,
  submit,
}: {
  kind: 'issue' | 'serve';
  busy: boolean;
  submit: (value: string, action: 'issue' | 'serve') => Promise<boolean>;
}) {
  const [value, setValue] = useState(''),
    ref = useRef<HTMLInputElement>(null);
  const issue = kind === 'issue';
  return (
    <section className={`operation ${kind}`}>
      <div className="operation-title">
        <span className="step" aria-hidden="true">
          {issue ? '01' : '02'}
        </span>
        <div>
          <h2>{issue ? '新しく整理券を配布する' : '提供済みにする'}</h2>
          <p>{issue ? '紙の整理券をお渡しするとき' : 'パエリアをお渡ししたとき'}</p>
        </div>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await submit(value, kind)) setValue('');
          requestAnimationFrame(() => {
            ref.current?.focus();
            ref.current?.select();
          });
        }}
      >
        <label htmlFor={kind}>整理券番号</label>
        <div className="operation-input">
          <span aria-hidden="true">No.</span>
          <input
            id={kind}
            ref={ref}
            inputMode="numeric"
            autoComplete="off"
            placeholder="番号を入力"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={busy}
          />
        </div>
        <button disabled={busy} className={issue ? 'primary' : 'serve-button'}>
          {issue ? '配布する' : '提供完了'}
          <span aria-hidden="true">{issue ? '→' : '✓'}</span>
        </button>
        <p className="enter-help">番号を入力して Enter キーでも確定</p>
      </form>
    </section>
  );
}
function LogRows({ logs, select }: { logs: State['logs']; select: (n: number) => void }) {
  return logs.length ? (
    <div className="logs">
      {logs.map((log) => (
        <div className="log" key={log.id}>
          <time dateTime={log.createdAt}>{time(log.createdAt)}</time>
          <button className="log-number" onClick={() => select(log.ticketNumber)}>
            No.{formatNumber(log.ticketNumber)}
          </button>
          <span>{actionLabels[log.action]}</span>
          <div className="log-transition">
            <Badge status={log.previousStatus} />
            <span aria-hidden="true">→</span>
            <Badge status={log.newStatus} />
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="empty">
      まだ操作履歴はありません。
      <br />
      <span>整理券を配布すると、ここに記録されます。</span>
    </div>
  );
}
function Pagination({
  page,
  count,
  size,
  change,
}: {
  page: number;
  count: number;
  size: number;
  change: (p: number) => void;
}) {
  return count > size ? (
    <div className="pagination">
      <button disabled={page === 0} onClick={() => change(page - 1)}>
        前へ
      </button>
      <span>
        {page + 1} / {Math.ceil(count / size)}
      </span>
      <button disabled={(page + 1) * size >= count} onClick={() => change(page + 1)}>
        次へ
      </button>
    </div>
  ) : null;
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
