import {
  transferStatusColor,
  filterTransfersByStatus,
  planPharmacyTransferLines,
  planStockReturnLines,
  isStockReturn,
} from '../transfers';

const THEME = { success: '#0f0', danger: '#f00', warning: '#fa0', accent: '#00f' };

describe('transferStatusColor', () => {
  it('maps each known status', () => {
    expect(transferStatusColor('Completed', THEME)).toBe(THEME.success);
    expect(transferStatusColor('Cancelled', THEME)).toBe(THEME.danger);
    expect(transferStatusColor('Pending', THEME)).toBe(THEME.warning);
  });
  it('treats anything unexpected as pending-coloured', () => {
    expect(transferStatusColor(undefined, THEME)).toBe(THEME.warning);
    expect(transferStatusColor('weird', THEME)).toBe(THEME.warning);
  });
});

describe('filterTransfersByStatus', () => {
  const rows = [
    { id: 'a', status: 'Pending' },
    { id: 'b', status: 'Completed' },
    { id: 'c', status: 'Cancelled' },
    { id: 'd', status: 'Pending' },
  ];
  it('returns everything for All / falsy', () => {
    expect(filterTransfersByStatus(rows, 'All')).toHaveLength(4);
    expect(filterTransfersByStatus(rows, undefined)).toHaveLength(4);
  });
  it('filters to one status', () => {
    expect(filterTransfersByStatus(rows, 'Pending').map((r) => r.id)).toEqual(['a', 'd']);
    expect(filterTransfersByStatus(rows, 'Cancelled').map((r) => r.id)).toEqual(['c']);
  });
  it('is null-safe', () => {
    expect(filterTransfersByStatus(null, 'Pending')).toEqual([]);
  });
});

describe('planPharmacyTransferLines', () => {
  const mainStock = [
    { id: 'b1', itemId: 'i1', name: 'Paracetamol', batch: 'ABC123', expiry: '2027-10-31', mrp: 20, netRate: 12, gst: 12, stockist: 'X', stock: 100 },
    { id: 'b2', itemId: 'i2', name: 'Amoxicillin', batch: 'AMX9', expiry: '2026-12-31', mrp: 50, netRate: 30, gst: 5, stockist: 'Y', stock: 5 },
  ];

  it('resolves identity from the live Main Stock row, not the caller input', () => {
    const { lines, error } = planPharmacyTransferLines(mainStock, [
      { mainStockId: 'b1', name: 'wrong name', batch: 'wrong', qty: 40 },
    ]);
    expect(error).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      sourceBatchId: 'b1', sourceQty: 100, itemId: 'i1', batch: 'ABC123',
      expiry: '2027-10-31', qty: 40,
    });
  });

  it('drops zero / negative / non-numeric qty and unknown rows', () => {
    const { lines } = planPharmacyTransferLines(mainStock, [
      { mainStockId: 'b1', qty: 0 },
      { mainStockId: 'b1', qty: -3 },
      { mainStockId: 'b1', qty: 'x' },
      { mainStockId: 'nope', qty: 10 },
    ]);
    expect(lines).toEqual([]);
  });

  it('floors fractional qty', () => {
    const { lines } = planPharmacyTransferLines(mainStock, [{ mainStockId: 'b1', qty: 12.9 }]);
    expect(lines[0].qty).toBe(12);
  });

  it('errors when nothing is transferable', () => {
    const { lines, error } = planPharmacyTransferLines(mainStock, [{ mainStockId: 'ghost', qty: 5 }]);
    expect(lines).toEqual([]);
    expect(error).toMatch(/not found in Main Stock/i);
  });

  it('errors when a line exceeds available Main Stock (still returns the lines)', () => {
    const { lines, error } = planPharmacyTransferLines(mainStock, [{ mainStockId: 'b2', qty: 9 }]);
    expect(lines).toHaveLength(1);
    expect(error).toMatch(/only 5/);
  });

  it('is null-safe', () => {
    expect(planPharmacyTransferLines(null, null).lines).toEqual([]);
    expect(planPharmacyTransferLines(undefined, undefined).error).toBeTruthy();
  });
});

describe('planStockReturnLines', () => {
  const pharmacyStock = [
    { id: 'p1', itemId: 'i1', name: 'Paracetamol', batch: 'ABC123', expiry: '2027-10-31', mrp: 20, netRate: 12, gst: 12, stockist: 'X', stock: 30 },
    { id: 'p2', itemId: 'i2', name: 'Amoxicillin', batch: 'AMX9', expiry: '2026-12-31', mrp: 50, netRate: 30, gst: 5, stockist: 'Y', stock: 2 },
  ];

  it('resolves identity from the live Pharmacy Stock row, not the caller input', () => {
    const { lines, error } = planStockReturnLines(pharmacyStock, [
      { mainStockId: 'p1', name: 'whatever', batch: 'nope', qty: 10 },
    ]);
    expect(error).toBeNull();
    expect(lines[0]).toMatchObject({ sourceBatchId: 'p1', sourceQty: 30, itemId: 'i1', batch: 'ABC123', qty: 10 });
  });

  it('errors (mentioning Pharmacy Stock) when nothing is returnable', () => {
    const { lines, error } = planStockReturnLines(pharmacyStock, [{ mainStockId: 'ghost', qty: 5 }]);
    expect(lines).toEqual([]);
    expect(error).toMatch(/not found in Pharmacy Stock/i);
  });

  it('errors when a line exceeds available Pharmacy Stock (still returns the lines)', () => {
    const { lines, error } = planStockReturnLines(pharmacyStock, [{ mainStockId: 'p2', qty: 9 }]);
    expect(lines).toHaveLength(1);
    expect(error).toMatch(/only 2/);
  });
});

describe('isStockReturn', () => {
  const ids = { pharmacyLocationId: 'PH', mainLocationId: 'MN' };
  it('true only when the row goes pharmacy -> main', () => {
    expect(isStockReturn({ fromLocationId: 'PH', toLocationId: 'MN' }, ids)).toBe(true);
  });
  it('false for a forward transfer (main -> pharmacy)', () => {
    expect(isStockReturn({ fromLocationId: 'MN', toLocationId: 'PH' }, ids)).toBe(false);
  });
  it('false when ids are missing or the row is nullish', () => {
    expect(isStockReturn({ fromLocationId: 'PH', toLocationId: 'MN' }, {})).toBe(false);
    expect(isStockReturn(null, ids)).toBe(false);
  });
});
