/**
 * Gig Relevance & Work-Type Classifier
 *
 * Implements UpShift Gig Qualification Criteria (Phase 2A):
 * - Prioritizes freelance gigs, project-based contracts, paid micro-tasks, creator work,
 *   and AI evaluation/annotation opportunities across M1–M6.
 * - Identifies and flags or rejects conventional permanent full-time employment vacancies
 *   that do not qualify as flexible gig opportunities.
 * - Detects promotional articles, tutorials, courses, and landing pages presented as jobs.
 * - Transparent scoring trail with corroborating positive and negative evidence.
 */

// Explicit signals that an opportunity is a genuine gig, freelance, or project-based work
const GIG_WORK_SIGNALS = [
  { regex: /\b(?:freelance|freelancer|contractor|independent\s+contractor|1099)\b/i, weight: 35, desc: 'Mentions freelance or independent contractor' },
  { regex: /\b(?:project-based|fixed\s*price|fixed\s*budget|project\s*budget|milestone\s*payments?|per\s*project|deliverable-based|contract\s*project)\b/i, desc: 'Project-based / fixed-price deliverable engagement', weight: 30 },
  { regex: /\b(?:part-time|flexible\s+hours|flexible\s+schedule|hourly\s+rate|paid\s+hourly|micro-?task|task-based)\b/i, desc: 'Flexible / task-based work format', weight: 25 },
  { regex: /\b(?:gigs?|bount(?:y|ies))\b/i, desc: 'Explicit gig or bounty reference', weight: 30 },
  { regex: /\b(?:data\s+annotat\w*|rlhf|ai\s+trainer|model\s+evaluat\w*|model\s+testing|prompt\s+(?:rat\w*|engineer\w*|evaluat\w*|optimiz\w*|tuning)|red\s+teaming|human\s+evaluation|data\s+labeling|(?:system\s+)?prompts?|search\s+quality\s+rater|language\s+expert|transcriptionist)\b/i, desc: 'AI annotation, rating, prompt, or evaluation task', weight: 35 },
  { regex: /\b(?:bounty|hackathon|contest|competition|prize\s+pool)\b/i, desc: 'Developer bounty, contest, or hackathon', weight: 30 },
  { regex: /\b(?:creator|short-form|reels\s+creator|video\s+editor|thumbnail\s+designer|ugc\s+creator|brand\s+asset|reels\s+&\s+video|creator\s+commission|sponsored\s+content)\b/i, desc: 'Creator / digital media commission or project', weight: 25 },
  { regex: /\b(?:upwork|fiverr|contra|freelancer\.com|freelancer|outlier|mindrift|alignerr|dataannotation|remotasks|appen|catalant)\b/i, desc: 'Sourced from recognized gig/freelance platform', weight: 30 },
  { regex: /\bvia\s+(?:upwork|freelancer|contra|fiverr|bounties|catalant)\b/i, desc: 'Syndicated via freelance marketplace', weight: 30 }
];

// Explicit signals of ordinary, permanent corporate employment vacancies
const CONVENTIONAL_JOB_SIGNALS = [
  { regex: /\b(?:full-time\s+permanent|permanent\s+full-time|w-?2\s+only|direct\s+hire\s+permanent|permanent\s+role|permanent\s+position)\b/i, weight: 40, desc: 'Explicit permanent full-time employment' },
  { regex: /\b(?:401\(?k\)?\s+(?:match|matching)|health,\s+dental,\s+(?:and\s+)?vision|comprehensive\s+health\s+benefits|parental\s+leave|unlimited\s+pto|equity\s+(?:grant|package|options)|annual\s+bonus|paid\s+vacation|tuition\s+reimbursement)\b/i, weight: 35, desc: 'Standard corporate employee benefits package (401k/health/equity)' },
  { regex: /\b(?:annual\s+base\s+salary\s+of\s+\$\d{2,3},\d{3}|\$\d{2,3},\d{3}\s*[-–]\s*\$\d{2,3},\d{3}\s*\/\s*year|\$\d{2,3},\d{3}\s+annually)\b/i, weight: 35, desc: 'Corporate salaried annual compensation' },
  { regex: /\b(?:senior\s+|junior\s+|lead\s+|staff\s+|principal\s+|head\s+of\s+|vp\s+of\s+)(?:software\s+engineer|systems\s+engineer|platform\s+engineer|backend\s+(?:engineer|developer)|frontend\s+(?:engineer|developer)|full-?stack\s+(?:engineer|developer)|mobile\s+(?:engineer|developer)|devops\s+engineer|site\s+reliability\s+engineer|qa\s+engineer|test\s+engineer|product\s+manager|engineering\s+manager)\b/i, weight: 35, desc: 'Corporate software engineering / product vacancy' },
  { regex: /\b(?:full-time\s+programming|all\s+jobs\s+\/\s+full-stack|full-time\s+job|employment\s+type:\s*full-time)\b/i, weight: 30, desc: 'Full-time category or employment type' }
];

