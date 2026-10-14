/**
 * Deterministic M1–M6 Module Classifier
 * Matches gig descriptions and requirements against UpShift's six learning tracks:
 * - M1: AI Video / Reels
 * - M2: AI Design / Visual
 * - M3: AI Data & Evaluation
 * - M4: AI Coding & Web Dev
 * - M5: AI Marketing & Growth
 * - M6: AI Automation & Agents
 *
 * Implements FRD v1.0 Section 9, 13, & 26:
 * - Confidence tiers (high, moderate, low, none)
 * - Conflicting / ambiguous classification detection
 * - Transparent scoring evidence trail
 */
import { MODULE_DEFINITIONS } from '../discovery/modules.js';
import { sanitizeScrapedContent } from './scraper.js';

// Non-digital, physical, or unrelated occupations to reject early
const NEGATIVE_DOMAIN_PATTERNS = [
  { regex: /\b(?:forklift\s+operator|warehouse\s+(?:worker|associate|specialist|handler)|material\s+handler|order\s+picker)\b/i, desc: 'warehouse/logistics labor' },
  { regex: /\b(?:truck\s+driver|cdl\s+driver|delivery\s+driver|courier|bus\s+driver)\b/i, desc: 'commercial driving/transport' },
  { regex: /\b(?:registered\s+nurse|nurse\s+practitioner|dental\s+hygienist|physical\s+therapist|occupational\s+therapist|phlebotomist)\b/i, desc: 'clinical healthcare' },
  { regex: /\b(?:electrician|plumber|carpenter|welder|hvac\s+technician|maintenance\s+mechanic|pipefitter)\b/i, desc: 'physical trade crafts' },
  { regex: /\b(?:retail\s+cashier|barista|store\s+associate|restaurant\s+cook|dishwasher|line\s+cook|security\s+guard|janitor|custodian)\b/i, desc: 'service/hospitality/retail' },
  // Corporate sales quota roles
  { regex: /\b(?:(?:senior\s+|sr\.?\s+)?(?:manager|director|lead),?\s+(?:corporate\s+sales|enterprise\s+sales|sales)|corporate\s+sales|enterprise\s+account\s+executive|account\s+executive|sales\s+executive|sales\s+director|sales\s+manager|business\s+development\s+representative|\bbdr\b|\bsdr\b|inside\s+sales)\b/i, desc: 'corporate sales quota/BDR' },
  // Corporate internal finance / equity / accounting
  { regex: /\b(?:finance\s+systems\s+lead|finance\s+systems|\bfp&a\s+lead\b|\bfp&a\b|equity\s+administrator|controller|accounting\s+manager|payroll\s+specialist|tax\s+manager)\b/i, desc: 'corporate internal finance/accounting/equity' },
  // Corporate HR / recruiting
  { regex: /\b(?:talent\s+acquisition|technical\s+recruiter|corporate\s+recruiter|hr\s+generalist|people\s+operations)\b/i, desc: 'corporate recruiting/HR' },
  // Corporate internal helpdesk
  { regex: /\b(?:service\s+desk|helpdesk|desktop\s+support|it\s+support\s+specialist)\b/i, desc: 'internal IT helpdesk/support' },
  // General office clerical
  { regex: /\b(?:office\s+assistant|administrative\s+assistant|receptionist)\b/i, desc: 'general clerical/office' },
  // Corporate BI / SQL data warehousing (distinguishing from M3 AI data annotation)
  { regex: /\b(?:business\s+intelligence\s+analyst|bi\s+developer|bi\s+analyst|data\s+warehouse\s+engineer|etl\s+developer|database\s+administrator|\bdba\b)\b/i, desc: 'corporate BI/data warehousing' },
  // Corporate Customer Success / Client Relationship Management
  { regex: /\b(?:customer\s+success|client\s+success|\bcsm\b)\b/i, desc: 'corporate customer success/account management' },
  // Corporate Revenue / GTM / Corporate Business Systems
  { regex: /\b(?:revenue\s+operations|revops\s+analyst|sales\s+operations|crm\s+administrator|salesforce\s+administrator|gtm\s+systems|business\s+systems\s+analyst|corporate\s+systems)\b/i, desc: 'corporate revenue/sales/GTM operations' },
  // Informational blog articles / tutorials / courses / bootcamps (non-gigs)
  { regex: /\b(?:bootcamp|masterclass|webinar|tutorial|cheat\s*sheet)\b|^(?:how\s+to\b|guide:?)|:\s*(?:step-by-step|beginner|complete)?\s*tutorial\b|\b(?:career\s+transition\s+guide|interview\s+prep\b|enroll\s+now\b)/i, desc: 'informational article/course/tutorial' },
  // Corporate executive / enterprise director management roles (non-gigs)
  { regex: /\b(?:group\s+product\s+manager|director\b|vice\s+president|\bvp\b|chief\s+(?:technology|executive|operating|product|marketing|financial)\s+officer|\bcto\b|\bceo\b|\bcoo\b|\bcpo\b|\bcmo\b|\bcfo\b|chief\s+of\s+staff)\b/i, desc: 'corporate executive/director management' },
  // QA / Test automation roles (not AI workflow automation)
  { regex: /\b(?:qa\s+automation|test\s+automation|software\s+test\s+engineer|quality\s+assurance\s+engineer|\bsdet\b)\b/i, desc: 'QA/test automation engineer' }
];

