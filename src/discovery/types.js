/**
 * UpShift Gig Discovery Engine — Normalized Candidate Types & Statuses
 */

import { normalizeHtmlToText } from './textNormalizer.js';
import { LINK_TYPE, LINK_STATUS, analyzeUrlStructure } from './urlClassifier.js';

export { LINK_TYPE, LINK_STATUS, analyzeUrlStructure };

export const CANDIDATE_STATUS = {
  PENDING_REVIEW: 'pending_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  DUPLICATE: 'duplicate',
  NEEDS_RECHECK: 'needs_recheck',
  PAUSED: 'paused',
  STOPPED: 'stopped'
};

/**
 * Validates whether a state transition between candidate review statuses is permitted.
 * @param {string} currentStatus
 * @param {string} nextStatus
 * @returns {boolean}
 */
export function isValidStatusTransition(currentStatus, nextStatus) {
  if (!currentStatus || !nextStatus) return false;
  if (currentStatus === nextStatus) return true;

  const validStatuses = Object.values(CANDIDATE_STATUS);
  if (!validStatuses.includes(currentStatus) || !validStatuses.includes(nextStatus)) {
    return false;
  }

  const allowedTransitions = {
    [CANDIDATE_STATUS.PENDING_REVIEW]: [
      CANDIDATE_STATUS.APPROVED,
      CANDIDATE_STATUS.REJECTED,
      CANDIDATE_STATUS.DUPLICATE,
      CANDIDATE_STATUS.NEEDS_RECHECK,
      CANDIDATE_STATUS.PAUSED,
      CANDIDATE_STATUS.STOPPED
    ],
    [CANDIDATE_STATUS.NEEDS_RECHECK]: [
      CANDIDATE_STATUS.APPROVED,
      CANDIDATE_STATUS.REJECTED,
      CANDIDATE_STATUS.DUPLICATE,
      CANDIDATE_STATUS.PAUSED,
      CANDIDATE_STATUS.STOPPED
    ],
    [CANDIDATE_STATUS.APPROVED]: [
      CANDIDATE_STATUS.NEEDS_RECHECK,
      CANDIDATE_STATUS.PAUSED,
      CANDIDATE_STATUS.STOPPED
    ],
    [CANDIDATE_STATUS.PAUSED]: [
      CANDIDATE_STATUS.PENDING_REVIEW,
      CANDIDATE_STATUS.APPROVED,
      CANDIDATE_STATUS.STOPPED,
      CANDIDATE_STATUS.NEEDS_RECHECK
    ],
    [CANDIDATE_STATUS.STOPPED]: [
      CANDIDATE_STATUS.PENDING_REVIEW,
      CANDIDATE_STATUS.NEEDS_RECHECK
    ],
    [CANDIDATE_STATUS.REJECTED]: [
      CANDIDATE_STATUS.NEEDS_RECHECK // Reconsideration requires recheck first
    ],
    [CANDIDATE_STATUS.DUPLICATE]: [
      CANDIDATE_STATUS.NEEDS_RECHECK // Dispute requires recheck first
    ]
  };

  return Boolean(allowedTransitions[currentStatus]?.includes(nextStatus));
}

/**
 * Canonical FRD Section 11 Opportunity Activity Statuses:
 * - Active: currently available
 * - Paused: temporarily unavailable
 * - Stopped: closed, removed, expired
 * - Needs Review: inconclusive evidence
 */
export const ACTIVITY_STATUS = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  STOPPED: 'Stopped',
  NEEDS_REVIEW: 'Needs Review',
  // Backward compatibility aliases
  INACTIVE: 'Stopped',
  UNCERTAIN: 'Needs Review'
};

/**
 * Normalizes any activity status representation to canonical FRD format
 * @param {string} status
 * @returns {string}
 */
export function normalizeActivityStatus(status) {
  if (!status || typeof status !== 'string') return ACTIVITY_STATUS.NEEDS_REVIEW;
  const s = status.trim().toLowerCase();
  if (s === 'active') return ACTIVITY_STATUS.ACTIVE;
  if (s === 'paused') return ACTIVITY_STATUS.PAUSED;
  if (s === 'stopped' || s === 'inactive' || s === 'closed' || s === 'expired') return ACTIVITY_STATUS.STOPPED;
  if (s === 'needs review' || s === 'needs_review' || s === 'uncertain') return ACTIVITY_STATUS.NEEDS_REVIEW;
  return ACTIVITY_STATUS.NEEDS_REVIEW;
}

export const UNCERTAINTY_LEVEL = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high'
};

export const SOURCE_TYPE = {
  PUBLIC_API: 'public_api',
  RSS_FEED: 'rss_feed',
  WEB_SCRAPER: 'web_scraper',
  SEARCH_API: 'search_api',
  FIXTURE: 'fixture'
};

/**
 * Creates a normalized candidate record with default structure and safe defaults
 * @param {Partial<Candidate>} data
 * @returns {Candidate}
 */
