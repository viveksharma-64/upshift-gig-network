/**
 * UpShift Source Registry & Health Tracker
 *
 * Implements FRD v1.0 Section 10 & 26:
 * - SRC-01: Approved external data sources (APIs, feeds, allowed job boards)
 * - SRC-02: Public / permitted sources only; no paywall or credential bypass
 * - SRC-03: Respect rate limits and robots.txt constraints
 * - SRC-05: Source health tracking (healthy, degraded, failing) and error recording
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultNotificationService } from './notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOURCES_DATA_FILE = path.resolve(__dirname, '../../data/sources.json');

export const SOURCE_HEALTH = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  FAILING: 'failing'
};

export const SOURCE_TYPE = {
  API: 'api',
  RSS: 'rss',
  FEED: 'feed',
  CRAWLER: 'crawler',
  FIXTURE: 'fixture'
};

/** Canonical default source registry */
export const DEFAULT_SOURCES = [
  {
    id: 'source_arbeitnow',
    name: 'Arbeitnow Tech & AI Jobs',
    type: SOURCE_TYPE.API,
    url: 'https://www.arbeitnow.com/api/job-board-api',
    module_focus: ['M4', 'M6'],
    access_method: 'GET JSON',
    auth_required: false,
    rate_limit_rpm: 30,
    health_status: SOURCE_HEALTH.HEALTHY,
    consecutive_errors: 0,
    total_discoveries: 0,
    last_checked_at: null,
    last_success_at: null,
    error_log: []
  },
  {
    id: 'source_remotive',
    name: 'Remotive Remote Opportunities',
    type: SOURCE_TYPE.API,
    url: 'https://remotive.com/api/remote-jobs',
    module_focus: ['M1', 'M2', 'M4', 'M5'],
    access_method: 'GET JSON',
    auth_required: false,
    rate_limit_rpm: 20,
    health_status: SOURCE_HEALTH.HEALTHY,
    consecutive_errors: 0,
    total_discoveries: 0,
    last_checked_at: null,
    last_success_at: null,
    error_log: []
  },
  {
    id: 'source_jobicy',
    name: 'Jobicy Remote Opportunities',
    type: SOURCE_TYPE.API,
    url: 'https://jobicy.com/api/v2/remote-jobs',
    module_focus: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
    access_method: 'GET JSON',
    auth_required: false,
    rate_limit_rpm: 30,
    health_status: SOURCE_HEALTH.HEALTHY,
    consecutive_errors: 0,
    total_discoveries: 0,
    last_checked_at: null,
    last_success_at: null,
    error_log: []
  },
  {
    id: 'source_weworkremotely',
    name: 'We Work Remotely Feeds',
    type: SOURCE_TYPE.RSS,
    url: 'https://weworkremotely.com/categories/remote-programming-jobs.rss',
    module_focus: ['M4', 'M6'],
    access_method: 'GET XML/RSS',
    auth_required: false,
    rate_limit_rpm: 15,
    health_status: SOURCE_HEALTH.HEALTHY,
    consecutive_errors: 0,
    total_discoveries: 0,
    last_checked_at: null,
    last_success_at: null,
    error_log: []
  },
  {
    id: 'source_workingnomads',
    name: 'Working Nomads Remote Opportunities',
    type: SOURCE_TYPE.API,
    url: 'https://www.workingnomads.com/api/exposed_jobs/',
    module_focus: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
    access_method: 'GET JSON',
    auth_required: false,
    rate_limit_rpm: 30,
    health_status: SOURCE_HEALTH.HEALTHY,
    consecutive_errors: 0,
    total_discoveries: 0,
    last_checked_at: null,
    last_success_at: null,
    error_log: []
  },
  {
    id: 'source_nodesk',
    name: 'NoDesk Remote Opportunities Feed',
    type: SOURCE_TYPE.RSS,
    url: 'https://nodesk.co/remote-jobs/index.xml',
    module_focus: ['M2', 'M4', 'M5'],
    access_method: 'GET XML/Atom',
    auth_required: false,
    rate_limit_rpm: 20,
    health_status: SOURCE_HEALTH.HEALTHY,
    consecutive_errors: 0,
    total_discoveries: 0,
    last_checked_at: null,
    last_success_at: null,
    error_log: []
  },
  {
    id: 'source_dribbble',
    name: 'Dribbble Creative & Design Jobs',
    type: SOURCE_TYPE.RSS,
    url: 'https://dribbble.com/jobs.rss',
    module_focus: ['M1', 'M2'],
    access_method: 'GET XML/RSS',
    auth_required: false,
    rate_limit_rpm: 20,
    health_status: SOURCE_HEALTH.HEALTHY,
    consecutive_errors: 0,
    total_discoveries: 0,
    last_checked_at: null,
    last_success_at: null,
    error_log: []
  },
  {
    id: 'source_remoteok',
    name: 'RemoteOK Gigs & Jobs API',
    type: SOURCE_TYPE.API,
    url: 'https://remoteok.com/api',
    module_focus: ['M1', 'M2', 'M4', 'M5', 'M6'],
    access_method: 'GET JSON',
    auth_required: false,
    rate_limit_rpm: 10,
    health_status: SOURCE_HEALTH.HEALTHY,
    consecutive_errors: 0,
    total_discoveries: 0,
    last_checked_at: null,
    last_success_at: null,
    error_log: []
  },
  {
    id: 'source_huggingface',
    name: 'Hugging Face Community & Tasks',
    type: SOURCE_TYPE.API,
    url: 'https://huggingface.co/api/spaces',
    module_focus: ['M3', 'M4', 'M6'],
    access_method: 'GET JSON',
    auth_required: false,
    rate_limit_rpm: 60,
    health_status: SOURCE_HEALTH.HEALTHY,
    consecutive_errors: 0,
    total_discoveries: 0,
    last_checked_at: null,
    last_success_at: null,
    error_log: []
  },
  {
    id: 'source_devpost',
    name: 'Devpost Hackathons & Bounties',
    type: SOURCE_TYPE.FEED,
    url: 'https://devpost.com/hackathons',
    module_focus: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
    access_method: 'GET HTML/JSON Feed',
    auth_required: false,
    rate_limit_rpm: 10,
    health_status: SOURCE_HEALTH.DEGRADED,
    consecutive_errors: 0,
    total_discoveries: 0,
    last_checked_at: null,
    last_success_at: null,
    error_log: ['Notice: Devpost web pages enforce Cloudflare protection. Headless API probe degraded.']
  },
  {
    id: 'source_kaggle',
    name: 'Kaggle Competitions & AI Datasets',
    type: SOURCE_TYPE.API,
    url: 'https://www.kaggle.com/api/v1/competitions/list',
    module_focus: ['M3'],
    access_method: 'GET JSON',
    auth_required: true,
    rate_limit_rpm: 30,
    health_status: SOURCE_HEALTH.DEGRADED,
    consecutive_errors: 0,
    total_discoveries: 0,
    last_checked_at: null,
    last_success_at: null,
    error_log: ['Requires Kaggle credentials (KAGGLE_USERNAME, KAGGLE_KEY)']
  },
  {
    id: 'source_himalayas',
    name: 'Himalayas Remote Opportunities API',
    type: SOURCE_TYPE.API,
    url: 'https://himalayas.app/jobs/api',
    module_focus: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
    access_method: 'GET JSON',
    auth_required: false,
    rate_limit_rpm: 30,
    health_status: SOURCE_HEALTH.HEALTHY,
    consecutive_errors: 0,
    total_discoveries: 0,
    last_checked_at: null,
    last_success_at: null,
    error_log: []
  },
  {
    id: 'source_weworkremotely_support',
    name: 'We Work Remotely Support & Operations',
    type: SOURCE_TYPE.RSS,
    url: 'https://weworkremotely.com/categories/remote-customer-support-jobs.rss',
    module_focus: ['M3', 'M5'],
    access_method: 'GET XML/RSS',
    auth_required: false,
    rate_limit_rpm: 15,
    health_status: SOURCE_HEALTH.HEALTHY,
    consecutive_errors: 0,
    total_discoveries: 0,
    last_checked_at: null,
    last_success_at: null,
    error_log: []
  },
  {
    id: 'source_fixture_provider',
    name: 'Local Deterministic Testing Fixtures',
    type: SOURCE_TYPE.FIXTURE,
    url: 'local://fixture_provider',
    module_focus: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
    access_method: 'Local In-Memory / File',
    auth_required: false,
    rate_limit_rpm: 1000,
    health_status: SOURCE_HEALTH.HEALTHY,
    consecutive_errors: 0,
    total_discoveries: 0,
    last_checked_at: null,
    last_success_at: null,
    error_log: []
  }
];

