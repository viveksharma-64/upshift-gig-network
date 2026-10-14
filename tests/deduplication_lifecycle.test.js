/**
 * Comprehensive Deduplication Lifecycle Test Suite
 *
 * Verifies all 10 deduplication scenarios required by the system:
 * 1. Same external ID discovered twice
 * 2. Same URL with different tracking parameters
 * 3. Same gig discovered from two different sources
 * 4. Similar titles belonging to different organizations remain separate
 * 5. Repeated daily monitoring never increases the number of records
 * 6. Status changes do not create duplicate gigs
 * 7. Re-running discovery and publishing is idempotent
 * 8. Concurrent workers cannot publish the same opportunity twice
 * 9. CSV export and active-gig queries contain no confirmed duplicates
 * 10. Existing reviewer decisions, referral details, and audit history survive updates
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeCanonicalUrl,
  normalizeTextKey,
  generateDeduplicationKey,
  calculateTextSimilarity,
  findDuplicate,
  deduplicateGigList
} from '../src/server/deduplication.js';

import { CANDIDATE_STATUS, ACTIVITY_STATUS, createCandidate } from '../src/discovery/types.js';
import { DiscoveryPipeline } from '../src/server/pipeline.js';
import { JsonCandidateRepository } from '../src/server/candidateRepository.js';
import { runHealthMonitoringCycle } from '../src/server/monitor.js';
import { publishCandidateToGigs } from '../src/discovery/candidateStore.js';
import { exportGigsTo19ColCSV, parseRFC4180CSV } from '../src/discovery/csvExport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRATCH_DIR = path.resolve(__dirname, '../data/test_scratch');

/**
 * Creates an in-memory mock Supabase client for isolated publishing unit tests
 */
