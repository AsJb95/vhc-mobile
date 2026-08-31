import {
  paymentBucket, buildCostLookup, periodRange, filterSalesByRange,
  summarizeSales, compareSummaries, topSelling, slowMoving, deadStock, creditBills,
} from '../pharmacyReports';

const sale = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2),
  bill_id: over.bill_id || 'B1',
  payment_mode: over.payment_mode ?? 'Cash',
  subtotal: over.subtotal ?? 100,
  total_tax: over.total_tax ?? 12,
  total_amount: over.total_amount ?? 112,
  sale_date: over.sale_date || '2026-08-31T10:00:00.000Z',
  patient_id: over.patient_id,
  patient_name: over.patient_name,
  sale_items: over.sale_items || [],
});

describe('paymentBucket', () => {
  it('normalises common mode strings', () => {
    expect(paymentBucket('cash')).toBe('Cash');
    expect(paymentBucket('UPI')).toBe('UPI');
    expect(paymentBucket('gpay')).toBe('UPI');
    expect(paymentBucket('Debit Card')).toBe('Card');
    expect(paymentBucket('credit')).toBe('Credit');
    expect(paymentBucket('cheque')).toBe('Other');
    expect(paymentBucket(null)).toBe('Other');
  });
});

describe('buildCostLookup', () => {
  const stock = [
    { itemId: 'x', batch: 'B10', netRate: 100, unitsPerPack: 10 }, // ₹10 / unit
    { itemId: 'x', batch: 'B20', netRate: 50, unitsPerPack: 10 },  // ₹5 / unit
    { itemId: 'y', batch: '', netRate: 0, unitsPerPack: 10 },      // no cost -> skipped
  ];
  it('prefers exact item+batch, falls back to any batch of the item', () => {
    const l = buildCostLookup(stock);
    expect(l.unitCost('x', 'B10')).toBe(10);
    expect(l.unitCost('x', 'B20')).toBe(5);
    expect(l.unitCost('x', 'B99')).toBe(10); // first-seen fallback
    expect(l.unitCost('y', 'anything')).toBeNull();
    expect(l.unitCost(null)).toBeNull();
  });
});

describe('periodRange + filterSalesByRange', () => {
  const now = new Date('2026-08-31T15:00:00');
  it('today covers only that calendar day', () => {
    const { from, to } = periodRange('today', { now });
    expect(from.getHours()).toBe(0);
    expect(to.getHours()).toBe(23);
    expect(from.toDateString()).toBe(now.toDateString());
  });
  it('yesterday is the prior day', () => {
    const { from } = periodRange('yesterday', { now });
    expect(from.getDate()).toBe(30);
  });
  it('last7 spans 7 calendar days', () => {
    const { from, to } = periodRange('last7', { now });
    expect(Math.round((to - from) / 86400000)).toBe(7);
  });
  it('lastmonth = July 2026', () => {
    const { from, to } = periodRange('lastmonth', { now });
    expect(from.getMonth()).toBe(6); // July
    expect(to.getMonth()).toBe(6);
    expect(to.getDate()).toBe(31);
  });
  it('filters sales into the range inclusively', () => {
    const sales = [
      sale({ sale_date: '2026-08-31T09:00:00' }),
      sale({ sale_date: '2026-08-30T09:00:00' }),
    ];
    const { from, to } = periodRange('today', { now });
    expect(filterSalesByRange(sales, from, to)).toHaveLength(1);
  });
});

describe('periodRange: anchored to business timezone (Asia/Kolkata), not device local time', () => {
  const originalTZ = process.env.TZ;
  afterEach(() => { process.env.TZ = originalTZ; });

  it('uses Kolkata\'s calendar day even when it genuinely differs from the device\'s', () => {
    // 2026-08-31T23:00:00Z is still Aug 31 evening in New York (UTC-4) but already
    // Sept 1 pre-dawn in Kolkata (UTC+5:30) — a real divergence, not a coincidence.
    process.env.TZ = 'America/New_York';
    const now = new Date('2026-08-31T23:00:00.000Z');
    const { from, to, label } = periodRange('today', { now });
    expect(label).toBe('Today');
    const kolkataDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    expect(kolkataDay(from)).toBe('2026-09-01');
    expect(kolkataDay(to)).toBe('2026-09-01');
  });

  it('produces the identical "today" range regardless of which timezone the device is set to', () => {
    const now = new Date('2026-08-31T23:00:00.000Z');
    const zones = ['America/New_York', 'Asia/Kolkata', 'Pacific/Auckland', 'UTC'];
    const results = zones.map((tz) => { process.env.TZ = tz; return periodRange('today', { now }); });
    for (const r of results) {
      expect(r.from.getTime()).toBe(results[0].from.getTime());
      expect(r.to.getTime()).toBe(results[0].to.getTime());
    }
  });

  it('customday with a bare "YYYY-MM-DD" is anchored to Kolkata, not UTC-then-device-local', () => {
    process.env.TZ = 'America/Los_Angeles'; // UTC-7/8 — the old bug's worst case
    const { from, to } = periodRange('customday', { day: '2026-08-15' });
    const kolkataDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    expect(kolkataDay(from)).toBe('2026-08-15');
    expect(kolkataDay(to)).toBe('2026-08-15');
  });
});

