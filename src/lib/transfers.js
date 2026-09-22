// Pure helpers for the stock-transfer workflow — no DB client, so they're
// unit-testable and safe to import anywhere. The same transfer_orders /
// transfer_order_items tables carry both directions:
//   * Warehouse -> Pharmacy  ("transfer")  from = main,     to = pharmacy
//   * Pharmacy  -> Warehouse ("return")    from = pharmacy,  to = main
// A row's direction is read from its from/to location ids — there is no second
// table and no extra status vocabulary (Pending / Completed / Rejected only).
//
// Strips/units conversion: Warehouse stock is strips, Pharmacy stock is
// individual units (see lib/units.js for the confirmed business rule and the
// Pharmacy Billing reference implementation this mirrors). `qty` on a plan
// line is always in the SOURCE location's own native unit (strips for a
// Warehouse source, units for a Pharmacy source) — this is unchanged from
// before and is what gets deducted. `destQty` is the NEW field: the amount
// added to the DESTINATION, in the destination's native unit, converted via
// unitsPerPack when the two sides differ. For old rows with no conversion
// info (transfer_unit is null), destQty === qty, exactly matching the
// historical (buggy) 1:1 behavior — never reinterpreted.

import { resolveTransferQuantity, unitsToStrips, stripsToUnits } from './units';

// Badge colour for a transfer_orders.status, mirroring poStatusColor() in
// OrdersScreen. `theme` is the plain colour object from ThemeContext.
export function transferStatusColor(status, theme) {
  if (status === 'Completed') return theme.success;
  if (status === 'Rejected' || status === 'Cancelled') return theme.danger;
  return theme.warning; // Pending (or anything unexpected)
}

// 'Cancelled' kept for pre-existing rows from the old model. New requests end as
// Pending -> Completed (accepted) or Pending -> Rejected.
export const TRANSFER_STATUS_FILTERS = ['All', 'Pending', 'Completed', 'Rejected', 'Cancelled'];

export function filterTransfersByStatus(transfers, status) {
  if (!status || status === 'All') return transfers;
  return (transfers || []).filter((t) => t.status === status);
}

// Is this transfer row a Pharmacy -> Warehouse stock return (rather than a
// Warehouse -> Pharmacy transfer)? Direction is the only thing that tells them
// apart. `ids` = { pharmacyLocationId, mainLocationId }. Returns false when
// either id is missing so callers default to the forward interpretation.
export function isStockReturn(transfer, { pharmacyLocationId, mainLocationId } = {}) {
  if (!transfer || !pharmacyLocationId || !mainLocationId) return false;
  return transfer.fromLocationId === pharmacyLocationId && transfer.toLocationId === mainLocationId;
}

// Resolve the lines of a pending transfer/return against a live stock snapshot
// of the SOURCE location. Each input item only needs { mainStockId, qty } where
// `mainStockId` is the id of the source stock_batches row (kept that name for
// backwards compatibility with the Warehouse -> Pharmacy caller). Returns
// { lines, error } where `lines` carry the source batch id + the qty we last
// saw (for the caller's compare-and-set decrement), and `error` is a
// user-facing string when nothing can be moved.
//
// Item / batch / expiry / rate identity is taken from the live source row,
// never from the caller — the caller only chooses which row and how many. This
// guarantees the record carries the real item + batch, not just a name.
//
// opts.sourceIsStrips (default true): true for a Warehouse source (Main
// Stock / sub-stock — strips), false for a Pharmacy source (already
// individual units — no strip concept, no mode toggle applies).
// opts.transferUnit ('strips' | 'units', default 'strips'): only meaningful
// when sourceIsStrips — which unit the caller's `raw.qty` was entered in.
// Whatever a human actually types (a count of physical, indivisible strips or
// tablets) is floored; the DERIVED amount on the other side is a computed
// equivalence and may be fractional (e.g. 3.5 strips) — never floored,
// never rejected.
export function planTransferLines(sourceStock, items, sourceLabel = 'Main Stock', opts = {}) {
  const { transferUnit = 'strips', sourceIsStrips = true } = opts;
  const lines = [];
  for (const raw of items || []) {
    const src = (sourceStock || []).find((i) => i.id === raw.mainStockId);
    if (!src) continue;
    const unitsPerPack = src.unitsPerPack ?? null;

    let qty; // deducted from SOURCE, in the source's own native unit
    let destQty; // added to DESTINATION, in the destination's own native unit
    let resolvedUnit;
    if (sourceIsStrips) {
      const entered = Math.max(0, Math.floor(Number(raw.qty) || 0));
      const resolved = resolveTransferQuantity(entered, transferUnit, unitsPerPack);
      qty = resolved.strips;
      destQty = resolved.units;
      resolvedUnit = transferUnit === 'units' ? 'units' : 'strips';
    } else {
      // Pharmacy source: always native individual units, no toggle.
      qty = Math.max(0, Math.floor(Number(raw.qty) || 0));
      destQty = unitsToStrips(qty, unitsPerPack);
      resolvedUnit = 'units';
    }
    if (qty <= 0) continue;

    lines.push({
      sourceBatchId: src.id,
      sourceQty: Math.max(0, Number(src.stock) || 0),
      itemId: src.itemId,
      name: src.name,
      batch: src.batch || null,
      expiry: src.expiry || null,
      mrp: src.mrp ?? null,
      netRate: src.netRate ?? null,
      gst: src.gst ?? null,
      stockist: src.stockist ?? null,
      qty,
      destQty,
      unitsPerPack,
      transferUnit: resolvedUnit,
    });
  }
  if (lines.length === 0) {
    return { lines: [], error: `Nothing to transfer — the item was not found in ${sourceLabel}.` };
  }
  const short = lines.find((l) => l.sourceQty < l.qty);
  if (short) {
    return {
      lines,
      error: `"${short.name}" no longer has ${short.qty} in ${sourceLabel} (only ${short.sourceQty}). Refresh and try again.`,
    };
  }
  return { lines, error: null };
}

