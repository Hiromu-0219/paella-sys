import { applyAction, createState, type Action, type State, type Status } from './domain';
const DB_NAME = 'paella-tickets-v1';
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('data');
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('他のタブを閉じてから再読み込みしてください。'));
  });
}
function checked(value: unknown): State | null {
  if (value == null) return null;
  const state = value as State;
  if (
    state.schemaVersion !== 1 ||
    !state.event?.id ||
    !Array.isArray(state.tickets) ||
    state.tickets.length !== state.event.ticketCount ||
    !Array.isArray(state.logs) ||
    state.tickets.some(
      (t, i) =>
        t.number !== i + 1 || !['UNISSUED', 'ISSUED', 'SERVED', 'INVALID'].includes(t.status),
    )
  )
    throw new Error(
      '保存データを読み取れません。データを消去せず、バックアップを確認してください。',
    );
  return state;
}
export async function readState(): Promise<State | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('data', 'readonly'),
      request = tx.objectStore('data').get('current');
    tx.oncomplete = () => {
      db.close();
      try {
        resolve(checked(request.result));
      } catch (e) {
        reject(e);
      }
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
// Read latest state and write both ticket and log within one serialized transaction.
async function mutate(update: (current: State | null) => State | null): Promise<State | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('data', 'readwrite', { durability: 'strict' });
    const store = tx.objectStore('data'),
      request = store.get('current');
    let next: State | null = null,
      failure: unknown;
    request.onsuccess = () => {
      try {
        next = update(checked(request.result));
        if (next) store.put(next, 'current');
        else store.delete('current');
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve(next);
    };
    tx.onabort = () => {
      db.close();
      reject(failure ?? tx.error ?? new Error('保存できませんでした。'));
    };
  });
}
export function startEvent(name: string, count: number) {
  return mutate((current) => {
    if (current) throw new Error('イベントがすでに存在します。再読み込みしてください。');
    return createState(name, count);
  });
}
export function operate(
  eventId: string,
  number: number,
  action: Action,
  expected?: Status,
  revision?: number,
) {
  return mutate((current) => {
    if (!current || current.event.id !== eventId)
      throw new Error('イベントが変更されました。再読み込みしてください。');
    if (revision !== undefined && current.revision !== revision)
      throw new Error(
        '確認中にデータが更新されました。キャンセルして最新の内容を確認してください。',
      );
    return applyAction(current, number, action, expected);
  });
}
export function resetEvent(eventId: string, revision: number) {
  return mutate((current) => {
    if (!current || current.event.id !== eventId || current.revision !== revision)
      throw new Error('イベントが更新されました。最新の内容を確認してやり直してください。');
    return null;
  });
}
