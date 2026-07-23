/**
 * Edge Function: cloud-sync-cron
 *
 * Scheduled fan-out for the cloud-storage sync. Lists every project with a
 * mapped cloud folder and re-runs cloud-sync-project for each, so linked
 * Dropbox/Drive/OneDrive files stay current without anyone clicking "Sync
 * now". Intended to be driven by pg_cron (see migration 00148):
 *
 *   SELECT cron.schedule('cloud-sync-poll', '*\/15 * * * *', $$ ... net.http_post(.../cloud-sync-cron) $$);
 *
 * Each per-project run is delegated over HTTP to cloud-sync-project (reusing
 * its rev-compare, versioning and diagnostics logic). Runs are sequential to
 * stay friendly to provider rate limits and the 150s edge wall-clock cap;
 * MAX_PROJECTS bounds a single tick. cloud-sync-project walks the whole
 * folder tree (metadata-only) and budgets downloads per invocation; when it
 * reports `remaining > 0` we immediately re-invoke for that project (up to
 * MAX_LEGS) so backlogs converge within a tick where time allows — anything
 * left after that is picked up by the next 15-min tick.
 *
 * Authorization: Bearer <service_role_key>
 *
 * Response:
 *   { projects: number, ok: number, failed: number, capped: boolean,
 *     results: Array<{ projectId, ok, error? }> }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireServiceRole } from '../_shared/auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Upper bound on projects synced per tick. With a 15-min cadence and dedup-
// by-rev (unchanged files cost one metadata listing), this comfortably keeps
// a healthy org's folders current. Raise once a job-queue chunker lands.
const MAX_PROJECTS = 100

// Re-invocations per project within one tick when the download budget left a
// backlog (`remaining > 0`). Bounded so one huge folder can't eat the tick.
const MAX_LEGS = 3

// Stop starting new work once this much of the tick's 150s wall clock is
// spent — the remainder lands on the next tick instead of getting killed.
const TICK_TIME_BUDGET_MS = 100_000

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  // Service-role gate — prove the caller holds the service-role secret
  // (decoded JWT role claims are forgeable under --no-verify-jwt).
  const authError = requireServiceRole(req)
  if (authError) return authError

  // Forward the CALLER's (already-verified) Authorization header to the
  // per-project delegated calls. Rebuilding it from the runtime env does NOT
  // work: the edge runtime injects SUPABASE_SERVICE_ROLE_KEY in the new
  // `sb_secret_…` format, which is not a JWT, so cloud-sync-project's
  // requireServiceRole (JWT role-claim check) 403s it — first observed on
  // the very first cron tick 2026-07-23 17:15 UTC (4/4 projects Forbidden).
  const forwardAuth = req.headers.get('Authorization')!

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Projects with a complete cloud mapping.
  const { data: projects, error } = await supabase
    .schema('projects')
    .from('projects')
    .select('id')
    .not('cloud_storage_connection_id', 'is', null)
    .not('cloud_storage_folder_id', 'is', null)
    .limit(MAX_PROJECTS + 1)
  if (error) return json({ error: `list projects failed: ${error.message}` }, 500)

  const rows = (projects ?? []) as Array<{ id: string }>
  const capped = rows.length > MAX_PROJECTS
  const batch = rows.slice(0, MAX_PROJECTS)
  if (capped) {
    // Visible in edge-function logs; pg_cron discards the HTTP response body.
    console.warn(
      `cloud-sync-cron: ${rows.length} mapped projects exceeds MAX_PROJECTS=${MAX_PROJECTS}; ` +
        `${rows.length - MAX_PROJECTS} not synced this tick.`,
    )
  }

  const results: Array<{ projectId: string; ok: boolean; error?: string }> = []
  let ok = 0
  let failed = 0
  const tickStart = Date.now()

  for (const p of batch) {
    if (Date.now() - tickStart > TICK_TIME_BUDGET_MS) {
      console.warn('cloud-sync-cron: tick time budget spent; remaining projects roll to next tick')
      break
    }
    try {
      // Delegate to cloud-sync-project. No callerUserId → it attributes
      // inserts to the connection's connected_by. trigger:'cron' tags the
      // diagnostics row. Loop legs while the download budget left a backlog.
      for (let leg = 0; leg < MAX_LEGS; leg++) {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/cloud-sync-project`, {
          method: 'POST',
          headers: {
            Authorization: forwardAuth,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ projectId: p.id, trigger: 'cron' }),
        })
        if (!res.ok) {
          const body = await res.text()
          throw new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`)
        }
        const summary = (await res.json()) as { remaining?: number; alreadyRunning?: boolean }
        if (
          !summary.remaining ||
          summary.alreadyRunning ||
          Date.now() - tickStart > TICK_TIME_BUDGET_MS
        ) {
          break
        }
      }
      ok++
      results.push({ projectId: p.id, ok: true })
    } catch (e) {
      failed++
      const msg = e instanceof Error ? e.message : String(e)
      results.push({ projectId: p.id, ok: false, error: msg.slice(0, 200) })
    }
  }

  return json({ projects: batch.length, ok, failed, capped, results }, 200)
})

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
