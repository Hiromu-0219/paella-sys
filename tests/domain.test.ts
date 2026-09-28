import { describe, expect, it } from 'vitest';
import {
  applyAction,
  counts,
  createState,
  parseNumber,
  transition,
  type Action,
  type Status,
} from '../src/domain';
describe('ticket rules', () => {
  it('generates exactly 150 sequential unissued tickets', () => {
    const s = createState('秋祭り', 150);
    expect(s.tickets).toHaveLength(150);
    expect(s.tickets.map((t) => t.number)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
    expect(counts(s).UNISSUED).toBe(150);
  });
  it.each([0, -1, 1.5, NaN, 10001])('rejects invalid count %s', (n) =>
    expect(() => createState('祭り', n)).toThrow(),
  );
  it.each(['', ' ', '0', '-1', '1.2', 'abc', '1e2', '151', 'Infinity'])(
    'rejects invalid number %s',
    (value) => expect(() => parseNumber(value, 150)).toThrow(),
  );
  it('accepts padded numbers', () => expect(parseNumber(' 043 ', 150)).toBe(43));
  it('records issue and serve timestamps, counts and history', () => {
    let s = createState('祭り', 3);
    s = applyAction(s, 1, 'issue');
    s = applyAction(s, 2, 'issue');
    s = applyAction(s, 1, 'serve');
    expect(counts(s)).toEqual({ UNISSUED: 1, ISSUED: 1, SERVED: 1, INVALID: 0 });
    expect(s.tickets[0].issuedAt).toBeTruthy();
    expect(s.tickets[0].servedAt).toBeTruthy();
    expect(s.logs).toHaveLength(3);
    expect(s.logs[2]).toMatchObject({
      ticketNumber: 1,
      previousStatus: 'ISSUED',
      newStatus: 'SERVED',
      action: 'serve',
    });
  });
  const allowed: Record<Status, Action[]> = {
    UNISSUED: ['issue', 'invalidate'],
    ISSUED: ['serve', 'undoIssue', 'invalidate'],
    SERVED: ['undoServe', 'invalidate'],
    INVALID: ['restore'],
  };
  for (const status of Object.keys(allowed) as Status[])
    for (const action of [
      'issue',
      'serve',
      'undoIssue',
      'undoServe',
      'invalidate',
      'restore',
    ] as Action[]) {
      it(`${status} / ${action} follows transition rules`, () => {
        const t = { ...createState('祭り', 1).tickets[0], status };
        if (allowed[status].includes(action))
          expect(transition(t, action, new Date().toISOString()).status).not.toBe(status);
        else expect(() => transition(t, action, new Date().toISOString())).toThrow();
      });
    }
  it('undo clears applicable timestamps and preserves audit history', () => {
    let s = applyAction(createState('祭り', 1), 1, 'issue');
    s = applyAction(s, 1, 'serve');
    s = applyAction(s, 1, 'undoServe');
    expect(s.tickets[0].servedAt).toBeNull();
    expect(s.tickets[0].issuedAt).toBeTruthy();
    s = applyAction(s, 1, 'undoIssue');
    expect(s.tickets[0].issuedAt).toBeNull();
    expect(s.logs).toHaveLength(4);
  });
  it.each(['UNISSUED', 'ISSUED', 'SERVED'] as Status[])(
    'restores %s with original timestamps',
    (status) => {
      let s = createState('祭り', 1);
      if (status !== 'UNISSUED') s = applyAction(s, 1, 'issue');
      if (status === 'SERVED') s = applyAction(s, 1, 'serve');
      const before = s.tickets[0];
      s = applyAction(s, 1, 'invalidate');
      s = applyAction(s, 1, 'restore');
      expect(s.tickets[0]).toEqual(before);
    },
  );
  it('rejects stale expected status', () =>
    expect(() => applyAction(createState('祭り', 1), 1, 'invalidate', 'ISSUED')).toThrow());
});
