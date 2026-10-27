import {
  normalizeDrugName,
  calculateSimilarity,
  matchMedicine,
  matchScannedItems,
} from '../medicineMatcher';

describe('medicineMatcher service', () => {
  const mockCatalog = [
    { id: 'item-1', name: 'DOLO 650MG TABLETS', unitsPerPack: 15, mrp: 33.6 },
    { id: 'item-2', name: 'PAN 40MG TABLETS', unitsPerPack: 15, mrp: 165 },
    { id: 'item-3', name: 'AUGMENTIN 625 DUO TAB', unitsPerPack: 10, mrp: 223.5 },
    { id: 'item-4', name: 'PARACETAMOL 500MG TABLETS', unitsPerPack: 10, mrp: 20 },
    { id: 'item-5', name: 'AZITHRAL 500 TABLET', unitsPerPack: 5, mrp: 132 },
  ];

  describe('normalizeDrugName', () => {
    it('normalizes spaces, special characters, and strengths', () => {
      expect(normalizeDrugName('Dolo 650 MG Tab.')).toBe('DOLO 650MG TAB');
      expect(normalizeDrugName('PAN-40 (TABLETS)')).toBe('PAN 40 TABLETS');
      expect(normalizeDrugName('Augmentin 625 Duo')).toBe('AUGMENTIN 625 DUO');
    });
  });

  describe('calculateSimilarity', () => {
    it('returns 1.0 for identical strings and < 1.0 for different strings', () => {
      expect(calculateSimilarity('DOLO 650', 'DOLO 650')).toBe(1.0);
      expect(calculateSimilarity('DOLO 650', 'DOLO 500')).toBeGreaterThan(0.7);
      expect(calculateSimilarity('DOLO', 'METFORMIN')).toBeLessThan(0.3);
    });
  });

  describe('matchMedicine', () => {
    it('finds exact normalized match', () => {
      const match = matchMedicine('Dolo 650mg tablets', mockCatalog);
      expect(match.status).toBe('exact');
      expect(match.matchedItem.id).toBe('item-1');
      expect(match.confidence).toBe(1.0);
    });

    it('matches despite minor abbreviation or variation', () => {
      const match = matchMedicine('AUGMENTIN 625 DUO', mockCatalog);
      expect(['exact', 'high']).toContain(match.status);
      expect(match.matchedItem.id).toBe('item-3');
      expect(match.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('identifies unmatched items and suggests top candidates', () => {
      const match = matchMedicine('TELMA 40MG TAB', mockCatalog);
      expect(match.status).toBe('unmatched');
      expect(match.matchedItem).toBeNull();
    });
  });

  describe('matchScannedItems', () => {
    it('batches matching across all bill items and links IDs', () => {
      const scannedItems = [
        { name: 'DOLO 650MG', qty: 20 },
        { name: 'PAN 40 TABLETS', qty: 10 },
        { name: 'UNKNOWN DRUG 100MG', qty: 5 },
      ];

      const results = matchScannedItems(scannedItems, mockCatalog);
      expect(results).toHaveLength(3);
      expect(results[0].matchedItemId).toBe('item-1');
      expect(results[1].matchedItemId).toBe('item-2');
      expect(results[2].matchedItemId).toBeNull();
      expect(results[2].matchStatus).toBe('unmatched');
    });
  });
});
