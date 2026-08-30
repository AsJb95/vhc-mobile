import { appendDedupById } from '../WarehouseContext';

describe('appendDedupById', () => {
  it('appends only rows whose id is not already present', () => {
    const prev = [{ id: 'a' }, { id: 'b' }];
    const next = [{ id: 'b' }, { id: 'c' }, { id: 'd' }];
    expect(appendDedupById(prev, next).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is a no-op when every incoming row is a duplicate', () => {
    const prev = [{ id: 'a' }, { id: 'b' }];
    expect(appendDedupById(prev, [{ id: 'a' }, { id: 'b' }])).toHaveLength(2);
  });

  it('keeps the existing row instance on a clash (never replaces)', () => {
    const a = { id: 'a', v: 1 };
    const merged = appendDedupById([a], [{ id: 'a', v: 2 }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(a);
  });

  it('handles empty inputs', () => {
    expect(appendDedupById([], [])).toEqual([]);
    expect(appendDedupById([], [{ id: 'x' }]).map((r) => r.id)).toEqual(['x']);
  });
});