export class SourceRegistry {
  constructor(initialSources = DEFAULT_SOURCES) {
    this.sources = new Map();
    for (const src of initialSources) {
      this.sources.set(src.id, { ...src });
    }
  }

  /**
   * Initializes or reloads sources from disk storage
   */
  async init() {
    try {
      const content = await fs.readFile(SOURCES_DATA_FILE, 'utf8');
      const loaded = JSON.parse(content);
      if (Array.isArray(loaded)) {
        for (const item of loaded) {
          if (item?.id) {
            this.sources.set(item.id, { ...item });
          }
        }
      }
    } catch {
      // If file doesn't exist, seed with defaults
      await this.save();
    }
  }

  /**
   * Persists source registry state to disk
   */
  async save() {
    try {
      const dir = path.dirname(SOURCES_DATA_FILE);
      await fs.mkdir(dir, { recursive: true });
      const array = Array.from(this.sources.values());
      await fs.writeFile(SOURCES_DATA_FILE, JSON.stringify(array, null, 2), 'utf8');
    } catch (err) {
      console.warn('[SourceRegistry] Failed to persist sources to file:', err.message);
    }
  }

  /**
   * Returns all registered sources
   * @returns {Array<object>}
   */
  getAllSources() {
    return Array.from(this.sources.values());
  }

