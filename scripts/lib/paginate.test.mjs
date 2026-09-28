import { describe, it, expect } from 'vitest';
import { paginateUntilShort } from './paginate.mjs';

describe('paginateUntilShort', () => {
  it('a throw on page 2 (soft block) yields truncated:true and keeps page-1 items', async () => {
    const r = await paginateUntilShort(async (n) => { if (n === 2) throw new Error('not a listings page'); return ['a', 'b']; }, { key: (x) => x });
    expect(r.items).toEqual(['a', 'b']);
    expect(r).toMatchObject({ pages: 2, truncated: true, error: 'not a listings page' });
  });
  it('a genuinely short page 2 ends cleanly (not truncated)', async () => {
    const r = await paginateUntilShort(async (n) => (n === 1 ? ['a', 'b'] : ['c']), { key: (x) => x });
    expect(r).toMatchObject({ items: ['a', 'b', 'c'], pages: 2, truncated: false });
  });
});
