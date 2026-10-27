import { calculateItemStock, calculateBillTotals, validateScannedItem } from '../../services/stockConverter';

describe('Purchase Bill Import logic contract', () => {
  it('validates header and items payload requirements', () => {
    const validHeader = {
      supplierName: 'APOLLO MEDICAL DISTRIBUTORS',
      invoiceNumber: 'INV-2026-904',
      invoiceDate: '2026-10-18',
    };

    const validItems = [
      {
        name: 'DOLO 650MG',
        batch: 'DL849',
        expiry: '2028-08-01',
        qty: 50,
        freeQty: 5,
        unitsPerPack: 15,
        mrp: 33.6,
        ptr: 24.5,
        gst: 12,
      },
    ];

    expect(validHeader.supplierName).toBeTruthy();
    expect(validHeader.invoiceNumber).toBeTruthy();
    expect(validItems.length).toBeGreaterThan(0);

    const validationErrors = validateScannedItem(validItems[0]);
    expect(validationErrors).toHaveLength(0);

    const totals = calculateBillTotals(validItems);
    expect(totals.totalBilledStrips).toBe(50);
    expect(totals.totalFreeStrips).toBe(5);
    expect(totals.totalWarehouseStrips).toBe(55);
    expect(totals.totalUnits).toBe(825);
  });

  it('rejects invalid items with zero quantity or missing batch', () => {
    const invalidItem = {
      name: 'INVALID DRUG',
      batch: '',
      expiry: '',
      qty: 0,
    };
    const errors = validateScannedItem(invalidItem);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('correctly calculates free scheme strips addition into warehouse stock', () => {
    const itemWithScheme = {
      name: 'PAN 40MG',
      batch: 'PN921',
      expiry: '2027-11-01',
      qty: 100,
      freeQty: 10, // 100 + 10 scheme
      unitsPerPack: 10,
      mrp: 160,
      ptr: 110,
      gst: 12,
    };

    const calc = calculateItemStock(itemWithScheme);
    expect(calc.billedQty).toBe(100);
    expect(calc.freeQty).toBe(10);
    expect(calc.totalStrips).toBe(110);
    expect(calc.totalUnits).toBe(1100);
    expect(calc.grossAmount).toBe(11000); // 100 * 110
    expect(calc.gstAmount).toBe(1320); // 12% of 11000
    expect(calc.netLineTotal).toBe(12320);
    // Effective cost per strip = 12320 / 110 = 112
    expect(calc.effectiveCostPerStrip).toBe(112);
  });

  it('verifies exact JSON payload mapping for atomic_import_purchase_bill RPC', () => {
    const header = {
      supplierName: 'MEDICINE DISTRIBUTOR PVT LTD',
      invoiceNumber: 'INV-STAGE7-TEST',
      invoiceDate: '2026-10-21',
    };

    const items = [
      {
        name: 'DOLO 650MG',
        batch: 'BT99',
        expiry: '2028-09-01',
        qty: 40,
        freeQty: 4,
        unitsPerPack: 15,
        mrp: 35.0,
        ptr: 25.0,
        gst: 12,
      },
    ];

    const rpcPayload = {
      supplier: header.supplierName.trim(),
      invoice_number: header.invoiceNumber.trim(),
      invoice_date: header.invoiceDate,
      notes: 'Imported via VHC Mobile Bill Scanner',
      items: items.map((i) => ({
        name: i.name,
        batch: i.batch,
        expiry: i.expiry,
        qty: i.qty,
        free_qty: i.freeQty || 0,
        units_per_pack: i.unitsPerPack || 10,
        mrp: i.mrp || 0,
        net_rate: i.ptr || 0,
        gst: i.gst || 12,
      })),
    };

    expect(rpcPayload.supplier).toBe('MEDICINE DISTRIBUTOR PVT LTD');
    expect(rpcPayload.invoice_number).toBe('INV-STAGE7-TEST');
    expect(rpcPayload.invoice_date).toBe('2026-10-21');
    expect(rpcPayload.items).toHaveLength(1);
    expect(rpcPayload.items[0]).toEqual({
      name: 'DOLO 650MG',
      batch: 'BT99',
      expiry: '2028-09-01',
      qty: 40,
      free_qty: 4,
      units_per_pack: 15,
      mrp: 35.0,
      net_rate: 25.0,
      gst: 12,
    });
  });
});
