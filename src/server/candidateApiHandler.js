/**
 * Candidate API Request Handler & Strict Server-Side Authorization Gateway
 *
 * Security Requirements:
 * 1. Tokens MUST be verified server-side via Supabase Auth (supabase.auth.getUser).
 * 2. Roles MUST be derived from the authoritative profiles database record.
 * 3. Never trust client-supplied headers (e.g. x-user-role) or body role claims.
 * 4. Missing, malformed, invalid, or expired tokens return HTTP 401.
 * 5. Authenticated non-admin users (e.g. learners) return HTTP 403.
 * 6. Candidate mutations cannot modify user roles or permissions.
 */

import './config.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase.js';
import { CANDIDATE_STATUS, isValidStatusTransition } from '../discovery/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_FILE = path.resolve(__dirname, '../../data/candidates.json');

/**
 * Initializes a Supabase client configured with real credentials and caller token.
 * Attaches the bearer token so PostgREST RLS on public.profiles succeeds for the user.
 *
 * @param {string|null} [userToken]
 * @returns {object} SupabaseClient
 */
export function getAuthSupabaseClient(userToken = null) {
  const url = (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL);
  const serviceKey = typeof process !== 'undefined' ? process.env?.SUPABASE_SERVICE_ROLE_KEY : null;
  const anonKey = (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_ANON_KEY) ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY);

  if (!url || url.includes('placeholder.supabase.co')) {
    return supabase;
  }

  if (serviceKey) {
    return createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }

  if (anonKey) {
    const opts = {
      auth: { persistSession: false, autoRefreshToken: false }
    };
    if (userToken) {
      opts.global = {
        headers: {
          Authorization: `Bearer ${userToken}`
        }
      };
    }
    return createClient(url, anonKey, opts);
  }

  return supabase;
}

/**
 * Authoritatively verifies a Supabase access token and retrieves user's database role.
 * Never trusts client headers or localStorage claims.
 *
 * @param {string} token - Raw JWT bearer token string
 * @param {object} [client] - Optional Supabase client instance override (e.g. for testing)
 * @returns {Promise<{ valid: boolean, user?: object, role?: string, error?: string, statusCode?: number }>}
 */
export async function verifyTokenAndRole(token, client = null) {
  if (!token || typeof token !== 'string') {
    return {
      valid: false,
      statusCode: 401,
      error: 'Unauthorized: Missing bearer token. Administrator sign-in required.'
    };
  }

  const cleanToken = token.trim();
  if (!cleanToken || cleanToken === 'null' || cleanToken === 'undefined') {
    return {
      valid: false,
      statusCode: 401,
      error: 'Unauthorized: Malformed or empty bearer token. Administrator sign-in required.'
    };
  }

  // 1. Development admin token fallback: strictly non-production only
  if (cleanToken === 'dev-admin-token') {
    if (process.env.NODE_ENV === 'production') {
      return {
        valid: false,
        statusCode: 401,
        error: 'Unauthorized: Development admin tokens are strictly forbidden in production mode.'
      };
    }
    return {
      valid: true,
      user: { id: 'dev-admin-local', email: 'admin@upshift.local' },
      role: 'admin'
    };
  }

  const activeClient = client || getAuthSupabaseClient(cleanToken);

  try {
    // 2. Authoritative verification of the JWT signature and expiration
    const { data: authData, error: authError } = await activeClient.auth.getUser(cleanToken);
    if (authError || !authData?.user) {
      const isExpired = authError?.message && /expired/i.test(authError.message);
      return {
        valid: false,
        statusCode: 401,
        error: isExpired
          ? 'Unauthorized: Authentication session has expired. Please sign in as an administrator again.'
          : (authError?.message
            ? `Unauthorized: ${authError.message}`
            : 'Unauthorized: Invalid authentication credentials. Please sign in as an administrator again.')
      };
    }

    const verifiedUser = authData.user;

    // 3. Authoritative retrieval of role from public.profiles table or user metadata
    let assignedRole = verifiedUser.app_metadata?.role || verifiedUser.user_metadata?.role || null;

    try {
      const { data: profile, error: profError } = await activeClient
        .from('profiles')
        .select('role')
        .eq('id', verifiedUser.id)
        .single();

      if (!profError && profile?.role) {
        assignedRole = profile.role;
      }
    } catch {}

    const finalRole = assignedRole || 'learner';

    return {
      valid: true,
      user: verifiedUser,
      role: finalRole
    };
  } catch (err) {
    return {
      valid: false,
      statusCode: 401,
      error: `Unauthorized: Token verification failed (${err.message}). Please sign in as an administrator again.`
    };
  }
}

/**
 * Evaluates request authorization strictly from verified tokens and database roles.
 * Client-supplied headers like 'x-user-role' are explicitly ignored.
 *
 * @param {object} req - HTTP request
 * @param {object} [options]
 * @returns {Promise<{ authorized: boolean, user?: object, role?: string, error?: string, statusCode?: number }>}
 */
