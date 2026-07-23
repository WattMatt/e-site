/**
 * Edge Function: cloud-sync-project
 *
 * Change-detecting sync, metadata-first (rewritten 2026-07-23; see
 * docs/superpowers/specs/2026-07-23-floor-plan-sync-freshness.md).
 *
 * The walk enumerates the WHOLE mapped folder tree first — listing is a
 * handful of cheap API calls — and rev-compares every file against a
 * prefetched index of already-imported rows (two queries per run, not two
 * per file). Only new or changed files cost a download, budgeted at
 * MAX_DOWNLOADS successes per invocation; the response reports `remaining`
 * and callers loop until it hits 0. This replaces the old MAX_FILES=50
 * collection cap, where unchanged files consumed the budget and folders
 * >50 files never synced their tail.
 *
 * Per file:
 *   - unchanged (rev matches)     → skip (rename/move/reactivate reconciled)
 *   - captured-but-unadopted rev  → skip (no re-download; badge already up)
 *   - new file (no row yet)       → download + insert (drawings get a v1
 *                                   tenants.floor_plan_versions row)
 *   - changed document            → overwrite bytes + update row in place
 *   - changed drawing, NO annotations
 *                                 → download + ADOPT as the active file
 *                                   (version row recorded for history)
 *   - changed drawing WITH annotations (RFI annotations / QC markup
 *     lineage / snag pins / calibration — the check FAILS CLOSED: any
 *     query error counts as annotated)
 *                                 → download as a NEW version row + flag
 *                                   has_newer_version; the active file only
 *                                   moves on the user's explicit Update
 *
 * New-file classification precedence: CAD extensions (always drawings) →
 * explicit request intent (the user clicked Sync on a tab) → the project's
 * persisted cloud_storage_default_target (declared when the folder was
 * mapped; what cron/auto triggers use) → filename/folder heuristic.
 *
 * Run lifecycle: a tenants.cloud_sync_runs row is INSERTed at start with
 * status='running' and closed in a finally (done/error) — in-flight
 * detection for the auto-sync guard, plus walk telemetry (files_seen,
 * downloads, walk_complete, remaining).
 *
 * Token health: an auth-class refresh failure (invalid_grant / 400 / 401)
 * sets org_storage_connections.needs_reauth + last_sync_error — cleared
 * only by an OAuth reconnect (Settings → Integrations). Transient refresh
 * errors (5xx / network) fail the run WITHOUT flagging. A 401 thrown by
 * the walk itself (token revoked while expires_at still future) also flags.
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
  CloudStorageError,
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

// Download budget per invocation, counted in SUCCESSFUL downloads (~2-5s
// each incl. storage re-upload); 20 keeps a worst-case run well inside the
// 150s edge wall-clock cap. Failures are capped separately (below) so a
// permanently-failing file can't starve the files behind it in walk order.
// Anything over budget is reported in `remaining` and the caller loops.
const MAX_DOWNLOADS = 20
const MAX_DOWNLOAD_ATTEMPTS = 40

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
  // Explicit user intent (which tab "Sync now" was clicked from). Only NEW
  // non-CAD files are affected; see classification precedence above.
  intent?: 'drawings' | 'documents'
  // Provenance for the cloud_sync_runs row. Defaults to 'manual'.
  trigger?: 'manual' | 'cron' | 'auto'
}

interface ProjectRow {
  id: string
  organisation_id: string
  cloud_storage_connection_id: string | null
  cloud_storage_folder_id: string | null
  cloud_storage_default_target: 'drawings' | 'documents' | null
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
  downloads: number     // successful downloads this run
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

/** Auth-class provider error: the stored credentials themselves are bad
 * (revoked / invalid_grant), as opposed to a transient outage. */
