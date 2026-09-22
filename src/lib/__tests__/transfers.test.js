import {
  transferStatusColor,
  filterTransfersByStatus,
  planPharmacyTransferLines,
  planStockReturnLines,
  isStockReturn,
  resolveAcceptedLine,
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

describe('planPharmacyTransferLines — strips/units conversion (Warehouse -> Pharmacy)', () => {
  // 30 strips x 10 units/strip = 300 units, matching the approved business rule's worked example.
  const mainStock = [
    { id: 'b1', itemId: 'i1', name: 'Paracetamol', batch: 'ABC123', expiry: '2027-10-31', mrp: 20, netRate: 12, stock: 30, unitsPerPack: 10 },
  ];

  it('defaults to strips mode: qty deducted = strips entered, destQty = converted units', () => {
    const { lines, error } = planPharmacyTransferLines(mainStock, [{ mainStockId: 'b1', qty: 3 }]);
    expect(error).toBeNull();
    expect(lines[0]).toMatchObject({ qty: 3, destQty: 30, unitsPerPack: 10, transferUnit: 'strips' });
  });

  it('units mode: transfer 35 units -> Warehouse deducts a fractional 3.5-strip qty, Pharmacy receives 35 units', () => {
    const { lines, error } = planPharmacyTransferLines(mainStock, [{ mainStockId: 'b1', qty: 35 }], 'units');
    expect(error).toBeNull();
    expect(lines[0].qty).toBe(3.5);
    expect(lines[0].destQty).toBe(35);
    expect(30 - lines[0].qty).toBe(26.5); // resulting Warehouse stock, per the approved example
  });

  it('non-strip product (unitsPerPack = 1, e.g. a vial): both modes are numerically identical', () => {
    const vialStock = [{ id: 'v1', itemId: 'iv', name: 'Insulin Vial', stock: 20, unitsPerPack: 1 }];
    const strips = planPharmacyTransferLines(vialStock, [{ mainStockId: 'v1', qty: 4 }], 'strips');
    const units = planPharmacyTransferLines(vialStock, [{ mainStockId: 'v1', qty: 4 }], 'units');
    expect(strips.lines[0].destQty).toBe(4);
    expect(units.lines[0].destQty).toBe(4);
  });

  it('validates insufficient stock against strips (Main Stock is strip-native), even in units mode', () => {
    const over = planPharmacyTransferLines(mainStock, [{ mainStockId: 'b1', qty: 305 }], 'units');
    expect(over.error).toMatch(/only 30/);
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

describe('planStockReturnLines — units->strips conversion (Pharmacy -> Warehouse)', () => {
  const pharmacyStockWithPack = [
    { id: 'p1', itemId: 'i1', name: 'Paracetamol', batch: 'ABC123', stock: 100, unitsPerPack: 10 },
  ];

  it('qty deducted from Pharmacy stays in units; destQty added to Warehouse is converted to strips', () => {
    const { lines, error } = planStockReturnLines(pharmacyStockWithPack, [{ mainStockId: 'p1', qty: 35 }]);
    expect(error).toBeNull();
    expect(lines[0]).toMatchObject({ qty: 35, destQty: 3.5, unitsPerPack: 10, transferUnit: 'units' });
  });
});

// Regression coverage for the create-side transferUnitColsSupported bug (TR-2026-0008):
// insertPendingTransfer() used to gate `units_per_pack`/`transfer_unit` behind a
// one-shot startup probe that could get permanently stuck false on a transient
// failure, silently writing null/null on a brand-new row even though
// planPharmacyTransferLines/planStockReturnLines had already computed the real
// values right here. The gate is gone — insertPendingTransfer now writes
// line.unitsPerPack/line.transferUnit unconditionally — so these values, exactly
// as produced by the plan functions below, are exactly what every new
// transfer_order_items row persists. No capability probe exists anymore to
// intercept or discard them.
describe('create-side: fields persisted into transfer_order_items (no capability gate)', () => {
  const mainStock = [
    { id: 'b1', itemId: 'i1', name: 'Paracetamol', batch: 'ABC123', expiry: '2027-10-31', mrp: 20, netRate: 12, stock: 30, unitsPerPack: 10 },
  ];
  const pharmacyStock = [
    { id: 'p1', itemId: 'i1', name: 'Paracetamol', batch: 'ABC123', stock: 100, unitsPerPack: 10 },
  ];

  it("A. Warehouse -> Pharmacy, Transfer As Strips: 5 strips, 10/pack -> persists transfer_unit='strips', units_per_pack=10", () => {
    const { lines, error } = planPharmacyTransferLines(mainStock, [{ mainStockId: 'b1', qty: 5 }], 'strips');
    expect(error).toBeNull();
    expect(lines[0].transferUnit).toBe('strips');
    expect(lines[0].unitsPerPack).toBe(10);
    expect(lines[0].qty).toBe(5);
    expect(lines[0].destQty).toBe(50);
  });

  it("B. Warehouse -> Pharmacy, Transfer As Units: 35 units, 10/pack -> persists transfer_unit='units', units_per_pack=10", () => {
    const { lines, error } = planPharmacyTransferLines(mainStock, [{ mainStockId: 'b1', qty: 35 }], 'units');
    expect(error).toBeNull();
    expect(lines[0].transferUnit).toBe('units');
    expect(lines[0].unitsPerPack).toBe(10);
    expect(lines[0].qty).toBe(3.5);
    expect(lines[0].destQty).toBe(35);
  });

  it("C. Pharmacy -> Warehouse return: 53 units, 10/pack -> persists transfer_unit='units', units_per_pack=10 (the exact TR-2026-0008 scenario)", () => {
    const { lines, error } = planStockReturnLines(pharmacyStock, [{ mainStockId: 'p1', qty: 53 }]);
    expect(error).toBeNull();
    expect(lines[0].transferUnit).toBe('units');
    expect(lines[0].unitsPerPack).toBe(10);
    expect(lines[0].qty).toBe(53);
    expect(lines[0].destQty).toBe(5.3); // had this been persisted (it wasn't, pre-fix), Warehouse would have gained 5.3 strips, not 53
  });
});

// Regression coverage for the Test 2 acceptance failure: a transfer_order_items
// row correctly had transfer_unit='units', units_per_pack=10, qty=3.5 in the
// database, but the in-memory line used at accept time carried
// transferUnit=null/unitsPerPack=null (a stale-cache read), so the app
// silently did a 1:1 passthrough (Pharmacy +3.5) instead of converting
// (Pharmacy +35). resolveAcceptedLine is the fix: it's the single place
// acceptPendingTransfer computes destQty/converted, called on a FRESH,
// explicit-column read every time — these tests exercise it directly.
describe('resolveAcceptedLine', () => {
  it('strips mode: 5 strips, 10/pack -> Pharmacy receives 50 units', () => {
    const result = resolveAcceptedLine(
      { name: 'Test Item', qty: 5, transferUnit: 'strips', unitsPerPack: 10 },
      { sourceIsStrips: true },
    );
    expect(result).toEqual({ qty: 5, destQty: 50, converted: true });
  });

  it('units mode (the exact Test 2 scenario): 35 units entered, stored qty=3.5 strips, 10/pack -> Pharmacy receives 35 units', () => {
    const result = resolveAcceptedLine(
      { name: 'Test Item', qty: 3.5, transferUnit: 'units', unitsPerPack: 10 },
      { sourceIsStrips: true },
    );
    expect(result.qty).toBe(3.5); // deducted from Warehouse, in strips
    expect(result.destQty).toBe(35); // added to Pharmacy, in units — NOT 3.5
    expect(result.converted).toBe(true);
  });

  it('legacy row (transfer_unit and units_per_pack both null) preserves the historical 1:1 passthrough', () => {
    const result = resolveAcceptedLine(
      { name: 'Old Item', qty: 7, transferUnit: null, unitsPerPack: null },
      { sourceIsStrips: true },
    );
    expect(result).toEqual({ qty: 7, destQty: 7, converted: false });
  });

  it('legacy row: transferUnit/unitsPerPack simply absent from the object (undefined) is treated the same as null', () => {
    const result = resolveAcceptedLine({ name: 'Old Item', qty: 7 }, { sourceIsStrips: true });
    expect(result).toEqual({ qty: 7, destQty: 7, converted: false });
  });

  it('malformed: transfer_unit set but units_per_pack missing -> throws, does not silently pass through', () => {
    expect(() =>
      resolveAcceptedLine({ name: 'Broken Item', qty: 3.5, transferUnit: 'units', unitsPerPack: null }, { sourceIsStrips: true }),
    ).toThrow(/units_per_pack/);
  });

  it('malformed: units_per_pack set but transfer_unit missing -> throws, does not silently pass through', () => {
    expect(() =>
      resolveAcceptedLine({ name: 'Broken Item', qty: 3.5, transferUnit: null, unitsPerPack: 10 }, { sourceIsStrips: true }),
    ).toThrow(/transfer_unit/);
  });

  it('malformed: unrecognized transfer_unit value -> throws', () => {
    expect(() =>
      resolveAcceptedLine({ name: 'Broken Item', qty: 3.5, transferUnit: 'boxes', unitsPerPack: 10 }, { sourceIsStrips: true }),
    ).toThrow(/unrecognized transfer_unit/);
  });

  it('malformed: units_per_pack is zero or negative -> throws', () => {
    expect(() =>
      resolveAcceptedLine({ name: 'Broken Item', qty: 3.5, transferUnit: 'units', unitsPerPack: 0 }, { sourceIsStrips: true }),
    ).toThrow(/units_per_pack/);
    expect(() =>
      resolveAcceptedLine({ name: 'Broken Item', qty: 3.5, transferUnit: 'units', unitsPerPack: -5 }, { sourceIsStrips: true }),
    ).toThrow(/units_per_pack/);
  });

  it('reverse direction (sourceIsStrips=false, Pharmacy -> Warehouse return): units mode converts qty to strips for destQty', () => {
    const result = resolveAcceptedLine(
      { name: 'Test Item', qty: 35, transferUnit: 'units', unitsPerPack: 10 },
      { sourceIsStrips: false },
    );
    expect(result.qty).toBe(35); // deducted from Pharmacy, in units
    expect(result.destQty).toBe(3.5); // added to Warehouse, in strips
  });

  it('non-strip product (units_per_pack=1): converted is false even with real transfer_unit metadata', () => {
    const result = resolveAcceptedLine(
      { name: 'Vial Item', qty: 4, transferUnit: 'strips', unitsPerPack: 1 },
      { sourceIsStrips: true },
    );
    expect(result).toEqual({ qty: 4, destQty: 4, converted: false });
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
