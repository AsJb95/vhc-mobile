// Pure pharmacy sales / inventory analytics — no React, no Supabase, fully
// unit-testable. Mirrors the calculation logic already used by the VHC Pharmacy
// POS + its Telegram bot (telegram-bot/lib/report.js): payment breakdown from
// sales.payment_mode, estimated gross profit = Σ subtotal − Σ (unit cost × qty),
// with "cost missing" tracked explicitly so a profit figure is NEVER fabricated.
//
// Supabase shapes consumed:
//   sale  = { id, bill_id, patient_id, patient_name, payment_mode, subtotal,
//             total_tax, total_amount, discount, sale_date, sale_items: [...] }
//   sale_items row = { item_id, drug_name, batch_no, category, quantity, rate, total }
//   stock batch (for cost lookup) = { itemId, batch, netRate, unitsPerPack }

// ---- payment-mode bucketing -------------------------------------------------

export const PAYMENT_BUCKETS = ['Cash', 'UPI', 'Card', 'Credit'];

export function paymentBucket(mode) {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'cash') return 'Cash';
  if (m === 'upi' || m === 'gpay' || m === 'phonepe' || m === 'paytm') return 'UPI';
  if (m === 'card' || m === 'debit' || m === 'credit card' || m === 'debit card') return 'Card';
  if (m === 'credit' || m === 'khata' || m === 'due') return 'Credit';
  return 'Other';
}

// ---- cost lookup ----------------------------------------------------------

// Build a Map for estimating cost of goods sold: prefer an exact item+batch
// match, fall back to any batch of the same item (most recent net_rate wins by
// virtue of insertion order from the caller). Values are per-unit cost.
export function buildCostLookup(stockRows) {
  const byItemBatch = new Map();
  const byItem = new Map();
  for (const r of stockRows || []) {
    const itemId = r.itemId ?? r.item_id;
    if (!itemId) continue;
    const perPack = Number(r.unitsPerPack ?? r.units_per_pack) || 1;
    const packCost = Number(r.netRate ?? r.net_rate);
    if (!(packCost > 0)) continue;
    const unitCost = packCost / perPack;
    const batch = (r.batch ?? r.batch_no ?? '').trim();
    if (batch) byItemBatch.set(`${itemId}||${batch}`, unitCost);
    if (!byItem.has(itemId)) byItem.set(itemId, unitCost);
  }
  return {
    unitCost(itemId, batch) {
      if (!itemId) return null;
      const b = (batch || '').trim();
      if (b && byItemBatch.has(`${itemId}||${b}`)) return byItemBatch.get(`${itemId}||${b}`);
      return byItem.has(itemId) ? byItem.get(itemId) : null;
    },
  };
}

// ---- period ranges -------------------------------------------------------

export const REPORT_PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 Days' },
  { key: 'thismonth', label: 'This Month' },
  { key: 'lastmonth', label: 'Last Month' },
  { key: 'customday', label: 'Custom Date' },
  { key: 'customrange', label: 'Custom Range' },
];

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

// Returns { from, to, label } as Date objects in the device's local time
// (the pharmacy operates in a single timezone; the POS/bot use Asia/Kolkata).
export function periodRange(key, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  switch (key) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now), label: 'Today' };
    case 'yesterday': {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y), label: 'Yesterday' };
    }
    case 'last7': {
      const f = new Date(now); f.setDate(f.getDate() - 6);
      return { from: startOfDay(f), to: endOfDay(now), label: 'Last 7 Days' };
    }
    case 'thismonth': {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(f), to: endOfDay(now), label: 'This Month' };
    }
    case 'lastmonth': {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const t = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: startOfDay(f), to: endOfDay(t), label: 'Last Month' };
    }
    case 'customday': {
      const d = opts.day ? new Date(opts.day) : now;
      return { from: startOfDay(d), to: endOfDay(d), label: 'Custom Date' };
    }
    case 'customrange': {
      const f = opts.from ? new Date(opts.from) : startOfDay(now);
      const t = opts.to ? new Date(opts.to) : endOfDay(now);
      return { from: startOfDay(f), to: endOfDay(t), label: 'Custom Range' };
    }
    default:
      return { from: startOfDay(now), to: endOfDay(now), label: 'Today' };
  }
}

export function filterSalesByRange(sales, from, to) {
  const lo = from instanceof Date ? from.getTime() : new Date(from).getTime();
  const hi = to instanceof Date ? to.getTime() : new Date(to).getTime();
  return (sales || []).filter((s) => {
    const t = new Date(s.sale_date || s.saleDate).getTime();
    return Number.isFinite(t) && t >= lo && t <= hi;
  });
}

// ---- summary -----------------------------------------------------------