function createMockGigsClient() {
  const store = new Map();
  return {
    from(tableName) {
      return {
        select() {
          return Promise.resolve({ data: Array.from(store.values()), error: null });
        },
        insert(rows) {
          const inserted = (Array.isArray(rows) ? rows : [rows]).map(r => {
            const row = {
              ...r,
              id: r.id || `gig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            };
            store.set(row.id, row);
            return row;
          });
          return {
            select() {
              return Promise.resolve({ data: inserted, error: null });
            },
            then(resolve, reject) {
              return Promise.resolve({ data: inserted, error: null }).then(resolve, reject);
            }
          };
        },
        update(fields) {
          return {
            eq(col, val) {
              return {
                select() {
                  const existing = store.get(val);
                  if (existing) {
                    const updated = { ...existing, ...fields };
                    store.set(val, updated);
                    return Promise.resolve({ data: [updated], error: null });
                  }
                  return Promise.resolve({ data: [], error: null });
                },
                then(resolve, reject) {
                  const existing = store.get(val);
                  if (existing) {
                    const updated = { ...existing, ...fields };
                    store.set(val, updated);
                    return Promise.resolve({ data: [updated], error: null }).then(resolve, reject);
                  }
                  return Promise.resolve({ data: [], error: null }).then(resolve, reject);
                }
              };
            }
          };
        }
      };
    }
  };
}

describe('Deduplication Lifecycle & Integrity Verification', () => {

  // --------------------------------------------------------------------------
  // Scenario 1: Same external ID discovered twice
  // --------------------------------------------------------------------------
  test('Scenario 1: Same external ID discovered twice maps to existing record and does not duplicate', async () => {
    const scratchFile = path.join(SCRATCH_DIR, `dup_ext_${Date.now()}.json`);
    const repo = new JsonCandidateRepository(scratchFile);

    const mockProvider = {
      name: 'github_jobs',
      type: 'api',
      fetchCandidates: async () => [
        {
          source_name: 'github_jobs',
          source_listing_id: 'gh-job-8899',
          title: 'AI Data Reviewer',
          organization: 'DataWorks Inc',
          url: 'https://dataworks.com/jobs/8899',
          description: 'Review RLHF datasets'
        }
      ]
    };

    const pipeline = new DiscoveryPipeline({
      repository: repo,
      llmService: null,
      providers: [mockProvider]
    });

    // Cycle 1: First discovery
    const cycle1 = await pipeline.runCycle();
    assert.equal(cycle1.discovered, 1);
    assert.equal(cycle1.inserted, 1);
    assert.equal(cycle1.total, 1);

    const stored1 = await repo.getAll();
    assert.equal(stored1.length, 1);
    const firstId = stored1[0].id;

    // Cycle 2: Second discovery of identical external ID
    const cycle2 = await pipeline.runCycle();
    assert.equal(cycle2.discovered, 1);
    assert.equal(cycle2.inserted, 0, 'Must not insert a new record for existing external ID');
    assert.equal(cycle2.updated, 1, 'Must update the existing candidate in place');
    assert.equal(cycle2.total, 1, 'Total record count must remain 1');

    const stored2 = await repo.getAll();
    assert.equal(stored2.length, 1);
    assert.equal(stored2[0].id, firstId, 'Original candidate ID must be preserved');
    assert.equal(stored2[0].is_duplicate, false, 'In-place update must not falsely tag itself as duplicate');

    try { await fs.unlink(scratchFile); } catch {}
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Same URL with different tracking parameters
  // --------------------------------------------------------------------------
  test('Scenario 2: Same URL with different tracking parameters normalizes to same canonical URL and detects duplicate', () => {
    const urlA = 'https://work.example.com/listings/123/?utm_source=linkedin&utm_medium=cpc&ref=campaign_a#apply';
    const urlB = 'https://work.example.com/listings/123?fbclid=IwAR234&gclid=xyz789&trk=feed';
    const urlC = 'https://work.example.com/listings/123/?job_id=999&utm_campaign=spring';

    const canonicalA = normalizeCanonicalUrl(urlA);
    const canonicalB = normalizeCanonicalUrl(urlB);
    const canonicalC = normalizeCanonicalUrl(urlC);

    assert.equal(canonicalA, 'https://work.example.com/listings/123');
    assert.equal(canonicalB, 'https://work.example.com/listings/123');
    // Notice: job_id is materially significant and is preserved!
    assert.equal(canonicalC, 'https://work.example.com/listings/123?job_id=999');

    const existingCandidate = {
      id: 'cand_url_1',
      source_name: 'rss_source',
      title: 'Prompt Engineer',
      organization: 'Example Corp',
      original_url: urlA,
      canonical_url: canonicalA
    };

    const newCandidate = {
      id: 'cand_url_2',
      source_name: 'rss_source',
      title: 'Prompt Engineer',
      organization: 'Example Corp',
      original_url: urlB,
      canonical_url: canonicalB
    };

    const match = findDuplicate(newCandidate, [existingCandidate]);
    assert.equal(match.isDuplicate, true);
    assert.equal(match.matchRule, 'CANONICAL_URL');
    assert.equal(match.duplicateOf.id, 'cand_url_1');
  });

  // --------------------------------------------------------------------------
  // Scenario 3: Same gig discovered from two different sources
  // --------------------------------------------------------------------------
  test('Scenario 3: Same gig discovered from two different sources is tagged as cross-source duplicate', async () => {
    const primaryGig = {
      id: 'cand_src_a',
      source_name: 'github_jobs',
      source_listing_id: 'gh-101',
      original_url: 'https://careers.openai.com/jobs/annotator?ref=github',
      canonical_url: 'https://careers.openai.com/jobs/annotator',
      title: 'RLHF Data Specialist',
      organization: 'OpenAI',
      status: CANDIDATE_STATUS.PENDING_REVIEW
    };

    const crossSourceGig = {
      id: 'cand_src_b',
      source_name: 'rss_feed_aggregator',
      source_listing_id: 'rss-feed-999',
      original_url: 'https://careers.openai.com/jobs/annotator?utm_source=rss',
      canonical_url: 'https://careers.openai.com/jobs/annotator',
      title: 'RLHF Data Specialist',
      organization: 'OpenAI'
    };

    const match = findDuplicate(crossSourceGig, [primaryGig]);
    assert.equal(match.isDuplicate, true);
    assert.equal(match.isCrossSource, true, 'Must flag cross-source match');
    assert.equal(match.duplicateOf.id, 'cand_src_a');

    // Process through pipeline to verify lifecycle assignment
    const pipeline = new DiscoveryPipeline({ repository: null, llmService: null, providers: [] });
    const processed = await pipeline.processListing({
      ...crossSourceGig,
      original_url: crossSourceGig.original_url
    }, [primaryGig]);

    assert.equal(processed.is_duplicate, true);
    assert.equal(processed.duplicate_of, 'cand_src_a');
    assert.equal(processed.status, CANDIDATE_STATUS.DUPLICATE, 'Cross-source duplicate must have status duplicate');
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Similar titles belonging to different organizations remain separate
  // --------------------------------------------------------------------------
  test('Scenario 4: Similar titles belonging to different organizations remain separate and are never merged', () => {
    const gigOrgA = {
      id: 'gig_google',
      source_name: 'board',
      source_listing_id: 'g-1',
      title: 'Senior AI Prompt Engineer',
      organization: 'Google',
      canonical_url: 'https://careers.google.com/jobs/1'
    };

    const gigOrgB = {
      id: 'gig_microsoft',
      source_name: 'board',
      source_listing_id: 'ms-1',
      title: 'Senior AI Prompt Engineer',
      organization: 'Microsoft',
      canonical_url: 'https://careers.microsoft.com/jobs/1'
    };

    const match = findDuplicate(gigOrgB, [gigOrgA]);
    assert.equal(match.isDuplicate, false, 'Must NOT merge identical titles belonging to different organizations');
    assert.equal(match.duplicateOf, null);
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Repeated daily monitoring never increases the number of records
  // --------------------------------------------------------------------------
  test('Scenario 5: Repeated daily monitoring never increases the number of records', async () => {
    const scratchFile = path.join(SCRATCH_DIR, `monitor_test_${Date.now()}.json`);
    const repo = new JsonCandidateRepository(scratchFile);

    // Seed repository with 3 candidate records
    const seedCandidates = [
      createCandidate({
        id: 'mon_cand_1',
        title: 'AI Video Editor',
        organization: 'ReelFlow',
        application_url: 'https://reelflow.io/apply/1',
        activity_status: ACTIVITY_STATUS.ACTIVE,
        status: CANDIDATE_STATUS.APPROVED
      }),
      createCandidate({
        id: 'mon_cand_2',
        title: 'Bilingual RLHF Annotator',
        organization: 'LangAI',
        application_url: 'https://langai.org/jobs/telugu',
        activity_status: ACTIVITY_STATUS.ACTIVE,
        status: CANDIDATE_STATUS.APPROVED
      }),
      createCandidate({
        id: 'mon_cand_3',
        title: 'Fullstack Next.js Developer',
        organization: 'DevCorp',
        application_url: 'https://devcorp.com/careers/nextjs',
        activity_status: ACTIVITY_STATUS.ACTIVE,
        status: CANDIDATE_STATUS.APPROVED
      })
    ];

    await repo.saveBatch(seedCandidates);
    const initialRecords = await repo.getAll();
    assert.equal(initialRecords.length, 3);

    // Mock probe function returning active or stopped responses
    const mockProbe = async (url) => {
      if (url.includes('langai.org')) {
        // langai becomes stopped (404)
        return { accessible: false, statusCode: 404, reason: 'HTTP 404 Not Found (Opportunity removed/expired)' };
      }
      return { accessible: true, statusCode: 200, reason: null };
    };

    // Run health monitoring 5 consecutive times
    for (let cycle = 1; cycle <= 5; cycle++) {
      await runHealthMonitoringCycle({
        repository: repo,
        probeFn: mockProbe,
        dryRun: false
      });

      const recordsAfterCycle = await repo.getAll();
      assert.equal(recordsAfterCycle.length, 3, `Record count must remain strictly 3 on cycle ${cycle}`);
    }

    // Verify langai is stopped in place and others remained active
    const finalRecords = await repo.getAll();
    const stoppedRecord = finalRecords.find(c => c.id === 'mon_cand_2');
    assert.equal(stoppedRecord.activity_status, ACTIVITY_STATUS.STOPPED);
    assert.equal(stoppedRecord.status, CANDIDATE_STATUS.STOPPED);

    try { await fs.unlink(scratchFile); } catch {}
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Status changes do not create duplicate gigs
  // --------------------------------------------------------------------------
  test('Scenario 6: Status changes (Active -> Paused -> Stopped -> Needs Review) do not create duplicate gigs', async () => {
    const scratchFile = path.join(SCRATCH_DIR, `status_trans_${Date.now()}.json`);
    const repo = new JsonCandidateRepository(scratchFile);

    const gig = createCandidate({
      id: 'trans_cand_1',
      title: 'Autonomous AI Agent Developer',
      organization: 'AgentHub',
      status: CANDIDATE_STATUS.APPROVED,
      activity_status: ACTIVITY_STATUS.ACTIVE
    });

    await repo.save(gig);
    assert.equal((await repo.getAll()).length, 1);

    // 1. Transition: Paused
    const paused = { ...gig, status: CANDIDATE_STATUS.PAUSED, activity_status: ACTIVITY_STATUS.PAUSED };
    await repo.save(paused);
    assert.equal((await repo.getAll()).length, 1);
    assert.equal((await repo.getById('trans_cand_1')).status, CANDIDATE_STATUS.PAUSED);

    // 2. Transition: Stopped
    const stopped = { ...paused, status: CANDIDATE_STATUS.STOPPED, activity_status: ACTIVITY_STATUS.STOPPED };
    await repo.save(stopped);
    assert.equal((await repo.getAll()).length, 1);
    assert.equal((await repo.getById('trans_cand_1')).status, CANDIDATE_STATUS.STOPPED);

    // 3. Transition: Needs Review
    const needsReview = { ...stopped, status: CANDIDATE_STATUS.NEEDS_RECHECK, activity_status: ACTIVITY_STATUS.UNCERTAIN };
    await repo.save(needsReview);
    assert.equal((await repo.getAll()).length, 1);
    assert.equal((await repo.getById('trans_cand_1')).status, CANDIDATE_STATUS.NEEDS_RECHECK);

    // 4. Transition: Re-activated through human review
    const reactivated = { ...needsReview, status: CANDIDATE_STATUS.APPROVED, activity_status: ACTIVITY_STATUS.ACTIVE };
    await repo.save(reactivated);
    assert.equal((await repo.getAll()).length, 1);
    assert.equal((await repo.getById('trans_cand_1')).status, CANDIDATE_STATUS.APPROVED);

    try { await fs.unlink(scratchFile); } catch {}
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Re-running discovery and publishing is idempotent
  // --------------------------------------------------------------------------
  test('Scenario 7: Re-running discovery and publishing is idempotent', async () => {
    const scratchFile = path.join(SCRATCH_DIR, `idempotent_${Date.now()}.json`);
    const repo = new JsonCandidateRepository(scratchFile);
    const mockGigsClient = createMockGigsClient();

    const mockListing = {
      source_name: 'test_feed',
      source_listing_id: 'feed-777',
      title: 'Prompt Optimization Specialist',
      organization: 'PromptCraft',
      url: 'https://promptcraft.co/gigs/777',
      description: 'Optimize system prompts for production models'
    };

    const pipeline = new DiscoveryPipeline({
      repository: repo,
      llmService: null,
      providers: [{ name: 'test_feed', type: 'rss', fetchCandidates: async () => [mockListing] }]
    });

    // Run discovery 3 times
    await pipeline.runCycle();
    await pipeline.runCycle();
    await pipeline.runCycle();

    const storedCandidates = await repo.getAll();
    assert.equal(storedCandidates.length, 1, 'Store must contain exactly 1 candidate after 3 discovery runs');

    // Approve the candidate so it is ready for publication
    const candidateToPublish = {
      ...storedCandidates[0],
      status: CANDIDATE_STATUS.APPROVED,
      activity_status: ACTIVITY_STATUS.ACTIVE
    };

    // Test publishing idempotency
    const pubResult1 = await publishCandidateToGigs(candidateToPublish, { role: 'admin' }, { client: mockGigsClient, skipRecheck: true });
    assert.equal(pubResult1.success, true);
    assert.equal(pubResult1.inserted, true);

    const pubResult2 = await publishCandidateToGigs(candidateToPublish, { role: 'admin' }, { client: mockGigsClient, skipRecheck: true });
    assert.equal(pubResult2.success, true);
    assert.equal(pubResult2.updated, true, 'Second publish call must update in-place idempotently');
    assert.equal(pubResult1.publishedGig.id, pubResult2.publishedGig.id, 'Must return same published gig record');

    try { await fs.unlink(scratchFile); } catch {}
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Concurrent workers cannot publish the same opportunity twice
  // --------------------------------------------------------------------------
  test('Scenario 8: Concurrent workers cannot publish the same opportunity twice', async () => {
    const mockGigsClient = createMockGigsClient();

    const candidate = createCandidate({
      id: 'concurrent_cand_1',
      source_listing_id: 'conc-999',
      title: 'AI Audio Engineer',
      organization: 'SoundWave AI',
      application_url: 'https://soundwave.ai/jobs/conc-999',
      status: CANDIDATE_STATUS.APPROVED,
      activity_status: ACTIVITY_STATUS.ACTIVE
    });

    // Launch 5 parallel publishing calls concurrently
    const parallelCalls = [
      publishCandidateToGigs(candidate, { role: 'admin' }, { client: mockGigsClient, skipRecheck: true }),
      publishCandidateToGigs(candidate, { role: 'admin' }, { client: mockGigsClient, skipRecheck: true }),
      publishCandidateToGigs(candidate, { role: 'admin' }, { client: mockGigsClient, skipRecheck: true }),
      publishCandidateToGigs(candidate, { role: 'admin' }, { client: mockGigsClient, skipRecheck: true }),
      publishCandidateToGigs(candidate, { role: 'admin' }, { client: mockGigsClient, skipRecheck: true })
    ];

    const results = await Promise.all(parallelCalls);
    for (const r of results) {
      assert.equal(r.success, true, `All concurrent publishing calls must resolve successfully: ${r.error}`);
    }

    // All must reference the identical published gig ID
    const firstPublishedId = results[0].publishedGig.id;
    for (const r of results) {
      assert.equal(r.publishedGig.id, firstPublishedId, 'All concurrent workers must publish/update the exact same record');
    }
  });

  // --------------------------------------------------------------------------
  // Scenario 9: CSV export and active-gig queries contain no confirmed duplicates
  // --------------------------------------------------------------------------
  test('Scenario 9: CSV export and active-gig queries contain no confirmed duplicates', () => {
    const dirtyGigs = [
      { id: '1', external_gig_id: 'GIG-001', title: 'Video Editor', origin_url: 'https://jobs.com/1', status: 'Active' },
      // Duplicate by external_gig_id:
      { id: '2', external_gig_id: 'GIG-001', title: 'Video Editor (Copy)', origin_url: 'https://jobs.com/1-copy', status: 'Active' },
      // Duplicate by canonical URL:
      { id: '3', external_gig_id: 'GIG-002', title: 'Video Editor 2', origin_url: 'https://jobs.com/1?utm_source=twitter', status: 'Active' },
      // Distinct gig:
      { id: '4', external_gig_id: 'GIG-003', title: 'RLHF Annotator', origin_url: 'https://jobs.com/2', status: 'Active' },
      // Flagged duplicate:
      { id: '5', external_gig_id: 'GIG-004', title: 'RLHF Annotator Copy', origin_url: 'https://jobs.com/3', is_duplicate: true, status: 'Active' }
    ];

    // 1. Active-gig query deduplication
    const deduplicatedActive = deduplicateGigList(dirtyGigs);
    assert.equal(deduplicatedActive.length, 2, 'Must filter down to strictly 2 unique opportunities');
    assert.equal(deduplicatedActive[0].external_gig_id, 'GIG-001');
    assert.equal(deduplicatedActive[1].external_gig_id, 'GIG-003');

    // 2. CSV export deduplication
    const csvString = exportGigsTo19ColCSV(dirtyGigs);
    const parsedRows = parseRFC4180CSV(csvString);
    assert.equal(parsedRows.length, 3, 'CSV export must contain 1 header + 2 data rows');
    const dataRows = parsedRows.slice(1);
    assert.equal(dataRows.length, 2, 'CSV export must contain exactly 2 unique data rows');
    assert.equal(dataRows[0][0], 'GIG-001');
    assert.equal(dataRows[1][0], 'GIG-003');
  });

  // --------------------------------------------------------------------------
  // Scenario 10: Existing reviewer decisions, referral details, and audit history survive updates
  // --------------------------------------------------------------------------
  test('Scenario 10: Existing reviewer decisions, referral details, and audit history survive updates', async () => {
    const scratchFile = path.join(SCRATCH_DIR, `provenance_audit_${Date.now()}.json`);
    const repo = new JsonCandidateRepository(scratchFile);

    // Initial candidate created and reviewed by an admin
    const initialCandidate = createCandidate({
      id: 'prov_cand_99',
      source_name: 'github_jobs',
      source_listing_id: 'gh-prov-99',
      title: 'Lead Prompt Engineer',
      organization: 'Vanguard AI',
      status: CANDIDATE_STATUS.APPROVED,
      reviewed_by: 'reviewer_admin_uuid_456',
      reviewed_at: '2026-10-12T10:00:00.000Z',
      admin_notes: 'Verified qualifications and confirmed hourly rate of $60/hr.',
      referral_id: 'REF-VANGUARD-99',
      referral_url: 'https://vanguard.ai/referral/99',
      referral_required: true,
      referral_history: [
        {
          edited_at: '2026-10-12T10:00:00.000Z',
          edited_by: 'reviewer_admin_uuid_456',
          new_id: 'REF-VANGUARD-99',
          new_url: 'https://vanguard.ai/referral/99'
        }
      ]
    });

    await repo.save(initialCandidate);

    // Later: an automated discovery worker re-crawls the opportunity with updated description
    const reCrawledListing = {
      source_name: 'github_jobs',
      source_listing_id: 'gh-prov-99',
      title: 'Lead Prompt Engineer',
      organization: 'Vanguard AI',
      original_url: 'https://vanguard.ai/jobs/99',
      description: 'Updated responsibilities: Lead multi-turn evaluations'
    };

    const pipeline = new DiscoveryPipeline({
      repository: repo,
      llmService: null,
      providers: [{ name: 'github_jobs', type: 'api', fetchCandidates: async () => [reCrawledListing] }]
    });

    // Run cycle to process re-crawled listing
    await pipeline.runCycle();

    const storedList = await repo.getAll();
    assert.equal(storedList.length, 1, 'Record count must remain 1');

    const updated = storedList[0];
    assert.equal(updated.id, 'prov_cand_99', 'Record ID must survive update');
    assert.equal(updated.status, CANDIDATE_STATUS.APPROVED, 'Reviewer approval status must survive update');
    assert.equal(updated.reviewed_by, 'reviewer_admin_uuid_456', 'Reviewed_by UUID must survive update');
    assert.equal(updated.admin_notes, 'Verified qualifications and confirmed hourly rate of $60/hr.', 'Admin review notes must survive update');
    assert.equal(updated.referral_id, 'REF-VANGUARD-99', 'Referral ID must survive update');
    assert.equal(updated.referral_url, 'https://vanguard.ai/referral/99', 'Referral URL must survive update');
    assert.equal(updated.referral_required, true, 'Referral requirement flag must survive update');
    assert.equal(updated.referral_history.length, 1, 'Referral audit history must survive update');
    assert.equal(updated.description, 'Updated responsibilities: Lead multi-turn evaluations', 'Listing description must be updated');

    try { await fs.unlink(scratchFile); } catch {}
  });

});
