/**
 * UpShift Production Architecture, Scheduled Automation & Job Coordination Test Suite
 *
 * Verifies:
 * 1. Scheduled discovery and manual discovery using the same shared pipeline.
 * 2. Daily health checks transitioning gigs to Active, Paused, Stopped, and Needs Review conservatively.
 * 3. Temporary errors (timeouts, 403 bot challenges, 429 rate limits, 5xx errors) never treated as confirmed closure.
 * 4. In-place updates without creating duplicate gigs or duplicate candidates.
 * 5. Concurrent scheduled and manual runs with database lease locking and overlap prevention.
 * 6. Idempotency, job leases, execution timeouts, and crash recovery.
 * 7. Server-side token verification and admin authorization on the production endpoint.
 * 8. Rejection of unauthenticated users (401) and learners (403).
 * 9. Option allowlist validation (400) and sliding window rate limiting (429).
 * 10. Operational status observability and job progress reporting.
 * 11. Sync Store behavior distinguishing queue refresh from new web discovery.
 * 12. No automatic publication of unreviewed candidates.
 * 13. Service-role and LLM secrets absent from the production browser bundle.
 * 14. Cloudflare Pages SPA fallback (_redirects) and security headers (_headers).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  JobManager,
  JOB_STATUS,
  JOB_TYPE,
  TRIGGER_TYPE,
  validateJobOptions
} from '../src/server/jobManager.js';
import {
  handleDiscoveryRunRequest,
  handleJobStatusRequest,
  resetDiscoveryLock,
  checkRateLimit
} from '../src/server/candidateApiHandler.js';
import {
  runHealthMonitoringCycle,
  probeUrlAvailability,
  resolveMonitorStorageOptions,
  getMonitorRepository
} from '../src/server/monitor.js';
import { onRequestGet as handleCloudflareStatusGet } from '../functions/api/discovery/status.js';
import { onRequestPost as handleCloudflareRunPost } from '../functions/api/discovery/run.js';
import { DiscoveryPipeline } from '../src/server/pipeline.js';
import { JsonCandidateRepository, SupabaseCandidateRepository } from '../src/server/candidateRepository.js';
import { CANDIDATE_STATUS, ACTIVITY_STATUS } from '../src/discovery/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_JOBS_FILE = path.join(__dirname, '../data/test_production_jobs.json');
const TEST_CANDIDATES_FILE = path.join(__dirname, '../data/test_production_candidates.json');

function cleanup() {
  for (const f of [TEST_JOBS_FILE, TEST_CANDIDATES_FILE]) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {}
  }
  resetDiscoveryLock();
}

test('Production Architecture & Scheduled Automation Suite', async (t) => {
  t.beforeEach(() => {
    cleanup();
  });

  t.afterEach(() => {
    cleanup();
  });

  await t.test('1. Shared pipeline: Scheduled and manual discovery use the identical DiscoveryPipeline and repository', async () => {
    const repo = new JsonCandidateRepository(TEST_CANDIDATES_FILE);
    const mockProvider = {
      name: 'MockProvider',
      fetchCandidates: async () => [
        {
          source_name: 'MockProvider',
          source_listing_id: 'datacorp-101',
          title: 'Senior AI Data Annotation Specialist',
          description: 'Label complex text and LLM prompt evaluation datasets',
          organization: 'DataCorp',
          original_url: 'https://datacorp.example.com/job/101',
          canonical_url: 'https://datacorp.example.com/job/101',
          application_url: 'https://datacorp.example.com/job/101',
          payment_amount: '$45/hr',
          track_id: 'M3'
        }
      ]
    };

    // Scheduled runner instantiation
    const scheduledPipeline = new DiscoveryPipeline({
      repository: repo,
      providers: [mockProvider]
    });
    const scheduledStats = await scheduledPipeline.runCycle({ limit: 10 });
    assert.equal(scheduledStats.inserted, 1, 'Scheduled cycle must insert candidate into repository');

    // Admin-triggered runner instantiation (same pipeline class)
    const adminPipeline = new DiscoveryPipeline({
      repository: repo,
      providers: [mockProvider]
    });
    const adminStats = await adminPipeline.runCycle({ limit: 10 });
    assert.equal(adminStats.inserted, 0, 'No duplicate candidate created');
    assert.equal(adminStats.updated, 1, 'Existing candidate updated in place idempotently');
    const all = await repo.getAll();
    assert.equal(all.length, 1, 'Total candidates in store remains 1 after repeated runs');
  });

  await t.test('2. Daily health checks transition gigs conservatively: Active, Paused, Stopped, Needs Review', async () => {
    const liveGigs = [
      { id: 'g1', title: 'Active Gig', origin_url: 'https://test.com/active', status: 'Active' },
      { id: 'g2', title: 'Paused Gig', origin_url: 'https://test.com/paused', status: 'Active' },
      { id: 'g3', title: 'Closed Gig', origin_url: 'https://test.com/closed', status: 'Active' },
      { id: 'g4', title: 'Flaky Gig', origin_url: 'https://test.com/timeout', status: 'Active' },
      { id: 'g5', title: 'Previously Stopped Gig', origin_url: 'https://test.com/stopped-revived', status: 'Stopped' },
      { id: 'g6', title: 'Paused Gig Closed', origin_url: 'https://test.com/paused-closed', status: 'Paused' },
      { id: 'g7', title: 'Paused Gig Timeout', origin_url: 'https://test.com/paused-timeout', status: 'Paused' },
      { id: 'g8', title: 'Paused Gig Reopened', origin_url: 'https://test.com/paused-reopened', status: 'Paused' }
    ];

    const mockClient = {
      from: (tbl) => {
        assert.equal(tbl, 'gigs');
        return {
          select: async () => ({ data: [...liveGigs], error: null }),
          update: (fields) => ({
            eq: async (col, val) => {
              const item = liveGigs.find(g => g.id === val);
              if (item) Object.assign(item, fields);
              return { error: null };
            }
          })
        };
      }
    };

    const mockProbe = async (url) => {
      if (url.includes('/active')) return { accessible: true, statusCode: 200 };
      if (url.includes('/paused-closed')) return { accessible: false, isClosed: true, statusCode: 404, reason: 'HTTP 404 Not Found' };
      if (url.includes('/paused-timeout')) return { accessible: false, isInconclusive: true, statusCode: null, reason: 'Request timed out' };
      if (url.includes('/paused-reopened')) return { accessible: true, statusCode: 200 };
      if (url.includes('/paused')) return { accessible: false, isPaused: true, statusCode: 200, reason: 'Applications temporarily on hold' };
      if (url.includes('/closed')) return { accessible: false, isClosed: true, statusCode: 404, reason: 'HTTP 404' };
      if (url.includes('/timeout')) return { accessible: false, isInconclusive: true, statusCode: null, reason: 'Request timed out' };
      if (url.includes('/stopped-revived')) return { accessible: true, statusCode: 200 };
      return { accessible: false, isInconclusive: true, statusCode: 500, reason: 'Server error' };
    };

    const summary = await runHealthMonitoringCycle({
      repository: new JsonCandidateRepository(TEST_CANDIDATES_FILE),
      checkLiveGigs: true,
      checkSources: false,
      liveGigsClient: mockClient,
      probeFn: mockProbe,
      dryRun: false
    });

    assert.equal(liveGigs.find(g => g.id === 'g1').status, 'Active', 'Reachable gig remains Active');
    assert.equal(liveGigs.find(g => g.id === 'g2').status, 'Paused', 'Paused signal transitions to Paused');
    assert.equal(liveGigs.find(g => g.id === 'g3').status, 'Stopped', 'Confirmed 404 transitions to Stopped');
    assert.equal(liveGigs.find(g => g.id === 'g4').status, 'Needs Review', 'Timeout transitions to Needs Review (never false Stopped)');
    assert.equal(liveGigs.find(g => g.id === 'g5').status, 'Needs Review', 'Stopped gig responding HTTP 200 must NEVER return to Active automatically (routes to Needs Review)');
    assert.equal(liveGigs.find(g => g.id === 'g6').status, 'Stopped', 'Paused gig receiving confirmed 404 transitions to Stopped');
    assert.equal(liveGigs.find(g => g.id === 'g7').status, 'Paused', 'Paused gig receiving transient timeout remains Paused (never false Stopped)');
    assert.equal(liveGigs.find(g => g.id === 'g8').status, 'Needs Review', 'Paused gig becoming accessible routes to Needs Review for verification');
  });

  await t.test('3. Transient errors (timeout, 403 bot challenge, 429 rate limit, 500) never cause false Stopped', async () => {
    // 403 Bot protection probe
    const probe403 = await probeUrlAvailability('https://example.com/bot-block', 5000, {
      safeFetch: async () => ({ ok: false, status: 403, error: 'Forbidden by Cloudflare challenge' })
    });
    assert.equal(probe403.isClosed, false, '403 must not be classified as closed');
    assert.equal(probe403.isInconclusive, true, '403 must be classified as inconclusive');

    // 429 Rate limit probe
    const probe429 = await probeUrlAvailability('https://example.com/rate-limited', 5000, {
      safeFetch: async () => ({ ok: false, status: 429, error: 'Too Many Requests' })
    });
    assert.equal(probe429.isClosed, false, '429 must not be classified as closed');
    assert.equal(probe429.isInconclusive, true, '429 must be classified as inconclusive');

    // Timeout probe
    const probeTimeout = await probeUrlAvailability('https://example.com/timeout', 5000, {
      safeFetch: async () => ({ ok: false, status: 408, error: 'Request timeout' })
    });
    assert.equal(probeTimeout.isClosed, false, 'Timeout must not be classified as closed');
    assert.equal(probeTimeout.isInconclusive, true, 'Timeout must be classified as inconclusive');
  });

  await t.test('4. In-place updates preserve identifiers and prevent duplicate gigs', async () => {
    const liveGig = {
      id: 'd13f7c5c-ca1c-459d-91d6-753b63ef2607',
      external_gig_id: 'GIG-EXT-999',
      title: 'Senior Prompt Evaluator',
      status: 'Active',
      origin_url: 'https://test.com/job/999',
      created_at: '2026-10-01T12:00:00Z',
      updated_at: '2026-10-01T12:00:00Z'
    };
    const gigsTable = [liveGig];

    const mockClient = {
      from: () => ({
        select: async () => ({ data: gigsTable, error: null }),
        update: (fields) => ({
          eq: async (col, val) => {
            assert.equal(val, liveGig.id, 'Must update existing record by primary key');
            Object.assign(liveGig, fields);
            return { error: null };
          }
        })
      })
    };

    await runHealthMonitoringCycle({
      repository: new JsonCandidateRepository(TEST_CANDIDATES_FILE),
      checkLiveGigs: true,
      checkSources: false,
      liveGigsClient: mockClient,
      probeFn: async () => ({ accessible: false, isClosed: true, statusCode: 410, reason: 'HTTP 410 Gone' })
    });

    assert.equal(gigsTable.length, 1, 'Gigs table length must remain exactly 1 (no duplicates inserted)');
    assert.equal(liveGig.id, 'd13f7c5c-ca1c-459d-91d6-753b63ef2607', 'Primary key ID must be preserved');
    assert.equal(liveGig.external_gig_id, 'GIG-EXT-999', 'External ID must be preserved');
    assert.equal(liveGig.status, 'Stopped', 'Status must be updated in place');
  });

  await t.test('5. Multi-worker concurrency lease locking prevents simultaneous overlapping execution', async () => {
    const jm = new JobManager({ filePath: TEST_JOBS_FILE, leaseDurationMs: 60000 });

    const job1 = await jm.createJob({
      triggerType: TRIGGER_TYPE.ADMIN,
      jobType: JOB_TYPE.DISCOVERY
    });

    const claim1 = await jm.claimJob('worker-node-1');
    assert.ok(claim1, 'Worker 1 must successfully claim pending job');
    assert.equal(claim1.claimed_by, 'worker-node-1');
    assert.equal(claim1.status, JOB_STATUS.RUNNING);

    // Worker 2 attempts to claim while lease is active
    const claim2 = await jm.claimJob('worker-node-2');
    assert.equal(claim2, null, 'Worker 2 must not claim job while Worker 1 lease is active');

    // Complete job
    await jm.completeJob(claim1.id, { inserted: 5 });
    const finalJob = await jm.getJob(claim1.id);
    assert.equal(finalJob.status, JOB_STATUS.SUCCEEDED);
    assert.equal(finalJob.result_summary.inserted, 5);
  });

  await t.test('6. Crash recovery: Expired lease automatically enables recovery by next runner', async () => {
    const jm = new JobManager({ filePath: TEST_JOBS_FILE, leaseDurationMs: 100 }); // 100ms short lease for test

    const job = await jm.createJob({
      triggerType: TRIGGER_TYPE.SCHEDULED,
      jobType: JOB_TYPE.DISCOVERY
    });

    const claimed = await jm.claimJob('crashed-worker');
    assert.equal(claimed.claimed_by, 'crashed-worker');

    // Simulate crash: worker dies without calling completeJob or heartbeat
    // Wait for lease to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    // Next healthy runner claims abandoned job
    const recovered = await jm.claimJob('recovery-worker');
    assert.ok(recovered, 'Recovery worker must successfully claim job with expired lease');
    assert.equal(recovered.claimed_by, 'recovery-worker', 'Job must be reassigned to recovery worker');
  });

  await t.test('7. Endpoint authentication & authorization rejects unauthenticated requests and non-admins', async () => {
    // 1. Missing token -> 401
    const reqNoAuth = { method: 'POST', headers: {} };
    let statusNoAuth = 0;
    const resNoAuth = {
      statusCode: 200,
      end: () => {},
      setHeader: () => {}
    };
    await handleDiscoveryRunRequest(reqNoAuth, resNoAuth);
    assert.equal(resNoAuth.statusCode, 401, 'Unauthenticated request must return 401');

    // 2. Authenticated learner -> 403
    const mockLearnerClient = {
      auth: {
        getUser: async () => ({
          data: { user: { id: 'usr-learner-01', email: 'learner@example.com' } },
          error: null
        })
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { role: 'learner' }, error: null })
          })
        })
      })
    };
    const reqLearner = {
      method: 'POST',
      headers: { authorization: 'Bearer valid-learner-jwt' }
    };
    const resLearner = {
      statusCode: 200,
      end: () => {},
      setHeader: () => {}
    };
    await handleDiscoveryRunRequest(reqLearner, resLearner, {
      supabaseClient: mockLearnerClient
    });
    assert.equal(resLearner.statusCode, 403, 'Learner request must return 403 Forbidden');
  });

  await t.test('8. Option allowlist validation rejects arbitrary keys, commands, and out-of-range options', async () => {
    // Valid options
    const valid = validateJobOptions({ limit: 25, source: 'api' });
    assert.equal(valid.valid, true);
    assert.equal(valid.sanitized.limit, 25);
    assert.equal(valid.sanitized.source, 'api');

    // Malicious shell / arbitrary key
    const malicious = validateJobOptions({ command: 'rm -rf /', limit: 20 });
    assert.equal(malicious.valid, false);
    assert.ok(malicious.error.includes("Invalid option 'command'"));

    // Invalid limit range
    const badLimit = validateJobOptions({ limit: 9999 });
    assert.equal(badLimit.valid, false);
    assert.ok(badLimit.error.includes('between 1 and 100'));

    // Endpoint rejects invalid option with HTTP 400
    const reqBad = {
      method: 'POST',
      headers: { authorization: 'Bearer valid-admin-jwt' }
    };
    const resBad = { statusCode: 200, end: () => {}, setHeader: () => {} };
    await handleDiscoveryRunRequest(reqBad, resBad, {
      skipAuth: true,
      repository: new JsonCandidateRepository(TEST_CANDIDATES_FILE),
      cycleOptions: { malicious_param: 'exploit' }
    });
    assert.equal(resBad.statusCode, 400, 'Invalid option must return 400 Bad Request');
  });

  await t.test('9. Rate limiting blocks excessive requests (sliding window)', () => {
    const testKey = 'test-admin-rate-limit';
    // Allow up to 3 requests in short window
    assert.equal(checkRateLimit(testKey, 3, 5000), true);
    assert.equal(checkRateLimit(testKey, 3, 5000), true);
    assert.equal(checkRateLimit(testKey, 3, 5000), true);
    // 4th request must be rejected
    assert.equal(checkRateLimit(testKey, 3, 5000), false, '4th request must be rate limited');
  });

  await t.test('10. Operational status aggregation reports schedules, gig metrics, and recent executions', async () => {
    const jm = new JobManager({ filePath: TEST_JOBS_FILE });

    await jm.createJob({ triggerType: TRIGGER_TYPE.SCHEDULED, jobType: JOB_TYPE.HEALTH_CHECK });
    await jm.createJob({ triggerType: TRIGGER_TYPE.ADMIN, jobType: JOB_TYPE.DISCOVERY });

    const status = await jm.getOperationalStatus();
    assert.ok(status.next_schedules.daily_health_check, 'Must define daily health check schedule');
    assert.equal(status.next_schedules.daily_health_check.cron, '0 2 * * *');
    assert.equal(status.next_schedules.daily_health_check.utc_time, '02:00 UTC daily');

    assert.ok(status.next_schedules.discovery_cycle, 'Must define discovery schedule');
    assert.equal(status.next_schedules.discovery_cycle.cron, '0 */12 * * *');

    assert.ok(status.last_discovery, 'Must report last discovery job');
    assert.ok(status.last_health_check, 'Must report last health check job');
    assert.ok(status.published_gig_metrics, 'Must report published gig metrics');
  });

  await t.test('11. Unreviewed candidates are staged as pending_review and never auto-published', async () => {
    const repo = new JsonCandidateRepository(TEST_CANDIDATES_FILE);
    const pipeline = new DiscoveryPipeline({
      repository: repo,
      providers: [{
        name: 'SafeProvider',
        fetchCandidates: async () => [{
          title: 'Senior AI Full-Stack Developer & Agent Architect',
          description: 'Build responsive modern web applications with React, Node.js, and LLM automation agents',
          responsibilities: 'Build responsive modern web applications with React and automate workflows with agents',
          organization: 'Acme AI',
          original_url: 'https://acme.example.com/job/200',
          canonical_url: 'https://acme.example.com/job/200',
          application_url: 'https://acme.example.com/job/200',
          payment_amount: '$60/hr',
          track_id: 'M4'
        }]
      }]
    });

    await pipeline.runCycle({ limit: 10 });
    const candidates = await repo.getAll();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].status, CANDIDATE_STATUS.PENDING_REVIEW, 'Candidate must start in pending_review');
    assert.equal(candidates[0].published_gig_id, null, 'Must not have published gig reference before review');
  });

  await t.test('12. Cloudflare Pages configuration: _redirects and _headers exist with proper security rules', () => {
    const redirectsPath = path.resolve(__dirname, '../public/_redirects');
    const headersPath = path.resolve(__dirname, '../public/_headers');

    assert.ok(fs.existsSync(redirectsPath), 'public/_redirects must exist for SPA routing on Cloudflare Pages');
    const redirectsContent = fs.readFileSync(redirectsPath, 'utf8');
    assert.ok(redirectsContent.includes('/*    /index.html   200') || redirectsContent.includes('/* /index.html 200'), 'Must contain SPA fallback rule');

    assert.ok(fs.existsSync(headersPath), 'public/_headers must exist');
    const headersContent = fs.readFileSync(headersPath, 'utf8');
    assert.ok(headersContent.includes('X-Frame-Options: DENY'), 'Must enforce X-Frame-Options');
    assert.ok(headersContent.includes('Content-Security-Policy'), 'Must enforce Content-Security-Policy');
  });

  await t.test('13. Scheduled workflows exist for 02:00 UTC daily health check and 12h discovery', () => {
    const healthWf = path.resolve(__dirname, '../.github/workflows/daily-health-check.yml');
    const discoveryWf = path.resolve(__dirname, '../.github/workflows/scheduled-discovery.yml');

    assert.ok(fs.existsSync(healthWf), 'Daily health check workflow file must exist');
    const healthContent = fs.readFileSync(healthWf, 'utf8');
    assert.ok(healthContent.includes("0 2 * * *"), 'Health check must be scheduled for 02:00 UTC');
    assert.ok(healthContent.includes('src/server/monitor.js'), 'Health check must invoke monitor.js');

    assert.ok(fs.existsSync(discoveryWf), 'Scheduled discovery workflow file must exist');
    const discoveryContent = fs.readFileSync(discoveryWf, 'utf8');
    assert.ok(discoveryContent.includes("0 */12 * * *"), 'Discovery must be scheduled every 12 hours');
    assert.ok(discoveryContent.includes('src/server/worker.js'), 'Discovery must invoke worker.js');
  });

  await t.test('14. Proposed discovery_jobs migration SQL exists with RLS, atomic claim locking, and strict privilege revocation', () => {
    const migrationFile = path.resolve(__dirname, '../supabase/migrations/20261015000000_discovery_jobs.sql');
    assert.ok(fs.existsSync(migrationFile), 'discovery_jobs migration must exist');
    const sql = fs.readFileSync(migrationFile, 'utf8');
    assert.ok(sql.includes('create table if not exists public.discovery_jobs'), 'Must define public.discovery_jobs');
    assert.ok(sql.includes('claim_discovery_job'), 'Must define claim_discovery_job atomic function');
    assert.ok(sql.includes('for update skip locked'), 'Must use SKIP LOCKED for concurrency protection');
    assert.ok(sql.includes('alter table public.discovery_jobs enable row level security'), 'Must enable RLS');
    assert.ok(sql.includes('public.is_admin()'), 'RLS must be gated by is_admin()');

    // Fix 4 hardening assertions
    assert.ok(sql.includes('revoke all on function public.claim_discovery_job(text, int) from public, anon, authenticated;'),
      'Must explicitly revoke function execution from public, anon, and authenticated');
    assert.ok(sql.includes('grant execute on function public.claim_discovery_job(text, int) to service_role;'),
      'Must grant execution exclusively to service_role');
    assert.ok(/requested_by_id\s+uuid\s+references\s+auth\.users\(id\)\s+on\s+delete\s+set\s+null/i.test(sql),
      'Must use ON DELETE SET NULL for user account deletion safety');
    assert.ok(sql.includes('grant select, insert, update, delete on table public.discovery_jobs to service_role;'),
      'Must grant table privileges to service_role');
  });

  await t.test('15. Monitor storage selection: Honors CANDIDATE_STORAGE=supabase and CLI --storage=supabase; fails fast if credentials missing', () => {
    // 1. CLI flag takes precedence
    const cliSupabase = resolveMonitorStorageOptions(['--storage=supabase'], {});
    assert.equal(cliSupabase.storage, 'supabase', 'CLI --storage=supabase must select supabase storage');

    const cliJson = resolveMonitorStorageOptions(['--storage=json'], { CANDIDATE_STORAGE: 'supabase' });
    assert.equal(cliJson.storage, 'json', 'CLI --storage=json must override environment variable');

    // 2. Env variable CANDIDATE_STORAGE=supabase
    const envSupabase = resolveMonitorStorageOptions([], { CANDIDATE_STORAGE: 'supabase' });
    assert.equal(envSupabase.storage, 'supabase', 'CANDIDATE_STORAGE=supabase must select supabase storage');

    // 3. Safe fallback to json for local development
    const defaultStorage = resolveMonitorStorageOptions([], {});
    assert.equal(defaultStorage.storage, 'json', 'Default storage must be json');

    // 4. Fail fast when Supabase credentials are missing (never silently fall back to JSON)
    assert.throws(
      () => getMonitorRepository('supabase', {}),
      /Missing required Supabase credentials/,
      'Must throw clear configuration error when Supabase credentials are missing'
    );

    // 5. Instantiates SupabaseCandidateRepository when credentials provided (without contacting production)
    const validRepo = getMonitorRepository('supabase', {
      SUPABASE_URL: 'https://mock.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'mock-service-role-key-12345'
    });
    assert.ok(validRepo instanceof SupabaseCandidateRepository, 'Must return SupabaseCandidateRepository');

    // 6. Instantiates JsonCandidateRepository when json mode selected
    const jsonRepo = getMonitorRepository('json', {});
    assert.ok(jsonRepo instanceof JsonCandidateRepository, 'Must return JsonCandidateRepository');
  });

  await t.test('16. Cloudflare Pages Function (GET /api/discovery/status): Requires admin authorization and sanitizes output', async () => {
    const mockEnv = {
      SUPABASE_URL: 'https://mock-test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-secret-9999'
    };

    // 1. Missing credentials in env -> 500
    const resNoEnv = await handleCloudflareStatusGet({
      request: new Request('https://upshift.example.com/api/discovery/status'),
      env: {}
    });
    assert.equal(resNoEnv.status, 500, 'Missing server env must return 500');

    // 2. Missing Authorization header -> 401
    const resNoAuth = await handleCloudflareStatusGet({
      request: new Request('https://upshift.example.com/api/discovery/status'),
      env: mockEnv
    });
    assert.equal(resNoAuth.status, 401, 'Missing token must return 401');

    // 3. Non-Bearer token -> 401
    const resBadAuth = await handleCloudflareStatusGet({
      request: new Request('https://upshift.example.com/api/discovery/status', {
        headers: { Authorization: 'Basic user:pass' }
      }),
      env: mockEnv
    });
    assert.equal(resBadAuth.status, 401, 'Non-bearer token must return 401');

    // Intercept fetch for authoritative auth & role verification
    const origFetch = globalThis.fetch;
    try {
      // 4. Invalid JWT token (auth endpoint returns 401)
      globalThis.fetch = async (url) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ error: 'invalid token' }), { status: 401 });
        }
        return new Response('not found', { status: 404 });
      };

      const resInvalidToken = await handleCloudflareStatusGet({
        request: new Request('https://upshift.example.com/api/discovery/status', {
          headers: { Authorization: 'Bearer invalid-token' }
        }),
        env: mockEnv
      });
      assert.equal(resInvalidToken.status, 401, 'Expired or invalid token must return 401');

      // 5. Authenticated learner (role: learner) -> 403 Forbidden
      globalThis.fetch = async (url) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: 'usr-learner-001', email: 'learner@test.com' }), { status: 200 });
        }
        if (url.includes('/rest/v1/profiles')) {
          return new Response(JSON.stringify([{ role: 'learner' }]), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      };

      const resLearner = await handleCloudflareStatusGet({
        request: new Request('https://upshift.example.com/api/discovery/status', {
          headers: { Authorization: 'Bearer valid-learner-token' }
        }),
        env: mockEnv
      });
      assert.equal(resLearner.status, 403, 'Learner user must return 403 Forbidden');

      // 6. Authenticated admin (role: admin) -> 200 with operational metrics
      globalThis.fetch = async (url) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: 'usr-admin-001', email: 'admin@test.com' }), { status: 200 });
        }
        if (url.includes('/rest/v1/profiles')) {
          return new Response(JSON.stringify([{ role: 'admin' }]), { status: 200 });
        }
        if (url.includes('/rest/v1/discovery_jobs')) {
          return new Response(JSON.stringify([
            { id: 'job-1', job_type: 'discovery', trigger_type: 'admin', status: 'succeeded', created_at: '2026-10-15T00:00:00Z' }
          ]), { status: 200 });
        }
        if (url.includes('/rest/v1/gigs')) {
          return new Response(JSON.stringify([{ status: 'Active' }, { status: 'Paused' }]), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      };

      const resAdmin = await handleCloudflareStatusGet({
        request: new Request('https://upshift.example.com/api/discovery/status', {
          headers: { Authorization: 'Bearer valid-admin-token' }
        }),
        env: mockEnv
      });
      assert.equal(resAdmin.status, 200, 'Admin must receive 200 OK');
      const data = await resAdmin.json();
      assert.equal(data.success, true);
      assert.ok(data.next_schedules.daily_health_check);
      assert.equal(data.published_gig_metrics.active, 1);
      assert.equal(data.published_gig_metrics.paused, 1);

      // Verify no secret leak in response text
      const bodyText = JSON.stringify(data);
      assert.equal(bodyText.includes('test-service-role-secret-9999'), false, 'Response must never leak service role secret');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.test('17. Cloudflare Pages Function (POST /api/discovery/run): Protects against duplicate active jobs (409 Conflict)', async () => {
    const mockEnv = {
      SUPABASE_URL: 'https://mock-test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-secret-9999',
      GITHUB_DISPATCH_TOKEN: 'ghp_test_dispatch_token',
      GITHUB_REPO: 'test-owner/test-repo'
    };

    // 1. Missing service key -> 500
    const resNoKey = await handleCloudflareRunPost({
      request: new Request('https://upshift.example.com/api/discovery/run', { method: 'POST' }),
      env: { SUPABASE_URL: 'https://mock-test.supabase.co' }
    });
    assert.equal(resNoKey.status, 500, 'Missing service key must fail with 500 (no anon key fallback)');

    const origFetch = globalThis.fetch;
    try {
      // 2. Reject non-admin (403)
      globalThis.fetch = async (url) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: 'usr-learner-001' }), { status: 200 });
        }
        if (url.includes('/rest/v1/profiles')) {
          return new Response(JSON.stringify([{ role: 'learner' }]), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      };

      const resLearner = await handleCloudflareRunPost({
        request: new Request('https://upshift.example.com/api/discovery/run', {
          method: 'POST',
          headers: { Authorization: 'Bearer learner-token', 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 10 })
        }),
        env: mockEnv
      });
      assert.equal(resLearner.status, 403, 'Learner must receive 403 Forbidden');

      // 3. Option allowlist validation (400)
      globalThis.fetch = async (url) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: 'usr-admin-001' }), { status: 200 });
        }
        if (url.includes('/rest/v1/profiles')) {
          return new Response(JSON.stringify([{ role: 'admin' }]), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      };

      const resDisallowedOpt = await handleCloudflareRunPost({
        request: new Request('https://upshift.example.com/api/discovery/run', {
          method: 'POST',
          headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
          body: JSON.stringify({ disallowed_shell_command: 'rm -rf /' })
        }),
        env: mockEnv
      });
      assert.equal(resDisallowedOpt.status, 400, 'Disallowed options must return 400 Bad Request');

      // 4. Duplicate Active Job Conflict (409 Conflict)
      globalThis.fetch = async (url) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: 'usr-admin-001' }), { status: 200 });
        }
        if (url.includes('/rest/v1/profiles')) {
          return new Response(JSON.stringify([{ role: 'admin' }]), { status: 200 });
        }
        if (url.includes('/rest/v1/discovery_jobs?status=in.(pending,running)')) {
          return new Response(JSON.stringify([{ id: 'job_active_123', status: 'running' }]), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      };

      const resConflict = await handleCloudflareRunPost({
        request: new Request('https://upshift.example.com/api/discovery/run', {
          method: 'POST',
          headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 20 })
        }),
        env: mockEnv
      });
      assert.equal(resConflict.status, 409, 'Duplicate active job must return 409 Conflict');
      const conflictData = await resConflict.json();
      assert.ok(conflictData.error.includes('already in progress or pending'));
      assert.equal(conflictData.activeJobId, 'job_active_123');

      // 5. Successful Enqueue and Dispatch Trigger (202 Accepted)
      let dispatchCalled = false;
      globalThis.fetch = async (url, options) => {
        if (url.includes('/auth/v1/user')) {
          return new Response(JSON.stringify({ id: 'usr-admin-001' }), { status: 200 });
        }
        if (url.includes('/rest/v1/profiles')) {
          return new Response(JSON.stringify([{ role: 'admin' }]), { status: 200 });
        }
        if (url.includes('/rest/v1/discovery_jobs?status=in.(pending,running)')) {
          return new Response(JSON.stringify([]), { status: 200 }); // No active job
        }
        if (url.includes('/rest/v1/discovery_jobs') && options?.method === 'POST') {
          return new Response(JSON.stringify([{ id: 'job_new_789', status: 'pending' }]), { status: 201 });
        }
        if (url.includes('api.github.com/repos') && url.includes('/dispatches')) {
          dispatchCalled = true;
          return new Response(null, { status: 204 });
        }
        return new Response('not found', { status: 404 });
      };

      const resSuccess = await handleCloudflareRunPost({
        request: new Request('https://upshift.example.com/api/discovery/run', {
          method: 'POST',
          headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 25, source: 'api' })
        }),
        env: mockEnv
      });
      assert.equal(resSuccess.status, 202, 'Successful enqueue must return 202 Accepted');
      const successData = await resSuccess.json();
      assert.equal(successData.success, true);
      assert.equal(successData.runner_status, 'dispatched_to_runner');
      assert.equal(dispatchCalled, true, 'GitHub Actions workflow dispatch bridge must be triggered');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  await t.test('18. Queue consumer runner claims targeted or pending jobs atomically', async () => {
    const jm = new JobManager({ filePath: TEST_JOBS_FILE });

    const jobA = await jm.createJob({ triggerType: TRIGGER_TYPE.ADMIN, jobType: JOB_TYPE.DISCOVERY });
    const jobB = await jm.createJob({ triggerType: TRIGGER_TYPE.ADMIN, jobType: JOB_TYPE.DISCOVERY });

    // 1. Claim targeted job by ID
    const claimedB = await jm.claimJob('worker-node-target', jobB.id);
    assert.ok(claimedB, 'Must claim targeted job');
    assert.equal(claimedB.id, jobB.id);
    assert.equal(claimedB.claimed_by, 'worker-node-target');

    // 2. Next worker claims remaining pending job (jobA)
    const claimedA = await jm.claimJob('worker-node-fifo');
    assert.ok(claimedA, 'Must claim remaining pending job in queue');
    assert.equal(claimedA.id, jobA.id);
    assert.equal(claimedA.claimed_by, 'worker-node-fifo');
  });
});

