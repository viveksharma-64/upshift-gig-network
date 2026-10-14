/**
 * Regression Test Suite: HTML Normalization & Sanitization Across Discovery Queue
 *
 * Validates the reusable HTML-to-text normalizer across:
 * 1. Nested <p>, <strong>, and <h2> elements
 * 2. <div> elements with classes and attributes
 * 3. <img> and media tags
 * 4. Script and style blocks
 * 5. HTML entities and non-breaking spaces
 * 6. Malformed or truncated HTML
 * 7. Already-plain text
 * 8. Empty or null values
 * 9. Lists and line breaks
 * 10. Entity-encoded HTML tags
 * 11. Full candidate text normalization
 * 12. Stored candidates verification
 * 13. CSV export sanitization
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { normalizeHtmlToText, decodeHtmlEntities, normalizeCandidateTextFields } from '../src/discovery/textNormalizer.js';
import { createCandidate } from '../src/discovery/types.js';
import { mapGigTo19ColRow } from '../src/discovery/csvExport.js';

describe('Bug Fix: HTML-to-Text Normalizer & Candidate Sanitization', () => {
  test('1. Nested <p>, <strong>, and <h2> elements convert into sensible text separation without tags', () => {
    const input = '<p><strong>Headquarters:</strong> Remote - Canada</p> <h2><strong>What You Will Do</strong></h2> <p>We are looking for a Lead Product Manager to own the future of the Lattice MCP server.</p>';
    const result = normalizeHtmlToText(input);

    assert.ok(!/<[^>]+>/.test(result), 'Must not contain any HTML tags');
    assert.ok(result.includes('Headquarters: Remote - Canada'));
    assert.ok(result.includes('What You Will Do'));
    assert.ok(result.includes('We are looking for a Lead Product Manager'));
    assert.ok(result.includes('\n\n'), 'Must preserve paragraph boundary separation');
  });

  test('2. <div> elements with classes and attributes are stripped cleanly', () => {
    const input = '<p> <strong>Headquarters:</strong> Remote (Canada) </p> <div class="content-intro"><p>Thank you for considering Tailscale. If this job description resonates with you, we encourage you to apply!</p></div>';
    const result = normalizeHtmlToText(input);

    assert.ok(!result.includes('<div'));
    assert.ok(!result.includes('content-intro'));
    assert.ok(!result.includes('</div>'));
    assert.ok(result.includes('Headquarters: Remote (Canada)'));
    assert.ok(result.includes('Thank you for considering Tailscale.'));
  });

  test('3. <img> and media tags are completely removed with zero markup artifacts', () => {
    const input = '<img src="https://we-work-remotely.imgix.net/logos/0171/6490/logo.gif?ixlib=rails-4.0.0&w=50&h=50&dpr=2&fit=fill&auto=compress" alt="Company Logo" /><p>Web Developer (Fresh graduate welcome, WFH policy)</p>';
    const result = normalizeHtmlToText(input);

    assert.ok(!result.includes('<img'));
    assert.ok(!result.includes('logo.gif'));
    assert.ok(!result.includes('imgix.net'));
    assert.ok(result.includes('Web Developer (Fresh graduate welcome, WFH policy)'));
  });

  test('4. Script and style blocks are thoroughly eradicated including their inner content', () => {
    const input = '<script type="text/javascript">window.__malicious = true; alert("xss");</script><style>.secret { display: none; color: red; }</style><p>Genuine opportunity description text.</p>';
    const result = normalizeHtmlToText(input);

    assert.ok(!result.includes('<script'));
    assert.ok(!result.includes('<style'));
    assert.ok(!result.includes('__malicious'));
    assert.ok(!result.includes('alert'));
    assert.ok(!result.includes('.secret'));
    assert.ok(!result.includes('display: none'));
    assert.equal(result, 'Genuine opportunity description text.');
  });

  test('5. HTML entities, non-breaking spaces, and quotes are properly decoded', () => {
    const input = 'We&rsquo;re hiring &amp; searching for a C# &#47; .NET developer &ndash; &quot;High Priority&quot; &bull; &euro;65k &nbsp; &#39;Remote&#39;';
    const result = normalizeHtmlToText(input);

    assert.ok(result.includes("We're hiring & searching for a C# / .NET developer – \"High Priority\" • €65k 'Remote'"));
    assert.ok(!result.includes('&amp;'));
    assert.ok(!result.includes('&nbsp;'));
    assert.ok(!result.includes('&quot;'));
    assert.ok(!result.includes('&#39;'));
  });

  test('6. Malformed or truncated HTML is handled safely without throwing or leaving unclosed tags', () => {
    const truncatedInput = '<div class="main-content"><p>We are seeking an AI engineer with strong Python skills <strong';
    const result = normalizeHtmlToText(truncatedInput);

    assert.ok(!result.includes('<div'));
    assert.ok(!result.includes('<strong'));
    assert.ok(result.includes('We are seeking an AI engineer with strong Python skills'));

    const strayAngle = '> Stray closing bracket at start <p>Valid body</p>';
    const result2 = normalizeHtmlToText(strayAngle);
    assert.ok(!result2.startsWith('>'));
    assert.ok(result2.includes('Stray closing bracket at start'));
    assert.ok(result2.includes('Valid body'));
  });

  test('7. Already-plain text passes through cleanly with normalized whitespace', () => {
    const plainText = 'Lead AI Video Producer at Viral Media.\nProduce 10 short-form reels per week using Runway and CapCut.';
    const result = normalizeHtmlToText(plainText);

    assert.equal(result, plainText);
  });

  test('8. Empty, null, and undefined values return safe empty strings', () => {
    assert.equal(normalizeHtmlToText(null), '');
    assert.equal(normalizeHtmlToText(undefined), '');
    assert.equal(normalizeHtmlToText(''), '');
    assert.equal(normalizeHtmlToText('   \n\t  '), '');
  });

  test('9. Unordered and ordered lists convert into clean bulleted lines and line breaks', () => {
    const input = '<h3>Requirements:</h3><ul><li>Proficiency in Python and LangChain</li><li>Experience with n8n or Make.com</li><li>Understanding of prompt engineering</li></ul><br/>Nice to have:<br>Fast learner.';
    const result = normalizeHtmlToText(input);

    assert.ok(result.includes('Requirements:'));
    assert.ok(result.includes('• Proficiency in Python and LangChain'));
    assert.ok(result.includes('• Experience with n8n or Make.com'));
    assert.ok(result.includes('• Understanding of prompt engineering'));
    assert.ok(result.includes('Nice to have:'));
    assert.ok(result.includes('Fast learner.'));
    assert.ok(!result.includes('<li>'));
    assert.ok(!result.includes('<ul>'));
    assert.ok(!result.includes('<br'));
  });

  test('10. Entity-encoded HTML tags inside RSS feeds are safely normalized', () => {
    const input = '&lt;p&gt;&lt;strong&gt;Headquarters:&lt;/strong&gt; Remote - Canada&lt;/p&gt;&lt;h2&gt;&lt;strong&gt;What You Will Do&lt;/strong&gt;&lt;/h2&gt;';
    const result = normalizeHtmlToText(input);

    assert.ok(!result.includes('&lt;'));
    assert.ok(!result.includes('&gt;'));
    assert.ok(!result.includes('<p>'));
    assert.ok(result.includes('Headquarters: Remote - Canada'));
    assert.ok(result.includes('What You Will Do'));
  });

  test('11. normalizeCandidateTextFields cleans all 10 text fields while preserving metadata', () => {
    const candidate = {
      id: 'cand_test_001',
      source_name: 'test_feed',
      track_id: 'M4',
      status: 'pending_review',
      payment_amount: '$50/hr',
      title: '<b>Senior Full-Stack Engineer</b>',
      organization: '<span>TechCorp &amp; Co</span>',
      description: '<p>Build AI copilots with React &amp; Node.js.</p>',
      short_description: '<p>Build AI copilots...</p>',
      overview: '<div>Company builds AI software.</div>',
      responsibilities: '<ul><li>Write clean code</li></ul>',
      deliverables: '<p>Ship MVP in 4 weeks</p>',
      requirements: '<p>5+ years TypeScript</p>',
      proof_spec: '<p>GitHub PR link</p>',
      location: '<i>Remote (US)</i>'
    };

    const cleaned = normalizeCandidateTextFields(candidate);

    assert.equal(cleaned.id, 'cand_test_001');
    assert.equal(cleaned.status, 'pending_review');
    assert.equal(cleaned.track_id, 'M4');
    assert.equal(cleaned.payment_amount, '$50/hr');

    assert.equal(cleaned.title, 'Senior Full-Stack Engineer');
    assert.equal(cleaned.organization, 'TechCorp & Co');
    assert.equal(cleaned.description, 'Build AI copilots with React & Node.js.');
    assert.equal(cleaned.short_description, 'Build AI copilots...');
    assert.equal(cleaned.overview, 'Company builds AI software.');
    assert.equal(cleaned.responsibilities, '• Write clean code');
    assert.equal(cleaned.deliverables, 'Ship MVP in 4 weeks');
    assert.equal(cleaned.requirements, '5+ years TypeScript');
    assert.equal(cleaned.proof_spec, 'GitHub PR link');
    assert.equal(cleaned.location, 'Remote (US)');
  });

  test('12. Stored candidates file data/candidates.json contains zero raw HTML tags across all records', () => {
    const filePath = path.join(process.cwd(), 'data', 'candidates.json');
    const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    assert.ok(Array.isArray(rawData), 'Candidates data must be an array');
    assert.ok(rawData.length > 0, 'Candidates data must not be empty');

    let htmlTagsFound = 0;
    for (const c of rawData) {
      const combined = [
        c.title,
        c.organization,
        c.description,
        c.short_description,
        c.overview,
        c.responsibilities,
        c.deliverables,
        c.requirements,
        c.proof_spec
      ].filter(Boolean).join(' ');

      if (/<[a-z][\s\S]*>/i.test(combined) || /&lt;[a-z]/i.test(combined)) {
        htmlTagsFound++;
      }
    }

    assert.equal(htmlTagsFound, 0, 'Zero candidates in data/candidates.json may contain raw HTML tags');
  });

  test('13. CSV 19-Column row mapping cleans all text fields without raw HTML or broken entities', () => {
    const gig = {
      external_gig_id: 'GIG-M1-001',
      title: '<h2>Viral Video Reels Editor</h2>',
      track_id: 'M1',
      payment_amount: '$40 - $60 / hour',
      compensation_type: 'hourly',
      min_amount: 40,
      max_amount: 60,
      currency: 'USD',
      priority: 'Standard',
      is_featured: false,
      is_local_business: false,
      posted_at: '2026-10-14',
      origin_url: 'https://example.com/apply',
      short_description: '<p>Edit short-form reels for TikTok &amp; YouTube Shorts</p>',
      overview: '<div class="overview"><p>Fast-growing creative studio.</p></div>',
      responsibilities: '<ul><li>Edit in Premiere</li><li>Export in 9:16</li></ul>',
      deliverables: '<p>10 completed MP4 reels</p>',
      requirements: '<p>Portfolio of previous reels</p>',
      proof_spec: '<p>Google Drive link</p>'
    };

    const row = mapGigTo19ColRow(gig);

    assert.equal(row.length, 19);
    assert.equal(row[1], 'Viral Video Reels Editor');
    assert.equal(row[13], 'Edit short-form reels for TikTok & YouTube Shorts');
    assert.equal(row[14], 'Fast-growing creative studio.');
    assert.equal(row[15], '• Edit in Premiere\n• Export in 9:16');
    assert.equal(row[16], '10 completed MP4 reels');
    assert.equal(row[17], 'Portfolio of previous reels');
    assert.equal(row[18], 'Google Drive link');

    for (const cell of row) {
      assert.ok(!/<[a-z][\s\S]*>/i.test(cell), `Cell must not contain raw HTML: ${cell}`);
    }
  });
});
