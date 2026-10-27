/**
 * Stock Quantity & Pricing Conversion Utilities
 *
 * Rules:
 *  - Warehouse stock is stored strictly in STRIPS.
 *  - Pharmacy stock is stored in UNITS (tablets/capsules/bottles).
 *  - Purchase invoices typically bill in Packs/Strips with occasional Free/Scheme quantities.
 *  - Total strips added to Warehouse = Billed Strips + Free Strips.
 *  - Decimal/fractional strips (e.g. 2.5 strips) are strictly preserved.
 */

import { stripsToUnits, unitsToStrips } from '../lib/units';

/**
 * Normalizes numerical inputs from OCR or user input.
 * Strips currency symbols, commas, and handles null/undefined.
 */
export function parseNumeric(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'number') return isNaN(val) ? fallback : val;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? fallback : n;
}

/**
 * Calculates stock quantities and financials for a scanned bill item.
 *
 * @param {Object} row
 * @param {number|string} row.qty - Billed strip quantity
 * @param {number|string} [row.freeQty=0] - Free / scheme strip quantity
 * @param {number|string} [row.unitsPerPack=1] - Tablets per strip
 * @param {number|string} [row.ptr=0] - Price To Retailer (purchase rate per strip)
 * @param {number|string} [row.mrp=0] - Maximum Retail Price per strip
 * @param {number|string} [row.gst=0] - GST percentage (e.g. 12 for 12%)
 * @param {number|string} [row.discount=0] - Discount percentage or amount
 */
export function calculateItemStock(row) {
  const billedQty = Math.max(0, parseNumeric(row.qty, 0));
  const freeQty = Math.max(0, parseNumeric(row.freeQty, 0));
  const totalStrips = Math.round((billedQty + freeQty) * 1000) / 1000;

  const rawUpp = parseNumeric(row.unitsPerPack, 1);
  const unitsPerPack = rawUpp > 0 ? rawUpp : 1;

  const totalUnits = stripsToUnits(totalStrips, unitsPerPack);

  const ptr = Math.max(0, parseNumeric(row.ptr || row.rate, 0));
  const mrp = Math.max(0, parseNumeric(row.mrp, 0));
  const gstPercent = Math.max(0, parseNumeric(row.gst || row.taxPercent, 0));
  const discountPercent = Math.max(0, parseNumeric(row.discount, 0));

  // Gross amount for the billed quantity
  const grossAmount = Math.round(billedQty * ptr * 100) / 100;
  const discountAmount = Math.round(grossAmount * (discountPercent / 100) * 100) / 100;
  const taxableAmount = Math.max(0, grossAmount - discountAmount);
  const gstAmount = Math.round(taxableAmount * (gstPercent / 100) * 100) / 100;
  const netLineTotal = Math.round((taxableAmount + gstAmount) * 100) / 100;

  // Effective purchase cost per strip after factoring in free goods and taxes
  const effectiveCostPerStrip = totalStrips > 0
    ? Math.round((netLineTotal / totalStrips) * 100) / 100
    : ptr;

  return {
    billedQty,
    freeQty,
    totalStrips,
    unitsPerPack,
    totalUnits,
    ptr,
    mrp,
    gstPercent,
    discountPercent,
    grossAmount,
    discountAmount,
    taxableAmount,
    gstAmount,
    netLineTotal,
    effectiveCostPerStrip,
  };
}

/**
 * Aggregates all items in a purchase bill for invoice-level reconciliation.
 */
export function calculateBillTotals(items = []) {
  let totalBilledStrips = 0;
  let totalFreeStrips = 0;
  let totalWarehouseStrips = 0;
  let totalUnits = 0;
  let totalTaxable = 0;
  let totalGst = 0;
  let grandTotal = 0;

  for (const item of items) {
    const calc = calculateItemStock(item);
    totalBilledStrips += calc.billedQty;
    totalFreeStrips += calc.freeQty;
    totalWarehouseStrips += calc.totalStrips;
    totalUnits += calc.totalUnits;
    totalTaxable += calc.taxableAmount;
    totalGst += calc.gstAmount;
    grandTotal += calc.netLineTotal;
  }

  return {
    itemCount: items.length,
    totalBilledStrips: Math.round(totalBilledStrips * 1000) / 1000,
    totalFreeStrips: Math.round(totalFreeStrips * 1000) / 1000,
    totalWarehouseStrips: Math.round(totalWarehouseStrips * 1000) / 1000,
    totalUnits: Math.round(totalUnits),
    totalTaxable: Math.round(totalTaxable * 100) / 100,
    totalGst: Math.round(totalGst * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
  };
}

/**
 * Validates a single scanned item row.
 * Returns an array of error strings or empty array if valid.
 */
export function validateScannedItem(item) {
  const errors = [];
  if (!item.name || !item.name.trim()) {
    errors.push('Medicine name is required');
  }
  const billedQty = parseNumeric(item.qty, 0);
  const freeQty = parseNumeric(item.freeQty, 0);
  if (billedQty <= 0 && freeQty <= 0) {
    errors.push('Quantity must be greater than 0');
  }
  if (!item.batch || !item.batch.trim()) {
    errors.push('Batch number is missing');
  }
  if (!item.expiry || !item.expiry.trim()) {
    errors.push('Expiry date is missing');
  } else {
    // Basic expiry format check (YYYY-MM-DD or MM/YY)
    const expStr = item.expiry.trim();
    const dateObj = new Date(expStr);
    if (!isNaN(dateObj.getTime()) && dateObj < new Date('2020-01-01')) {
      errors.push('Expiry date appears invalid');
    }
  }

  const mrp = parseNumeric(item.mrp, 0);
  const ptr = parseNumeric(item.ptr || item.rate, 0);
  if (mrp > 0 && ptr > 0 && ptr > mrp) {
    errors.push(`Purchase rate (₹${ptr}) cannot exceed MRP (₹${mrp})`);
  }

  return errors;
}

export { stripsToUnits, unitsToStrips };
