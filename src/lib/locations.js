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

// A location whose name carries the "(retired" marker (see
// supabase/migrations/20260907000100_retire_stale_pharmacy_sub_location.sql).
// Retired locations keep every row + FK for audit, but the app must not list
// them as active stock nor offer them as transfer destinations.
export function isRetiredLocation(loc) {
  return /\(retired/i.test(loc?.name || '');
}
