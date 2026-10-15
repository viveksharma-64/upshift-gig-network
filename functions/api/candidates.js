/**
 * Cloudflare Pages Function: /api/candidates
 *
 * Secure server-side candidate synchronization endpoint for the UpShift review queue.
 * Handles:
 * - GET: Retrieves staged candidates from public.gig_candidates ordered by review priority
 * - POST: Upserts candidate updates (status, review decision, notes, etc.)
 *
 * Security Controls:
 * 1. Authoritative Supabase JWT authentication
 * 2. Strict public.is_admin() role verification via public.profiles
 * 3. Service role key isolated to server environment (zero secret exposure to browser)
 * 4. Strict Content-Type: application/json for all responses (200, 401, 403, 500)
 */

export async function onRequestGet(context) {
  const { request, env } = context;

  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error: Supabase credentials not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 1. Verify Authorization header
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Missing or invalid Authorization header.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  // 2. Authoritative token verification via Supabase Auth
  let verifiedUser = null;
  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': serviceKey
      }
    });

    if (!userRes.ok) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Session invalid or expired.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    verifiedUser = await userRes.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized: Verification failed.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 3. Strict Admin Role Verification via public.profiles
  try {
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${verifiedUser.id}&select=role`, {
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey
      }
    });

    if (profileRes.ok) {
      const profiles = await profileRes.json();
      const userRole = profiles?.[0]?.role;
      if (userRole !== 'admin') {
        return new Response(JSON.stringify({ error: 'Forbidden: Administrator privileges required.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } else {
      return new Response(JSON.stringify({ error: 'Forbidden: Failed to verify administrative role.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Forbidden: Authorization check failed.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 4. Retrieve candidate records from public.gig_candidates
  try {
    const candidatesRes = await fetch(`${supabaseUrl}/rest/v1/gig_candidates?select=*&order=review_priority.desc`, {
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey
      }
    });

    if (!candidatesRes.ok) {
      const errText = await candidatesRes.text();
      return new Response(JSON.stringify({ error: `Database error querying candidates: ${errText}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await candidatesRes.json();
    return new Response(JSON.stringify(Array.isArray(data) ? data : []), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Internal server error: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error: Supabase credentials not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 1. Verify Authorization header
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Missing or invalid Authorization header.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  // 2. Authoritative token verification
  let verifiedUser = null;
  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': serviceKey
      }
    });
    if (!userRes.ok) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Session invalid or expired.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    verifiedUser = await userRes.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Unauthorized: Verification failed.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 3. Verify Admin Role
  try {
    const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${verifiedUser.id}&select=role`, {
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey
      }
    });
    if (profileRes.ok) {
      const profiles = await profileRes.json();
      if (profiles?.[0]?.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Forbidden: Administrator privileges required.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } else {
      return new Response(JSON.stringify({ error: 'Forbidden: Failed to verify administrative role.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Forbidden: Authorization check failed.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 4. Parse request payload
  let payload = null;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload in request body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const records = Array.isArray(payload) ? payload : [payload];
  if (records.length === 0) {
    return new Response(JSON.stringify({ error: 'Empty records payload.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 5. Upsert to public.gig_candidates
  try {
    const upsertRes = await fetch(`${supabaseUrl}/rest/v1/gig_candidates`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(records)
    });

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      return new Response(JSON.stringify({ error: `Database error upserting candidate: ${errText}` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ success: true, count: records.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Internal server error: ${err.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
