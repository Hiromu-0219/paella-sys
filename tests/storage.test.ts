import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import {
  operate,
  readState,
  resetEvent,
  startEvent,
  archiveEvent,
  listSavedEvents,
  openSavedEvent,
} from '../src/storage';
beforeEach(async () => {
  const current = await readState();
  if (current) await resetEvent(current.event.id, current.revision);
});
it('archives full event and swaps back without losing either event', async () => {
  const a = (await startEvent('イベントA', 3))!;
  const issued = (await operate(a.event.id, 1, 'issue'))!;
  await archiveEvent(a.event.id, issued.revision);
  expect(await readState()).toBeNull();
  expect((await listSavedEvents()).find((s) => s.event.id === a.event.id)).toEqual(issued);
  const b = (await startEvent('イベントB', 2))!;
  const opened = await openSavedEvent(a.event.id, { id: b.event.id, revision: b.revision });
  expect(opened.tickets).toEqual(issued.tickets);
  expect(opened.logs).toEqual(issued.logs);
  expect((await listSavedEvents()).find((s) => s.event.id === b.event.id)).toEqual(b);
  const again = await openSavedEvent(b.event.id, {
    id: opened.event.id,
    revision: opened.revision,
  });
  expect(again.tickets).toEqual(b.tickets);
  await expect(
    openSavedEvent(a.event.id, { id: b.event.id, revision: b.revision }),
  ).rejects.toThrow();
  expect((await readState())!.event.id).toBe(b.event.id);
});
it('stale archive does not remove current data', async () => {
  const s = (await startEvent('保存テスト', 2))!;
  await operate(s.event.id, 1, 'issue');
  await expect(archiveEvent(s.event.id, s.revision)).rejects.toThrow();
  expect((await readState())!.tickets[0].status).toBe('ISSUED');
});
it('rejects confirmation after intervening operations even if status matches again', async () => {
  const s = (await startEvent('祭り', 2))!;
  await operate(s.event.id, 1, 'issue');
  await operate(s.event.id, 1, 'undoIssue');
  await expect(operate(s.event.id, 1, 'invalidate', 'UNISSUED', s.revision)).rejects.toThrow();
  expect((await readState())!.tickets[0].status).toBe('UNISSUED');
});
it('persists event, tickets and logs between independent reads', async () => {
  const s = (await startEvent('祭り', 150))!;
  await operate(s.event.id, 43, 'issue');
  const loaded = (await readState())!;
  expect(loaded.tickets[42].status).toBe('ISSUED');
  expect(loaded.logs).toHaveLength(1);
});
it('serializes duplicate concurrent distribution atomically', async () => {
  const s = (await startEvent('祭り', 2))!;
  const results = await Promise.allSettled([
    operate(s.event.id, 1, 'issue'),
    operate(s.event.id, 1, 'issue'),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const loaded = (await readState())!;
  expect(loaded.logs).toHaveLength(1);
  expect(loaded.tickets[0].status).toBe('ISSUED');
});
it('rejected operations change neither ticket nor history', async () => {
  const s = (await startEvent('祭り', 2))!;
  await expect(operate(s.event.id, 1, 'serve')).rejects.toThrow();
  expect(await readState()).toEqual(s);
});
it('stale reset cannot erase newer activity', async () => {
  const s = (await startEvent('祭り', 2))!;
  await operate(s.event.id, 1, 'issue');
  await expect(resetEvent(s.event.id, s.revision)).rejects.toThrow();
  expect((await readState())!.logs).toHaveLength(1);
});
it('old event commands cannot modify a replacement event', async () => {
  const s = (await startEvent('祭り', 2))!;
  await resetEvent(s.event.id, s.revision);
  await startEvent('翌日', 2);
  await expect(operate(s.event.id, 1, 'issue')).rejects.toThrow();
});
