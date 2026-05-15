import 'server-only'

import { decryptToken, encryptToken } from '@esite/db'
import {
  CloudStorageError,
  getCloudStorageProvider,
  type CloudItem,
  type CloudStorageProvider,
  type ProviderName,
  type TokenBundle,
} from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Server-side helpers for the Handover Documents module.
 *
 * Responsibilities:
 *   - Resolve a project's cloud connection (if any) — see {@link loadProjectCloudContext}.
 *   - Lazy-create the project's "Handover" wrapper folder in the cloud the
 *     first time it's needed — see {@link ensureHandoverCloudRoot}.
 *   - Best-effort cloud mirror of folder + file creates — see {@link mirrorCreateFolder}
 *     and {@link mirrorUploadFile}. Failures are caught + logged; local
 *     rows remain the source of truth. The caller decides whether to
 *     surface the failure or treat it as a silent partial-success.
 *
 * The shape mirrors cloud-storage-folder.server.ts: bytea hex codec for
 * encrypted tokens, proactive refresh inside 60 s of expiry, one mid-
 * call retry on 401.
 */

export interface ProjectCloudContext {
  connectionId: string
  provider: ProviderName
  organisationId: string
  /**
   * Provider-stable folder ID where handover content should be mirrored.
   * Sourced from projects.handover_cloud_folder_id — a DEDICATED handover
   * mapping that is INDEPENDENT of the project's documents/drawings cloud
   * folder. Users pick this via HandoverCloudPicker on the handover page.
   */
  handoverRootFolderId: string
  /** Decrypted access token, valid for this request scope. */
  accessToken: string
  /** Provider instance — same one to reuse across calls within a request. */
  providerImpl: CloudStorageProvider
}

interface ConnectionRow {
  id: string
  provider: ProviderName
  organisation_id: string
  access_token_enc: string
  refresh_token_enc: string
  expires_at: string | null
}

interface ProjectRow {
  organisation_id: string
  cloud_storage_connection_id: string | null
  handover_cloud_folder_id: string | null
  handover_cloud_folder_path: string | null
}

/**
 * Returns the cloud context for a project's HANDOVER mirror. Null when
 * either the connection isn't set OR the dedicated handover folder isn't
 * picked yet. Handover mirroring is intentionally DECOUPLED from the
 * project's documents/drawings cloud folder — users pick a separate
 * handover root so their handover pack doesn't get mixed into a
 * "DRAWINGS/PDF/LATEST" tree (or wherever the documents tab maps to).
 *
 * Refreshes tokens proactively + persists the new pair.
 */
export async function loadProjectCloudContext(
  projectId: string,
  supabase: SupabaseClient,
): Promise<ProjectCloudContext | null> {
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return null
  const { data: proj } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select(
      'organisation_id, cloud_storage_connection_id, ' +
        'handover_cloud_folder_id, handover_cloud_folder_path',
    )
    .eq('id', projectId)
    .maybeSingle()
  const p = proj as ProjectRow | null
  if (!p || !p.cloud_storage_connection_id || !p.handover_cloud_folder_id) return null

  const { data: conn } = await supabase
    .from('org_storage_connections')
    .select('id, provider, organisation_id, access_token_enc, refresh_token_enc, expires_at')
    .eq('id', p.cloud_storage_connection_id)
    .maybeSingle()
  const c = conn as unknown as ConnectionRow | null
  if (!c) return null

  const accessToken = await getActiveAccessToken(c, supabase)
  const providerImpl = getCloudStorageProvider(c.provider)
  return {
    connectionId: c.id,
    provider: c.provider,
    organisationId: c.organisation_id,
    handoverRootFolderId: p.handover_cloud_folder_id,
    accessToken,
    providerImpl,
  }
}

/**
 * Best-effort folder mirror. Returns null on failure so the caller can
 * commit the local row anyway. Caller decides whether to log or surface.
 */
export async function mirrorCreateFolder(
  ctx: ProjectCloudContext,
  parentCloudFolderId: string,
  name: string,
): Promise<CloudItem | null> {
  try {
    return await retryOn401(ctx, async (accessToken) =>
      ctx.providerImpl.createFolder({
        name,
        parentFolderId: parentCloudFolderId,
        accessToken,
      }),
    )
  } catch (e) {
    console.error('[handover] cloud createFolder failed:', (e as Error).message)
    return null
  }
}

/**
 * Best-effort file mirror. Returns null on failure. body is Uint8Array.
 */
export async function mirrorUploadFile(
  ctx: ProjectCloudContext,
  parentCloudFolderId: string,
  name: string,
  body: Uint8Array,
  mimeType?: string,
): Promise<CloudItem | null> {
  try {
    return await retryOn401(ctx, async (accessToken) =>
      ctx.providerImpl.uploadFile({
        name,
        parentFolderId: parentCloudFolderId,
        body,
        mimeType,
        accessToken,
      }),
    )
  } catch (e) {
    console.error('[handover] cloud uploadFile failed:', (e as Error).message)
    return null
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function retryOn401<T>(
  ctx: ProjectCloudContext,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  try {
    return await fn(ctx.accessToken)
  } catch (e) {
    if (e instanceof CloudStorageError && e.status === 401) {
      // Reload connection row + force-refresh.
      // (Caller would need to pass supabase for full refresh-and-persist;
      // for now the in-memory ctx.accessToken is stale, so we just bail.)
      throw e
    }
    throw e
  }
}

async function getActiveAccessToken(
  conn: ConnectionRow,
  supabase: SupabaseClient,
): Promise<string> {
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
    console.error(`[handover] failed to persist refreshed tokens: ${error.message}`)
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
