import { accessFor, stockValuation, expiryExposure, validBusinessDate, fetchAllPages, paymentAmount } from '../management';
import { reconcileCredit, collectCredit } from '../credit';

describe('management access', () => {
  it('fails closed and separates reporting, stock and collection roles', () => {
    expect(accessFor(null).canViewReports).toBe(false);
    expect(accessFor({ role: 'viewer' })).toMatchObject({ canViewReports: true, canManageCredit: false, canWritePharmacy: false, canWriteWarehouse: false, canViewInventory: false });
    expect(accessFor({ role: 'pharmacist' })).toMatchObject({ canViewReports: false, canManageCredit: false, canWritePharmacy: true });
    expect(accessFor({ role: 'admin' }).canManageCredit).toBe(true);
    expect(Object.values(accessFor({ is_platform_admin: true })).every(Boolean)).toBe(true);
  });
});
describe('stock value and expiry', () => {
  it('values 3 warehouse strips and 30 pharmacy units equally', () => {
    expect(stockValuation([{ stock: 3, unitsPerPack: 10, netRate: 100 }]).value).toBe(300);
    expect(stockValuation([{ stock: 30, unitsPerPack: 10, netRate: 100 }], true).value).toBe(300);
    expect(stockValuation([{ stock: 2, netRate: null }])).toEqual({ value: 0, missingCost: 1 });
  });
  it('uses India calendar dates, excludes expired and zero stock', () => {
    const rows = [
      { stock: 10, netRate: 20, expiry: '2026-09-21' },
      { stock: 0, netRate: 20, expiry: '2026-10-01' },
      { stock: 10, netRate: 20, expiry: '2026-09-20' },
      { stock: 10, netRate: 20, expiry: '2026-10-21' },
      { stock: 10, netRate: 20, expiry: '2026-10-22' },
    ];
    expect(expiryExposure(rows, 30, false, new Date('2026-09-20T22:00:00Z')).batches).toEqual([rows[0], rows[3]]);
  });
});
it('rejects impossible dates and unsafe payment amounts', () => {
  expect(validBusinessDate('2026-02-30')).toBe(false);
  expect(validBusinessDate('2024-02-29')).toBe(true);
  for (const value of ['0', '-1', 'Infinity', '1e3', '1.001', '']) expect(paymentAmount(value)).toBeNull();
  expect(paymentAmount('150.50')).toBe(150.5);
});
it('continues past short server pages and propagates errors', async () => {
  const calls = [];
  const data = [1, 2, 3, 4, 5];
  const query = () => ({ range: async (from) => { calls.push(from); return { data: data.slice(from, from + 2) }; } });
  expect(await fetchAllPages(query, 500)).toEqual(data);
  expect(calls).toEqual([0, 2, 4, 5]);
  await expect(fetchAllPages(() => ({ range: async () => ({ error: new Error('offline') }) }))).rejects.toThrow('offline');
});
it('deducts partial and full repayments without changing billed revenue', () => {
  const sales = [{ id: 'a', payment_mode: 'Credit', total_amount: 100 }, { id: 'b', payment_mode: 'Credit', total_amount: 70 }];
  const ledger = reconcileCredit(sales, [{ sale_id: 'a', amount: 20 }, { sale_id: 'a', amount: 30 }, { sale_id: 'b', amount: 70 }]);
  expect(ledger.total).toBe(50); expect(ledger.count).toBe(1);
  expect(ledger.bills[0]).toMatchObject({ amount: 100, paid: 50, balance: 50 });
  expect(ledger.bills[1].balance).toBe(0);
});
it('uses the atomic collection API and retains the caller retry key', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: { id: 'receipt' } });
  const request = { saleId: 'bill', amount: '20.50', mode: 'UPI', requestId: 'same-request-key' };
  await collectCredit({ rpc }, request); await collectCredit({ rpc }, request);
  expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
  expect(rpc).toHaveBeenCalledWith('collect_credit_payment', { p_sale_id: 'bill', p_amount: 20.5, p_payment_mode: 'UPI', p_request_id: 'same-request-key' });
  await expect(collectCredit({ rpc }, { ...request, amount: '-1' })).rejects.toThrow('positive');
});
