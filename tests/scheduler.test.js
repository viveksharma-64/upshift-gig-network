import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DailyHealthScheduler } from '../src/server/scheduler.js';
import { runHealthMonitoringCycle, probeUrlAvailability } from '../src/server/monitor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_AUDIT_LOG = path.join(__dirname, '../data/test_scheduler_audit.json');
const TEST_LOCK_FILE = path.join(__dirname, '../data/test_scheduler.lock');

// Cleanup helper
function cleanupTestArtifacts() {
  for (const f of [TEST_AUDIT_LOG, TEST_LOCK_FILE]) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {}
  }
}

test('Daily Scheduler & In-Place Verification Suite', async (t) => {
  t.beforeEach(() => {
    cleanupTestArtifacts();
  });

  t.afterEach(() => {
    cleanupTestArtifacts();
  });

  await t.test('Scenario S1: DailyHealthScheduler initializes with 24h default and correct configuration', () => {
    const scheduler = new DailyHealthScheduler({
      auditLogPath: TEST_AUDIT_LOG,
      lockFilePath: TEST_LOCK_FILE
    });
    const status = scheduler.getStatus();
    assert.equal(status.isActive, false);
    assert.equal(status.isCycleRunning, false);
    assert.equal(status.runsCompleted, 0);
    assert.equal(typeof status.intervalMs, 'number');
    assert.ok(status.intervalMs >= 1000);
  });

  await t.test('Scenario S2: Overlap protection prevents concurrent execution when a cycle is active', async () => {
    const scheduler = new DailyHealthScheduler({
      auditLogPath: TEST_AUDIT_LOG,
      lockFilePath: TEST_LOCK_FILE,
      intervalMs: 100000
    });

    const lock1 = scheduler.acquireLock();
    assert.equal(lock1, true, 'First lock acquisition must succeed');

    const lock2 = scheduler.acquireLock();
    assert.equal(lock2, false, 'Second lock acquisition must be blocked (overlap protection)');

    const result = await scheduler.executeCycle();
    assert.equal(result.skipped, true);
    assert.ok(result.reason.includes('overlap protection active'));

    scheduler.releaseLock();
    assert.equal(scheduler.isCycleRunning, false);
  });

  await t.test('Scenario S3: Daily monitor detects live gig closure and updates public.gigs in place (Stopped)', async () => {
    const mockGigsTable = [
      {
        id: 'gig_live_001',
        title: 'Active Senior AI Evaluator',
        status: 'Active',
        origin_url: 'https://example.com/job/closed-101',
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z'
      }
    ];

    const mockLiveClient = {
      from: (tableName) => {
        assert.equal(tableName, 'gigs');
        return {
          select: async () => ({ data: [...mockGigsTable], error: null }),
          update: (fields) => ({
            eq: async (field, val) => {
              assert.equal(field, 'id');
              const idx = mockGigsTable.findIndex(g => g.id === val);
              if (idx !== -1) {
                mockGigsTable[idx] = { ...mockGigsTable[idx], ...fields };
              }
              return { error: null };
            }
          })
        };
      }
    };

    // Probe returns 404 (closure)
    const mockProbe = async (url) => {
      if (url.includes('closed-101')) {
        return { accessible: false, isClosed: true, statusCode: 404, reason: 'Target returned HTTP 404' };
      }
      return { accessible: true, statusCode: 200, reason: null };
    };

    const mockRepo = {
      getAll: async () => []
    };

    const mockRegistry = {
      init: async () => {},
      getAllSources: () => [],
      save: async () => {}
    };

    const summary = await runHealthMonitoringCycle({
      repository: mockRepo,
      sourceRegistry: mockRegistry,
      probeFn: mockProbe,
      liveGigsClient: mockLiveClient,
      checkLiveGigs: true
    });

    assert.equal(summary.live_gigs_checked, 1);
    assert.equal(mockGigsTable.length, 1, 'Record count must remain strictly 1 (no duplicate insertion)');
    assert.equal(mockGigsTable[0].id, 'gig_live_001', 'Original record ID must be preserved');
    assert.equal(mockGigsTable[0].status, 'Stopped', 'Confirmed closed listing must transition to Stopped in place');
  });

  await t.test('Scenario S4: Daily monitor detects live gig pause signal and updates public.gigs in place (Paused)', async () => {
    const mockGigsTable = [
      {
        id: 'gig_live_002',
        title: 'Midjourney Prompt Designer',
        status: 'Active',
        origin_url: 'https://example.com/job/paused-202',
        created_at: '2026-10-02T00:00:00Z'
      }
    ];

    const mockLiveClient = {
      from: () => ({
        select: async () => ({ data: [...mockGigsTable], error: null }),
        update: (fields) => ({
          eq: async (_f, val) => {
            const idx = mockGigsTable.findIndex(g => g.id === val);
            if (idx !== -1) mockGigsTable[idx] = { ...mockGigsTable[idx], ...fields };
            return { error: null };
          }
        })
      })
    };

    const mockProbe = async (url) => {
      if (url.includes('paused-202')) {
        return { accessible: false, isPaused: true, statusCode: 200, reason: 'Page content indicates applications are paused' };
      }
      return { accessible: true, statusCode: 200, reason: null };
    };

    const summary = await runHealthMonitoringCycle({
      repository: { getAll: async () => [] },
      sourceRegistry: { init: async () => {}, getAllSources: () => [], save: async () => {} },
      probeFn: mockProbe,
      liveGigsClient: mockLiveClient,
      checkLiveGigs: true
    });

    assert.equal(summary.live_gigs_checked, 1);
    assert.equal(mockGigsTable.length, 1);
    assert.equal(mockGigsTable[0].status, 'Paused', 'Paused opportunity must transition to Paused and be excluded from active results');
  });

  await t.test('Scenario S5: Inconclusive live gig check safely sets Needs Review without removing gig or false Stopped', async () => {
    const mockGigsTable = [
      {
        id: 'gig_live_003',
        title: 'Automation Workflow Builder',
        status: 'Active',
        origin_url: 'https://example.com/job/uncertain-303'
      }
    ];

    const mockLiveClient = {
      from: () => ({
        select: async () => ({ data: [...mockGigsTable], error: null }),
        update: (fields) => ({
          eq: async (_f, val) => {
            const idx = mockGigsTable.findIndex(g => g.id === val);
            if (idx !== -1) mockGigsTable[idx] = { ...mockGigsTable[idx], ...fields };
            return { error: null };
          }
        })
      })
    };

    // Probe returns bot block (403) or transient timeout
    const mockProbe = async () => ({
      accessible: false,
      statusCode: 403,
      reason: 'HTTP 403 bot block / Cloudflare challenge'
    });

    await runHealthMonitoringCycle({
      repository: { getAll: async () => [] },
      sourceRegistry: { init: async () => {}, getAllSources: () => [], save: async () => {} },
      probeFn: mockProbe,
      liveGigsClient: mockLiveClient,
      checkLiveGigs: true
    });

    assert.equal(mockGigsTable[0].status, 'Needs Review', 'Inconclusive signals must be safely flagged as Needs Review');
  });

  await t.test('Scenario S6: Daily scheduler writes audit records to disk upon cycle completion', async () => {
    const scheduler = new DailyHealthScheduler({
      auditLogPath: TEST_AUDIT_LOG,
      lockFilePath: TEST_LOCK_FILE,
      intervalMs: 100000,
      monitorOptions: {
        repository: { getAll: async () => [] },
        sourceRegistry: { init: async () => {}, getAllSources: () => [], save: async () => {} },
        checkLiveGigs: false
      }
    });

    const result = await scheduler.executeCycle();
    assert.equal(result.success, true);
    assert.equal(result.runsCompleted, 1);

    assert.ok(fs.existsSync(TEST_AUDIT_LOG), 'Audit log file must be written to disk');
    const logContent = JSON.parse(fs.readFileSync(TEST_AUDIT_LOG, 'utf8'));
    assert.equal(Array.isArray(logContent), true);
    assert.equal(logContent.length, 1);
    assert.equal(logContent[0].cycle_number, 1);
    assert.equal(logContent[0].success, true);
    assert.ok(logContent[0].executed_at);
  });

  await t.test('Scenario S7: Scheduler timer lifecycle starts, updates status, and stops cleanly', () => {
    const scheduler = new DailyHealthScheduler({
      auditLogPath: TEST_AUDIT_LOG,
      lockFilePath: TEST_LOCK_FILE,
      intervalMs: 60000
    });

    scheduler.start(false); // Do not run immediate async cycle
    assert.equal(scheduler.isActive, true);
    const status = scheduler.getStatus();
    assert.equal(status.isActive, true);
    assert.ok(status.nextRunAt);

    scheduler.stop();
    assert.equal(scheduler.isActive, false);
    assert.equal(scheduler.timer, null);
    assert.equal(fs.existsSync(TEST_LOCK_FILE), false, 'Lockfile must be removed upon stop');
  });

  await t.test('Scenario S8: probeUrlAvailability blocks loopback, cloud metadata, and unsafe redirects with SSRF protection', async () => {
    // 1. Loopback addresses must be blocked
    const resLoopback = await probeUrlAvailability('http://127.0.0.1:8080/test');
    assert.equal(resLoopback.accessible, false);
    assert.equal(resLoopback.isInconclusive, true);
    assert.equal(resLoopback.statusCode, 400);
    assert.match(resLoopback.reason, /Blocked by SSRF policy/i);

    const resLocalhost = await probeUrlAvailability('http://localhost:3000/api');
    assert.equal(resLocalhost.accessible, false);
    assert.equal(resLocalhost.isInconclusive, true);
    assert.equal(resLocalhost.statusCode, 400);
    assert.match(resLocalhost.reason, /Blocked by SSRF policy/i);

    // 2. Link-local and cloud metadata addresses must be blocked
    const resMetadata = await probeUrlAvailability('http://169.254.169.254/latest/meta-data/');
    assert.equal(resMetadata.accessible, false);
    assert.equal(resMetadata.isInconclusive, true);
    assert.equal(resMetadata.statusCode, 400);
    assert.match(resMetadata.reason, /Blocked by SSRF policy/i);

    const resInternalDomain = await probeUrlAvailability('http://metadata.google.internal/computeMetadata/v1/');
    assert.equal(resInternalDomain.accessible, false);
    assert.equal(resInternalDomain.isInconclusive, true);
    assert.equal(resInternalDomain.statusCode, 400);
    assert.match(resInternalDomain.reason, /Blocked by SSRF policy/i);

    // 3. Unsafe redirects must be blocked on redirect hop
    const mockRedirectFetcher = {
      safeFetch: async (url) => {
        // First hop is public, but returns redirect to loopback
        if (url === 'https://example.com/job/redirect') {
          return {
            ok: false,
            status: 400,
            statusText: 'Bad Request - Blocked by SSRF Policy',
            text: '',
            finalUrl: 'http://127.0.0.1:8080/secret',
            headers: new Headers(),
            redirectCount: 1,
            error: 'Direct IP "127.0.0.1" falls within a prohibited private or link-local range.'
          };
        }
        return { ok: false, status: 404, statusText: 'Not Found', text: '', finalUrl: url, headers: new Headers(), redirectCount: 0 };
      }
    };
    const resRedirect = await probeUrlAvailability('https://example.com/job/redirect', 8000, mockRedirectFetcher);
    assert.equal(resRedirect.accessible, false);
    assert.equal(resRedirect.isInconclusive, true);
    assert.equal(resRedirect.statusCode, 400);
    assert.match(resRedirect.reason, /Blocked by SSRF policy/i);

    // 4. Request timeouts must be marked inconclusive without false Stopped
    const mockTimeoutFetcher = {
      safeFetch: async (url) => ({
        ok: false,
        status: 408,
        statusText: 'Request Timeout',
        text: '',
        finalUrl: url,
        headers: new Headers(),
        redirectCount: 0,
        error: 'Request exceeded timeout limit of 8000ms'
      })
    };
    const resTimeout = await probeUrlAvailability('https://example.com/slow', 8000, mockTimeoutFetcher);
    assert.equal(resTimeout.accessible, false);
    assert.equal(resTimeout.isClosed, false);
    assert.equal(resTimeout.isInconclusive, true);
    assert.match(resTimeout.reason, /timed out/i);

    // 5. Normal public URLs (mocked) return appropriate active or closed states
    const mockActiveFetcher = {
      safeFetch: async (url) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: '<html><body>Join our AI engineering team! Apply now.</body></html>',
        finalUrl: url,
        headers: new Headers(),
        redirectCount: 0
      })
    };
    const resActive = await probeUrlAvailability('https://example.com/active-job', 8000, mockActiveFetcher);
    assert.equal(resActive.accessible, true);
    assert.equal(resActive.statusCode, 200);
    assert.equal(resActive.reason, null);

    const mockClosedFetcher = {
      safeFetch: async (url) => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: '',
        finalUrl: url,
        headers: new Headers(),
        redirectCount: 0
      })
    };
    const resClosed = await probeUrlAvailability('https://example.com/expired-job', 8000, mockClosedFetcher);
    assert.equal(resClosed.accessible, false);
    assert.equal(resClosed.isClosed, true);
    assert.equal(resClosed.statusCode, 404);
  });
});
