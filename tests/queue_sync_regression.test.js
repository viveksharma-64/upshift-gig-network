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
});
