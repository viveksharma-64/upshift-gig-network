/**
 * Resilient HTTP Fetcher with SSRF Guard, Rate Limiting, Size Limits, and Safe Redirects
 */

import { validateSafeUrl } from './ssrfValidator.js';

// Domain rate-limiting tracker (last request timestamp per origin)
const originLastRequestMap = new Map();

export class ResilientFetcher {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 10000;
    this.maxBytes = options.maxBytes || 5 * 1024 * 1024; // 5MB max response (permits full JSON feeds)
    this.maxRedirects = options.maxRedirects || 5;
    this.minDomainDelayMs = options.minDomainDelayMs || 500; // polite 500ms delay per origin
    this.userAgent = options.userAgent || 'UpShiftGigDiscovery/1.0 (+https://upshift.work/discovery-bot)';
    this.resolveDns = options.resolveDns !== undefined ? options.resolveDns : true;
    this.dnsLookup = options.dnsLookup || null;
  }

  /**
   * Applies polite crawl delay per domain
   * @param {string} urlString
   */
  async politeThrottle(urlString) {
    try {
      const origin = new URL(urlString).origin;
      const last = originLastRequestMap.get(origin) || 0;
      const now = Date.now();
      const elapsed = now - last;
      if (elapsed < this.minDomainDelayMs) {
        await new Promise(res => setTimeout(res, this.minDomainDelayMs - elapsed));
      }
      originLastRequestMap.set(origin, Date.now());
    } catch {
      // Ignore origin parse error; will be caught in validation
    }
  }

  /**
   * Safely fetches a remote URL with full SSRF validation and redirect protection
   * @param {string} targetUrl
   * @param {RequestInit & { resolveDns?: boolean, dnsLookup?: Function }} [fetchOptions={}]
   * @returns {Promise<{ ok: boolean, status: number, statusText: string, text: string, finalUrl: string, headers: Headers, redirectCount: number, error?: string }>}
   */
  async safeFetch(targetUrl, fetchOptions = {}) {
    let currentUrl = targetUrl;
    let redirectCount = 0;

    while (redirectCount <= this.maxRedirects) {
      // 1. Validate target URL against SSRF policy with authoritative DNS resolution
      const validation = await validateSafeUrl(currentUrl, {
        resolveDns: fetchOptions.resolveDns !== undefined ? fetchOptions.resolveDns : this.resolveDns,
        dnsLookup: fetchOptions.dnsLookup || this.dnsLookup
      });
      if (!validation.safe) {
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request - Blocked by SSRF Policy',
          text: '',
          finalUrl: currentUrl,
          headers: new Headers(),
          redirectCount,
          error: validation.reason
        };
      }

      // 2. Polite domain throttling
      await this.politeThrottle(currentUrl);

      // 3. Prepare timeout controller
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(currentUrl, {
          ...fetchOptions,
          redirect: 'manual', // handle redirects manually for hop-by-hop SSRF validation
          signal: controller.signal,
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            ...(fetchOptions.headers || {})
          }
        });
        clearTimeout(timer);

        // 4. Handle Redirects (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) {
            return {
              ok: false,
              status: response.status,
              statusText: 'Redirect missing Location header',
              text: '',
              finalUrl: currentUrl,
              headers: response.headers,
              redirectCount,
              error: 'Redirect missing location header'
            };
          }

          // Resolve relative redirect against current URL
          const nextUrl = new URL(location, currentUrl).href;
          redirectCount++;
          currentUrl = nextUrl;
          continue;
        }

        // 5. Read response with byte size bounding
        const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
        if (contentLength > this.maxBytes) {
          return {
            ok: false,
            status: 413,
            statusText: 'Payload Too Large',
            text: '',
            finalUrl: currentUrl,
            headers: response.headers,
            redirectCount,
            error: `Content-Length ${contentLength} exceeds limit of ${this.maxBytes} bytes`
          };
        }

        const rawText = await response.text();
        const boundedText = rawText.slice(0, this.maxBytes);

        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          text: boundedText,
          finalUrl: currentUrl,
          headers: response.headers,
          redirectCount
        };

      } catch (err) {
        clearTimeout(timer);
        const isAbort = err.name === 'AbortError' || controller.signal.aborted;
        return {
          ok: false,
          status: isAbort ? 408 : 500,
          statusText: isAbort ? 'Request Timeout' : 'Fetch Failed',
          text: '',
          finalUrl: currentUrl,
          headers: new Headers(),
          redirectCount,
          error: isAbort ? `Request exceeded timeout limit of ${this.timeoutMs}ms` : err.message
        };
      }
    }

    return {
      ok: false,
      status: 310,
      statusText: 'Too many redirects',
      text: '',
      finalUrl: currentUrl,
      headers: new Headers(),
      redirectCount,
      error: `Exceeded maximum redirect limit of ${this.maxRedirects}`
    };
  }
}

export const defaultFetcher = new ResilientFetcher();