// Content that is clearly an article, tutorial, course, or promotional page (not a real opportunity)
const PROMO_ARTICLE_SIGNALS = [
  { regex: /\b(?:how\s+to\s+become|step-by-step\s+guide|tutorial\s+for\s+beginners|career\s+advice|learn\s+how\s+to|course\s+curriculum|bootcamp\s+tuition|enroll\s+today)\b/i, desc: 'Educational guide, tutorial, or course promotion' },
  { regex: /\b(?:read\s+more\s+articles|subscribe\s+to\s+our\s+blog|blog\s+post|podcast\s+episode)\b/i, desc: 'Blog post or media article' }
];

export const GIG_TYPE = Object.freeze({
  FREELANCE: 'freelance',
  CONTRACT: 'contract',
  TASK_BASED: 'task_based',
  BOUNTY: 'bounty',
  CREATOR: 'creator',
  CONVENTIONAL_JOB: 'conventional_job',
  ARTICLE_OR_PROMO: 'article_or_promo',
  UNCERTAIN: 'uncertain'
});

/**
 * Assesses whether a listing meets UpShift's definition of a genuine gig opportunity.
 * Accepts either an object { title, description, ... } or (title, description, options).
 *
 * @param {object|string} listingOrTitle
 * @param {string} [descriptionArg]
 * @param {object} [optsArg]
 * @returns {{
 *   is_gig: boolean,
 *   isGig: boolean,
 *   gig_type: string,
 *   gigType: string,
 *   is_conventional_job: boolean,
 *   isConventionalJob: boolean,
 *   confidence: number,
 *   evidence: string[],
 *   reason: string
 * }}
 */