export function createCandidate(data = {}) {
  const now = new Date().toISOString();
  
  return {
    id: data.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? `cand_${crypto.randomUUID()}` : `cand_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    source_name: data.source_name || 'unknown_source',
    source_type: data.source_type || SOURCE_TYPE.FIXTURE,
    source_listing_id: data.source_listing_id || null,
    
    // URLs: distinct source, opportunity, and application endpoints
    original_url: data.original_url || '',
    canonical_url: data.canonical_url || data.original_url || '',
    opportunity_url: data.opportunity_url || data.canonical_url || data.original_url || '',
    application_url: data.application_url !== undefined ? data.application_url : '',
    source_url: data.source_url || data.original_url || '',
    resolved_url: data.resolved_url || data.opportunity_url || data.original_url || '',

    // Link Verification & Qualification Metadata
    link_type: data.link_type || LINK_TYPE.OPPORTUNITY_PAGE,
    link_status: data.link_status || LINK_STATUS.VERIFIED,
    link_evidence: Array.isArray(data.link_evidence) ? data.link_evidence : [],
    is_gig: data.is_gig !== undefined ? Boolean(data.is_gig) : true,
    gig_type: data.gig_type || 'freelance',
    is_conventional_job: Boolean(data.is_conventional_job),
    
    // Core listing fields
    title: normalizeHtmlToText(data.title || ''),
    organization: normalizeHtmlToText(data.organization || 'Undisclosed Organization'),
    description: normalizeHtmlToText(data.description || ''),
    short_description: normalizeHtmlToText(data.short_description || (data.description ? data.description.slice(0, 200) : '')),
    overview: normalizeHtmlToText(data.overview || data.description || ''),
    responsibilities: normalizeHtmlToText(data.responsibilities || ''),
    deliverables: normalizeHtmlToText(data.deliverables || ''),
    requirements: normalizeHtmlToText(data.requirements || ''),
    proof_spec: normalizeHtmlToText(data.proof_spec || ''),
    
    // Compensation & terms
    payment_amount: data.payment_amount || 'Unspecified',
    min_amount: typeof data.min_amount === 'number' ? data.min_amount : 0,
    max_amount: typeof data.max_amount === 'number' ? data.max_amount : 0,
    currency: data.currency || 'USD',
    compensation_type: data.compensation_type || 'hourly',
    
    // Location, flags & timing
    location: normalizeHtmlToText(data.location || 'Remote'),
    work_arrangement: data.work_arrangement || 'remote',
    is_local_business: Boolean(data.is_local_business),
    is_featured: Boolean(data.is_featured),
    priority: data.priority || (clampScore(data.review_priority, 65) >= 75 ? 'Featured' : 'Standard'),
    posted_date: data.posted_date || null,
    deadline: data.deadline || null,
    first_discovered_at: data.first_discovered_at || now,
    last_checked_at: data.last_checked_at || now,
    
    // M1-M6 Classification
    track_id: data.track_id || 'M3',
    matched_modules: Array.isArray(data.matched_modules) ? data.matched_modules : ['M3'],
    module_fit_scores: data.module_fit_scores || { M3: 60 },
    module_evidence: data.module_evidence || {},
    confidence_tier: data.confidence_tier || 'moderate',
    has_conflict: Boolean(data.has_conflict),
    conflicting_tracks: Array.isArray(data.conflicting_tracks) ? data.conflicting_tracks : [],
    is_relevant: data.is_relevant !== undefined ? Boolean(data.is_relevant) : true,
    classification_reason: data.classification_reason || '',
    
    // Activity Evaluation (FRD Section 11)
    activity_status: normalizeActivityStatus(data.activity_status || ACTIVITY_STATUS.NEEDS_REVIEW),
    activity_evidence: Array.isArray(data.activity_evidence) ? data.activity_evidence : [],
    activity_reason: data.activity_reason || '',
    last_health_check_at: data.last_health_check_at || null,
    health_check_error: data.health_check_error || null,
    
    // Scores (0-100)
    activity_confidence: clampScore(data.activity_confidence, 50),
    module_fit_score: clampScore(data.module_fit_score, 60),
    source_reliability: clampScore(data.source_reliability, 80),
    data_completeness: clampScore(data.data_completeness, 70),
    review_priority: clampScore(data.review_priority, 65),
    
    // Deduplication & Provenance
    duplicate_cluster_id: data.duplicate_cluster_id || null,
    is_duplicate: Boolean(data.is_duplicate),
    duplicate_of: data.duplicate_of || null,
    source_history: Array.isArray(data.source_history) && data.source_history.length > 0
      ? data.source_history
      : [{
          source_name: data.source_name || 'unknown_source',
          source_type: data.source_type || SOURCE_TYPE.FIXTURE,
          source_listing_id: data.source_listing_id || null,
          original_url: data.original_url || '',
          discovered_at: data.first_discovered_at || now
        }],
    
    // LLM Metadata
    llm_provider: data.llm_provider || null,
    llm_model: data.llm_model || null,
    llm_evaluation: data.llm_evaluation || null,
    
    // Referral ID / Link Handling (FRD Section 15, REF-01 to REF-04)
    referral_id: (data.referral_id || '').trim(),
    referral_url: (data.referral_url || '').trim(),
    referral_required: Boolean(data.referral_required),
    referral_history: Array.isArray(data.referral_history) ? data.referral_history : [],

    // Lifecycle & Admin Review
    status: data.status || CANDIDATE_STATUS.PENDING_REVIEW,
    admin_notes: data.admin_notes || '',
    rejection_reason: data.rejection_reason || null,
    reviewed_by: data.reviewed_by || null,
    reviewed_at: data.reviewed_at || null,
    published_gig_id: data.published_gig_id || null
  };
}

/**
 * Ensures score is integer clamped between 0 and 100
 * @param {any} val
 * @param {number} fallback
 * @returns {number}
 */
export function clampScore(val, fallback = 0) {
  const num = typeof val === 'number' ? Math.round(val) : parseInt(val, 10);
  if (isNaN(num)) return fallback;
  return Math.max(0, Math.min(100, num));
}
