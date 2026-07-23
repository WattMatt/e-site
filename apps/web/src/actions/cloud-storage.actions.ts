'use server'

/**
 * Cloud-storage server actions — start the OAuth flow, disconnect a
 * connection, browse cloud folders, save the per-project mapping.
 *
 * Token exchange happens in /api/auth/cloud-callback (route handler)
 * because it has to handle the GET redirect from the provider; server
 * actions can't be invoked from a browser navigation.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  ALL_PROVIDERS,
  MARKUP_WRITE_ROLES,
  getCloudStorageProvider,
  signOAuthState,
  type CloudItem,
  type ProviderName,
} from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { disconnectCloudConnection } from '@/services/cloud-storage.server'
import {
  clearProjectCloudFolder,
  listCloudFolder,
  setProjectCloudFolder,
} from '@/services/cloud-storage-folder.server'

const REDIRECT_PATH = '/api/auth/cloud-callback'

function siteUrl(): string {
  // OAuth redirect URI host resolution:
  //
  // 1. On NON-PRODUCTION Vercel deploys (preview / development), prefer
  //    VERCEL_BRANCH_URL — the stable per-branch alias — so a preview
  //    deploy's "Connect" callback lands on THAT preview, not on
  //    production-aliased lilac. Without this, every preview-branch test
  //    of an OAuth flow bounces to production and 404s if production is
  //    behind on the relevant route handler.
  //
  // 2. On PRODUCTION deploys, use the explicit NEXT_PUBLIC_SITE_URL (the
  //    production hostname registered with each provider as the canonical
  //    redirect URI).
  //
  // 3. Fallbacks for local dev / scripts / build-time codepaths.
  //
  // The redirect URI MUST be one of those registered with each provider's
  // OAuth app. Register BOTH the production host AND the branch alias on
  // each provider — see docs/cloud-storage-oauth-setup-roadmap.md §2-§4.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    if (process.env.VERCEL_BRANCH_URL) return `https://${process.env.VERCEL_BRANCH_URL}`
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  }
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'https://esite-lilac.vercel.app'
}

/**
 * Start an OAuth flow for the given provider. Returns the auth URL the
 * caller should redirect the browser to. Caller is responsible for the
 * actual redirect (server action returns are JSON; the calling component
 * does `window.location.href = result.authUrl`).
 *
 * Throws if the user has no active org membership (i.e., they're an
 * orphan account that hasn't been onboarded).
 */
export async function startCloudOAuthAction(
  provider: ProviderName,
): Promise<{ authUrl: string }> {
  if (!ALL_PROVIDERS.includes(provider)) {
    throw new Error(`Unsupported provider: ${provider}`)
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  if (!mem) throw new Error('No active organisation membership')

  const state = await signOAuthState({
    uid: user.id,
    orgId: (mem as { organisation_id: string }).organisation_id,
    provider,
  })
  const redirectUri = `${siteUrl()}${REDIRECT_PATH}`
  const authUrl = getCloudStorageProvider(provider).buildAuthUrl({
    state,
    redirectUri,
  })
  return { authUrl }
}

/**
 * Disconnect a cloud-storage connection. Calls the provider's revoke
 * endpoint (best-effort) and deletes the local row. Triggers
 * /settings/integrations revalidation.
 */
export async function disconnectCloudConnectionAction(
  connectionId: string,
): Promise<{ ok: true }> {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) {
    throw new Error('Invalid connection id')
  }
  const supabase = await createClient()
  await disconnectCloudConnection(connectionId, supabase)
  revalidatePath('/settings/integrations')
  return { ok: true }
}

/**
 * Browse a folder on the connected provider. Returns child items (folders +
 * files). Used by the <CloudFolderPicker /> tree.
 */
export async function listCloudFolderAction(args: {
  connectionId: string
  folderId: string | null
  pageToken?: string
}): Promise<{ items: CloudItem[]; nextPageToken?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(args.connectionId)) {
    throw new Error('Invalid connection id')
  }
  const supabase = await createClient()
  return listCloudFolder(args, supabase)
}

