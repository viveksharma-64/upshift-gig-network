/**
 * Audit & Duplicate Detection Scanner
 * Scans development data (candidates & published gigs) for duplicates using:
 * 1. External Gig ID
 * 2. Canonical URL
 * 3. Content Similarity (Title + Organization)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCanonicalUrl, normalizeTextKey, calculateTextSimilarity } from '../src/server/deduplication.js';
import { supabase } from '../src/lib/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CANDIDATES_FILE = path.resolve(__dirname, '../data/candidates.json');

async function scanDuplicates() {
  console.log('=== Duplicate Audit & Scan Report ===\n');

  // 1. Read local candidates
  const raw = await fs.readFile(CANDIDATES_FILE, 'utf8');
  const candidates = JSON.parse(raw);
  console.log(`Loaded ${candidates.length} candidates from data/candidates.json.`);

  // 2. Read live gigs from database if available
  let liveGigs = [];
  try {
    const { data, error } = await supabase.from('gigs').select('*');
    if (!error && Array.isArray(data)) {
      liveGigs = data;
      console.log(`Loaded ${liveGigs.length} live gigs from public.gigs.\n`);
    } else {
      console.log('public.gigs query returned error or empty (operating in local dev mode).\n');
    }
  } catch (err) {
    console.log(`Supabase live gigs query notice: ${err.message}\n`);
  }

  // 3. Scan Candidates for internal duplicates
  const detectedCandidateDuplicates = [];
  const seenExtIds = new Map();
  const seenUrls = new Map();
  const seenTitleOrg = new Map();

  for (const c of candidates) {
    const extId = c.external_gig_id || (c.source_name && c.source_listing_id ? `${c.source_name}:${c.source_listing_id}` : null);
    const canonical = normalizeCanonicalUrl(c.canonical_url || c.original_url || c.application_url);
    const titleKey = normalizeTextKey(c.title);
    const orgKey = normalizeTextKey(c.organization);
    const titleOrgKey = titleKey && orgKey ? `${titleKey}__${orgKey}` : null;

    let matched = null;
    let matchType = '';

    if (extId && seenExtIds.has(extId)) {
      matched = seenExtIds.get(extId);
      matchType = `External ID (${extId})`;
    } else if (canonical && seenUrls.has(canonical)) {
      matched = seenUrls.get(canonical);
      matchType = `Canonical URL (${canonical})`;
    } else if (titleOrgKey && seenTitleOrg.has(titleOrgKey)) {
      matched = seenTitleOrg.get(titleOrgKey);
      matchType = `Title + Organization (${c.title} @ ${c.organization})`;
    }

    if (matched) {
      detectedCandidateDuplicates.push({
        candidateId: c.id,
        candidateTitle: c.title,
        matchedWithId: matched.id,
        matchedWithTitle: matched.title,
        matchType,
        isSelfMatch: c.id === matched.id
      });
    } else {
      if (extId) seenExtIds.set(extId, c);
      if (canonical) seenUrls.set(canonical, c);
      if (titleOrgKey) seenTitleOrg.set(titleOrgKey, c);
    }
  }

  console.log('--- Candidate Store Duplicate Scan Results ---');
  if (detectedCandidateDuplicates.length === 0) {
    console.log('✓ No duplicate candidates detected in candidates.json.');
  } else {
    console.log(`Found ${detectedCandidateDuplicates.length} duplicate relationship(s):`);
    for (const d of detectedCandidateDuplicates) {
      console.log(` - [${d.matchType}] "${d.candidateTitle}" (${d.candidateId}) matches "${d.matchedWithTitle}" (${d.matchedWithId}) ${d.isSelfMatch ? '[SELF-MATCH BUG]' : ''}`);
    }
  }

  // 4. Scan Live Gigs for duplicates
  const detectedLiveGigDuplicates = [];
  const seenLiveExtIds = new Map();
  const seenLiveUrls = new Map();
  const seenLiveTitleOrg = new Map();

  for (const g of liveGigs) {
    const extId = g.external_gig_id;
    const canonical = normalizeCanonicalUrl(g.origin_url);
    const titleKey = normalizeTextKey(g.title);
    const orgKey = normalizeTextKey(g.organization || '');
    const titleOrgKey = titleKey && orgKey ? `${titleKey}__${orgKey}` : null;

    let matched = null;
    let matchType = '';

    if (extId && seenLiveExtIds.has(extId)) {
      matched = seenLiveExtIds.get(extId);
      matchType = `External ID (${extId})`;
    } else if (canonical && seenLiveUrls.has(canonical)) {
      matched = seenLiveUrls.get(canonical);
      matchType = `Canonical URL (${canonical})`;
    } else if (titleOrgKey && seenLiveTitleOrg.has(titleOrgKey)) {
      matched = seenLiveTitleOrg.get(titleOrgKey);
      matchType = `Title + Org (${g.title})`;
    }

    if (matched) {
      detectedLiveGigDuplicates.push({
        gigId: g.id,
        gigTitle: g.title,
        matchedWithId: matched.id,
        matchedWithTitle: matched.title,
        matchType
      });
    } else {
      if (extId) seenLiveExtIds.set(extId, g);
      if (canonical) seenLiveUrls.set(canonical, g);
      if (titleOrgKey) seenLiveTitleOrg.set(titleOrgKey, g);
    }
  }

  console.log('\n--- Live Gigs Duplicate Scan Results ---');
  if (detectedLiveGigDuplicates.length === 0) {
    console.log('✓ No duplicate gigs detected in public.gigs.');
  } else {
    console.log(`Found ${detectedLiveGigDuplicates.length} duplicate gig(s) in public.gigs:`);
    for (const d of detectedLiveGigDuplicates) {
      console.log(` - [${d.matchType}] "${d.gigTitle}" (${d.gigId}) matches "${d.matchedWithTitle}" (${d.matchedWithId})`);
    }
  }

  return {
    candidateDuplicates: detectedCandidateDuplicates,
    liveGigDuplicates: detectedLiveGigDuplicates
  };
}

scanDuplicates().catch(console.error);