  /**
   * Retrieves a single source by ID
   * @param {string} id
   * @returns {object|null}
   */
  getSource(id) {
    return this.sources.get(id) || null;
  }

  /**
   * Returns only healthy or degraded sources (excludes failing)
   * @returns {Array<object>}
   */
  getHealthySources() {
    return Array.from(this.sources.values()).filter(
      s => s.health_status === SOURCE_HEALTH.HEALTHY || s.health_status === SOURCE_HEALTH.DEGRADED
    );
  }

  /**
   * Registers a new source or updates existing
   * @param {object} source
   */
  registerSource(source) {
    if (!source || !source.id) {
      throw new Error('Source must include a unique id.');
    }
    const existing = this.sources.get(source.id) || {};
    const merged = {
      health_status: SOURCE_HEALTH.HEALTHY,
      consecutive_errors: 0,
      total_discoveries: 0,
      rate_limit_rpm: 30,
      auth_required: false,
      error_log: [],
      ...existing,
      ...source,
      last_checked_at: new Date().toISOString()
    };
    this.sources.set(source.id, merged);
    return merged;
  }

  /**
   * Records a successful discovery check for a source (SRC-05)
   * @param {string} sourceId
   * @param {number} discoveredCount
   */
  recordSuccess(sourceId, discoveredCount = 0) {
    const src = this.sources.get(sourceId);
    if (!src) return;

    const prevStatus = src.health_status;
    src.health_status = SOURCE_HEALTH.HEALTHY;
    src.consecutive_errors = 0;
    src.last_checked_at = new Date().toISOString();
    src.last_success_at = new Date().toISOString();
    src.total_discoveries = (src.total_discoveries || 0) + discoveredCount;

    if (prevStatus !== SOURCE_HEALTH.HEALTHY) {
      console.info(`[SourceRegistry] Source ${sourceId} recovered to ${SOURCE_HEALTH.HEALTHY}.`);
    }
  }

  /**
   * Records a failed discovery check for a source (SRC-05)
   * Dispatches NOT-02 failure notification if health degrades to FAILING.
   * @param {string} sourceId
   * @param {string|Error} error
   */
  recordFailure(sourceId, error) {
    const src = this.sources.get(sourceId);
    if (!src) return;

    const errMsg = typeof error === 'string' ? error : error?.message || 'Unknown source error';
    src.consecutive_errors = (src.consecutive_errors || 0) + 1;
    src.last_checked_at = new Date().toISOString();

    // Health degradation threshold (SRC-05)
    if (src.consecutive_errors >= 3) {
      src.health_status = SOURCE_HEALTH.FAILING;
    } else if (src.consecutive_errors >= 1) {
      src.health_status = SOURCE_HEALTH.DEGRADED;
    }

    if (!Array.isArray(src.error_log)) src.error_log = [];
    src.error_log.unshift({
      timestamp: new Date().toISOString(),
      error: errMsg
    });
    src.error_log = src.error_log.slice(0, 20); // Keep last 20 errors

    // Emit notification event on failing degradation
    if (src.health_status === SOURCE_HEALTH.FAILING) {
      defaultNotificationService.notifySourceFailure(src, errMsg);
    }
  }

  /**
   * Validates if a target URL originates from an authorized source domain (SRC-01, SRC-02)
   * @param {string} urlString
   * @returns {boolean}
   */
  isAllowedSource(urlString) {
    if (!urlString || typeof urlString !== 'string') return false;
    if (urlString.startsWith('local://')) return true;

    try {
      const parsed = new URL(urlString);
      const host = parsed.hostname.toLowerCase();

      // Check registered source URLs
      for (const src of this.sources.values()) {
        if (src.url && src.url.startsWith('http')) {
          try {
            const srcHost = new URL(src.url).hostname.toLowerCase();
            if (host === srcHost || host.endsWith('.' + srcHost)) return true;
          } catch {}
        }
      }

      // Permitted general platforms for discovery
      const allowedDomains = [
        'arbeitnow.com',
        'remotive.com',
        'weworkremotely.com',
        'huggingface.co',
        'devpost.com',
        'kaggle.com',
        'contra.com',
        'github.com',
        'upwork.com',
        'remoteok.com'
      ];

      return allowedDomains.some(d => host === d || host.endsWith('.' + d));
    } catch {
      return false;
    }
  }
}

export const defaultSourceRegistry = new SourceRegistry();
