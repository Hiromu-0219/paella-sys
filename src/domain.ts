export const labels = {
  UNISSUED: '未配布',
  ISSUED: '配布済み',
  SERVED: '提供済み',
  INVALID: '無効',
} as const;
export type Status = keyof typeof labels;
export type Action = 'issue' | 'serve' | 'undoIssue' | 'undoServe' | 'invalidate' | 'restore';
export const actionLabels: Record<Action, string> = {
  issue: '配布',
  serve: '提供完了',
  undoIssue: '未配布へ戻す',
  undoServe: '配布済みへ戻す',
  invalidate: '無効化',
  restore: '無効解除',
};
export interface Ticket {
  number: number;
  status: Status;
  issuedAt: string | null;
  servedAt: string | null;
  invalidatedAt: string | null;
  previousStatus: Exclude<Status, 'INVALID'> | null;
}
export interface EventData {
  id: string;
  name: string;
  ticketCount: number;
  createdAt: string;
}
export interface OperationLog {
  id: string;
  ticketNumber: number;
  action: Action;
  previousStatus: Status;
  newStatus: Status;
  createdAt: string;
}
export interface State {
  schemaVersion: 1;
  event: EventData;
  tickets: Ticket[];
  logs: OperationLog[];
  revision: number;
}
export const MAX_TICKETS = 10000;
export function parseNumber(value: string, max: number): number {
  if (!/^\d+$/.test(value.trim()) || Number(value) < 1 || !Number.isSafeInteger(Number(value)))
    throw new Error('整理券番号は1以上の整数で入力してください。');
  const number = Number(value);
  if (number > max) throw new Error(`整理券 No.${number} は存在しません（1〜${max}番）。`);
  return number;
}
export function createState(name: string, count: number): State {
  if (!name.trim() || name.trim().length > 100)
    throw new Error('イベント名は1〜100文字で入力してください。');
  if (!Number.isInteger(count) || count < 1 || count > MAX_TICKETS)
    throw new Error(`発行枚数は1〜${MAX_TICKETS.toLocaleString()}の整数で入力してください。`);
  return {
    schemaVersion: 1,
    event: {
      id: crypto.randomUUID(),
      name: name.trim(),
      ticketCount: count,
      createdAt: new Date().toISOString(),
    },
    tickets: Array.from({ length: count }, (_, i) => ({
      number: i + 1,
      status: 'UNISSUED',
      issuedAt: null,
      servedAt: null,
      invalidatedAt: null,
      previousStatus: null,
    })),
    logs: [],
    revision: 0,
  };
}
export function transition(ticket: Ticket, action: Action, at: string): Ticket {
  const t = { ...ticket };
  const reject = (message: string): never => {
    throw new Error(`整理券 No.${t.number} ${message}（現在：${labels[t.status]}）。`);
  };
  switch (action) {
    case 'issue':
      if (t.status !== 'UNISSUED')
        reject(t.status === 'ISSUED' ? 'はすでに配布済みです' : 'は配布できません');
      t.status = 'ISSUED';
      t.issuedAt = at;
      break;
    case 'serve':
      if (t.status !== 'ISSUED')
        reject(
          t.status === 'UNISSUED'
            ? 'はまだ配布されていません'
            : t.status === 'SERVED'
              ? 'はすでに提供済みです'
              : 'は提供できません',
        );
      t.status = 'SERVED';
      t.servedAt = at;
      break;
    case 'undoIssue':
      if (t.status !== 'ISSUED') reject('は未配布に戻せません');
      t.status = 'UNISSUED';
      t.issuedAt = null;
      t.servedAt = null;
      break;
    case 'undoServe':
      if (t.status !== 'SERVED') reject('は配布済みに戻せません');
      t.status = 'ISSUED';
      t.servedAt = null;
      break;
    case 'invalidate':
      if (t.status === 'INVALID') reject('はすでに無効です');
      t.previousStatus = t.status as Exclude<Status, 'INVALID'>;
      t.status = 'INVALID';
      t.invalidatedAt = at;
      break;
    case 'restore':
      if (t.status !== 'INVALID') reject('は無効ではありません');
      t.status = t.previousStatus ?? 'UNISSUED';
      t.previousStatus = null;
      t.invalidatedAt = null;
      break;
    default:
      throw new Error('不正な操作です。');
  }
  return t;
}
export function applyAction(
  state: State,
  number: number,
  action: Action,
  expected?: Status,
): State {
  const index = number - 1,
    ticket = state.tickets[index];
  if (!Number.isInteger(number) || !ticket) throw new Error(`整理券 No.${number} は存在しません。`);
  if (expected && ticket.status !== expected)
    throw new Error('別の画面で状態が変更されました。最新の状態を確認してください。');
  const at = new Date().toISOString(),
    changed = transition(ticket, action, at);
  const tickets = state.tickets.slice();
  tickets[index] = changed;
  return {
    ...state,
    tickets,
    revision: state.revision + 1,
    logs: [
      ...state.logs,
      {
        id: crypto.randomUUID(),
        ticketNumber: number,
        action,
        previousStatus: ticket.status,
        newStatus: changed.status,
        createdAt: at,
      },
    ],
  };
}
export function counts(state: State) {
  const result = { UNISSUED: 0, ISSUED: 0, SERVED: 0, INVALID: 0 };
  state.tickets.forEach((t) => result[t.status]++);
  return result;
}
