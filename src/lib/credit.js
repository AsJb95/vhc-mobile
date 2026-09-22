import { fetchAllPages, paymentAmount } from './management';
import { paymentBucket } from './pharmacyReports';

export function reconcileCredit(sales, payments) {
  const bySale = new Map();
  for (const p of payments) {
    const list = bySale.get(p.sale_id) || [];
    list.push(p);
    bySale.set(p.sale_id, list);
  }
  const bills = sales.filter((s) => paymentBucket(s.payment_mode) === 'Credit').map((s) => {
    const history = bySale.get(s.id) || [];
    const paid = history.reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0) / 100;
    const amount = Number(s.total_amount) || 0;
    return { ...s, amount, paid, balance: Math.max(0, Math.round((amount - paid) * 100) / 100), history };
  });
  return { bills, payments, total: bills.reduce((sum, b) => sum + b.balance, 0), count: bills.filter((b) => b.balance > 0).length };
}

export async function loadCredit(client) {
  const [sales, payments] = await Promise.all([
    fetchAllPages(() => client.from('sales').select('id,bill_id,patient_id,patient_name,payment_mode,total_amount,sale_date')
      .or('payment_mode.ilike.credit,payment_mode.ilike.khata,payment_mode.ilike.due').order('id')),
    fetchAllPages(() => client.from('credit_payments').select('*').order('created_at', { ascending: false }).order('id')),
  ]);
  return reconcileCredit(sales, payments);
}

export async function collectCredit(client, { saleId, amount, mode, requestId }) {
  const parsed = paymentAmount(amount);
  if (!parsed) throw new Error('Enter a positive amount with at most two decimal places.');
  if (!['Cash', 'UPI', 'Card'].includes(mode)) throw new Error('Choose Cash, UPI or Card.');
  const { data, error } = await client.rpc('collect_credit_payment', {
    p_sale_id: saleId, p_amount: parsed, p_payment_mode: mode, p_request_id: requestId,
  });
  if (error) throw error;
  return data;
}
