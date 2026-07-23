import 'server-only'

import { decryptToken, encryptToken } from '@esite/db'
import {
  CloudStorageError,
  getCloudStorageProvider,
  type CloudItem,
  type ProviderName,
  type TokenBundle,
} from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side helpers for browsing a cloud folder + saving a per-project
 * mapping. Tokens are decrypted in-memory; on access-token expiry the
 * helper transparently refreshes (and re-encrypts the new pair into the
 * connection row before retrying).
 */

interface ConnectionRow {
  id: string
  provider: ProviderName
  organisation_id: string
  access_token_enc: string
  refresh_token_enc: string
  expires_at: string | null
}

interface ListFolderArgs {
  connectionId: string
  folderId: string | null
  pageToken?: string
}

export interface ListFolderResult {
  items: CloudItem[]
  nextPageToken?: string
}

/**
 * Browse a folder on the connected provider. Returns child items (folders +
 * files) for the picker UI. RLS gates which connections are visible to the
 * caller — any active org member can browse.
 */
export async function listCloudFolder(
  args: ListFolderArgs,
  supabase: SupabaseClient,
): Promise<ListFolderResult> {
  const conn = await loadConnection(args.connectionId, supabase)
  const accessToken = await getActiveAccessToken(conn, supabase)
  const provider = getCloudStorageProvider(conn.provider)
  try {
    return await provider.listFolder({
      folderId: args.folderId,
      accessToken,
      pageToken: args.pageToken,
    })
  } catch (e) {
    if (e instanceof CloudStorageError && e.status === 401) {
      // Mid-list expiry — refresh once and retry.
      const fresh = await refreshAndPersist(conn, supabase)
      return await provider.listFolder({
        folderId: args.folderId,
        accessToken: fresh,
        pageToken: args.pageToken,
      })
    }
    throw e
  }
}

interface SetMappingArgs {
  projectId: string
  connectionId: string
  folderId: string
  folderPath?: string
  /** Which tab the mapping was created from — persisted as the project's
   * default classification target for cron/auto-triggered syncs. */
  defaultTarget?: 'drawings' | 'documents'
}

export async function setProjectCloudFolder(
  args: SetMappingArgs,
  supabase: SupabaseClient,
): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(args.projectId) || !/^[0-9a-f-]{36}$/i.test(args.connectionId)) {
    throw new Error('Invalid project or connection id')
  }
  // projects.projects lives in the `projects` schema (not public). Without the
  // schema('projects') chain, supabase-js targets public.projects which either
  // doesn't exist or doesn't have the cloud_storage_* columns — Server Components
  // render boundary catches the failure and shows the generic Next.js error.
  // Cloud storage columns aren't in packages/db/src/types.ts yet so we cast.
  const { error } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .update({
      cloud_storage_connection_id: args.connectionId,
      cloud_storage_folder_id: args.folderId,
      cloud_storage_folder_path: args.folderPath ?? null,
      cloud_storage_default_target: args.defaultTarget ?? null,
    })
    .eq('id', args.projectId)
  if (error) throw new Error(`Failed to set project folder mapping: ${error.message}`)
}

export async function clearProjectCloudFolder(
  projectId: string,
  supabase: SupabaseClient,
): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error('Invalid project id')
  const { error } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .update({
      cloud_storage_connection_id: null,
      cloud_storage_folder_id: null,
      cloud_storage_folder_path: null,
      cloud_storage_default_target: null,
    })
    .eq('id', projectId)
  if (error) throw new Error(`Failed to clear project folder mapping: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function loadConnection(
  connectionId: string,
  supabase: SupabaseClient,
): Promise<ConnectionRow> {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) throw new Error('Invalid connection id')
  const { data, error } = await supabase
    .from('org_storage_connections')
    .select('id, provider, organisation_id, access_token_enc, refresh_token_enc, expires_at')
    .eq('id', connectionId)
    .single()
  if (error || !data) {
    throw new Error(`Connection not found or not visible: ${error?.message ?? 'no row'}`)
  }
  return data as unknown as ConnectionRow
}

async function getActiveAccessToken(
  conn: ConnectionRow,
  supabase: SupabaseClient,
): Promise<string> {
  // Refresh proactively if expiry is within 60 s OR already past.
  const expMs = conn.expires_at ? Date.parse(conn.expires_at) : 0
  if (expMs && expMs - Date.now() > 60_000) {
    return decryptToken(hexToUint8(conn.access_token_enc))
  }
  return refreshAndPersist(conn, supabase)
}

async function refreshAndPersist(
  conn: ConnectionRow,
  supabase: SupabaseClient,
): Promise<string> {
  const refresh = await decryptToken(hexToUint8(conn.refresh_token_enc))
  const provider = getCloudStorageProvider(conn.provider)
  const fresh: TokenBundle = await provider.refreshTokens(refresh)
  const accessHex = uint8ToHex(await encryptToken(fresh.accessToken))
  const refreshHex = uint8ToHex(await encryptToken(fresh.refreshToken))
  const { error } = await supabase
    .from('org_storage_connections')
    .update({
      access_token_enc: accessHex,
      refresh_token_enc: refreshHex,
      expires_at: fresh.expiresAt?.toISOString() ?? null,
      scope: fresh.scope,
    })
    .eq('id', conn.id)
  if (error) {
    // Don't fail the listing — the in-memory access token is still valid for
    // this request. Just log; next call will retry the persist.
    console.error(`[cloud-storage] failed to persist refreshed tokens: ${error.message}`)
  }
  return fresh.accessToken
}

function uint8ToHex(bytes: Uint8Array): string {
  let s = '\\x'
  for (let i = 0; i < bytes.byteLength; i++) {
    s += bytes[i]!.toString(16).padStart(2, '0')
  }
  return s
}

function hexToUint8(hex: string): Uint8Array {
  const stripped = hex.startsWith('\\x') ? hex.slice(2) : hex
  if (stripped.length % 2 !== 0) throw new Error('invalid bytea hex length')
  const out = new Uint8Array(stripped.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(stripped.substr(i * 2, 2), 16)
  }
  return out
}
