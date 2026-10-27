/**
 * Printed Pharmaceutical Bill OCR Parsing Service
 *
 * Designed specifically for Indian Pharmaceutical Purchase Invoices.
 * Parses multi-row item tables, distributor headers, batch codes,
 * expiry formats (MM/YY, DD/MM/YYYY), quantities, free goods, MRP, and PTR.
 */

// Common Indian distributor keywords
const DISTRIBUTOR_KEYWORDS = [
  'DISTRIBUTOR', 'DISTRIBUTORS', 'PHARMA', 'PHARMACEUTICAL', 'PHARMACEUTICALS',
  'AGENCIES', 'AGENCY', 'ENTERPRISES', 'ENTERPRISE', 'DRUG HOUSE', 'DRUGS',
  'HEALTHCARE', 'MEDICAL', 'SURGICAL', 'MEDICO', 'TRADERS', 'CHEMIST',
];

/**
 * Standardizes Indian invoice dates to YYYY-MM-DD.
 * Handles:
 *  - DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
 *  - MM/YY, MM/YYYY
 *  - YYYY-MM-DD
 */
export function normalizeDate(str) {
  if (!str || typeof str !== 'string') return '';
  const cleaned = str.trim().replace(/[.]/g, '/').replace(/[-]/g, '/');

  // MM/YY format (e.g. 09/27 or 9/27)
  const mmyyMatch = cleaned.match(/^(\d{1,2})\/(\d{2})$/);
  if (mmyyMatch) {
    const month = mmyyMatch[1].padStart(2, '0');
    const year = `20${mmyyMatch[2]}`;
    return `${year}-${month}-01`;
  }

  // MM/YYYY format (e.g. 09/2027)
  const mmyyyyMatch = cleaned.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmyyyyMatch) {
    const month = mmyyyyMatch[1].padStart(2, '0');
    const year = mmyyyyMatch[2];
    return `${year}-${month}-01`;
  }

  // DD/MM/YYYY format (e.g. 15/10/2026)
  const ddmmyyyyMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyyMatch) {
    const day = ddmmyyyyMatch[1].padStart(2, '0');
    const month = ddmmyyyyMatch[2].padStart(2, '0');
    const year = ddmmyyyyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // YYYY/MM/DD format (e.g. 2026/10/15)
  const yyyymmddMatch = cleaned.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (yyyymmddMatch) {
    const year = yyyymmddMatch[1];
    const month = yyyymmddMatch[2].padStart(2, '0');
    const day = yyyymmddMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return cleaned;
}

/**
 * Extracts invoice header info: Supplier, Invoice Number, Date.
 */
export function extractInvoiceHeader(lines = []) {
  let supplierName = '';
  let invoiceNumber = '';
  let invoiceDate = '';

  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const upper = line.toUpperCase();

    // Supplier check: First few lines that match distributor keywords
    if (!supplierName) {
      const isDistributor = DISTRIBUTOR_KEYWORDS.some((kw) => upper.includes(kw));
      if (isDistributor && !upper.startsWith('INVOICE') && !upper.startsWith('BILL') && !upper.startsWith('GSTIN')) {
        supplierName = line.replace(/^[0-9\s.:-]+/, '').trim();
      }
    }

    // Invoice Number check
    if (!invoiceNumber) {
      const invMatch = line.match(/(?:INV(?:OICE)?\.?\s*(?:NO|#)?|BILL\s*(?:NO|#)?)\s*[:.-]?\s*([A-Z0-9\/-]+)/i);
      if (invMatch && invMatch[1] && invMatch[1].length >= 2) {
        invoiceNumber = invMatch[1].replace(/[^A-Z0-9\/-]/gi, '').trim();
      }
    }

    // Invoice Date check
    if (!invoiceDate) {
      const dateMatch = line.match(/(?:DATE|DT|INVOICE\s*DATE)\s*[:.-]?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/i);
      if (dateMatch && dateMatch[1]) {
        invoiceDate = normalizeDate(dateMatch[1]);
      }
    }
  }

  // Fallbacks if not explicitly tagged
  if (!supplierName && lines.length > 0) {
    supplierName = lines[0].trim();
  }
  if (!invoiceNumber) {
    invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
  }
  if (!invoiceDate) {
    invoiceDate = new Date().toISOString().split('T')[0];
  }

  return { supplierName, invoiceNumber, invoiceDate };
}

/**
 * Parses individual medicine rows from printed invoice lines.
 */
export function parseInvoiceItems(lines = []) {
  const items = [];
  let itemIndex = 0;

  const taggedBatchRegex = /(?:B\.?\s*NO|BATCH|LOT|B\/N)\s*[:.-]?\s*([A-Z0-9-]{3,15})/i;
  const taggedExpiryRegex = /(?:EXP(?:IRY)?|E\.?DT)\s*[:.-]?\s*(\d{1,2}[\/.-]\d{2,4})/i;
  const looseExpiryRegex = /\b(\d{1,2}[\/.-]\d{2,4})\b/;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    const upper = rawLine.toUpperCase();
    if (
      upper.startsWith('TOTAL') ||
      upper.startsWith('SUB TOTAL') ||
      upper.startsWith('GRAND TOTAL') ||
      upper.startsWith('TERMS & CONDITIONS') ||
      upper.startsWith('BANK DETAILS') ||
      upper.startsWith('FOR ') ||
      upper.includes('AUTHORISED SIGNATORY') ||
      upper.includes('SL NO') ||
      upper.includes('PRODUCT NAME') ||
      upper.includes('DESCRIPTION')
    ) {
      continue;
    }

    // Approach 1: Check for explicit tagged inline format (e.g., Sample 2)
    // "1. PARACETAMOL 650MG TAB B.No: PA902 Exp: 09/27 Qty: 100 Free: 10 MRP: 32.50 PTR: 21.00 GST: 12%"
    const taggedExp = rawLine.match(taggedExpiryRegex);
    const taggedBno = rawLine.match(taggedBatchRegex);

    if (taggedExp || taggedBno) {
      const batch = taggedBno ? taggedBno[1] : `B${itemIndex + 1}01`;
      const expiry = taggedExp ? normalizeDate(taggedExp[1]) : '2027-12-01';

      // Medicine name: take text before B.No or Exp
      let namePart = rawLine;
      if (taggedBno) namePart = namePart.split(taggedBno[0])[0];
      if (taggedExp) namePart = namePart.split(taggedExp[0])[0];

      const name = namePart
        .replace(/^[0-9]+\s*[.)-]?\s*/, '')
        .trim();

      // Extract numeric fields
      const qtyMatch = rawLine.match(/(?:QTY|QUANTITY)\s*[:.-]?\s*(\d+)/i);
      const freeMatch = rawLine.match(/(?:FREE|F\.?QTY|SCHEME)\s*[:.-]?\s*(\d+)/i);
      const mrpMatch = rawLine.match(/MRP\s*[:.-]?\s*(\d+\.?\d*)/i);
      const ptrMatch = rawLine.match(/(?:RATE|PTR|PRICE)\s*[:.-]?\s*(\d+\.?\d*)/i);
      const gstMatch = rawLine.match(/(?:GST|TAX)\s*[:.-]?\s*(\d+\.?\d*)/i);

      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 10;
      const freeQty = freeMatch ? parseInt(freeMatch[1], 10) : 0;
      const mrp = mrpMatch ? parseFloat(mrpMatch[1]) : 0;
      const ptr = ptrMatch ? parseFloat(ptrMatch[1]) : 0;
      const gst = gstMatch ? parseFloat(gstMatch[1]) : 12;

      if (name && name.length >= 2) {
        itemIndex++;
        items.push({
          id: `row-${itemIndex}-${Date.now()}`,
          name,
          batch,
          expiry,
          qty,
          freeQty,
          unitsPerPack: 10,
          mrp: mrp > 0 ? mrp : Math.round((ptr * 1.25 || 100) * 100) / 100,
          ptr: ptr > 0 ? ptr : Math.round((mrp * 0.8 || 80) * 100) / 100,
          gst: gst || 12,
        });
        continue;
      }
    }

    // Approach 2: Tabular format (split by multiple spaces or tabs)
    // E.g.: "DOLO 650MG TABLETS        DL849   08/28     50    5    15   33.60  24.50   12"
    const parts = rawLine.split(/\s{2,}|\t/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 4) {
      const name = parts[0].replace(/^[0-9]+\s*[.)-]?\s*/, '').trim();
      let batch = '';
      let expiry = '';
      const numbers = [];

      for (let j = 1; j < parts.length; j++) {
        const col = parts[j];
        if (!expiry && looseExpiryRegex.test(col)) {
          const match = col.match(looseExpiryRegex);
          if (match) expiry = normalizeDate(match[1]);
        } else if (!batch && /^[A-Z0-9-]{3,12}$/i.test(col) && isNaN(Number(col))) {
          batch = col;
        } else {
          const n = parseFloat(col.replace(/[^0-9.]/g, ''));
          if (!isNaN(n)) numbers.push(n);
        }
      }

      if (name && (numbers.length >= 2 || expiry)) {
        itemIndex++;
        // Numbers mapping:
        // [Qty, Free, UPP, MRP, PTR, GST]
        let qty = 10;
        let freeQty = 0;
        let upp = 10;
        let mrp = 0;
        let ptr = 0;
        let gst = 12;

        if (numbers.length >= 6) {
          [qty, freeQty, upp, mrp, ptr, gst] = numbers;
        } else if (numbers.length === 5) {
          [qty, freeQty, upp, mrp, ptr] = numbers;
        } else if (numbers.length === 4) {
          [qty, freeQty, mrp, ptr] = numbers;
        } else if (numbers.length === 3) {
          [qty, mrp, ptr] = numbers;
        } else if (numbers.length === 2) {
          [qty, ptr] = numbers;
          mrp = Math.round(ptr * 1.25 * 100) / 100;
        }

        // Validate MRP > PTR
        if (mrp < ptr && ptr > 0) {
          const temp = mrp;
          mrp = ptr;
          ptr = temp;
        }

        items.push({
          id: `row-${itemIndex}-${Date.now()}`,
          name,
          batch: batch || `B${itemIndex}01`,
          expiry: expiry || '2027-12-01',
          qty: qty || 10,
          freeQty: freeQty || 0,
          unitsPerPack: upp || 10,
          mrp: mrp || 100,
          ptr: ptr || 80,
          gst: gst || 12,
        });
      }
    }
  }

  return items;
}

