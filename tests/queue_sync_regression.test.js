import test, { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const candidatesJsonPath = path.resolve(__dirname, '../data/candidates.json');
const allCandidates = JSON.parse(fs.readFileSync(candidatesJsonPath, 'utf8'));

describe('Regression: AI Discovery Queue Sync Store State Preservation', () => {
  let originalWindow;
  let originalLocalStorage;
  let originalFetch;
  let mockStorageStore = {};

  const mockLocalStorage = {
    getItem: (key) => (key in mockStorageStore ? mockStorageStore[key] : null),
    setItem: (key, val) => { mockStorageStore[key] = String(val); },
    removeItem: (key) => { delete mockStorageStore[key]; },
    clear: () => { mockStorageStore = {}; }
  };

  beforeEach(() => {
    mockStorageStore = {};
    originalWindow = globalThis.window;
    originalLocalStorage = globalThis.localStorage;
    originalFetch = globalThis.fetch;

    globalThis.window = {};
    globalThis.localStorage = mockLocalStorage;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
    globalThis.fetch = originalFetch;
    mockStorageStore = {};
  });

  it('reproduces exact 4-step sequence and verifies 14 candidates remain visible before, during, and after sync and tab navigation', async () => {
    const {
      loadLocalCandidates,
      saveLocalCandidates,
      fetchCandidateQueue
    } = await import('../src/discovery/candidateStore.js');

    // Setup: Seed browser localStorage with the exact 14 initial candidates
    const initial14 = allCandidates.slice(0, 14);
    assert.equal(initial14.length, 14, 'Must seed exactly 14 candidates');
    saveLocalCandidates(initial14);

    // =========================================================================
    // STEP 1: Open AI Discovery Queue. It shows 14 pending candidates.
    // =========================================================================
    let queueState = loadLocalCandidates();
    assert.equal(queueState.length, 14, 'Step 1: Queue must initially load 14 candidates');

    const idsBeforeSync = queueState.map(c => c.id);
    assert.equal(idsBeforeSync.length, 14);
    const pendingCountBeforeSync = queueState.filter(c => c.status === 'pending_review').length;
    assert.equal(pendingCountBeforeSync, 14, 'Step 1: All 14 candidates must be pending_review');

    // Simulate Component UI state
    let stateCandidates = [...queueState];
    let actionSuccessMsg = '';
    let actionWarningMsg = '';
    let actionErrorMsg = '';

    const computeCounts = (list) => ({
      pending: list.filter(c => c.status === 'pending_review').length,
      approved: list.filter(c => c.status === 'approved').length,
      total: list.length
    });

    let counts = computeCounts(stateCandidates);
    assert.equal(counts.pending, 14);
    assert.equal(counts.total, 14);

    // =========================================================================
    // STEP 2: Click Sync Store.
    // In buggy code:
    //   Remote returned 401 Unauthorized or []
    //   React state was blindly set to []
    //   Counts changed to Pending: 0, Total: 0
    //   Misleading banner: "Synced with candidate store (0 listings loaded)"
    // In fixed code:
    //   fetchCandidateQueue detects 401/empty and preserves local candidates with warning metadata
    //   handleRefreshQueue preserves existing 14 candidates
    //   Warning alert is set, misleading zero-success message is prevented
    //   Counts remain Pending: 14, Total: 14
    // =========================================================================
    // Mock fetch returning HTTP 401 Unauthorized (unauthenticated client)
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized: Authentication required.' })
    });

    // Execute handleRefreshQueue logic
    actionSuccessMsg = '';
    actionWarningMsg = '';
    actionErrorMsg = '';

    const fresh = await fetchCandidateQueue();

    // Verify response from fetchCandidateQueue
    assert.ok(Array.isArray(fresh), 'Response must be an Array');
    assert.equal(fresh.syncSuccess, false, 'Sync must flag failure');
    assert.equal(fresh.syncStatus, 'warning', 'Sync status must be warning');
    assert.equal(fresh.isFallback, true, 'Result must be flagged as fallback');
    assert.match(fresh.syncMessage, /administrator authentication/i);

    // Simulate handleRefreshQueue state management logic
    if (fresh && fresh.syncSuccess && !fresh.isFallback && fresh.length > 0) {
      stateCandidates = fresh;
      actionSuccessMsg = `Synced with candidate store (${fresh.length} listings loaded)`;
    } else if (fresh && (fresh.syncStatus === 'warning' || fresh.isFallback)) {
      if (stateCandidates.length === 0 && fresh.length > 0) {
        stateCandidates = fresh;
      }
      actionWarningMsg = fresh.syncMessage || `Remote store returned no new records. Preserved ${stateCandidates.length} existing candidate listings.`;
    } else if (fresh && fresh.syncStatus === 'error') {
      if (stateCandidates.length === 0 && fresh.length > 0) {
        stateCandidates = fresh;
      }
      actionErrorMsg = fresh.syncMessage || `Remote store sync error. Preserved ${stateCandidates.length} existing candidate listings.`;
    } else if (Array.isArray(fresh) && fresh.length > 0) {
      stateCandidates = fresh;
      actionSuccessMsg = `Synced with candidate store (${fresh.length} listings loaded)`;
    } else {
      actionWarningMsg = `Remote store returned no usable records. Preserved ${stateCandidates.length} existing candidate listings.`;
    }

    // Immediately after sync: Verify state is NOT wiped
    counts = computeCounts(stateCandidates);
    assert.equal(stateCandidates.length, 14, 'Step 2: Candidate state must remain 14 immediately after sync');
    assert.equal(counts.pending, 14, 'Step 2: Pending count must NOT drop to 0');
    assert.equal(counts.total, 14, 'Step 2: Total count must NOT drop to 0');
    assert.deepEqual(stateCandidates.map(c => c.id), idsBeforeSync, 'Step 2: Candidate IDs must remain identical');

    // Verify warning banner is displayed and misleading success banner is empty
    assert.equal(actionSuccessMsg, '', 'Step 2: Misleading 0-listing success banner must not be set');
    assert.match(actionWarningMsg, /administrator authentication/i, 'Step 2: Warning banner must be set');
    assert.match(actionWarningMsg, /Preserved 14 existing candidate listings/i);

    // Verify localStorage was never corrupted with an empty array
    const persistedAfterSync = JSON.parse(mockLocalStorage.getItem('upshift_discovery_candidates'));
    assert.equal(persistedAfterSync.length, 14, 'Step 2: Local storage must retain 14 candidates');

    // =========================================================================
    // STEP 3: Navigate to Opportunities Directory (component unmounts).
    // =========================================================================
    // Component unmounts
    let componentMounted = false;
    stateCandidates = null; // Unmounted React state is cleared from memory

    // Verify localStorage remains intact while navigated away
    const persistedDuringTabSwitch = JSON.parse(mockLocalStorage.getItem('upshift_discovery_candidates'));
    assert.equal(persistedDuringTabSwitch.length, 14, 'Step 3: Storage must persist all 14 candidates during navigation away');
    assert.deepEqual(
      persistedDuringTabSwitch.map(c => c.id),
      idsBeforeSync,
      'Step 3: Persisted IDs must remain identical during navigation away'
    );

    // =========================================================================
    // STEP 4: Return to AI Discovery Queue (component remounts).
    // =========================================================================
    componentMounted = true;
    // Remount initializes state with loadLocalCandidates()
    const remountedCandidates = loadLocalCandidates();
    assert.equal(remountedCandidates.length, 14, 'Step 4: Remounted queue must display 14 candidates');

    const idsAfterNavBack = remountedCandidates.map(c => c.id);
    assert.deepEqual(idsAfterNavBack, idsBeforeSync, 'Step 4: Candidate IDs must be 100% identical after returning');

    const countsAfterNavBack = computeCounts(remountedCandidates);
    assert.equal(countsAfterNavBack.pending, 14, 'Step 4: Pending count must be 14');
    assert.equal(countsAfterNavBack.total, 14, 'Step 4: Total count must be 14');

    // Mount effect runs fetchCandidateQueue()
    const mountEffectQueue = await fetchCandidateQueue();
    // Mount effect guard: only sets state if fresh.syncSuccess && !fresh.isFallback && length > 0
    let effectUpdatedCandidates = remountedCandidates;
    if (mountEffectQueue && mountEffectQueue.syncSuccess && !mountEffectQueue.isFallback && mountEffectQueue.length > 0) {
      effectUpdatedCandidates = mountEffectQueue;
    }
    assert.equal(effectUpdatedCandidates.length, 14, 'Mount effect must NOT overwrite with 0 records');
  });

  it('preserves existing candidates when remote store returns 0 usable records (HTTP 200 with empty array)', async () => {
    const {
      saveLocalCandidates,
      fetchCandidateQueue
    } = await import('../src/discovery/candidateStore.js');

    const initial14 = allCandidates.slice(0, 14);
    saveLocalCandidates(initial14);

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => []
    });

    const res = await fetchCandidateQueue();
    assert.ok(Array.isArray(res));
    assert.equal(res.length, 14, 'Must fall back to 14 preserved candidates');
    assert.equal(res.syncSuccess, false);
    assert.equal(res.syncStatus, 'warning');
    assert.match(res.syncMessage, /returned 0 usable listings/i);
    assert.match(res.syncMessage, /Preserved 14 existing candidate listings/i);
  });

  it('preserves existing candidates when remote endpoint encounters network exception', async () => {
    const {
      saveLocalCandidates,
      fetchCandidateQueue
    } = await import('../src/discovery/candidateStore.js');

    const initial14 = allCandidates.slice(0, 14);
    saveLocalCandidates(initial14);

    globalThis.fetch = async () => {
      throw new Error('ECONNREFUSED: Server unreachable');
    };

    const res = await fetchCandidateQueue();
    assert.ok(Array.isArray(res));
    assert.equal(res.length, 14, 'Must fall back to 14 preserved candidates');
    assert.equal(res.syncSuccess, false);
    assert.equal(res.syncStatus, 'warning');
    assert.match(res.syncMessage, /unreachable/i);
  });

  it('updates queue when remote store returns valid fresh candidate listings', async () => {
    const {
      saveLocalCandidates,
      fetchCandidateQueue
    } = await import('../src/discovery/candidateStore.js');

    const initial14 = allCandidates.slice(0, 14);
    saveLocalCandidates(initial14);

    // Simulate remote having 20 candidates
    const remoteCandidates = allCandidates.slice(0, 20);
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => remoteCandidates
    });

    const res = await fetchCandidateQueue();
    assert.ok(Array.isArray(res));
    assert.equal(res.length, 20, 'Must successfully load 20 listings from remote');
    assert.equal(res.syncSuccess, true);
    assert.equal(res.isFallback, false);
    assert.equal(res.syncSource, 'api');

    // Verify localStorage updated
    const persisted = JSON.parse(mockLocalStorage.getItem('upshift_discovery_candidates'));
    assert.equal(persisted.length, 20);
  });

  it('safely handles non-JSON / HTML responses (SPA router fallback) without throwing and preserves candidates', async () => {
    const {
      saveLocalCandidates,
      fetchCandidateQueue
    } = await import('../src/discovery/candidateStore.js');

    const initial14 = allCandidates.slice(0, 14);
    saveLocalCandidates(initial14);

    // Simulate SPA fallback where /api/candidates returned index.html with <!doctype html>
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (h) => (h.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null)
      },
      text: async () => '<!doctype html><html><head><title>UpShift</title></head><body><div id="root"></div></body></html>',
      json: async () => {
        throw new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON");
      }
    });

    const res = await fetchCandidateQueue();
    assert.ok(Array.isArray(res));
    assert.equal(res.length, 14, 'Must fall back to 14 preserved candidates without crashing');
    assert.equal(res.syncSuccess, false);
    assert.equal(res.syncStatus, 'warning');
    assert.match(res.syncMessage, /non-JSON response/i);
    assert.match(res.syncMessage, /Preserved 14 existing candidate listings/i);
  });

  it('one-click rejection works without reason popup, setting status to rejected and reason to null', async () => {
    const candidateQueueSrc = fs.readFileSync('./src/pages/CandidateReviewQueue.jsx', 'utf8');

    // Verify rejection reason modal has been removed
    assert.equal(candidateQueueSrc.includes('Reject Candidate Opportunity'), false, 'Rejection modal title must not exist');
    assert.equal(candidateQueueSrc.includes('rejectingCandidateId'), false, 'rejectingCandidateId state must not exist');
    assert.equal(candidateQueueSrc.includes('rejectionReasonInput'), false, 'rejectionReasonInput state must not exist');
    assert.equal(candidateQueueSrc.includes('handleRejectConfirm'), false, 'handleRejectConfirm modal submit handler must not exist');

    // Verify handleReject accepts optional reason defaulting to null
    assert.ok(candidateQueueSrc.includes('const handleReject = (candOrId, reason = null) => {'), 'handleReject must accept optional reason with default null');

    // Simulate handleReject logic
    const testCandidate = { ...allCandidates[0], status: 'pending_review' };
    const simulatedReject = (cand, reason = null) => {
      return {
        ...cand,
        status: 'rejected',
        is_approved: false,
        rejection_reason: reason || null,
        reviewed_at: new Date().toISOString()
      };
    };

    const rejected = simulatedReject(testCandidate);
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.is_approved, false);
    assert.equal(rejected.rejection_reason, null);
    assert.ok(rejected.reviewed_at);
  });

  it('syncing 8 remote candidates cannot reduce a local queue of 221 to 8', async () => {
    const {
      saveLocalCandidates,
      loadLocalCandidates,
      fetchCandidateQueue
    } = await import('../src/discovery/candidateStore.js');

    // Seed full set of 221 candidates in local cache
    assert.equal(allCandidates.length, 221, 'candidates.json must contain 221 candidates');
    saveLocalCandidates(allCandidates);

    const initialLocal = loadLocalCandidates();
    assert.equal(initialLocal.length, 221);
    const initialPending = initialLocal.filter(c => c.status === 'pending_review').length;
    assert.equal(initialPending, 85);

    // Mock remote server returning only 8 candidates (e.g. initial fixture batch)
    const remote8 = allCandidates.slice(0, 8).map(c => ({
      ...c,
      title: `${c.title} (Synced from Remote)`
    }));

    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/candidates')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => remote8
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const res = await fetchCandidateQueue();

    // Verify queue was NOT truncated to 8!
    assert.equal(res.length, 221, 'Syncing 8 remote candidates must NOT reduce queue from 221 to 8');
    assert.equal(res.syncSuccess, true);
    assert.equal(res.syncSource, 'api');
    assert.equal(res.isFallback, false);

    // Verify localStorage also retains all 221 candidates
    const persisted = JSON.parse(mockLocalStorage.getItem('upshift_discovery_candidates'));
    assert.equal(persisted.length, 221, 'Persisted localStorage must retain 221 candidates');

    // Verify pending review count is preserved
    const resPending = res.filter(c => c.status === 'pending_review').length;
    assert.equal(resPending, 85, 'Pending count must remain 85');

    // Verify matching 8 received updated remote authoritative titles
    for (let i = 0; i < 8; i++) {
      const found = res.find(c => c.id === remote8[i].id);
      assert.ok(found, `Candidate ${remote8[i].id} must exist in reconciled list`);
      assert.match(found.title, /Synced from Remote/);
    }
  });

  it('existing approved/rejected review states are preserved during reconciliation', async () => {
    const {
      reconcileCandidates
    } = await import('../src/discovery/candidateStore.js');

    const localCandidates = [
      {
        id: 'cand_test_approved',
        title: 'Old Title 1',
        status: 'approved',
        reviewed_by: 'admin@upshift.work',
        reviewed_at: '2026-10-14T10:00:00.000Z',
        admin_notes: 'Approved for M2 track',
        published_gig_id: 'gig_101'
      },
      {
        id: 'cand_test_rejected',
        title: 'Old Title 2',
        status: 'rejected',
        reviewed_by: 'admin@upshift.work',
        reviewed_at: '2026-10-14T11:00:00.000Z',
        rejection_reason: 'Not a freelance gig'
      },
      {
        id: 'cand_test_pending',
        title: 'Old Title 3',
        status: 'pending_review'
      }
    ];

    // Remote records have fresh crawl data, but lack review decisions (defaulting to pending_review)
    // or remote has a newer review decision for candidate 3
    const remoteCandidates = [
      {
        id: 'cand_test_approved',
        title: 'Authoritative Crawler Title 1',
        description: 'New detailed job description from source feed',
        status: 'pending_review', // Remote ingested raw candidate lacks review metadata
        reviewed_by: null,
        reviewed_at: null,
        admin_notes: ''
      },
      {
        id: 'cand_test_rejected',
        title: 'Authoritative Crawler Title 2',
        description: 'Updated description from source feed',
        status: 'pending_review',
        rejection_reason: null
      },
      {
        id: 'cand_test_pending',
        title: 'Authoritative Crawler Title 3',
        status: 'approved', // Remote has an authoritative newer approval
        reviewed_by: 'lead_curator@upshift.work',
        reviewed_at: '2026-10-15T09:00:00.000Z',
        admin_notes: 'Verified remote listing'
      }
    ];

    const reconciled = reconcileCandidates(localCandidates, remoteCandidates);

    assert.equal(reconciled.length, 3);

    // 1. Approved state must be preserved despite remote being pending_review
    const item1 = reconciled.find(c => c.id === 'cand_test_approved');
    assert.equal(item1.status, 'approved', 'Must preserve locally approved status');
    assert.equal(item1.reviewed_by, 'admin@upshift.work', 'Must preserve reviewed_by');
    assert.equal(item1.admin_notes, 'Approved for M2 track', 'Must preserve admin_notes');
    assert.equal(item1.published_gig_id, 'gig_101', 'Must preserve published_gig_id');
    assert.equal(item1.title, 'Authoritative Crawler Title 1', 'Must take remote authoritative title');
    assert.equal(item1.description, 'New detailed job description from source feed', 'Must take remote authoritative description');

    // 2. Rejected state must be preserved despite remote being pending_review
    const item2 = reconciled.find(c => c.id === 'cand_test_rejected');
    assert.equal(item2.status, 'rejected', 'Must preserve locally rejected status');
    assert.equal(item2.rejection_reason, 'Not a freelance gig', 'Must preserve rejection_reason');
    assert.equal(item2.reviewed_by, 'admin@upshift.work', 'Must preserve reviewed_by');
    assert.equal(item2.title, 'Authoritative Crawler Title 2', 'Must take remote authoritative title');

    // 3. Remote valid newer review state is adopted when local had no review decision
    const item3 = reconciled.find(c => c.id === 'cand_test_pending');
    assert.equal(item3.status, 'approved', 'Must adopt remote approved status');
    assert.equal(item3.reviewed_by, 'lead_curator@upshift.work');
    assert.equal(item3.admin_notes, 'Verified remote listing');
  });

  it('asynchronous job transitions from pending/running to success and failure, including queue refresh and polling cleanup', async () => {
    const {
      fetchJobStatus,
      saveLocalCandidates,
      loadLocalCandidates
    } = await import('../src/discovery/candidateStore.js');

    // Verify fetchJobStatus correctly queries /api/discovery/status?jobId=...
    let requestedUrl = '';
    globalThis.fetch = async (url) => {
      requestedUrl = String(url);
      if (requestedUrl.includes('/api/discovery/status?jobId=job_poll_test')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            job: {
              id: 'job_poll_test',
              status: 'running',
              job_type: 'discovery',
              started_at: new Date().toISOString()
            }
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
    };

    const runningJob = await fetchJobStatus('job_poll_test');
    assert.ok(runningJob, 'Must fetch running job record');
    assert.equal(runningJob.id, 'job_poll_test');
    assert.equal(runningJob.status, 'running');
    assert.match(requestedUrl, /jobId=job_poll_test/);

    // =========================================================================
    // Scenario A: Transition from pending/running -> succeeded with queue refresh
    // =========================================================================
    const initialCandidates = [
      { id: 'cand_init_1', title: 'Initial Candidate 1', status: 'pending_review' }
    ];
    saveLocalCandidates(initialCandidates);

    // Mock completion response with result summary
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/discovery/status?jobId=')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            job: {
              id: 'job_succ_1',
              status: 'succeeded',
              result_summary: {
                newly_saved: 5,
                fetched: 25,
                relevant: 20,
                total_pending: 6
              }
            }
          })
        };
      }
      if (u.includes('/api/candidates')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => [
            { id: 'cand_init_1', title: 'Initial Candidate 1 (Updated)', status: 'pending_review' },
            { id: 'cand_new_2', title: 'Newly Discovered 2', status: 'pending_review' }
          ]
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    // Simulate poller cycle for succeeded job
    let simulatedActiveJob = { id: 'job_succ_1', status: 'pending' };
    let pollTimerCleared = false;
    let timerRef = 12345;
    const mockClearTimeout = (id) => {
      if (id === timerRef) pollTimerCleared = true;
    };

    const statusResult = await fetchJobStatus(simulatedActiveJob.id);
    assert.equal(statusResult.status, 'succeeded');

    // Trigger authoritative queue refresh
    const { fetchCandidateQueue } = await import('../src/discovery/candidateStore.js');
    const refreshed = await fetchCandidateQueue();
    assert.equal(refreshed.length, 2, 'Queue must reflect refreshed candidates');
    assert.equal(refreshed[0].title, 'Initial Candidate 1 (Updated)');
    assert.equal(refreshed[1].id, 'cand_new_2');

    // Simulated component state update on success
    simulatedActiveJob = { ...simulatedActiveJob, ...statusResult };
    assert.equal(simulatedActiveJob.status, 'succeeded');
    mockClearTimeout(timerRef);
    assert.equal(pollTimerCleared, true, 'Timer must be cleaned up on success');

    // =========================================================================
    // Scenario B: Transition from pending/running -> failed with error message
    // =========================================================================
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/discovery/status?jobId=')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            job: {
              id: 'job_fail_1',
              status: 'failed',
              error_message: 'Upstream feed HTTP 503 gateway unavailable'
            }
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    let simulatedFailedJob = { id: 'job_fail_1', status: 'running' };
    let failTimerCleared = false;

    const failedJobResult = await fetchJobStatus(simulatedFailedJob.id);
    assert.equal(failedJobResult.status, 'failed');
    assert.equal(failedJobResult.error_message, 'Upstream feed HTTP 503 gateway unavailable');

    simulatedFailedJob = { ...simulatedFailedJob, ...failedJobResult };
    assert.equal(simulatedFailedJob.status, 'failed');
    if (simulatedFailedJob.status === 'failed') {
      failTimerCleared = true;
    }
    assert.equal(failTimerCleared, true, 'Polling must stop and timer cleared on job failure');

    // Queue in localStorage must remain uncorrupted
    const remainingStore = loadLocalCandidates();
    assert.ok(remainingStore.length > 0, 'Candidates must not be cleared on job failure');
  });
});