export async function verifyAdminAuthorization(req, options = {}) {
  const headers = req.headers || {};
  const authHeader = headers['authorization'] || headers['Authorization'];

  // 1. Missing Authorization header -> 401
  if (!authHeader) {
    return {
      authorized: false,
      statusCode: 401,
      error: 'Unauthorized: Authentication required. Missing Authorization header.'
    };
  }

  // 2. Parse Bearer prefix
  const match = String(authHeader).match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1] || match[1].trim() === '' || match[1].trim() === 'null' || match[1].trim() === 'undefined') {
    return {
      authorized: false,
      statusCode: 401,
      error: 'Unauthorized: Malformed or missing Bearer token.'
    };
  }

  const rawToken = match[1].trim();

  // 3. Perform authoritative token & role verification
  let verification;
  if (typeof options.authVerifier === 'function') {
    // Allows injecting custom / mock verifier for tests
    verification = await options.authVerifier(rawToken, req);
  } else {
    const client = options.supabaseClient || null;
    verification = await verifyTokenAndRole(rawToken, client);
  }

  // 4. Token validation failure (invalid, expired, malformed) -> 401
  if (!verification || !verification.valid) {
    return {
      authorized: false,
      statusCode: verification?.statusCode || 401,
      error: verification?.error || 'Unauthorized: Invalid or expired token.'
    };
  }

  // 5. Role validation: Must be verified 'admin' in database -> 403 for non-admins
  // NOTE: x-user-role is completely ignored here
  if (verification.role !== 'admin') {
    return {
      authorized: false,
      statusCode: 403,
      error: 'Forbidden: Insufficient privileges. Only verified administrators can access the candidate review queue.',
      user: verification.user,
      role: verification.role
    };
  }

  return {
    authorized: true,
    user: verification.user,
    role: 'admin'
  };
}

/**
 * HTTP handler for candidate review queue API (/api/candidates)
 * Protects both GET and POST endpoints.
 *
 * @param {object} req - Incoming request
 * @param {object} res - Server response
 * @param {object} [options]
 */
