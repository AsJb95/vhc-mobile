import {
  calculateItemStock,
  calculateBillTotals,
  validateScannedItem,
  parseNumeric,
} from '../stockConverter';

describe('stockConverter service', () => {
  describe('parseNumeric', () => {
    it('parses numbers and dirty strings with currency or commas', () => {
      expect(parseNumeric(12)).toBe(12);
      expect(parseNumeric('₹1,250.50')).toBe(1250.5);
      expect(parseNumeric('15 strips')).toBe(15);
      expect(parseNumeric('', 5)).toBe(5);
      expect(parseNumeric(null, 0)).toBe(0);
      expect(parseNumeric(undefined, 10)).toBe(10);
    });
  });

  describe('calculateItemStock', () => {
    it('combines billed quantity and free scheme strips correctly', () => {
      const row = {
        qty: 50,
        freeQty: 5,
        unitsPerPack: 15,
        ptr: 20,
        mrp: 30,
        gst: 12,
        discount: 0,
      };

      const result = calculateItemStock(row);
      expect(result.billedQty).toBe(50);
      expect(result.freeQty).toBe(5);
      expect(result.totalStrips).toBe(55);
      // 55 strips * 15 tabs/strip = 825 units
      expect(result.totalUnits).toBe(825);
      expect(result.grossAmount).toBe(1000); // 50 * 20
      expect(result.taxableAmount).toBe(1000);
      expect(result.gstAmount).toBe(120); // 12% of 1000
      expect(result.netLineTotal).toBe(1120);
      // Effective cost per strip = 1120 / 55 total strips ≈ 20.36
      expect(result.effectiveCostPerStrip).toBe(20.36);
    });

    it('strictly preserves fractional strips', () => {
      const row = {
        qty: 2.5,
        freeQty: 0.5,
        unitsPerPack: 10,
        ptr: 100,
        mrp: 150,
        gst: 0,
      };
      const result = calculateItemStock(row);
      expect(result.totalStrips).toBe(3);
      expect(result.totalUnits).toBe(30);
    });
  });

  describe('calculateBillTotals', () => {
    it('sums multi-row items accurately', () => {
      const items = [
        { qty: 10, freeQty: 1, unitsPerPack: 10, ptr: 50, mrp: 70, gst: 12 },
        { qty: 20, freeQty: 0, unitsPerPack: 15, ptr: 100, mrp: 140, gst: 12 },
      ];

      const totals = calculateBillTotals(items);
      expect(totals.itemCount).toBe(2);
      expect(totals.totalBilledStrips).toBe(30);
      expect(totals.totalFreeStrips).toBe(1);
      expect(totals.totalWarehouseStrips).toBe(31);
      // Item 1: 11 * 10 = 110 units, Item 2: 20 * 15 = 300 units -> total 410 units
      expect(totals.totalUnits).toBe(410);
      expect(totals.totalTaxable).toBe(2500); // (10*50) + (20*100) = 500 + 2000
      expect(totals.totalGst).toBe(300); // 12% of 2500
      expect(totals.grandTotal).toBe(2800);
    });
  });

  describe('validateScannedItem', () => {
    it('detects missing name, missing batch, zero qty, and PTR > MRP', () => {
      const invalidItem = {
        name: '',
        qty: 0,
        batch: '',
        expiry: '',
        mrp: 50,
        ptr: 80,
      };

      const errors = validateScannedItem(invalidItem);
      expect(errors).toContain('Medicine name is required');
      expect(errors).toContain('Quantity must be greater than 0');
      expect(errors).toContain('Batch number is missing');
      expect(errors).toContain('Expiry date is missing');
      expect(errors.some((e) => e.includes('cannot exceed MRP'))).toBe(true);
    });

    it('passes clean valid item', () => {
      const validItem = {
        name: 'DOLO 650MG',
        qty: 20,
        freeQty: 2,
        batch: 'BT991',
        expiry: '2028-04-01',
        mrp: 35,
        ptr: 22,
      };
      expect(validateScannedItem(validItem)).toHaveLength(0);
    });
  });
});