describe('summarizeSales', () => {
  const cost = buildCostLookup([{ itemId: 'a', batch: 'B1', netRate: 40, unitsPerPack: 10 }]); // ₹4/unit
  const sales = [
    sale({ payment_mode: 'Cash', subtotal: 100, total_amount: 112,
      sale_items: [{ item_id: 'a', batch_no: 'B1', drug_name: 'Amox', quantity: 10, total: 100 }] }),
    sale({ payment_mode: 'UPI', subtotal: 50, total_amount: 56,
      sale_items: [{ item_id: 'z', batch_no: 'B9', drug_name: 'Zzz', quantity: 5, total: 50 }] }), // cost unknown
  ];

  it('totals, avg bill and payment split', () => {
    const s = summarizeSales(sales, cost);
    expect(s.billCount).toBe(2);
    expect(s.totalSales).toBe(168);
    expect(s.avgBill).toBe(84);
    expect(s.payments.Cash).toBe(112);
    expect(s.payments.UPI).toBe(56);
    expect(s.payments.Card).toBe(0);
  });

  it('estimated profit = subtotal - known cost, and tracks unknown-cost units', () => {
    const s = summarizeSales(sales, cost);
    // costTotal = 10 units * ₹4 = 40 ; subtotal = 150 ; profit = 110
    expect(s.costTotal).toBe(40);
    expect(s.estimatedProfit).toBe(110);
    expect(s.costUnknownUnits).toBe(5);
    expect(s.hasReliableCost).toBe(false);
  });

  it('never fabricates cost: no cost data -> costTotal 0, profit == subtotal', () => {
    const s = summarizeSales(sales, buildCostLookup([]));
    expect(s.costTotal).toBe(0);
    expect(s.estimatedProfit).toBe(150);
    expect(s.hasReliableCost).toBe(false);
  });
});

describe('compareSummaries (month-over-month)', () => {
  it('computes delta and percentage', () => {
    const cur = { totalSales: 120, billCount: 12, estimatedProfit: 30, hasReliableCost: true };
    const prev = { totalSales: 100, billCount: 10, estimatedProfit: 20, hasReliableCost: true };
    const c = compareSummaries(cur, prev);
    expect(c.sales.delta).toBe(20);
    expect(c.sales.pct).toBeCloseTo(20);
    expect(c.bills.delta).toBe(2);
    expect(c.profit.reliable).toBe(true);
  });
  it('pct is null when previous is zero', () => {
    const c = compareSummaries(
      { totalSales: 50, billCount: 5, estimatedProfit: 0, hasReliableCost: false },
      { totalSales: 0, billCount: 0, estimatedProfit: 0, hasReliableCost: false },
    );
    expect(c.sales.pct).toBeNull();
    expect(c.profit.reliable).toBe(false);
  });
});

describe('inventory intelligence', () => {
  const sales = [
    sale({ sale_items: [{ drug_name: 'A', quantity: 20 }, { drug_name: 'B', quantity: 2 }] }),
    sale({ sale_items: [{ drug_name: 'A', quantity: 5 }] }),
  ];
  const stock = [
    { id: '1', name: 'A', stock: 100 },
    { id: '2', name: 'B', stock: 50 },
    { id: '3', name: 'C', stock: 30, netRate: 10 }, // never sold
    { id: '4', name: 'D', stock: 0 },               // out of stock
  ];

  it('topSelling ranks by units', () => {
    const t = topSelling(sales);
    expect(t[0].name).toBe('A');
    expect(t[0].units).toBe(25);
  });
  it('slowMoving = in-stock with 1..maxUnits sold', () => {
    const s = slowMoving(sales, stock, { maxUnits: 3 });
    expect(s.map((x) => x.name)).toEqual(['B']);
  });
  it('deadStock = in-stock with zero sales', () => {
    const d = deadStock(sales, stock);
    expect(d.map((x) => x.name)).toEqual(['C']); // D excluded (0 stock)
  });
});

describe('creditBills', () => {
  it('lists only Credit-mode bills and sums them', () => {
    const r = creditBills([
      sale({ payment_mode: 'Credit', total_amount: 300, patient_name: 'Ravi' }),
      sale({ payment_mode: 'Cash', total_amount: 100 }),
      sale({ payment_mode: 'credit', total_amount: 200 }),
    ]);
    expect(r.count).toBe(2);
    expect(r.total).toBe(500);
    expect(r.bills[0].patientName).toBe('Ravi');
  });
});
