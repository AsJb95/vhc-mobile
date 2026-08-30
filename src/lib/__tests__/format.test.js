import {
  formatCurrency,
  formatDate,
  formatBytes,
  daysUntil,
  expiryStatus,
  stockStatus,
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
