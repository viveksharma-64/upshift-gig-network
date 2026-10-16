/**
 * Client-Side Discovery Candidate Store & Approval Gateway
 * Provides reactive candidate management and safe approval transitions into public.gigs.
 */

import { supabase } from '../lib/supabase.js';
import { CANDIDATE_STATUS, ACTIVITY_STATUS, normalizeActivityStatus, createCandidate } from './types.js';
import { defaultNotificationService } from '../server/notifications.js';
import { normalizeCanonicalUrl, normalizeTextKey, generateDeduplicationKey } from '../server/deduplication.js';

import { normalizeHtmlToText } from './textNormalizer.js';
import { analyzeUrlStructure } from './urlClassifier.js';

// Embedded initial candidates from local discovery store
import candidatesData from '../../data/candidates.json' with { type: 'json' };

const LOCAL_STORAGE_KEY = 'upshift_discovery_candidates';
const LOCAL_STORAGE_AUTHORITATIVE_KEY = 'upshift_candidates_is_authoritative';

/**
 * Loads candidates from localStorage (if authoritative or local mode), or Supabase
 * @returns {Array<object>}
 */
export function loadLocalCandidates() {
  if (typeof window === 'undefined') {
    return Array.isArray(candidatesData) ? candidatesData.map(createCandidate) : [];
  }

  const hasRemoteConfig = Boolean(typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SUPABASE_URL : false);

  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    const isAuthoritative = localStorage.getItem(LOCAL_STORAGE_AUTHORITATIVE_KEY) === 'true';
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Return stored candidates if they were verified authoritative, or if we are not in remote-configured mode
        if (isAuthoritative || !hasRemoteConfig) {
          return parsed.map(createCandidate);
        }
      }
    }
  } catch {
    // fallback to initial data
  }

  // Only fallback to static mock fixture data when remote Supabase backend is not configured
  if (!hasRemoteConfig && Array.isArray(candidatesData) && candidatesData.length > 0) {
    const initial = candidatesData.map(createCandidate);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(initial));
    } catch {
      // storage quota fallback
    }
    return initial;
  }

  return [];
}

/**
 * Persists candidates state to browser storage
 */
export function saveLocalCandidates(list, isAuthoritative = false) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
    if (isAuthoritative) {
      localStorage.setItem(LOCAL_STORAGE_AUTHORITATIVE_KEY, 'true');
    }
  } catch (err) {
    console.warn('Failed to save candidates to localStorage:', err);
  }
}

/**
 * Safely reconciles existing local candidates with incoming remote records.
 * - Merges matching records by stable candidate ID or deduplication key.
 * - Uses remote values for authoritative crawled fields (title, description, rates, etc.).
 * - Strictly preserves local review status (approved, rejected, etc.) and review metadata
 *   unless the remote record contains a valid newer review decision.
 * - If options.authoritativeRemote is true, remote candidate listings define the authoritative queue;
 *   unmatched local sample/fixture records are excluded.
 * - Preserves all existing local candidates when the remote response is partial.
 * - Appends newly discovered remote candidates without duplication.
 * - Never truncates, empties, or reduces the candidate queue.
 *
 * @param {Array<object>} existingLocal
 * @param {Array<object>} incomingRemote
 * @param {object} [options]
 * @returns {Array<object>} Reconciled candidates list
 */
