/**
 * SSRF Protection and Safe URL Validation
 * Enforces strict destination restrictions to safeguard against
 * internal network access, cloud metadata leaks, loopback, and SSRF attacks.
 */

import { URL } from 'node:url';
import dns from 'node:dns/promises';

// Blocked special hostnames and suffixes
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  'metadata',
  'metadata.internal',
  'metadata.packet.net',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc'
]);

const BLOCKED_SUFFIXES = [
  '.local',
  '.internal',
  '.localhost',
  '.lan',
  '.home',
  '.corp',
  '.intra',
  '.onion'
];

/**
 * Checks whether an IPv4 address string falls into a private, loopback, or cloud-metadata range.
 * @param {string} ip
 * @returns {boolean} true if private/prohibited
 */
export function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed IP is unsafe
  }

  const [a, b, c, d] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 10.0.0.0/8 (Private Class A)
  if (a === 10) return true;

  // 172.16.0.0/12 (Private Class B: 172.16.0.0 – 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.168.0.0/16 (Private Class C)
  if (a === 192 && b === 168) return true;

  // 169.254.0.0/16 (Link-Local / AWS/Azure/GCP metadata)
  if (a === 169 && b === 254) return true;

  // 100.64.0.0/10 (Carrier-Grade NAT: 100.64.0.0 – 100.127.255.255)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && c === 0) return true;

  // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (TEST-NET-1, TEST-NET-2, TEST-NET-3)
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;

  // 198.18.0.0/15 (Network Interconnect Benchmark Testing: 198.18.0.0 - 198.19.255.255)
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved / Future Use)
  if (a >= 224) return true;

  return false;
}

/**
 * Checks whether an IPv6 address string falls into a private or loopback range.
 * @param {string} ip
 * @returns {boolean} true if private/prohibited
 */
export function isPrivateIPv6(ip) {
  const norm = ip.toLowerCase().trim().replace(/^\[|\]$/g, '');

  // Loopback ::1, 0:0:0:0:0:0:0:1, etc.
  if (norm === '::1' || norm === '0:0:0:0:0:0:0:1' || /^0*(:0*)*:1$/.test(norm)) return true;

  // Unspecified ::, 0:0:0:0:0:0:0:0
  if (norm === '::' || norm === '0:0:0:0:0:0:0:0' || /^0*(:0*)+$/.test(norm)) return true;

  // Unique local addresses fc00::/7 (fc00:: - fdff::)
  if (norm.startsWith('fc') || norm.startsWith('fd')) return true;

  // Link-local unicast fe80::/10 (fe80:: - febf::)
  if (norm.startsWith('fe8') || norm.startsWith('fe9') || norm.startsWith('fea') || norm.startsWith('feb')) {
    return true;
  }

  // Multicast ff00::/8
  if (norm.startsWith('ff')) return true;

  // Documentation prefix 2001:db8::/32
  if (norm.startsWith('2001:db8') || norm.startsWith('2001:0db8')) return true;

  // IPv4-mapped IPv6 ::ffff:192.0.2.1
  if (norm.includes('::ffff:')) {
    const ipv4Part = norm.split('::ffff:')[1];
    if (ipv4Part && ipv4Part.includes('.')) {
      return isPrivateIPv4(ipv4Part);
    }
    return true;
  }

  return false;
}

/**
 * Validates a target URL against SSRF and protocol hazards.
 * By default, performs authoritative DNS resolution to guard against DNS rebinding,
 * private IP resolution, and cloud-metadata addresses.
 *
 * @param {string} rawUrl
 * @param {object} [options]
 * @param {boolean} [options.resolveDns=true] - Defaults to true for authoritative DNS checks
 * @param {Function} [options.dnsLookup] - Optional custom lookup function for testing/injection
 * @returns {Promise<{ safe: boolean, reason?: string, url?: string, resolvedIps?: string[] }>}
 */
export async function validateSafeUrl(rawUrl, options = {}) {
  const resolveDns = options.resolveDns !== undefined ? options.resolveDns : true;
  const dnsLookup = options.dnsLookup || dns.lookup;

  if (!rawUrl || typeof rawUrl !== 'string') {
    return { safe: false, reason: 'URL must be a non-empty string' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err) {
    return { safe: false, reason: `Malformed URL: ${err.message}` };
  }

  // 1. Protocol validation: strictly http or https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Forbidden protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. Reject credentials in URL
  if (parsed.username || parsed.password) {
    return { safe: false, reason: 'Credentials in URL are forbidden for security.' };
  }

  // 3. Port validation (allow 80, 443, 8080, 8443, or empty)
  if (parsed.port) {
    const portNum = parseInt(parsed.port, 10);
    const allowedPorts = [80, 443, 8080, 8443];
    if (!allowedPorts.includes(portNum)) {
      return { safe: false, reason: `Port ${portNum} is restricted. Only standard web ports (80, 443, 8080, 8443) are allowed.` };
    }
  }

  // 4. Hostname checks
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { safe: false, reason: `Access to "${hostname}" is blocked by SSRF policy.` };
  }

  for (const suffix of BLOCKED_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return { safe: false, reason: `Access to internal domain ending in "${suffix}" is prohibited.` };
    }
  }

  // 5. Direct IP check
  // IPv4 regex pattern
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  if (ipv4Regex.test(hostname)) {
    if (isPrivateIPv4(hostname)) {
      return { safe: false, reason: `Direct IP "${hostname}" falls within a prohibited private or link-local range.` };
    }
  }

  // IPv6 check (enclosed in brackets in URLs e.g. [::1])
  const cleanIpv6 = hostname.replace(/^\[|\]$/g, '');
  if (cleanIpv6.includes(':')) {
    if (isPrivateIPv6(cleanIpv6)) {
      return { safe: false, reason: `Direct IPv6 "${cleanIpv6}" falls within a prohibited local or private range.` };
    }
  }

  // 6. Authoritative DNS resolution check (protection against DNS rebinding & dual-stack bypasses)
  let resolvedIps = [];
  if (resolveDns) {
    try {
      const addresses = await dnsLookup(hostname, { all: true });
      if (!addresses || addresses.length === 0) {
        return { safe: false, reason: `DNS lookup failed for "${hostname}": No address records returned.` };
      }

      for (const addr of addresses) {
        resolvedIps.push(addr.address);
        if (addr.family === 4 && isPrivateIPv4(addr.address)) {
          return { safe: false, reason: `Domain "${hostname}" resolved to prohibited private IP ${addr.address}.` };
        }
        if (addr.family === 6 && isPrivateIPv6(addr.address)) {
          return { safe: false, reason: `Domain "${hostname}" resolved to prohibited private IPv6 ${addr.address}.` };
        }
      }
    } catch (err) {
      return { safe: false, reason: `DNS lookup failed for "${hostname}": ${err.message}` };
    }
  }

  return { safe: true, url: parsed.href, resolvedIps };
}
