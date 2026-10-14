/**
 * Transparent Confidence & Priority Scoring Engine
 * Computes 5 independent heuristic metrics (0–100) with full evidence accounting.
 */

import { clampScore, SOURCE_TYPE, ACTIVITY_STATUS } from '../discovery/types.js';

// Base reliability score by source type
const SOURCE_RELIABILITY_MAP = {
  [SOURCE_TYPE.FIXTURE]: 100,
  [SOURCE_TYPE.PUBLIC_API]: 90,
  [SOURCE_TYPE.RSS_FEED]: 80,
  [SOURCE_TYPE.WEB_SCRAPER]: 70,
  [SOURCE_TYPE.SEARCH_API]: 65
};

/**
 * Computes data completeness score (0-100) based on availability of core fields
 * @param {object} candidate
 * @returns {{ score: number, missingFields: string[], completenessReasons: string[] }}
 */
export function calculateDataCompleteness(candidate) {
  let score = 0;
  const missing = [];
  const reasons = [];

  // Title (20 pts)
  if (candidate.title && candidate.title.length >= 8) {
    score += 20;
  } else {
    missing.push('Descriptive title');
  }

  // Organization (15 pts)
  if (candidate.organization && candidate.organization !== 'Undisclosed Organization') {
    score += 15;
    reasons.push('Employer identified');
  } else {
    missing.push('Employer / Organization name');
  }

  // Description (20 pts)
  if (candidate.description && candidate.description.length >= 80) {
    score += 20;
    reasons.push('Substantial listing description');
  } else {
    missing.push('Comprehensive description');
  }

  // Requirements or Responsibilities (15 pts)
  if ((candidate.requirements && candidate.requirements.length >= 30) ||
      (candidate.responsibilities && candidate.responsibilities.length >= 30)) {
    score += 15;
    reasons.push('Specific requirements/responsibilities detailed');
  } else {
    missing.push('Requirements / Responsibilities specification');
  }

  // Compensation (15 pts)
  if (candidate.payment_amount && candidate.payment_amount !== 'Unspecified') {
    score += 15;
    reasons.push('Compensation specified');
  } else {
    missing.push('Compensation details');
  }

  // Application Link (15 pts)
  if (candidate.application_url && candidate.application_url.startsWith('http')) {
    score += 15;
    reasons.push('Direct application link available');
  } else {
    missing.push('Direct application link');
  }

  return {
    score: clampScore(score),
    missingFields: missing,
    completenessReasons: reasons
  };
}

/**
 * Evaluates source reliability score (0-100)
 * @param {string} sourceType
 * @param {string} sourceName
 * @returns {number}
 */
export function calculateSourceReliability(sourceType, sourceName = '') {
  let base = SOURCE_RELIABILITY_MAP[sourceType] || 70;
  // Reputable sources get a slight trust boost
  const reputableSources = ['remotive', 'arbeitnow', 'weworkremotely', 'jobicy'];
  if (reputableSources.some(s => sourceName.toLowerCase().includes(s))) {
    base = Math.min(100, base + 5);
  }
  return clampScore(base);
}

/**
 * Calculates overall review priority (0-100) to help admins review the most promising candidates first
 * @param {object} params
 * @param {number} params.activity_confidence
 * @param {number} params.module_fit_score
 * @param {number} params.source_reliability
 * @param {number} params.data_completeness
 * @param {string} params.activity_status
 * @param {boolean} [params.prompt_injection_detected=false]
 * @param {boolean} [params.has_application_url=true]
 * @returns {{ priorityScore: number, breakdown: object }}
 */
export function calculateReviewPriority({
  activity_confidence,
  module_fit_score,
  source_reliability,
  data_completeness,
  activity_status,
  prompt_injection_detected = false,
  has_application_url = true
}) {
  // Weighted base calculation
  let composite = (activity_confidence * 0.35) +
                  (module_fit_score * 0.30) +
                  (data_completeness * 0.20) +
                  (source_reliability * 0.15);

  const deductions = [];

  // Inactive gigs should not clutter top of queue
  if (activity_status === ACTIVITY_STATUS.INACTIVE) {
    composite -= 30;
    deductions.push('Inactive gig status penalty (-30)');
  }

  // Missing application URL deduction
  if (!has_application_url) {
    composite -= 20;
    deductions.push('Missing application URL (-20)');
  }

  // Prompt injection warning deduction
  if (prompt_injection_detected) {
    composite -= 25;
    deductions.push('Prompt injection attempt flagged (-25)');
  }

  const priorityScore = clampScore(composite);

  return {
    priorityScore,
    breakdown: {
      activityContribution: Math.round(activity_confidence * 0.35),
      moduleFitContribution: Math.round(module_fit_score * 0.30),
      completenessContribution: Math.round(data_completeness * 0.20),
      reliabilityContribution: Math.round(source_reliability * 0.15),
      deductions
    }
  };
}
