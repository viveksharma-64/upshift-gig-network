#!/usr/bin/env node
/**
 * UpShift AI Gig Discovery Worker
 * CLI tool for running manual or scheduled discovery cycles.
 *
 * Usage:
 *   node src/server/worker.js [--source=all|fixtures|rss|api] [--limit=10] [--storage=supabase|json]
 */

import './config.js';
import { DiscoveryPipeline } from './pipeline.js';
import { FixtureDiscoveryProvider } from './providers/fixtureProvider.js';
import { RssDiscoveryProvider } from './providers/rssProvider.js';
import { PublicApiDiscoveryProvider } from './providers/publicApiProvider.js';
import {
  defaultCandidateRepository,
  SupabaseCandidateRepository,
  getServerSupabaseClient,
  GIG_CANDIDATES_TABLE
} from './candidateRepository.js';

// Parse command-line args
const args = process.argv.slice(2);
const options = {
  source: 'all',
  limit: 10,
  storage: process.env.CANDIDATE_STORAGE || (process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'json')
};

for (const arg of args) {
  if (arg.startsWith('--source=')) {
    options.source = arg.split('=')[1].toLowerCase();
  } else if (arg.startsWith('--limit=')) {
    options.limit = parseInt(arg.split('=')[1], 10) || 10;
  } else if (arg.startsWith('--storage=')) {
    options.storage = arg.split('=')[1].toLowerCase();
  }
}

async function main() {
  console.log('====================================================');
  console.log(' UpShift — AI-Powered Gig Discovery Worker');
  console.log(` Mode: Source=${options.source} | Limit=${options.limit} | Storage=${options.storage}`);
  console.log('====================================================');

  const selectedProviders = [];
  if (options.source === 'fixtures' || options.source === 'all') {
    selectedProviders.push(new FixtureDiscoveryProvider());
  }
  if (options.source === 'rss' || options.source === 'all') {
    selectedProviders.push(new RssDiscoveryProvider());
  }
  if (options.source === 'api' || options.source === 'all') {
    selectedProviders.push(new PublicApiDiscoveryProvider());
  }

  // Select repository adapter based on storage configuration
  let repository = defaultCandidateRepository;
  if (options.storage === 'supabase') {
    const serverSupabase = getServerSupabaseClient();
    repository = new SupabaseCandidateRepository(serverSupabase, GIG_CANDIDATES_TABLE);
    console.log(`[Worker] Connected to persistent staging table: public.${GIG_CANDIDATES_TABLE}`);
  } else {
    console.log('[Worker] Operating in local development/test adapter mode (data/candidates.json)');
  }

  const pipeline = new DiscoveryPipeline({
    providers: selectedProviders,
    repository
  });

  const startTime = Date.now();
  try {
    const stats = await pipeline.runCycle({ limit: options.limit });
    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n====================================================');
    console.log(' Ingestion Cycle Summary:');
    console.log(` - Execution Time : ${elapsedSeconds}s`);
    console.log(` - Storage Target : ${options.storage === 'supabase' ? `public.${GIG_CANDIDATES_TABLE}` : 'data/candidates.json'}`);
    console.log(` - Raw Discovered : ${stats.discovered}`);
    console.log(` - New Candidates : ${stats.inserted}`);
    console.log(` - Re-checked     : ${stats.updated}`);
    console.log(` - Duplicates     : ${stats.duplicates}`);
    console.log(` - Store Total    : ${stats.total}`);
    console.log('====================================================\n');
  } catch (err) {
    console.error('[Worker Fatal Error]:', err);
    process.exit(1);
  }
}

main();
