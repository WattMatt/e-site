/**
 * ─────────────────────────────────────────────────────────────────────────────
 * RECOVERED SOURCE — this file was never committed.
 * ─────────────────────────────────────────────────────────────────────────────
 * `notify-entity` was deployed to project cbskbnvvgcybmfikxgky on 2026-06-24
 * (v3) and has no commit anywhere in this repository's history:
 *
 *     git log --all -- apps/edge-functions/supabase/functions/notify-entity
 *     (no output)
 *
 * What follows was extracted on 2026-09-11 from the DEPLOYED bundle
 * (`GET /v1/projects/{ref}/functions/notify-entity/body`, an ESZIP2.3 archive),
 * so it is the deployed reality rather than someone's local copy. It is checked
 * in verbatim, deliberately: a "tidied" commit would recreate the exact drift
 * this repo has been bitten by twice (eft-invoice sat on an April build whose
 * guard the repo had and the bundle did not). Fix defects in later commits, so
 * the diff that changes behaviour is visible as a diff.
 *
 * Consequences of it being a bundle rather than the original:
 *   * TypeScript annotations were stripped by the deploy transpiler. The logic
 *     is byte-faithful; the types are gone and were not invented back.
 *   * `apps/edge-functions` is outside every tsconfig and lint project in this
 *     monorepo, so this compiles nowhere in CI. Deno typechecks it on deploy.
 *
 * ⚠ KNOWN DEFECT, NOT FIXED HERE — `notify-core.ts` authenticates its calls to
 * `send-notification` and `send-email` with `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
 * read from the edge runtime, which injects that value in the `sb_secret_…`
 * format. That is not a JWT, so both callees answer 401 at the gateway and the
 * fan-out silently does nothing — identical to the 2026-07-23 cloud-sync-cron
 * failure, whose fix was to forward the caller's own Authorization header.
 * The calls are best-effort and swallow their errors, so nothing reports it.
 * `edge-function-jwt.contract.test.ts` does not catch this because it scans
 * only each function's `index.ts`, and this pattern lives in `notify-core.ts`.
 *
 * AUTH — audited 2026-09-11, and NOT the forgeable kind. This function does not
 * import `_shared/auth.ts`. It calls `auth.getUser()`, which validates the token
 * against GoTrue over the network, then authorises per-entity: the named row
 * must exist, belong to the named project, and have been created by the caller.
 * Probed live against the deployment (non-mutating, all rejected before any DB
 * access): a self-made unsigned `{"role":"service_role"}` token → 401, the
 * genuine anon key → 401, no Authorization header → 401.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * Edge Function: notify-entity
 *
 * Mobile-facing roster notifications for field-entity creation (snag + diary).
 *
 * Mobile holds only an `authenticated` JWT and no service-role key, so it can't
 * resolve the live project roster or invoke the service-role `send-email` /
 * `send-notification` functions directly (the web server path does this inline).
 * After a successful insert the mobile app fire-and-forgets a call here with the
 * user's access token; this function:
 *   1. VERIFIES the caller via auth.getUser() (validates the JWT against GoTrue,
 *      not just a base64 decode — deployed with --no-verify-jwt like the others),
 *   2. AUTHORISES that the caller created the entity it names (re-reads the row
 *      with the service role and checks project_id + raised_by/created_by), then
 *   3. runs the same bell + email fan-out the web path runs (notify-core, a
 *      mirror of packages/shared/src/notify/notify-entity-created.ts).
 *
 * Request:  { module: 'snag' | 'diary', entityId: uuid, projectId: uuid }
 * Auth:     Authorization: Bearer <user access_token>
 *
 * Best-effort: auth/authorisation failures return 4xx; a downstream notification
 * failure still returns 200 so it never surfaces to the mobile create flow.
 */ import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifySnagCreatedRoster, notifyDiaryCreatedRoster } from './notify-core.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://app.e-site.live';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json'
    }
  });
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: CORS
  });
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({
    error: 'Unauthorized'
  }, 401);
  // Verify the caller — validates the token against GoTrue, returning the real
  // user. Stronger than the decode-only role check the other functions use.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: {
      headers: {
        Authorization: authHeader
      }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({
    error: 'Unauthorized'
  }, 401);
  let body;
  try {
    body = await req.json();
  } catch  {
    return json({
      error: 'Invalid JSON body'
    }, 400);
  }
  const { module, entityId, projectId } = body;
  if (!entityId || !projectId || module !== 'snag' && module !== 'diary') {
    return json({
      error: 'module (snag|diary), entityId and projectId are required'
    }, 400);
  }
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
  const deps = {
    svc,
    fetch: (url, init)=>fetch(url, init),
    supabaseUrl: SUPABASE_URL,
    serviceKey: SERVICE_ROLE_KEY,
    siteUrl: SITE_URL
  };
  try {
    if (module === 'snag') {
      const { data: snag } = await svc.schema('field').from('snags').select('id, project_id, raised_by, title, priority, assigned_to').eq('id', entityId).maybeSingle();
      // Authorise: entity exists, belongs to projectId, raised by the caller.
      if (!snag || snag.project_id !== projectId || snag.raised_by !== user.id) {
        return json({
          error: 'Forbidden'
        }, 403);
      }
      await notifySnagCreatedRoster(deps, {
        snagId: snag.id,
        projectId: snag.project_id,
        title: snag.title,
        priority: snag.priority,
        dueDate: null,
        assigneeId: snag.assigned_to ?? null,
        raiserId: snag.raised_by
      });
    } else {
      const { data: entry } = await svc.schema('projects').from('site_diary_entries').select('id, project_id, created_by, entry_date, progress_notes').eq('id', entityId).maybeSingle();
      if (!entry || entry.project_id !== projectId || entry.created_by !== user.id) {
        return json({
          error: 'Forbidden'
        }, 403);
      }
      await notifyDiaryCreatedRoster(deps, {
        entryId: entry.id,
        projectId: entry.project_id,
        entryDate: entry.entry_date,
        progressNotes: entry.progress_notes ?? '',
        authorId: entry.created_by
      });
    }
  } catch (e) {
    // Best-effort: a fan-out failure must not surface to the mobile create flow.
    console.error('[notify-entity] fan-out failed', {
      module,
      entityId,
      err: String(e)
    });
  }
  return json({
    ok: true
  });
});
