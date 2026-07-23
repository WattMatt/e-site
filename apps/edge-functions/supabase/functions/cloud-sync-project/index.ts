/**
 * Edge Function: cloud-sync-project
 *
 * Change-detecting sync, metadata-first (rewritten 2026-07-23; see
 * docs/superpowers/specs/2026-07-23-floor-plan-sync-freshness.md).
 *
 * The walk enumerates the WHOLE mapped folder tree first — listing is a
 * handful of cheap API calls — and rev-compares every file. Only new or
 * changed files cost a download, budgeted at MAX_DOWNLOADS per invocation;
 * the response reports `remaining` and callers loop until it hits 0. This
 * replaces the old MAX_FILES=50 collection cap, where unchanged files
 * consumed the budget and folders >50 files never synced their tail.
 *
 * Per changed file:
 *   - unchanged (rev matches)     → skip (rename/move still reconciled)
 *   - captured-but-unadopted rev  → skip (no re-download; badge already up)
 *   - new file (no row yet)       → download + insert (drawings get a v1
 *                                   tenants.floor_plan_versions row)
 *   - changed document            → overwrite bytes + update row in place
 *   - changed drawing, NO annotations (no RFI annotations, no QC markup
 *     lineage, no snag pins, not calibrated)
 *                                 → download new revision + ADOPT it as the
 *                                   active file immediately (version row
 *                                   recorded for history)
 *   - changed drawing WITH annotations
 *                                 → download as a NEW version row + flag
 *                                   has_newer_version; the active file only
 *                                   moves when a user clicks Update (pins /
 *                                   markup / calibration are pinned to the
 *                                   active file's geometry)
 *
 * Run lifecycle: a tenants.cloud_sync_runs row is INSERTed at start with
 * status='running' and UPDATEd to done/error at completion — in-flight
 * detection for the auto-sync guard, plus walk telemetry (files_seen,
 * downloads, walk_complete, remaining).
 *
 * Token health: a refresh failure sets org_storage_connections.needs_reauth
 * + last_sync_error (surfaced in the toolbar and settings/integrations);
 * the next successful refresh clears both.
 *
 * Request body:
 *   {
 *     projectId: string,
 *     callerUserId?: string,        // audit actor; cron/auto omit it
 *     intent?: 'drawings' | 'documents',
 *     trigger?: 'manual' | 'cron' | 'auto',
 *   }
 *   Authorization: Bearer <service_role_key>
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

// Walk guards. Listing is metadata-only (cheap), so these are runaway
// backstops, not per-run work budgets:
const MAX_DEPTH = 5      // subfolder nesting below the mapped folder
const MAX_ENTRIES = 2000 // total files enumerated before we call it truncated

// Download budget per invocation. Only new/changed files cost a download
// (~2-5s each incl. storage re-upload); 20 keeps a worst-case run well
// inside the 150s edge wall-clock cap. Anything over budget is reported in
// `remaining` and the caller loops.
const MAX_DOWNLOADS = 20

// A 'running' cloud_sync_runs row younger than this is treated as a live
// in-flight sync (dedupe guard for auto/cron triggers). Older running rows
// are considered crashed and ignored.
const IN_FLIGHT_WINDOW_MS = 3 * 60_000

// Routing heuristic — see docs/cloud-storage-integration-design.md §6.
const CAD_EXTENSIONS = new Set(['.dwg', '.dxf', '.dgn', '.rvt'])
const DRAWING_FOLDER_RE = /(^|\/)(drawings?|plans?|floor[ -]?plans?)(\/|$)/i

interface SyncRequest {
  projectId: string
  // Audit actor for inserted rows (uploaded_by). Optional: cron/auto have no
  // user, so when omitted we fall back to the connection's connected_by.
  callerUserId?: string
  // When set, overrides the extension+folder-name classifier so every NEW
  // file in this run is routed to the corresponding table/bucket. Driven by
  // which tab the sync was triggered from in the web UI.
  intent?: 'drawings' | 'documents'
  // Provenance for the cloud_sync_runs row. Defaults to 'manual'.
  trigger?: 'manual' | 'cron' | 'auto'
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
  needs_reauth: boolean | null
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
  newVersions: number   // drawing revisions captured for annotated drawings
  adopted: number       // drawing revisions captured AND made active (clean drawings)
  renamed: number       // drawings whose name/path moved (same content)
  removed: number       // drawings soft-removed (gone from the folder)
  skipped: number       // unchanged, or already-captured awaiting adoption
  failed: number
  filesSeen: number     // everything the metadata walk enumerated
  downloads: number     // files that actually cost a download this run
  remaining: number     // new/changed files left when the budget ran out
  walkComplete: boolean
  alreadyRunning: boolean // true = another sync was in flight; nothing done
  classified: { floor_plans: number; documents: number }
  intent: 'drawings' | 'documents' | 'auto'
  errors?: string[]
}

function emptyResult(intent: SyncResult['intent']): SyncResult {
  return {
    sent: 0, updated: 0, newVersions: 0, adopted: 0, renamed: 0, removed: 0,
    skipped: 0, failed: 0, filesSeen: 0, downloads: 0, remaining: 0,
    walkComplete: false, alreadyRunning: false,
    classified: { floor_plans: 0, documents: 0 },
    intent, errors: [],
  }
}

async function syncProject(
  supabase: SupabaseClient,
  req: SyncRequest,
): Promise<SyncResult> {
  const trigger = req.trigger ?? 'manual'
  const intent: SyncResult['intent'] = req.intent ?? 'auto'

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

  // 2. In-flight guard. Manual clicks always proceed (the user forced it and
  // the engine is idempotent); auto/cron triggers dedupe against a live run.
  if (trigger !== 'manual') {
    const cutoff = new Date(Date.now() - IN_FLIGHT_WINDOW_MS).toISOString()
    const { data: running } = await supabase
      .schema('tenants')
      .from('cloud_sync_runs')
      .select('id')
      .eq('project_id', proj.id)
      .eq('status', 'running')
      .gte('started_at', cutoff)
      .limit(1)
      .maybeSingle()
    if (running) {
      const r = emptyResult(intent)
      r.alreadyRunning = true
      return r
    }
  }

  // 3. Load connection; fail fast when it's known-broken.
  const { data: connRow, error: ce } = await supabase
    .from('org_storage_connections')
    .select('id, provider, organisation_id, access_token_enc, refresh_token_enc, expires_at, connected_by, needs_reauth')
    .eq('id', proj.cloud_storage_connection_id)
    .single()
  if (ce || !connRow) throw new Error(`connection not found: ${ce?.message ?? 'no row'}`)
  const conn = connRow as unknown as ConnectionRow
  if (conn.needs_reauth) {
    throw new Error(
      'cloud connection needs re-authentication — reconnect it under Settings → Integrations',
    )
  }

  // Audit actor for inserted rows. Manual sync passes the signed-in user;
  // cron/auto omit it, so attribute to whoever connected the integration
  // (connected_by is NOT NULL, and floor_plans.uploaded_by is NOT NULL).
  const actorUserId = req.callerUserId ?? conn.connected_by

  // 4. Token: decrypt, refresh when missing-expiry/near-expiry. Refresh
  // failure marks the connection so the UI can offer Reconnect.
  let accessToken = await decryptToken(hexToUint8(conn.access_token_enc))
  const expMs = conn.expires_at ? Date.parse(conn.expires_at) : 0
  if (!expMs || expMs - Date.now() < 60_000) {
    try {
      accessToken = await refreshAndPersist(supabase, conn)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await supabase
        .from('org_storage_connections')
        .update({ needs_reauth: true, last_sync_error: msg.slice(0, 500) })
        .eq('id', conn.id)
      throw new Error(`token refresh failed (connection flagged for reconnect): ${msg}`)
    }
  }
  const provider = getCloudStorageProvider(conn.provider)

  // 5. Open the diagnostics run row (status=running) — the in-flight marker.
  const startedAt = new Date().toISOString()
  const { data: runRow } = await supabase
    .schema('tenants')
    .from('cloud_sync_runs')
    .insert({
      organisation_id: proj.organisation_id,
      project_id: proj.id,
      trigger,
      intent,
      status: 'running',
      started_at: startedAt,
    })
    .select('id')
    .maybeSingle()
  const runId = (runRow as { id: string } | null)?.id ?? null

  const result = emptyResult(intent)
  try {
    await runSync(supabase, provider, accessToken, proj, conn, req, actorUserId, result)
  } catch (e) {
    // Fatal (listing/auth/db) error: close the run row as error, rethrow.
    const msg = e instanceof Error ? e.message : String(e)
    if (runId) {
      await closeRun(supabase, runId, result, 'error', msg)
    }
    throw e
  }

  // 6. Stamp the project's "folder fully checked at T" timestamp — only when
  // the walk actually enumerated everything (an honest freshness signal).
  if (result.walkComplete) {
    await supabase
      .schema('projects')
      .from('projects')
      .update({ cloud_storage_last_sync_at: new Date().toISOString() })
      .eq('id', proj.id)
  }

  if (runId) {
    await closeRun(supabase, runId, result, 'done', null)
  }
  return result
}

async function runSync(
  supabase: SupabaseClient,
  provider: ReturnType<typeof getCloudStorageProvider>,
  accessToken: string,
  proj: ProjectRow,
  conn: ConnectionRow,
  req: SyncRequest,
  actorUserId: string,
  result: SyncResult,
): Promise<void> {
  // ── Metadata walk: enumerate the whole tree (BFS). ──────────────────────
  interface QueueEntry { folderId: string; path: string; depth: number }
  const queue: QueueEntry[] = [
    { folderId: proj.cloud_storage_folder_id!, path: '', depth: 0 },
  ]
  const files: Array<{ item: CloudItem; parentPath: string }> = []
  let truncated = false

  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur.depth > MAX_DEPTH) { truncated = true; continue }
    let pageToken: string | undefined
    do {
      const page = await provider.listFolder({
        folderId: cur.folderId,
        accessToken,
        pageToken,
      })
      for (const item of page.items) {
        if (item.name.startsWith('.')) continue // skip hidden
        if (item.type === 'folder') {
          queue.push({
            folderId: item.id,
            path: cur.path ? `${cur.path}/${item.name}` : item.name,
            depth: cur.depth + 1,
          })
        } else {
          files.push({ item, parentPath: cur.path })
        }
      }
      pageToken = page.nextPageToken
    } while (pageToken && files.length < MAX_ENTRIES)
    if (files.length >= MAX_ENTRIES) { truncated = true; break }
  }

  result.filesSeen = files.length
  result.walkComplete = !truncated

  // ── Per-file: rev-compare (cheap) → download only new/changed. ──────────
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
      const srcPath = parentPath ? `${parentPath}/${item.name}` : item.name

      // Unchanged content (rev matches the ACTIVE revision). Still handle a
      // rename/move: Dropbox keeps the file id stable, so the same drawing
      // may have a new name/path. Also reactivate a drawing that was soft-
      // removed but has reappeared in the folder.
      if (existing && (existing.source_revision_id ?? '') === (liveRev ?? '')) {
        const patch: Record<string, unknown> = {}
        if (
          existing.table === 'floor_plans' &&
          (existing.name !== item.name || (existing.source_path ?? '') !== srcPath)
        ) {
          patch.name = item.name
          patch.source_path = srcPath
        }
        if (existing.table === 'floor_plans' && existing.is_active === false) {
          patch.is_active = true
        }
        if (Object.keys(patch).length > 0) {
          const { error: rnErr } = await supabase
            .schema('tenants')
            .from('floor_plans')
            .update(patch)
            .eq('id', existing.id)
          if (rnErr) throw new Error(`floor_plans rename/reactivate: ${rnErr.message}`)
          result.renamed++
        } else {
          result.skipped++
        }
        continue
      }

      // Changed drawing whose newest revision we ALREADY captured (version
      // row written, badge up, user hasn't adopted yet): nothing to do. The
      // old engine re-downloaded these every run.
      if (
        existing &&
        existing.table === 'floor_plans' &&
        (existing.latest_revision_id ?? '') === (liveRev ?? '')
      ) {
        result.skipped++
        continue
      }

      // From here the file costs a download. Budget check.
      if (result.downloads >= MAX_DOWNLOADS) {
        result.remaining++
        continue
      }
      result.downloads++

      const dl = await provider.downloadFile({ fileId: item.id, accessToken })
      const ab = await new Response(dl.body).arrayBuffer()
      // Wrap in Blob so supabase-js storage receives the canonical BlobPart
      // shape — explicit content-type, forward-compatible with SDK changes.
      const blob = new Blob([ab], { type: dl.contentType })
      const size = dl.contentLength ?? blob.size
      const ext = (item.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase()

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
        continue
      }

      // Changed drawing: capture the new revision, then either adopt it
      // immediately (drawing has zero annotations — nothing can misalign) or
      // flag has_newer_version and wait for the user's explicit Update.
      await insertVersion(supabase, {
        orgId: proj.organisation_id,
        projectId: proj.id,
        floorPlanId: existing.id,
        rev: revKey,
        filePath: storagePath,
        size,
        modifiedAt: item.modifiedAt,
      })

      const annotated = await isAnnotated(supabase, existing.id)
      if (!annotated) {
        const { error: adErr } = await supabase
          .schema('tenants')
          .from('floor_plans')
          .update({
            file_path: storagePath,
            file_size_bytes: size,
            name: item.name,
            source_path: srcPath,
            source_revision_id: liveRev,
            synced_at: new Date().toISOString(),
            latest_revision_id: liveRev,
            latest_synced_at: new Date().toISOString(),
            has_newer_version: false,
            is_active: true,
          })
          .eq('id', existing.id)
        if (adErr) throw new Error(`floor_plans adopt: ${adErr.message}`)
        result.adopted++
      } else {
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

  // ── Reconcile deletions (drawings only). Soft-remove cloud-synced drawings
  // whose source file is no longer in the folder. Only when the walk
  // enumerated the whole tree — a truncated walk would falsely delete
  // un-walked files. Local uploads (source_provider NULL) are never touched.
  if (result.walkComplete) {
    const presentIds = new Set(files.map((f) => f.item.id))
    const { data: activeRows } = await supabase
      .schema('tenants')
      .from('floor_plans')
      .select('id, source_file_id')
      .eq('project_id', proj.id)
      .eq('source_provider', conn.provider)
      .eq('is_active', true)
    const toRemove = ((activeRows ?? []) as Array<{ id: string; source_file_id: string }>)
      .filter((r) => !presentIds.has(r.source_file_id))
      .map((r) => r.id)
    if (toRemove.length > 0) {
      const { error: rmErr } = await supabase
        .schema('tenants')
        .from('floor_plans')
        .update({ is_active: false })
        .in('id', toRemove)
      if (rmErr) {
        ;(result.errors ??= []).push(`reconcile: ${rmErr.message}`.slice(0, 200))
      } else {
        result.removed = toRemove.length
      }
    }
  } else {
    console.log('reconcile: SKIPPED (walk truncated — folder exceeds MAX_ENTRIES/MAX_DEPTH)')
  }
}

/**
 * A drawing is "annotated" when anything is pinned to its active file's
 * geometry: RFI annotations, QC markup lineage, snag pins, or a measure
 * calibration. Annotated drawings are never auto-adopted — a layout change
 * in the new revision would silently misalign all of them.
 */