export function reconcileCandidates(existingLocal = [], incomingRemote = [], options = {}) {
  const localList = Array.isArray(existingLocal) ? existingLocal : [];
  if (!Array.isArray(incomingRemote) || incomingRemote.length === 0) {
    return localList;
  }

  const localById = new Map();
  const localByDedupKey = new Map();

  for (const loc of localList) {
    if (loc && loc.id) {
      localById.set(loc.id, loc);
    }
    const key = generateDeduplicationKey(loc);
    if (key) {
      localByDedupKey.set(key, loc);
    }
  }

  const matchedLocalIds = new Set();
  const matchedRemoteIds = new Set();
  const mergedMap = new Map();

  for (const rawRem of incomingRemote) {
    if (!rawRem) continue;
    const rem = createCandidate(rawRem);

    // 1. Match by candidate ID or deduplication key
    let loc = null;
    if (rem.id && localById.has(rem.id)) {
      loc = localById.get(rem.id);
    } else {
      const remKey = generateDeduplicationKey(rem);
      if (remKey && localByDedupKey.has(remKey)) {
        loc = localByDedupKey.get(remKey);
      }
    }

    if (loc) {
      matchedLocalIds.add(loc.id);
      if (rem.id) matchedRemoteIds.add(rem.id);

      // Check whether remote has a valid, newer review state
      const localIsReviewed = loc.status && loc.status !== CANDIDATE_STATUS.PENDING_REVIEW;
      const remoteIsReviewed = rem.status && rem.status !== CANDIDATE_STATUS.PENDING_REVIEW;

      let useRemoteReview = false;
      if (remoteIsReviewed) {
        if (!localIsReviewed) {
          useRemoteReview = true;
        } else if (rem.reviewed_at && loc.reviewed_at) {
          const remTime = new Date(rem.reviewed_at).getTime();
          const locTime = new Date(loc.reviewed_at).getTime();
          if (!isNaN(remTime) && !isNaN(locTime) && remTime > locTime) {
            useRemoteReview = true;
          }
        } else if (rem.reviewed_at && !loc.reviewed_at) {
          useRemoteReview = true;
        }
      }

      // Merge: Remote is authoritative for metadata/crawled fields,
      // while local review decision/history is preserved unless remote is demonstrably newer.
      const merged = {
        ...loc,
        ...rem,
        id: loc.id || rem.id,
        first_discovered_at: loc.first_discovered_at || rem.first_discovered_at,
        status: useRemoteReview ? rem.status : loc.status,
        admin_notes: useRemoteReview ? (rem.admin_notes ?? loc.admin_notes) : (loc.admin_notes ?? rem.admin_notes),
        rejection_reason: useRemoteReview ? (rem.rejection_reason ?? loc.rejection_reason) : (loc.rejection_reason ?? rem.rejection_reason),
        reviewed_by: useRemoteReview ? (rem.reviewed_by ?? loc.reviewed_by) : (loc.reviewed_by ?? rem.reviewed_by),
        reviewed_at: useRemoteReview ? (rem.reviewed_at ?? loc.reviewed_at) : (loc.reviewed_at ?? rem.reviewed_at),
        published_gig_id: useRemoteReview ? (rem.published_gig_id ?? loc.published_gig_id) : (loc.published_gig_id ?? rem.published_gig_id)
      };

      const normalizedMerged = createCandidate(merged);
      mergedMap.set(loc.id, normalizedMerged);
      if (rem.id && rem.id !== loc.id) {
        mergedMap.set(rem.id, normalizedMerged);
      }
    } else {
      // Brand new remote candidate
      if (rem.id) {
        matchedRemoteIds.add(rem.id);
      }
      mergedMap.set(rem.id, rem);
    }
  }

  const result = [];
  const emittedIds = new Set();

  // If authoritativeRemote is set, incomingRemote is the complete authoritative set from production DB.
  // We emit every record from incomingRemote (with merged local review metadata where matched),
  // but do NOT append obsolete local sample/fixture records that never existed in the database.
  if (options && options.authoritativeRemote) {
    for (const rawRem of incomingRemote) {
      if (!rawRem || !rawRem.id) continue;
      const targetId = rawRem.id;
      const item = mergedMap.get(targetId) || createCandidate(rawRem);
      if (!emittedIds.has(item.id)) {
        result.push(item);
        emittedIds.add(item.id);
      }
    }
    return result;
  }

  // Preserve all existing local candidates, replacing matched ones with their merged version
  for (const loc of localList) {
    if (!loc || !loc.id) continue;
    if (mergedMap.has(loc.id)) {
      const merged = mergedMap.get(loc.id);
      if (!emittedIds.has(merged.id)) {
        result.push(merged);
        emittedIds.add(merged.id);
      }
    } else {
      if (!emittedIds.has(loc.id)) {
        result.push(createCandidate(loc));
        emittedIds.add(loc.id);
      }
    }
  }

  // Append newly discovered remote candidates
  for (const [id, remCandidate] of mergedMap.entries()) {
    if (!emittedIds.has(id) && !emittedIds.has(remCandidate.id)) {
      result.push(remCandidate);
      emittedIds.add(id);
      if (remCandidate.id) emittedIds.add(remCandidate.id);
    }
  }

  return result;
}

export const GIG_CANDIDATES_TABLE = 'gig_candidates';

/**
 * Resolves verified administrative authentication headers for backend API requests.
 * Checks for a live, non-expired Supabase session and attempts auto-refresh if expiring.
 *
 * @returns {Promise<{ headers: Record<string, string>, hasToken: boolean, source: string, error?: string }>}
 */
export async function getAdminAuthHeader() {
  const headers = {};

  // 1. Check for active Supabase session
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (session?.access_token) {
      const now = Math.floor(Date.now() / 1000);
      // If token is about to expire or already expired, attempt refreshing session
      if (session.expires_at && session.expires_at < now + 60) {
        try {
          const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError && refreshed?.session?.access_token) {
            headers['Authorization'] = `Bearer ${refreshed.session.access_token}`;
            return { headers, hasToken: true, source: 'supabase' };
          }
        } catch {}
      } else {
        headers['Authorization'] = `Bearer ${session.access_token}`;
        return { headers, hasToken: true, source: 'supabase' };
      }
    }
  } catch {}

  return { headers, hasToken: false, source: 'none' };
}

/**
 * Asynchronously fetches candidates from the persistent Supabase staging table (public.gig_candidates)
 * or server API (/api/candidates), synchronizing with local client cache.
 * Preserves local candidate cache if remote synchronization returns no usable records or encounters errors.
 * @param {object} [options]
 * @returns {Promise<Array<object>>} Array of candidates with sync metadata attached
 */
