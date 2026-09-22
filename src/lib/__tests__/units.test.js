import { stripsToUnits, unitsToStrips, formatStrips, resolveTransferQuantity } from '../units';

describe('stripsToUnits', () => {
  it('multiplies strips by the pack size', () => {
    expect(stripsToUnits(30, 10)).toBe(300);
  });
  it('treats a missing/zero/invalid pack size as 1 (vial/consumable no-op)', () => {
    expect(stripsToUnits(5, null)).toBe(5);
    expect(stripsToUnits(5, undefined)).toBe(5);
    expect(stripsToUnits(5, 0)).toBe(5);
    expect(stripsToUnits(5, -3)).toBe(5);
  });
  it('is null-safe on strips', () => {
    expect(stripsToUnits(null, 10)).toBe(0);
    expect(stripsToUnits(undefined, 10)).toBe(0);
  });
});

describe('unitsToStrips', () => {
  it('divides units by the pack size, exactly when it divides evenly', () => {
    expect(unitsToStrips(300, 10)).toBe(30);
  });
  it('produces a fractional strip count when it does not divide evenly', () => {
    expect(unitsToStrips(35, 10)).toBe(3.5);
    expect(unitsToStrips(265, 10)).toBe(26.5);
  });
  it('treats a missing/zero/invalid pack size as 1', () => {
    expect(unitsToStrips(5, null)).toBe(5);
    expect(unitsToStrips(5, 0)).toBe(5);
  });
});

describe('formatStrips', () => {
  it('renders one decimal place, matching the Pharmacy Billing precedent', () => {
    expect(formatStrips(26.5)).toBe('26.5');
    expect(formatStrips(27)).toBe('27.0');
  });
});

describe('resolveTransferQuantity', () => {
  it('strips mode: entered value is strips, units is derived', () => {
    expect(resolveTransferQuantity(3, 'strips', 10)).toEqual({ strips: 3, units: 30 });
  });
  it('units mode: entered value is units, strips is derived (may be fractional)', () => {
    expect(resolveTransferQuantity(35, 'units', 10)).toEqual({ strips: 3.5, units: 35 });
  });
  it('defaults to strips mode when transferUnit is unspecified', () => {
    expect(resolveTransferQuantity(3, undefined, 10)).toEqual({ strips: 3, units: 30 });
  });
  it('non-strip product (unitsPerPack = 1): strips and units are numerically identical', () => {
    expect(resolveTransferQuantity(4, 'strips', 1)).toEqual({ strips: 4, units: 4 });
    expect(resolveTransferQuantity(4, 'units', 1)).toEqual({ strips: 4, units: 4 });
  });
  it('is null-safe / negative-safe', () => {
    expect(resolveTransferQuantity(-5, 'strips', 10)).toEqual({ strips: 0, units: 0 });
    expect(resolveTransferQuantity(null, 'units', 10)).toEqual({ strips: 0, units: 0 });
  });

  // The exact worked examples from the approved business rule.
  it('scenario: 30 strips x 10/pack, transfer 3 strips -> Warehouse 27 strips, Pharmacy +30 units', () => {
    const { strips, units } = resolveTransferQuantity(3, 'strips', 10);
    expect(30 - strips).toBe(27);
    expect(units).toBe(30);
  });
  it('scenario: 30 strips x 10/pack (300 units), transfer 35 units -> Warehouse 26.5 strips, Pharmacy +35 units', () => {
    const { strips, units } = resolveTransferQuantity(35, 'units', 10);
    expect(30 - strips).toBe(26.5);
    expect(units).toBe(35);
  });
});
