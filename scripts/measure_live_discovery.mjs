import { PublicApiDiscoveryProvider } from '../src/server/providers/publicApiProvider.js';
import { RssDiscoveryProvider } from '../src/server/providers/rssProvider.js';
import { DiscoveryPipeline } from '../src/server/pipeline.js';
import { JsonCandidateRepository } from '../src/server/candidateRepository.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEASURE_DATA_FILE = path.join(__dirname, '../data/test_live_measure_candidates.json');

async function measureLiveDiscovery() {
  console.log('===============================================================');
  console.log(' Phase 1: Live Source Discovery Measurement by UpShift Track');
  console.log(' (Excludes all synthetic fixtures; queries real permitted endpoints)');
  console.log('===============================================================\n');

  try {
    if (fs.existsSync(MEASURE_DATA_FILE)) fs.unlinkSync(MEASURE_DATA_FILE);
  } catch {}

  const repo = new JsonCandidateRepository(MEASURE_DATA_FILE);
  const liveProviders = [
    new PublicApiDiscoveryProvider(),
    new RssDiscoveryProvider()
  ];

  const pipeline = new DiscoveryPipeline({
    repository: repo,
    providers: liveProviders
  });

  const rawBySource = new Map();
  const allRaw = [];

  for (const provider of liveProviders) {
    console.log(`[Fetcher] Querying live provider: ${provider.name} (${provider.type})...`);
    const start = Date.now();
    const fetched = await provider.fetchCandidates({ limit: 40, limitPerFeed: 15 });
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    console.log(` -> Fetched ${fetched.length} raw listings from ${provider.name} in ${elapsed}s.`);
    rawBySource.set(provider.name, fetched);
    allRaw.push(...fetched);
  }

  console.log(`\nTotal Live Raw Listings Discovered: ${allRaw.length}`);

  // Track-specific counters
  const trackMetrics = {
    M1: { track: 'M1 (AI Video / Reels)', fetched: 0, filtered: 0, relevant: 0, duplicate: 0, rejected: 0, staged: 0, conflict: 0, confidence: { high: 0, moderate: 0, low: 0 }, samples: [] },
    M2: { track: 'M2 (AI Design / Visual)', fetched: 0, filtered: 0, relevant: 0, duplicate: 0, rejected: 0, staged: 0, conflict: 0, confidence: { high: 0, moderate: 0, low: 0 }, samples: [] },
    M3: { track: 'M3 (AI Data & Evaluation)', fetched: 0, filtered: 0, relevant: 0, duplicate: 0, rejected: 0, staged: 0, conflict: 0, confidence: { high: 0, moderate: 0, low: 0 }, samples: [] },
    M4: { track: 'M4 (AI Coding & Web Dev)', fetched: 0, filtered: 0, relevant: 0, duplicate: 0, rejected: 0, staged: 0, conflict: 0, confidence: { high: 0, moderate: 0, low: 0 }, samples: [] },
    M5: { track: 'M5 (AI Marketing & Growth)', fetched: 0, filtered: 0, relevant: 0, duplicate: 0, rejected: 0, staged: 0, conflict: 0, confidence: { high: 0, moderate: 0, low: 0 }, samples: [] },
    M6: { track: 'M6 (AI Automation & Agents)', fetched: 0, filtered: 0, relevant: 0, duplicate: 0, rejected: 0, staged: 0, conflict: 0, confidence: { high: 0, moderate: 0, low: 0 }, samples: [] },
    UNMATCHED: { track: 'Unmatched / Low-Relevance (<20 pts)', count: 0, samples: [] }
  };

  const processedPool = [];
  let totalDuplicates = 0;

  for (let i = 0; i < allRaw.length; i++) {
    const raw = allRaw[i];
    const candidate = await pipeline.processListing(raw, processedPool);
    processedPool.push(candidate);

    if (candidate.is_duplicate) {
      totalDuplicates++;
    }

    const track = candidate.track_id;
    const isRel = candidate.is_relevant;

    console.log(` [${i + 1}/${allRaw.length}] [${track}] "${candidate.title.slice(0, 45)}" (Rel: ${isRel}, Score: ${candidate.module_fit_score}%, Conf: ${candidate.confidence_tier})`);

    if (trackMetrics[track]) {
      trackMetrics[track].fetched++;
    }

    if (!isRel) {
      if (trackMetrics[track]) {
        trackMetrics[track].filtered++;
        trackMetrics[track].rejected++;
      }
      trackMetrics.UNMATCHED.count++;
      if (trackMetrics.UNMATCHED.samples.length < 3) {
        trackMetrics.UNMATCHED.samples.push({
          title: candidate.title,
          organization: candidate.organization,
          source: candidate.source_name,
          url: candidate.original_url,
          score: candidate.module_fit_score
        });
      }
      continue;
    }

    if (trackMetrics[track]) {
      const tm = trackMetrics[track];
      tm.relevant++;
      if (candidate.is_duplicate) {
        tm.duplicate++;
      } else if (candidate.status === 'rejected') {
        tm.rejected++;
      } else {
        tm.staged++;
      }

      if (candidate.has_conflict) tm.conflict++;

      const conf = candidate.confidence_tier || 'moderate';
      if (tm.confidence[conf] !== undefined) tm.confidence[conf]++;

      if (tm.samples.length < 2) {
        tm.samples.push({
          id: candidate.id,
          title: candidate.title,
          organization: candidate.organization,
          source: candidate.source_name,
          url: candidate.original_url,
          pay: candidate.payment_amount,
          date: candidate.posted_date,
          score: candidate.module_fit_score,
          confidence: candidate.confidence_tier,
          conflict: candidate.has_conflict ? candidate.conflicting_tracks : null
        });
      }
    }
  }

  // Save batch
  const saveStats = await repo.saveBatch(processedPool);

  console.log('\n===============================================================');
  console.log(' Live Discovery Results by Track:');
  console.log('===============================================================');
  console.table(Object.entries(trackMetrics)
    .filter(([k]) => k !== 'UNMATCHED')
    .map(([k, v]) => ({
      Track: k,
      'Track Name': v.track,
      Fetched: v.fetched,
      Filtered: v.filtered,
      Relevant: v.relevant,
      Duplicate: v.duplicate,
      Rejected: v.rejected,
      Staged: v.staged,
      Conflicts: v.conflict
    }))
  );

  console.log(`Unmatched / Low-Relevance Listings Screened Out: ${trackMetrics.UNMATCHED.count}`);
  console.log(`Total Staged in Repository: ${saveStats.inserted} inserted, ${saveStats.updated} updated, ${saveStats.total} total.`);

  console.log('\n===============================================================');
  console.log(' Representative Sample Candidates by Track (with Source URLs):');
  console.log('===============================================================');
  for (const [k, v] of Object.entries(trackMetrics)) {
    if (k === 'UNMATCHED') continue;
    console.log(`\n--- [${k}] ${v.track} (Total Relevant: ${v.relevant}) ---`);
    if (v.samples.length === 0) {
      console.log(' [!] Zero listings discovered for this track.');
    } else {
      v.samples.forEach((s, idx) => {
        console.log(` [${idx + 1}] "${s.title}"`);
        console.log(`     Employer: ${s.organization} | Source: ${s.source} | Date: ${s.date || 'Unspecified'}`);
        console.log(`     Pay: ${s.pay} | Score: ${s.score}% (${s.confidence})`);
        if (s.conflict) console.log(`     Conflicting Tracks: ${s.conflict.join(', ')}`);
        console.log(`     URL: ${s.url}`);
      });
    }
  }

  console.log('\n--- Unmatched Samples (Screened Out from Gigs) ---');
  trackMetrics.UNMATCHED.samples.forEach((s, idx) => {
    console.log(` [${idx + 1}] "${s.title}" (${s.organization}) [${s.source}] - Score: ${s.score}% - URL: ${s.url}`);
  });
}

measureLiveDiscovery().catch(console.error);
