import { describe, expect, it } from 'vitest';
import {
  COLUMN_MISSING_CODES,
  broadcastLogRow,
  isColumnMissing,
  legacyBroadcastLogRow,
  logBroadcast,
  type NotificationLogInsert,
} from './broadcastLog';

const ADMIN = '0a000000-0000-0000-0000-0000000a0ad1';
const CONTENT = { titleEn: 'Offer', titleAr: 'عرض', bodyEn: 'Half price', bodyAr: 'نصف السعر' };
const COUNTS = { targeted: 3, sent: 2, failed: 1, deactivated: 0 };

/** An insert that answers from a script and remembers every row it was given. */
function scripted(...answers: Array<{ error: { code?: string; message?: string } | null } | Error>) {
  const rows: Record<string, unknown>[] = [];
  const insert: NotificationLogInsert = (row) => {
    rows.push(row);
    const next = answers.shift() ?? { error: null };
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  };
  return { insert, rows };
}

describe('broadcast log row', () => {
  it('carries the sender, the four strings and the counts', () => {
    expect(broadcastLogRow(ADMIN, CONTENT, COUNTS)).toEqual({
      kind: 'broadcast',
      targeted: 3,
      sent: 2,
      failed: 1,
      deactivated: 0,
      sent_by: ADMIN,
      content: CONTENT,
    });
  });

  it('copies exactly the four content fields, nothing else from the request', () => {
    const noisy = { ...CONTENT, password: 'x', audience: 'everyone' } as typeof CONTENT;
    expect(Object.keys(broadcastLogRow(ADMIN, noisy, COUNTS).content as object).sort()).toEqual([
      'bodyAr',
      'bodyEn',
      'titleAr',
      'titleEn',
    ]);
  });

  it('keeps the pre-20261007120000 shape as the fallback', () => {
    expect(legacyBroadcastLogRow(COUNTS)).toEqual({ kind: 'broadcast', ...COUNTS });
  });
});

describe('logBroadcast', () => {
  it('writes one full row when the columns exist', async () => {
    const s = scripted({ error: null });
    expect(await logBroadcast(s.insert, ADMIN, CONTENT, COUNTS)).toBe('logged');
    expect(s.rows).toEqual([broadcastLogRow(ADMIN, CONTENT, COUNTS)]);
  });

  it.each(['PGRST204', '42703'])(
    'falls back to the old row on %s (deployed before the apply)',
    async (code) => {
      const s = scripted({ error: { code, message: 'column missing' } }, { error: null });
      expect(await logBroadcast(s.insert, ADMIN, CONTENT, COUNTS)).toBe('logged_without_audit');
      expect(s.rows).toEqual([broadcastLogRow(ADMIN, CONTENT, COUNTS), legacyBroadcastLogRow(COUNTS)]);
    },
  );

  it('does not retry any other error, so a row cannot be written twice', async () => {
    for (const code of ['23505', '42501', 'PGRST301', undefined]) {
      const s = scripted({ error: { code, message: 'nope' } });
      expect(await logBroadcast(s.insert, ADMIN, CONTENT, COUNTS)).toBe('not_logged');
      expect(s.rows).toHaveLength(1);
    }
  });

  it('reports a failed fallback without throwing', async () => {
    const s = scripted({ error: { code: 'PGRST204' } }, { error: { code: '57014' } });
    expect(await logBroadcast(s.insert, ADMIN, CONTENT, COUNTS)).toBe('not_logged');
    expect(s.rows).toHaveLength(2);
  });

  it('never throws, whether the insert rejects or throws synchronously', async () => {
    const rejecting = scripted(new Error('network'));
    await expect(logBroadcast(rejecting.insert, ADMIN, CONTENT, COUNTS)).resolves.toBe('not_logged');
    const throwing: NotificationLogInsert = () => {
      throw new Error('boom');
    };
    await expect(logBroadcast(throwing, ADMIN, CONTENT, COUNTS)).resolves.toBe('not_logged');
  });

  it('treats only the two column-missing codes as column-missing', () => {
    expect([...COLUMN_MISSING_CODES]).toEqual(['PGRST204', '42703']);
    expect(isColumnMissing(null)).toBe(false);
    expect(isColumnMissing({ message: 'no code' })).toBe(false);
    expect(isColumnMissing({ code: 'PGRST202' })).toBe(false);
  });
});
