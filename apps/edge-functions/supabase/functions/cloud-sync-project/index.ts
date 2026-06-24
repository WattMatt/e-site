/**
 * Edge Function: cloud-sync-project
 *
 * Change-detecting sync. Walks a project's mapped cloud folder and, per
 * file, compares the live provider revision (`rev` / etag) against the one
 * stored at last import:
 *   - unchanged (rev matches)  → skip
 *   - new file (no row yet)    → download + insert (drawings also get a v1
 *                                tenants.floor_plan_versions row)
 *   - changed document         → overwrite bytes + update row IN PLACE (docs
 *                                carry no annotations, so this is safe)
 *   - changed drawing          → download the new revision as a NEW
 *                                tenants.floor_plan_versions row and flag the
 *                                drawing `has_newer_version`. The active file
 *                                the markup / snag pins / calibration are
 *                                pinned to is NOT moved until a user migrates
 *                                (see updateFloorPlanToLatest server action),
 *                                so existing annotations are never silently
 *                                invalidated.
 * Every run writes a tenants.cloud_sync_runs diagnostics row (migration
 * 00148) so manual + cron syncs are observable without redeploying.
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
import { requireServiceRole } from '../_shared/auth.ts'

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
  // Audit actor for inserted rows (uploaded_by). Optional: cron has no user,
  // so when omitted we fall back to the connection's connected_by profile.
  callerUserId?: string
  // When set, overrides the extension+folder-name classifier so every file
  // in this run is routed to the corresponding table/bucket. Driven by
  // which tab the user clicked "Sync now" from in the web UI.
  intent?: 'drawings' | 'documents'
  // Provenance for the cloud_sync_runs diagnostics row. Defaults to 'manual'.
  trigger?: 'manual' | 'cron'
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
  connected_by: string
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

  // Service-role gate — prove the caller holds the service-role secret.
  // Decoded JWT role claims are forgeable under --no-verify-jwt (see _shared/auth.ts).
  const authError = requireServiceRole(req)
  if (authError) return authError

  let body: SyncRequest
  try {
    body = (await req.json()) as SyncRequest
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (!body.projectId) {
    return json({ error: 'projectId required' }, 400)
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
  sent: number          // new files inserted
  updated: number       // documents overwritten in place (rev changed)
  newVersions: number   // drawing revisions versioned (rev changed)
  skipped: number       // unchanged (rev matched)
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
  const startedAt = new Date().toISOString()
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
    .select('id, provider, organisation_id, access_token_enc, refresh_token_enc, expires_at, connected_by')
    .eq('id', proj.cloud_storage_connection_id)
    .single()
  if (ce || !connRow) throw new Error(`connection not found: ${ce?.message ?? 'no row'}`)
  const conn = connRow as unknown as ConnectionRow

  // Audit actor for inserted rows. Manual sync passes the signed-in user;
  // cron omits it, so attribute to whoever connected the integration
  // (connected_by is NOT NULL, and floor_plans.uploaded_by is NOT NULL).
  const actorUserId = req.callerUserId ?? conn.connected_by

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

  // 4. For each file: compare rev, then insert / update-in-place / version.
  const result: SyncResult = {
    sent: 0,
    updated: 0,
    newVersions: 0,
    skipped: 0,
    failed: 0,
    classified: { floor_plans: 0, documents: 0 },
    intent: req.intent ?? 'auto',
    errors: [],
  }

  for (const { item, parentPath } of files) {
    try {
      // Classification only decides where a NEW file lands. If the file was
      // already imported (into EITHER table), it stays there — otherwise an
      // auto-classified cron run could disagree with an intent-forced manual
      // run and duplicate the same source file across both tables.
      const classifiedTarget =
        req.intent === 'drawings'
          ? 'floor_plans'
          : req.intent === 'documents'
            ? 'documents'
            : classify(item, parentPath)

      const existing = await findExisting(supabase, proj.id, conn.provider, item.id)
      const target = existing ? existing.table : classifiedTarget
      const liveRev = item.revisionId ?? null

      // Unchanged: a row exists and its stored rev matches the live one.
      // This is the dedup path — one metadata listing, no download.
      if (existing && (existing.source_revision_id ?? '') === (liveRev ?? '')) {
        result.skipped++
        continue
      }

      const dl = await provider.downloadFile({ fileId: item.id, accessToken })
      const ab = await new Response(dl.body).arrayBuffer()
      // Wrap in Blob so supabase-js storage receives the canonical BlobPart
      // shape — explicit content-type, forward-compatible with SDK changes.
      const blob = new Blob([ab], { type: dl.contentType })
      const size = dl.contentLength ?? blob.size
      const ext = (item.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
      const srcPath = parentPath ? `${parentPath}/${item.name}` : item.name

      if (target === 'documents') {
        // Documents carry no annotations → overwrite bytes + update the row
        // in place. Stable id-keyed path so the upload replaces the old object.
        const storagePath = `${proj.organisation_id}/${proj.id}/${item.id}${ext}`
        const { error: upErr } = await supabase.storage
          .from(DOCUMENTS_BUCKET)
          .upload(storagePath, blob, { contentType: dl.contentType, upsert: true })
        if (upErr) throw new Error(`storage upload: ${upErr.message}`)

        if (existing) {
          const { error: udErr } = await supabase
            .schema('tenants')
            .from('documents')
            .update({
              mime_type: dl.contentType,
              size_bytes: size,
              source_revision_id: liveRev,
              source_path: srcPath,
              synced_at: new Date().toISOString(),
            })
            .eq('id', existing.id)
          if (udErr) throw new Error(`documents update: ${udErr.message}`)
          result.updated++
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
              size_bytes: size,
              source_provider: conn.provider,
              source_file_id: item.id,
              source_revision_id: liveRev,
              source_path: srcPath,
              synced_at: new Date().toISOString(),
              uploaded_by: actorUserId,
            })
          if (insErr) throw new Error(`documents insert: ${insErr.message}`)
          result.classified.documents++
          result.sent++
        }
        continue
      }

      // target === 'floor_plans': versioned. Rev-keyed path so old version
      // bytes survive when a newer revision is pulled.
      const revKey = liveRev ?? 'v0'
      const storagePath = `${proj.organisation_id}/${proj.id}/${item.id}/${revKey}${ext}`
      const { error: upErr } = await supabase.storage
        .from(FLOOR_PLANS_BUCKET)
        .upload(storagePath, blob, { contentType: dl.contentType, upsert: true })
      if (upErr) throw new Error(`storage upload: ${upErr.message}`)

      if (!existing) {
        // New drawing: insert the floor_plans row (active = this revision)...
        const { data: fpRow, error: insErr } = await supabase
          .schema('tenants')
          .from('floor_plans')
          .insert({
            organisation_id: proj.organisation_id,
            project_id: proj.id,
            name: item.name,
            file_path: storagePath,
            file_size_bytes: size,
            uploaded_by: actorUserId,
            source_provider: conn.provider,
            source_file_id: item.id,
            source_revision_id: liveRev,
            source_path: srcPath,
            synced_at: new Date().toISOString(),
            latest_revision_id: liveRev,
            latest_synced_at: new Date().toISOString(),
            is_active: true,
          })
          .select('id')
          .single()
        if (insErr || !fpRow) {
          throw new Error(`floor_plans insert: ${insErr?.message ?? 'no row'}`)
        }
        // ...and record it as the v1 version.
        await insertVersion(supabase, {
          orgId: proj.organisation_id,
          projectId: proj.id,
          floorPlanId: (fpRow as { id: string }).id,
          rev: revKey,
          filePath: storagePath,
          size,
          modifiedAt: item.modifiedAt,
        })
        result.classified.floor_plans++
        result.sent++
      } else {
        // Changed drawing: record the new revision WITHOUT moving the active
        // file. Flag has_newer_version so the UI shows a badge; the user
        // migrates explicitly (markup stays pinned to the active version).
        await insertVersion(supabase, {
          orgId: proj.organisation_id,
          projectId: proj.id,
          floorPlanId: existing.id,
          rev: revKey,
          filePath: storagePath,
          size,
          modifiedAt: item.modifiedAt,
        })
        const { error: udErr } = await supabase
          .schema('tenants')
          .from('floor_plans')
          .update({
            has_newer_version: true,
            latest_revision_id: liveRev,
            latest_synced_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
        if (udErr) throw new Error(`floor_plans flag: ${udErr.message}`)
        result.newVersions++
      }
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

  // 6. Diagnostics row — observable history of every sync (migration 00148).
  // Best-effort: a logging failure must not fail the sync itself.
  const { error: runErr } = await supabase
    .schema('tenants')
    .from('cloud_sync_runs')
    .insert({
      organisation_id: proj.organisation_id,
      project_id: proj.id,
      trigger: req.trigger ?? 'manual',
      intent: result.intent,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      sent: result.sent,
      updated: result.updated,
      new_versions: result.newVersions,
      skipped: result.skipped,
      failed: result.failed,
      error_text:
        result.errors && result.errors.length
          ? result.errors.join(' | ').slice(0, 2000)
          : null,
    })
  if (runErr) console.error('cloud_sync_runs insert failed:', runErr.message)

  return result
}

function classify(item: CloudItem, parentPath: string): 'floor_plans' | 'documents' {
  const ext = (item.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
  if (CAD_EXTENSIONS.has(ext)) return 'floor_plans'
  if (ext === '.pdf' && DRAWING_FOLDER_RE.test(parentPath)) return 'floor_plans'
  return 'documents'
}

/**
 * Find the already-imported row for a source file across BOTH target tables,
 * returning which table holds it + its id + stored revision. null = not yet
 * imported anywhere. Cross-table so a file keeps its original classification:
 * once a PDF is a drawing it stays a drawing, even if a later auto-classified
 * cron run would have called it a document (which would otherwise duplicate
 * it). Checks floor_plans first (the rarer, intent-forced case).
 */