/**
 * Save (or replace) the per-project folder mapping. UI calls this after
 * the user picks a folder from the tree.
 *
 * Role enforcement: this action does NOT check the caller's org role
 * directly. It relies on RLS on `projects.projects` (migration 00009
 * "PMs and above can manage projects") to gate UPDATEs to
 * `owner / admin / project_manager`. A field worker or client_viewer
 * calling this will receive a 403 from PostgREST. If you ever change
 * the projects-table RLS, revisit this action and add an app-side check.
 */
export async function setProjectCloudFolderAction(args: {
  projectId: string
  connectionId: string
  folderId: string
  folderPath?: string
  defaultTarget?: 'drawings' | 'documents'
}): Promise<{ ok: true }> {
  if (args.defaultTarget && args.defaultTarget !== 'drawings' && args.defaultTarget !== 'documents') {
    throw new Error('Invalid default target')
  }
  const supabase = await createClient()
  await setProjectCloudFolder(args, supabase)
  revalidatePath(`/projects/${args.projectId}`)
  revalidatePath(`/projects/${args.projectId}/floor-plans`)
  revalidatePath(`/projects/${args.projectId}/documents`)
  return { ok: true }
}

/**
 * Remove the per-project folder mapping (e.g. user wants to revert to
 * local-only uploads).
 */
