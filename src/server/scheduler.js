/**
 * UpShift Automated Daily Health Scheduler Daemon
 *
 * Implements FRD v1.0 Section 11, 21 & Section 26:
 * - Automatically rechecks published Active gigs & candidate staging every 24 hours
 * - Strict overlap protection (mutex + lockfile) prevents concurrent execution
 * - Retry logic with exponential backoff for transient network issues
 * - In-place status updates (Active, Paused, Stopped, Needs Review) without duplicate creation
 * - Comprehensive audit trail logging (data/monitor_audit.json)
 * - Graceful shutdown and process signal handling
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHealthMonitoringCycle } from './monitor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../data');
const DEFAULT_AUDIT_LOG = path.join(DEFAULT_DATA_DIR, 'monitor_audit.json');
const DEFAULT_LOCK_FILE = path.join(DEFAULT_DATA_DIR, '.monitor_scheduler.lock');

// 24 hours default daily interval, configurable via environment
const DEFAULT_INTERVAL_MS = parseInt(process.env.DAILY_MONITOR_INTERVAL_MS, 10) || 24 * 60 * 60 * 1000;

export class DailyHealthScheduler {
  constructor(options = {}) {
    this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 3000;
    this.auditLogPath = options.auditLogPath || DEFAULT_AUDIT_LOG;
    this.lockFilePath = options.lockFilePath || DEFAULT_LOCK_FILE;
    this.monitorOptions = options.monitorOptions || { checkLiveGigs: true };
    this.unrefTimer = options.unrefTimer || false;

    this.timer = null;
    this.isActive = false;
    this.isCycleRunning = false;
    this.lastRunAt = null;
    this.nextRunAt = null;
    this.runsCompleted = 0;
    this.lastError = null;
  }

  /**
   * Acquires file lock for multi-process concurrency protection
   * @returns {boolean} true if acquired, false if already locked
   */
  acquireLock() {
    if (this.isCycleRunning) {
      return false; // In-memory mutex
    }

    try {
      const lockDir = path.dirname(this.lockFilePath);
      if (!fs.existsSync(lockDir)) {
        fs.mkdirSync(lockDir, { recursive: true });
      }

      // Check if lock file exists and is still fresh (< 2 hours)
      if (fs.existsSync(this.lockFilePath)) {
        try {
          const content = JSON.parse(fs.readFileSync(this.lockFilePath, 'utf8'));
          const lockAgeMs = Date.now() - new Date(content.timestamp).getTime();
          if (lockAgeMs < 2 * 60 * 60 * 1000) {
            console.warn(`[Scheduler] Active lock detected (PID: ${content.pid}, age: ${Math.round(lockAgeMs / 1000)}s). Skipping overlapping cycle.`);
            return false;
          }
          console.warn('[Scheduler] Found stale lockfile; overriding.');
        } catch {
          // Unparseable lock file, safe to overwrite
        }
      }

      fs.writeFileSync(this.lockFilePath, JSON.stringify({
        pid: process.pid,
        timestamp: new Date().toISOString()
      }, null, 2));

      this.isCycleRunning = true;
      return true;
    } catch (err) {
      console.warn('[Scheduler] Could not acquire lock file:', err.message);
      this.isCycleRunning = true;
      return true; // Fall back to in-memory mutex
    }
  }

  /**
   * Releases process lock file
   */
  releaseLock() {
    this.isCycleRunning = false;
    try {
      if (fs.existsSync(this.lockFilePath)) {
        fs.unlinkSync(this.lockFilePath);
      }
    } catch (err) {
      console.warn('[Scheduler] Notice releasing lock file:', err.message);
    }
  }

  /**
   * Appends execution result to audit log file
   * @param {object} record
   */
  recordAudit(record) {
    try {
      const dir = path.dirname(this.auditLogPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let entries = [];
      if (fs.existsSync(this.auditLogPath)) {
        try {
          entries = JSON.parse(fs.readFileSync(this.auditLogPath, 'utf8'));
          if (!Array.isArray(entries)) entries = [];
        } catch {
          entries = [];
        }
      }

      entries.push(record);
      // Keep last 100 audit entries
      if (entries.length > 100) {
        entries = entries.slice(-100);
      }

      fs.writeFileSync(this.auditLogPath, JSON.stringify(entries, null, 2));
    } catch (err) {
      console.warn('[Scheduler] Notice recording audit log:', err.message);
    }
  }

  /**
   * Executes a single monitoring cycle with retry and overlap protection
   * @returns {Promise<object>} cycle results
   */
  async executeCycle() {
    if (!this.acquireLock()) {
      return { skipped: true, reason: 'Cycle already in progress (overlap protection active)' };
    }

    const startTime = Date.now();
    let attempt = 0;
    let summary = null;
    let lastError = null;

    try {
      while (attempt <= this.maxRetries) {
        attempt++;
        try {
          console.info(`[Scheduler] Starting monitoring run (attempt ${attempt}/${this.maxRetries + 1})...`);
          summary = await runHealthMonitoringCycle({
            ...this.monitorOptions,
            checkLiveGigs: true
          });
          lastError = null;
          break; // Success!
        } catch (err) {
          lastError = err;
          console.warn(`[Scheduler] Attempt ${attempt} failed: ${err.message}`);
          if (attempt <= this.maxRetries) {
            const backoff = this.retryDelayMs * Math.pow(2, attempt - 1);
            console.info(`[Scheduler] Retrying in ${backoff}ms...`);
            await new Promise(r => setTimeout(r, backoff));
          }
        }
      }

      const durationMs = Date.now() - startTime;
      const now = new Date().toISOString();
      this.lastRunAt = now;
      this.runsCompleted++;

      const auditRecord = {
        cycle_number: this.runsCompleted,
        executed_at: now,
        duration_ms: durationMs,
        success: !lastError,
        error: lastError ? lastError.message : null,
        summary: summary || null
      };

      this.recordAudit(auditRecord);

      if (lastError) {
        this.lastError = lastError.message;
        console.error('[Scheduler] Cycle failed after all retries:', lastError.message);
      } else {
        this.lastError = null;
        console.info(`[Scheduler] Cycle ${this.runsCompleted} completed successfully in ${durationMs}ms.`);
      }

      return {
        success: !lastError,
        summary,
        durationMs,
        runsCompleted: this.runsCompleted
      };
    } finally {
      this.releaseLock();
      if (this.isActive) {
        this.nextRunAt = new Date(Date.now() + this.intervalMs).toISOString();
      }
    }
  }

  /**
   * Starts the recurring schedule timer
   * @param {boolean} runImmediately
   */
  start(runImmediately = true) {
    if (this.isActive) {
      console.warn('[Scheduler] Daily scheduler is already active.');
      return;
    }

    this.isActive = true;
    this.nextRunAt = new Date(Date.now() + this.intervalMs).toISOString();
    console.info(`[Scheduler] Activated. Daily interval: ${this.intervalMs}ms. Next scheduled run: ${this.nextRunAt}`);

    if (runImmediately) {
      this.executeCycle().catch(err => {
        console.error('[Scheduler] Initial cycle error:', err);
      });
    }

    this.timer = setInterval(() => {
      this.executeCycle().catch(err => {
        console.error('[Scheduler] Scheduled cycle error:', err);
      });
    }, this.intervalMs);

    // Only unref timer if explicitly configured (e.g. lightweight background tasks)
    if (this.unrefTimer && this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stops the schedule timer and releases locks
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isActive = false;
    this.releaseLock();
    console.info('[Scheduler] Stopped.');
  }

  /**
   * Returns current operational status
   * @returns {object}
   */
  getStatus() {
    return {
      isActive: this.isActive,
      isCycleRunning: this.isCycleRunning,
      intervalMs: this.intervalMs,
      lastRunAt: this.lastRunAt,
      nextRunAt: this.nextRunAt,
      runsCompleted: this.runsCompleted,
      lastError: this.lastError
    };
  }
}

// Global default scheduler instance
export const defaultScheduler = new DailyHealthScheduler();

// CLI Execution Daemon
const isDirectCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectCli) {
  console.log('====================================================');
  console.log(' UpShift — Automated Daily Health Scheduler Daemon');
  console.log(` Interval: ${DEFAULT_INTERVAL_MS}ms (${Math.round(DEFAULT_INTERVAL_MS / 3600000)} hours)`);
  console.log('====================================================');

  const scheduler = new DailyHealthScheduler();

  const handleShutdown = () => {
    console.log('\n[Scheduler] Graceful shutdown initiated...');
    scheduler.stop();
    process.exit(0);
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);

  scheduler.start(true);
}