async function isAnnotated(
  supabase: SupabaseClient,
  floorPlanId: string,
): Promise<boolean> {
  const { data: plan } = await supabase
    .schema('tenants')
    .from('floor_plans')
    .select('pixels_per_meter')
    .eq('id', floorPlanId)
    .maybeSingle()
  if ((plan as { pixels_per_meter: number | null } | null)?.pixels_per_meter != null) {
    return true
  }

  const { data: rfiAnn } = await supabase
    .from('rfi_annotations')
    .select('id')
    .eq('source_floor_plan_id', floorPlanId)
    .limit(1)
    .maybeSingle()
  if (rfiAnn) return true

  const { data: qcPhoto } = await supabase
    .schema('projects')
    .from('qc_entry_photos')
    .select('id')
    .eq('source_floor_plan_id', floorPlanId)
    .limit(1)
    .maybeSingle()
  if (qcPhoto) return true

  const { data: snag } = await supabase
    .schema('field')
    .from('snags')
    .select('id')
    .contains('floor_plan_pin', { floorPlanId })
    .limit(1)
    .maybeSingle()
  if (snag) return true

  return false
}

async function closeRun(
  supabase: SupabaseClient,
  runId: string,
  result: SyncResult,
  status: 'done' | 'error',
  fatalError: string | null,
): Promise<void> {
  const errText = [
    ...(fatalError ? [fatalError] : []),
    ...(result.errors ?? []),
  ].join(' | ').slice(0, 2000)
  const { error } = await supabase
    .schema('tenants')
    .from('cloud_sync_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      sent: result.sent,
      updated: result.updated,
      new_versions: result.newVersions + result.adopted,
      skipped: result.skipped,
      failed: result.failed,
      files_seen: result.filesSeen,
      downloads: result.downloads,
      walk_complete: result.walkComplete,
      remaining: result.remaining,
      error_text: errText || null,
    })
    .eq('id', runId)
  if (error) console.error('cloud_sync_runs close failed:', error.message)
}

