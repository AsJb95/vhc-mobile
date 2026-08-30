export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
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
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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
