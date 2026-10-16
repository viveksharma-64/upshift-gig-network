/**
 * Candidate Repository
 * Persistent storage abstraction for AI-discovered gig candidates.
 *
 * Canonical Staging Table: public.gig_candidates
 *
 * Provides:
 * 1. SupabaseCandidateRepository - Production-grade persistent Supabase storage
 *    operating against public.gig_candidates.
 * 2. JsonCandidateRepository (CandidateRepository) - Local development / test
 *    filesystem adapter operating against data/candidates.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { supabase as defaultClient } from '../lib/supabase.js';
import { CANDIDATE_STATUS, createCandidate } from '../discovery/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'candidates.json');

/** Canonical staging table name across migrations, repository, and UI */
export const GIG_CANDIDATES_TABLE = 'gig_candidates';

/** Canonical list of all intended persistent columns in public.gig_candidates */
export const CANDIDATE_DB_COLUMNS = Object.freeze([
  'id',
  'source_name',
  'source_type',
  'source_listing_id',
  'original_url',
  'canonical_url',
  'application_url',
  'title',
  'organization',
  'description',
  'responsibilities',
  'requirements',
  'payment_amount',
  'min_amount',
  'max_amount',
  'currency',
  'compensation_type',
  'location',
  'work_arrangement',
  'posted_date',
  'deadline',
  'first_discovered_at',
  'last_checked_at',
  'track_id',
  'matched_modules',
  'module_fit_scores',
  'module_evidence',
  'activity_status',
  'activity_confidence',
  'activity_evidence',
  'activity_reason',
  'module_fit_score',
  'source_reliability',
  'data_completeness',
  'review_priority',
  'duplicate_cluster_id',
  'is_duplicate',
  'duplicate_of',
  'llm_provider',
  'llm_model',
  'llm_evaluation',
  'referral_id',
  'referral_url',
  'referral_required',
  'referral_history',
  'last_health_check_at',
  'health_check_error',
  'status',
  'admin_notes',
  'rejection_reason',
  'reviewed_by',
  'reviewed_at',
  'published_gig_id',
  'updated_at'
]);

/**
 * Non-breaking, optional extension columns that may be omitted during an upsert
 * if the remote database has not yet applied the latest schema migration.
 * Core listing fields (id, title, source_name, organization, track_id, status, etc.)
 * must NEVER be omitted, and will fail fast with an actionable error.
 */
export const OPTIONAL_COMPATIBILITY_COLUMNS = Object.freeze(new Set([
  'health_check_error',
  'last_health_check_at',
  'referral_id',
  'referral_url',
  'referral_required',
  'referral_history'
]));

/**
 * Initializes a secure server-side Supabase client.
 * Uses SUPABASE_SERVICE_ROLE_KEY if available on the server runtime,
 * falling back to anon key. Never exposed to browser bundle.
 * @returns {object} SupabaseClient
 */
export function getServerSupabaseClient() {
  const url = (typeof process !== 'undefined' && (process.env?.SUPABASE_URL || process.env?.VITE_SUPABASE_URL)) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL);
  const serviceKey = typeof process !== 'undefined' ? process.env?.SUPABASE_SERVICE_ROLE_KEY : null;
  const anonKey = (typeof process !== 'undefined' && (process.env?.SUPABASE_ANON_KEY || process.env?.VITE_SUPABASE_ANON_KEY)) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY);

  if (url && serviceKey) {
    return createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  if (url && anonKey) {
    return createClient(url, anonKey);
  }
  return defaultClient;
}

/**
 * Normalizes a candidate model for insertion or upsert into public.gig_candidates
 * @param {object} candidate
 * @returns {object} DB row object
 */