function classify(item: CloudItem, parentPath: string): 'floor_plans' | 'documents' {
  const ext = (item.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
  if (CAD_EXTENSIONS.has(ext)) return 'floor_plans'
  if (ext === '.pdf' && DRAWING_FOLDER_RE.test(parentPath)) return 'floor_plans'
  return 'documents'
}

/**
 * Find the already-imported row for a source file across BOTH target tables,
 * returning which table holds it + its id + stored revisions. null = not yet
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
): Promise<
  | {
      table: 'floor_plans' | 'documents'
      id: string
      source_revision_id: string | null
      latest_revision_id: string | null
      name: string
      source_path: string | null
      is_active: boolean | null
    }
  | null
> {
  {
    const { data } = await supabase
      .schema('tenants')
      .from('floor_plans')
      .select('id, source_revision_id, latest_revision_id, name, source_path, is_active')
      .eq('project_id', projectId)
      .eq('source_provider', provider)
      .eq('source_file_id', sourceFileId)
      .limit(1)
      .maybeSingle()
    if (data) {
      const row = data as {
        id: string
        source_revision_id: string | null
        latest_revision_id: string | null
        name: string
        source_path: string | null
        is_active: boolean | null
      }
      return { table: 'floor_plans', ...row }
    }
  }
  {
    const { data } = await supabase
      .schema('tenants')
      .from('documents')
      .select('id, source_revision_id, name, source_path')
      .eq('project_id', projectId)
      .eq('source_provider', provider)
      .eq('source_file_id', sourceFileId)
      .limit(1)
      .maybeSingle()
    if (data) {
      const row = data as {
        id: string
        source_revision_id: string | null
        name: string
        source_path: string | null
      }
      return {
        table: 'documents',
        id: row.id,
        source_revision_id: row.source_revision_id,
        latest_revision_id: null,
        name: row.name,
        source_path: row.source_path,
        is_active: null,
      }
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
      // A successful refresh proves the connection is healthy again.
      needs_reauth: false,
      last_sync_error: null,
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
