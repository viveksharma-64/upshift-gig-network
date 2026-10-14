/**
 * Activity Verification Engine
 * Assesses whether a gig is genuinely open, closed, or uncertain based on
 * multiple corroborating evidence signals (closure messages, deadlines, freshness, HTTP status).
 */

import { ACTIVITY_STATUS } from '../discovery/types.js';

// Explicit phrases indicating a listing is closed or filled
const CLOSURE_SIGNALS = [
  { regex: /applications?\s+(are\s+)?(now\s+)?closed/i, weight: 80, desc: 'Mentions applications closed' },
  { regex: /this\s+job\s+is\s+no\s+longer\s+available/i, weight: 85, desc: 'Mentions job no longer available' },
  { regex: /position\s+(has\s+been\s+)?filled/i, weight: 90, desc: 'Mentions position filled' },
  { regex: /listing\s+(has\s+)?expired/i, weight: 80, desc: 'Mentions listing expired' },
  { regex: /not\s+accepting\s+new\s+applications/i, weight: 85, desc: 'Mentions not accepting applications' },
  { regex: /this\s+opening\s+has\s+been\s+archived/i, weight: 85, desc: 'Mentions opening archived' }
];

// Explicit phrases indicating a paused opportunity (temporarily unavailable)
const PAUSED_SIGNALS = [
  { regex: /(?:applications?|hiring|intake)\s+(?:(?:is|are)\s+)?(?:temporarily\s+)?paused/i, weight: 80, desc: 'Mentions applications or hiring paused' },
  { regex: /(?:temporarily\s+on\s+hold|hiring\s+paused|on\s+hiatus|hiring\s+freeze)/i, weight: 80, desc: 'Mentions hiring temporarily on hold' },
  { regex: /not\s+accepting\s+applications\s+at\s+this\s+time/i, weight: 75, desc: 'Not accepting applications at this time' },
  { regex: /taking\s+a\s+break\s+from\s+(?:hiring|reviewing)/i, weight: 75, desc: 'Temporarily taking a break from reviewing' }
];

