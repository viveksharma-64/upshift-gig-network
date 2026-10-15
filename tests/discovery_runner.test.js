/**
 * Discovery Runner & Queue Integration Test Suite
 *
 * Implements verification for all 10 core regression requirements:
 * 1. Unauthenticated discovery request returns 401.
 * 2. Learner discovery request returns 403.
 * 3. Valid administrator login/token permits discovery.
 * 4. Invalid or expired tokens are rejected with a useful response.
 * 5. Sync Store works with valid administrator authentication.
 * 6. Remote 401 preserves all existing local candidates and displays a sign-in/actionable warning.
 * 7. Successful discovery adds candidates to the actual webpage queue.
 * 8. Refresh and navigation preserve discovered candidates.
 * 9. Repeated runs do not create duplicates.
 * 10. Production mode rejects development-only tokens.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleDiscoveryRunRequest,
  handleCandidateApiRequest,
  resetDiscoveryLock,
  verifyTokenAndRole,
  verifyAdminAuthorization
} from '../src/server/candidateApiHandler.js';
import { JsonCandidateRepository } from '../src/server/candidateRepository.js';
import { CANDIDATE_STATUS } from '../src/discovery/types.js';
import {
  runLiveDiscovery,
  fetchCandidateQueue,
  loadLocalCandidates,
  saveLocalCandidates
} from '../src/discovery/candidateStore.js';
import { supabase } from '../src/lib/supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRATCH_DIR = path.resolve(__dirname, '../.tmp_test_runner');

function createMockHttp(method = 'POST', headers = {}, body = null) {
  let statusCode = 200;
  let responseBody = '';
  const responseHeaders = {};
  const res = {
    setHeader: (k, v) => { responseHeaders[k.toLowerCase()] = v; },
    getHeader: (k) => responseHeaders[k.toLowerCase()],
    set statusCode(code) { statusCode = code; },
    get statusCode() { return statusCode; },
    end: (content) => { responseBody = content; }
  };
  return {
    req: { method, headers, body },
    res,
    getStatusCode: () => statusCode,
    getBody: () => {
      try { return JSON.parse(responseBody); } catch { return responseBody; }
    }
  };
}

function createMockAuthClient() {
  return {
    auth: {
      async getUser(token) {
        if (token === 'admin-jwt-token') {
          return { data: { user: { id: 'usr-admin-1', email: 'admin@upshift.test' } }, error: null };
        }
        if (token === 'learner-jwt-token') {
          return { data: { user: { id: 'usr-learner-1', email: 'learner@upshift.test' } }, error: null };
        }
        if (token === 'expired-jwt-token') {
          return { data: { user: null }, error: { message: 'JWT expired' } };
        }
        return { data: { user: null }, error: { message: 'Invalid authentication credentials' } };
      }
    },
    from(table) {
      return {
        select() {
          return {
            eq(col, val) {
              return {
                async single() {
                  if (val === 'usr-admin-1') return { data: { role: 'admin' }, error: null };
                  return { data: { role: 'learner' }, error: null };
                }
              };
            }
          };
        }
      };
    }
  };
}

describe('Discovery Runner & Queue Integration Suite', () => {
  let testRepoFile;
  let repo;
  const mockAuth = createMockAuthClient();
  let originalEnv;
  let originalWindow;
  let originalLocalStorage;
  let originalFetch;
  let mockStorage = {};

  beforeEach(async () => {
    resetDiscoveryLock();
    originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';

    await fs.mkdir(SCRATCH_DIR, { recursive: true });
    testRepoFile = path.join(SCRATCH_DIR, `test_candidates_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    repo = new JsonCandidateRepository(testRepoFile);

    // Seed test repository with 14 existing candidates
    const initialCandidates = [];
    for (let i = 1; i <= 14; i++) {
      initialCandidates.push({
        id: `cand_seeded_${i}`,
        source_name: 'initial_seed',
        source_listing_id: `SEED-${i}`,
        title: `Seeded AI Role #${i}`,
        organization: `Organization ${i}`,
        original_url: `https://example.com/initial/${i}`,
        canonical_url: `https://example.com/initial/${i}`,
        description: `Initial candidate ${i} for review`,
        track_id: `M${(i % 6) + 1}`,
        status: CANDIDATE_STATUS.PENDING_REVIEW,
        is_relevant: true,
        activity_status: 'Active',
        first_discovered_at: '2026-10-10T12:00:00Z'
      });
    }
    await repo.saveBatch(initialCandidates);

    // Setup mock browser localStorage
    mockStorage = {};
    originalWindow = globalThis.window;
    originalLocalStorage = globalThis.localStorage;
    originalFetch = globalThis.fetch;

    globalThis.window = {};
    globalThis.localStorage = {
      getItem: (k) => mockStorage[k] ?? null,
      setItem: (k, v) => { mockStorage[k] = String(v); },
      removeItem: (k) => { delete mockStorage[k]; },
      clear: () => { mockStorage = {}; }
    };
  });

  afterEach(async () => {
    resetDiscoveryLock();
    process.env.NODE_ENV = originalEnv;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
    globalThis.fetch = originalFetch;

    try {
      await fs.rm(SCRATCH_DIR, { recursive: true, force: true });
    } catch {}
  });

  // --------------------------------------------------------------------------
  // Requirement 1: Unauthenticated discovery request returns 401
  // --------------------------------------------------------------------------
  test('1. Unauthenticated discovery request returns 401 and preserves store intact', async () => {
    const http = createMockHttp('POST', {});
    await handleDiscoveryRunRequest(http.req, http.res, {
      repository: repo,
      supabaseClient: mockAuth
    });

    assert.equal(http.getStatusCode(), 401);
    const body = http.getBody();
    assert.match(body.error, /authentication required/i);

    const stored = await repo.getAll();
    assert.equal(stored.length, 14, 'Seeded 14 candidates must remain untouched');
  });

  // --------------------------------------------------------------------------
  // Requirement 2: Learner discovery request returns 403
  // --------------------------------------------------------------------------
  test('2. Learner discovery request returns 403 and preserves store intact', async () => {
    const http = createMockHttp('POST', { authorization: 'Bearer learner-jwt-token' });
    await handleDiscoveryRunRequest(http.req, http.res, {
      repository: repo,
      supabaseClient: mockAuth
    });

    assert.equal(http.getStatusCode(), 403);
    const body = http.getBody();
    assert.match(body.error, /insufficient privileges/i);

    const stored = await repo.getAll();
    assert.equal(stored.length, 14, 'Seeded 14 candidates must remain untouched');
  });

  // --------------------------------------------------------------------------
  // Requirement 3: Valid administrator login/token permits discovery
  // --------------------------------------------------------------------------
  test('3. Valid administrator login/token permits discovery and persists new gigs', async () => {
    const mockProvider = {
      name: 'test_live_source',
      type: 'api',
      fetchCandidates: async () => [
        {
          source_name: 'test_live_source',
          source_listing_id: 'LIVE-001',
          title: 'Senior AI Video Editor',
          organization: 'Apex Studio',
          url: 'https://apex.com/jobs/video-editor',
          description: 'Create viral short form reels using Runway and Pika.'
        },
        {
          source_name: 'test_live_source',
          source_listing_id: 'LIVE-002',
          title: 'AI Automation Architect (n8n & LangChain)',
          organization: 'Flow Systems',
          url: 'https://flow.com/jobs/automation',
          description: 'Deploy autonomous agent workflows linking webhooks and Airtable.'
        },
        // Duplicate of seeded #1
        {
          source_name: 'test_live_source',
          source_listing_id: 'LIVE-DUP-1',
          title: 'Seeded AI Role #1',
          organization: 'Organization 1',
          url: 'https://example.com/initial/1?utm_source=partner',
          description: 'Duplicate occurrence of seeded candidate 1'
        }
      ]
    };

    const http = createMockHttp('POST', { authorization: 'Bearer admin-jwt-token' });
    await handleDiscoveryRunRequest(http.req, http.res, {
      repository: repo,
      providers: [mockProvider],
      supabaseClient: mockAuth
    });

    assert.equal(http.getStatusCode(), 200);
    const body = http.getBody();

    assert.equal(body.success, true);
    assert.ok(body.counts);
    assert.equal(body.counts.fetched, 3);
    assert.equal(body.counts.relevant, 2);
    assert.equal(body.counts.duplicate, 1);
    assert.equal(body.counts.newly_saved, 3);
    assert.equal(body.counts.total_pending, 16);
    assert.equal(body.counts.total_store, 17, 'Store should now have 14 seeded + 3 processed = 17');

    // Verify all 14 seeded items survived with their IDs
    const stored = await repo.getAll();
    assert.equal(stored.length, 17);
    for (let i = 1; i <= 14; i++) {
      const found = stored.find(c => c.id === `cand_seeded_${i}`);
      assert.ok(found, `Seeded candidate ${i} must exist in repository`);
    }

    // Verify newly discovered candidates are present
    const videoCand = stored.find(c => c.title.includes('Video Editor'));
    assert.ok(videoCand);
    assert.equal(videoCand.track_id, 'M1');
    assert.equal(videoCand.status, CANDIDATE_STATUS.PENDING_REVIEW);
  });

  // --------------------------------------------------------------------------
  // Requirement 4: Invalid or expired tokens are rejected with a useful response
  // --------------------------------------------------------------------------
  test('4. Invalid or expired tokens are rejected with a useful response', async () => {
    // 4a. Expired JWT token returns 401 with explicit expired advisory
    const httpExpired = createMockHttp('POST', { authorization: 'Bearer expired-jwt-token' });
    await handleDiscoveryRunRequest(httpExpired.req, httpExpired.res, {
      repository: repo,
      supabaseClient: mockAuth
    });
    assert.equal(httpExpired.getStatusCode(), 401);
    const bodyExpired = httpExpired.getBody();
    assert.match(bodyExpired.error, /expired/i);
    assert.match(bodyExpired.error, /sign in/i);

    // 4b. Malformed or bogus token returns 401
    const httpInvalid = createMockHttp('POST', { authorization: 'Bearer malformed.bogus.jwt' });
    await handleDiscoveryRunRequest(httpInvalid.req, httpInvalid.res, {
      repository: repo,
      supabaseClient: mockAuth
    });
    assert.equal(httpInvalid.getStatusCode(), 401);
    const bodyInvalid = httpInvalid.getBody();
    assert.match(bodyInvalid.error, /invalid authentication/i);

    // 4c. Verify store remains untouched
    const stored = await repo.getAll();
    assert.equal(stored.length, 14);
  });

  // --------------------------------------------------------------------------
  // Requirement 5: Sync Store works with valid administrator authentication
  // --------------------------------------------------------------------------
  test('5. Sync Store works with valid administrator authentication', async () => {
    // 5a. GET /api/candidates returns stored items to admin
    const httpGet = createMockHttp('GET', { authorization: 'Bearer admin-jwt-token' });
    await handleCandidateApiRequest(httpGet.req, httpGet.res, {
      dataFile: testRepoFile,
      supabaseClient: mockAuth
    });
    assert.equal(httpGet.getStatusCode(), 200);
    const candidates = httpGet.getBody();
    assert.ok(Array.isArray(candidates));
    assert.equal(candidates.length, 14);

    // 5b. POST /api/candidates mutates candidate for admin
    const updatePayload = {
      id: 'cand_seeded_1',
      status: CANDIDATE_STATUS.APPROVED,
      admin_notes: 'Approved during test'
    };
    const httpPost = createMockHttp('POST', { authorization: 'Bearer admin-jwt-token' }, updatePayload);
    await handleCandidateApiRequest(httpPost.req, httpPost.res, {
      dataFile: testRepoFile,
      supabaseClient: mockAuth
    });
    assert.equal(httpPost.getStatusCode(), 200);

    const stored = await repo.getAll();
    const updated = stored.find(c => c.id === 'cand_seeded_1');
    assert.equal(updated.status, CANDIDATE_STATUS.APPROVED);
    assert.equal(updated.admin_notes, 'Approved during test');
  });

  // --------------------------------------------------------------------------
  // Requirement 6: Remote 401 preserves all existing local candidates and displays a sign-in warning
  // --------------------------------------------------------------------------
  test('6. Remote 401 preserves all existing local candidates and displays an actionable warning', async () => {
    // Seed localStorage with 14 candidates
    const initial = await repo.getAll();
    saveLocalCandidates(initial);

    // Mock global fetch returning HTTP 401
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized: Authentication required.' })
    });

    const queue = await fetchCandidateQueue();
    assert.equal(queue.length, 14, 'Must strictly preserve 14 local candidates');
    assert.equal(queue.syncSuccess, false);
    assert.equal(queue.syncStatus, 'warning');
    assert.equal(queue.isFallback, true);
    assert.match(queue.syncMessage, /administrator authentication/i);
    assert.match(queue.syncMessage, /sign in/i);
  });

  // --------------------------------------------------------------------------
  // Requirement 7: Successful discovery adds candidates to the actual webpage queue
  // --------------------------------------------------------------------------
  test('7. Successful discovery adds candidates to the actual webpage queue', async () => {
    const initial = await repo.getAll();
    saveLocalCandidates(initial);

    const freshCandidates = [
      ...initial,
      {
        id: 'cand_new_live_99',
        title: 'Lead Prompt Architect',
        organization: 'Cerebral AI',
        track_id: 'M4',
        status: CANDIDATE_STATUS.PENDING_REVIEW,
        is_relevant: true,
        payment_amount: '$60/hr'
      }
    ];

    globalThis.fetch = async (url) => {
      if (url === '/api/discovery/run') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            counts: {
              fetched: 1,
              relevant: 1,
              rejected: 0,
              duplicate: 0,
              uncertain: 0,
              newly_saved: 1,
              total_pending: 15,
              total_store: 15
            },
            candidates: freshCandidates
          })
        };
      }
      return { ok: false, status: 404 };
    };

    // Authenticated admin session for discovery execution
    const originalGetSession = supabase.auth.getSession;
    supabase.auth.getSession = async () => ({
      data: {
        session: {
          access_token: 'admin-jwt-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600
        }
      },
      error: null
    });

    try {
      const result = await runLiveDiscovery();
      assert.equal(result.success, true);
      assert.equal(result.candidates.length, 15);
      assert.equal(result.counts.newly_saved, 1);

      // Check localStorage was updated with the new candidate
      const cached = loadLocalCandidates();
      assert.equal(cached.length, 15);
      assert.ok(cached.find(c => c.id === 'cand_new_live_99'));
    } finally {
      supabase.auth.getSession = originalGetSession;
    }
  });

  // --------------------------------------------------------------------------
  // Requirement 8: Refresh and navigation preserve discovered candidates
  // --------------------------------------------------------------------------
  test('8. Refresh and navigation preserve discovered candidates from local store', async () => {
    const testList = [
      { id: 'cand_nav_1', title: 'Discovered AI Role #1', status: CANDIDATE_STATUS.PENDING_REVIEW },
      { id: 'cand_nav_2', title: 'Discovered AI Role #2', status: CANDIDATE_STATUS.PENDING_REVIEW }
    ];
    saveLocalCandidates(testList);

    // Ensure localStorage contains test candidates before reload
    const cachedBefore = loadLocalCandidates();
    assert.equal(cachedBefore.length, 2);

    // Simulate page reload / tab navigation by reading fresh storage
    const loadedAfterRefresh = loadLocalCandidates();
    assert.equal(loadedAfterRefresh.length, 2);
    assert.ok(loadedAfterRefresh.find(c => c.id === 'cand_nav_2'));
  });

  // --------------------------------------------------------------------------
  // Requirement 9: Repeated runs do not create duplicates
  // --------------------------------------------------------------------------
  test('9. Repeated discovery runs do not create duplicate rows (idempotency)', async () => {
    const mockProvider = {
      name: 'idempotent_feed',
      type: 'rss',
      fetchCandidates: async () => [
        {
          source_name: 'idempotent_feed',
          source_listing_id: 'IDEM-999',
          title: 'Autonomous Agent Engineer',
          organization: 'OmniAI',
          url: 'https://omniai.dev/jobs/999',
          description: 'Design self-healing LangChain tool-use agents and Make.com workflows.'
        }
      ]
    };

    // Run 1
    const http1 = createMockHttp('POST', { authorization: 'Bearer admin-jwt-token' });
    await handleDiscoveryRunRequest(http1.req, http1.res, {
      repository: repo,
      providers: [mockProvider],
      supabaseClient: mockAuth
    });
    assert.equal(http1.getStatusCode(), 200);
    assert.equal(http1.getBody().counts.total_store, 15);

    // Run 2 (exact same listing)
    const http2 = createMockHttp('POST', { authorization: 'Bearer admin-jwt-token' });
    await handleDiscoveryRunRequest(http2.req, http2.res, {
      repository: repo,
      providers: [mockProvider],
      supabaseClient: mockAuth
    });
    assert.equal(http2.getStatusCode(), 200);
    assert.equal(http2.getBody().counts.total_store, 15, 'Total candidates must not increase on re-run');
    assert.equal(http2.getBody().counts.newly_saved, 0, 'No new candidates should be inserted on re-run');
  });

  // --------------------------------------------------------------------------
  // Requirement 10: Development-only tokens are unconditionally rejected in all environments
  // --------------------------------------------------------------------------
  test('10. Development-only tokens are unconditionally rejected in all environments', async () => {
    // 10a. verifyTokenAndRole with dev-admin-token in development / non-production
    delete process.env.NODE_ENV;
    const resDev = await verifyTokenAndRole('dev-admin-token', mockAuth);
    assert.equal(resDev.valid, false);
    assert.equal(resDev.statusCode, 401);
    assert.match(resDev.error, /unauthorized/i);

    // 10b. verifyTokenAndRole with dev-admin-token in production
    process.env.NODE_ENV = 'production';
    const resProd = await verifyTokenAndRole('dev-admin-token', mockAuth);
    assert.equal(resProd.valid, false);
    assert.equal(resProd.statusCode, 401);
    assert.match(resProd.error, /unauthorized/i);

    // 10c. API endpoint with dev-admin-token returns 401
    const http = createMockHttp('POST', { authorization: 'Bearer dev-admin-token' });
    await handleDiscoveryRunRequest(http.req, http.res, {
      repository: repo,
      supabaseClient: mockAuth
    });
    assert.equal(http.getStatusCode(), 401);
    assert.match(http.getBody().error, /unauthorized/i);
  });
});