export function summarizeSales(sales, costLookup) {
  let totalSales = 0, totalSubtotal = 0, totalTax = 0, totalUnits = 0;
  let costTotal = 0, costUnknownUnits = 0;
  const payments = { Cash: 0, UPI: 0, Card: 0, Credit: 0, Other: 0 };
  const drugMap = new Map();

  for (const bill of sales || []) {
    const amount = Number(bill.total_amount ?? bill.totalAmount) || 0;
    totalSales += amount;
    totalSubtotal += Number(bill.subtotal) || 0;
    totalTax += Number(bill.total_tax ?? bill.totalTax) || 0;
    payments[paymentBucket(bill.payment_mode ?? bill.paymentMode)] += amount;

    const items = bill.sale_items || bill.items || [];
    for (const it of items) {
      const qty = Number(it.quantity ?? it.qty) || 0;
      totalUnits += qty;
      const unitCost = costLookup ? costLookup.unitCost(it.item_id ?? it.itemId, it.batch_no ?? it.batch) : null;
      if (unitCost != null && unitCost > 0) costTotal += unitCost * qty;
      else costUnknownUnits += qty;

      const name = (it.drug_name ?? it.name ?? 'Unknown').trim() || 'Unknown';
      const key = name.toUpperCase();
      const prev = drugMap.get(key) || { name, units: 0, revenue: 0 };
      prev.units += qty;
      prev.revenue += Number(it.total) || 0;
      drugMap.set(key, prev);
    }
  }

  const billCount = (sales || []).length;
  return {
    billCount,
    totalSales,
    totalSubtotal,
    totalTax,
    totalUnits,
    avgBill: billCount ? totalSales / billCount : 0,
    payments,
    costTotal,
    costUnknownUnits,
    hasReliableCost: costUnknownUnits === 0 && costTotal > 0,
    estimatedProfit: totalSubtotal - costTotal,
    drugTotals: [...drugMap.values()].sort((a, b) => b.units - a.units),
  };
}

// ---- month-over-month comparison --------------------------------------

export function compareSummaries(current, previous) {
  const delta = (a, b) => a - b;
  const pct = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);
  return {
    sales: { current: current.totalSales, previous: previous.totalSales, delta: delta(current.totalSales, previous.totalSales), pct: pct(current.totalSales, previous.totalSales) },
    bills: { current: current.billCount, previous: previous.billCount, delta: delta(current.billCount, previous.billCount), pct: pct(current.billCount, previous.billCount) },
    profit: {
      current: current.estimatedProfit, previous: previous.estimatedProfit,
      delta: delta(current.estimatedProfit, previous.estimatedProfit),
      pct: pct(current.estimatedProfit, previous.estimatedProfit),
      reliable: current.hasReliableCost && previous.hasReliableCost,
    },
  };
}

// ---- inventory intelligence -----------------------------------------

// Top medicines by units sold in the supplied sales window.
export function topSelling(sales, { limit = 25 } = {}) {
  return summarizeSales(sales, null).drugTotals.slice(0, limit);
}

// In-stock medicines that sold only a little (1..maxUnits) in the window.
export function slowMoving(sales, stockList, { maxUnits = 3 } = {}) {
  const sold = unitsSoldByName(sales);
  return (stockList || [])
    .filter((i) => (i.stock || 0) > 0)
    .map((i) => ({ ...i, unitsSold: sold.get((i.name || '').trim().toUpperCase()) || 0 }))
    .filter((i) => i.unitsSold >= 1 && i.unitsSold <= maxUnits)
    .sort((a, b) => a.unitsSold - b.unitsSold || a.name.localeCompare(b.name));
}

// In-stock medicines with ZERO sales anywhere in the (wider) window.
export function deadStock(sales, stockList) {
  const sold = unitsSoldByName(sales);
  return (stockList || [])
    .filter((i) => (i.stock || 0) > 0 && !(sold.get((i.name || '').trim().toUpperCase()) > 0))
    .sort((a, b) => (b.stock || 0) * (b.netRate || 0) - (a.stock || 0) * (a.netRate || 0));
}

function unitsSoldByName(sales) {
  const m = new Map();
  for (const bill of sales || []) {
    for (const it of bill.sale_items || bill.items || []) {
      const key = (it.drug_name ?? it.name ?? '').trim().toUpperCase();
      if (!key) continue;
      m.set(key, (m.get(key) || 0) + (Number(it.quantity ?? it.qty) || 0));
    }
  }
  return m;
}

// ---- credit / outstanding -----------------------------------------

// The POS records Credit-mode bills but has NO repayment ledger — this is
// "credit billed", not "amount still owed after part-payments". Callers MUST
// surface that distinction (see CreditScreen).
export function creditBills(sales) {
  const list = (sales || [])
    .filter((s) => paymentBucket(s.payment_mode ?? s.paymentMode) === 'Credit')
    .map((s) => ({
      id: s.id,
      billId: s.bill_id ?? s.billId,
      patientId: s.patient_id ?? s.patientId,
      patientName: s.patient_name ?? s.patientName ?? 'Walk-in',
      date: s.sale_date ?? s.saleDate,
      amount: Number(s.total_amount ?? s.totalAmount) || 0,
      paymentMode: s.payment_mode ?? s.paymentMode ?? 'Credit',
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return { bills: list, total: list.reduce((s, b) => s + b.amount, 0), count: list.length };
}