async function findExisting(
  supabase: SupabaseClient,
  projectId: string,
  provider: ProviderName,
  sourceFileId: string,
): Promise<{ table: 'floor_plans' | 'documents'; id: string; source_revision_id: string | null } | null> {
  for (const table of ['floor_plans', 'documents'] as const) {
    const { data } = await supabase
      .schema('tenants')
      .from(table)
      .select('id, source_revision_id')
      .eq('project_id', projectId)
      .eq('source_provider', provider)
      .eq('source_file_id', sourceFileId)
      .limit(1)
      .maybeSingle()
    if (data) {
      const row = data as { id: string; source_revision_id: string | null }
      return { table, id: row.id, source_revision_id: row.source_revision_id }
    }
  }
  return null
}

/**
 * Record one imported revision of a drawing. UNIQUE (floor_plan_id,
 * source_revision_id) makes this idempotent — a re-run after a partial
 * failure ignores the duplicate rather than erroring.
 */
async function insertVersion(
  supabase: SupabaseClient,
  v: {
    orgId: string
    projectId: string
    floorPlanId: string
    rev: string
    filePath: string
    size: number
    modifiedAt?: Date
  },
): Promise<void> {
  const { error } = await supabase
    .schema('tenants')
    .from('floor_plan_versions')
    .upsert(
      {
        organisation_id: v.orgId,
        project_id: v.projectId,
        floor_plan_id: v.floorPlanId,
        source_revision_id: v.rev,
        file_path: v.filePath,
        file_size_bytes: v.size,
        source_modified_at: v.modifiedAt ? v.modifiedAt.toISOString() : null,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'floor_plan_id,source_revision_id', ignoreDuplicates: true },
    )
  if (error) throw new Error(`floor_plan_versions insert: ${error.message}`)
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
