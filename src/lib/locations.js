// Pure location helpers — no DB client import, so they're unit-testable and
// safe to use anywhere.

// The Pharmacy's own stock lives in the single location of type
// 'pharmacy_counter' ("VHC Pharmacy Counter"). Resolved by type — never by a
// name substring — so it stays correct regardless of what the row is called or
// re-seeded to.
export const PHARMACY_LOCATION_TYPE = 'pharmacy_counter';

export function findPharmacyLocation(locs) {
  return (locs || []).find((l) => l.type === PHARMACY_LOCATION_TYPE) || null;
}
