import {
  PHARMACY_LOW_UNITS, PHARMACY_LOW_STRIPS, PHARMACY_CRITICAL_UNITS,
  isPharmacyOutOfStock, isPharmacyCritical, isPharmacyLow,
  pharmacyStockStatus, classifyPharmacyStock,
} from '../pharmacyStock';

const C = { danger: 'D', warning: 'W', success: 'S', muted: 'M' };

describe('pharmacy thresholds (distinct from warehouse 200)', () => {
  it('uses 20 units / 2 strips for low, half for critical', () => {
    expect(PHARMACY_LOW_UNITS).toBe(20);
    expect(PHARMACY_LOW_STRIPS).toBe(2);
    expect(PHARMACY_CRITICAL_UNITS).toBe(10);
  });

  it('an item that is "in stock" by the warehouse yardstick can still be pharmacy-low', () => {
    const item = { stock: 30, unitsPerPack: 10 }; // 3 strips — fine for warehouse (<200), low for pharmacy? 30>20 and 3>2 => NOT low
    expect(isPharmacyLow(item)).toBe(false);
    const item2 = { stock: 18, unitsPerPack: 10 }; // <=20 units => low
    expect(isPharmacyLow(item2)).toBe(true);
    const item3 = { stock: 20, unitsPerPack: 10 }; // exactly 2 strips => low
    expect(isPharmacyLow(item3)).toBe(true);
  });

  it('classifies out / critical / low / ok', () => {
    expect(isPharmacyOutOfStock({ stock: 0 })).toBe(true);
    expect(isPharmacyCritical({ stock: 8, unitsPerPack: 10 })).toBe(true);   // <=10 units
    expect(isPharmacyCritical({ stock: 0 })).toBe(false);                    // out, not critical
    expect(isPharmacyLow({ stock: 8, unitsPerPack: 10 })).toBe(true);        // critical is also low
    expect(isPharmacyLow({ stock: 500, unitsPerPack: 10 })).toBe(false);
  });

  it('pharmacyStockStatus returns a Badge-shaped result', () => {
    expect(pharmacyStockStatus({ stock: 0 }, C)).toEqual({ label: 'Out of Stock', color: 'D' });
    expect(pharmacyStockStatus({ stock: 5, unitsPerPack: 10 }, C).label).toBe('Critical');
    expect(pharmacyStockStatus({ stock: 15, unitsPerPack: 10 }, C).label).toBe('Low Stock');
    expect(pharmacyStockStatus({ stock: 300, unitsPerPack: 10 }, C).label).toBe('In Stock');
  });
});

describe('classifyPharmacyStock', () => {
  const soon = new Date(Date.now() + 10 * 86400000).toISOString();
  const past = new Date(Date.now() - 10 * 86400000).toISOString();
  const far = new Date(Date.now() + 400 * 86400000).toISOString();
  const list = [
    { id: 'a', name: 'A', stock: 0 },
    { id: 'b', name: 'B', stock: 8, unitsPerPack: 10 },
    { id: 'c', name: 'C', stock: 18, unitsPerPack: 10, expiry: soon },
    { id: 'd', name: 'D', stock: 300, unitsPerPack: 10, expiry: past },
    { id: 'e', name: 'E', stock: 300, unitsPerPack: 10, expiry: far },
  ];

  it('buckets everything correctly with a 90-day expiry horizon', () => {
    const r = classifyPharmacyStock(list, 90);
    expect(r.outOfStock.map((i) => i.id)).toEqual(['a']);
    expect(r.critical.map((i) => i.id)).toEqual(['b']);
    expect(r.low.map((i) => i.id)).toEqual(['c']); // critical items are NOT re-listed under low here
    expect(r.expiring.map((i) => i.id)).toEqual(['c']);
    expect(r.expired.map((i) => i.id)).toEqual(['d']);
  });
});