export async function fetchCandidateQueue(options = {}) {
  if (typeof window !== 'undefined') {
    let directSupabaseDenied = false;

    // 1. Direct Supabase query to public.gig_candidates (subject to RLS public.is_admin())
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const { data, error } = await supabase
          .from(GIG_CANDIDATES_TABLE)
          .select('*')
          .order('review_priority', { ascending: false });

        if (!error && Array.isArray(data) && data.length > 0) {
          const mapped = data.map(createCandidate);
          const currentLocal = loadLocalCandidates();
          const reconciled = reconcileCandidates(currentLocal, mapped, { authoritativeRemote: true });
          saveLocalCandidates(reconciled, true);
          reconciled.syncSuccess = true;
          reconciled.syncStatus = 'success';
          reconciled.syncSource = 'supabase';
          reconciled.isFallback = false;
          return reconciled;
        } else if (error && (error.code === '42501' || /permission denied/i.test(error.message))) {
          directSupabaseDenied = true;
        }
      }
    } catch {
      // Direct staging query unavailable, continue to /api/candidates fallback
    }

    // 2. Fall back to /api/candidates server endpoint
    if (typeof fetch === 'function') {
      try {
        const { headers } = await getAdminAuthHeader();

        const response = await fetch('/api/candidates', { headers });
        const contentType = (response.headers && response.headers.get('content-type')) || '';

        // Safe non-JSON guard: If server returns HTML (SPA rewrite fallback or proxy error),
        // do not attempt response.json() which throws SyntaxError.
        if (contentType && !contentType.includes('application/json')) {
          const local = loadLocalCandidates();
          local.syncSuccess = false;
          local.syncStatus = 'warning';
          local.syncSource = 'local_fallback';
          local.statusCode = response.status;
          local.syncMessage = `Remote candidate endpoint returned non-JSON response (${contentType.split(';')[0] || 'text/html'}). Preserved ${local.length} existing candidate listings.`;
          local.isFallback = true;
          return local;
        }

        if (response.ok) {
          let data = null;
          try {
            data = await response.json();
          } catch (jsonErr) {
            const local = loadLocalCandidates();
            local.syncSuccess = false;
            local.syncStatus = 'warning';
            local.syncSource = 'local_fallback';
            local.syncMessage = `Remote candidate endpoint returned invalid JSON (${jsonErr.message}). Preserved ${local.length} existing candidate listings.`;
            local.isFallback = true;
            return local;
          }

          const candidateList = Array.isArray(data)
            ? data
            : (Array.isArray(data?.candidates)
              ? data.candidates
              : (Array.isArray(data?.data) ? data.data : []));

          if (candidateList.length > 0) {
            const mapped = candidateList.map(createCandidate);
            const currentLocal = loadLocalCandidates();
            const reconciled = reconcileCandidates(currentLocal, mapped);
            saveLocalCandidates(reconciled, true);
            reconciled.syncSuccess = true;
            reconciled.syncStatus = 'success';
            reconciled.syncSource = 'api';
            reconciled.isFallback = false;
            return reconciled;
          } else {
            const local = loadLocalCandidates();
            local.syncSuccess = false;
            local.syncStatus = 'warning';
            local.syncSource = 'local_fallback';
            local.syncMessage = `Remote server candidate store returned 0 usable listings. Preserved ${local.length} existing candidate listings.`;
            local.isFallback = true;
            return local;
          }
        } else if (response.status === 401) {
          let errDetail = 'Administrator authentication required.';
          if (contentType.includes('application/json')) {
            try {
              const errJson = await response.json();
              if (errJson.error) errDetail = errJson.error;
            } catch {}
          }
          const local = loadLocalCandidates();
          local.syncSuccess = false;
          local.syncStatus = 'warning';
          local.syncSource = 'local_fallback';
          local.statusCode = 401;
          local.syncMessage = `Remote store requires administrator authentication (${errDetail}). Please sign in as an administrator. Preserved ${local.length} existing candidate listings.`;
          local.isFallback = true;
          return local;
        } else if (response.status === 403) {
          let errDetail = 'Insufficient privileges.';
          if (contentType.includes('application/json')) {
            try {
              const errJson = await response.json();
              if (errJson.error) errDetail = errJson.error;
            } catch {}
          }
          const local = loadLocalCandidates();
          local.syncSuccess = false;
          local.syncStatus = 'warning';
          local.syncSource = 'local_fallback';
          local.statusCode = 403;
          local.syncMessage = `Remote store access forbidden (${errDetail}). Only verified administrators can access the review queue. Preserved ${local.length} existing candidate listings.`;
          local.isFallback = true;
          return local;
        } else {
          let errDetail = '';
          if (contentType.includes('application/json')) {
            try {
              const errJson = await response.json();
              if (errJson.error) errDetail = `: ${errJson.error}`;
            } catch {}
          }
          const local = loadLocalCandidates();
          local.syncSuccess = false;
          local.syncStatus = 'error';
          local.syncSource = 'local_fallback';
          local.statusCode = response.status;
          local.syncMessage = `Remote candidate store returned error HTTP ${response.status}${errDetail}. Preserved ${local.length} existing candidate listings.`;
          local.isFallback = true;
          return local;
        }
      } catch (err) {
        const local = loadLocalCandidates();
        local.syncSuccess = false;
        local.syncStatus = 'warning';
        local.syncSource = 'local_fallback';
        local.syncMessage = `Network error connecting to candidate store (${err.message || 'connection failed'}). Preserved ${local.length} existing candidate listings.`;
        local.isFallback = true;
        return local;
      }
    }

    if (directSupabaseDenied) {
      const local = loadLocalCandidates();
      local.syncSuccess = false;
      local.syncStatus = 'warning';
      local.syncSource = 'local_fallback';
      local.syncMessage = `Remote table access restricted (permission denied). Preserved ${local.length} existing candidate listings.`;
      local.isFallback = true;
      return local;
    }
  }

  const local = loadLocalCandidates();
  local.syncSuccess = true;
  local.syncStatus = 'success';
  local.syncSource = 'local';
  local.isFallback = false;
  return local;
}