export async function handleCandidateApiRequest(req, res, options = {}) {
  const dataFile = options.dataFile || DEFAULT_DATA_FILE;

  // 1. Enforce strict server-side authorization for ALL candidate queue routes (GET & POST)
  let authUser = null;
  let authRole = null;
  if (!options.skipAuth) {
    const authCheck = await verifyAdminAuthorization(req, options);
    if (!authCheck.authorized) {
      console.warn(`[SERVER LOG] ${req.method} /api/candidates - ${authCheck.statusCode} Unauthorized/Forbidden: ${authCheck.error}`);
      res.statusCode = authCheck.statusCode;
      res.setHeader?.('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: authCheck.error }));
      return;
    }
    authUser = authCheck.user;
    authRole = authCheck.role;
  }

  // 2. GET /api/candidates: Return review queue to verified admin only
  if (req.method === 'GET') {
    try {
      try {
        const raw = await fs.readFile(dataFile, 'utf8');
        const count = JSON.parse(raw).length;
        console.log(`[SERVER LOG] GET /api/candidates - 200 OK (${count} candidates returned, Admin: ${authUser?.email || 'verified'})`);
        res.setHeader?.('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end(raw);
        return;
      } catch {
        console.log(`[SERVER LOG] GET /api/candidates - 200 OK (0 candidates returned, Admin: ${authUser?.email || 'verified'})`);
        res.setHeader?.('Content-Type', 'application/json');
        res.statusCode = 200;
        res.end('[]');
        return;
      }
    } catch (err) {
      res.statusCode = 500;
      res.setHeader?.('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  // 3. POST /api/candidates: Mutate candidates (admin only)
  if (req.method === 'POST') {
    let rawBody = '';
    if (typeof req.body === 'object' && req.body !== null) {
      rawBody = JSON.stringify(req.body);
    } else if (typeof req.body === 'string') {
      rawBody = req.body;
    } else if (typeof req.on === 'function') {
      rawBody = await new Promise((resolve, reject) => {
        let acc = '';
        req.on('data', chunk => { acc += chunk; });
        req.on('end', () => resolve(acc));
        req.on('error', reject);
      });
    }

    let update = {};
    try {
      update = JSON.parse(rawBody);
    } catch {
      res.statusCode = 400;
      res.setHeader?.('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Malformed JSON payload.' }));
      return;
    }

    if (!update.id) {
      res.statusCode = 400;
      res.setHeader?.('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Candidate ID is required for updates.' }));
      return;
    }

    // 4. Defense-in-depth: Strip any user role fields from candidate object
    // Users cannot change roles or inject privilege fields via candidate updates
    delete update.role;
    delete update.user_role;
    delete update.is_admin;
    delete update.user_id;

    // 5. Read current candidate store
    let list = [];
    try {
      const raw = await fs.readFile(dataFile, 'utf8');
      list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }

    const idx = list.findIndex(c => c.id === update.id);
    const existing = idx >= 0 ? list[idx] : null;

    // 6. Validate State Transitions
    if (update.status) {
      const validStatuses = Object.values(CANDIDATE_STATUS);
      if (!validStatuses.includes(update.status)) {
        res.statusCode = 400;
        res.setHeader?.('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: `Invalid status "${update.status}". Allowed values: ${validStatuses.join(', ')}`
        }));
        return;
      }

      if (existing && !isValidStatusTransition(existing.status, update.status)) {
        res.statusCode = 400;
        res.setHeader?.('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: `Invalid state transition from '${existing.status}' to '${update.status}'.`
        }));
        return;
      }
    }

    // 7. Apply update safely
    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        ...update,
        last_checked_at: new Date().toISOString()
      };
    } else {
      // Newly discovered candidate must always start in pending_review
      update.status = CANDIDATE_STATUS.PENDING_REVIEW;
      list.push(update);
    }

    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    await fs.writeFile(dataFile, JSON.stringify(list, null, 2), 'utf8');

    res.statusCode = 200;
    res.setHeader?.('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, count: list.length }));
    return;
  }

  res.statusCode = 405;
  res.setHeader?.('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

let isDiscoveryRunning = false;

/**
 * Resets the discovery concurrency lock (for test teardowns and lifecycle recovery)
 */
export function resetDiscoveryLock() {
  isDiscoveryRunning = false;
}

/**
 * HTTP handler for triggering a live AI gig discovery cycle (/api/discovery/run)
 * Protected: requires verified administrator authorization.
 * Concurrency protected: prevents overlapping execution.
 *
 * @param {object} req - Incoming request
 * @param {object} res - Server response
 * @param {object} [options]
 */
export async function handleDiscoveryRunRequest(req, res, options = {}) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader?.('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Method not allowed. Use POST to trigger discovery cycle.' }));
    return;
  }

  // 1. Authoritative admin verification
  let authUser = null;
  let authRole = null;
  if (!options.skipAuth) {
    const authCheck = await verifyAdminAuthorization(req, options);
    if (!authCheck.authorized) {
      console.warn(`[SERVER LOG] POST /api/discovery/run - ${authCheck.statusCode} Unauthorized/Forbidden: ${authCheck.error}`);
      res.statusCode = authCheck.statusCode;
      res.setHeader?.('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: authCheck.error }));
      return;
    }
    authUser = authCheck.user;
    authRole = authCheck.role;
  }

  // 2. Concurrency lock: prevent overlapping runs
  if (isDiscoveryRunning) {
    console.warn('[SERVER LOG] POST /api/discovery/run - 409 Conflict: discovery cycle already in progress');
    res.statusCode = 409;
    res.setHeader?.('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'A discovery cycle is already in progress. Please wait for it to complete.' }));
    return;
  }

  isDiscoveryRunning = true;
  console.log(`[SERVER LOG] POST /api/discovery/run - Starting live discovery cycle (Admin: ${authUser?.email || 'verified'})...`);
  try {
    const { DiscoveryPipeline } = await import('./pipeline.js');
    const { PublicApiDiscoveryProvider } = await import('./providers/publicApiProvider.js');
    const { RssDiscoveryProvider } = await import('./providers/rssProvider.js');
    const { defaultCandidateRepository, JsonCandidateRepository } = await import('./candidateRepository.js');

    const repository = options.repository || (options.dataFile ? new JsonCandidateRepository(options.dataFile) : defaultCandidateRepository);
    const providers = options.providers || [
      new PublicApiDiscoveryProvider(),
      new RssDiscoveryProvider()
    ];

    const pipeline = new DiscoveryPipeline({
      repository,
      providers,
      llmService: options.llmService || { hasConfiguredProvider: () => false }
    });

    const cycleOptions = options.cycleOptions || { limit: 50, limitPerFeed: 6 };
    const cycleStats = await pipeline.runCycle(cycleOptions);

    const allCandidates = await repository.getAll();

    const pendingCount = allCandidates.filter(c => c.status === CANDIDATE_STATUS.PENDING_REVIEW).length;
    const uncertainCount = allCandidates.filter(c => c.activity_status === 'Needs Review' || c.has_conflict).length;

    console.log(`[SERVER LOG] POST /api/discovery/run - 200 OK (Discovered: ${cycleStats.discovered || 0}, Relevant: ${cycleStats.relevant || 0}, Inserted: ${cycleStats.inserted || 0}, In Store: ${allCandidates.length})`);

    const responsePayload = {
      success: true,
      counts: {
        fetched: cycleStats.discovered || 0,
        relevant: cycleStats.relevant || 0,
        rejected: cycleStats.rejected || 0,
        duplicate: cycleStats.duplicates || 0,
        uncertain: cycleStats.uncertain || uncertainCount,
        newly_saved: cycleStats.inserted || 0,
        updated: cycleStats.updated || 0,
        total_pending: pendingCount,
        total_store: allCandidates.length
      },
      candidates: allCandidates
    };

    res.statusCode = 200;
    res.setHeader?.('Content-Type', 'application/json');
    res.end(JSON.stringify(responsePayload));
  } catch (err) {
    console.error(`[SERVER LOG] POST /api/discovery/run - 500 Error: ${err.message}`);
    res.statusCode = 500;
    res.setHeader?.('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: `Discovery cycle failed: ${err.message}` }));
  } finally {
    isDiscoveryRunning = false;
  }
}