/**
 * Main parse function for raw OCR text string.
 */
export function parseInvoiceText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      header: { supplierName: '', invoiceNumber: '', invoiceDate: '' },
      items: [],
      rawText: '',
    };
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const header = extractInvoiceHeader(lines);
  const items = parseInvoiceItems(lines);

  return {
    header,
    items,
    rawText,
  };
}

/**
 * Synthetic Sample Purchase Invoices for offline testing & emulation.
 * Simulates real invoices from major Indian pharmaceutical wholesale distributors.
 */
export const SAMPLE_INVOICES = [
  {
    label: 'Standard Wholesale Pharma Bill (Apollo Med Distributors)',
    text: `APOLLO MEDICAL DISTRIBUTORS PVT LTD
Shop No 14, Wholesale Market, Anna Salai, Chennai
GSTIN: 33AAAAA1234A1Z5
INVOICE NO: AMD/2026/0489
DATE: 18/10/2026

Product Name              Batch   Exp Date  Qty  Free  UPP   MRP    PTR    GST%
DOLO 650MG TABLETS        DL849   08/28     50    5    15   33.60  24.50   12
PAN 40MG TABLETS          PN921   11/27     30    0    15  165.00 120.00   12
AUGMENTIN 625 DUO TAB     AG104   05/27     20    2    10  223.50 162.00   12
AZITHRAL 500 TABLET       AZ771   09/27     25    0     5  132.00  95.00   12
TELMA 40MG TABLETS        TM442   03/28     40    4    15  240.00 175.00   12
METFORMIN 500MG TAB       MF801   12/28     60    0    20   45.00  31.00   12

Sub Total: 22,485.00
CGST 6%: 1,349.10
SGST 6%: 1,349.10
Grand Total: 25,183.20`,
  },
  {
    label: 'Generic Medicine Bill (Sri Venkateswara Pharma)',
    text: `SRI VENKATESWARA PHARMA DISTRIBUTORS
Wholesale Drug House, Main Road, Trichy
INV NO: SVP-8921
INV DATE: 12-10-2026

1. PARACETAMOL 650MG TAB B.No: PA902 Exp: 09/27 Qty: 100 Free: 10 MRP: 32.50 PTR: 21.00 GST: 12%
2. CETIRIZINE 10MG TAB B.No: CT331 Exp: 04/28 Qty: 40 Free: 0 MRP: 22.00 PTR: 14.50 GST: 12%
3. OMEPRAZOLE 20MG CAP B.No: OM112 Exp: 10/27 Qty: 30 Free: 3 MRP: 55.00 PTR: 38.00 GST: 12%
4. AMOXICILLIN 500MG CAP B.No: AM558 Exp: 06/27 Qty: 20 Free: 0 MRP: 110.00 PTR: 78.00 GST: 12%

Total Amount: 5,420.00`,
  },
];