export function formatCandidateForDb(candidate) {
  return {
    id: candidate.id,
    source_name: candidate.source_name || 'unknown_source',
    source_type: candidate.source_type || 'fixture',
    source_listing_id: candidate.source_listing_id || null,
    original_url: candidate.original_url || '',
    canonical_url: candidate.canonical_url || candidate.original_url || '',
    application_url: candidate.application_url || '',
    title: (candidate.title || '').trim(),
    organization: (candidate.organization || 'Undisclosed Organization').trim(),
    description: candidate.description || '',
    responsibilities: candidate.responsibilities || '',
    requirements: candidate.requirements || '',
    payment_amount: candidate.payment_amount || 'Unspecified',
    min_amount: parseFloat(candidate.min_amount) || 0,
    max_amount: parseFloat(candidate.max_amount) || 0,
    currency: candidate.currency || 'USD',
    compensation_type: candidate.compensation_type || 'hourly',
    location: candidate.location || 'Remote',
    work_arrangement: candidate.work_arrangement || 'remote',
    posted_date: candidate.posted_date || null,
    deadline: candidate.deadline || null,
    first_discovered_at: candidate.first_discovered_at || new Date().toISOString(),
    last_checked_at: candidate.last_checked_at || new Date().toISOString(),
    track_id: candidate.track_id || 'M3',
    matched_modules: Array.isArray(candidate.matched_modules) ? candidate.matched_modules : ['M3'],
    module_fit_scores: candidate.module_fit_scores || {},
    module_evidence: candidate.module_evidence || {},
    activity_status: candidate.activity_status || 'uncertain',
    activity_confidence: parseInt(candidate.activity_confidence, 10) || 50,
    activity_evidence: Array.isArray(candidate.activity_evidence) ? candidate.activity_evidence : [],
    activity_reason: candidate.activity_reason || '',
    module_fit_score: parseInt(candidate.module_fit_score, 10) || 50,
    source_reliability: parseInt(candidate.source_reliability, 10) || 80,
    data_completeness: parseInt(candidate.data_completeness, 10) || 70,
    review_priority: parseInt(candidate.review_priority, 10) || 60,
    duplicate_cluster_id: candidate.duplicate_cluster_id || null,
    is_duplicate: Boolean(candidate.is_duplicate),
    duplicate_of: candidate.duplicate_of || null,
    llm_provider: candidate.llm_provider || null,
    llm_model: candidate.llm_model || null,
    llm_evaluation: candidate.llm_evaluation || null,
    referral_id: candidate.referral_id || '',
    referral_url: candidate.referral_url || '',
    referral_required: Boolean(candidate.referral_required),
    referral_history: Array.isArray(candidate.referral_history) ? candidate.referral_history : [],
    last_health_check_at: candidate.last_health_check_at || null,
    health_check_error: candidate.health_check_error || null,
    status: candidate.status || CANDIDATE_STATUS.PENDING_REVIEW,
    admin_notes: candidate.admin_notes || '',
    rejection_reason: candidate.rejection_reason || null,
    reviewed_by: candidate.reviewed_by || null,
    reviewed_at: candidate.reviewed_at || null,
    published_gig_id: candidate.published_gig_id || null,
    updated_at: new Date().toISOString()
  };
}

/**
 * Supabase-backed Candidate Repository (Production Target)
 * Directly interacts with public.gig_candidates staging table.
 */
export class SupabaseCandidateRepository {
  constructor(client = null, tableName = GIG_CANDIDATES_TABLE) {
    this.client = client || getServerSupabaseClient();
    this.tableName = tableName;
  }

  /**
   * Validates database storage connectivity
   * @returns {Promise<boolean>}
   */
  async ensureStorage() {
    try {
      const { error } = await this.client
        .from(this.tableName)
        .select('id')
        .limit(1);
      return !error;
    } catch {
      return false;
    }
  }