export function evaluateGigRelevance(listingOrTitle, descriptionArg = '', optsArg = {}) {
  let listing = {};
  if (typeof listingOrTitle === 'string') {
    listing = {
      title: listingOrTitle,
      description: descriptionArg,
      ...optsArg
    };
  } else if (listingOrTitle && typeof listingOrTitle === 'object') {
    listing = listingOrTitle;
  } else {
    return {
      is_gig: false,
      isGig: false,
      gig_type: 'uncertain',
      gigType: 'uncertain',
      is_conventional_job: false,
      isConventionalJob: false,
      confidence: 0,
      evidence: ['Empty or invalid listing input.'],
      reason: 'No listing data provided.'
    };
  }

  const title = (listing.title || '').trim();
  const description = (listing.description || listing.overview || '').trim();
  const targetUrl = (listing.url || listing.opportunity_url || listing.original_url || '').trim();
  const fullText = `${title}\n${description}\n${targetUrl}`.toLowerCase();
  const titleLower = title.toLowerCase();

  const evidence = [];
  let gigScore = 0;
  let conventionalScore = 0;

  // 1. Check for informational articles / tutorials / course promotions
  for (const signal of PROMO_ARTICLE_SIGNALS) {
    if (signal.regex.test(titleLower) || (signal.regex.test(fullText) && description.length < 300)) {
      evidence.push(`Detected non-opportunity content: ${signal.desc}`);
      return {
        is_gig: false,
        isGig: false,
        action: 'reject',
        gig_type: 'article_or_promo',
        gigType: 'article_or_promo',
        is_conventional_job: false,
        isConventionalJob: false,
        confidence: 90,
        evidence,
        reasons: evidence,
        reason: 'Content appears to be an article, tutorial, or promotional course rather than a distinct work opportunity.'
      };
    }
  }

  // 2. Evaluate Gig Signals
  for (const signal of GIG_WORK_SIGNALS) {
    if (signal.regex.test(titleLower)) {
      gigScore += signal.weight + 15; // Higher weight if in title
      evidence.push(`Title signal: ${signal.desc}`);
    } else if (signal.regex.test(fullText)) {
      gigScore += signal.weight;
      evidence.push(`Body signal: ${signal.desc}`);
    }
  }

  // Source-level boost if from verified gig/hackathon platforms or syndicated freelance boards
  const sourceName = (listing.source_name || '').toLowerCase();
  const viaPlatform = (listing.via_platform || '').toLowerCase();
  if (['kaggle', 'huggingface', 'devpost', 'dribbble', 'freelancer'].some(s => sourceName.includes(s))) {
    gigScore += 25;
    evidence.push(`Sourced from verified gig/task/bounty platform (${listing.source_name}).`);
  }
  if (viaPlatform && ['upwork', 'freelancer', 'contra', 'fiverr', 'catalant', 'outlier'].some(p => viaPlatform.includes(p))) {
    gigScore += 30;
    evidence.push(`Syndicated via freelance marketplace platform (${listing.via_platform}).`);
  }

  // Hourly or project-based compensation indicates gig
  const compType = (listing.compensation_type || '').toLowerCase();
  const paymentAmount = (listing.payment_amount || '').toLowerCase();
  if (['hourly', 'fixed', 'project'].includes(compType) || /\/hr|\/hour|hourly/i.test(paymentAmount) || /\b(?:hourly|\/hr|\/hour|per\s+hour|fixed\s*price|fixed\s*budget)\b/i.test(fullText)) {
    gigScore += 25;
    evidence.push(`Hourly, fixed, or project compensation (${compType || paymentAmount}) indicates gig engagement.`);
    conventionalScore = Math.max(0, conventionalScore - 25);
  }

  // 3. Evaluate Conventional Job Signals
  for (const signal of CONVENTIONAL_JOB_SIGNALS) {
    if (signal.regex.test(titleLower)) {
      conventionalScore += signal.weight + 20;
      evidence.push(`Title indicates traditional employment: ${signal.desc}`);
    } else if (signal.regex.test(fullText)) {
      conventionalScore += signal.weight;
      evidence.push(`Listing text indicates traditional employment: ${signal.desc}`);
    }
  }

  // If annual salary is prominent and mentions full-time without freelance keywords
  if (compType === 'annual' && !/\b(?:contract|freelance|hourly|temp)\b/i.test(fullText)) {
    conventionalScore += 20;
    evidence.push('Annual compensation structure with no contract/freelance indicators.');
  }

  // 4. Synthesize Conclusion
  // Reject conventional corporate jobs
  if (conventionalScore >= 35 && conventionalScore > gigScore) {
    return {
      is_gig: false,
      isGig: false,
      action: 'reject',
      gig_type: 'conventional_job',
      gigType: 'conventional_job',
      is_conventional_job: true,
      isConventionalJob: true,
      confidence: Math.min(95, Math.max(70, conventionalScore)),
      evidence,
      reasons: evidence,
      reason: 'Listing represents ordinary corporate employment rather than a freelance gig, project, or task.'
    };
  }

  // Accept genuine gigs with affirmative signals
  if (gigScore >= 30) {
    let gigType = 'freelance';
    if (/\b(?:bounty|hackathon|contest)\b/i.test(fullText)) gigType = 'bounty';
    else if (/\b(?:data\s+annotat|rlhf|ai\s+trainer|evaluat|prompt\s+rat|content\s+reviewer)\b/i.test(fullText)) gigType = 'task_based';
    else if (/\b(?:creator|reels|video\s+editor|visual\s+artist|thumbnail)\b/i.test(fullText)) gigType = 'creator';
    else if (compType === 'project' || /\b(?:project-based|fixed\s+price)\b/i.test(fullText)) gigType = 'contract';

    return {
      is_gig: true,
      isGig: true,
      action: 'accept',
      gig_type: gigType,
      gigType: gigType,
      is_conventional_job: false,
      isConventionalJob: false,
      confidence: Math.min(95, Math.max(60, gigScore)),
      evidence,
      reasons: evidence,
      reason: `Opportunity displays clear freelance/gig characteristics (${gigType}).`
    };
  }

  // Ambiguous: neither definitively a gig nor definitively a conventional corporate role
  // Must NOT be automatically treated as a valid gig. Marked uncertain for human review.
  return {
    is_gig: false,
    isGig: false,
    action: 'pending_review',
    gig_type: 'uncertain',
    gigType: 'uncertain',
    is_conventional_job: false,
    isConventionalJob: false,
    confidence: 40,
    evidence,
    reasons: evidence,
    reason: 'Listing lacks affirmative freelance or gig signals; requires human admin review to verify.'
  };
}
