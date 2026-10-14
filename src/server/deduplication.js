/**
 * Deduplication Engine & Provenance Preservation
 * Identifies exact and fuzzy duplicates across sources while maintaining
 * distinct source records and idempotent ingestion.
 */

/**
 * Normalizes a URL to its canonical form by stripping marketing tags,
 * hash fragments, trailing slashes, and sorting query parameters.
 * Preserves query parameters that materially identify the listing (e.g. job_id, id).
 *
 * @param {string} rawUrl
 * @returns {string} canonical URL
 */
export function normalizeCanonicalUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl.trim());
    parsed.hash = ''; // strip anchors
    
    // Strip common tracking and referrer params
    const strippedParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
      'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
      'ref', 'reference', 'ref_id', 'referrer', 'source',
      'fbclid', 'gclid', 'twclid', 'mc_cid', 'msclkid', 'yclid',
      '_hsenc', '_hsmi', 'hsCtaTracking', 'mkt_tok', 'trk', 'trackingId', 'si'
    ];
    for (const param of strippedParams) {
      parsed.searchParams.delete(param);
    }

    // Lowercase hostname and remove www
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

    // Normalize path by stripping trailing slash (unless root /)
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    // Sort remaining search parameters alphabetically for deterministic canonicalization
    parsed.searchParams.sort();

    return parsed.href;
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

/**
 * Normalizes text for comparison (lowercase, alphanumeric, collapsed spaces)
 * @param {string} text
 * @returns {string}
 */
