/**
 * Edge Function: cloud-sync-project
 *
 * Phase 1 milestone #5 of the cloud-storage integration. Walks a project's
 * mapped cloud folder, downloads new files, classifies them as drawings
 * vs generic documents, and inserts rows into tenants.floor_plans /
 * tenants.documents. Idempotent — re-runs skip files already imported,
 * keyed by (project_id, source_provider, source_file_id) UNIQUE-WHERE
 * indexes from migration 00041.
 *
 * Request body:
 *   {
 *     projectId: string,
 *     callerUserId: string,    // for the uploaded_by audit column
 *   }
 *   Authorization: Bearer <service_role_key>
 *
 * Response:
 *   {
 *     sent: number,             // number of new rows inserted
 *     skipped: number,          // already-imported (dedup hit)
 *     failed: number,           // download or upload errors
 *     classified: { floor_plans: number; documents: number },
 *     errors?: string[],        // per-file failure messages (truncated)
 *   }
 *
 * Walks the folder tree breadth-first up to MAX_DEPTH levels, max
 * MAX_FILES files per run. Hidden folders (name starting with `.`) are
 * skipped. The function is intended to be triggered by a server action
 * ("Sync now" button) or by pg_cron (M6 — scheduled poll).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  getCloudStorageProvider,
  type CloudItem,
  type ProviderName,
  type TokenBundle,
} from '../_shared/cloud-storage/index.ts'
import { decryptToken, encryptToken } from '../_shared/encryption.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const DOCUMENTS_BUCKET = 'project-documents'
// Existing tenants.floor_plans rows store paths in the `drawings` bucket
// (created by 00012_invites_storage.sql) — we match that for cloud-synced
// drawings so the existing markup canvas + RFI annotation flows just work.
const FLOOR_PLANS_BUCKET = 'drawings'

// Depth + count limits to keep a single sync bounded.
// Supabase Edge Functions have a 150s wall-clock cap. At ~2-5s per file
// (download + upload + insert), MAX_FILES=50 leaves comfortable headroom
// even for the slow tail (large PDFs over a slow link). The user can re-
// click "Sync now" for the rest until the Phase-2 cron chunker lands —
// dedup keeps repeat runs idempotent, so re-clicking is safe and cheap.
const MAX_DEPTH = 5
const MAX_FILES = 50

// Routing heuristic — see docs/cloud-storage-integration-design.md §6.
const CAD_EXTENSIONS = new Set(['.dwg', '.dxf', '.dgn', '.rvt'])
const DRAWING_FOLDER_RE = /(^|\/)(drawings?|plans?|floor[ -]?plans?)(\/|$)/i

interface SyncRequest {
  projectId: string
  callerUserId: string
  // When set, overrides the extension+folder-name classifier so every file
  // in this run is routed to the corresponding table/bucket. Driven by
  // which tab the user clicked "Sync now" from in the web UI.
  intent?: 'drawings' | 'documents'
}

interface ProjectRow {
  id: string
  organisation_id: string
  cloud_storage_connection_id: string | null
  cloud_storage_folder_id: string | null
}

interface ConnectionRow {
  id: string
  provider: ProviderName
  organisation_id: string
  access_token_enc: string
  refresh_token_enc: string
  expires_at: string | null
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  // Service-role gate — match the send-notification pattern.
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }
  try {
    const payload = JSON.parse(atob(authHeader.slice(7).split('.')[1]!))
    if (payload.role !== 'service_role') return json({ error: 'Forbidden' }, 403)
  } catch {
    return json({ error: 'Invalid token' }, 401)
  }

  let body: SyncRequest
  try {
    body = (await req.json()) as SyncRequest
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (!body.projectId || !body.callerUserId) {
    return json({ error: 'projectId and callerUserId required' }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let result: SyncResult
  try {
    result = await syncProject(supabase, body)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return json({ error: `sync failed: ${msg}` }, 500)
  }
  return json(result, 200)
})

interface SyncResult {
  sent: number
  skipped: number
  failed: number
  classified: { floor_plans: number; documents: number }
  // Echoes the request's intent (or 'auto' when the classifier ran).
  // Diagnostic so the caller can verify intent flowed through.
  intent: 'drawings' | 'documents' | 'auto'
  errors?: string[]
}

async function syncProject(
  supabase: SupabaseClient,
  req: SyncRequest,
): Promise<SyncResult> {
  // 1. Load project + verify it has a mapping.
  const { data: project, error: pe } = await supabase
    .schema('projects')
    .from('projects')
    .select('id, organisation_id, cloud_storage_connection_id, cloud_storage_folder_id')
    .eq('id', req.projectId)
    .single()
  if (pe || !project) throw new Error(`project not found: ${pe?.message ?? 'no row'}`)
  const proj = project as unknown as ProjectRow
  if (!proj.cloud_storage_connection_id || !proj.cloud_storage_folder_id) {
    throw new Error('project has no cloud-storage folder mapped')
  }

  // 2. Load + decrypt connection. Refresh if expired.
  const { data: connRow, error: ce } = await supabase
    .from('org_storage_connections')
    .select('id, provider, organisation_id, access_token_enc, refresh_token_enc, expires_at')
    .eq('id', proj.cloud_storage_connection_id)
    .single()
  if (ce || !connRow) throw new Error(`connection not found: ${ce?.message ?? 'no row'}`)
  const conn = connRow as unknown as ConnectionRow

  let accessToken = await decryptToken(hexToUint8(conn.access_token_enc))
  const expMs = conn.expires_at ? Date.parse(conn.expires_at) : 0
  if (!expMs || expMs - Date.now() < 60_000) {
    accessToken = await refreshAndPersist(supabase, conn)
  }
  const provider = getCloudStorageProvider(conn.provider)

  // 3. BFS walk of the folder tree, collecting files up to MAX_FILES.
  interface QueueEntry { folderId: string; path: string; depth: number }
  const queue: QueueEntry[] = [
    { folderId: proj.cloud_storage_folder_id, path: '', depth: 0 },
  ]
  const files: Array<{ item: CloudItem; parentPath: string }> = []

  while (queue.length > 0 && files.length < MAX_FILES) {
    const cur = queue.shift()!
    if (cur.depth > MAX_DEPTH) continue
    let pageToken: string | undefined
    do {
      const page = await provider.listFolder({
        folderId: cur.folderId,
        accessToken,
        pageToken,
      })
      for (const item of page.items) {
        if (item.name.startsWith('.')) continue  // skip hidden
        if (item.type === 'folder') {
          queue.push({
            folderId: item.id,
            path: cur.path ? `${cur.path}/${item.name}` : item.name,
            depth: cur.depth + 1,
          })
        } else {
          files.push({ item, parentPath: cur.path })
          if (files.length >= MAX_FILES) break
        }
      }
      pageToken = page.nextPageToken
    } while (pageToken && files.length < MAX_FILES)
  }

  // 4. For each file: dedup-check, download, upload to bucket, insert row.
  const result: SyncResult = {
    sent: 0,
    skipped: 0,
    failed: 0,
    classified: { floor_plans: 0, documents: 0 },
    intent: req.intent ?? 'auto',
    errors: [],
  }

  for (const { item, parentPath } of files) {
    try {
      const target =
        req.intent === 'drawings'
          ? 'floor_plans'
          : req.intent === 'documents'
            ? 'documents'
            : classify(item, parentPath)
      const exists = await dedupCheck(supabase, target, proj.id, conn.provider, item.id)
      if (exists) {
        result.skipped++
        continue
      }
      const dl = await provider.downloadFile({ fileId: item.id, accessToken })
      const ab = await new Response(dl.body).arrayBuffer()
      // Wrap in Blob so supabase-js storage receives the canonical
      // BlobPart shape — Uint8Array works in current versions but the
      // Blob form makes intent + content-type explicit and forward-
      // compatible with future SDK changes.
      const blob = new Blob([ab], { type: dl.contentType })

      const ext = (item.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
      const bucket = target === 'floor_plans' ? FLOOR_PLANS_BUCKET : DOCUMENTS_BUCKET
      const storagePath = `${proj.organisation_id}/${proj.id}/${item.id}${ext}`

      const { error: upErr } = await supabase.storage
        .from(bucket)
        .upload(storagePath, blob, {
          contentType: dl.contentType,
          upsert: true,
        })
      if (upErr) throw new Error(`storage upload: ${upErr.message}`)

      if (target === 'floor_plans') {
        const { error: insErr } = await supabase
          .schema('tenants')
          .from('floor_plans')
          .insert({
            organisation_id: proj.organisation_id,
            project_id: proj.id,
            name: item.name,
            file_path: storagePath,
            file_size_bytes: dl.contentLength ?? blob.size,
            uploaded_by: req.callerUserId,
            source_provider: conn.provider,
            source_file_id: item.id,
            source_revision_id: item.revisionId ?? null,
            source_path: parentPath ? `${parentPath}/${item.name}` : item.name,
            synced_at: new Date().toISOString(),
            is_active: true,
          })
        if (insErr) throw new Error(`floor_plans insert: ${insErr.message}`)
        result.classified.floor_plans++
      } else {
        const { error: insErr } = await supabase
          .schema('tenants')
          .from('documents')
          .insert({
            organisation_id: proj.organisation_id,
            project_id: proj.id,
            name: item.name,
            category: parentPath.split('/')[0] || 'misc',
            storage_path: storagePath,
            mime_type: dl.contentType,
            size_bytes: dl.contentLength ?? blob.size,
            source_provider: conn.provider,
            source_file_id: item.id,
            source_revision_id: item.revisionId ?? null,
            source_path: parentPath ? `${parentPath}/${item.name}` : item.name,
            synced_at: new Date().toISOString(),
            uploaded_by: req.callerUserId,
          })
        if (insErr) throw new Error(`documents insert: ${insErr.message}`)
        result.classified.documents++
      }
      result.sent++
    } catch (e) {
      result.failed++
      const msg = e instanceof Error ? e.message : String(e)
      ;(result.errors ??= []).push(`${item.name}: ${msg}`.slice(0, 200))
    }
  }

  // 5. Update last_sync_at on the project.
  await supabase
    .schema('projects')
    .from('projects')
    .update({ cloud_storage_last_sync_at: new Date().toISOString() })
    .eq('id', proj.id)

  return result
}

function classify(item: CloudItem, parentPath: string): 'floor_plans' | 'documents' {
  const ext = (item.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
  if (CAD_EXTENSIONS.has(ext)) return 'floor_plans'
  if (ext === '.pdf' && DRAWING_FOLDER_RE.test(parentPath)) return 'floor_plans'
  return 'documents'
}

async function dedupCheck(
  supabase: SupabaseClient,
  target: 'floor_plans' | 'documents',
  projectId: string,
  provider: ProviderName,
  sourceFileId: string,
): Promise<boolean> {
  const { data } = await supabase
    .schema('tenants')
    .from(target)
    .select('id')
    .eq('project_id', projectId)
    .eq('source_provider', provider)
    .eq('source_file_id', sourceFileId)
    .limit(1)
    .maybeSingle()
  return !!data
}

async function refreshAndPersist(
  supabase: SupabaseClient,
  conn: ConnectionRow,
): Promise<string> {
  const refresh = await decryptToken(hexToUint8(conn.refresh_token_enc))
  const provider = getCloudStorageProvider(conn.provider)
  const fresh: TokenBundle = await provider.refreshTokens(refresh)
  await supabase
    .from('org_storage_connections')
    .update({
      access_token_enc: uint8ToHex(await encryptToken(fresh.accessToken)),
      refresh_token_enc: uint8ToHex(await encryptToken(fresh.refreshToken)),
      expires_at: fresh.expiresAt?.toISOString() ?? null,
      scope: fresh.scope,
    })
    .eq('id', conn.id)
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

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
