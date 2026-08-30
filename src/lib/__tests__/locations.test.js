import { findPharmacyLocation } from '../locations';

const LOCATIONS = [
  { id: 'm', name: 'VHC Warehouse (Main Stock)', type: 'warehouse_main' },
  { id: 's1', name: 'Main Dispensary', type: 'warehouse_sub' },
  { id: 's2', name: 'Branch Pharmacy', type: 'warehouse_sub' },
  { id: 'p', name: 'VHC Pharmacy Counter', type: 'pharmacy_counter' },
];

describe('findPharmacyLocation', () => {
  it('resolves the pharmacy_counter row, not a warehouse_sub named "*pharmacy*"', () => {
    const loc = findPharmacyLocation(LOCATIONS);
    expect(loc).toBeTruthy();
    expect(loc.id).toBe('p');
    expect(loc.type).toBe('pharmacy_counter');
  });

  it('never falls through to "Branch Pharmacy"', () => {
    const loc = findPharmacyLocation(LOCATIONS);
    expect(loc.id).not.toBe('s2');
  });

  it('returns null (no fallback) when no pharmacy_counter exists', () => {
    expect(findPharmacyLocation(LOCATIONS.filter((l) => l.type !== 'pharmacy_counter'))).toBeNull();
  });

  it('is null-safe', () => {
    expect(findPharmacyLocation(null)).toBeNull();
    expect(findPharmacyLocation(undefined)).toBeNull();
    expect(findPharmacyLocation([])).toBeNull();
  });

  // Mirrors the real production `locations` table (verified 2026-08-30): a
  // warehouse_sub literally named "VHC Pharmacy" sits next to the real
  // pharmacy_counter "VHC Pharmacy Counter". The old name-substring resolver
  // matched the wrong one; this must pick the counter.
  it('picks the pharmacy_counter over a same-named warehouse_sub (live shape)', () => {
    const live = [
      { id: 'main', name: 'VHC Warehouse (Main Stock)', type: 'warehouse_main' },
      { id: 'counter', name: 'VHC Pharmacy Counter', type: 'pharmacy_counter' },
      { id: 'sub', name: 'VHC Pharmacy', type: 'warehouse_sub' },
    ];
    expect(findPharmacyLocation(live).id).toBe('counter');
  });
});
