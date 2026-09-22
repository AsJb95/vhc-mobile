import { unitsToStrips } from './units';
import { periodRange } from './pharmacyReports';

export function accessFor(profile) {
  const platform = profile?.is_platform_admin === true;
  const admin = platform || profile?.role === 'admin';
  return {
    canViewReports: admin || profile?.role === 'viewer',
    canManageCredit: admin,
    canViewInventory: admin || ['pharmacist', 'warehouse_manager'].includes(profile?.role),
    canWriteWarehouse: admin || profile?.role === 'warehouse_manager',
    canWritePharmacy: admin || profile?.role === 'pharmacist',
  };
}

// Cost valuation: warehouse quantities are packs; pharmacy quantities are units.
// Missing cost stays visible rather than silently substituting selling price.
export function stockValuation(rows, pharmacy = false) {
  let value = 0, missingCost = 0;
  for (const row of rows || []) {
    const qty = Math.max(0, Number(row.stock) || 0);
    if (!qty) continue;
    if (row.netRate == null || !Number.isFinite(Number(row.netRate)) || Number(row.netRate) < 0) {
      missingCost += 1;
      continue;
    }
    value += Number(row.netRate) * (pharmacy ? unitsToStrips(qty, row.unitsPerPack) : qty);
  }
  return { value, missingCost };
}

export function expiryExposure(rows, days, pharmacy = false, now = new Date()) {
  const start = periodRange('today', { now }).from.getTime();
  const end = start + (days + 1) * 86400000;
  const batches = (rows || []).filter((r) => {
    const expiry = new Date(`${String(r.expiry || '').slice(0, 10)}T00:00:00+05:30`).getTime();
    return Number(r.stock) > 0 && expiry >= start && expiry < end;
  });
  return { batches, ...stockValuation(batches, pharmacy) };
}

export function validBusinessDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Paginate explicitly: Supabase may cap each response at 1,000 rows even when
// callers request more. A final empty page proves completion.
export async function fetchAllPages(makeQuery, pageSize = 500) {
  const rows = [];
  for (;;) {
    const { data, error } = await makeQuery().range(rows.length, rows.length + pageSize - 1);
    if (error) throw error;
    if (!data?.length) return rows;
    rows.push(...data);
  }
}

export function paymentAmount(value) {
  const raw = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const amount = Number(raw);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
