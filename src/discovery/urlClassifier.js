/**
 * URL Classifier & Structure Analyzer
 *
 * Implements granular URL classification to distinguish:
 * 1. Specific opportunity / listing details pages
 * 2. Direct application or task-start endpoints
 * 3. Platform login / onboarding gateways
 * 4. Generic company homepages (to be rejected as direct links)
 * 5. General search / index pages (to be rejected as direct links)
 */

import { isSafeHttpUrl } from './urlValidator.js';

export const LINK_TYPE = Object.freeze({
  DIRECT_APPLY: 'direct_apply',
  OPPORTUNITY_PAGE: 'opportunity_page',
  PLATFORM_LOGIN_REQUIRED: 'platform_login_required',
  UNVERIFIED: 'unverified'
});

export const LINK_STATUS = Object.freeze({
  VERIFIED: 'verified',
  CLOSED: 'closed',
  PAUSED: 'paused',
  UNCERTAIN: 'uncertain',
  FAILED: 'failed',
  INACCESSIBLE: 'inaccessible'
});

// Known freelance / task / AI evaluation platforms that require user login/onboarding
const PLATFORMS_REQUIRING_LOGIN = [
  { domain: 'outlier.ai', name: 'Outlier AI' },
  { domain: 'mindrift.ai', name: 'Mindrift' },
  { domain: 'alignerr.com', name: 'Alignerr' },
  { domain: 'mercor.com', name: 'Mercor' },
  { domain: 'dataannotation.tech', name: 'DataAnnotation' },
  { domain: 'appen.com', name: 'Appen' },
  { domain: 'oneforma.com', name: 'OneForma' },
  { domain: 'telusinternational.ai', name: 'TELUS International' },
  { domain: 'remotasks.com', name: 'Remotasks' },
  { domain: 'huggingface.co', name: 'Hugging Face Spaces/Tasks' },
  { domain: 'kaggle.com', name: 'Kaggle Competitions' },
  { domain: 'devpost.com', name: 'Devpost Hackathons' }
];

// Patterns that identify generic homepages or top-level landings (no specific opportunity)
const HOMEPAGE_PATH_REGEX = /^(\/(?:en|us|uk|de|fr|es|in|ja)?\/?|\/index\.(?:html|php|aspx?)|\/home\/?|\/about\/?|\/welcome\/?)?$/i;

// Patterns that indicate general search, directory index, or category listings (not a single gig)
const SEARCH_OR_INDEX_PATH_REGEX = /^\/(?:jobs|careers|listings|browse|search|explore|all-jobs|vacancies|categories|category|feed|rss)\/?$|(?:\/category\/|\/categories\/|-jobs\/?$|\/search\b|\/find-work\/?$)/i;

/**
 * Inspects a URL to evaluate its structural type (homepage, search page, platform, or specific opportunity)
 * @param {string} rawUrl
 * @returns {{
 *   isValid: boolean,
 *   isHomepage: boolean,
 *   isSearchPage: boolean,
 *   isKnownTaskPlatform: boolean,
 *   platformName: string|null,
 *   normalizedUrl: string,
 *   reason: string
 * }}
 */
export function analyzeUrlStructure(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || !isSafeHttpUrl(rawUrl)) {
    return {
      isValid: false,
      isHomepage: false,
      isSearchPage: false,
      isKnownTaskPlatform: false,
      platformName: null,
      normalizedUrl: '',
      reason: 'Invalid or unsafe HTTP/HTTPS URL'
    };
  }

  try {
    const parsed = new URL(rawUrl.trim());
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = parsed.pathname;
    const search = parsed.search;

    // 1. Check if root domain or generic homepage
    const isRootOrEmptyPath = HOMEPAGE_PATH_REGEX.test(pathname) && (!search || search === '?');
    if (isRootOrEmptyPath) {
      return {
        isValid: true,
        isHomepage: true,
        isSearchPage: false,
        isKnownTaskPlatform: false,
        requiresLogin: false,
        platformName: null,
        linkType: LINK_TYPE.UNVERIFIED,
        link_type: LINK_TYPE.UNVERIFIED,
        normalizedUrl: parsed.href,
        reason: `Points to company root/homepage (${hostname}) rather than a specific opportunity.`
      };
    }

    // 2. Check for search results or category index pages (excluding deep links with explicit listing IDs)
    const hasSpecificListingParam = /[?&](?:externalKey|jobId|job_id|opportunityId|listingId|post_id)=/i.test(search);
    const hasSearchQuery = /[?&](?:q|query|search|keywords|keyword)=/i.test(search);
    const isDirectoryIndex = !hasSpecificListingParam && (SEARCH_OR_INDEX_PATH_REGEX.test(pathname) || (hasSearchQuery && pathname.length <= 15) || /\/jobs\/?$/i.test(pathname));
    if (isDirectoryIndex) {
      return {
        isValid: true,
        isHomepage: false,
        isSearchPage: true,
        isKnownTaskPlatform: false,
        requiresLogin: false,
        platformName: null,
        linkType: LINK_TYPE.UNVERIFIED,
        link_type: LINK_TYPE.UNVERIFIED,
        normalizedUrl: parsed.href,
        reason: `Points to a general search or category index page (${pathname}) rather than a specific listing.`
      };
    }

    // 3. Check for recognized task/evaluation platform requiring authentication
    const matchedPlatform = PLATFORMS_REQUIRING_LOGIN.find(p => hostname === p.domain || hostname.endsWith(`.${p.domain}`));
    if (matchedPlatform) {
      return {
        isValid: true,
        isHomepage: false,
        isSearchPage: false,
        isKnownTaskPlatform: true,
        requiresLogin: true,
        platformName: matchedPlatform.name,
        linkType: LINK_TYPE.PLATFORM_LOGIN_REQUIRED,
        link_type: LINK_TYPE.PLATFORM_LOGIN_REQUIRED,
        normalizedUrl: parsed.href,
        reason: `Recognized opportunity platform (${matchedPlatform.name}); user authentication required before task start.`
      };
    }

    // 4. Check for direct apply vs specific opportunity page
    const isDirectApply = /\/(?:apply|application|submit|apply-now|task\/start)\b/i.test(pathname) || /[?&](?:action=apply|step=apply)/i.test(search);
    const linkType = isDirectApply ? LINK_TYPE.DIRECT_APPLY : LINK_TYPE.OPPORTUNITY_PAGE;

    return {
      isValid: true,
      isHomepage: false,
      isSearchPage: false,
      isKnownTaskPlatform: false,
      requiresLogin: false,
      platformName: null,
      linkType,
      link_type: linkType,
      normalizedUrl: parsed.href,
      reason: isDirectApply ? 'Points to a verified direct application or task submission endpoint.' : 'Points to a specific deep listing or destination page.'
    };
  } catch (err) {
    return {
      isValid: false,
      isHomepage: false,
      isSearchPage: false,
      isKnownTaskPlatform: false,
      requiresLogin: false,
      platformName: null,
      linkType: LINK_TYPE.UNVERIFIED,
      link_type: LINK_TYPE.UNVERIFIED,
      normalizedUrl: '',
      reason: `Malformed URL structure: ${err.message}`
    };
  }
}