/**
 * Synchronizes candidate updates back to the persistent store (public.gig_candidates or /api/candidates)
 * @param {object} candidate
 * @returns {Promise<boolean>}
 */
export async function syncCandidateToServer(candidate) {
  if (typeof window === 'undefined') return false;

  // 1. Direct Supabase staging update (subject to RLS public.is_admin())
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      const { error } = await supabase
        .from(GIG_CANDIDATES_TABLE)
        .upsert(candidate, { onConflict: 'id' });
      if (!error) return true;
    }
  } catch {
    // Direct staging update unavailable, fall back to API
  }

  // 2. Server API fallback (/api/candidates)
  if (typeof fetch === 'function') {
    try {
      const { headers } = await getAdminAuthHeader();
      headers['Content-Type'] = 'application/json';

      const res = await fetch('/api/candidates', {
        method: 'POST',
        headers,
        body: JSON.stringify(candidate)
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  return false;
}


/**
 * Validates that candidate has required fields and verified approval before publishing
 * @param {object} candidate
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateForPublishing(candidate) {
  if (!candidate) {
    return { valid: false, error: 'Candidate data is required.' };
  }

  // 1. Reject duplicate listings unconditionally
  if (candidate.is_duplicate || candidate.status === CANDIDATE_STATUS.DUPLICATE) {
    return { valid: false, error: 'Cannot publish duplicate listing.' };
  }

  // 2. Approval Isolation: Only explicitly approved candidates can be published!
  if (candidate.status !== CANDIDATE_STATUS.APPROVED) {
    return {
      valid: false,
      error: `Cannot publish candidate with status '${candidate.status || 'unknown'}'. Candidate must be explicitly approved by an administrator before publication.`
    };
  }

  // 2b. Relevance Gate: Irrelevant candidates cannot bypass publishing
  if (candidate.is_relevant === false) {
    return { valid: false, error: 'Cannot publish candidate marked irrelevant to UpShift tracks.' };
  }

  // 2c. Gig Qualification Gate (Phase 2A & Acceptance Criteria)
  if (candidate.is_gig === false || candidate.is_conventional_job === true || candidate.gig_type === 'conventional_job') {
    return { valid: false, error: 'Cannot publish conventional job vacancy or non-gig opportunity.' };
  }
  if (candidate.gig_type === 'uncertain' && !candidate.override_uncertain_activity) {
    return { valid: false, error: 'Cannot publish candidate with uncertain gig classification without explicit admin review verification.' };
  }

  // 3. Mandatory Referral Gate (FRD Section 15, REF-03 & Scenario T12)
  if (candidate.referral_required) {
    const hasReferral = Boolean(
      (candidate.referral_id && candidate.referral_id.trim().length > 0) ||
      (candidate.referral_url && candidate.referral_url.trim().length > 0)
    );
    if (!hasReferral) {
      return {
        valid: false,
        error: 'Publication blocked: A valid referral ID or referral link is marked mandatory for this opportunity but was not supplied (REF-03).'
      };
    }
  }

  // 4. Activity status: Require 'Active' by default. Stopped/Paused are blocked unconditionally.
  // Needs Review is blocked unless an explicit override flag and audit note are provided.
  const normActivity = normalizeActivityStatus(candidate.activity_status);
  if (normActivity === ACTIVITY_STATUS.STOPPED) {
    return { valid: false, error: 'Cannot publish inactive listing: listing is stopped or closed.' };
  }
  if (normActivity === ACTIVITY_STATUS.PAUSED) {
    return { valid: false, error: 'Cannot publish paused listing. Opportunity is temporarily unavailable.' };
  }
  if (normActivity === ACTIVITY_STATUS.NEEDS_REVIEW) {
    const hasOverride = Boolean(candidate.override_uncertain_activity);
    const hasNote = Boolean(candidate.admin_notes && candidate.admin_notes.trim().length >= 5);
    if (!hasOverride || !hasNote) {
      return {
        valid: false,
        error: 'Cannot publish candidate with "Needs Review" status without explicit admin override (override_uncertain_activity: true) and audit note in admin_notes.'
      };
    }
  } else if (normActivity !== ACTIVITY_STATUS.ACTIVE) {
    return {
      valid: false,
      error: `Invalid or unrecognized activity status '${candidate.activity_status}'. Only active listings (or verified Needs Review overrides) can be published.`
    };
  }

  // 4b. Link Status Gate (Reject closed or failed destinations)
  if (candidate.link_status === 'closed' || candidate.link_status === 'failed') {
    return { valid: false, error: `Cannot publish candidate: Opportunity destination link is confirmed ${candidate.link_status}.` };
  }

  // 5. Validate title
  if (!candidate.title || candidate.title.trim().length < 5) {
    return { valid: false, error: 'Listing title is missing or too short.' };
  }

  // 6. Validate track_id
  const validModules = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
  if (!validModules.includes(candidate.track_id)) {
    return { valid: false, error: `Invalid track "${candidate.track_id}". Must be one of M1-M6.` };
  }

  // 7. Validate URL, Reject Generic Landing Pages & Fabricated Domains (Phase 2B & 2C)
  const url = candidate.application_url || candidate.opportunity_url || candidate.original_url;
  if (!url || !url.startsWith('http')) {
    return { valid: false, error: 'A valid HTTP(S) application or source URL is required.' };
  }

  // Reject confirmed placeholder or nonexistent test domains
  const KNOWN_FABRICATED_DOMAINS = [
    'growthhire.co',
    'creativegigs.io',
    'nocodeworks.com',
    'remotevideo.org',
    'devmatch.tech',
    'dataworks.ai'
  ];
  if (KNOWN_FABRICATED_DOMAINS.some(d => url.includes(d))) {
    return { valid: false, error: 'Cannot publish candidate: Opportunity URL points to confirmed placeholder or nonexistent test domain.' };
  }

  const structure = analyzeUrlStructure(url);
  if (structure.isHomepage) {
    return { valid: false, error: 'Cannot publish candidate: URL points to a generic company homepage rather than a specific opportunity.' };
  }
  if (structure.isSearchPage) {
    return { valid: false, error: 'Cannot publish candidate: URL points to a general job search or category directory rather than a specific opportunity.' };
  }

  return { valid: true };
}

/**
 * Re-checks opportunity accessibility immediately before publication
 * (FRD Section 11 VER-08, Section 16 PUB-02, and Scenario T11)
 *
 * @param {object} candidate
 * @param {object} [options]
 * @returns {Promise<{ healthy: boolean, reason?: string, candidate: object }>}
 */
export async function recheckOpportunityAvailability(candidate, options = {}) {
  // Allow injected probe for testing/mocking
  if (typeof options.recheckProbe === 'function') {
    const probeRes = await options.recheckProbe(candidate);
    if (!probeRes.healthy) {
      return {
        healthy: false,
        reason: probeRes.reason || 'Source indicated opportunity has been closed or removed.',
        candidate: {
          ...candidate,
          activity_status: ACTIVITY_STATUS.STOPPED,
          last_checked_at: new Date().toISOString(),
          activity_evidence: [
            ...(candidate.activity_evidence || []),
            `Pre-publish recheck failed: ${probeRes.reason}`
          ]
        }
      };
    }
    return { healthy: true, candidate };
  }

  // If candidate already stopped or paused
  const norm = normalizeActivityStatus(candidate.activity_status);
  if (norm === ACTIVITY_STATUS.STOPPED || norm === ACTIVITY_STATUS.PAUSED) {
    return {
      healthy: false,
      reason: `Listing is currently marked as ${norm}.`,
      candidate
    };
  }

  const targetUrl = candidate.application_url || candidate.original_url;
  if (!targetUrl || !targetUrl.startsWith('http')) {
    return { healthy: false, reason: 'Invalid or missing target URL.', candidate };
  }

  // If environment supports fetch, perform live HEAD/GET probe
  if (typeof fetch === 'function' && !options.skipNetworkProbe) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(targetUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UpShiftBot/1.0' }
      });
      clearTimeout(timeout);

      if (res.status === 404 || res.status === 410) {
        return {
          healthy: false,
          reason: `Target URL returned HTTP ${res.status} (Not Found / Gone).`,
          candidate: {
            ...candidate,
            activity_status: ACTIVITY_STATUS.STOPPED,
            last_checked_at: new Date().toISOString()
          }
        };
      }

      if (res.ok) {
        const bodyText = (await res.text()).slice(0, 5000).toLowerCase();
        if (
          bodyText.includes('this job is no longer available') ||
          bodyText.includes('position has been filled') ||
          bodyText.includes('job posting expired') ||
          bodyText.includes('applications are now closed') ||
          bodyText.includes('no longer accepting applications') ||
          bodyText.includes('this position is closed')
        ) {
          return {
            healthy: false,
            reason: 'Target page content indicates opportunity is closed or expired.',
            candidate: {
              ...candidate,
              activity_status: ACTIVITY_STATUS.STOPPED,
              last_checked_at: new Date().toISOString()
            }
          };
        }
      }
    } catch (err) {
      // Catch definitive reachability failures (NXDOMAIN, ENOTFOUND, DNS failure)
      const isDnsOrNetworkFailure = err.code === 'ENOTFOUND' ||
        err.message?.includes('ENOTFOUND') ||
        err.message?.includes('fetch failed') ||
        err.message?.includes('getaddrinfo') ||
        err.cause?.code === 'ENOTFOUND';

      if (isDnsOrNetworkFailure) {
        return {
          healthy: false,
          reason: `Target opportunity link failed reachability (${err.message || 'Domain non-existent or unreachable (NXDOMAIN)'}).`,
          candidate: {
            ...candidate,
            link_status: 'failed',
            activity_status: ACTIVITY_STATUS.STOPPED,
            health_check_error: err.message || 'fetch failed',
            last_checked_at: new Date().toISOString()
          }
        };
      }
    }
  }

  return { healthy: true, candidate };
}