function isAuthError(e: unknown): boolean {
  return e instanceof CloudStorageError && (e.status === 400 || e.status === 401)
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
    .select('id, organisation_id, cloud_storage_connection_id, cloud_storage_folder_id, cloud_storage_default_target')
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

  // 4. Token: decrypt, refresh when missing-expiry/near-expiry. Only an
  // auth-class refresh failure marks the connection (a Dropbox 503 must not
  // brick it); the flag is cleared by an OAuth reconnect.
  let accessToken = await decryptToken(hexToUint8(conn.access_token_enc))
  const expMs = conn.expires_at ? Date.parse(conn.expires_at) : 0
  if (!expMs || expMs - Date.now() < 60_000) {
    try {
      accessToken = await refreshAndPersist(supabase, conn)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (isAuthError(e)) {
        await flagNeedsReauth(supabase, conn.id, msg)
        throw new Error(`token refresh rejected (connection flagged for reconnect): ${msg}`)
      }
      throw new Error(`token refresh failed (transient — connection NOT flagged): ${msg}`)
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
  let fatal: string | null = null
  try {
    await runSync(supabase, provider, accessToken, proj, conn, req, actorUserId, result)

    // Stamp the project's "folder checked at T" timestamp on every run that
    // completed without a fatal error — this is what the auto-sync freshness
    // gate reads. Gating it on walkComplete would make a >MAX_ENTRIES or
    // >MAX_DEPTH folder re-walk on EVERY tab open forever; the run row's
    // walk_complete column records whether enumeration truly covered
    // everything (reconcile stays gated on that).
    await supabase
      .schema('projects')
      .from('projects')
      .update({ cloud_storage_last_sync_at: new Date().toISOString() })
      .eq('id', proj.id)
  } catch (e) {
    fatal = e instanceof Error ? e.message : String(e)
    // A 401 mid-walk means the token was revoked while expires_at was still
    // in the future — flag so the UI offers Reconnect instead of eternal 500s.
    if (isAuthError(e) && (e as CloudStorageError).status === 401) {
      await flagNeedsReauth(supabase, conn.id, fatal)
    }
    throw e
  } finally {
    if (runId) {
      await closeRun(supabase, runId, result, fatal ? 'error' : 'done', fatal)
    }
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

  walk:
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
      if (files.length >= MAX_ENTRIES) {
        // Truncated only if enumeration genuinely stopped early — a tree of
        // exactly MAX_ENTRIES files whose last page just completed (no
        // pageToken, no queued folders) WAS fully walked.
        if (pageToken || queue.length > 0) truncated = true
        break walk
      }
    } while (pageToken)
  }

  result.filesSeen = files.length
  result.walkComplete = !truncated

  // ── Prefetch the already-imported index: two queries per run instead of
  // up to two PER FILE (a 2000-entry walk would otherwise pay ~4000
  // sequential round-trips of pure rev-compare and blow the 150s cap). ────
  const existingIndex = await buildExistingIndex(supabase, proj.id, conn.provider)

  // Classification default for NEW files when the request carries no
  // explicit intent: the mapping's declared purpose.
  const fallbackIntent = req.intent ?? proj.cloud_storage_default_target ?? undefined

  // ── Per-file: rev-compare (cheap) → download only new/changed. ──────────
  let downloadAttempts = 0
  for (const { item, parentPath } of files) {
    try {
      const existing = existingIndex.get(item.id) ?? null
      const target = existing ? existing.table : decideTarget(item, parentPath, fallbackIntent)
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
      // row written, badge up, user hasn't adopted yet): nothing to download.
      // The old engine re-downloaded these every run. Reactivate if needed
      // (removed-then-restored file whose newest rev we'd already seen).
      if (
        existing &&
        existing.table === 'floor_plans' &&
        (existing.latest_revision_id ?? '') === (liveRev ?? '')
      ) {
        if (existing.is_active === false) {
          const { error: raErr } = await supabase
            .schema('tenants')
            .from('floor_plans')
            .update({ is_active: true })
            .eq('id', existing.id)
          if (raErr) throw new Error(`floor_plans reactivate: ${raErr.message}`)
          result.renamed++
        } else {
          result.skipped++
        }
        continue
      }

      // From here the file costs a download. Budget: MAX_DOWNLOADS successes
      // (wall-clock budget) AND MAX_DOWNLOAD_ATTEMPTS tries (so a block of
      // permanently-failing files can't starve the files behind them, while
      // still bounding wasted attempts per run).
      if (result.downloads >= MAX_DOWNLOADS || downloadAttempts >= MAX_DOWNLOAD_ATTEMPTS) {
        result.remaining++
        continue
      }
      downloadAttempts++

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
        result.downloads++
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
        result.downloads++
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
        // Close the check-then-act window: the auto-sync fires exactly when
        // a user opens the tab — i.e. right when they might be annotating.
        // If an annotation landed between the check and the adopt, flag the
        // drawing so the change is at least visible for review.
        if (await isAnnotated(supabase, existing.id)) {
          await supabase
            .schema('tenants')
            .from('floor_plans')
            .update({ has_newer_version: true })
            .eq('id', existing.id)
        }
        result.adopted++
      } else {
        const { error: udErr } = await supabase
          .schema('tenants')
          .from('floor_plans')
          .update({
            has_newer_version: true,
            latest_revision_id: liveRev,
            latest_synced_at: new Date().toISOString(),
            // A removed-then-restored file must come back visible — the
            // sibling branches restore is_active too.
            is_active: true,
          })
          .eq('id', existing.id)
        if (udErr) throw new Error(`floor_plans flag: ${udErr.message}`)
        result.newVersions++
      }
      result.downloads++
    } catch (e) {
      // Auth-class failures abort the whole run (every later file would fail
      // the same way, and syncProject's catch flags needs_reauth on 401).
      if (isAuthError(e)) throw e
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

interface ExistingRow {
  table: 'floor_plans' | 'documents'
  id: string
  source_revision_id: string | null
  latest_revision_id: string | null
  name: string
  source_path: string | null
  is_active: boolean | null
}

/**
 * Prefetch every already-imported row for this (project, provider) into a
 * Map keyed by source_file_id. Cross-table so a file keeps its original
 * classification forever (a later differently-intended run must not
 * duplicate it into the other table). floor_plans wins a (theoretical)
 * same-id collision, matching the old per-file lookup order.
 */
async function buildExistingIndex(
  supabase: SupabaseClient,
  projectId: string,
  provider: ProviderName,
): Promise<Map<string, ExistingRow>> {
  const index = new Map<string, ExistingRow>()

  const { data: docs, error: de } = await supabase
    .schema('tenants')
    .from('documents')
    .select('id, source_file_id, source_revision_id, name, source_path')
    .eq('project_id', projectId)
    .eq('source_provider', provider)
  if (de) throw new Error(`documents index: ${de.message}`)
  for (const d of (docs ?? []) as Array<{
    id: string; source_file_id: string; source_revision_id: string | null
    name: string; source_path: string | null
  }>) {
    index.set(d.source_file_id, {
      table: 'documents',
      id: d.id,
      source_revision_id: d.source_revision_id,
      latest_revision_id: null,
      name: d.name,
      source_path: d.source_path,
      is_active: null,
    })
  }

  const { data: fps, error: fe } = await supabase
    .schema('tenants')
    .from('floor_plans')
    .select('id, source_file_id, source_revision_id, latest_revision_id, name, source_path, is_active')
    .eq('project_id', projectId)
    .eq('source_provider', provider)
  if (fe) throw new Error(`floor_plans index: ${fe.message}`)
  for (const f of (fps ?? []) as Array<{
    id: string; source_file_id: string; source_revision_id: string | null
    latest_revision_id: string | null; name: string; source_path: string | null
    is_active: boolean | null
  }>) {
    index.set(f.source_file_id, {
      table: 'floor_plans',
      id: f.id,
      source_revision_id: f.source_revision_id,
      latest_revision_id: f.latest_revision_id,
      name: f.name,
      source_path: f.source_path,
      is_active: f.is_active,
    })
  }

  return index
}

/**
 * Where a NEW file lands. CAD files are unambiguous drawings regardless of
 * any intent (a "Sync now" click on the Documents tab must not file a .dwg
 * as a document); otherwise the explicit/default intent decides; otherwise
 * the filename/folder heuristic.
 */
function decideTarget(
  item: CloudItem,
  parentPath: string,
  intent: 'drawings' | 'documents' | undefined,
): 'floor_plans' | 'documents' {
  const ext = (item.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
  if (CAD_EXTENSIONS.has(ext)) return 'floor_plans'
  if (intent === 'drawings') return 'floor_plans'
  if (intent === 'documents') return 'documents'
  if (ext === '.pdf' && DRAWING_FOLDER_RE.test(parentPath)) return 'floor_plans'
  return 'documents'
}

/**
 * A drawing is "annotated" when anything is pinned to its active file's
 * geometry: RFI annotations, QC markup lineage, snag pins, or a measure
 * calibration. Annotated drawings are never auto-adopted — a layout change
 * in the new revision would silently misalign all of them.
 *
 * FAILS CLOSED: any query error counts as annotated. A transient PostgREST
 * hiccup must degrade to "keep the badge flow", never to "swap the file
 * under existing annotations".
 */
async function isAnnotated(
  supabase: SupabaseClient,
  floorPlanId: string,
): Promise<boolean> {
  const { data: plan, error: pe } = await supabase
    .schema('tenants')
    .from('floor_plans')
    .select('pixels_per_meter')
    .eq('id', floorPlanId)
    .maybeSingle()
  if (pe || !plan) return true
  if ((plan as { pixels_per_meter: number | null }).pixels_per_meter != null) return true

  const { data: rfiAnn, error: re } = await supabase
    .from('rfi_annotations')
    .select('id')
    .eq('source_floor_plan_id', floorPlanId)
    .limit(1)
    .maybeSingle()
  if (re || rfiAnn) return true

  const { data: qcPhoto, error: qe } = await supabase
    .schema('projects')
    .from('qc_entry_photos')
    .select('id')
    .eq('source_floor_plan_id', floorPlanId)
    .limit(1)
    .maybeSingle()
  if (qe || qcPhoto) return true

  const { data: snag, error: se } = await supabase
    .schema('field')
    .from('snags')
    .select('id')
    .contains('floor_plan_pin', { floorPlanId })
    .limit(1)
    .maybeSingle()
  if (se || snag) return true

  return false
}

async function flagNeedsReauth(
  supabase: SupabaseClient,
  connectionId: string,
  message: string,
): Promise<void> {
  const { error } = await supabase
    .from('org_storage_connections')
    .update({ needs_reauth: true, last_sync_error: message.slice(0, 500) })
    .eq('id', connectionId)
  if (error) console.error('needs_reauth flag failed:', error.message)
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