  /**
   * Retrieves all candidates with optional filtering
   * @param {object} [filters]
   * @returns {Promise<Array<object>>}
   */
  async getAll(filters = {}) {
    try {
      let query = this.client
        .from(this.tableName)
        .select('*');

      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }
      if (filters.track_id && filters.track_id !== 'all') {
        query = query.eq('track_id', filters.track_id);
      }
      if (filters.activity_status && filters.activity_status !== 'all') {
        query = query.eq('activity_status', filters.activity_status);
      }

      query = query.order('review_priority', { ascending: false });

      const { data, error } = await query;
      if (error) {
        console.warn(`[SupabaseCandidateRepository] Query error: ${error.message}`);
        return [];
      }
      return Array.isArray(data) ? data.map(createCandidate) : [];
    } catch (err) {
      console.warn(`[SupabaseCandidateRepository] Error retrieving candidates: ${err.message}`);
      return [];
    }
  }

  /**
   * Retrieves single candidate by ID
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async getById(id) {
    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) return null;
      return createCandidate(data);
    } catch {
      return null;
    }
  }

  /**
   * Saves or updates a batch of candidates idempotently into public.gig_candidates.
   * Preserves existing admin review decisions (approved/rejected) on re-ingestion.
   *
   * @param {Array<object>} newCandidates
   * @returns {Promise<{ inserted: number, updated: number, total: number }>}
   */
  async saveBatch(newCandidates) {
    if (!newCandidates || newCandidates.length === 0) {
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true });
      return { inserted: 0, updated: 0, total: count || 0 };
    }

    const ids = newCandidates.map(c => c.id);
    let existingMap = new Map();

    try {
      const preferredCols = 'id, status, admin_notes, rejection_reason, reviewed_by, reviewed_at, published_gig_id, first_discovered_at, referral_id, referral_url, referral_required, referral_history, llm_provider, llm_model, llm_evaluation';
      let { data: existingRows, error: selectErr } = await this.client
        .from(this.tableName)
        .select(preferredCols)
        .in('id', ids);

      if (selectErr && /Could not find the '([^']+)' column of 'gig_candidates' in the schema cache/i.test(selectErr.message)) {
        // Fallback to core columns if newly added columns are not yet in the schema cache
        const coreCols = 'id, status, admin_notes, rejection_reason, reviewed_by, reviewed_at, published_gig_id, first_discovered_at, llm_provider, llm_model, llm_evaluation';
        const fallbackRes = await this.client
          .from(this.tableName)
          .select(coreCols)
          .in('id', ids);
        existingRows = fallbackRes.data;
      }

      if (Array.isArray(existingRows)) {
        existingMap = new Map(existingRows.map(r => [r.id, r]));
      }
    } catch {
      // If table query fails, continue with empty existing map
    }

    // Deduplicate records by ID within the batch to prevent PostgreSQL error:
    // "ON CONFLICT DO UPDATE command cannot affect row a second time"
    const batchMap = new Map();

    for (const item of newCandidates) {
      if (!item) continue;
      const formatted = formatCandidateForDb(item);
      if (!formatted.id) continue;

      const inBatch = batchMap.get(formatted.id);
      const existing = existingMap.get(formatted.id);
      const prev = inBatch || existing;

      if (prev) {
        const isDefaultReingestion = formatted.status === CANDIDATE_STATUS.PENDING_REVIEW && prev.status !== CANDIDATE_STATUS.PENDING_REVIEW;
        const targetStatus = isDefaultReingestion ? prev.status : (formatted.status || prev.status);
        batchMap.set(formatted.id, {
          ...prev,
          ...formatted,
          status: targetStatus,
          admin_notes: prev.admin_notes || formatted.admin_notes,
          rejection_reason: prev.rejection_reason || formatted.rejection_reason,
          reviewed_by: prev.reviewed_by || formatted.reviewed_by,
          reviewed_at: prev.reviewed_at || formatted.reviewed_at,
          published_gig_id: prev.published_gig_id || formatted.published_gig_id,
          first_discovered_at: prev.first_discovered_at || formatted.first_discovered_at,
          last_checked_at: new Date().toISOString(),
          referral_id: prev.referral_id || formatted.referral_id || '',
          referral_url: prev.referral_url || formatted.referral_url || '',
          referral_required: prev.referral_required !== undefined ? prev.referral_required : formatted.referral_required,
          referral_history: (Array.isArray(prev.referral_history) && prev.referral_history.length > 0)
            ? prev.referral_history
            : (formatted.referral_history || []),
          llm_provider: formatted.llm_provider || prev.llm_provider,
          llm_model: formatted.llm_model || prev.llm_model,
          llm_evaluation: formatted.llm_evaluation || prev.llm_evaluation,
          updated_at: new Date().toISOString()
        });
      } else {
        batchMap.set(formatted.id, {
          ...formatted,
          status: CANDIDATE_STATUS.PENDING_REVIEW,
          updated_at: new Date().toISOString()
        });
      }
    }

    const recordsToUpsert = Array.from(batchMap.values());
    let inserted = 0;
    let updated = 0;
    for (const rec of recordsToUpsert) {
      if (existingMap.has(rec.id)) updated++;
      else inserted++;
    }

    let records = recordsToUpsert;
    let { error: upsertErr } = await this.client
      .from(this.tableName)
      .upsert(records, { onConflict: 'id' });

    // Defensive schema cache recovery:
    // Only non-breaking, optional extension columns (OPTIONAL_COMPATIBILITY_COLUMNS)
    // may be omitted during an upsert if the database has not yet applied the latest migration.
    // Required and core listing fields (id, title, organization, status, track_id, etc.)
    // MUST NEVER be discarded, and will fail fast with an actionable error.
    const omittedColumns = new Set();
    while (upsertErr && /Could not find the '([^']+)' column of '[^']+' in the schema cache/i.test(upsertErr.message)) {
      const match = upsertErr.message.match(/Could not find the '([^']+)' column of '[^']+' in the schema cache/i);
      const missingColumn = match ? match[1] : null;
      if (!missingColumn || omittedColumns.has(missingColumn)) break;

      // Refuse to silently discard any required or core listing column
      if (!OPTIONAL_COMPATIBILITY_COLUMNS.has(missingColumn)) {
        throw new Error(
          `[SupabaseCandidateRepository] Upsert failed: Required column '${missingColumn}' is missing from '${this.tableName}' schema cache. Refusing to omit required data. Apply pending database migrations.`
        );
      }

      omittedColumns.add(missingColumn);
      console.warn(`[SupabaseCandidateRepository] Schema cache notice: Optional extension column '${missingColumn}' not found in database. Retrying upsert without this optional field. Run migration 20261015000001_gig_candidates_health_and_referrals.sql to persist this field.`);

      records = records.map(row => {
        const copy = { ...row };
        delete copy[missingColumn];
        return copy;
      });

      const retryResult = await this.client
        .from(this.tableName)
        .upsert(records, { onConflict: 'id' });
      upsertErr = retryResult.error;
    }

    if (upsertErr) {
      throw new Error(`[SupabaseCandidateRepository] Upsert failed: ${upsertErr.message}`);
    }

    let total = recordsToUpsert.length;
    try {
      const { count } = await this.client
        .from(this.tableName)
        .select('*', { count: 'exact', head: true });
      if (typeof count === 'number') total = count;
    } catch {}

    const result = { inserted, updated, total };
    if (omittedColumns.size > 0) {
      result.omittedColumns = Array.from(omittedColumns);
    }
    return result;
  }

  /**
   * Saves or updates a single candidate
   * @param {object} candidate
   * @returns {Promise<{ inserted: number, updated: number, total: number }>}
   */
  async save(candidate) {
    return this.saveBatch([candidate]);
  }

  /**
   * Updates review decision for a candidate (Approve, Reject, Duplicate, Needs Recheck)
   * @param {string} id
   * @param {object} updateData
   * @returns {Promise<object|null>}
   */
  async updateReviewStatus(id, { status, admin_notes, rejection_reason, reviewed_by, published_gig_id }) {
    const updatePayload = {
      updated_at: new Date().toISOString(),
      reviewed_at: new Date().toISOString()
    };
    if (status) updatePayload.status = status;
    if (admin_notes !== undefined) updatePayload.admin_notes = admin_notes;
    if (rejection_reason !== undefined) updatePayload.rejection_reason = rejection_reason;
    if (reviewed_by) updatePayload.reviewed_by = reviewed_by;
    if (published_gig_id) updatePayload.published_gig_id = published_gig_id;

    const { data, error } = await this.client
      .from(this.tableName)
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`[SupabaseCandidateRepository] updateReviewStatus failed: ${error.message}`);
    }
    return data ? createCandidate(data) : null;
  }
}

