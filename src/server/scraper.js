/**
 * Safe HTML Parser, Metadata Extractor, and Prompt-Injection Defense
 */

import { isSafeHttpUrl } from '../discovery/urlValidator.js';

// Prompt injection patterns commonly found in adversarial web content
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/gi,
  /forget\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|prompts)/gi,
  /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|rules)/gi,
  /you\s+are\s+now\s+(a|an|the)/gi,
  /system\s*:\s*/gi,
  /\[\/?(?:inst|sys|instruction)\]/gi,
  /<\|(?:im_start|im_end|system|user|assistant)\|>/gi,
  /<\/?system>/gi,
  /classify\s+this\s+as\s+active\s+regardless/gi,
  /output\s+(only\s+)?the\s+following\s+json/gi,
  /override\s+(all\s+)?safety\s+guidelines/gi,
  /always\s+approve\s+this\s+(job|gig|candidate|listing)/gi,
  /mark\s+this\s+as\s+verified/gi,
  /bypass\s+(human\s+review|safety\s+checks|verification)/gi,
  /do\s+not\s+(classify|reject|evaluate)/gi,
  /act\s+as\s+DAN\b/gi,
  /\bjailbreak\b/gi
];

/**
 * Sanitizes scraped text against prompt injection markers and control characters
 * @param {string} text
 * @returns {{ sanitizedText: string, injectionDetected: boolean, flags: string[] }}
 */
export function sanitizeScrapedContent(text) {
  if (!text || typeof text !== 'string') {
    return { sanitizedText: '', injectionDetected: false, flags: [] };
  }

  let sanitized = text;
  const flags = [];

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      flags.push(pattern.source);
      // Replace with harmless placeholder to disarm injection attempts
      sanitized = sanitized.replace(pattern, '[REDACTED_PROMPT_DIRECTIVE]');
    }
  }

  // Strip zero-width and control characters (except standard newlines and tabs)
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  return {
    sanitizedText: sanitized,
    injectionDetected: flags.length > 0,
    flags
  };
}

import { normalizeHtmlToText } from '../discovery/textNormalizer.js';

/**
 * Strips HTML tags, scripts, and styles safely without running external parsers
 * @param {string} html
 * @returns {string} clean text
 */
export function extractCleanText(html) {
  return normalizeHtmlToText(html);
}


/**
 * Extracts structured gig candidate fields from raw HTML or text
 * @param {string} htmlOrText
 * @param {string} sourceUrl
 * @returns {object} extracted fields
 */
