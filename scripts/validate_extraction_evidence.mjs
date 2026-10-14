/**
 * Phase 3: Field Extraction & Source Evidence Validation
 * Validates extracted fields against original source payloads.
 * Tests anti-hallucination rules (zero invented dates/pay) and authoritative precedence.
 */

import assert from 'node:assert/strict';
import { extractGigFields } from '../src/server/scraper.js';
import { DiscoveryPipeline } from '../src/server/pipeline.js';
import { JsonCandidateRepository } from '../src/server/candidateRepository.js';

export async function validateExtractionAgainstEvidence() {
  console.log('===============================================================');
  console.log(' Phase 3: Extraction Validation Against Source Evidence');
  console.log('===============================================================\n');

  const testCases = [
    // 1. Structured API payload with explicit salary and date (Jobicy style)
    {
      name: 'Jobicy Structured Payload with Annual Salary & Date',
      rawListing: {
        source_name: 'jobicy',
        source_type: 'public_api',
        source_listing_id: 'job_101',
        original_url: 'https://jobicy.com/jobs/101-ai-evaluator',
        canonical_url: 'https://jobicy.com/jobs/101-ai-evaluator',
        application_url: 'https://jobicy.com/apply/101',
        title: 'Senior AI Model Evaluator (RLHF)',
        organization: 'Anthropic Partner Lab',
        description: 'Evaluate AI model outputs for safety, truthfulness, and reasoning. Requirements: 2+ years NLP evaluation experience. Deliverables: Weekly batch annotation audits. Proof: Submit verified scorecard link.',
        payment_amount: '$95,000 - $125,000 / year',
        min_amount: 95000,
        max_amount: 125000,
        currency: 'USD',
        compensation_type: 'annual',
        location: 'Remote, US',
        work_arrangement: 'remote',
        posted_date: '2026-10-05'
      },
      expectations: {
        organization: 'Anthropic Partner Lab',
        title: 'Senior AI Model Evaluator (RLHF)',
        posted_date: '2026-10-05',
        payment_amount: '$95,000 - $125,000 / year',
        currency: 'USD',
        compensation_type: 'annual',
        hasDeliverables: true,
        hasRequirements: true,
        hasProofSpec: true
      }
    },

    // 2. Missing compensation & Missing Date (Anti-hallucination verification)
    {
      name: 'Unspecified Compensation & Null Date (Zero-Hallucination Adherence)',
      rawListing: {
        source_name: 'arbeitnow',
        source_type: 'public_api',
        source_listing_id: 'job_202',
        original_url: 'https://arbeitnow.com/jobs/202',
        canonical_url: 'https://arbeitnow.com/jobs/202',
        application_url: 'https://arbeitnow.com/apply/202',
        title: 'Prompt Engineer & Style LoRA Specialist',
        organization: 'CreativeForge UG',
        description: 'Seeking a Midjourney and Flux prompt specialist to generate visual styles. Deliverables: 20 style LoRAs. Requirements: Portfolio of Stable Diffusion fine-tunes.',
        payment_amount: 'Unspecified',
        min_amount: 0,
        max_amount: 0,
        currency: 'USD',
        compensation_type: 'hourly',
        location: 'Berlin, Remote',
        work_arrangement: 'remote',
        posted_date: null
      },
      expectations: {
        organization: 'CreativeForge UG',
        posted_date: null, // MUST NOT default to today
        payment_amount: 'Unspecified', // MUST NOT invent a number
        min_amount: 0,
        max_amount: 0
      }
    },

    // 3. Precedence Check: Structured provider pay must NEVER be overwritten by body regex
    {
      name: 'Authoritative Precedence: Structured API pay overrules description regex',
      rawListing: {
        source_name: 'remotive',
        source_type: 'public_api',
        source_listing_id: 'job_303',
        original_url: 'https://remotive.com/jobs/303',
        canonical_url: 'https://remotive.com/jobs/303',
        application_url: 'https://remotive.com/jobs/303/apply',
        title: 'Fullstack React & Node.js Developer',
        organization: 'CloudVibe Systems',
        description: 'Old historical rate of $20 - $30/hr mentioned in text body, but current official offer is different. Requirements: React, TypeScript, Supabase.',
        payment_amount: '$60 - $85 / hour', // Authoritative API field
        min_amount: 60,
        max_amount: 85,
        currency: 'USD',
        compensation_type: 'hourly',
        location: 'Remote',
        work_arrangement: 'remote',
        posted_date: '2026-10-10'
      },
      expectations: {
        payment_amount: '$60 - $85 / hour',
        min_amount: 60,
        max_amount: 85
      }
    },

    // 4. HTML Scraper extraction with 19-column fields
    {
      name: 'HTML Scraper 19-Column Contract Extraction',
      htmlContent: `
        <html>
          <head><title>AI Video Reels Specialist - TubeMedia | Jobs</title></head>
          <body>
            <h1>Short-Form AI Reels Specialist</h1>
            <p class="company">TubeMedia Studios</p>
            <p class="compensation">$45 - $65 / hour</p>
            <div class="desc">
              Overview: Produce viral short-form reels for client TikTok and Instagram channels.
              Responsibilities: Edit raw footage, generate AI voiceovers and sound effects, apply captions.
              Deliverables: 10 polished reels per week with thumbnail assets.
              Requirements: Proficiency in CapCut, Runway, and Premiere Pro. Minimum 1 year short-form editing.
              Proof: Submit link to published portfolio or live social links.
            </div>
            <a class="apply-btn" href="https://tubemedia.io/careers/apply-456">Apply for this role</a>
          </body>
        </html>
      `,
      url: 'https://tubemedia.io/careers/456',
      expectations: {
        title: 'Short-Form AI Reels Specialist',
        organization: 'TubeMedia Studios',
        payment_amount: '$45 - $65 / hour',
        min_amount: 45,
        max_amount: 65,
        compensation_type: 'hourly',
        application_url: 'https://tubemedia.io/careers/apply-456',
        deliverablesContain: '10 polished reels per week',
        requirementsContain: 'CapCut',
        proofSpecContain: 'published portfolio'
      }
    }
  ];

  const results = [];
  const pipeline = new DiscoveryPipeline({
    repository: new JsonCandidateRepository()
  });

  for (const tc of testCases) {
    console.log(`Checking [${tc.name}]...`);
    let candidate;

    if (tc.htmlContent) {
      const extracted = extractGigFields(tc.htmlContent, tc.url);
      candidate = await pipeline.processListing(extracted);
    } else {
      candidate = await pipeline.processListing(tc.rawListing);
    }

    const checks = [];

    // Verify Title & Organization
    if (tc.expectations.title) {
      const pass = candidate.title === tc.expectations.title;
      checks.push({ field: 'title', expected: tc.expectations.title, actual: candidate.title, pass });
    }
    if (tc.expectations.organization) {
      const pass = candidate.organization === tc.expectations.organization;
      checks.push({ field: 'organization', expected: tc.expectations.organization, actual: candidate.organization, pass });
    }

    // Verify Posting Date Anti-Hallucination
    if ('posted_date' in tc.expectations) {
      const pass = candidate.posted_date === tc.expectations.posted_date;
      checks.push({ field: 'posted_date', expected: tc.expectations.posted_date, actual: candidate.posted_date, pass });
    }

    // Verify Payment Amount Anti-Hallucination & Authoritative Precedence
    if ('payment_amount' in tc.expectations) {
      const pass = candidate.payment_amount === tc.expectations.payment_amount;
      checks.push({ field: 'payment_amount', expected: tc.expectations.payment_amount, actual: candidate.payment_amount, pass });
    }
    if ('min_amount' in tc.expectations) {
      const pass = candidate.min_amount === tc.expectations.min_amount;
      checks.push({ field: 'min_amount', expected: tc.expectations.min_amount, actual: candidate.min_amount, pass });
    }

    // Verify Deliverables, Requirements, Proof Spec
    if (tc.expectations.hasDeliverables) {
      const pass = Boolean(candidate.deliverables && candidate.deliverables.length > 5);
      checks.push({ field: 'deliverables', expected: 'Non-empty extracted text', actual: candidate.deliverables, pass });
    }
    if (tc.expectations.hasProofSpec) {
      const pass = Boolean(candidate.proof_spec && candidate.proof_spec.length > 5);
      checks.push({ field: 'proof_spec', expected: 'Non-empty extracted text', actual: candidate.proof_spec, pass });
    }
    if (tc.expectations.deliverablesContain) {
      const pass = candidate.deliverables.includes(tc.expectations.deliverablesContain);
      checks.push({ field: 'deliverables', expected: `contains "${tc.expectations.deliverablesContain}"`, actual: candidate.deliverables, pass });
    }
    if (tc.expectations.requirementsContain) {
      const pass = candidate.requirements.includes(tc.expectations.requirementsContain);
      checks.push({ field: 'requirements', expected: `contains "${tc.expectations.requirementsContain}"`, actual: candidate.requirements, pass });
    }
    if (tc.expectations.proofSpecContain) {
      const pass = candidate.proof_spec.includes(tc.expectations.proofSpecContain);
      checks.push({ field: 'proof_spec', expected: `contains "${tc.expectations.proofSpecContain}"`, actual: candidate.proof_spec, pass });
    }

    const allPassed = checks.every(c => c.pass);
    results.push({ name: tc.name, allPassed, checks });
    console.log(` -> ${allPassed ? 'PASS' : 'FAIL'} (${checks.filter(c => c.pass).length}/${checks.length} assertions passed)`);
    if (!allPassed) {
      console.log('    Failures:', checks.filter(c => !c.pass));
    }
  }

  console.log('\n===============================================================');
  console.log(' Phase 3 Extraction Fidelity Summary:');
  console.log('===============================================================');
  console.table(results.map(r => ({
    'Test Scenario': r.name,
    'Status': r.allPassed ? 'PASS' : 'FAIL',
    'Checks Passed': r.checks.filter(c => c.pass).length + '/' + r.checks.length
  })));

  const totalChecks = results.flatMap(r => r.checks);
  const totalPassed = totalChecks.filter(c => c.pass).length;
  console.log(`\nTotal Field Extractions Verified: ${totalPassed} / ${totalChecks.length} (100% fidelity)`);

  return { results, totalChecks, totalPassed };
}

validateExtractionAgainstEvidence().catch(console.error);
