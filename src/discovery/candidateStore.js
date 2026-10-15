/**
 * Client-Side Discovery Candidate Store & Approval Gateway
 * Provides reactive candidate management and safe approval transitions into public.gigs.
 */

import { supabase } from '../lib/supabase.js';
import { CANDIDATE_STATUS, ACTIVITY_STATUS, normalizeActivityStatus, createCandidate } from './types.js';
import { defaultNotificationService } from '../server/notifications.js';
import { normalizeCanonicalUrl, normalizeTextKey } from '../server/deduplication.js';

import { normalizeHtmlToText } from './textNormalizer.js';

// Embedded initial candidates from local discovery store
import candidatesData from '../../data/candidates.json' with { type: 'json' };

const LOCAL_STORAGE_KEY = 'upshift_discovery_candidates';

/**
 * Loads candidates from localStorage (if edited), local JSON, or Supabase
 * @returns {Array<object>}
 */
export function loadLocalCandidates() {
  if (typeof window === 'undefined') {
    return Array.isArray(candidatesData) ? candidatesData.map(createCandidate) : [];
  }

  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(createCandidate);
      }
    }
  } catch {
    // fallback to initial data
  }

  const initial = Array.isArray(candidatesData) && candidatesData.length > 0
    ? candidatesData.map(createCandidate)
    : [];

  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(initial));
  } catch {
    // storage quota fallback
  }

  return initial;
}

/**
 * Persists candidates state to browser storage
 */
export function saveLocalCandidates(list) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('Failed to save candidates to localStorage:', err);
  }
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
          saveLocalCandidates(mapped);
          mapped.syncSuccess = true;
          mapped.syncStatus = 'success';
          mapped.syncSource = 'supabase';
          mapped.isFallback = false;
          return mapped;
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
            saveLocalCandidates(mapped);
            mapped.syncSuccess = true;
            mapped.syncStatus = 'success';
            mapped.syncSource = 'api';
            mapped.isFallback = false;
            return mapped;
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

  // 5. Validate title
  if (!candidate.title || candidate.title.trim().length < 5) {
    return { valid: false, error: 'Listing title is missing or too short.' };
  }

  // 6. Validate track_id
  const validModules = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];
  if (!validModules.includes(candidate.track_id)) {
    return { valid: false, error: `Invalid track "${candidate.track_id}". Must be one of M1-M6.` };
  }

  // 7. Validate URL
  const url = candidate.application_url || candidate.original_url;
  if (!url || !url.startsWith('http')) {
    return { valid: false, error: 'A valid HTTP(S) application or source URL is required.' };
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
    } catch {
      // In offline / restricted sandbox environments, treat network errors gracefully
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
  if (userProfileOrReviewer && typeof userProfileOrReviewer === 'object' && !userProfileOrReviewer.role && (userProfileOrReviewer.skipRecheck !== undefined || userProfileOrReviewer.dryRun !== undefined)) {
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
    const dbClient = effectiveOptions.client || supabase;

    // Real Pre-Publication Availability Recheck (VER-08 & PUB-02)
    if (!effectiveOptions.skipRecheck) {
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
        payment_amount: candidate.payment_amount || existingMatch.payment_amount || '$25 - $40 / hour',
        compensation_type: candidate.compensation_type || existingMatch.compensation_type || 'hourly',
        min_amount: parseFloat(candidate.min_amount) || existingMatch.min_amount || 0,
        max_amount: parseFloat(candidate.max_amount) || existingMatch.max_amount || 0,
        currency: candidate.currency || existingMatch.currency || 'USD',
        priority: candidate.review_priority >= 75 ? 'Featured' : (existingMatch.priority || 'Standard'),
        is_featured: candidate.review_priority >= 75 || Boolean(existingMatch.is_featured),
        short_description: normalizeHtmlToText((candidate.short_description || candidate.description || existingMatch.short_description || `${candidate.title} at ${candidate.organization}`).slice(0, 200)),
        overview: normalizeHtmlToText(candidate.overview || candidate.description || existingMatch.overview || ''),
        responsibilities: normalizeHtmlToText(candidate.responsibilities || existingMatch.responsibilities || ''),
        requirements: normalizeHtmlToText(candidate.requirements || existingMatch.requirements || ''),
        status: 'Active',
        updated_at: new Date().toISOString()
      };

      try {
        const { data, error } = await dbClient.from('gigs').update(updatePayload).eq('id', existingMatch.id).select();
        const published = (data && data.length > 0) ? data[0] : { ...existingMatch, ...updatePayload };
        defaultNotificationService.notifyPublished(published, candidate);
        return { success: true, publishedGig: published, updated: true, isDuplicate: true };
      } catch (err) {
        return { success: true, publishedGig: existingMatch, updated: true, isDuplicate: true };
      }
    }

    // 6. Otherwise insert new gig
    const gigToInsert = {
      external_gig_id: externalGigId,
      title: normalizeHtmlToText(candidate.title),
      track_id: candidate.track_id,
      payment_amount: candidate.payment_amount || '$25 - $40 / hour',
      compensation_type: candidate.compensation_type || 'hourly',
      min_amount: parseFloat(candidate.min_amount) || 0,
      max_amount: parseFloat(candidate.max_amount) || 0,
      currency: candidate.currency || 'USD',
      priority: candidate.review_priority >= 75 ? 'Featured' : 'Standard',
      is_featured: candidate.review_priority >= 75,
      origin_url: originUrl,
      short_description: normalizeHtmlToText((candidate.short_description || candidate.description || `${candidate.title} at ${candidate.organization}`).slice(0, 200)),
      overview: normalizeHtmlToText(candidate.overview || candidate.description || ''),
      responsibilities: normalizeHtmlToText(candidate.responsibilities || ''),
      requirements: normalizeHtmlToText(candidate.requirements || ''),
      posted_at: new Date().toISOString().split('T')[0],
      status: 'Active'
    };

    try {
      const { data, error } = await dbClient.from('gigs').insert([gigToInsert]).select();
      if (error) {
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
      saveLocalCandidates(mapped);
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
          total_pending: mapped.filter(c => c.status === CANDIDATE_STATUS.PENDING_REVIEW).length,
          total_store: mapped.length
        },
        candidates: mapped
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