const RESPONSIBILITY_STOPWORDS = new Set([
  'build', 'about', 'other', 'these', 'their', 'which', 'where', 'there',
  'complex', 'tools', 'using', 'across', 'clean', 'write', 'deploy',
  'create', 'deliver', 'scale', 'business', 'operations', 'management',
  'including', 'produce', 'support', 'ensure', 'within'
]);

/**
 * Classifies listing text against UpShift M1-M6 modules
 * @param {object} listing
 * @param {string} listing.title
 * @param {string} [listing.description]
 * @param {string} [listing.responsibilities]
 * @param {string} [listing.requirements]
 * @returns {{
 *   track_id: string,
 *   matched_modules: string[],
 *   module_fit_scores: Record<string, number>,
 *   module_evidence: Record<string, string[]>,
 *   primary_fit_score: number,
 *   confidence_tier: 'high' | 'moderate' | 'low' | 'none',
 *   has_conflict: boolean,
 *   conflicting_tracks: string[],
 *   is_relevant: boolean,
 *   classification_reason: string
 * }}
 */
export function classifyListingModules({
  title = '',
  description = '',
  responsibilities = '',
  requirements = ''
}) {
  const rawText = `${title}\n${description}\n${responsibilities}\n${requirements}`;
  const { sanitizedText, injectionDetected } = sanitizeScrapedContent(rawText);
  const combinedText = sanitizedText.toLowerCase();
  const titleLower = title.toLowerCase();

  // Pre-screen: Check for non-digital / physical labor / corporate non-gig occupations
  for (const neg of NEGATIVE_DOMAIN_PATTERNS) {
    const titleMatch = neg.regex.test(titleLower);
    // For informational article or executive, only check title or specific non-job phrases
    let bodyMatch = false;
    if (neg.desc === 'informational article/course/tutorial') {
      bodyMatch = /\b(?:enroll\s+(?:now|in\s+our)|course\s+curriculum|bootcamp\s+tuition|career\s+transition\s+guide|cheat\s*sheet)\b/i.test(combinedText);
    } else if (neg.desc.includes('corporate executive')) {
      bodyMatch = false; // Executive level is determined by job title, not mentioning leadership in body
    } else {
      bodyMatch = neg.regex.test(combinedText);
    }

    if (titleMatch || bodyMatch) {
      const isAbsoluteNegative = neg.desc.includes('corporate executive') || neg.desc.includes('informational article');

      // Check if there are strong explicit digital role keywords in title (only for trades/blue-collar overrides)
      let hasDigitalRoleInTitle = false;
      if (!isAbsoluteNegative) {
        for (const def of Object.values(MODULE_DEFINITIONS)) {
          if (def.roleKeywords.some(rk => titleLower.includes(rk))) {
            hasDigitalRoleInTitle = true;
            break;
          }
        }
        if (!hasDigitalRoleInTitle) {
          if (/\b(?:developer|engineer|programmer|coder|designer|video\s+editor|animator|copywriter|ai\s+trainer|data\s+annotator)\b/i.test(titleLower)) {
            hasDigitalRoleInTitle = true;
          }
        }
      }

      if (!hasDigitalRoleInTitle) {
        return {
          track_id: null,
          matched_modules: [],
          module_fit_scores: { M1: 0, M2: 0, M3: 0, M4: 0, M5: 0, M6: 0 },
          module_evidence: { M1: [], M2: [], M3: [], M4: [], M5: [], M6: [] },
          primary_fit_score: 0,
          confidence_tier: 'none',
          has_conflict: false,
          conflicting_tracks: [],
          is_relevant: false,
          classification_reason: `Non-gig content pattern detected (${neg.desc}) - non-digital or out-of-scope for UpShift M1-M6 tracks.`
        };
      }
    }
  }

  const moduleScores = {};
  const moduleEvidence = {};

  for (const [modId, def] of Object.entries(MODULE_DEFINITIONS)) {
    let score = 0;
    let evidence = [];

    // 1. Role keywords in Title (High impact: +35 points)
    for (const roleKey of def.roleKeywords) {
      if (titleLower.includes(roleKey)) {
        score += 35;
        evidence.push(`Title matches role keyword "${roleKey}" (+35)`);
        break; // max 1 title role boost
      }
    }

    // 2. Primary Skills in combined text (+15 per distinct skill match, capped at 4)
    let skillMatches = 0;
    for (const skill of def.primarySkills) {
      const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(combinedText)) {
        skillMatches++;
        score += 15;
        evidence.push(`Mentions skill/tool "${skill}" (+15)`);
        if (skillMatches >= 4) break;
      }
    }

    // 3. Responsibilities match (+10 points per matched distinctive keyphrase)
    for (const resp of def.responsibilities) {
      const respWords = resp.split(' ')
        .map(w => w.toLowerCase().replace(/[^a-z]/g, ''))
        .filter(w => w.length > 4 && !RESPONSIBILITY_STOPWORDS.has(w));

      let matchCount = 0;
      for (const w of respWords) {
        if (combinedText.includes(w)) matchCount++;
      }
      if (matchCount >= 2) {
        score += 10;
        evidence.push(`Responsibilities align with: "${resp.slice(0, 50)}..." (+10)`);
        break;
      }
    }

    // Module-specific guardrails:
    // M6: Test/QA automation or generic IT automation does not qualify as AI Agent / workflow automation
    if (modId === 'M6') {
      const isQaAutomation = /\b(?:qa\s+automation|test\s+automation|software\s+test|quality\s+assurance)\b/i.test(titleLower);
      const hasGenuineWorkflowOrAgent = /\b(?:n8n|make\.com|zapier|agent|agentic|langchain|crewai|autogen|llamaindex|langgraph|bot\s+builder|custom\s+bot|webhook\s+automation|rag\s+workflow)\b/i.test(combinedText);
      if (isQaAutomation || !hasGenuineWorkflowOrAgent) {
        score = 0;
        evidence = [];
      }
    }

    // M3: Generic data analyst or business analyst roles without AI evaluation keywords do not qualify as M3
    if (modId === 'M3') {
      const isGenericData = /\b(?:data\s+analyst|analytics\s+manager|data\s+analytics|bi\s+analyst|reporting\s+analyst|financial\s+analyst|claim\s+analyst)\b/i.test(titleLower);
      const hasGenuineAiAnnotation = /\b(?:rlhf|annotat|model\s+evaluat|prompt\s+rat|ai\s+trainer|ground\s+truth|ai\s+evaluat|language\s+expert|linguistic|ai\s+rater|search\s+quality)\b/i.test(combinedText);
      if (isGenericData && !hasGenuineAiAnnotation) {
        score = 0;
        evidence = [];
      }
    }

    // Clamp score between 0 and 100
    moduleScores[modId] = Math.min(100, Math.max(0, score));
    moduleEvidence[modId] = evidence;
  }

  // Rank modules by score descending
  const sortedModules = Object.entries(moduleScores).sort((a, b) => b[1] - a[1]);
  const highest = sortedModules[0] || ['M3', 0];
  const second = sortedModules[1] || [null, 0];

  // Matched modules exceeding threshold (>= 40)
  const matched_modules = sortedModules
    .filter(([_, score]) => score >= 40)
    .map(([modId]) => modId);

  let primaryTrack = highest[0];
  let primaryScore = highest[1];

  // Determine relevance & confidence tier
  const is_relevant = primaryScore >= 20;
  let confidence_tier = 'none';
  let has_conflict = false;
  const conflicting_tracks = [];
  let classification_reason = '';

  if (!is_relevant) {
    confidence_tier = 'none';
    primaryTrack = 'M3'; // default fallback entry track
    classification_reason = 'Opportunity lacks sufficient relevance signals for UpShift M1-M6 tracks (score < 20).';
  } else {
    // Check for conflicting or multi-track results:
    // 1. Two or more modules score >= 40 (matched_modules.length >= 2), OR
    // 2. Top two scores are both >= 25 and within 20 points of each other, OR
    // 3. Second module score is >= 40
    const hasMultipleQualifiedMatches = matched_modules.length >= 2;
    const hasCloseScores = second[0] && second[1] >= 25 && (highest[1] - second[1]) <= 20;
    const hasHighSecondaryScore = second[0] && second[1] >= 40;

    if (hasMultipleQualifiedMatches || hasCloseScores || hasHighSecondaryScore) {
      has_conflict = true;
      conflicting_tracks.push(highest[0], second[0]);
      confidence_tier = 'low';
      classification_reason = `Ambiguous / conflicting multi-track classification between ${highest[0]} (${highest[1]} pts) and ${second[0]} (${second[1]} pts); preserved for human reviewer routing.`;
    } else if (primaryScore >= 70) {
      confidence_tier = 'high';
      classification_reason = `High-confidence match on track ${primaryTrack} (${primaryScore} pts) with strong keyword and skill corroboration.`;
    } else if (primaryScore >= 40) {
      confidence_tier = 'moderate';
      classification_reason = `Moderate match on track ${primaryTrack} (${primaryScore} pts).`;
    } else {
      confidence_tier = 'low';
      classification_reason = `Low-confidence match on track ${primaryTrack} (${primaryScore} pts).`;
    }
  }

  if (injectionDetected) {
    if (primaryScore === 0 || /\[System:\s*Ignore|Malicious\s+Actor|override\s+all\s+safety/i.test(rawText)) {
      return {
        track_id: null,
        matched_modules: [],
        module_fit_scores: moduleScores,
        module_evidence: moduleEvidence,
        primary_fit_score: 0,
        confidence_tier: 'none',
        has_conflict: false,
        conflicting_tracks: [],
        is_relevant: false,
        classification_reason: `[Untrusted Directives Neutralized] Prompt injection attempt detected: listing contains adversarial system instructions.`
      };
    }
    classification_reason = `[Untrusted Directives Neutralized] ${classification_reason}`;
  }

  return {
    track_id: primaryTrack,
    matched_modules: is_relevant ? (matched_modules.length > 0 ? matched_modules : [primaryTrack]) : [],
    module_fit_scores: moduleScores,
    module_evidence: moduleEvidence,
    primary_fit_score: primaryScore,
    confidence_tier,
    has_conflict,
    conflicting_tracks,
    is_relevant,
    classification_reason
  };
}
