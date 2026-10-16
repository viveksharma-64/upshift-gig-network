#!/usr/bin/env node
/**
 * UpShift AI Gig Discovery Worker
 * CLI tool for running manual or scheduled discovery cycles.
 *
 * Capabilities:
 * - Direct execution: node src/server/worker.js [--source=all|fixtures|rss|api] [--limit=10] [--storage=supabase|json]
 * - Queue consumer: node src/server/worker.js --storage=supabase --job-id=<id> OR --consume-queue
 * - Multi-process concurrency locking via JobManager atomic leases
 * - Execution heartbeat and crash recovery
 * - Stages candidates for human review (never auto-publishes)
 */

import './config.js';
import { DiscoveryPipeline } from './pipeline.js';
import { FixtureDiscoveryProvider } from './providers/fixtureProvider.js';
import { RssDiscoveryProvider } from './providers/rssProvider.js';
import { PublicApiDiscoveryProvider } from './providers/publicApiProvider.js';
import { FreelancerDiscoveryProvider } from './providers/freelancerProvider.js';
import {
  defaultCandidateRepository,
  SupabaseCandidateRepository,
  getServerSupabaseClient,
  GIG_CANDIDATES_TABLE
} from './candidateRepository.js';
import {
  JobManager,
  defaultJobManager,
  JOB_STATUS,
  JOB_TYPE,
  TRIGGER_TYPE
} from './jobManager.js';

// Parse command-line args
const args = process.argv.slice(2);
const options = {
  source: 'all',
  limit: 10,
  storage: process.env.CANDIDATE_STORAGE || (process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'json'),
  jobId: '',
  consumeQueue: false
};

for (const arg of args) {
  if (arg.startsWith('--source=')) {
    options.source = arg.split('=')[1].toLowerCase();
  } else if (arg.startsWith('--limit=')) {
    options.limit = parseInt(arg.split('=')[1], 10) || 10;
  } else if (arg.startsWith('--storage=')) {
    options.storage = arg.split('=')[1].toLowerCase();
  } else if (arg.startsWith('--job-id=')) {
    options.jobId = arg.split('=')[1].trim();
  } else if (arg === '--consume-queue' || arg === '--queue') {
    options.consumeQueue = true;
  }
}