// Explicit phrases indicating an active opportunity
const ACTIVE_SIGNALS = [
  { regex: /(?:apply\s+now|submit\s+application|we('re|\s+are)\s+hiring|urgently\s+hiring)/i, weight: 25, desc: 'Active application call-to-action' },
  { regex: /open\s+position|accepting\s+applications/i, weight: 30, desc: 'Explicitly states accepting applications' },
  { regex: /posted\s+(?:today|yesterday|\d+\s+(?:days?|hours?)\s+ago)/i, weight: 30, desc: 'Recent posting timestamp' }
];

/**
 * Assesses the activity status and confidence of a gig opportunity
 * @param {object} params
 * @param {number} [params.httpStatus=200]
 * @param {string} [params.content=""]
 * @param {string} [params.postedDate]
 * @param {string} [params.deadline]
 * @param {string} [params.applicationUrl]
 * @returns {{ activity_status: string, activity_confidence: number, activity_evidence: string[], activity_reason: string }}
 */
export function verifyGigActivity({
  httpStatus = 200,
  content = '',
  postedDate,
  deadline,
  applicationUrl
}) {
  const evidence = [];
  let inactiveScore = 0;
  let pausedScore = 0;
  let activeScore = 0;

  // 1. HTTP Status Evaluation
  if (httpStatus === 404 || httpStatus === 410) {
    inactiveScore += 90;
    evidence.push(`HTTP status ${httpStatus} indicates page is gone or removed.`);
  } else if (httpStatus === 403 || httpStatus === 429) {
    evidence.push(`HTTP status ${httpStatus} indicates bot block/rate-limit; inconclusive for activity.`);
  } else if (httpStatus === 200) {
    evidence.push('HTTP status 200 indicates page is accessible.');
    activeScore += 15; // HTTP 200 alone is only weak evidence of active status
  } else if (httpStatus >= 500) {
    evidence.push(`HTTP status ${httpStatus} indicates server error; inconclusive for activity.`);
  }

  // 2. Closure Text Signals
  for (const signal of CLOSURE_SIGNALS) {
    if (signal.regex.test(content)) {
      inactiveScore += signal.weight;
      evidence.push(`Detected closure notice: "${signal.desc}".`);
    }
  }

  // 3. Paused Text Signals (FRD Section 11)
  for (const signal of PAUSED_SIGNALS) {
    if (signal.regex.test(content)) {
      pausedScore += signal.weight;
      evidence.push(`Detected paused signal: "${signal.desc}".`);
    }
  }

  // 4. Active Text Signals
  for (const signal of ACTIVE_SIGNALS) {
    if (signal.regex.test(content)) {
      activeScore += signal.weight;
      evidence.push(`Detected active signal: "${signal.desc}".`);
    }
  }

  // 5. Application URL availability
  if (applicationUrl && applicationUrl.startsWith('http')) {
    activeScore += 15;
    evidence.push('Direct application URL is present.');
  }

  // 6. Deadline Evaluation
  if (deadline) {
    const deadlineTime = Date.parse(deadline);
    if (!isNaN(deadlineTime)) {
      const now = Date.now();
      if (deadlineTime < now) {
        inactiveScore += 80;
        evidence.push(`Deadline (${deadline}) has passed.`);
      } else {
        activeScore += 30;
        evidence.push(`Deadline (${deadline}) is in the future.`);
      }
    }
  }

  // 7. Freshness Evaluation
  if (postedDate) {
    const postedTime = Date.parse(postedDate);
    if (!isNaN(postedTime)) {
      const daysOld = Math.floor((Date.now() - postedTime) / (1000 * 60 * 60 * 24));
      if (daysOld <= 7) {
        activeScore += 30;
        evidence.push(`Listing was posted very recently (${daysOld} days ago).`);
      } else if (daysOld <= 30) {
        activeScore += 15;
        evidence.push(`Listing was posted within the last month (${daysOld} days ago).`);
      } else if (daysOld > 90) {
        inactiveScore += 25;
        evidence.push(`Listing is over 90 days old (${daysOld} days ago), increasing likelihood of expiration.`);
      }
    }
  }

  // Determine Final Status & Confidence (0 - 100) per FRD Section 11
  let activity_status = ACTIVITY_STATUS.NEEDS_REVIEW;
  let activity_confidence = 50;
  let activity_reason = '';

  if (pausedScore >= 70 && pausedScore > inactiveScore) {
    activity_status = ACTIVITY_STATUS.PAUSED;
    activity_confidence = Math.min(95, Math.max(65, pausedScore));
    activity_reason = 'Evidence indicates opportunity exists but is temporarily unavailable or paused.';
  } else if (inactiveScore >= 70 && inactiveScore > activeScore) {
    activity_status = ACTIVITY_STATUS.STOPPED;
    activity_confidence = Math.min(95, Math.max(65, inactiveScore));
    activity_reason = 'Strong evidence indicates opportunity is closed, expired, or removed.';
  } else if (activeScore >= 50 && inactiveScore < 40 && pausedScore < 40) {
    activity_status = ACTIVITY_STATUS.ACTIVE;
    activity_confidence = Math.min(95, Math.max(60, activeScore));
    activity_reason = 'Available evidence and active signals indicate opportunity is currently open.';
  } else {
    activity_status = ACTIVITY_STATUS.NEEDS_REVIEW;
    // When evidence conflicts or is missing, confidence in certainty is low
    activity_confidence = Math.max(30, 70 - Math.abs(activeScore - inactiveScore));
    activity_reason = 'Evidence is incomplete, contradictory, or inconclusive; manual admin review advised.';
  }

  return {
    activity_status,
    activity_confidence: Math.round(activity_confidence),
    activity_evidence: evidence,
    activity_reason
  };
}

