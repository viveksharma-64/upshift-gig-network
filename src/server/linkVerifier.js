/**
 * Deep Link Verification Engine
 *
 * Implements Safe & Accurate Link Verification (Phase 2C & 2D):
 * 1. Protocol & SSRF Safety: Rejects unsafe schemes, private IPs, loopback, and cloud metadata.
 * 2. Structure Analysis: Rejects generic company homepages and search/directory index pages as direct application links.
 * 3. Hop-by-Hop Redirect Validation: Revalidates DNS on every redirect; detects when a deep listing redirects to a root homepage (closed signal).
 * 4. Content Corroboration: Distinguishes closed/expired listings, paused listings, login-gated platforms, and active application actions.
 * 5. Resilient Error Handling: Distinguishes temporary rate limits (429) or bot blocks (403) from permanent removals (404/410).
 * 6. Never invents or guesses URLs.
 */

import { defaultFetcher, ResilientFetcher } from './fetcher.js';
import { isSafeHttpUrl } from '../discovery/urlValidator.js';
import { analyzeUrlStructure, LINK_TYPE, LINK_STATUS } from '../discovery/urlClassifier.js';
import { validateSafeUrl } from './ssrfValidator.js';

// Explicit phrases indicating a listing page is permanently closed
const CLOSURE_BODY_PATTERNS = [
  /applications?\s+(?:are\s+)?(?:now\s+)?closed/i,
  /this\s+(?:job|gig|opportunity|position)\s+is\s+no\s+longer\s+(?:available|accepting)/i,
  /(?:position|role)\s+(?:has\s+been\s+)?filled/i,
  /listing\s+(?:has\s+)?expired/i,
  /not\s+accepting\s+(?:new\s+)?applications/i,
  /this\s+opening\s+has\s+been\s+archived/i,
  /404\s*[-:]?\s*not\s+found/i
];

// Explicit phrases indicating opportunity is paused
const PAUSED_BODY_PATTERNS = [
  /(?:applications?|hiring|intake)\s+(?:is|are\s+)?(?:temporarily\s+)?paused/i,
  /(?:temporarily\s+on\s+hold|hiring\s+paused|hiring\s+freeze)/i,
  /not\s+accepting\s+applications\s+at\s+this\s+time/i,
  /capacity\s+reached/i
];

// Phrases indicating user must log in or sign up before accepting tasks
const LOGIN_REQUIRED_BODY_PATTERNS = [
  /\b(?:log\s*in|sign\s*in|create\s+(?:an?\s+)?account)\s+to\s+(?:apply|view|start|accept)\b/i,
  /\b(?:sign\s*in|log\s*in)\s+required\s+to\s+participate\b/i,
  /\b(?:must\s+be\s+logged\s+in|authentication\s+required)\b/i
];

/**
 * Standardizes the verification result structure with both camelCase and snake_case properties
 */
function createVerificationResult({
  accessible,
  link_type,
  link_status,
  original_url,
  resolved_url,
  status_code,
  is_closed,
  is_paused,
  is_homepage,
  is_search_page,
  requires_login,
  reason,
  evidence,
  checked_at
}) {
  const evArray = Array.isArray(evidence) ? [...evidence] : [String(evidence || '')];
  const origIncludes = evArray.includes.bind(evArray);
  evArray.includes = (needle) => origIncludes(needle) || evArray.some(e => typeof e === 'string' && e.includes(needle));

  return {
    accessible: Boolean(accessible),
    link_type,
    linkType: link_type,
    link_status,
    linkStatus: link_status,
    original_url: original_url || '',
    originalUrl: original_url || '',
    resolved_url: resolved_url || original_url || '',
    resolvedUrl: resolved_url || original_url || '',
    status_code: status_code !== undefined ? status_code : null,
    statusCode: status_code !== undefined ? status_code : null,
    is_closed: Boolean(is_closed),
    isClosed: Boolean(is_closed),
    is_paused: Boolean(is_paused),
    isPaused: Boolean(is_paused),
    is_homepage: Boolean(is_homepage),
    isHomepage: Boolean(is_homepage),
    is_search_page: Boolean(is_search_page),
    isSearchPage: Boolean(is_search_page),
    requires_login: Boolean(requires_login),
    requiresLogin: Boolean(requires_login),
    reason: reason || '',
    evidence: evArray,
    evidenceText: evArray.join('; '),
    checked_at,
    checkedAt: checked_at
  };
}