async function main() {
  console.log('====================================================');
  console.log(' UpShift — AI-Powered Gig Discovery Worker');
  console.log(` Mode: Source=${options.source} | Limit=${options.limit} | Storage=${options.storage}${options.jobId ? ` | TargetJob=${options.jobId}` : ''}`);
  console.log('====================================================');

  // Select repository adapter based on storage configuration
  let repository = defaultCandidateRepository;
  let serverSupabase = null;
  let jobManager = defaultJobManager;

  if (options.storage === 'supabase') {
    serverSupabase = getServerSupabaseClient();
    repository = new SupabaseCandidateRepository(serverSupabase, GIG_CANDIDATES_TABLE);
    jobManager = new JobManager({ client: serverSupabase });
    console.log(`[Worker] Connected to persistent staging table: public.${GIG_CANDIDATES_TABLE}`);
  } else {
    console.log('[Worker] Operating in local development/test adapter mode (data/candidates.json)');
  }

  // Queue Consumer Integration (Fix 1)
  const workerId = `runner_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  let activeJob = null;

  // 1. Check if specific jobId was targeted (admin-triggered dispatch)
  if (options.jobId) {
    try {
      const claimed = await jobManager.claimJob(workerId, options.jobId);
      if (claimed) {
        activeJob = claimed;
        console.log(`[Worker] Claimed target admin job: ${activeJob.id}`);
      } else {
        console.warn(`[Worker] Target job ${options.jobId} could not be claimed (already running, completed, or not found).`);
      }
    } catch (claimErr) {
      console.warn(`[Worker] Error claiming target job ${options.jobId}:`, claimErr.message);
    }
  }

  // 2. If no specific job or queue consumer flag is active, check for any pending job in queue
  if (!activeJob && (options.consumeQueue || options.storage === 'supabase')) {
    try {
      const pending = await jobManager.claimJob(workerId);
      if (pending) {
        activeJob = pending;
        console.log(`[Worker] Claimed pending job from queue: ${activeJob.id} (Trigger: ${activeJob.trigger_type})`);
      }
    } catch (queueErr) {
      console.warn('[Worker] Notice polling queue:', queueErr.message);
    }
  }

  // 3. If running scheduled cycle in Supabase without a prior job record, create one to track run
  if (!activeJob && options.storage === 'supabase') {
    try {
      const created = await jobManager.createJob({
        triggerType: TRIGGER_TYPE.SCHEDULED,
        jobType: JOB_TYPE.DISCOVERY,
        params: { source: options.source, limit: options.limit }
      });
      activeJob = await jobManager.claimJob(workerId, created.id);
      console.log(`[Worker] Registered and claimed scheduled discovery job: ${activeJob?.id || created.id}`);
    } catch (trackErr) {
      console.warn('[Worker] Notice tracking scheduled discovery job:', trackErr.message);
    }
  }

  // Determine effective execution options
  const effectiveSource = activeJob?.params?.source || options.source;
  const effectiveLimit = activeJob?.params?.limit || options.limit;

  const selectedProviders = [];
  if (effectiveSource === 'fixtures') {
    selectedProviders.push(new FixtureDiscoveryProvider());
  }
  if (effectiveSource === 'rss' || effectiveSource === 'all') {
    selectedProviders.push(new RssDiscoveryProvider());
  }
  if (effectiveSource === 'api' || effectiveSource === 'all') {
    selectedProviders.push(new PublicApiDiscoveryProvider());
  }
  if (effectiveSource === 'freelancer' || (effectiveSource === 'all' && process.env?.FREELANCER_OAUTH_TOKEN)) {
    selectedProviders.push(new FreelancerDiscoveryProvider());
  }

  const pipeline = new DiscoveryPipeline({
    providers: selectedProviders,
    repository
  });

  // Heartbeat loop to keep lease alive during long crawls
  let heartbeatTimer = null;
  if (activeJob) {
    heartbeatTimer = setInterval(async () => {
      try {
        await jobManager.heartbeat(activeJob.id);
      } catch {}
    }, 30000);
  }

  const startTime = Date.now();
  try {
    const stats = await pipeline.runCycle({ limit: effectiveLimit });
    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

    if (heartbeatTimer) clearInterval(heartbeatTimer);

    // Record job completion
    if (activeJob) {
      const allCandidates = await repository.getAll();
      const pendingCount = allCandidates.filter(c => c.status === 'pending_review').length;

      const summary = {
        fetched: stats.discovered || 0,
        relevant: stats.relevant || 0,
        rejected: stats.rejected || 0,
        duplicate: stats.duplicates || 0,
        uncertain: stats.uncertain || 0,
        newly_saved: stats.inserted || 0,
        updated: stats.updated || 0,
        total_pending: pendingCount,
        total_store: stats.total
      };

      await jobManager.completeJob(activeJob.id, summary);
      console.log(`[Worker] Job ${activeJob.id} successfully completed and recorded.`);
    }

    console.log('\n====================================================');
    console.log(' Ingestion Cycle Summary:');
    console.log(` - Execution Time : ${elapsedSeconds}s`);
    console.log(` - Storage Target : ${options.storage === 'supabase' ? `public.${GIG_CANDIDATES_TABLE}` : 'data/candidates.json'}`);
    console.log(` - Raw Discovered : ${stats.discovered}`);
    console.log(` - New Candidates : ${stats.inserted}`);
    console.log(` - Re-checked     : ${stats.updated}`);
    console.log(` - Duplicates     : ${stats.duplicates}`);
    console.log(` - Store Total    : ${stats.total}`);
    if (stats.providerStats) {
      console.log('\n Per-Provider Breakdown:');
      for (const [pName, pStat] of Object.entries(stats.providerStats)) {
        console.log(`   • [${pName}] Fetched: ${pStat.fetched} | Accepted: ${pStat.accepted} | Rejected: ${pStat.rejected} | Uncertain: ${pStat.uncertain} | Duplicate: ${pStat.duplicate} | Saved: ${pStat.saved}`);
      }
    }
    console.log('====================================================\n');
  } catch (err) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (activeJob) {
      try {
        await jobManager.failJob(activeJob.id, err.message);
      } catch {}
    }
    console.error('[Worker Fatal Error]:', err.message || err);
    if (/column of '[^']+' in the schema cache/i.test(err?.message || '')) {
      console.error('\n[Schema Notice]: Remote database schema is missing required columns.');
      console.error('Please ensure all Supabase migrations have been applied:');
      console.error('  - supabase/migrations/20261015000000_discovery_jobs.sql');
      console.error('  - supabase/migrations/20261015000001_gig_candidates_health_and_referrals.sql\n');
    }
    process.exit(1);
  }
}

main();
