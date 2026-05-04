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
  // Prefer NEXT_PUBLIC_SITE_URL when configured; fall back to the Vercel-
  // production URL (esite-lilac.vercel.app) for local/preview where the
  // env may be unset. The redirect URI MUST match what's registered with
  // each provider's OAuth app — Phase 1 registrations use NEXT_PUBLIC_SITE_URL.
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
): Promise<{
  sent: number
  skipped: number
  failed: number
  classified: { floor_plans: number; documents: number }
  errors?: string[]
}> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) {
    throw new Error('Invalid project id')
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
    body: JSON.stringify({ projectId, callerUserId: user.id }),
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
