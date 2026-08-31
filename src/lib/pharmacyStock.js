// Pharmacy stock thresholds — kept SEPARATE from the warehouse thresholds.
//
// The warehouse (alerts_config.low_stock_threshold ~= 200 units, for bulk
// main-stock) is the wrong yardstick for a dispensing counter. These mirror the
// VHC Pharmacy POS / Telegram bot defaults (telegram_config.json):
//   lowStockUnits = 20, lowStockStrips = 2, nearExpiryDays = 90
// "Critical" is half of the low thresholds, exactly as report.js does it.
//
// Expiry horizon (days) is genuinely shared between both systems, so callers
// still pass it in from alerts_config.expiry_alert_days.

export const PHARMACY_LOW_UNITS = 20;
export const PHARMACY_LOW_STRIPS = 2;
export const PHARMACY_CRITICAL_UNITS = Math.max(1, Math.floor(PHARMACY_LOW_UNITS / 2)); // 10
export const PHARMACY_CRITICAL_STRIPS = Math.max(0.5, PHARMACY_LOW_STRIPS / 2); // 1

const strips = (item) => (item.stock || 0) / (Number(item.unitsPerPack) || 1);

export function isPharmacyOutOfStock(item) {
  return (item.stock || 0) <= 0;
}
export function isPharmacyCritical(item) {
  if (isPharmacyOutOfStock(item)) return false;
  return (item.stock || 0) <= PHARMACY_CRITICAL_UNITS || strips(item) <= PHARMACY_CRITICAL_STRIPS;
}
export function isPharmacyLow(item) {
  if (isPharmacyOutOfStock(item)) return false;
  return (item.stock || 0) <= PHARMACY_LOW_UNITS || strips(item) <= PHARMACY_LOW_STRIPS;
}

// { label, color } for a Badge — same contract as format.js stockStatus so the
// pharmacy screens can drop it in without other changes.
export function pharmacyStockStatus(item, colors) {
  if (isPharmacyOutOfStock(item)) return { label: 'Out of Stock', color: colors.danger };
  if (isPharmacyCritical(item)) return { label: 'Critical', color: colors.danger };
  if (isPharmacyLow(item)) return { label: 'Low Stock', color: colors.warning };
  return { label: 'In Stock', color: colors.success };
}

// Bucketed alert lists for a pharmacy stock array. `expiryAlertDays` comes from
// the shared alerts_config.
export function classifyPharmacyStock(list, expiryAlertDays = 90) {
  const now = new Date();
  const horizon = new Date(now.getTime() + (expiryAlertDays || 90) * 24 * 60 * 60 * 1000);
  const out = { outOfStock: [], critical: [], low: [], expiring: [], expired: [] };
  for (const item of list || []) {
    if (isPharmacyOutOfStock(item)) out.outOfStock.push(item);
    else if (isPharmacyCritical(item)) out.critical.push(item);
    else if (isPharmacyLow(item)) out.low.push(item);

    if (item.expiry) {
      const d = new Date(item.expiry);
      if (!Number.isNaN(d.getTime())) {
        if (d < now) out.expired.push(item);
        else if (d <= horizon) out.expiring.push(item);
      }
    }
  }
  out.low.sort((a, b) => (a.stock || 0) - (b.stock || 0));
  out.critical.sort((a, b) => (a.stock || 0) - (b.stock || 0));
  out.expiring.sort((a, b) => new Date(a.expiry) - new Date(b.expiry));
  return out;
}