// Warehouse -> Pharmacy: source snapshot is Main Stock (strips). `transferUnit`
// ('strips' | 'units') is whatever the user picked in the transfer UI.
export function planPharmacyTransferLines(mainStock, items, transferUnit = 'strips') {
  return planTransferLines(mainStock, items, 'Main Stock', { transferUnit, sourceIsStrips: true });
}

// Pharmacy -> Warehouse return: source snapshot is the pharmacy counter's
// stock (individual units, native — no toggle, Pharmacy's model is unchanged).
export function planStockReturnLines(pharmacyStock, items) {
  return planTransferLines(pharmacyStock, items, 'Pharmacy Stock', { sourceIsStrips: false });
}

// Resolve one FRESHLY-READ transfer_order_items line (transferUnit/unitsPerPack
// must come from an explicit-column DB read taken immediately before this is
// called — never from cached/stale React state) into what acceptPendingTransfer
// needs to actually move stock: the amount to deduct from the source (in the
// source's own native unit — unchanged from `line.qty`) and the amount to add
// to the destination (in the destination's own native unit).
//
// A line is legacy ONLY when BOTH transferUnit and unitsPerPack are absent —
// that one shape is allowed through as a straight passthrough (destQty=qty),
// matching every transfer accepted before this feature existed, exactly as
// before. A row with just one of the two fields set, or an unrecognised
// transferUnit, is malformed rather than legacy and THROWS — it must block
// the accept before any stock is touched, not silently fall back to a 1:1
// passthrough (that silent fallback, triggered by a stale-cache read instead
// of a genuinely legacy row, is exactly what caused the Test 2 failure).
export function resolveAcceptedLine(line, { sourceIsStrips = true } = {}) {
  const transferUnit = line.transferUnit ?? null;
  const unitsPerPack = line.unitsPerPack ?? null;
  const qty = Math.max(0, Number(line.qty) || 0);
  const isLegacyRow = transferUnit == null && unitsPerPack == null;

  if (!isLegacyRow) {
    if (transferUnit !== 'strips' && transferUnit !== 'units') {
      throw new Error(`Transfer line for "${line.name}" has an unrecognized transfer_unit ("${transferUnit}"). Accept blocked — no stock has been changed.`);
    }
    if (!(Number(unitsPerPack) > 0)) {
      throw new Error(`Transfer line for "${line.name}" has transfer_unit='${transferUnit}' but an invalid units_per_pack. Accept blocked — no stock has been changed.`);
    }
  }

  const destQty = isLegacyRow
    ? qty
    : sourceIsStrips
      ? stripsToUnits(qty, unitsPerPack)
      : unitsToStrips(qty, unitsPerPack);
  const converted = !isLegacyRow && Number(unitsPerPack) !== 1;

  return { qty, destQty, converted };
}
