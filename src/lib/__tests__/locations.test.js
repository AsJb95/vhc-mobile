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
});
