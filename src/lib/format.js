const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

// Hermes normally ships Intl with ICU on modern Expo SDKs, but guard anyway so a
// build without it degrades to a plain format instead of throwing.
export function formatCurrency(amount) {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  } catch {
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
  }
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

export function expiryStatus(dateStr) {
  if (!dateStr) return { label: '—', color: colors.muted };
  const days = daysUntil(dateStr);
  if (days < 0) return { label: 'Expired', color: colors.danger };
  if (days <= 30) return { label: `${days}d left`, color: colors.warning };
  return { label: formatDate(dateStr), color: colors.muted };
}

export function stockStatus(stock, threshold = 200) {
  const s = stock || 0;
  if (s === 0) return { label: 'Out of Stock', color: colors.danger };
  if (s < threshold * 0.25) return { label: 'Critical', color: colors.danger };
  if (s < threshold) return { label: 'Low Stock', color: colors.warning };
  return { label: 'In Stock', color: colors.success };
}

// Stock value for one batch/row. Single source of truth, identical to the VHC
// Warehouse desktop app's src/lib/format.js: use Net Rate (the purchase/cost
// rate) when it is actually entered (> 0), otherwise fall back to MRP, so Value
// is never confusingly ₹0 just because the optional cost price is blank/zero —
// which is the case for almost every batch imported into this database. If both
// are missing/zero the value is a real ₹0 (there is genuinely no price on file).
// value = rate x available quantity.
export function computeStockValue(netRate, mrp, stock) {
  const rate = Number(netRate) > 0 ? Number(netRate) : (Number(mrp) || 0);
  return rate * (Number(stock) || 0);
}

export const colors = {
  bg: '#0a0f1e',
  panel: '#111a2e',
  panelBorder: '#1e293b',
  text: '#e2e8f0',
  muted: '#94a3b8',
  accent: '#3b82f6',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  purple: '#a855f7',
};
