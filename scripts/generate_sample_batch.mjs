/**
 * Generator script for 150 realistic FRD opportunity candidates spanning M1–M6
 *
 * Implements FRD Section 23, 27, 34: 100-200 sample-record batch testing dataset.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_FILE = path.resolve(__dirname, '../data/sample_gigs_150.json');

const TRACKS = [
  { id: 'M1', name: 'AI Video / Reels', roles: ['AI Video Editor', 'Short-form Reels Producer', 'HeyGen Avatar Creator', 'Runway Gen-2 Video Specialist', 'TikTok AI Video Content Creator'] },
  { id: 'M2', name: 'AI Design / Visual', roles: ['Midjourney Brand Designer', 'AI Graphic Illustrator', 'Flux / Stable Diffusion Artist', 'Canva Magic Studio Designer', 'AI Product Visualizer'] },
  { id: 'M3', name: 'AI Data & Evaluation', roles: ['RLHF Prompt Evaluator', 'LLM Model Response Benchmark Annotator', 'AI Dataset QA Specialist', 'Data Labeling & Hallucination Auditor', 'Multimodal Annotation Lead'] },
  { id: 'M4', name: 'AI Coding & Web Dev', roles: ['AI Fullstack Web Developer', 'Cursor / Copilot Frontend Engineer', 'FastAPI AI Integration Builder', 'Next.js AI Tooling Developer', 'LangChain Workflow Engineer'] },
  { id: 'M5', name: 'AI Marketing & Growth', roles: ['AI Copywriting & SEO Specialist', 'Perplexity Marketing Researcher', 'AI Cold Email Outreach Strategist', 'Social Media AI Automation Growth Lead', 'AI Content Repurposing Manager'] },
  { id: 'M6', name: 'AI Automation & Agents', roles: ['n8n AI Workflow Architect', 'Zapier & Make Automation Specialist', 'Autonomous Agent Pipeline Builder', 'Customer Support AI Agent Integrator', 'CrewAI Multi-Agent Systems Engineer'] }
];

const COMPANIES = [
  'Nexus AI Labs', 'Apex Creative Studio', 'Vanguard Data Systems', 'Quantum Media Works',
  'Pulse Growth Partners', 'Aura Automation Group', 'Synapse Web Solutions', 'Catalyst Ventures',
  'HyperScale Interactive', 'OmniFlow Digital', 'Starlight Tech Solutions', 'Elevate AI Marketing',
  'Vector Vision Media', 'Horizon Logic Labs', 'Frontier Intelligence Inc', 'Echo Systems Global'
];

const LOCATIONS = ['Remote (US)', 'Remote (Worldwide)', 'Remote (EU)', 'Remote (UK & Europe)', 'Remote (North America)'];
const CURRENCIES = ['USD', 'EUR', 'GBP'];

function generateSampleDataset(count = 150) {
  const records = [];
  const baseDate = new Date('2026-10-10');

  for (let i = 1; i <= count; i++) {
    const trackObj = TRACKS[(i - 1) % TRACKS.length];
    const roleTitle = trackObj.roles[i % trackObj.roles.length];
    const company = COMPANIES[(i * 3) % COMPANIES.length];
    const loc = LOCATIONS[i % LOCATIONS.length];
    const currency = CURRENCIES[i % CURRENCIES.length];

    const hourlyMin = 25 + (i % 8) * 5;
    const hourlyMax = hourlyMin + 15 + (i % 5) * 5;
    const isHourly = i % 3 !== 0;
    const paymentAmount = isHourly
      ? `$${hourlyMin} - $${hourlyMax} / hour`
      : `$${hourlyMin * 30} - $${hourlyMax * 40} project fee`;

    const statusChoice = i % 10 === 0 ? 'paused' : i % 15 === 0 ? 'stopped' : 'active';
    const dayOffset = Math.floor(i / 15);
    const postedDate = new Date(baseDate.getTime() - dayOffset * 86400000).toISOString().split('T')[0];

    const candidate = {
      id: `cand_sample_${String(i).padStart(3, '0')}`,
      external_gig_id: `EXT-SAMPLE-${String(i).padStart(4, '0')}`,
      source_name: i % 2 === 0 ? 'Arbeitnow Tech' : 'Remotive AI',
      source_type: 'api',
      source_listing_id: `list-${i * 1024}`,
      title: `${roleTitle} - ${company}`,
      organization: company,
      location: loc,
      work_arrangement: 'remote',
      description: `Seeking an experienced ${roleTitle} to join ${company}. Will collaborate on client deliverables, utilize modern generative AI tooling, and deliver high-quality outputs within defined sprint cycles.`,
      responsibilities: `1. Execute core ${trackObj.name} deliverables using modern AI pipelines.\n2. Review quality and adherence to brand specifications.\n3. Iterate rapidly based on stakeholder feedback.`,
      deliverables: `Completed project assets, prompt documentation, and verified quality outputs.`,
      requirements: `Demonstrated experience in ${trackObj.name}. Portfolio or work samples required. Reliable high-speed internet and strong communication skills.`,
      proof_spec: `Submit link to completed repository, video reel, or visual artifacts matching project brief.`,
      payment_amount: paymentAmount,
      min_amount: hourlyMin,
      max_amount: hourlyMax,
      currency: currency,
      compensation_type: isHourly ? 'hourly' : 'fixed',
      posted_date: postedDate,
      posted_at: postedDate,
      deadline: null,
      first_discovered_at: new Date(baseDate.getTime() - dayOffset * 86400000).toISOString(),
      last_checked_at: new Date().toISOString(),
      track_id: trackObj.id,
      matched_modules: [trackObj.id],
      module_fit_scores: { [trackObj.id]: 85 + (i % 15) },
      activity_status: statusChoice === 'active' ? 'Active' : statusChoice === 'paused' ? 'Paused' : 'Stopped',
      activity_confidence: 80 + (i % 20),
      activity_evidence: [
        'HTTP 200 verification confirmed.',
        'Clear application flow and active hiring posting.',
        'Validated against job board API.'
      ],
      review_priority: 60 + (i % 38),
      data_completeness: 85,
      is_duplicate: false,
      duplicate_of: null,
      referral_required: i % 4 === 0,
      referral_id: i % 4 === 0 ? `REF-${trackObj.id}-${String(i).padStart(3, '0')}` : null,
      referral_url: i % 4 === 0 ? `https://apply.example.com/job/${i}?ref=upshift_${i}` : null,
      referral_history: i % 4 === 0 ? [{
        edited_at: new Date().toISOString(),
        edited_by: 'system_loader',
        new_id: `REF-${trackObj.id}-${String(i).padStart(3, '0')}`,
        referral_required: true
      }] : [],
      status: i <= 25 ? 'approved' : i <= 35 ? 'paused' : i <= 40 ? 'stopped' : 'pending_review',
      application_url: `https://jobs.example.com/view/${i}?src=upshift`,
      original_url: `https://jobs.example.com/view/${i}`,
      reviewed_by: i <= 25 ? 'admin_reviewer' : null,
      reviewed_at: i <= 25 ? new Date().toISOString() : null
    };

    records.push(candidate);
  }

  return records;
}

async function main() {
  const dataset = generateSampleDataset(150);
  const dir = path.dirname(OUTPUT_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(dataset, null, 2), 'utf8');
  console.info(`Generated 150 sample candidate listings in ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Failed to generate dataset:', err);
  process.exit(1);
});