// Active publishing mutex map to prevent race conditions during concurrent worker publishing
const activePublishLocks = new Map();

/**
 * Publishes an approved candidate into the live public.gigs opportunities directory.
 * Enforces:
 * 1. Admin authorization check
 * 2. Mandatory referral validation gate
 * 3. Pre-publication availability recheck (PUB-02)
 * 4. Pre-publication duplicate check against public.gigs (Rules: External ID, Canonical URL, Content Similarity)
 * 5. Idempotent in-place updates (never inserts duplicate records for already published gigs)
 * 6. Concurrency lock to prevent simultaneous worker duplicate inserts
 *
 * @param {object} candidate
 * @param {object|string} [userProfileOrReviewer]
 * @param {object} [options]
 * @returns {Promise<{ success: boolean, publishedGig?: object, error?: string, candidate?: object, updated?: boolean, isDuplicate?: boolean }>}
 */
export async function publishCandidateToGigs(candidate, userProfileOrReviewer = null, options = {}) {
  let effectiveReviewer = userProfileOrReviewer;
  let effectiveOptions = options;
  if (userProfileOrReviewer && typeof userProfileOrReviewer === 'object' && !userProfileOrReviewer.role && (userProfileOrReviewer.skipRecheck !== undefined || userProfileOrReviewer.dryRun !== undefined || userProfileOrReviewer.client !== undefined || userProfileOrReviewer.dbClient !== undefined || userProfileOrReviewer.recheckAvailability !== undefined)) {
    effectiveOptions = userProfileOrReviewer;
    effectiveReviewer = null;
  }

  // 1. Authorization Guard: Reject non-admin callers early
  if (effectiveReviewer && typeof effectiveReviewer === 'object' && effectiveReviewer.role) {
    if (effectiveReviewer.role !== 'admin') {
      const err = `Unauthorized: User role '${effectiveReviewer.role}' is not permitted to publish opportunities. Only verified administrators can publish.`;
      defaultNotificationService.notifyPublishFailure(candidate, err);
      return { success: false, error: err };
    }
  }

  // 2. Initial validation check (enforces approval isolation & mandatory referral)
  const val = validateForPublishing(candidate);
  if (!val.valid) {
    defaultNotificationService.notifyPublishFailure(candidate, val.error);
    return { success: false, error: val.error };
  }

  // 3. Concurrency deduplication: Wait if this candidate is currently in-flight
  const originUrl = candidate.application_url || candidate.original_url || '';
  const externalGigId = candidate.external_gig_id || (candidate.source_listing_id ? `DISC-${candidate.source_listing_id}` : `DISC-${Date.now().toString().slice(-6)}`);
  const lockKey = externalGigId || normalizeCanonicalUrl(originUrl);

  if (activePublishLocks.has(lockKey)) {
    try {
      return await activePublishLocks.get(lockKey);
    } catch {
      // Retry if previous attempt failed
    }
  }

  const publishExecution = (async () => {
    const dbClient = effectiveOptions.client || effectiveOptions.dbClient || supabase;

    // Real Pre-Publication Availability Recheck (VER-08 & PUB-02)
    if (!effectiveOptions.skipRecheck && effectiveOptions.recheckAvailability !== false) {
      const recheck = await recheckOpportunityAvailability(candidate, effectiveOptions);
      if (!recheck.healthy) {
        const failureReason = `Pre-publication verification failed: ${recheck.reason} (PUB-02). Publication blocked.`;
        defaultNotificationService.notifyPublishFailure(candidate, failureReason);
        return {
          success: false,
          error: failureReason,
          candidate: recheck.candidate
        };
      }
    }

    // 4. Pre-Publication Deduplication Check against live gigs dataset
    let existingMatch = null;
    try {
      const { data: existingGigs } = await dbClient.from('gigs').select('*');
      if (Array.isArray(existingGigs) && existingGigs.length > 0) {
        const targetCanonical = normalizeCanonicalUrl(originUrl);
        const targetTitleKey = normalizeTextKey(candidate.title);
        const targetOrgKey = normalizeTextKey(candidate.organization);

        for (const exist of existingGigs) {
          // Rule 1: External Gig ID
          if (exist.external_gig_id && (exist.external_gig_id === externalGigId || (candidate.source_listing_id && exist.external_gig_id === `DISC-${candidate.source_listing_id}`))) {
            existingMatch = exist;
            break;
          }
          // Rule 2: Canonical URL
          const existCanonical = normalizeCanonicalUrl(exist.origin_url);
          if (targetCanonical && existCanonical && targetCanonical === existCanonical) {
            existingMatch = exist;
            break;
          }
          // Rule 3: Content similarity (Title + Track)
          const existTitleKey = normalizeTextKey(exist.title);
          if (targetTitleKey && existTitleKey && targetTitleKey === existTitleKey && exist.track_id === candidate.track_id) {
            existingMatch = exist;
            break;
          }
        }
      }
    } catch (err) {
      console.warn('[publishCandidateToGigs] Pre-publication duplicate check notice:', err.message);
    }

    // 5. If duplicate / already published, update existing record in place
    if (existingMatch) {
      console.info(`[publishCandidateToGigs] Updating existing published gig in place (${existingMatch.id}) - idempotent publish.`);
      const updatePayload = {
        title: normalizeHtmlToText(candidate.title),
        track_id: candidate.track_id,
        payment_amount: candidate.payment_amount || existingMatch.payment_amount || 'Unspecified',
        compensation_type: candidate.compensation_type || existingMatch.compensation_type || 'hourly',
        min_amount: parseFloat(candidate.min_amount) || existingMatch.min_amount || 0,
        max_amount: parseFloat(candidate.max_amount) || existingMatch.max_amount || 0,
        currency: candidate.currency || existingMatch.currency || 'USD',
        priority: candidate.review_priority >= 75 ? 'Featured' : (existingMatch.priority || 'Standard'),
        is_featured: candidate.review_priority >= 75 || Boolean(existingMatch.is_featured),
        short_description: normalizeHtmlToText((candidate.short_description || candidate.description || existingMatch.short_description || `${candidate.title} at ${candidate.organization || 'Client'}`).slice(0, 200)),
        overview: normalizeHtmlToText(candidate.overview || candidate.description || existingMatch.overview || ''),
        responsibilities: normalizeHtmlToText(candidate.responsibilities || existingMatch.responsibilities || ''),
        requirements: normalizeHtmlToText(candidate.requirements || existingMatch.requirements || ''),
        status: 'Active',
        updated_at: new Date().toISOString()
      };

      try {
        const { data, error } = await dbClient.from('gigs').update(updatePayload).eq('id', existingMatch.id).select();
        if (error) {
          defaultNotificationService.notifyPublishFailure(candidate, error.message);
          return { success: false, error: error.message };
        }
        const published = (data && data.length > 0) ? data[0] : { ...existingMatch, ...updatePayload };
        defaultNotificationService.notifyPublished(published, candidate);
        return { success: true, publishedGig: published, updated: true, isDuplicate: true };
      } catch (err) {
        defaultNotificationService.notifyPublishFailure(candidate, err.message);
        return { success: false, error: err.message };
      }
    }

    // 6. Otherwise insert new gig compatible with production public.gigs schema
    const authenticTargetUrl = candidate.application_url || candidate.opportunity_url || candidate.original_url || originUrl;
    const gigToInsert = {
      external_gig_id: externalGigId,
      title: normalizeHtmlToText(candidate.title),
      track_id: candidate.track_id,
      payment_amount: candidate.payment_amount || 'Unspecified',
      compensation_type: candidate.compensation_type || 'hourly',
      min_amount: parseFloat(candidate.min_amount) || 0,
      max_amount: parseFloat(candidate.max_amount) || 0,
      currency: candidate.currency || 'USD',
      priority: candidate.review_priority >= 75 ? 'Featured' : 'Standard',
      is_featured: candidate.review_priority >= 75,
      is_local_business: Boolean(candidate.is_local_business),
      origin_url: authenticTargetUrl,
      short_description: normalizeHtmlToText((candidate.short_description || candidate.description || `${candidate.title} at ${candidate.organization || 'Client'}`).slice(0, 200)),
      overview: normalizeHtmlToText(candidate.overview || candidate.description || ''),
      responsibilities: normalizeHtmlToText(candidate.responsibilities || ''),
      requirements: normalizeHtmlToText(candidate.requirements || ''),
      posted_at: new Date().toISOString().split('T')[0],
      status: 'Active'
    };

    try {
      const { data, error } = await dbClient.from('gigs').insert([gigToInsert]).select();
      if (error) {
        // If error indicates an unknown column in schema cache, sanitize to known core schema and retry
        if (error.message && error.message.includes('schema cache')) {
          const coreGigsColumns = new Set([
            'external_gig_id', 'title', 'track_id', 'payment_amount', 'compensation_type',
            'min_amount', 'max_amount', 'currency', 'priority', 'is_featured',
            'is_local_business', 'posted_at', 'origin_url', 'short_description',
            'overview', 'responsibilities', 'deliverables', 'requirements', 'proof_spec', 'status'
          ]);
          const sanitized = {};
          for (const [k, v] of Object.entries(gigToInsert)) {
            if (coreGigsColumns.has(k)) sanitized[k] = v;
          }
          const retryRes = await dbClient.from('gigs').insert([sanitized]).select();
          if (retryRes.error) {
            defaultNotificationService.notifyPublishFailure(candidate, retryRes.error.message);
            return { success: false, error: retryRes.error.message };
          }
          const published = retryRes.data && retryRes.data.length > 0 ? retryRes.data[0] : null;
          defaultNotificationService.notifyPublished(published, candidate);
          return { success: true, publishedGig: published, inserted: true };
        }

        defaultNotificationService.notifyPublishFailure(candidate, error.message);
        return { success: false, error: error.message };
      }
      const published = data && data.length > 0 ? data[0] : null;

      // Dispatches NOT-01 publish notification
      defaultNotificationService.notifyPublished(published, candidate);

      return { success: true, publishedGig: published, inserted: true };
    } catch (err) {
      defaultNotificationService.notifyPublishFailure(candidate, err.message);
      return { success: false, error: err.message };
    }
  })();

  activePublishLocks.set(lockKey, publishExecution);
  try {
    return await publishExecution;
  } finally {
    activePublishLocks.delete(lockKey);
  }
}

