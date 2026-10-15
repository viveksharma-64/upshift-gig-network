/**
 * URL Scheme Allowlist & Sanitization Utility
 *
 * Enforces strict protocol allowlisting (http: and https: only) for all untrusted
 * gig links, external application URLs, and reviewer inputs.
 *
 * Rejects and neutralizes unsafe schemes such as:
 * - javascript: (Cross-Site Scripting via href)
 * - data: (DOM XSS / phishing)
 * - vbscript: (Legacy script execution)
 * - file: (Local file exposure)
 * - malformed / non-HTTP protocols
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Checks whether a given URL string safely uses only allowed HTTP or HTTPS protocols.
 *
 * @param {any} rawUrl - Untrusted URL input
 * @returns {boolean} true if safe http: or https: URL
 */
export function isSafeHttpUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;

  const trimmed = rawUrl.trim();
  if (!trimmed) return false;

  // Immediate rejection of dangerous protocol signatures (including control chars or whitespace evasion)
  if (/^[\s\x00-\x1f]*(?:javascript|data|vbscript|file):/i.test(trimmed)) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return false;
    }

    // Hostname must exist and be non-empty
    if (!parsed.hostname || parsed.hostname.trim().length === 0) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitizes an untrusted URL for safe rendering in HTML anchor tags (<a href="...">).
 * If the URL is invalid or uses a forbidden scheme, returns the safe fallback.
 *
 * @param {any} rawUrl - Untrusted URL input
 * @param {string|null} [fallback=null] - Safe fallback value
 * @returns {string|null} Safe HTTP/HTTPS URL or fallback
 */
export function sanitizeExternalUrl(rawUrl, fallback = null) {
  if (isSafeHttpUrl(rawUrl)) {
    return rawUrl.trim();
  }
  return fallback;
}

/**
 * Specifically returns a safe href string for JSX anchor links, defaulting to '#'
 * if the URL does not pass protocol validation.
 *
 * @param {any} rawUrl
 * @param {string} [fallback='#']
 * @returns {string} Safe href
 */
export function sanitizeHref(rawUrl, fallback = '#') {
  if (isSafeHttpUrl(rawUrl)) {
    return rawUrl.trim();
  }
  return fallback;
}