export async function clearProjectCloudFolderAction(
  projectId: string,
): Promise<{ ok: true }> {
  const supabase = await createClient()
  await clearProjectCloudFolder(projectId, supabase)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/floor-plans`)
  revalidatePath(`/projects/${projectId}/documents`)
  return { ok: true }
}

/**
 * One sync invocation's counters, as returned by the cloud-sync-project
 * edge function (rewritten 2026-07-23 — metadata-first walk + download
 * budget; see docs/superpowers/specs/2026-07-23-floor-plan-sync-freshness.md).
 */
export interface CloudSyncSummary {
  sent: number
  updated: number
  newVersions: number
  adopted: number
  renamed: number
  removed: number
  skipped: number
  failed: number
  filesSeen: number
  downloads: number
  remaining: number
  walkComplete: boolean
  alreadyRunning: boolean
  classified: { floor_plans: number; documents: number }
  intent: 'drawings' | 'documents' | 'auto'
  errors?: string[]
}

/** Legs per action call. The engine downloads ≤20 files per leg; 6 legs
 * (120 files) clears any realistic backlog in one click/tab-open; anything
 * bigger converges across the 15-min cron ticks. */
const MAX_SYNC_LEGS = 6

/** A folder checked within this window is "fresh" — opening the tab again
 * doesn't re-trigger a provider walk. */
const AUTO_SYNC_MAX_AGE_MS = 5 * 60_000

/**
 * The caller must at least be able to SEE the project (RLS on
 * projects.projects returns no row otherwise). Both sync triggers write
 * with the service key downstream, so this app-side gate is what keeps
 * random signed-in outsiders from syncing arbitrary project ids — the
 * same class of gap PR #135 closed on the tenant-schedule routes.
 */
async function requireVisibleProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<{
  userId: string
  lastSyncAt: string | null
  mapped: boolean
}> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('id, cloud_storage_connection_id, cloud_storage_folder_id, cloud_storage_last_sync_at')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) throw new Error('Project not found')
  return {
    userId: user.id,
    lastSyncAt: (project as any).cloud_storage_last_sync_at ?? null,
    mapped:
      Boolean((project as any).cloud_storage_connection_id) &&
      Boolean((project as any).cloud_storage_folder_id),
  }
}

/**
 * Coerce one edge-function response into a fully-populated summary. Written
 * defensively against the PREVIOUS engine's response shape (no adopted /
 * remaining / alreadyRunning fields) so the brief deploy gap between the web
 * release and the edge-function release degrades to a single well-formed
 * leg instead of NaN counters and a 6-leg runaway loop.
 */
function normalizeLeg(raw: Partial<CloudSyncSummary>): CloudSyncSummary {
  return {
    sent: raw.sent ?? 0,
    updated: raw.updated ?? 0,
    newVersions: raw.newVersions ?? 0,
    adopted: raw.adopted ?? 0,
    renamed: raw.renamed ?? 0,
    removed: raw.removed ?? 0,
    skipped: raw.skipped ?? 0,
    failed: raw.failed ?? 0,
    filesSeen: raw.filesSeen ?? 0,
    downloads: raw.downloads ?? 0,
    remaining: raw.remaining ?? 0,
    walkComplete: raw.walkComplete ?? false,
    alreadyRunning: raw.alreadyRunning ?? false,
    classified: {
      floor_plans: raw.classified?.floor_plans ?? 0,
      documents: raw.classified?.documents ?? 0,
    },
    intent: raw.intent ?? 'auto',
    errors: raw.errors,
  }
}

async function invokeSyncLegs(args: {
  projectId: string
  callerUserId?: string
  intent?: 'drawings' | 'documents'
  trigger: 'manual' | 'auto'
}): Promise<CloudSyncSummary> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  let total: CloudSyncSummary | null = null
  for (let leg = 0; leg < MAX_SYNC_LEGS; leg++) {
    const res = await fetch(`${supabaseUrl}/functions/v1/cloud-sync-project`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId: args.projectId,
        callerUserId: args.callerUserId,
        intent: args.intent,
        trigger: args.trigger,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`sync failed (HTTP ${res.status}): ${body.slice(0, 300)}`)
    }
    const leg_ = normalizeLeg((await res.json()) as Partial<CloudSyncSummary>)
    if (!total) {
      total = leg_
    } else {
      total.sent += leg_.sent
      total.updated += leg_.updated
      total.newVersions += leg_.newVersions
      total.adopted += leg_.adopted
      total.renamed += leg_.renamed
      total.removed += leg_.removed
      // Snapshot, not sum: the last leg's skipped is the folder's unchanged
      // count (files downloaded by earlier legs re-skip in later legs).
      total.skipped = leg_.skipped
      total.failed += leg_.failed
      total.filesSeen = leg_.filesSeen
      total.downloads += leg_.downloads
      total.remaining = leg_.remaining
      total.walkComplete = leg_.walkComplete
      total.classified.floor_plans += leg_.classified.floor_plans
      total.classified.documents += leg_.classified.documents
      if (leg_.errors?.length) (total.errors ??= []).push(...leg_.errors)
    }
    // A leg-2+ alreadyRunning means someone else took over mid-backlog; the
    // first leg's counts (kept in `total`) still describe real pulled work.
    if (leg_.alreadyRunning || !(leg_.remaining > 0)) break
  }
  return total!
}

/**
 * Trigger a sync of the project's mapped cloud folder. Loops the edge
 * function while it reports a download backlog (`remaining > 0`), so one
 * "Sync now" click brings the whole folder current. Idempotent.
 *
 * Gate: any project-visible member may sync (it pulls from the folder an
 * admin mapped; no caller content is involved) — see docs/rbac-matrix.md.
 */
export async function syncProjectCloudFolderAction(
  projectId: string,
  intent?: 'drawings' | 'documents',
): Promise<CloudSyncSummary> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) {
    throw new Error('Invalid project id')
  }
  if (intent && intent !== 'drawings' && intent !== 'documents') {
    throw new Error('Invalid intent')
  }
  const supabase = await createClient()
  const { userId, mapped } = await requireVisibleProject(supabase, projectId)
  if (!mapped) throw new Error('Project has no cloud folder mapped')

  const result = await invokeSyncLegs({
    projectId,
    callerUserId: userId,
    intent,
    trigger: 'manual',
  })
  revalidatePath(`/projects/${projectId}/floor-plans`)
  revalidatePath(`/projects/${projectId}/documents`)
  return result
}

/**
 * Freshness status for the toolbar's auto-check chip.
 */
export type AutoSyncOutcome =
  | { status: 'unmapped' }
  | { status: 'fresh'; lastSyncAt: string | null }
  | { status: 'already_running' }
  | { status: 'reauth_required' }
  | { status: 'synced'; summary: CloudSyncSummary }
  | { status: 'error'; message: string }

/**
 * Stale-while-revalidate trigger fired when a user opens the floor-plans /
 * documents tab. The tab renders instantly from the DB; this action then
 * checks the mapped folder IF the last completed check is older than
 * AUTO_SYNC_MAX_AGE_MS. In-flight dedupe lives in the edge function (a
 * 'running' cloud_sync_runs row younger than 3 min short-circuits
 * non-manual triggers).
 *
 * Never throws for expected conditions — the chip needs a status, not an
 * exception. Gate: project visibility (read-only members deserve fresh
 * data too).
 */
export async function autoSyncCloudFolderAction(
  projectId: string,
): Promise<AutoSyncOutcome> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) {
    return { status: 'error', message: 'Invalid project id' }
  }
  try {
    const supabase = await createClient()
    const { lastSyncAt, mapped } = await requireVisibleProject(supabase, projectId)
    if (!mapped) return { status: 'unmapped' }

    if (lastSyncAt && Date.now() - Date.parse(lastSyncAt) < AUTO_SYNC_MAX_AGE_MS) {
      return { status: 'fresh', lastSyncAt }
    }

    // Deliberately NO intent (which tab happened to be open must not decide
    // where new files are filed — the engine uses the mapping's persisted
    // default target / heuristic) and NO callerUserId (imports triggered by
    // merely opening a tab are attributed to the integration's connector,
    // not to whoever walked past).
    const summary = await invokeSyncLegs({
      projectId,
      trigger: 'auto',
    })
    if (summary.alreadyRunning) return { status: 'already_running' }

    const changed =
      summary.sent + summary.updated + summary.newVersions + summary.adopted +
      summary.renamed + summary.removed > 0
    if (changed) {
      revalidatePath(`/projects/${projectId}/floor-plans`)
      revalidatePath(`/projects/${projectId}/documents`)
    }
    return { status: 'synced', summary }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Sync check failed'
    // The engine fails fast with this phrase when the connection is flagged
    // needs_reauth. Distinct status so read-only members (who can't see
    // org_storage_connections under RLS) get the calm "paused" chip instead
    // of a red error on every tab open.
    if (message.includes('needs re-authentication')) {
      return { status: 'reauth_required' }
    }
    return { status: 'error', message }
  }
}

/**
 * Adopt the latest synced revision of a drawing as its active file. The sync
 * never moves the active file on its own (markup / snag pins / calibration are
 * pinned to the active version's geometry), so this is the explicit user
 * "migrate" step behind the "Newer version available" badge.
 *
 * Existing annotations remain attached to the drawing; the user is warned in
 * the UI that pins may shift if the new revision's geometry differs.
 *
 * RLS-gated: the UPDATE on tenants.floor_plans is governed by the existing
 * floor_plans policies, so a caller without manage rights gets a 403.
 */
export async function updateFloorPlanToLatestAction(
  floorPlanId: string,
  projectId: string,
): Promise<{ ok: true }> {
  if (!/^[0-9a-f-]{36}$/i.test(floorPlanId) || !/^[0-9a-f-]{36}$/i.test(projectId)) {
    throw new Error('Invalid id')
  }
  const supabase = await createClient()
  // App-layer gate matching the UI's canWrite. RLS alone is NOT a reliable
  // gate here: a restrictive-policy-blocked UPDATE returns 0 rows with NO
  // error (PostgREST silent-zero-rows), which would read as success.
  const gate = await requireEffectiveRole(supabase as any, projectId, MARKUP_WRITE_ROLES)
  if (!gate.ok) throw new Error(gate.error)
  await adoptLatestRevision(supabase as any, floorPlanId)

  revalidatePath(`/projects/${projectId}/floor-plans`)
  revalidatePath(`/projects/${projectId}/floor-plans/${floorPlanId}`)
  return { ok: true }
}

/**
 * Bulk form of updateFloorPlanToLatest: adopt the latest synced revision on
 * EVERY drawing in the project currently flagged has_newer_version. Backs
 * the "Update all" banner on the floor-plans tab. Per-drawing failures
 * don't abort the rest — they're reported back for the flash.
 *
 * Gated like the single action (MARKUP_WRITE_ROLES, matching the banner's
 * canWrite); adoptLatestRevision additionally verifies the UPDATE touched a
 * row, so an RLS-blocked write can't masquerade as success.
 */
export async function updateAllFloorPlansToLatestAction(
  projectId: string,
): Promise<{ updated: number; failed: number; errors?: string[] }> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) {
    throw new Error('Invalid project id')
  }
  const supabase = await createClient()
  const gate = await requireEffectiveRole(supabase as any, projectId, MARKUP_WRITE_ROLES)
  if (!gate.ok) throw new Error(gate.error)
  const db = supabase as any

  const { data: flagged, error: listErr } = await db
    .schema('tenants')
    .from('floor_plans')
    .select('id')
    .eq('project_id', projectId)
    .eq('has_newer_version', true)
    .eq('is_active', true)
  if (listErr) throw new Error(`Failed to list flagged drawings: ${listErr.message}`)

  let updated = 0
  let failed = 0
  const errors: string[] = []
  for (const row of (flagged ?? []) as Array<{ id: string }>) {
    try {
      await adoptLatestRevision(db, row.id)
      updated++
    } catch (e) {
      failed++
      errors.push(e instanceof Error ? e.message.slice(0, 160) : 'unknown')
    }
  }

  revalidatePath(`/projects/${projectId}/floor-plans`)
  return { updated, failed, errors: errors.length ? errors : undefined }
}

/**
 * Shared adopt step: move a drawing's active file to its latest synced
 * revision. Columns/tables added in migration 00148 aren't in generated
 * types yet — callers pass the client casted to `any`.
 */
async function adoptLatestRevision(db: any, floorPlanId: string): Promise<void> {
  const { data: fp, error: fpErr } = await db
    .schema('tenants')
    .from('floor_plans')
    .select('id, latest_revision_id')
    .eq('id', floorPlanId)
    .single()
  if (fpErr || !fp) throw new Error(`Drawing not found: ${fpErr?.message ?? 'no row'}`)
  if (!fp.latest_revision_id) throw new Error('No newer version to apply')

  const { data: ver, error: verErr } = await db
    .schema('tenants')
    .from('floor_plan_versions')
    .select('file_path, file_size_bytes, source_revision_id')
    .eq('floor_plan_id', floorPlanId)
    .eq('source_revision_id', fp.latest_revision_id)
    .single()
  if (verErr || !ver) throw new Error(`Latest version not found: ${verErr?.message ?? 'no row'}`)

  const { data: touched, error: udErr } = await db
    .schema('tenants')
    .from('floor_plans')
    .update({
      file_path: ver.file_path,
      file_size_bytes: ver.file_size_bytes,
      source_revision_id: ver.source_revision_id,
      synced_at: new Date().toISOString(),
      has_newer_version: false,
    })
    .eq('id', floorPlanId)
    .select('id')
  if (udErr) throw new Error(`Failed to apply version: ${udErr.message}`)
  // RLS-blocked updates return 0 rows with no error — surface that instead
  // of silently reporting success.
  if (!touched || touched.length === 0) {
    throw new Error('Update blocked — you may not have write access to this drawing')
  }
}