export function normalizeTextKey(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates an idempotent deduplication key for a candidate
 * @param {object} candidate
 * @returns {string} primary deduplication key
 */
export function generateDeduplicationKey(candidate) {
  if (!candidate) return '';

  // 1. Source-specific ID takes precedence if available
  const extId = candidate.external_gig_id || candidate.source_listing_id;
  if (candidate.source_name && extId) {
    return `src:${candidate.source_name}:${extId}`;
  }
  if (extId) {
    return `ext:${extId}`;
  }

  // 2. Canonical URL key
  const canonical = normalizeCanonicalUrl(candidate.canonical_url || candidate.original_url || candidate.origin_url);
  if (canonical && canonical.length > 10) {
    return `url:${canonical}`;
  }

  // 3. Fallback: Normalized Title + Organization key
  const titleKey = normalizeTextKey(candidate.title);
  const orgKey = normalizeTextKey(candidate.organization);
  return `title_org:${titleKey}__${orgKey}`;
}

/**
 * Computes Jaccard word similarity between two strings (0.0 to 1.0)
 * @param {string} strA
 * @param {string} strB
 * @returns {number} similarity score
 */
export function calculateTextSimilarity(strA, strB) {
  const wordsA = new Set(normalizeTextKey(strA).split(' ').filter(w => w.length > 2));
  const wordsB = new Set(normalizeTextKey(strB).split(' ').filter(w => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Checks if a candidate is a duplicate of any existing candidates in a collection.
 * Follows the strict 4-tier matching order:
 * 1. External gig ID (same source listing ID / external_gig_id)
 * 2. Canonical URL (normalized, tracking params stripped)
 * 3. Content similarity (title + organization match; different orgs NEVER match)
 * 4. Cross-source duplicates (flagged for safe merging/review)
 *
 * @param {object} newCandidate
 * @param {Array<object>} existingCandidates
 * @returns {{ isDuplicate: boolean, duplicateOf: object|null, matchRule: string|null, isSameSource: boolean, isCrossSource: boolean, reason: string }}
 */
export function findDuplicate(newCandidate, existingCandidates = []) {
  if (!newCandidate || !Array.isArray(existingCandidates) || existingCandidates.length === 0) {
    return { isDuplicate: false, duplicateOf: null, matchRule: null, isSameSource: false, isCrossSource: false, reason: '' };
  }

  const newExtId = (newCandidate.external_gig_id || newCandidate.source_listing_id || '').trim();
  const newCanonical = normalizeCanonicalUrl(newCandidate.canonical_url || newCandidate.original_url || newCandidate.origin_url);
  const newTitleKey = normalizeTextKey(newCandidate.title);
  const newOrgKey = normalizeTextKey(newCandidate.organization);

  // RULE 1: External gig ID / Source listing ID
  if (newExtId) {
    for (const existing of existingCandidates) {
      if (existing.id && existing.id === newCandidate.id) continue;
      const existExtId = (existing.external_gig_id || existing.source_listing_id || '').trim();

      if (existExtId && existExtId === newExtId) {
        const isSameSource = Boolean(
          !newCandidate.source_name ||
          !existing.source_name ||
          newCandidate.source_name === existing.source_name
        );
        const isCrossSource = !isSameSource;

        return {
          isDuplicate: true,
          duplicateOf: existing,
          matchRule: 'EXTERNAL_ID',
          isSameSource,
          isCrossSource,
          reason: `Exact match on external gig ID / source listing ID (${newExtId})`
        };
      }
    }
  }

  // RULE 2: Canonical URL
  if (newCanonical && newCanonical.length > 10) {
    for (const existing of existingCandidates) {
      if (existing.id && existing.id === newCandidate.id) continue;
      const existCanonical = normalizeCanonicalUrl(existing.canonical_url || existing.original_url || existing.origin_url);

      if (existCanonical && newCanonical === existCanonical) {
        const isSameSource = Boolean(
          newCandidate.source_name &&
          existing.source_name &&
          newCandidate.source_name === existing.source_name
        );
        const isCrossSource = Boolean(
          newCandidate.source_name &&
          existing.source_name &&
          newCandidate.source_name !== existing.source_name
        );

        return {
          isDuplicate: true,
          duplicateOf: existing,
          matchRule: 'CANONICAL_URL',
          isSameSource,
          isCrossSource,
          reason: `Identical canonical URL (${newCanonical})`
        };
      }
    }
  }

  // RULE 3: Content similarity (Title + Organization)
  // CRITICAL: Do NOT merge unrelated gigs just because titles are similar.
  // Gigs from different organizations MUST remain distinct.
  if (newTitleKey) {
    for (const existing of existingCandidates) {
      if (existing.id && existing.id === newCandidate.id) continue;
      const existOrgKey = normalizeTextKey(existing.organization);
      const existTitleKey = normalizeTextKey(existing.title);

      const bothHaveOrg = newOrgKey && existOrgKey && newOrgKey !== 'undisclosedorganization' && existOrgKey !== 'undisclosedorganization';
      const sameOrg = bothHaveOrg && newOrgKey === existOrgKey;
      const bothUndisclosed = (!newOrgKey || newOrgKey === 'undisclosedorganization') && (!existOrgKey || existOrgKey === 'undisclosedorganization');

      // If both specify different organizations, they CANNOT be the same gig!
      if (!sameOrg && !bothUndisclosed) {
        continue;
      }

      const isSameSource = Boolean(
        newCandidate.source_name &&
        existing.source_name &&
        newCandidate.source_name === existing.source_name
      );
      const isCrossSource = Boolean(
        newCandidate.source_name &&
        existing.source_name &&
        newCandidate.source_name !== existing.source_name
      );

      // Exact title match
      if (newTitleKey === existTitleKey) {
        return {
          isDuplicate: true,
          duplicateOf: existing,
          matchRule: 'CONTENT_SIMILARITY',
          isSameSource,
          isCrossSource,
          reason: `Exact match on title and organization (${newCandidate.title} at ${newCandidate.organization || 'Undisclosed'})`
        };
      }

      // Fuzzy title similarity (>= 85% word overlap)
      const similarity = calculateTextSimilarity(newCandidate.title, existing.title);
      if (similarity >= 0.85) {
        return {
          isDuplicate: true,
          duplicateOf: existing,
          matchRule: 'CONTENT_SIMILARITY',
          isSameSource,
          isCrossSource,
          reason: `High title similarity (${Math.round(similarity * 100)}%) for same organization (${newCandidate.organization || 'Undisclosed'})`
        };
      }
    }
  }

  return { isDuplicate: false, duplicateOf: null, matchRule: null, isSameSource: false, isCrossSource: false, reason: '' };
}

/**
 * Deduplicates a list of gig or candidate records so that at most one listing
 * is displayed or exported for each confirmed unique opportunity.
 *
 * @param {Array<object>} gigs
 * @returns {Array<object>} deduplicated gigs
 */
export function deduplicateGigList(gigs = []) {
  if (!Array.isArray(gigs) || gigs.length === 0) return [];
  const result = [];
  const seenExternalIds = new Set();
  const seenCanonicalUrls = new Set();
  const seenTitleOrgs = new Set();

  for (const gig of gigs) {
    if (!gig) continue;
    if (gig.is_duplicate) continue;

    const extId = (gig.external_gig_id || gig.source_listing_id || '').trim();
    if (extId && seenExternalIds.has(extId)) continue;

    const url = normalizeCanonicalUrl(gig.origin_url || gig.canonical_url || gig.application_url);
    if (url && seenCanonicalUrls.has(url)) continue;

    const titleKey = normalizeTextKey(gig.title);
    const orgKey = normalizeTextKey(gig.organization || gig.track_id || '');
    const titleOrgKey = `${titleKey}__${orgKey}`;
    if (titleKey && orgKey && seenTitleOrgs.has(titleOrgKey)) continue;

    if (extId) seenExternalIds.add(extId);
    if (url) seenCanonicalUrls.add(url);
    if (titleKey && orgKey) seenTitleOrgs.add(titleOrgKey);

    result.push(gig);
  }

  return result;
}

/**
 * Merges source provenance records across multiple discovery sources for the same opportunity.
 * Avoids duplicate entries while preserving distinct sources, URLs, and timestamps.
 *
 * @param {object} existingCandidate
 * @param {object} newCandidate
 * @returns {Array<{ source_name: string, source_type: string, source_listing_id: string|null, original_url: string, discovered_at: string }>}
 */
export function mergeCandidateProvenance(existingCandidate, newCandidate) {
  const existingHistory = Array.isArray(existingCandidate?.source_history)
    ? [...existingCandidate.source_history]
    : [{
        source_name: existingCandidate?.source_name || 'unknown_source',
        source_type: existingCandidate?.source_type || 'fixture',
        source_listing_id: existingCandidate?.source_listing_id || null,
        original_url: existingCandidate?.original_url || '',
        discovered_at: existingCandidate?.first_discovered_at || new Date().toISOString()
      }];

  const newEntry = {
    source_name: newCandidate?.source_name || 'unknown_source',
    source_type: newCandidate?.source_type || 'fixture',
    source_listing_id: newCandidate?.source_listing_id || null,
    original_url: newCandidate?.original_url || '',
    discovered_at: newCandidate?.first_discovered_at || new Date().toISOString()
  };

  const isAlreadyRecorded = existingHistory.some(entry =>
    entry.source_name === newEntry.source_name &&
    (entry.source_listing_id === newEntry.source_listing_id || entry.original_url === newEntry.original_url)
  );

  if (!isAlreadyRecorded) {
    existingHistory.push(newEntry);
  }

  return existingHistory;
}
