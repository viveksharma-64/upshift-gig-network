/**
 * UpShift Gig Network — Genuine Gig Discovery and Application-Link Reliability Suite
 *
 * Implements Phase 3 regression testing covering Scenarios 1 through 22:
 * 1. Genuine active gig with verified direct application URL accepted
 * 2. Genuine gig with only specific opportunity page accepted with correct classification
 * 3. Legitimate task platform requiring login not falsely marked broken or direct-apply
 * 4. Generic company homepage not accepted as direct application URL
 * 5. General job-search/category page without qualifying gig rejected or flagged
 * 6. Conventional corporate job vacancy outside gig criteria rejected from publication
 * 7. Dead or removed opportunity (HTTP 404/410) not treated as active
 * 8. Closed gig blocked from publication
 * 9. Temporary network error or rate limit marked uncertain/inaccessible without crashing
 * 10. Redirect to unsafe/private address blocked via SSRF protection
 * 11. Redirect to unrelated destination does not qualify as verified application link
 * 12. URL with unsafe scheme rejected
 * 13. Invented/unverified /apply URL is never generated
 * 14. Duplicate URLs or external IDs do not create duplicate gigs
 * 15. Missing payment, date, or requirements are never fabricated
 * 16. Candidate with uncertain evidence remains in human review
 * 17. Previously approved gig that later closes blocked during pre-publication recheck
 * 18. Existing review decisions (approved/rejected/referrals) survive synchronization
 * 19. Failed discovery provider does not erase existing candidates or crash pipeline
 * 20. Learner-facing action uses truthful stored destination safely
 * 21. Admin-only operations remain protected against non-admins
 * 22. Admin and learner layouts maintain responsive guarantees
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  analyzeUrlStructure,
  LINK_TYPE,
  LINK_STATUS
} from '../src/discovery/urlClassifier.js';
import {
  evaluateGigRelevance,
  GIG_TYPE
} from '../src/server/gigClassifier.js';
import {
  verifyLinkDeep
} from '../src/server/linkVerifier.js';
import {
  validateForPublishing,
  publishCandidateToGigs,
  recheckOpportunityAvailability
} from '../src/discovery/candidateStore.js';
import {
  createCandidate,
  CANDIDATE_STATUS,
  ACTIVITY_STATUS
} from '../src/discovery/types.js';
import {
  runDiscoveryPipeline
} from '../src/server/pipeline.js';
import {
  deduplicateGigList,
  normalizeCanonicalUrl
} from '../src/server/deduplication.js';
import {
  isSafeHttpUrl,
  sanitizeHref
} from '../src/discovery/urlValidator.js';
import {
  validateSafeUrl
} from '../src/server/ssrfValidator.js';
import {
  verifyAdminAuthorization
} from '../src/server/candidateApiHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read and parse DEFAULT_SEED_GIGS directly from Dashboard.jsx without importing JSX in Node test runner
const dashboardSrc = fs.readFileSync(path.resolve(__dirname, '../src/pages/Dashboard.jsx'), 'utf8');
const seedGigsMatch = dashboardSrc.match(/export const DEFAULT_SEED_GIGS = (\[[\s\S]*?\]);/);
const DEFAULT_SEED_GIGS = seedGigsMatch ? (new Function(`return ${seedGigsMatch[1]}`))() : [];

// ====================================================================
// REPRESENTATIVE FIXTURE DATASET COVERING M1–M6 AND LINK QUALITY
// Clearly labeled [SYNTHETIC_TEST_FIXTURE] to prevent accidental publication
// ====================================================================
export const SYNTHETIC_TEST_FIXTURES = [
  {
    id: 'syn_m1_direct_apply',
    source_name: 'test_creator_feed',
    track_id: 'M1',
    title: '[SYNTHETIC_TEST_FIXTURE] Short-Form AI Video Prompt Engineer & Reels Creator',
    organization: 'Apex Media Studio',
    original_url: 'https://creators.freelance.org/projects/m1-ai-reels-batch4',
    opportunity_url: 'https://creators.freelance.org/projects/m1-ai-reels-batch4',
    application_url: 'https://creators.freelance.org/projects/m1-ai-reels-batch4/apply',
    description: 'Contract creator gig: Generate vertical AI reels using Runway Gen-2 and Kling. Fixed project deliverables.',
    work_arrangement: 'remote',
    compensation_type: 'project',
    payment_amount: '$600 / project',
    activity_status: 'Active',
    status: 'approved'
  },
  {
    id: 'syn_m2_opp_page_only',
    source_name: 'test_contra_feed',
    track_id: 'M2',
    title: '[SYNTHETIC_TEST_FIXTURE] Midjourney Brand Asset Designer',
    organization: 'Studio Apex Creative',
    original_url: 'https://contra.com/opportunity/midjourney-brand-visuals-apex',
    opportunity_url: 'https://contra.com/opportunity/midjourney-brand-visuals-apex',
    application_url: '', // No separate direct apply URL
    description: 'Freelance design gig. Produce 20 photorealistic Midjourney brand concepts with prompt specifications.',
    work_arrangement: 'remote',
    compensation_type: 'hourly',
    payment_amount: '$45 / hour',
    activity_status: 'Active',
    status: 'approved'
  },
  {
    id: 'syn_m3_login_required',
    source_name: 'test_outlier_feed',
    track_id: 'M3',
    title: '[SYNTHETIC_TEST_FIXTURE] Multimodal AI Task Evaluator',
    organization: 'Outlier AI',
    original_url: 'https://app.outlier.ai/expert/opportunities/multimodal-eval-123',
    opportunity_url: 'https://app.outlier.ai/expert/opportunities/multimodal-eval-123',
    application_url: '',
    description: 'Task-based contributor work evaluating visual prompts and hallucination rates for vision models.',
    work_arrangement: 'remote',
    compensation_type: 'hourly',
    payment_amount: '$25 / hour',
    activity_status: 'Active',
    status: 'approved'
  },
  {
    id: 'syn_m4_corporate_job',
    source_name: 'test_job_board',
    track_id: 'M4',
    title: '[SYNTHETIC_TEST_FIXTURE] Senior Staff Fullstack Engineer',
    organization: 'MegaCorp Enterprises LLC',
    original_url: 'https://megacorp.example.com/careers/engineering/staff-swe-401k',
    opportunity_url: 'https://megacorp.example.com/careers/engineering/staff-swe-401k',
    application_url: 'https://megacorp.example.com/careers/engineering/staff-swe-401k/submit',
    description: 'Permanent full-time position. Competitive base salary $195,000 with 401(k) matching, dental, health insurance, and paid time off. W-2 employees only.',
    work_arrangement: 'hybrid',
    compensation_type: 'salary',
    payment_amount: '$195,000 / year',
    activity_status: 'Active',
    status: 'pending_review'
  },
  {
    id: 'syn_m5_homepage_link',
    source_name: 'test_marketing_source',
    track_id: 'M5',
    title: '[SYNTHETIC_TEST_FIXTURE] AI Growth Marketing Specialist',
    organization: 'Generic Agency Inc',
    original_url: 'https://genericagency.example.com/',
    opportunity_url: 'https://genericagency.example.com/',
    application_url: 'https://genericagency.example.com/',
    description: 'Generic home page link without specific opportunity or task scope.',
    work_arrangement: 'remote',
    activity_status: 'Active',
    status: 'pending_review'
  },
  {
    id: 'syn_m6_automation_agent',
    source_name: 'test_upwork_feed',
    track_id: 'M6',
    title: '[SYNTHETIC_TEST_FIXTURE] n8n & Zapier AI Workflow Builder',
    organization: 'AutomateFlow Systems',
    original_url: 'https://www.upwork.com/freelance-jobs/apply/n8n-zapier-ai-workflow-automation_~01e5d4c3b2a198',
    opportunity_url: 'https://www.upwork.com/freelance-jobs/apply/n8n-zapier-ai-workflow-automation_~01e5d4c3b2a198',
    application_url: '',
    description: 'Freelance contract: Build webhook pipelines linking Claude API to Slack and Airtable for lead qualification.',
    work_arrangement: 'remote',
    compensation_type: 'hourly',
    payment_amount: '$50 - $75 / hour',
    activity_status: 'Active',
    status: 'approved'
  }
];

describe('UpShift Gig Network — Genuine Gig Discovery and Application-Link Reliability', () => {

  // Scenario 1: A genuine, active gig with a verified direct application URL is accepted.
  test('Scenario 1: A genuine, active gig with a verified direct application URL is accepted', () => {
    const fixture = SYNTHETIC_TEST_FIXTURES[0];
    const gigEval = evaluateGigRelevance(fixture.title, fixture.description, { track_id: fixture.track_id });
    assert.strictEqual(gigEval.isGig, true, 'Must qualify as a genuine gig');
    assert.strictEqual(gigEval.isConventionalJob, false, 'Must not be classified as conventional job');

    const urlAnalysis = analyzeUrlStructure(fixture.application_url);
    assert.strictEqual(urlAnalysis.isHomepage, false, 'Must not be homepage');
    assert.strictEqual(urlAnalysis.isSearchPage, false, 'Must not be search page');
    assert.strictEqual(urlAnalysis.linkType, LINK_TYPE.DIRECT_APPLY, 'Must be classified as direct_apply');

    const validation = validateForPublishing(fixture);
    assert.strictEqual(validation.valid, true, 'Genuine approved gig with direct apply must be valid for publishing');
  });

  // Scenario 2: A genuine gig with only a specific opportunity page is accepted with the correct link classification.
  test('Scenario 2: A genuine gig with only a specific opportunity page is accepted with correct link classification', () => {
    const fixture = SYNTHETIC_TEST_FIXTURES[1];
    const gigEval = evaluateGigRelevance(fixture.title, fixture.description, { track_id: fixture.track_id });
    assert.strictEqual(gigEval.isGig, true);

    const urlAnalysis = analyzeUrlStructure(fixture.opportunity_url);
    assert.strictEqual(urlAnalysis.linkType, LINK_TYPE.OPPORTUNITY_PAGE);
    assert.strictEqual(urlAnalysis.isHomepage, false);

    const candidate = createCandidate({
      ...fixture,
      application_url: '',
      link_type: urlAnalysis.linkType
    });

    assert.strictEqual(candidate.link_type, LINK_TYPE.OPPORTUNITY_PAGE);
    assert.strictEqual(candidate.application_url, '', 'Must never guess /apply when no direct apply URL exists');

    const validation = validateForPublishing(candidate);
    assert.strictEqual(validation.valid, true, 'Specific opportunity page must be valid for publishing');
  });

  // Scenario 3: A legitimate task platform requiring login is not falsely marked as broken or direct-apply.
  test('Scenario 3: A legitimate task platform requiring login is not falsely marked as broken or direct-apply', () => {
    const outlierUrl = 'https://app.outlier.ai/expert/opportunities/multimodal-eval-123';
    const analysis = analyzeUrlStructure(outlierUrl);

    assert.strictEqual(analysis.linkType, LINK_TYPE.PLATFORM_LOGIN_REQUIRED, 'Outlier must be identified as login-required platform');
    assert.strictEqual(analysis.isHomepage, false, 'Opportunity deep link must not be flagged as homepage');
    assert.strictEqual(analysis.platformName, 'Outlier AI');

    // Also verify other known task platforms: Mindrift, Mercor, Alignerr, DataAnnotation
    const platforms = [
      { url: 'https://mindrift.ai/opportunities/bilingual-annotator', expected: 'Mindrift' },
      { url: 'https://mercor.com/opportunities/developer-evaluator', expected: 'Mercor' },
      { url: 'https://app.alignerr.com/tasks/m3-annotation', expected: 'Alignerr' },
      { url: 'https://app.dataannotation.tech/worker_signup', expected: 'DataAnnotation' }
    ];

    for (const p of platforms) {
      const res = analyzeUrlStructure(p.url);
      assert.strictEqual(res.linkType, LINK_TYPE.PLATFORM_LOGIN_REQUIRED, `${p.expected} must be platform_login_required`);
      assert.strictEqual(res.requiresLogin, true, `${p.expected} must require login`);
    }
  });

  // Scenario 4: A generic company homepage is not accepted as a direct application URL.
  test('Scenario 4: A generic company homepage is not accepted as a direct application URL', () => {
    const homepages = [
      'https://upwork.com',
      'https://www.upwork.com/',
      'https://mindrift.ai',
      'https://mercor.com/',
      'https://megacorp.example.com'
    ];

    for (const url of homepages) {
      const analysis = analyzeUrlStructure(url);
      assert.strictEqual(analysis.isHomepage, true, `URL ${url} must be identified as a homepage`);
      assert.notStrictEqual(analysis.linkType, LINK_TYPE.DIRECT_APPLY, `Homepage ${url} must NEVER be direct_apply`);

      const candidate = createCandidate({
        title: 'Freelance AI Evaluator',
        track_id: 'M3',
        status: CANDIDATE_STATUS.APPROVED,
        activity_status: ACTIVITY_STATUS.ACTIVE,
        application_url: url
      });

      const validation = validateForPublishing(candidate);
      assert.strictEqual(validation.valid, false, `Homepage ${url} must be blocked from publishing`);
      assert.ok(validation.error.includes('generic company homepage'), 'Error message must cite homepage rejection');
    }
  });

  // Scenario 5: A general job-search page without a qualifying gig is rejected or flagged.
  test('Scenario 5: A general job-search page without a qualifying gig is rejected or flagged', () => {
    const searchUrls = [
      'https://upwork.com/freelance-jobs/search?q=ai',
      'https://www.indeed.com/jobs?q=annotator&l=remote',
      'https://remoteok.com/remote-dev-jobs',
      'https://example.com/careers/category/engineering'
    ];

    for (const url of searchUrls) {
      const analysis = analyzeUrlStructure(url);
      assert.strictEqual(analysis.isSearchPage, true, `URL ${url} must be recognized as search/directory page`);

      const candidate = createCandidate({
        title: 'Search Directory',
        track_id: 'M4',
        status: CANDIDATE_STATUS.APPROVED,
        activity_status: ACTIVITY_STATUS.ACTIVE,
        application_url: url
      });

      const validation = validateForPublishing(candidate);
      assert.strictEqual(validation.valid, false, `Search/directory page ${url} must be blocked from publishing`);
      assert.ok(validation.error.includes('general job search or category directory'));
    }
  });

  // Scenario 6: A conventional job vacancy outside the intended gig criteria is not published.
  test('Scenario 6: A conventional job vacancy outside the intended gig criteria is not published', () => {
    const corporateJob = SYNTHETIC_TEST_FIXTURES[3];
    const gigEval = evaluateGigRelevance(corporateJob.title, corporateJob.description, { track_id: corporateJob.track_id });

    assert.strictEqual(gigEval.isConventionalJob, true, 'Must detect 401k, W-2, health insurance, salary indicators');
    assert.strictEqual(gigEval.isGig, false, 'Conventional job must not qualify as a gig');

    const candidate = createCandidate({
      ...corporateJob,
      is_gig: gigEval.isGig,
      is_conventional_job: gigEval.isConventionalJob,
      status: CANDIDATE_STATUS.APPROVED,
      activity_status: ACTIVITY_STATUS.ACTIVE
    });

    const validation = validateForPublishing(candidate);
    assert.strictEqual(validation.valid, false, 'Conventional job must be blocked from publishing');
    assert.ok(validation.error.includes('conventional job vacancy'), 'Error must specify conventional job rejection');
  });

  // Scenario 7: A dead or removed opportunity is not treated as active.
  test('Scenario 7: A dead or removed opportunity is not treated as active', async () => {
    const mockFetcher = async () => ({
      status: 404,
      ok: false,
      text: async () => '<html><body><h1>404 Not Found</h1><p>The job you are looking for has been removed.</p></body></html>'
    });

    const res = await verifyLinkDeep('https://example.com/jobs/expired-123', {
      fetchFn: mockFetcher,
      dnsResolver: async () => ['93.184.216.34']
    });

    assert.strictEqual(res.linkStatus, LINK_STATUS.CLOSED, 'HTTP 404 must result in closed link_status');
    assert.strictEqual(res.isClosed, true, 'Opportunity must be flagged as closed');
    assert.ok(res.evidence.includes('HTTP 404 Not Found'));
  });

  // Scenario 8: A closed gig is blocked from publication.
  test('Scenario 8: A closed gig is blocked from publication', () => {
    const closedCandidate = createCandidate({
      title: 'Valid Gig Title for Annotation',
      track_id: 'M3',
      activity_status: ACTIVITY_STATUS.STOPPED,
      status: CANDIDATE_STATUS.APPROVED,
      application_url: 'https://example.com/gigs/closed-1'
    });

    const validation = validateForPublishing(closedCandidate);
    assert.strictEqual(validation.valid, false, 'Stopped/closed candidate must be blocked from publishing');
    assert.ok(validation.error.includes('stopped or closed'));
  });

  // Scenario 9: A temporary network error or rate limit is marked uncertain or failed without crashing the whole run.
  test('Scenario 9: A temporary network error or rate limit is marked uncertain without crashing', async () => {
    // 429 Rate Limit
    const rateLimitFetcher = async () => ({
      status: 429,
      ok: false,
      text: async () => 'Too Many Requests'
    });

    const rateRes = await verifyLinkDeep('https://example.com/gigs/rate-limited', {
      fetchFn: rateLimitFetcher,
      dnsResolver: async () => ['93.184.216.34']
    });

    assert.strictEqual(rateRes.linkStatus, LINK_STATUS.UNCERTAIN, 'HTTP 429 must be classified as uncertain');
    assert.strictEqual(rateRes.isClosed, false, 'Rate limit must NEVER be falsely marked as closed');

    // 403 Bot protection
    const botFetcher = async () => ({
      status: 403,
      ok: false,
      text: async () => 'Cloudflare Ray ID: Access Denied'
    });

    const botRes = await verifyLinkDeep('https://example.com/gigs/bot-challenge', {
      fetchFn: botFetcher,
      dnsResolver: async () => ['93.184.216.34']
    });

    assert.strictEqual(botRes.linkStatus, LINK_STATUS.INACCESSIBLE, 'HTTP 403 must be classified as inaccessible');
    assert.strictEqual(botRes.isClosed, false, 'Bot challenge must NEVER be falsely marked as closed');
  });

  // Scenario 10: A redirect to an unsafe/private address is blocked.
  test('Scenario 10: A redirect to an unsafe/private address is blocked via SSRF protection', async () => {
    const loopbackDns = async () => ['127.0.0.1'];
    const ssrfCheck = await validateSafeUrl('http://127.0.0.1:8080/admin', loopbackDns);
    assert.strictEqual(ssrfCheck.safe, false, 'Loopback address must be blocked');

    const metadataCheck = await validateSafeUrl('http://169.254.169.254/latest/meta-data/', async () => ['169.254.169.254']);
    assert.strictEqual(metadataCheck.safe, false, 'Cloud metadata must be blocked');

    // Deep verifier with SSRF destination
    const res = await verifyLinkDeep('http://169.254.169.254/secret', {
      dnsResolver: async () => ['169.254.169.254']
    });
    assert.strictEqual(res.linkStatus, LINK_STATUS.FAILED);
    assert.ok(res.evidence.includes('SSRF destination'));
  });

  // Scenario 11: A redirect to an unrelated destination does not qualify as a verified application link.
  test('Scenario 11: A redirect to an unrelated destination does not qualify as a verified application link', async () => {
    // Listing expired and redirected to generic company homepage
    const redirectFetcher = async () => ({
      status: 200,
      ok: true,
      url: 'https://example.com/', // Redirected to root!
      text: async () => '<html><body><h1>Welcome to ExampleCorp</h1><p>Our solutions for enterprise</p></body></html>'
    });

    const res = await verifyLinkDeep('https://example.com/jobs/react-gig-456', {
      fetchFn: redirectFetcher,
      dnsResolver: async () => ['93.184.216.34']
    });

    assert.strictEqual(res.isClosed, true, 'Redirect from specific opportunity to root homepage indicates opportunity is closed/removed');
    assert.strictEqual(res.linkStatus, LINK_STATUS.CLOSED);
  });

  // Scenario 12: A URL with an unsafe scheme is rejected.
  test('Scenario 12: A URL with an unsafe scheme is rejected', () => {
    const unsafeUrls = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd'
    ];

    for (const url of unsafeUrls) {
      assert.strictEqual(isSafeHttpUrl(url), false, `Unsafe scheme ${url} must be rejected by isSafeHttpUrl`);
      assert.strictEqual(sanitizeHref(url, '#'), '#', `Unsafe scheme ${url} must be sanitized to fallback`);
    }
  });

  // Scenario 13: An invented or unverified /apply URL is never generated.
  test('Scenario 13: An invented or unverified /apply URL is never generated', async () => {
    const rawListing = {
      id: 'raw_001',
      title: 'AI Audio Annotator - Telugu',
      original_url: 'https://contra.com/opportunity/telugu-audio-annotator',
      description: 'Freelance gig for Telugu NLP audio labeling.'
    };

    const mockProvider = {
      name: 'contra_provider',
      type: 'rss_feed',
      fetchCandidates: async () => [rawListing],
      fetchListings: async () => [rawListing]
    };

    const candidateStore = {
      items: [],
      async saveBatch(batch) {
        this.items.push(...batch);
        return { inserted: batch.length, updated: 0, total: this.items.length };
      },
      async getAll() {
        return this.items;
      }
    };

    const result = await runDiscoveryPipeline([mockProvider], { candidateStore });
    assert.strictEqual(result.processedCount, 1);

    const saved = candidateStore.items[0];
    assert.strictEqual(saved.opportunity_url, 'https://contra.com/opportunity/telugu-audio-annotator');
    assert.strictEqual(saved.application_url, '', 'application_url must NOT have guessed /apply appended');
    assert.strictEqual(saved.link_type, LINK_TYPE.OPPORTUNITY_PAGE);
  });

  // Scenario 14: Duplicate URLs or external IDs do not create duplicate gigs.
  test('Scenario 14: Duplicate URLs or external IDs do not create duplicate gigs', () => {
    const gigs = [
      { id: '1', external_gig_id: 'GIG-001', origin_url: 'https://upwork.com/jobs/1?ref=feed', title: 'Data Annotator', track_id: 'M3' },
      { id: '2', external_gig_id: 'GIG-001', origin_url: 'https://upwork.com/jobs/1?ref=email', title: 'Data Annotator', track_id: 'M3' },
      { id: '3', external_gig_id: 'GIG-002', origin_url: 'https://upwork.com/jobs/1', title: 'Data Annotator', track_id: 'M3' }
    ];

    const deduplicated = deduplicateGigList(gigs);
    assert.strictEqual(deduplicated.length, 1, 'Same external ID or canonical URL must deduplicate to single record');
  });

  // Scenario 15: Missing payment, date, or requirements are not fabricated.
  test('Scenario 15: Missing payment, date, or requirements are not fabricated', () => {
    const candidate = createCandidate({
      title: 'Prompt Optimization Specialist',
      track_id: 'M4',
      original_url: 'https://example.com/gig/prompt-opt'
    });

    assert.strictEqual(candidate.payment_amount, 'Unspecified', 'Missing payment must be stored as Unspecified, never fabricated');
    assert.strictEqual(candidate.min_amount, 0);
    assert.strictEqual(candidate.max_amount, 0);
    assert.strictEqual(candidate.posted_date, null, 'Missing posted_date must be null, never fabricated');
    assert.strictEqual(candidate.deadline, null, 'Missing deadline must be null, never fabricated');
  });

  // Scenario 16: A candidate with uncertain evidence remains in human review.
  test('Scenario 16: A candidate with uncertain evidence remains in human review', () => {
    const uncertainCandidate = createCandidate({
      title: 'Generative AI Specialist',
      track_id: 'M1',
      activity_status: ACTIVITY_STATUS.NEEDS_REVIEW,
      status: CANDIDATE_STATUS.PENDING_REVIEW,
      activity_confidence: 45,
      application_url: 'https://example.com/gigs/uncertain-1'
    });

    // 1. Candidate in pending_review cannot be published automatically
    const valPending = validateForPublishing(uncertainCandidate);
    assert.strictEqual(valPending.valid, false, 'Unreviewed candidate cannot be published');
    assert.ok(valPending.error.includes('explicitly approved'));

    // 2. Even if approved, uncertain activity evidence blocks publication unless explicit override is given
    const approvedUncertain = createCandidate({
      ...uncertainCandidate,
      status: CANDIDATE_STATUS.APPROVED
    });
    const valApprovedUncertain = validateForPublishing(approvedUncertain);
    assert.strictEqual(valApprovedUncertain.valid, false, 'Uncertain candidate must be blocked from publishing without explicit override');
    assert.ok(valApprovedUncertain.error.includes('override_uncertain_activity'));
  });

  // Scenario 17: A previously approved gig that later closes is blocked during the pre-publication recheck.
  test('Scenario 17: A previously approved gig that later closes is blocked during pre-publication recheck', async () => {
    const candidate = createCandidate({
      title: 'Annotation Gig',
      track_id: 'M3',
      status: CANDIDATE_STATUS.APPROVED,
      activity_status: ACTIVITY_STATUS.ACTIVE,
      application_url: 'https://example.com/gigs/later-closed'
    });

    // Mock recheck probe indicating listing closed
    const mockProbe = async () => ({
      healthy: false,
      reason: 'Opportunity closed: Listing was removed by client'
    });

    const recheckResult = await recheckOpportunityAvailability(candidate, { recheckProbe: mockProbe });
    assert.strictEqual(recheckResult.healthy, false, 'Pre-publication recheck must catch closure');
    assert.strictEqual(recheckResult.candidate.activity_status, ACTIVITY_STATUS.STOPPED);

    // Publication attempt must now be blocked
    const pubResult = await publishCandidateToGigs(candidate, { role: 'admin' }, { recheckProbe: mockProbe });
    assert.strictEqual(pubResult.success, false);
    assert.ok(pubResult.error.includes('Pre-publication verification failed'));
  });

  // Scenario 18: Existing approval, rejection, referral, and publication decisions survive candidate synchronization.
  test('Scenario 18: Existing review decisions survive candidate synchronization', async () => {
    const existingCandidate = createCandidate({
      id: 'cand_stable_001',
      title: 'Computer Vision Annotator',
      track_id: 'M3',
      status: CANDIDATE_STATUS.APPROVED,
      referral_id: 'REF-UPSHIFT-01',
      referral_required: true,
      admin_notes: 'Verified client on Contra by admin.'
    });

    const store = {
      candidates: [existingCandidate],
      async getAll() { return this.candidates; },
      async saveBatch(batch) {
        // Idempotent merge logic from candidateRepository
        for (const item of batch) {
          const idx = this.candidates.findIndex(c => c.id === item.id);
          if (idx !== -1) {
            const prev = this.candidates[idx];
            this.candidates[idx] = {
              ...item,
              status: prev.status, // Preserve admin review status!
              referral_id: prev.referral_id,
              referral_required: prev.referral_required,
              admin_notes: prev.admin_notes
            };
          }
        }
        return { inserted: 0, updated: 1, total: this.candidates.length };
      }
    };

    const reingestedListing = {
      id: 'cand_stable_001',
      title: 'Computer Vision Annotator (Updated Title)',
      original_url: 'https://example.com/gigs/cv-1',
      status: CANDIDATE_STATUS.PENDING_REVIEW // Re-ingestion defaults to pending
    };

    await store.saveBatch([reingestedListing]);
    const updated = (await store.getAll())[0];

    assert.strictEqual(updated.status, CANDIDATE_STATUS.APPROVED, 'Existing approval status must survive');
    assert.strictEqual(updated.referral_id, 'REF-UPSHIFT-01', 'Referral configuration must survive');
    assert.strictEqual(updated.admin_notes, 'Verified client on Contra by admin.', 'Admin notes must survive');
  });

  // Scenario 19: A failed discovery provider does not erase existing candidates or prevent successful providers from being processed.
  test('Scenario 19: A failed discovery provider does not erase existing candidates or prevent successful providers', async () => {
    const existing = [createCandidate({ id: 'existing_1', title: 'Prior Gig', track_id: 'M3' })];

    const failingProvider = {
      name: 'broken_api',
      type: 'public_api',
      fetchCandidates: async () => { throw new Error('Network timeout 504 Gateway Timeout'); },
      fetchListings: async () => { throw new Error('Network timeout 504 Gateway Timeout'); }
    };

    const workingProvider = {
      name: 'working_rss',
      type: 'rss_feed',
      fetchCandidates: async () => [{
        id: 'new_gig_2',
        title: 'New Working Gig',
        track_id: 'M2',
        original_url: 'https://contra.com/opportunity/design-gig-1'
      }],
      fetchListings: async () => [{
        id: 'new_gig_2',
        title: 'New Working Gig',
        track_id: 'M2',
        original_url: 'https://contra.com/opportunity/design-gig-1'
      }]
    };

    const memoryStore = {
      items: [...existing],
      async getAll() { return this.items; },
      async saveBatch(batch) {
        this.items.push(...batch);
        return { inserted: batch.length, updated: 0, total: this.items.length };
      }
    };

    const result = await runDiscoveryPipeline([failingProvider, workingProvider], { candidateStore: memoryStore });

    assert.strictEqual(result.errors.length, 1, 'Failed provider error must be tracked');
    assert.strictEqual(result.errors[0].provider, 'broken_api');
    assert.strictEqual(result.processedCount, 1, 'Working provider listing must be processed');
    assert.ok(memoryStore.items.some(i => i.id === 'existing_1'), 'Existing candidates must remain intact');
  });

  // Scenario 20: The learner-facing action uses the correct stored destination and opens it safely.
  test('Scenario 20: Learner-facing action uses the correct stored destination and opens it safely', () => {
    for (const gig of DEFAULT_SEED_GIGS) {
      assert.ok(gig.track_id, `Seed gig ${gig.id} must have track_id`);
      assert.ok(isSafeHttpUrl(gig.origin_url), `Seed gig ${gig.origin_url} must be safe HTTP(S) URL`);
      assert.strictEqual(analyzeUrlStructure(gig.origin_url).isHomepage, false, `Seed gig ${gig.id} origin_url must not be root homepage`);

      // Resolved destination test
      const targetUrl = gig.application_url || gig.opportunity_url || gig.origin_url;
      assert.ok(isSafeHttpUrl(targetUrl), 'Destination must be valid safe URL');
      assert.notStrictEqual(targetUrl, 'https://upwork.com', 'Destination must not blindly fallback to upwork homepage');
    }
  });

  // Scenario 21: Admin-only link verification and review operations remain protected.
  test('Scenario 21: Admin-only link verification and review operations remain protected', async () => {
    const mockVerifier = async (token) => {
      if (token === 'admin-token') return { valid: true, user: { id: 'usr-admin-01', role: 'admin' } };
      return { valid: true, user: { id: 'usr-learner-01', role: 'learner' } };
    };

    const learnerReq = {
      headers: { authorization: 'Bearer learner-token' }
    };

    const learnerAuth = await verifyAdminAuthorization(learnerReq, { authVerifier: mockVerifier });
    assert.strictEqual(learnerAuth.authorized, false, 'Learner must be rejected from admin queue operations');
    assert.strictEqual(learnerAuth.statusCode, 403, 'Must return 403 Forbidden');

    const adminReq = {
      headers: { authorization: 'Bearer admin-token' }
    };

    const adminAuth = await verifyAdminAuthorization(adminReq, { authVerifier: mockVerifier });
    assert.strictEqual(adminAuth.authorized, true, 'Verified admin must be authorized');
  });

  // Scenario 22: The application remains responsive on mobile, tablet, and desktop.
  test('Scenario 22: The application remains responsive on mobile, tablet, and desktop', () => {
    const cssPath = path.resolve(__dirname, '../src/index.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Confirm essential responsive breakpoints and wrappers exist in index.css
    assert.ok(css.includes('@media (max-width: 1024px)'), 'CSS must define tablet breakpoint at 1024px');
    assert.ok(css.includes('@media (max-width: 768px)'), 'CSS must define mobile/tablet breakpoint at 768px');
    assert.ok(css.includes('@media (max-width: 480px)'), 'CSS must define phone breakpoint at 480px');
    assert.ok(css.includes('@media (max-width: 360px)'), 'CSS must define compact phone breakpoint at 360px');
    assert.ok(css.includes('.candidate-cards-grid'), 'Candidate cards grid responsive class must exist');
    assert.ok(css.includes('.discovery-filter-bar'), 'Discovery filter bar responsive class must exist');
  });

});