/**
 * File-backed candidate repository (Development & Local Test Adapter)
 * Persists to data/candidates.json
 */
export class JsonCandidateRepository {
  constructor(filePath = DATA_FILE) {
    this.filePath = filePath;
    this.memoryCache = null;
  }

  /**
   * Ensures data directory and JSON file exist
   */
  async ensureStorage() {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      try {
        await fs.access(this.filePath);
      } catch {
        await fs.writeFile(this.filePath, JSON.stringify([], null, 2), 'utf8');
      }
    } catch (err) {
      console.warn('[JsonCandidateRepository] Storage initialization notice:', err.message);
    }
  }

  /**
   * Loads all candidates from storage
   * @param {object} [filters]
   * @returns {Promise<Array<object>>}
   */
  async getAll(filters = {}) {
    await this.ensureStorage();
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      let candidates = JSON.parse(raw);
      if (!Array.isArray(candidates)) candidates = [];

      if (filters.status && filters.status !== 'all') {
        candidates = candidates.filter(c => c.status === filters.status);
      }
      if (filters.track_id && filters.track_id !== 'all') {
        candidates = candidates.filter(c => c.track_id === filters.track_id);
      }
      if (filters.activity_status && filters.activity_status !== 'all') {
        candidates = candidates.filter(c => c.activity_status === filters.activity_status);
      }

      candidates.sort((a, b) => (b.review_priority || 0) - (a.review_priority || 0));
      this.memoryCache = candidates;
      return candidates;
    } catch {
      return this.memoryCache || [];
    }
  }

  /**
   * Retrieves single candidate by ID
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async getById(id) {
    const all = await this.getAll();
    return all.find(c => c.id === id) || null;
  }

  /**
   * Saves or updates a batch of candidates idempotently
   * @param {Array<object>} newCandidates
   * @returns {Promise<{ inserted: number, updated: number, total: number }>}
   */
  async saveBatch(newCandidates) {
    await this.ensureStorage();
    const existing = await this.getAll();
    const map = new Map(existing.map(c => [c.id, c]));

    let inserted = 0;
    let updated = 0;

    for (const item of newCandidates) {
      const candidate = createCandidate(item);
      if (map.has(candidate.id)) {
        const prev = map.get(candidate.id);
        const isDefaultReingestion = candidate.status === CANDIDATE_STATUS.PENDING_REVIEW && prev.status !== CANDIDATE_STATUS.PENDING_REVIEW;
        const targetStatus = isDefaultReingestion ? prev.status : candidate.status;
        const merged = {
          ...candidate,
          status: targetStatus,
          admin_notes: prev.admin_notes || candidate.admin_notes,
          rejection_reason: prev.rejection_reason || candidate.rejection_reason,
          reviewed_by: prev.reviewed_by,
          reviewed_at: prev.reviewed_at,
          published_gig_id: prev.published_gig_id,
          first_discovered_at: prev.first_discovered_at,
          last_checked_at: new Date().toISOString(),
          referral_id: prev.referral_id || candidate.referral_id || '',
          referral_url: prev.referral_url || candidate.referral_url || '',
          referral_required: prev.referral_required !== undefined ? prev.referral_required : Boolean(candidate.referral_required),
          referral_history: (Array.isArray(prev.referral_history) && prev.referral_history.length > 0)
            ? prev.referral_history
            : (candidate.referral_history || []),
          llm_provider: candidate.llm_provider || prev.llm_provider,
          llm_model: candidate.llm_model || prev.llm_model,
          llm_evaluation: candidate.llm_evaluation || prev.llm_evaluation
        };
        map.set(candidate.id, merged);
        updated++;
      } else {
        map.set(candidate.id, candidate);
        inserted++;
      }
    }

    const updatedList = Array.from(map.values());
    await fs.writeFile(this.filePath, JSON.stringify(updatedList, null, 2), 'utf8');
    this.memoryCache = updatedList;

    return { inserted, updated, total: updatedList.length };
  }

  /**
   * Saves or updates a single candidate
   * @param {object} candidate
   * @returns {Promise<{ inserted: number, updated: number, total: number }>}
   */
  async save(candidate) {
    return this.saveBatch([candidate]);
  }

  /**
   * Updates candidate review status
   * @param {string} id
   * @param {object} updateData
   * @returns {Promise<object|null>}
   */
  async updateReviewStatus(id, { status, admin_notes, rejection_reason, reviewed_by, published_gig_id }) {
    await this.ensureStorage();
    const all = await this.getAll();
    const idx = all.findIndex(c => c.id === id);
    if (idx === -1) return null;

    const candidate = all[idx];
    candidate.status = status || candidate.status;
    if (admin_notes !== undefined) candidate.admin_notes = admin_notes;
    if (rejection_reason !== undefined) candidate.rejection_reason = rejection_reason;
    if (reviewed_by) candidate.reviewed_by = reviewed_by;
    if (published_gig_id) candidate.published_gig_id = published_gig_id;
    candidate.reviewed_at = new Date().toISOString();

    all[idx] = candidate;
    await fs.writeFile(this.filePath, JSON.stringify(all, null, 2), 'utf8');
    this.memoryCache = all;

    return candidate;
  }
}

/** Backward-compatible alias for existing unit tests and scripts */
export const CandidateRepository = JsonCandidateRepository;

/** Default repositories */
export const defaultCandidateRepository = new JsonCandidateRepository();
export const defaultSupabaseCandidateRepository = new SupabaseCandidateRepository();

/**
 * Factory helper to construct repository by storage adapter type
 * @param {'supabase'|'json'} [type]
 * @param {object} [options]
 * @returns {SupabaseCandidateRepository|JsonCandidateRepository}
 */
export function createCandidateRepository(type = 'json', options = {}) {
  if (type === 'supabase') {
    return new SupabaseCandidateRepository(options.client, options.tableName || GIG_CANDIDATES_TABLE);
  }
  return new JsonCandidateRepository(options.filePath || DATA_FILE);
}
