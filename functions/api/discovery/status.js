/**
 * Cloudflare Pages Function: GET /api/discovery/status
 *
 * Exposes sanitized operational status and schedule observability.
 * Security controls:
 * 1. Requires verified administrator authentication (authoritative token + profile role)
 * 2. Never exposes sensitive environment variables or tokens
 * 3. Supports polling specific job_id or aggregate system status
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

  // 3. Strict Admin Role Verification via public.profiles (Fix 5)
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

  // 4. Check if a specific job_id was requested
  try {
    const urlObj = new URL(request.url);
    const targetJobId = urlObj.searchParams.get('job_id') || urlObj.searchParams.get('jobId');

    if (targetJobId) {
      const jobRes = await fetch(`${supabaseUrl}/rest/v1/discovery_jobs?id=eq.${encodeURIComponent(targetJobId)}&select=*`, {
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'apikey': serviceKey
        }
      });

      if (jobRes.ok) {
        const matched = await jobRes.json();
        if (Array.isArray(matched) && matched.length > 0) {
          const j = matched[0];
          return new Response(JSON.stringify({
            success: true,
            job: {
              id: j.id,
              trigger_type: j.trigger_type,
              job_type: j.job_type,
              status: j.status,
              created_at: j.created_at,
              started_at: j.started_at,
              completed_at: j.completed_at,
              result_summary: j.result_summary,
              error_message: j.error_message
            }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      return new Response(JSON.stringify({ error: 'Job not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 5. Fetch operational aggregate metrics
    const jobsRes = await fetch(`${supabaseUrl}/rest/v1/discovery_jobs?select=*&order=created_at.desc&limit=5`, {
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey
      }
    });
    const jobs = jobsRes.ok ? await jobsRes.json() : [];

    const lastDiscovery = jobs.find(j => j.job_type === 'discovery') || null;
    const lastHealthCheck = jobs.find(j => j.job_type === 'health_check') || null;

    // Published gigs counts
    const gigsRes = await fetch(`${supabaseUrl}/rest/v1/gigs?select=status`, {
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey
      }
    });
    const gigs = gigsRes.ok ? await gigsRes.json() : [];

    const counts = { active: 0, paused: 0, stopped: 0, needs_review: 0 };
    if (Array.isArray(gigs)) {
      for (const g of gigs) {
        const st = (g.status || 'Active').toLowerCase();
        if (st === 'active') counts.active++;
        else if (st === 'paused') counts.paused++;
        else if (st === 'stopped') counts.stopped++;
        else if (st.includes('review')) counts.needs_review++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      last_discovery: lastDiscovery ? {
        id: lastDiscovery.id,
        trigger_type: lastDiscovery.trigger_type,
        status: lastDiscovery.status,
        created_at: lastDiscovery.created_at,
        completed_at: lastDiscovery.completed_at,
        result_summary: lastDiscovery.result_summary,
        error_message: lastDiscovery.error_message
      } : null,
      last_health_check: lastHealthCheck ? {
        id: lastHealthCheck.id,
        trigger_type: lastHealthCheck.trigger_type,
        status: lastHealthCheck.status,
        created_at: lastHealthCheck.created_at,
        completed_at: lastHealthCheck.completed_at,
        result_summary: lastHealthCheck.result_summary,
        error_message: lastHealthCheck.error_message
      } : null,
      next_schedules: {
        daily_health_check: {
          cron: '0 2 * * *',
          utc_time: '02:00 UTC daily',
          description: 'Daily automated opportunity and source health verification'
        },
        discovery_cycle: {
          cron: '0 */12 * * *',
          utc_time: '00:00 & 12:00 UTC (every 12 hours)',
          description: 'Automated candidate discovery across permitted feeds and APIs'
        }
      },
      published_gig_metrics: counts
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Internal server error processing status request.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
