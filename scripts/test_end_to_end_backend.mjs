/**
 * Phase 4: End-to-End Backend Lifecycle & Gate Verification
 * Traces candidate from discovery -> classification -> deduplication ->
 * staging -> availability verification -> reviewer decision -> publishing gates.
 */

import assert from 'node:assert/strict';
import { DiscoveryPipeline } from '../src/server/pipeline.js';
import { JsonCandidateRepository } from '../src/server/candidateRepository.js';
import { probeUrlAvailability } from '../src/server/monitor.js';
import { validateForPublishing } from '../src/discovery/candidateStore.js';
import { CANDIDATE_STATUS, ACTIVITY_STATUS } from '../src/discovery/types.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const E2E_DATA_FILE = path.join(__dirname, '../data/test_e2e_candidates.json');

export async function runEndToEndBackendTests() {
  console.log('===============================================================');
  console.log(' Phase 4: End-to-End Backend Lifecycle & Gate Verification');
  console.log('===============================================================\n');

  try {
    if (fs.existsSync(E2E_DATA_FILE)) fs.unlinkSync(E2E_DATA_FILE);
  } catch {}

  const repo = new JsonCandidateRepository(E2E_DATA_FILE);
  const pipeline = new DiscoveryPipeline({ repository: repo });
  const scenarioResults = [];

  // =========================================================================
  // Test 1: Real Candidate Ingestion & Staging Trace
  // =========================================================================
  console.log('--- Scenario 1: Candidate Ingestion, Classification & Staging ---');
  const rawListing = {
    source_name: 'jobicy',
    source_type: 'public_api',
    source_listing_id: 'job_e2e_401',
    original_url: 'https://jobicy.com/jobs/401-fullstack-ai-engineer',
    canonical_url: 'https://jobicy.com/jobs/401-fullstack-ai-engineer',
    application_url: 'https://jobicy.com/jobs/401-fullstack-ai-engineer',
    title: 'Fullstack AI Engineer (React, Node, Claude)',
    organization: 'NeuralWave Technologies',
    description: 'We are seeking a Fullstack AI Engineer to build agentic interfaces using React, Node.js, and Cursor. Requirements: 3+ years fullstack, experience with modern LLMs. Deliverables: Interactive frontend components and webhook endpoints.',
    payment_amount: '$110,000 - $140,000 / year',
    min_amount: 110000,
    max_amount: 140000,
    currency: 'USD',
    compensation_type: 'annual',
    location: 'Remote',
    work_arrangement: 'remote',
    posted_date: '2026-10-12'
  };

  const stagedCandidate = await pipeline.processListing(rawListing);
  await repo.save(stagedCandidate);

  const check1_staged = stagedCandidate.status === CANDIDATE_STATUS.PENDING_REVIEW;
  const check1_track = stagedCandidate.track_id === 'M4';
  const check1_score = stagedCandidate.module_fit_score >= 70;
  const s1_passed = check1_staged && check1_track && check1_score;

  scenarioResults.push({
    scenario: '1. Ingestion & Staging Trace',
    passed: s1_passed,
    details: `Track: ${stagedCandidate.track_id}, Score: ${stagedCandidate.module_fit_score}%, Status: ${stagedCandidate.status}`
  });
  console.log(` -> Result: ${s1_passed ? 'PASS' : 'FAIL'} (${scenarioResults[0].details})\n`);

  // =========================================================================
  // Test 2: In-Place Update on Repeated Discovery Run (No Duplication)
  // =========================================================================
  console.log('--- Scenario 2: Repeated Discovery Run Updates In-Place (No Duplicate Insertion) ---');
  const existingPool = await repo.getAll();
  assert.equal(existingPool.length, 1);

  // Re-fetch the same listing with a slightly updated description
  const repeatedListing = {
    ...rawListing,
    description: rawListing.description + ' Updated with new bonus incentive.'
  };

  const recheckedCandidate = await pipeline.processListing(repeatedListing, existingPool);
  const saveBatchResult = await repo.saveBatch([recheckedCandidate]);

  const allAfterRepeat = await repo.getAll();
  const s2_passed = allAfterRepeat.length === 1 &&
                    recheckedCandidate.id === stagedCandidate.id &&
                    !recheckedCandidate.is_duplicate &&
                    saveBatchResult.inserted === 0 &&
                    saveBatchResult.updated === 1;

  scenarioResults.push({
    scenario: '2. In-Place Update on Re-check',
    passed: s2_passed,
    details: `Total in store: ${allAfterRepeat.length} (expected 1), Inserted: ${saveBatchResult.inserted}, Updated: ${saveBatchResult.updated}, ID preserved: ${recheckedCandidate.id === stagedCandidate.id}`
  });
  console.log(` -> Result: ${s2_passed ? 'PASS' : 'FAIL'} (${scenarioResults[1].details})\n`);

  // =========================================================================
  // Test 3: Availability Verification Inconclusive Handling
  // =========================================================================
  console.log('--- Scenario 3: Availability Verification Inconclusive Routing ---');
  // Mock probe with inconclusive condition (timeout / bot challenge)
  const inconclusiveProbe = await probeUrlAvailability('https://httpstat.us/403?sleep=100', {
    fetcher: {
      async safeFetch() {
        return { ok: false, status: 403, error: 'Forbidden bot challenge block' };
      }
    }
  });

  const check3_inconc = inconclusiveProbe.isInconclusive === true;
  const check3_notActive = inconclusiveProbe.accessible === false;
  const s3_passed = check3_inconc && check3_notActive;

  scenarioResults.push({
    scenario: '3. Inconclusive Availability Verification',
    passed: s3_passed,
    details: `isInconclusive: ${inconclusiveProbe.isInconclusive}, accessible: ${inconclusiveProbe.accessible}, reason: ${inconclusiveProbe.reason}`
  });
  console.log(` -> Result: ${s3_passed ? 'PASS' : 'FAIL'} (${scenarioResults[2].details})\n`);

  // =========================================================================
  // Test 4: Gate Enforcement on Invalid, Irrelevant, Duplicate & Unverified Candidates
  // =========================================================================
  console.log('--- Scenario 4: Review & Publishing Gate Enforcement ---');

  // Gate 4a: Candidate still pending review cannot be published
  const gatePending = validateForPublishing(stagedCandidate);
  const p1 = !gatePending.valid && gatePending.error.includes('must be explicitly approved');

  // Gate 4b: Irrelevant candidate cannot be published
  const gateIrrelevant = validateForPublishing({
    ...stagedCandidate,
    status: CANDIDATE_STATUS.APPROVED,
    is_relevant: false
  });
  const p2 = !gateIrrelevant.valid && gateIrrelevant.error.includes('irrelevant');

  // Gate 4c: Duplicate listing cannot be published
  const gateDuplicate = validateForPublishing({
    ...stagedCandidate,
    status: CANDIDATE_STATUS.APPROVED,
    is_duplicate: true
  });
  const p3 = !gateDuplicate.valid && gateDuplicate.error.includes('duplicate');

  // Gate 4d: Mandatory referral missing cannot be published
  const gateReferral = validateForPublishing({
    ...stagedCandidate,
    status: CANDIDATE_STATUS.APPROVED,
    referral_required: true,
    referral_id: '',
    referral_url: ''
  });
  const p4 = !gateReferral.valid && gateReferral.error.includes('referral');

  // Gate 4e: Stopped listing cannot be published
  const gateStopped = validateForPublishing({
    ...stagedCandidate,
    status: CANDIDATE_STATUS.APPROVED,
    activity_status: ACTIVITY_STATUS.STOPPED
  });
  const p5 = !gateStopped.valid && gateStopped.error.includes('stopped');

  // Gate 4f: Legitimate approved candidate with active status and valid referral SUCCEEDS
  const gateApproved = validateForPublishing({
    ...stagedCandidate,
    status: CANDIDATE_STATUS.APPROVED,
    activity_status: ACTIVITY_STATUS.ACTIVE,
    referral_required: true,
    referral_url: 'https://jobicy.com/jobs/401-fullstack-ai-engineer?ref=upshift_admin'
  });
  const p6 = gateApproved.valid === true;

  const s4_passed = p1 && p2 && p3 && p4 && p5 && p6;
  scenarioResults.push({
    scenario: '4. Gate Enforcement (Pending/Irrel/Dup/Ref/Stopped)',
    passed: s4_passed,
    details: `Pending blocked: ${p1}, Irrelevant blocked: ${p2}, Duplicate blocked: ${p3}, Referral missing blocked: ${p4}, Stopped blocked: ${p5}, Fully Approved passed: ${p6}`
  });
  console.log(` -> Result: ${s4_passed ? 'PASS' : 'FAIL'} (${scenarioResults[3].details})\n`);

  console.log('===============================================================');
  console.log(' Phase 4 End-to-End Verification Summary:');
  console.log('===============================================================');
  console.table(scenarioResults.map(r => ({
    'Scenario': r.scenario,
    'Status': r.passed ? 'PASS' : 'FAIL',
    'Details': r.details
  })));

  try {
    if (fs.existsSync(E2E_DATA_FILE)) fs.unlinkSync(E2E_DATA_FILE);
  } catch {}

  const allPassed = scenarioResults.every(r => r.passed);
  console.log(`\nOverall Phase 4 End-to-End Verification: ${allPassed ? 'ALL SCENARIOS PASSED' : 'FAILURES DETECTED'}`);
  return { allPassed, scenarioResults };
}

runEndToEndBackendTests().catch(console.error);
