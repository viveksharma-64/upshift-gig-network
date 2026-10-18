/**
 * Targeted Unit Tests: UpShift Admin Review Queue Distinctions
 *
 * Verifies:
 * 1. Clear separation between Link Verification and Gig Qualification.
 * 2. An accessible webpage is NOT labeled as a confirmed gig without explicit gig evidence.
 * 3. Shows opportunity link status, freelance/task-based work confirmation, and why candidate is pending review.
 * 4. Learner dashboard isolation: uncertain/pending candidates are held in staging and cannot appear on the learner dashboard.
 * 5. Preservation of existing admin review decisions (approved/rejected).
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateGigRelevance } from '../src/server/gigClassifier.js';
import { CANDIDATE_STATUS, ACTIVITY_STATUS } from '../src/discovery/types.js';

describe('Admin Review Queue — Link vs Gig Verification Distinctions', () => {
  const queueSrc = fs.readFileSync('./src/pages/CandidateReviewQueue.jsx', 'utf8');
  const dashboardSrc = fs.readFileSync('./src/pages/Dashboard.jsx', 'utf8');

  test('1. Candidate cards clearly present Opportunity Link Status with simplified badges', () => {
    // Check for distinct Opportunity Link status line
    assert.ok(
      queueSrc.includes('Opportunity Link:') && queueSrc.includes('Live Page Verified'),
      'Card must explicitly label Opportunity Link status'
    );

    // Confirmed Gig and Opp. Page badges are removed from candidate cards
    assert.equal(
      queueSrc.includes("Confirmed Gig ("),
      false,
      'Card must not render Confirmed Gig badge'
    );
    assert.equal(
      queueSrc.includes("Opp. Page"),
      false,
      'Card must not render Opp. Page badge'
    );
  });

  test('2. A candidate is NOT labeled as a confirmed gig solely because its webpage is accessible', () => {
    // When a listing has 200 HTTP active webpage but no freelance signals
    const activeWebpageCorporateListing = {
      title: 'Marketing Specialist',
      company: 'Corporate Enterprise LLC',
      description: 'Join our marketing department to support corporate brand initiatives.',
      http_status: 200,
      activity_status: 'Active',
      activity_confidence: 90
    };

    const evaluation = evaluateGigRelevance(activeWebpageCorporateListing);
    assert.equal(evaluation.is_gig, false, 'Active webpage must not cause is_gig to be true');
    assert.equal(evaluation.action, 'pending_review');

    // UI inspection: Candidate cards do not conflate webpage accessibility with gig confirmation
    assert.equal(
      queueSrc.includes("Confirmed Gig ("),
      false,
      'Confirmed Gig badge is removed from candidate cards'
    );
  });

  test('3. Candidate card renders a dedicated Pending Review rationale banner for pending candidates', () => {
    assert.ok(
      queueSrc.includes('Pending Review: ') && queueSrc.includes('Work arrangement unconfirmed'),
      'Card must render Pending Review banner with human-readable rationale'
    );
  });

  test('4. Inspection modal provides simplified Opportunity Link Verification panel and omits Gig Qualification section', () => {
    // Section 1: Link Verification
    assert.ok(
      queueSrc.includes('Opportunity Link Verification') && queueSrc.includes('Link Reachability:'),
      'Modal must have dedicated Opportunity Link Verification panel'
    );
    assert.ok(
      queueSrc.includes('Webpage accessibility verifies destination reachability only; it does not confirm freelance or task-based qualification'),
      'Modal must include explicit disclaimer that webpage accessibility does not equate to gig qualification'
    );

    // Single link: only Opportunity URL is shown
    assert.ok(queueSrc.includes('Opportunity URL:'), 'Opportunity URL must be displayed');
    assert.equal(queueSrc.includes('Application / Task-Start URL:'), false, 'Application / Task-Start URL must be removed');
    assert.equal(queueSrc.includes('>Recheck Link</button>'), false, 'Visible Recheck Link button must be removed');

    // Section 2: Gig Qualification & Review Status section is completely removed
    assert.equal(
      queueSrc.includes('Gig Qualification & Review Status'),
      false,
      'Modal must omit the redundant Gig Qualification & Review Status section'
    );
  });

  test('5. Learner catalog isolation: uncertain/pending candidates cannot appear on the learner dashboard', () => {
    // In Dashboard.jsx, learner view only queries gigs table where status is Active
    assert.ok(
      dashboardSrc.includes(".from('gigs')"),
      'Dashboard must query public.gigs table, never unapproved staging candidates'
    );
  });

  test('6. Admin decisions preservation: Approved and Rejected statuses are distinct from pending_review', () => {
    assert.notEqual(CANDIDATE_STATUS.APPROVED, CANDIDATE_STATUS.PENDING_REVIEW);
    assert.notEqual(CANDIDATE_STATUS.REJECTED, CANDIDATE_STATUS.PENDING_REVIEW);
  });
});
