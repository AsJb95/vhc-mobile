// Strips <-> individual-units conversion for Warehouse stock.
//
// Business rule (confirmed against the live Pharmacy Billing app's own
// "Billed Strips (Qty)" / "Units Per Strip" / "Total Tablet Stock (Units/Nos)"
// editor — unpacked_app/dist/assets/index-doBKNLAj.js, lines ~54372-54393 and
// ~56234-56302):
//   - Warehouse stock_batches.qty is stored in STRIPS (packs).
//   - Pharmacy stock_batches.qty is stored in individual UNITS — unchanged,
//     never touched by this file.
//   - unitsPerPack is the strips->units conversion factor. Products with no
//     real pack structure (vials, equipment, consumables) simply have
//     unitsPerPack = 1, making the conversion a no-op — no separate code path
//     needed for them.
//   - Strips MAY be fractional (e.g. 26.5) when a unit-mode transfer doesn't
//     divide evenly. This mirrors Pharmacy Billing's own precedent of
//     `.toFixed(1)` on a back-derived strip count — never floored, never
//     rejected.
//
// Identical copy of app-v2/src/lib/units.js — this codebase's established
// convention (see lib/transfers.js, lib/locations.js) is one file duplicated
// verbatim into both apps rather than a shared package, since desktop
// (Electron/Vite) and mobile (Expo/React Native) don't share a build.

function normalizePack(unitsPerPack) {
  const n = Number(unitsPerPack);
  return n > 0 ? n : 1;
}

// Strips -> individual units. e.g. stripsToUnits(30, 10) === 300.
export function stripsToUnits(strips, unitsPerPack) {
  return (Number(strips) || 0) * normalizePack(unitsPerPack);
}

// Individual units -> equivalent strips (may be fractional).
// e.g. unitsToStrips(35, 10) === 3.5.
export function unitsToStrips(units, unitsPerPack) {
  return (Number(units) || 0) / normalizePack(unitsPerPack);
}

// Display-only rounding for a strip quantity — one decimal place, matching
// Pharmacy Billing's own `.toFixed(1)` precedent. Never used before a value
// is stored; storage keeps full precision.
export function formatStrips(strips) {
  return (Math.round((Number(strips) || 0) * 10) / 10).toFixed(1);
}

// Given what the user typed and which mode they typed it in, resolve the
// canonical { strips, units } pair. This is the single choke point both the
// Warehouse-deduction side and the Pharmacy-addition side read from, so the
// two sides can never drift apart.
//   transferUnit: 'strips' | 'units' (defaults to 'strips' — the historical,
//   pre-conversion behavior, so every existing caller that doesn't pass this
//   parameter keeps working exactly as before).
export function resolveTransferQuantity(enteredQty, transferUnit, unitsPerPack) {
  const qty = Math.max(0, Number(enteredQty) || 0);
  if (transferUnit === 'units') {
    return { strips: unitsToStrips(qty, unitsPerPack), units: qty };
  }
  return { strips: qty, units: stripsToUnits(qty, unitsPerPack) };
}
