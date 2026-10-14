/**
 * UpShift Daily Opportunity & Source Health Monitor
 *
 * Implements FRD v1.0 Section 11, 21 & 26:
 * - PUB-05: Scheduled monitoring of existing candidates and published opportunities
 * - Prevents stale or false 'Active' states: closed or 404 listings are marked 'Stopped'
 * - Source health tracking: checks external APIs/feeds and records status
 * - Emits health change notifications (NOT-02)
 */

import { fileURLToPath } from 'node:url';
import { defaultCandidateRepository, getServerSupabaseClient } from './candidateRepository.js';
import { defaultSourceRegistry, SOURCE_HEALTH } from './sources.js';
import { defaultNotificationService, NOTIFICATION_EVENTS } from './notifications.js';
import { ACTIVITY_STATUS, CANDIDATE_STATUS, normalizeActivityStatus } from '../discovery/types.js';

/**
 * Probes a single target URL for live availability
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ accessible: boolean, statusCode: number|null, reason: string|null }>}
 */
export async function probeUrlAvailability(url, timeoutMs = 8000) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return { accessible: false, statusCode: null, reason: 'Invalid or missing HTTP URL' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) UpShiftHealthMonitor/1.0'
      }
    });
    clearTimeout(timeoutId);

    // 404 (Not Found) or 410 (Gone) indicate definite closure
    if (res.status === 404 || res.status === 410) {
      return {
        accessible: false,
        isClosed: true,
        statusCode: res.status,
        reason: `Target returned HTTP ${res.status} (Opportunity removed/expired)`
      };
    }

    // Inspect content body for explicit pause or closed/expired indicators
    if (res.ok) {
      const text = await res.text();
      const lower = text.toLowerCase().slice(0, 5000);

      // Check for pause signals
      if (
        lower.includes('hiring paused') ||
        lower.includes('applications are paused') ||
        lower.includes('temporarily closed') ||
        lower.includes('not currently accepting applications') ||
        lower.includes('capacity reached') ||
        lower.includes('temporarily on hold')
      ) {
        return {
          accessible: false,
          isPaused: true,
          statusCode: res.status,
          reason: 'Page content indicates opportunity is temporarily paused'
        };
      }

      // Check for closure signals
      if (
        lower.includes('this job is no longer available') ||
        lower.includes('this position has been filled') ||
        lower.includes('job posting expired') ||
        lower.includes('applications are now closed') ||
        lower.includes('no longer accepting applications') ||
        lower.includes('position closed')
      ) {
        return {
          accessible: false,
          isClosed: true,
          statusCode: res.status,
          reason: 'Page content indicates opportunity is closed/expired'
        };
      }
      return { accessible: true, statusCode: res.status, reason: null };
    }

    // Inconclusive non-200 responses: bot blocks (403), rate limits (429), or server errors (5xx)
    // These must NOT be marked accessible (which would falsely confirm Active status)
    // Nor can they be marked closed (which would falsely mark Stopped)
    return {
      accessible: false,
      isClosed: false,
      isPaused: false,
      isInconclusive: true,
      statusCode: res.status,
      reason: `HTTP ${res.status} response (${res.status === 403 ? 'Bot protection / Cloudflare challenge' : res.status === 429 ? 'Rate limited' : 'Server error'}; inconclusive for activity)`
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === 'AbortError';
    return {
      accessible: false,
      isClosed: false,
      isPaused: false,
      isInconclusive: true,
      statusCode: null,
      reason: isTimeout
        ? 'Request timed out (server unresponsive; inconclusive for activity)'
        : `Network error: ${err.message} (inconclusive for activity)`
    };
  }
}

/**
 * Runs a complete health monitoring cycle across candidates and sources
 * @param {object} options
 * @returns {Promise<object>} summary of monitor results
 */
