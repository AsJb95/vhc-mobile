// Pure helpers for the Warehouse -> Pharmacy transfer workflow — no DB client,
// so they're unit-testable and safe to import anywhere.

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

// Resolve the lines of a Warehouse -> Pharmacy request against a Main Stock
// snapshot. Each input item only needs { mainStockId, qty }. Returns
// { lines, error } where `lines` carry the source batch id + the qty we last saw
// (for the caller's compare-and-set decrement), and `error` is a user-facing
// string when nothing can be transferred.
//
// Item / batch / expiry / rate identity is taken from the live Main Stock row,
// never from the caller — the caller only chooses which row and how many. This
// guarantees the transfer records the real item + batch, not just a name.
export function planPharmacyTransferLines(mainStock, items) {
  const lines = [];
  for (const raw of items || []) {
    const src = (mainStock || []).find((i) => i.id === raw.mainStockId);
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
    return { lines: [], error: 'Nothing to transfer — the item was not found in Main Stock.' };
  }
  const short = lines.find((l) => l.sourceQty < l.qty);
  if (short) {
    return {
      lines,
      error: `"${short.name}" no longer has ${short.qty} in Main Stock (only ${short.sourceQty}). Refresh and try again.`,
    };
  }
  return { lines, error: null };
}