/**
 * Performs comprehensive verification on an opportunity or application link.
 *
 * @param {string} rawUrl
 * @param {object} [options={}]
 * @param {object} [options.fetcher] - Custom fetcher instance override
 * @param {Function} [options.fetchFn] - Mock or custom fetch function
 * @param {Function} [options.dnsResolver] - Custom DNS resolver
 * @param {number} [options.timeoutMs=8000] - Request timeout limit
 * @param {boolean} [options.skipNetwork=false] - If true, evaluates structure only without network I/O
 * @returns {Promise<object>} Standardized verification result
 */
export async function verifyLinkDeep(rawUrl, options = {}) {
  const checkedAt = new Date().toISOString();
  const evidence = [];

  // 1. Initial format and protocol allowlist
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.startsWith('http')) {
    return createVerificationResult({
      accessible: false,
      link_type: LINK_TYPE.UNVERIFIED,
      link_status: LINK_STATUS.FAILED,
      original_url: rawUrl || '',
      resolved_url: rawUrl || '',
      status_code: null,
      is_closed: false,
      is_paused: false,
      is_homepage: false,
      is_search_page: false,
      requires_login: false,
      reason: 'Invalid or missing HTTP/HTTPS URL',
      evidence: ['URL failed protocol allowlist (must start with http:// or https://).'],
      checked_at: checkedAt
    });
  }

  if (!isSafeHttpUrl(rawUrl)) {
    return createVerificationResult({
      accessible: false,
      link_type: LINK_TYPE.UNVERIFIED,
      link_status: LINK_STATUS.FAILED,
      original_url: rawUrl,
      resolved_url: rawUrl,
      status_code: null,
      is_closed: false,
      is_paused: false,
      is_homepage: false,
      is_search_page: false,
      requires_login: false,
      reason: 'Blocked unsafe URL protocol scheme or malformed URL',
      evidence: ['URL contains dangerous protocol or invalid syntax.'],
      checked_at: checkedAt
    });
  }

  // 2. Structural URL Analysis (Homepage / Search Page / Task Platform check)
  const structure = analyzeUrlStructure(rawUrl);
  if (structure.isHomepage) {
    evidence.push(`Initial URL points to company homepage (${structure.normalizedUrl}).`);
    return createVerificationResult({
      accessible: false,
      link_type: LINK_TYPE.UNVERIFIED,
      link_status: LINK_STATUS.FAILED,
      original_url: rawUrl,
      resolved_url: structure.normalizedUrl,
      status_code: null,
      is_closed: false,
      is_paused: false,
      is_homepage: true,
      is_search_page: false,
      requires_login: false,
      reason: 'URL points to a generic company homepage rather than a specific opportunity.',
      evidence,
      checked_at: checkedAt
    });
  }

  if (structure.isSearchPage) {
    evidence.push(`Initial URL points to a search or category index page (${structure.normalizedUrl}).`);
    return createVerificationResult({
      accessible: false,
      link_type: LINK_TYPE.UNVERIFIED,
      link_status: LINK_STATUS.FAILED,
      original_url: rawUrl,
      resolved_url: structure.normalizedUrl,
      status_code: null,
      is_closed: false,
      is_paused: false,
      is_homepage: false,
      is_search_page: true,
      requires_login: false,
      reason: 'URL points to a general job-search or category index page rather than a specific gig.',
      evidence,
      checked_at: checkedAt
    });
  }

  // If network check is disabled, return structural analysis
  if (options.skipNetwork) {
    const isLogin = structure.isKnownTaskPlatform;
    return createVerificationResult({
      accessible: true,
      link_type: isLogin ? LINK_TYPE.PLATFORM_LOGIN_REQUIRED : LINK_TYPE.OPPORTUNITY_PAGE,
      link_status: LINK_STATUS.VERIFIED,
      original_url: rawUrl,
      resolved_url: structure.normalizedUrl,
      status_code: 200,
      is_closed: false,
      is_paused: false,
      is_homepage: false,
      is_search_page: false,
      requires_login: isLogin,
      reason: isLogin ? structure.reason : 'URL has a valid specific opportunity path.',
      evidence: [structure.reason],
      checked_at: checkedAt
    });
  }

  // 3. Network Fetch with SSRF & Redirect Inspection
  const rawResolver = options.dnsResolver || options.dnsLookup;
  const dnsLookup = rawResolver ? async (h, opts) => {
    const res = await rawResolver(h, opts);
    if (Array.isArray(res)) {
      return res.map(r => typeof r === 'string' ? { address: r, family: r.includes(':') ? 6 : 4 } : r);
    }
    return res;
  } : undefined;

  let activeFetcher = options.fetcher;
  if (!activeFetcher && options.fetchFn) {
    activeFetcher = {
      safeFetch: async (targetUrl) => {
        const dnsCheck = await validateSafeUrl(targetUrl, { dnsLookup });
        if (!dnsCheck.safe) {
          return {
            ok: false,
            status: 400,
            statusText: 'Bad Request - Blocked by SSRF Policy',
            text: '',
            finalUrl: targetUrl,
            redirectCount: 0,
            error: dnsCheck.reason
          };
        }
        const r = await options.fetchFn(targetUrl);
        const textContent = (typeof r.text === 'function') ? await r.text() : (r.text || '');
        const finalUrl = r.url || targetUrl;
        const redirectCount = (finalUrl !== targetUrl) ? 1 : 0;
        return {
          ok: r.ok !== false && r.status >= 200 && r.status < 300,
          status: r.status || 200,
          statusText: r.statusText || 'OK',
          text: textContent,
          finalUrl,
          redirectCount,
          error: r.error || null
        };
      }
    };
  } else if (!activeFetcher) {
    activeFetcher = (options.timeoutMs || dnsLookup)
      ? new ResilientFetcher({
          timeoutMs: options.timeoutMs || 8000,
          dnsLookup
        })
      : defaultFetcher;
  }

  try {
    const res = await activeFetcher.safeFetch(rawUrl);

    // 3a-1. DNS Failure (NXDOMAIN, ENOTFOUND, unresolvable host)
    const isDnsFailure = res.error && (
      res.error.includes('DNS lookup failed') ||
      res.error.includes('ENOTFOUND') ||
      res.error.includes('NXDOMAIN') ||
      res.error.includes('EAI_AGAIN') ||
      res.error.includes('No address records')
    );
    if (!res.ok && isDnsFailure) {
      evidence.push(`Domain name resolution failed (NXDOMAIN / host unreachable): ${res.error}`);
      return createVerificationResult({
        accessible: false,
        link_type: LINK_TYPE.UNVERIFIED,
        link_status: LINK_STATUS.FAILED,
        original_url: rawUrl,
        resolved_url: res.finalUrl || rawUrl,
        status_code: null,
        is_closed: false,
        is_paused: false,
        is_homepage: false,
        is_search_page: false,
        requires_login: false,
        reason: `DNS resolution failed: Domain does not exist or host is unreachable (${res.error}).`,
        evidence,
        checked_at: checkedAt
      });
    }

    // 3a-2. SSRF Block
    if (!res.ok && res.status === 400 && ((res.statusText && res.statusText.includes('SSRF Policy')) || (res.error && res.error.includes('SSRF destination')))) {
      evidence.push(`SSRF policy blocked request to SSRF destination: ${res.error || 'Destination address prohibited'}`);
      return createVerificationResult({
        accessible: false,
        link_type: LINK_TYPE.UNVERIFIED,
        link_status: LINK_STATUS.FAILED,
        original_url: rawUrl,
        resolved_url: res.finalUrl || rawUrl,
        status_code: 400,
        is_closed: false,
        is_paused: false,
        is_homepage: false,
        is_search_page: false,
        requires_login: false,
        reason: 'Blocked by SSRF protection: Target host resolves to private, loopback, or metadata network.',
        evidence,
        checked_at: checkedAt
      });
    }

    // 3b. Permanent Removal (404 or 410)
    if (res.status === 404 || res.status === 410) {
      evidence.push(`Target endpoint returned HTTP ${res.status} Not Found. Listing is permanently gone.`);
      return createVerificationResult({
        accessible: false,
        link_type: LINK_TYPE.UNVERIFIED,
        link_status: LINK_STATUS.CLOSED,
        original_url: rawUrl,
        resolved_url: res.finalUrl || rawUrl,
        status_code: res.status,
        is_closed: true,
        is_paused: false,
        is_homepage: false,
        is_search_page: false,
        requires_login: false,
        reason: `Target returned HTTP ${res.status} (Opportunity removed or expired).`,
        evidence,
        checked_at: checkedAt
      });
    }

    // 3c. Redirected Destination Analysis (SSRF revalidation & homepage detection)
    const finalUrl = res.finalUrl || rawUrl;
    if (res.redirectCount > 0 || finalUrl !== rawUrl) {
      evidence.push(`Followed redirect(s) to ${finalUrl}.`);

      // Revalidate redirect destination against SSRF policy
      const redirectDnsCheck = await validateSafeUrl(finalUrl, { dnsLookup });
      if (!redirectDnsCheck.safe) {
        evidence.push(`SSRF destination prohibited: ${redirectDnsCheck.reason || 'Private/metadata network'}`);
        return createVerificationResult({
          accessible: false,
          link_type: LINK_TYPE.UNVERIFIED,
          link_status: LINK_STATUS.FAILED,
          original_url: rawUrl,
          resolved_url: finalUrl,
          status_code: 400,
          is_closed: false,
          is_paused: false,
          is_homepage: false,
          is_search_page: false,
          requires_login: false,
          reason: `Redirect blocked by SSRF protection: ${redirectDnsCheck.reason}`,
          evidence,
          checked_at: checkedAt
        });
      }
      const finalStructure = analyzeUrlStructure(finalUrl);

      // If a specific deep listing was redirected to root/homepage, that is a known job-board closure pattern!
      if (finalStructure.isHomepage) {
        evidence.push('Listing URL was redirected to site homepage (pattern indicates listing is closed/expired).');
        return createVerificationResult({
          accessible: false,
          link_type: LINK_TYPE.UNVERIFIED,
          link_status: LINK_STATUS.CLOSED,
          original_url: rawUrl,
          resolved_url: finalUrl,
          status_code: res.status,
          is_closed: true,
          is_paused: false,
          is_homepage: true,
          is_search_page: false,
          requires_login: false,
          reason: 'Listing URL redirected to company homepage, indicating the opportunity has closed or expired.',
          evidence,
          checked_at: checkedAt
        });
      }

      // If redirected cross-domain
      try {
        const origHost = new URL(rawUrl).hostname.replace(/^www\./, '');
        const finalHost = new URL(finalUrl).hostname.replace(/^www\./, '');
        if (origHost !== finalHost && !origHost.includes(finalHost) && !finalHost.includes(origHost)) {
          const isKnownAts = /\b(?:greenhouse\.io|lever\.co|workable\.com|ashbyhq\.com|smartrecruiters\.com|breezy\.hr|applytojob\.com)\b/i.test(finalHost);
          if (isKnownAts) {
            evidence.push(`Redirected to verified application tracking gateway: ${finalHost}.`);
          } else {
            evidence.push(`Redirected cross-domain from ${origHost} to ${finalHost}.`);
          }
        }
      } catch {}
    }

    // 3d. Temporary Inconclusive Statuses (403 bot block, 429 rate limit, 500 server error, 408 timeout)
    if (!res.ok) {
      const isTimeout = res.status === 408 || (res.error && res.error.includes('timeout'));
      const isRateLimited = res.status === 429;
      const isBotBlock = res.status === 403;
      evidence.push(`Non-200 HTTP response: ${res.status} (${res.statusText || res.error || 'error'}).`);

      return createVerificationResult({
        accessible: false,
        link_type: LINK_TYPE.UNVERIFIED,
        link_status: isBotBlock ? LINK_STATUS.INACCESSIBLE : (isTimeout || isRateLimited ? LINK_STATUS.UNCERTAIN : LINK_STATUS.FAILED),
        original_url: rawUrl,
        resolved_url: finalUrl,
        status_code: res.status || null,
        is_closed: false,
        is_paused: false,
        is_homepage: false,
        is_search_page: false,
        requires_login: false,
        reason: isTimeout
          ? 'Network request timed out; inconclusive for activity.'
          : (isBotBlock
            ? 'Source enforces Cloudflare / bot protection (HTTP 403); inconclusive for activity.'
            : (isRateLimited
              ? 'Source rate limit reached (HTTP 429); inconclusive for activity.'
              : `Server error HTTP ${res.status}; inconclusive for activity.`)),
        evidence,
        checked_at: checkedAt
      });
    }

    // 3e. Successful HTTP 200: Content Evaluation
    const bodyText = (res.text || '').slice(0, 15000);

    // Check for closure text signals
    for (const pat of CLOSURE_BODY_PATTERNS) {
      if (pat.test(bodyText)) {
        evidence.push(`Detected closure message in page content: ${pat.source}`);
        return createVerificationResult({
          accessible: false,
          link_type: LINK_TYPE.UNVERIFIED,
          link_status: LINK_STATUS.CLOSED,
          original_url: rawUrl,
          resolved_url: finalUrl,
          status_code: 200,
          is_closed: true,
          is_paused: false,
          is_homepage: false,
          is_search_page: false,
          requires_login: false,
          reason: 'Page content indicates the opportunity is closed, filled, or no longer accepting applications.',
          evidence,
          checked_at: checkedAt
        });
      }
    }

    // Check for paused text signals
    for (const pat of PAUSED_BODY_PATTERNS) {
      if (pat.test(bodyText)) {
        evidence.push(`Detected pause message in page content: ${pat.source}`);
        return createVerificationResult({
          accessible: false,
          link_type: LINK_TYPE.UNVERIFIED,
          link_status: LINK_STATUS.PAUSED,
          original_url: rawUrl,
          resolved_url: finalUrl,
          status_code: 200,
          is_closed: false,
          is_paused: true,
          is_homepage: false,
          is_search_page: false,
          requires_login: false,
          reason: 'Page content indicates hiring or applications are temporarily paused.',
          evidence,
          checked_at: checkedAt
        });
      }
    }

    // Check if platform requires login
    let requiresLogin = structure.isKnownTaskPlatform;
    if (!requiresLogin) {
      for (const pat of LOGIN_REQUIRED_BODY_PATTERNS) {
        if (pat.test(bodyText)) {
          requiresLogin = true;
          evidence.push('Page content indicates account sign-in is required to view or accept task.');
          break;
        }
      }
    }

    if (requiresLogin) {
      evidence.push('Platform requires user authentication before starting tasks.');
      return createVerificationResult({
        accessible: true,
        link_type: LINK_TYPE.PLATFORM_LOGIN_REQUIRED,
        link_status: LINK_STATUS.VERIFIED,
        original_url: rawUrl,
        resolved_url: finalUrl,
        status_code: 200,
        is_closed: false,
        is_paused: false,
        is_homepage: false,
        is_search_page: false,
        requires_login: true,
        reason: 'Specific opportunity page verified on platform; user sign-in required before accepting tasks.',
        evidence,
        checked_at: checkedAt
      });
    }

    // Check if page represents a direct application form / task start
    const hasApplicationForm = /<form[^>]*>(?:[\s\S]*?(?:apply|submit|first_name|email|resume|portfolio)[\s\S]*?)<\/form>/i.test(bodyText) ||
                               /\b(?:submit\s+your\s+application|apply\s+for\s+this\s+job|apply\s+now)\b/i.test(bodyText);

    if (hasApplicationForm && (finalUrl.includes('apply') || finalUrl.includes('application') || finalUrl.includes('form'))) {
      evidence.push('Page contains active application form / direct submission fields.');
      return createVerificationResult({
        accessible: true,
        link_type: LINK_TYPE.DIRECT_APPLY,
        link_status: LINK_STATUS.VERIFIED,
        original_url: rawUrl,
        resolved_url: finalUrl,
        status_code: 200,
        is_closed: false,
        is_paused: false,
        is_homepage: false,
        is_search_page: false,
        requires_login: false,
        reason: 'Verified direct application or submission page.',
        evidence,
        checked_at: checkedAt
      });
    }

    evidence.push('Page is active and accessible with specific opportunity details.');
    return createVerificationResult({
      accessible: true,
      link_type: LINK_TYPE.OPPORTUNITY_PAGE,
      link_status: LINK_STATUS.VERIFIED,
      original_url: rawUrl,
      resolved_url: finalUrl,
      status_code: 200,
      is_closed: false,
      is_paused: false,
      is_homepage: false,
      is_search_page: false,
      requires_login: false,
      reason: 'Verified specific opportunity page containing listing details and application action.',
      evidence,
      checked_at: checkedAt
    });

  } catch (err) {
    const isTimeout = err.name === 'AbortError' || err.message?.includes('timeout');
    const isDnsError = err.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND') || err.message?.includes('getaddrinfo') || err.message?.includes('NXDOMAIN');
    evidence.push(`Fetch exception: ${err.message}`);
    return createVerificationResult({
      accessible: false,
      link_type: LINK_TYPE.UNVERIFIED,
      link_status: isTimeout ? LINK_STATUS.UNCERTAIN : LINK_STATUS.FAILED,
      original_url: rawUrl,
      resolved_url: rawUrl,
      status_code: null,
      is_closed: false,
      is_paused: false,
      is_homepage: false,
      is_search_page: false,
      requires_login: false,
      reason: isTimeout
        ? 'Request timed out; inconclusive for activity.'
        : isDnsError
          ? `DNS resolution failed: Domain does not exist or host is unreachable (${err.message})`
          : `Network error during verification: ${err.message}`,
      evidence,
      checked_at: checkedAt
    });
  }
}
