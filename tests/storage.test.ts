import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { operate, readState, resetEvent, startEvent } from '../src/storage';
beforeEach(async () => {
  const current = await readState();
  if (current) await resetEvent(current.event.id, current.revision);
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