/**
 * Triggers a live discovery cycle via the protected backend endpoint (/api/discovery/run).
 * On success, saves newly discovered candidates into the store and updates local storage.
 * On failure or unauthorized, strictly preserves existing candidates.
 *
 * @param {object} [options]
 * @returns {Promise<{
 *   success: boolean,
 *   counts?: {
 *     fetched: number,
 *     relevant: number,
 *     rejected: number,
 *     duplicate: number,
 *     uncertain: number,
 *     newly_saved: number,
 *     updated: number,
 *     total_pending: number,
 *     total_store: number
 *   },
 *   candidates?: Array<object>,
 *   error?: string,
 *   statusCode?: number
 * }>}
 */
export async function runLiveDiscovery(options = {}) {
  if (typeof fetch !== 'function') {
    return { success: false, error: 'Network fetch is not available in current environment.' };
  }

  const { headers, hasToken } = await getAdminAuthHeader();

  if (!hasToken) {
    return {
      success: false,
      statusCode: 401,
      error: 'Administrator authentication required. Please sign in as an administrator to run discovery.'
    };
  }

  try {
    const response = await fetch('/api/discovery/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(options)
    });

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson.error) errorMsg = errJson.error;
      } catch {}

      if (response.status === 401) {
        errorMsg = `Administrator authentication required: ${errorMsg}. Please sign in as an administrator.`;
      } else if (response.status === 403) {
        errorMsg = `Forbidden: ${errorMsg}. Only verified administrators can trigger discovery.`;
      }
      return { success: false, error: errorMsg, statusCode: response.status };
    }

    const data = await response.json();

    // Handle asynchronous job acceptance (HTTP 202 Accepted)
    if (response.status === 202 || (data.success && data.status === 'pending')) {
      return {
        success: true,
        isAsync: true,
        jobId: data.jobId,
        status: data.status || 'pending',
        message: data.message || `Discovery job ${data.jobId} queued successfully.`,
        counts: data.counts || null,
        candidates: loadLocalCandidates()
      };
    }

    if (data.success && Array.isArray(data.candidates)) {
      const mapped = data.candidates.map(createCandidate);
      const currentLocal = loadLocalCandidates();
      const reconciled = reconcileCandidates(currentLocal, mapped);
      saveLocalCandidates(reconciled);
      return {
        success: true,
        jobId: data.jobId || null,
        counts: data.counts || {
          fetched: mapped.length,
          relevant: mapped.length,
          rejected: 0,
          duplicate: 0,
          uncertain: 0,
          newly_saved: mapped.length,
          updated: 0,
          total_pending: reconciled.filter(c => c.status === CANDIDATE_STATUS.PENDING_REVIEW).length,
          total_store: reconciled.length
        },
        candidates: reconciled
      };
    }

    return {
      success: false,
      error: data.error || 'Invalid response format from discovery service.'
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Discovery endpoint unreachable.'
    };
  }
}

