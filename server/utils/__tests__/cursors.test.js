import { parseCompoundCursor, makeCompoundCursor } from '../../server/utils/cursors.js';

describe('compound cursor helpers', () => {
  test('parse and make roundtrip', () => {
    const obj = { createdAt: '2026-02-15T18:22:13.123Z', id: 12345 };
    const cur = makeCompoundCursor(obj);
    expect(typeof cur).toBe('string');
    const parsed = parseCompoundCursor(cur);
    expect(parsed.createdAt).toBe('2026-02-15T18:22:13.123Z');
    expect(parsed.id).toBe('12345');
  });

  test('parse invalid returns nulls', () => {
    expect(parseCompoundCursor(null)).toEqual({ createdAt: null, id: null });
    expect(parseCompoundCursor('not_a_cursor')).toEqual({ createdAt: null, id: null });
  });
});