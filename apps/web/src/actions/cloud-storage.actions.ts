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
  getCloudStorageProvider,
  signOAuthState,
  type CloudItem,
  type ProviderName,
} from '@esite/shared'
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
}): Promise<{ ok: true }> {
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
 * Trigger a bulk sync of the project's mapped cloud folder. Calls the
 * cloud-sync-project edge function (service-role) and returns the per-
 * file counts. Idempotent — re-runs skip already-imported files.
 *
 * UI calls this from the "Sync now" button on the project drawings /
 * documents tabs. Counts get displayed as a flash. Phase 2 polish: poll
 * job-status table for long syncs that exceed the edge-function timeout.
 */
export async function syncProjectCloudFolderAction(
  projectId: string,
  intent?: 'drawings' | 'documents',
): Promise<{
  sent: number
  updated: number
  newVersions: number
  skipped: number
  failed: number
  classified: { floor_plans: number; documents: number }
  intent: 'drawings' | 'documents' | 'auto'
  errors?: string[]
}> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) {
    throw new Error('Invalid project id')
  }
  if (intent && intent !== 'drawings' && intent !== 'documents') {
    throw new Error('Invalid intent')
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/cloud-sync-project`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId, callerUserId: user.id, intent, trigger: 'manual' }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`sync failed (HTTP ${res.status}): ${body.slice(0, 300)}`)
  }
  const result = (await res.json()) as Awaited<
    ReturnType<typeof syncProjectCloudFolderAction>
  >
  revalidatePath(`/projects/${projectId}/floor-plans`)
  revalidatePath(`/projects/${projectId}/documents`)
  return result
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
  // Columns/tables added in migration 00148 aren't in generated types yet.
  const db = supabase as any

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

  const { error: udErr } = await db
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
  if (udErr) throw new Error(`Failed to apply version: ${udErr.message}`)

  revalidatePath(`/projects/${projectId}/floor-plans`)
  revalidatePath(`/projects/${projectId}/floor-plans/${floorPlanId}`)
  return { ok: true }
}