export async function runHealthMonitoringCycle(options = {}) {
  const {
    repository = defaultCandidateRepository,
    sourceRegistry = defaultSourceRegistry,
    notificationService = defaultNotificationService,
    probeFn = probeUrlAvailability,
    dryRun = false,
    maxCheck = 50,
    checkLiveGigs = true,
    liveGigsClient = null
  } = options;

  console.info('[HealthMonitor] Starting opportunity and source health monitoring cycle...');
  const results = {
    started_at: new Date().toISOString(),
    candidates_checked: 0,
    candidates_healthy: 0,
    candidates_stopped: 0,
    sources_checked: 0,
    sources_healthy: 0,
    sources_degraded: 0,
    sources_failing: 0,
    notifications_emitted: 0
  };

  // 1. Check Opportunity Candidates (Active & Approved)
  const candidates = await repository.getAll();
  const candidatesToCheck = candidates
    .filter(c => {
      const act = normalizeActivityStatus(c.activity_status);
      return act === ACTIVITY_STATUS.ACTIVE || c.status === CANDIDATE_STATUS.APPROVED;
    })
    .slice(0, maxCheck);

  for (const cand of candidatesToCheck) {
    results.candidates_checked++;
    const targetUrl = cand.application_url || cand.original_url;

    // Skip local fixture listings from external network probes
    if (!targetUrl || targetUrl.startsWith('local://')) {
      results.candidates_healthy++;
      continue;
    }

    const probe = await probeFn(targetUrl);
    const now = new Date().toISOString();

    // Determine deterministic status transition: Confirmed closed/expired -> Stopped; Paused -> Paused; Inconclusive -> Needs Review
    const isPaused = probe.isPaused || (probe.reason && probe.reason.toLowerCase().includes('paused'));
    const isDefiniteClosed = probe.isClosed || probe.statusCode === 404 || probe.statusCode === 410 ||
      (probe.reason && (
        probe.reason.includes('Opportunity removed/expired') ||
        probe.reason.includes('Page content indicates opportunity is closed') ||
        probe.reason.includes('closed') ||
        probe.reason.includes('expired')
      ));

    if (!probe.accessible) {
      const newActivityStatus = isDefiniteClosed ? ACTIVITY_STATUS.STOPPED : isPaused ? ACTIVITY_STATUS.PAUSED : ACTIVITY_STATUS.UNCERTAIN;
      const newLifecycleStatus = isDefiniteClosed ? CANDIDATE_STATUS.STOPPED : isPaused ? CANDIDATE_STATUS.PAUSED : CANDIDATE_STATUS.NEEDS_RECHECK;
      const gigTableStatus = isDefiniteClosed ? 'Stopped' : isPaused ? 'Paused' : 'Needs Review';

      results.candidates_stopped++;
      console.warn(`[HealthMonitor] Opportunity status changed: "${cand.title}" -> ${newActivityStatus} (${probe.reason})`);

      const updated = {
        ...cand,
        activity_status: newActivityStatus,
        status: newLifecycleStatus,
        last_health_check_at: now,
        health_check_error: probe.reason,
        activity_evidence: [
          ...(cand.activity_evidence || []),
          `[HealthMonitor] Verified on ${now}: ${probe.reason} -> ${newActivityStatus}`
        ]
      };

      if (!dryRun) {
        // Update candidate in place (never inserts new row)
        await repository.save(updated);

        // If this candidate was published to public.gigs, update the live gig record in place
        if (cand.published_gig_id) {
          try {
            const client = getServerSupabaseClient();
            if (client) {
              await client.from('gigs').update({
                status: gigTableStatus,
                updated_at: now
              }).eq('id', cand.published_gig_id);
            }
          } catch (syncErr) {
            console.warn(`[HealthMonitor] Notice syncing status to live gig ${cand.published_gig_id}:`, syncErr.message);
          }
        }

        notificationService.notify(NOTIFICATION_EVENTS.HEALTH_STATUS_CHANGED, {
          id: cand.id,
          title: cand.title,
          previous_status: cand.activity_status,
          new_status: newActivityStatus,
          reason: probe.reason
        });
        results.notifications_emitted++;
      }
    } else {
      results.candidates_healthy++;
      if (!dryRun) {
        cand.last_health_check_at = now;
        cand.health_check_error = null;
        cand.activity_status = ACTIVITY_STATUS.ACTIVE;
        await repository.save(cand);

        // Keep published gig active if verified
        if (cand.published_gig_id) {
          try {
            const client = getServerSupabaseClient();
            if (client) {
              await client.from('gigs').update({
                status: 'Active',
                updated_at: now
              }).eq('id', cand.published_gig_id);
            }
          } catch {}
        }
      }
    }
  }

  // 1b. Check Published Gigs in Database in place (FRD Section 11 & PUB-05)
  if (checkLiveGigs) {
    try {
      const client = liveGigsClient || getServerSupabaseClient();
      if (client) {
        const { data: liveGigs } = await client.from('gigs').select('*');
        if (Array.isArray(liveGigs)) {
          for (const gig of liveGigs) {
            results.live_gigs_checked = (results.live_gigs_checked || 0) + 1;
            if (gig.status === 'Paused') {
              // Paused remains Paused and is excluded from active listings
              continue;
            }
            const probe = await probeFn(gig.origin_url);
            const now = new Date().toISOString();
            if (!probe.accessible) {
              const isClosed = probe.isClosed || probe.statusCode === 404 || probe.statusCode === 410 ||
                (probe.reason && (probe.reason.includes('closed') || probe.reason.includes('expired')));
              const isPaused = probe.isPaused || (probe.reason && probe.reason.toLowerCase().includes('paused'));
              const nextStatus = isClosed ? 'Stopped' : isPaused ? 'Paused' : 'Needs Review';
              if (!dryRun) {
                await client.from('gigs').update({
                  status: nextStatus,
                  updated_at: now
                }).eq('id', gig.id);
              }
            } else if (!dryRun && gig.status !== 'Active') {
              // Only active if explicitly verified
              await client.from('gigs').update({
                status: 'Active',
                updated_at: now
              }).eq('id', gig.id);
            }
          }
        }
      }
    } catch (gigCheckErr) {
      console.warn('[HealthMonitor] Live gigs health check notice:', gigCheckErr.message);
    }
  }

  // 2. Check External Sources in Registry
  await sourceRegistry.init();
  const allSources = sourceRegistry.getAllSources();

  for (const src of allSources) {
    results.sources_checked++;
    if (src.type === 'fixture' || src.url.startsWith('local://')) {
      sourceRegistry.recordSuccess(src.id, 0);
      results.sources_healthy++;
      continue;
    }

    const probe = await probeFn(src.url, 5000);
    if (probe.accessible) {
      sourceRegistry.recordSuccess(src.id, 0);
      results.sources_healthy++;
    } else {
      sourceRegistry.recordFailure(src.id, probe.reason);
      if (src.health_status === SOURCE_HEALTH.FAILING) {
        results.sources_failing++;
      } else {
        results.sources_degraded++;
      }
    }
  }

  if (!dryRun) {
    await sourceRegistry.save();
  }

  results.completed_at = new Date().toISOString();
  console.info('[HealthMonitor] Monitoring cycle finished:', results);
  return results;
}

// CLI Execution entrypoint
const isDirectCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectCli) {
  runHealthMonitoringCycle()
    .then(summary => {
      console.info('Summary:', JSON.stringify(summary, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('Monitor fatal error:', err);
      process.exit(1);
    });
}
