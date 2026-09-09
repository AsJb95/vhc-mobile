// Pure helpers for the stock-transfer workflow — no DB client, so they're
// unit-testable and safe to import anywhere. The same transfer_orders /
// transfer_order_items tables carry both directions:
//   * Warehouse -> Pharmacy  ("transfer")  from = main,     to = pharmacy
//   * Pharmacy  -> Warehouse ("return")    from = pharmacy,  to = main
// A row's direction is read from its from/to location ids — there is no second
// table and no extra status vocabulary (Pending / Completed / Rejected only).

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
export function planTransferLines(sourceStock, items, sourceLabel = 'Main Stock') {
  const lines = [];
  for (const raw of items || []) {
    const src = (sourceStock || []).find((i) => i.id === raw.mainStockId);
    const qty = Math.max(0, Math.floor(Number(raw.qty) || 0));
    if (!src || qty === 0) continue;
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

// Warehouse -> Pharmacy: source snapshot is Main Stock. (Unchanged public name
// so existing callers / tests keep working.)
export function planPharmacyTransferLines(mainStock, items) {
  return planTransferLines(mainStock, items, 'Main Stock');
}

// Pharmacy -> Warehouse return: source snapshot is the pharmacy counter's stock.
export function planStockReturnLines(pharmacyStock, items) {
  return planTransferLines(pharmacyStock, items, 'Pharmacy Stock');
}
