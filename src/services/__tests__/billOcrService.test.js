import {
  normalizeDate,
  extractInvoiceHeader,
  parseInvoiceText,
  SAMPLE_INVOICES,
} from '../billOcrService';

describe('billOcrService', () => {
  describe('normalizeDate', () => {
    it('converts DD/MM/YYYY, MM/YY, and MM/YYYY to standard ISO YYYY-MM-DD', () => {
      expect(normalizeDate('15/10/2026')).toBe('2026-10-15');
      expect(normalizeDate('15-10-2026')).toBe('2026-10-15');
      expect(normalizeDate('08/28')).toBe('2028-08-01');
      expect(normalizeDate('11/2027')).toBe('2027-11-01');
      expect(normalizeDate('2026-10-15')).toBe('2026-10-15');
    });
  });

  describe('extractInvoiceHeader', () => {
    it('extracts distributor name, invoice number, and date from sample lines', () => {
      const lines = [
        'APOLLO MEDICAL DISTRIBUTORS PVT LTD',
        'Shop No 14, Wholesale Market, Anna Salai, Chennai',
        'GSTIN: 33AAAAA1234A1Z5',
        'INVOICE NO: AMD/2026/0489',
        'DATE: 18/10/2026',
      ];

      const header = extractInvoiceHeader(lines);
      expect(header.supplierName).toContain('APOLLO MEDICAL DISTRIBUTORS');
      expect(header.invoiceNumber).toBe('AMD/2026/0489');
      expect(header.invoiceDate).toBe('2026-10-18');
    });
  });

  describe('parseInvoiceText with SAMPLE_INVOICES', () => {
    it('parses tabular wholesale pharma invoice correctly', () => {
      const sample = SAMPLE_INVOICES[0];
      const parsed = parseInvoiceText(sample.text);

      expect(parsed.header.supplierName).toContain('APOLLO MEDICAL DISTRIBUTORS');
      expect(parsed.header.invoiceNumber).toBe('AMD/2026/0489');
      expect(parsed.header.invoiceDate).toBe('2026-10-18');

      expect(parsed.items.length).toBeGreaterThanOrEqual(5);

      const dolo = parsed.items.find((i) => i.name.includes('DOLO 650MG'));
      expect(dolo).toBeDefined();
      expect(dolo.batch).toBe('DL849');
      expect(dolo.expiry).toBe('2028-08-01');
      expect(dolo.qty).toBe(50);
      expect(dolo.mrp).toBe(33.6);
      expect(dolo.ptr).toBe(24.5);
    });

    it('parses inline single-line pharma bill correctly', () => {
      const sample = SAMPLE_INVOICES[1];
      const parsed = parseInvoiceText(sample.text);

      expect(parsed.header.supplierName).toContain('SRI VENKATESWARA PHARMA');
      expect(parsed.header.invoiceNumber).toBe('SVP-8921');
      expect(parsed.header.invoiceDate).toBe('2026-10-12');

      expect(parsed.items.length).toBe(4);

      const para = parsed.items.find((i) => i.name.includes('PARACETAMOL 650MG'));
      expect(para).toBeDefined();
      expect(para.batch).toBe('PA902');
      expect(para.expiry).toBe('2027-09-01');
      expect(para.qty).toBe(100);
      expect(para.freeQty).toBe(10);
      expect(para.mrp).toBe(32.5);
      expect(para.ptr).toBe(21);
    });
  });
});