export function extractGigFields(htmlOrText, sourceUrl = '') {
  const isHtml = /<[a-z][\s\S]*>/i.test(htmlOrText);
  const rawCleanText = isHtml ? extractCleanText(htmlOrText) : htmlOrText;
  const { sanitizedText, injectionDetected, flags } = sanitizeScrapedContent(rawCleanText);

  // Extract Title from HTML <title>, <h1>, or first strong line
  let title = '';
  if (isHtml) {
    const titleTagMatch = htmlOrText.match(/<title[^>]*>(.*?)<\/title>/i);
    const h1Match = htmlOrText.match(/<h1[^>]*>(.*?)<\/h1>/i);

    if (h1Match) {
      title = extractCleanText(h1Match[1]);
    } else if (titleTagMatch) {
      // Titles often format as "Job Title - Company Name | Platform"
      const rawTitle = extractCleanText(titleTagMatch[1]);
      title = rawTitle.split(/[-|–•]/)[0].trim();
    }
  }

  if (!title) {
    const firstLines = sanitizedText.split('\n').slice(0, 3);
    title = firstLines.find(l => l.length >= 5 && l.length <= 100) || 'Untitled Gig Opportunity';
  }

  // Extract Organization from text or meta tag
  let organization = '';
  if (isHtml) {
    const ogSiteName = htmlOrText.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i);
    const companyClass = htmlOrText.match(/<[^>]+class=["'][^"']*(?:company|employer|organization|client)[^"']*["'][^>]*>([^<]+)<\/[^>]+>/i);
    if (ogSiteName) {
      organization = ogSiteName[1].trim();
    } else if (companyClass) {
      organization = extractCleanText(companyClass[1]);
    }
  }

  if (!organization) {
    // Heuristic: search for patterns like "at CompanyName" or "Company: XYZ"
    const companyMatch = sanitizedText.match(/(?:at|company|employer|client):\s*([A-Za-z0-9&. ]{2,40})/i);
    if (companyMatch) organization = companyMatch[1].trim();
  }

  // Extract Compensation
  let payment_amount = 'Unspecified';
  let min_amount = 0;
  let max_amount = 0;
  let compensation_type = 'hourly';
  let currency = 'USD';

  // Currency matches: $, €, £, ₹, USD, EUR, GBP, INR
  const compMatch = sanitizedText.match(/(?:[$€£₹]|USD|EUR|GBP|INR)\s*(\d+k|\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:[-–to]+\s*(?:[$€£₹]|USD|EUR|GBP|INR)?\s*(\d+k|\d{1,3}(?:,\d{3})*(?:\.\d+)?))?(?:\s*(?:\/|\s+per\s+)?\s*(hr|hour|hourly|mo|month|monthly|yr|year|annually|project|flat|fixed))?/i) ||
                    sanitizedText.match(/(\d+k|\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(?:[-–to]+\s*(\d+k|\d{1,3}(?:,\d{3})*(?:\.\d+)?))?\s*(?:USD|EUR|GBP|INR)\s*(?:\/|\s+per\s+)?\s*(hr|hour|hourly|mo|month|monthly|yr|year|annually|project|flat|fixed)/i);

  if (compMatch) {
    payment_amount = compMatch[0].trim();
    const parseAmount = (val) => {
      if (!val) return 0;
      const clean = val.replace(/,/g, '').toLowerCase().trim();
      if (clean.endsWith('k')) {
        return (parseFloat(clean.slice(0, -1)) || 0) * 1000;
      }
      return parseFloat(clean) || 0;
    };

    min_amount = parseAmount(compMatch[1]);
    max_amount = compMatch[2] ? parseAmount(compMatch[2]) : min_amount;

    const unit = (compMatch[3] || '').toLowerCase();
    if (['hr', 'hour', 'hourly'].includes(unit)) {
      compensation_type = 'hourly';
    } else if (['mo', 'month', 'monthly'].includes(unit)) {
      compensation_type = 'monthly';
    } else if (['yr', 'year', 'annually'].includes(unit)) {
      compensation_type = 'annual';
    } else if (['project', 'flat', 'fixed'].includes(unit)) {
      compensation_type = 'fixed';
    } else if (min_amount >= 5000) {
      compensation_type = 'annual';
    } else if (min_amount > 0 && min_amount < 500) {
      compensation_type = 'hourly';
    }

    if (compMatch[0].includes('€') || compMatch[0].includes('EUR')) currency = 'EUR';
    if (compMatch[0].includes('£') || compMatch[0].includes('GBP')) currency = 'GBP';
    if (compMatch[0].includes('₹') || compMatch[0].includes('INR')) currency = 'INR';
  }

  // Extract Responsibilities & Requirements sections
  let responsibilities = '';
  let requirements = '';

  const respMatch = sanitizedText.match(/(?:responsibilities|what you(?:'ll| will) do|key tasks|duties):?([\s\S]{20,600}?)(?=(?:requirements|qualifications|benefits|compensation|about you|$))/i);
  if (respMatch && respMatch[1]) responsibilities = respMatch[1].trim();

  const reqMatch = sanitizedText.match(/(?:requirements|qualifications|what you need|skills required|about you):?([\s\S]{20,600}?)(?=(?:responsibilities|benefits|compensation|how to apply|$))/i);
  if (reqMatch && reqMatch[1]) requirements = reqMatch[1].trim();

  // Extract Application URL
  let application_url = isSafeHttpUrl(sourceUrl) ? sourceUrl : '';
  if (isHtml) {
    const applyLinkMatch = htmlOrText.match(/<a[^>]*href=["']([^"']+)["'][^>]*>(?:apply|apply now|submit application|apply for this job)<\/a>/i);
    if (applyLinkMatch) {
      try {
        const resolved = new URL(applyLinkMatch[1], sourceUrl).href;
        if (isSafeHttpUrl(resolved)) {
          application_url = resolved;
        }
      } catch {
        // keep fallback
      }
    }
  }

  // Location / Remote status
  let location = 'Remote';
  let work_arrangement = 'remote';
  if (/hybrid/i.test(sanitizedText)) {
    work_arrangement = 'hybrid';
    location = 'Hybrid';
  } else if (/on-site|onsite|in-office/i.test(sanitizedText)) {
    work_arrangement = 'onsite';
    location = 'On-site';
  }

  // Extract Deliverables & Proof Spec
  let deliverables = '';
  const delivMatch = sanitizedText.match(/(?:deliverables|key deliverables|expected outputs?|scope of work|what you(?:'ll| will) (?:deliver|produce|create|build)):?([\s\S]{20,600}?)(?=(?:requirements|responsibilities|compensation|proof|about you|how to apply|$))/i);
  if (delivMatch && delivMatch[1]) deliverables = delivMatch[1].trim();

  let proof_spec = '';
  const proofMatch = sanitizedText.match(/(?:proof(?: of work| specification| requirements?)?|verification specification|submission requirements?|how to prove|portfolio required|loom video|github repo|code sample):?([\s\S]{10,400}?)(?=(?:requirements|responsibilities|compensation|benefits|about you|$))/i);
  if (proofMatch && proofMatch[1]) proof_spec = proofMatch[1].trim();

  // Extract Short Description & Overview
  const cleanParagraphs = sanitizedText.split('\n\n').map(p => p.trim()).filter(p => p.length > 20);
  const overview = cleanParagraphs.slice(0, 3).join('\n\n') || sanitizedText.slice(0, 500);
  const short_description = cleanParagraphs[0] ? cleanParagraphs[0].slice(0, 200).trim() : sanitizedText.slice(0, 200).trim();

  // Local Business detection
  const is_local_business = /\b(?:local business|brick and mortar|storefront|downtown|physical store|on-site client|neighborhood shop)\b/i.test(sanitizedText);

  return {
    title: title.slice(0, 150),
    organization: organization.slice(0, 80) || 'Undisclosed Organization',
    description: sanitizedText.slice(0, 3000),
    short_description,
    overview,
    responsibilities: responsibilities.slice(0, 1000),
    deliverables: deliverables.slice(0, 1000),
    requirements: requirements.slice(0, 1000),
    proof_spec: proof_spec.slice(0, 500),
    payment_amount,
    min_amount,
    max_amount,
    currency,
    compensation_type,
    location,
    work_arrangement,
    is_local_business,
    application_url,
    prompt_injection_detected: injectionDetected,
    prompt_injection_flags: flags
  };
}
