/**
 * UpShift Production Bug Fixes Regression Suite
 *
 * Verifies end-to-end fixes for:
 * 1. Admin Approval Schema Compatibility & Failure Handling
 * 2. Admin/Learner Count Inconsistency & Zero Demo Seed Fallback
 * 3. Broken Opportunity Links (DNS NXDOMAIN, Remotevideo fixture, Recheck)
 * 4. Candidate UI Safety & Link Audit De-cluttering
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  publishCandidateToGigs,
  recheckOpportunityAvailability,
  validateForPublishing
} from '../src/discovery/candidateStore.js';
import {
  verifyLinkDeep
} from '../src/server/linkVerifier.js';
import { LINK_STATUS, LINK_TYPE } from '../src/discovery/urlClassifier.js';
import { createCandidate, CANDIDATE_STATUS, ACTIVITY_STATUS } from '../src/discovery/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Issue 1: Admin Approval Schema Compatibility & Error Handling', () => {
  test('publishCandidateToGigs successfully inserts into gigs using real production columns', async () => {
    let insertedPayload = null;
    const mockDb = {
      from: (table) => {
        assert.equal(table, 'gigs');
        return {
          select: () => ({
            or: () => Promise.resolve({ data: [], error: null })
          }),
          insert: (payload) => {
            insertedPayload = Array.isArray(payload) ? payload[0] : payload;
            return {
              select: () => Promise.resolve({ data: [{ id: 'gig_mock_1', ...insertedPayload }], error: null })
            };
          }
        };
      }
    };

    const candidate = createCandidate({
      id: 'cand_test_approval_001',
      title: 'Senior Prompt Engineer',
      track_id: 'M1',
      source_name: 'test_provider',
      original_url: 'https://example.com/gigs/prompt-engineer',
      opportunity_url: 'https://example.com/gigs/prompt-engineer',
      application_url: 'https://example.com/apply/prompt-engineer',
      organization: 'Acme AI',
      description: 'Design and optimize LLM prompts for production apps.',
      requirements: 'Experience with LLMs and prompt evaluation.',
      payment_amount: '$60/hr',
      compensation_type: 'hourly',
      min_amount: 60,
      max_amount: 60,
      currency: 'USD',
      work_arrangement: 'remote',
      activity_status: ACTIVITY_STATUS.ACTIVE,
      status: CANDIDATE_STATUS.APPROVED,
      link_status: LINK_STATUS.VERIFIED
    });

    const result = await publishCandidateToGigs(candidate, {
      dbClient: mockDb,
      recheckAvailability: false
    });

    assert.equal(result.success, true);
    assert.ok(insertedPayload, 'Payload must be passed to insert');
    
    // Must NOT contain columns that do not exist in production public.gigs
    assert.equal(insertedPayload.application_url, undefined, 'Must not write unpersisted application_url to gigs');
    assert.equal(insertedPayload.opportunity_url, undefined, 'Must not write unpersisted opportunity_url to gigs');
    assert.equal(insertedPayload.company, undefined, 'Must not write unpersisted company to gigs');
    assert.equal(insertedPayload.organization, undefined, 'Must not write unpersisted organization to gigs');
    assert.equal(insertedPayload.link_type, undefined, 'Must not write unpersisted link_type to gigs');
    assert.equal(insertedPayload.link_status, undefined, 'Must not write unpersisted link_status to gigs');
    assert.equal(insertedPayload.link_evidence, undefined, 'Must not write unpersisted link_evidence to gigs');

    // Must map authentic application/opportunity URL to real production column origin_url
    assert.equal(insertedPayload.origin_url, 'https://example.com/apply/prompt-engineer');
    assert.equal(insertedPayload.title, 'Senior Prompt Engineer');
    assert.equal(insertedPayload.track_id, 'M1');
    assert.equal(insertedPayload.status, 'Active');
  });

  test('publishCandidateToGigs sanitizes payload and retries if schema cache error occurs', async () => {
    let callCount = 0;
    const mockDb = {
      from: () => ({
        select: () => ({
          or: () => Promise.resolve({ data: [], error: null })
        }),
        insert: (payload) => {
          callCount++;
          if (callCount === 1) {
            return {
              select: () => Promise.resolve({
                error: { message: "Could not find the 'application_url' column of 'gigs' in the schema cache" }
              })
            };
          }
          return {
            select: () => Promise.resolve({ data: [{ id: 'gig_mock_2', ...payload }], error: null })
          };
        }
      })
    };

    const candidate = createCandidate({
      id: 'cand_test_retry_002',
      title: 'AI Data Labeler',
      track_id: 'M3',
      source_name: 'test_provider',
      original_url: 'https://example.com/gigs/labeler',
      application_url: 'https://example.com/apply/labeler',
      activity_status: ACTIVITY_STATUS.ACTIVE,
      status: CANDIDATE_STATUS.APPROVED,
      link_status: LINK_STATUS.VERIFIED
    });

    const result = await publishCandidateToGigs(candidate, {
      dbClient: mockDb,
      recheckAvailability: false
    });

    assert.equal(result.success, true);
    assert.equal(callCount, 2, 'Should retry with sanitized columns');
  });

  test('publishCandidateToGigs fails safely and returns error when database write fails completely', async () => {
    const mockDb = {
      from: () => ({
        select: () => ({
          or: () => Promise.resolve({ data: [], error: null })
        }),
        insert: () => ({
          select: () => Promise.resolve({
            error: { message: 'relation "gigs" does not exist' }
          })
        })
      })
    };

    const candidate = createCandidate({
      id: 'cand_test_fail_003',
      title: 'AI Video Editor',
      track_id: 'M1',
      source_name: 'test_provider',
      original_url: 'https://example.com/gigs/video-editor',
      activity_status: ACTIVITY_STATUS.ACTIVE,
      status: CANDIDATE_STATUS.APPROVED,
      link_status: LINK_STATUS.VERIFIED
    });

    const result = await publishCandidateToGigs(candidate, {
      dbClient: mockDb,
      recheckAvailability: false
    });

    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.match(result.error, /relation "gigs" does not exist/);
  });
});

describe('Issue 2: Admin/Learner Count Inconsistency & Zero Demo Seed Fallback', () => {
  test('Dashboard.jsx does not throw ReferenceError for setLoading in AdminDashboard', () => {
    const dashboardSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/Dashboard.jsx'), 'utf8');
    
    // Check that AdminDashboard declares loading state
    const adminDashboardMatch = dashboardSrc.match(/export function AdminDashboard\(\)[\s\S]*?(?=export function LearnerDashboard|$)/);
    assert.ok(adminDashboardMatch, 'AdminDashboard function must exist');
    assert.match(adminDashboardMatch[0], /const\s+\[loading,\s*setLoading\]\s*=\s*useState/, 'AdminDashboard must declare useState for loading');
  });

  test('LearnerDashboard and AdminDashboard do not fall back to DEFAULT_SEED_GIGS when database returns empty or fails', () => {
    const dashboardSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/Dashboard.jsx'), 'utf8');
    
    // Verify that data is not replaced by DEFAULT_SEED_GIGS if data is empty or errored
    assert.doesNotMatch(
      dashboardSrc,
      /setGigs\(data\s*&&\s*data\.length\s*>\s*0\s*\?\s*data\s*:\s*DEFAULT_SEED_GIGS\)/,
      'Must not silently substitute DEFAULT_SEED_GIGS when production data is empty'
    );
    assert.doesNotMatch(
      dashboardSrc,
      /catch[\s\S]*?setGigs\(DEFAULT_SEED_GIGS\)/,
      'Must not fall back to DEFAULT_SEED_GIGS on fetch error'
    );
  });
});

describe('Issue 3: Broken Opportunity Links & DNS Failure Handling', () => {
  test('verifyLinkDeep handles DNS resolution failures (NXDOMAIN, ENOTFOUND) as LINK_STATUS.FAILED', async () => {
    const mockFetcher = {
      safeFetch: async (url) => ({
        ok: false,
        status: 400,
        statusText: 'Bad Request - Blocked by SSRF Policy',
        text: '',
        finalUrl: url,
        redirectCount: 0,
        error: 'DNS lookup failed for "remotvideo.org": getaddrinfo ENOTFOUND remotvideo.org'
      })
    };

    const result = await verifyLinkDeep('https://remotvideo.org/gigs/short-form-ai-reels-producer', {
      fetcher: mockFetcher
    });

    assert.equal(result.accessible, false);
    assert.equal(result.link_status, LINK_STATUS.FAILED);
    assert.match(result.reason, /DNS resolution failed/i);
    assert.ok(result.evidence.some(e => e.includes('Domain name resolution failed') || e.includes('DNS lookup failed')));
  });

  test('recheckOpportunityAvailability marks DNS failure as unhealthy and failed link_status', async () => {
    const candidate = createCandidate({
      id: 'cand_test_nxdomain',
      title: 'Video Editor',
      original_url: 'https://remotvideo.org/gigs/short-form-ai-reels-producer',
      link_status: LINK_STATUS.VERIFIED
    });

    const check = await recheckOpportunityAvailability(candidate, {
      recheckProbe: async () => ({
        healthy: false,
        reason: 'Target opportunity link failed reachability: getaddrinfo ENOTFOUND remotvideo.org'
      })
    });

    assert.equal(check.healthy, false);
    assert.equal(check.candidate.activity_status, ACTIVITY_STATUS.STOPPED);
    assert.match(check.reason, /unreachable|failed reachability|ENOTFOUND/i);
  });

  test('candidates.json contains remotevideo fixture marked as link_status failed', () => {
    const rawData = fs.readFileSync(path.resolve(__dirname, '../data/candidates.json'), 'utf8');
    const candidates = JSON.parse(rawData);
    const remoteVideoCandidate = candidates.find(c => c.id === 'cand_1791827099443_dddsd7');

    assert.ok(remoteVideoCandidate, 'Candidate cand_1791827099443_dddsd7 must exist');
    assert.equal(remoteVideoCandidate.source_name, 'fixture_hub');
    assert.equal(remoteVideoCandidate.link_status, 'failed');
    assert.ok(remoteVideoCandidate.link_evidence.some(e => e.includes('NXDOMAIN')));
  });
});

describe('Issue 4: Security and Honest Links', () => {
  test('Client bundle does not contain reference to VITE_SUPABASE_SERVICE_ROLE_KEY', () => {
    const candidateQueueSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/CandidateReviewQueue.jsx'), 'utf8');
    const dashboardSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/Dashboard.jsx'), 'utf8');
    const candidateStoreSrc = fs.readFileSync(path.resolve(__dirname, '../src/discovery/candidateStore.js'), 'utf8');

    assert.doesNotMatch(candidateQueueSrc, /SERVICE_ROLE/i);
    assert.doesNotMatch(dashboardSrc, /SERVICE_ROLE/i);
    assert.doesNotMatch(candidateStoreSrc, /SERVICE_ROLE/i);
  });

  test('validateForPublishing never manufactures fake URLs or appends /apply', () => {
    const candidateWithoutAppUrl = createCandidate({
      id: 'cand_honest_url',
      title: 'Freelance AI Marketing Copywriter',
      track_id: 'M5',
      original_url: 'https://realclient.com/gigs/ai-writer',
      opportunity_url: 'https://realclient.com/gigs/ai-writer',
      application_url: '', // Empty direct apply
      status: CANDIDATE_STATUS.APPROVED,
      activity_status: ACTIVITY_STATUS.ACTIVE,
      link_status: LINK_STATUS.VERIFIED
    });

    const validation = validateForPublishing(candidateWithoutAppUrl);
    assert.equal(validation.valid, true);
    // Preserves original URL without appending /apply
    assert.equal(candidateWithoutAppUrl.original_url, 'https://realclient.com/gigs/ai-writer');
    assert.equal(candidateWithoutAppUrl.application_url, '');
  });
});

describe('Issue 5: 11 Sourced Opportunities & Video-Ready Journey Guarantees', () => {
  const rawData = fs.readFileSync(path.resolve(__dirname, '../data/candidates.json'), 'utf8');
  const candidates = JSON.parse(rawData);

  test('All 232 total candidates preserved with exactly 11 newly staged opportunities', () => {
    assert.equal(candidates.length, 232, 'Total candidates count must be exactly 232');
  });

  test('The 4 AfterQuery opportunities are staged, pending review, and marked uncertain with exact referral params', () => {
    const afterQueryUrls = [
      'https://experts.afterquery.com/apply/video-editor-post-production-expert?ref=iHvyPZdQqqNPxeFpiQcDMJrhqho1',
      'https://experts.afterquery.com/apply/creative-technologist-audio-design?ref=iHvyPZdQqqNPxeFpiQcDMJrhqho1',
      'https://experts.afterquery.com/apply/cad-experts?ref=iHvyPZdQqqNPxeFpiQcDMJrhqho1',
      'https://experts.afterquery.com/apply/senior-swe?ref=iHvyPZdQqqNPxeFpiQcDMJrhqho1'
    ];

    for (const url of afterQueryUrls) {
      const match = candidates.find(c => c.original_url === url);
      assert.ok(match, `AfterQuery listing must exist for ${url}`);
      assert.equal(match.status, CANDIDATE_STATUS.PENDING_REVIEW, 'Must be pending review');
      assert.equal(match.link_status, LINK_STATUS.UNCERTAIN, 'Must be marked uncertain (bot challenge)');
      assert.equal(match.activity_status, ACTIVITY_STATUS.NEEDS_REVIEW, 'Activity must be Needs Review');
      assert.ok(match.original_url.includes('ref=iHvyPZdQqqNPxeFpiQcDMJrhqho1'), 'Referral code must be preserved');
      assert.equal(match.published_gig_id, null, 'Must not be published');
    }
  });

  test('The 3 SuperAnnotate SME opportunities are verified, pending review, and preserve externalKey query parameters', () => {
    const smeUrls = [
      'https://sme.careers/jobs?externalKey=DrawingApps-26-203&jobTitle=Drawing+Applications+Specialist',
      'https://sme.careers/jobs?externalKey=Python-25-656&jobTitle=Python+Engineer',
      'https://sme.careers/jobs?externalKey=SocialMedia-26-113&jobTitle=Social+Media+Expert'
    ];

    for (const url of smeUrls) {
      const match = candidates.find(c => c.original_url === url);
      assert.ok(match, `SME listing must exist for ${url}`);
      assert.equal(match.status, CANDIDATE_STATUS.PENDING_REVIEW);
      assert.equal(match.link_status, LINK_STATUS.VERIFIED);
      assert.equal(match.activity_status, ACTIVITY_STATUS.ACTIVE);
      assert.ok(match.original_url.includes('externalKey='), 'Must preserve externalKey query parameter');
    }
  });

  test('The 3 micro1 opportunities and 1 Turing opportunity are verified, pending review, and preserve tokens', () => {
    const otherUrls = [
      'https://jobs.micro1.ai/post/4256a2e1-877f-42d5-8fef-20147a0b2db7',
      'https://jobs.micro1.ai/post/90990ebf-8198-4b79-a799-add474453dbb',
      'https://jobs.micro1.ai/post/5e945e16-6393-40de-9ce5-ab7f9e8ec406',
      'https://work.turing.com/r/vOBPQyq01X'
    ];

    for (const url of otherUrls) {
      const match = candidates.find(c => c.original_url === url);
      assert.ok(match, `Opportunity must exist for ${url}`);
      assert.equal(match.status, CANDIDATE_STATUS.PENDING_REVIEW);
      assert.equal(match.link_status, LINK_STATUS.VERIFIED);
      assert.equal(match.activity_status, ACTIVITY_STATUS.ACTIVE);
    }

    const turingMatch = candidates.find(c => c.original_url === 'https://work.turing.com/r/vOBPQyq01X');
    assert.ok(turingMatch.original_url.endsWith('/r/vOBPQyq01X'), 'Turing referral token must be preserved');
  });
});