/**
 * Fetches operational status and schedule observability metrics
 * @returns {Promise<object>}
 */
export async function fetchOperationalStatus() {
  const fallback = {
    last_discovery: null,
    last_health_check: null,
    next_schedules: {
      daily_health_check: {
        cron: '0 2 * * *',
        utc_time: '02:00 UTC daily',
        description: 'Daily automated opportunity and source health verification'
      },
      discovery_cycle: {
        cron: '0 */12 * * *',
        utc_time: '00:00 & 12:00 UTC (every 12 hours)',
        description: 'Automated candidate discovery across permitted feeds and APIs'
      }
    },
    published_gig_metrics: { active: 0, paused: 0, stopped: 0, needs_review: 0, total: 0 }
  };

  if (typeof fetch !== 'function') return fallback;

  try {
    const { headers, hasToken } = await getAdminAuthHeader();
    if (hasToken) {
      const res = await fetch('/api/discovery/status', { headers });
      const ct = (res.headers && res.headers.get('content-type')) || '';
      if (res.ok && (!ct || ct.includes('application/json'))) {
        try {
          const data = await res.json();
          if (data.success) {
            if (data.published_gig_metrics && typeof data.published_gig_metrics.total !== 'number') {
              const m = data.published_gig_metrics;
              m.total = (m.active || 0) + (m.paused || 0) + (m.stopped || 0) + (m.needs_review || 0);
            }
            return data;
          }
        } catch {}
      }
    }
  } catch {}

  // Direct Supabase fallback for metrics if API route unavailable
  try {
    const { data: gigs } = await supabase.from('gigs').select('*');
    if (Array.isArray(gigs)) {
      const unique = deduplicateGigList(gigs);
      fallback.published_gig_metrics.total = unique.length;
      for (const g of unique) {
        const st = (g.status || 'Active').toLowerCase();
        if (st === 'active') fallback.published_gig_metrics.active++;
        else if (st === 'paused') fallback.published_gig_metrics.paused++;
        else if (st === 'stopped') fallback.published_gig_metrics.stopped++;
        else if (st.includes('review') || st === 'needs_review') fallback.published_gig_metrics.needs_review++;
      }
    }
  } catch {}

  return fallback;
}

/**
 * Fetches status of a specific discovery job (/api/discovery/status?jobId=...)
 * @param {string} jobId
 * @returns {Promise<object|null>} Job record or null
 */
export async function fetchJobStatus(jobId) {
  if (!jobId || typeof fetch !== 'function') return null;

  try {
    const { headers } = await getAdminAuthHeader();
    const res = await fetch(`/api/discovery/status?jobId=${encodeURIComponent(jobId)}`, { headers });
    const ct = (res.headers && res.headers.get('content-type')) || '';
    if (res.ok && (!ct || ct.includes('application/json'))) {
      const data = await res.json();
      if (data && data.success && data.job) {
        return data.job;
      }
    }
  } catch {
    // API endpoint unreachable or client offline
  }

  // Direct Supabase query fallback if API endpoint is unreachable
  try {
    const { data: job, error } = await supabase
      .from('discovery_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();
    if (!error && job) {
      return job;
    }
  } catch {}

  return null;
}



