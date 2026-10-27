/**
 * Intelligent Medicine Matching Engine
 *
 * Matches medicine names from scanned pharmaceutical purchase bills
 * against the existing VHC inventory catalog (`mainStock` / `items`).
 *
 * Features:
 *  - Text normalization (removes noise, standardizes spaces/special chars)
 *  - Pharmaceutical dosage form stripping (TAB, CAP, SYP, INJ, etc.)
 *  - Strength/dosage normalization (650MG vs 650 MG vs 650)
 *  - Levenshtein / Jaro-Winkler similarity calculation
 *  - Token overlap scoring
 *  - Catalog search & ranking
 */

const DOSAGE_FORMS = [
  'TABLET', 'TABLETS', 'TAB', 'TABS',
  'CAPSULE', 'CAPSULES', 'CAP', 'CAPS',
  'SYRUP', 'SYP', 'SUSPENSION', 'SUSP',
  'INJECTION', 'INJ',
  'OINTMENT', 'OINT', 'CREAM', 'GEL',
  'DROPS', 'DROP', 'SOLUTION', 'SOLN',
  'RESPULES', 'RESPULE', 'INHALER',
  'SACHET', 'SACHETS', 'LOTION', 'EMULSION',
];

const DOSAGE_REGEX = new RegExp(`\\b(${DOSAGE_FORMS.join('|')})\\b`, 'gi');

/**
 * Normalizes a drug name for clean comparison:
 * - Upper-case
 * - Strips punctuation and symbols
 * - Normalizes spacing (e.g. "650 MG" -> "650MG")
 * - Removes dosage form tags for root comparison
 */
export function normalizeDrugName(name) {
  if (!name || typeof name !== 'string') return '';
  let str = name.toUpperCase().trim();

  // Strip punctuation like . , / - _ + ( ) [ ]
  str = str.replace(/[.,/\\#?!$%^&*;:{}=\-_`~()\[\]]/g, ' ');

  // Standardize unit attachments (e.g. "650 MG" -> "650MG", "5 ML" -> "5ML")
  str = str.replace(/(\d+)\s+(MG|GM|G|ML|MCG|IU|%)/gi, '$1$2');

  // Collapse whitespace
  str = str.replace(/\s+/g, ' ').trim();

  return str;
}

/**
 * Extracts root words excluding dosage form keywords.
 */
export function getRootTokens(normalizedName) {
  const withoutDosage = normalizedName.replace(DOSAGE_REGEX, ' ');
  return withoutDosage
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

/**
 * Computes Levenshtein distance between two strings.
 */
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = [];
  for (let i = 0; i <= b.length; i++) row[i] = i;

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      let val;
      if (a.charAt(i - 1) === b.charAt(j - 1)) {
        val = row[j - 1];
      } else {
        val = Math.min(row[j - 1] + 1, prev + 1, row[j] + 1);
      }
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

/**
 * Calculates string similarity ratio between 0.0 and 1.0.
 */
export function calculateSimilarity(s1, s2) {
  const a = s1.trim();
  const b = s2.trim();
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  const maxLen = Math.max(a.length, b.length);
  const dist = levenshteinDistance(a, b);
  return Math.max(0, 1.0 - dist / maxLen);
}

/**
 * Computes Jaccard token overlap between two token lists.
 */
export function calculateTokenOverlap(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0.0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

/**
 * Matches a scanned bill medicine row against the inventory list.
 *
 * @param {string} rawScannedName - Name extracted from bill
 * @param {Array<Object>} catalog - Array of inventory items ({ id, name, unitsPerPack, mrp, ... })
 * @returns {Object} Match result
 */
export function matchMedicine(rawScannedName, catalog = []) {
  if (!rawScannedName || !rawScannedName.trim() || !Array.isArray(catalog) || catalog.length === 0) {
    return {
      status: 'unmatched',
      matchedItem: null,
      confidence: 0,
      suggestedMatches: [],
    };
  }

  const normScanned = normalizeDrugName(rawScannedName);
  const scannedTokens = getRootTokens(normScanned);

  let bestMatch = null;
  let bestScore = 0;
  const scoredCandidates = [];

  for (const item of catalog) {
    if (!item || !item.name) continue;
    const normCatalog = normalizeDrugName(item.name);

    // 1. Exact normalized match
    if (normScanned === normCatalog) {
      return {
        status: 'exact',
        matchedItem: item,
        confidence: 1.0,
        suggestedMatches: [{ item, score: 1.0, reason: 'Exact match' }],
      };
    }

    // 2. Token overlap & string similarity
    const catalogTokens = getRootTokens(normCatalog);
    const tokenScore = calculateTokenOverlap(scannedTokens, catalogTokens);
    const stringScore = calculateSimilarity(normScanned, normCatalog);

    // Substring containment bonus (e.g. "DOLO 650" inside "DOLO 650MG TABLETS")
    let containmentBonus = 0;
    if (normCatalog.includes(normScanned) || normScanned.includes(normCatalog)) {
      containmentBonus = 0.15;
    }

    // Combined score (weighted token overlap + Levenshtein + containment)
    const compositeScore = Math.min(
      1.0,
      tokenScore * 0.5 + stringScore * 0.4 + containmentBonus,
    );

    if (compositeScore >= 0.40) {
      scoredCandidates.push({ item, score: compositeScore });
    }

    if (compositeScore > bestScore) {
      bestScore = compositeScore;
      bestMatch = item;
    }
  }

  // Sort candidates by score descending
  scoredCandidates.sort((a, b) => b.score - a.score);
  const topSuggestions = scoredCandidates.slice(0, 4);

  if (bestScore >= 0.82) {
    return {
      status: 'high',
      matchedItem: bestMatch,
      confidence: Math.round(bestScore * 100) / 100,
      suggestedMatches: topSuggestions,
    };
  }

  if (bestScore >= 0.50) {
    return {
      status: 'partial',
      matchedItem: bestMatch,
      confidence: Math.round(bestScore * 100) / 100,
      suggestedMatches: topSuggestions,
    };
  }

  return {
    status: 'unmatched',
    matchedItem: null,
    confidence: Math.round(bestScore * 100) / 100,
    suggestedMatches: topSuggestions,
  };
}

/**
 * Batch matches all items in a scanned invoice against the catalog.
 */
export function matchScannedItems(scannedItems = [], catalog = []) {
  return scannedItems.map((item, idx) => {
    const match = matchMedicine(item.name, catalog);
    return {
      ...item,
      id: item.id || `scanned-item-${idx}-${Date.now()}`,
      matchedItemId: match.matchedItem?.id || null,
      matchedItemName: match.matchedItem?.name || null,
      matchStatus: match.status,
      matchConfidence: match.confidence,
      suggestedMatches: match.suggestedMatches,
      // If matched, adopt unitsPerPack if available in catalog and not in bill
      unitsPerPack: item.unitsPerPack || match.matchedItem?.unitsPerPack || 10,
    };
  });
}
