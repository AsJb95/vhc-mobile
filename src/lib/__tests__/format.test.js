import {
  formatCurrency,
  formatDate,
  formatBytes,
  daysUntil,
  expiryStatus,
  stockStatus,
  computeStockValue,
} from '../format';

describe('formatCurrency', () => {
  it('formats INR with no decimals', () => {
    expect(formatCurrency(1234.56).replace(/ /g, ' ')).toMatch(/₹\s?1,235/);
  });
  it('treats null/undefined as zero', () => {
    expect(formatCurrency(null)).toMatch(/₹\s?0/);
    expect(formatCurrency(undefined)).toMatch(/₹\s?0/);
  });
});

describe('formatDate', () => {
  it('renders a dash for empty / invalid input', () => {
    expect(formatDate('')).toBe('—');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });
  it('renders a real date', () => {
    expect(formatDate('2027-01-31')).toMatch(/2027/);
  });
});

describe('formatBytes', () => {
  it('handles zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });
  it('scales units', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('daysUntil', () => {
  it('is null for empty input', () => {
    expect(daysUntil(null)).toBeNull();
  });
  it('is negative for past dates', () => {
    expect(daysUntil('2000-01-01')).toBeLessThan(0);
  });
  it('is positive for future dates', () => {
    const future = new Date(Date.now() + 10 * 864e5).toISOString();
    expect(daysUntil(future)).toBeGreaterThan(0);
  });
});

describe('expiryStatus', () => {
  it('flags expired', () => {
    expect(expiryStatus('2000-01-01').label).toBe('Expired');
  });
  it('flags near-expiry within 30 days', () => {
    const soon = new Date(Date.now() + 10 * 864e5).toISOString();
    expect(expiryStatus(soon).label).toMatch(/left/);
  });
  it('shows a plain date when far out', () => {
    const far = new Date(Date.now() + 400 * 864e5).toISOString();
    expect(expiryStatus(far).label).not.toMatch(/left|Expired/);
  });
});

describe('computeStockValue (Main Stock / Sub-Stock amount)', () => {
  // Rule (identical to the VHC Warehouse desktop app's src/lib/format.js):
  //   rate = netRate when netRate > 0, else mrp (else 0);  value = rate * stock.
  it('uses Net Rate when it is a real (> 0) cost price', () => {
    expect(computeStockValue(12, 20, 100)).toBe(1200); // 100 x 12
  });

  it('falls back to MRP when Net Rate is 0 — the reported bug (was showing ₹0)', () => {
    // EPPRA-LS 8 units, net_rate 0, mrp 83.44  -> 667.52 (was 0)
    expect(computeStockValue(0, 83.44, 8)).toBeCloseTo(667.52, 2);
    // Panday-40 300 units, net_rate 0, mrp 84  -> 25200 (was 0)
    expect(computeStockValue(0, 84, 300)).toBe(25200);
    // Arsenac-CT 780 units, net_rate 0, mrp 130 -> 101400 (was 0)
    expect(computeStockValue(0, 130, 780)).toBe(101400);
  });

  it('falls back to MRP when Net Rate is null / undefined / missing', () => {
    expect(computeStockValue(null, 50, 10)).toBe(500);
    expect(computeStockValue(undefined, 50, 10)).toBe(500);
    expect(computeStockValue(NaN, 50, 10)).toBe(500);
  });

  it('falls back to MRP when Net Rate is negative', () => {
    expect(computeStockValue(-5, 40, 10)).toBe(400);
  });

  it('is a genuine ₹0 only when BOTH Net Rate and MRP are missing/zero', () => {
    expect(computeStockValue(0, 0, 500)).toBe(0);
    expect(computeStockValue(null, null, 500)).toBe(0);
    expect(computeStockValue(undefined, undefined, 500)).toBe(0);
  });

  it('is ₹0 when quantity is 0 regardless of price', () => {
    expect(computeStockValue(12, 20, 0)).toBe(0);
    expect(computeStockValue(0, 130, 0)).toBe(0);
  });

  it('tracks quantity changes (recomputes from the passed stock)', () => {
    expect(computeStockValue(0, 10, 5)).toBe(50);
    expect(computeStockValue(0, 10, 6)).toBe(60); // +1 unit
    expect(computeStockValue(0, 10, 4)).toBe(40); // -1 unit
  });

  it('coerces string numbers (form/DB values) safely', () => {
    expect(computeStockValue('0', '84', '300')).toBe(25200);
    expect(computeStockValue('15', '84', '10')).toBe(150);
  });

  it('null/undefined stock counts as 0', () => {
    expect(computeStockValue(10, 20, null)).toBe(0);
    expect(computeStockValue(10, 20, undefined)).toBe(0);
  });
});

describe('stockStatus', () => {
  it('out of stock at zero', () => {
    expect(stockStatus(0).label).toBe('Out of Stock');
  });
  it('critical below 25% of threshold', () => {
    expect(stockStatus(40, 200).label).toBe('Critical');
  });
  it('low below threshold', () => {
    expect(stockStatus(150, 200).label).toBe('Low Stock');
  });
  it('in stock at/above threshold', () => {
    expect(stockStatus(200, 200).label).toBe('In Stock');
  });
});
