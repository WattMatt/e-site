'use server'

/**
 * Handover Documents server actions.
 *
 * Three primary surfaces:
 *   - initializeHandoverCategoryAction: bulk-create folders for a category
 *     from FOLDER_TEMPLATES, with optional cloud mirror under the project's
 *     "Handover" wrapper folder.
 *   - createHandoverSubfolderAction: ad-hoc single folder under a parent.
 *   - uploadHandoverDocumentAction: file upload — lands in Supabase
 *     Storage's `project-documents` bucket AND mirrors to the user's
 *     cloud provider when connected.
 *
 * All three are best-effort on the cloud-mirror side: if the cloud push
 * fails, the local row commits anyway and the cloud_* columns stay NULL.
 * The UI surfaces "cloud: not yet synced" so the user can retry.
 */

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  ALL_CATEGORIES,
  CATEGORY_LABELS,
  FOLDER_TEMPLATES,
  flattenTemplate,
  type HandoverCategory,
} from '@esite/shared'
import {
  loadProjectCloudContext,
  mirrorCreateFolder,
  mirrorUploadFile,
  type ProjectCloudContext,
} from '@/services/handover.server'

const BUCKET = 'project-documents'

// ---------------------------------------------------------------------------
// initializeHandoverCategoryAction
// ---------------------------------------------------------------------------

export type InitializeResult =
  | { ok: true; foldersCreated: number; cloudMirrored: number }
  | { error: string }

export async function initializeHandoverCategoryAction(
  projectId: string,
  category: HandoverCategory,
): Promise<InitializeResult> {
  if (!isUuid(projectId)) return { error: 'Invalid project id' }
  if (!ALL_CATEGORIES.includes(category)) return { error: 'Invalid category' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Verify the project exists + the caller is org member (RLS enforces).
  const { data: project, error: projErr } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('id, organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  if (projErr || !project) return { error: 'Project not found' }
  const orgId = project.organisation_id as string

  // Best-effort cloud context — null when the project hasn't picked a
  // dedicated handover folder yet (or has no connection).
  const cloudCtx = await loadProjectCloudContext(projectId, supabase).catch(() => null)
  const cloudRootId = cloudCtx?.handoverRootFolderId ?? null

  // 1. Create the category root folder (parent_folder_id = NULL).
  const rootName = CATEGORY_LABELS[category]
  const { data: existingRoot } = await (supabase as any)
    .schema('tenants')
    .from('handover_folders')
    .select('id, cloud_folder_id')
    .eq('project_id', projectId)
    .eq('category', category)
    .is('parent_folder_id', null)
    .maybeSingle()

  let categoryRootId: string
  let categoryRootCloudId: string | null = null
  let cloudMirrored = 0

  if (existingRoot) {
    categoryRootId = existingRoot.id as string
    categoryRootCloudId = (existingRoot.cloud_folder_id as string | null) ?? null
  } else {
    let cloudFolder = null
    if (cloudCtx && cloudRootId) {
      cloudFolder = await mirrorCreateFolder(cloudCtx, cloudRootId, rootName)
      if (cloudFolder) cloudMirrored++
    }
    const { data: inserted, error } = await (supabase as any)
      .schema('tenants')
      .from('handover_folders')
      .insert({
        organisation_id: orgId,
        project_id: projectId,
        parent_folder_id: null,
        name: rootName,
        category,
        cloud_provider: cloudFolder ? cloudCtx!.provider : null,
        cloud_folder_id: cloudFolder?.id ?? null,
        cloud_folder_path: cloudFolder?.path ?? null,
        cloud_synced_at: cloudFolder ? new Date().toISOString() : null,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (error || !inserted) return { error: `Failed to create category root: ${error?.message}` }
    categoryRootId = inserted.id as string
    categoryRootCloudId = cloudFolder?.id ?? null
  }

  // 2. Walk the template and insert each folder.
  // pathToId maps "Drawings/Layout Drawings" → uuid for parent-lookup.
  const flat = flattenTemplate(FOLDER_TEMPLATES[category])
  const pathToId = new Map<string, string>()
  const pathToCloudId = new Map<string, string>()
  let foldersCreated = 0

  for (const f of flat) {
    const fullPath = f.parentPath ? `${f.parentPath}/${f.name}` : f.name
    const parentId = f.parentPath ? pathToId.get(f.parentPath) ?? categoryRootId : categoryRootId
    const parentCloudId = f.parentPath
      ? pathToCloudId.get(f.parentPath) ?? categoryRootCloudId
      : categoryRootCloudId

    // Skip if already present (idempotent re-init).
    const { data: existing } = await (supabase as any)
      .schema('tenants')
      .from('handover_folders')
      .select('id, cloud_folder_id')
      .eq('project_id', projectId)
      .eq('category', category)
      .eq('parent_folder_id', parentId)
      .eq('name', f.name)
      .maybeSingle()
    if (existing) {
      pathToId.set(fullPath, existing.id as string)
      if (existing.cloud_folder_id) pathToCloudId.set(fullPath, existing.cloud_folder_id as string)
      continue
    }

    let cloudFolder = null
    if (cloudCtx && parentCloudId) {
      cloudFolder = await mirrorCreateFolder(cloudCtx, parentCloudId, f.name)
      if (cloudFolder) cloudMirrored++
    }

    const { data: inserted, error: insErr } = await (supabase as any)
      .schema('tenants')
      .from('handover_folders')
      .insert({
        organisation_id: orgId,
        project_id: projectId,
        parent_folder_id: parentId,
        name: f.name,
        category,
        cloud_provider: cloudFolder ? cloudCtx!.provider : null,
        cloud_folder_id: cloudFolder?.id ?? null,
        cloud_folder_path: cloudFolder?.path ?? null,
        cloud_synced_at: cloudFolder ? new Date().toISOString() : null,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (insErr || !inserted) continue
    foldersCreated++
    pathToId.set(fullPath, inserted.id as string)
    if (cloudFolder) pathToCloudId.set(fullPath, cloudFolder.id)
  }

  revalidatePath(`/projects/${projectId}/handover`)
  return { ok: true, foldersCreated, cloudMirrored }
}

// ---------------------------------------------------------------------------
// createHandoverSubfolderAction
// ---------------------------------------------------------------------------

export type CreateFolderResult =
  | { ok: true; folderId: string; cloudMirrored: boolean }
  | { error: string }

export async function createHandoverSubfolderAction(
  projectId: string,
  parentFolderId: string,
  name: string,
): Promise<CreateFolderResult> {
  if (!isUuid(projectId)) return { error: 'Invalid project id' }
  if (!isUuid(parentFolderId)) return { error: 'Invalid parent folder id' }
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 200) return { error: 'Folder name must be 1–200 chars' }
  if (/[/\\:*?"<>|]/.test(trimmed)) return { error: 'Folder name contains illegal chars' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: parent } = await (supabase as any)
    .schema('tenants')
    .from('handover_folders')
    .select('id, organisation_id, project_id, category, cloud_folder_id')
    .eq('id', parentFolderId)
    .maybeSingle()
  if (!parent || parent.project_id !== projectId) return { error: 'Parent folder not found' }

  const cloudCtx = await loadProjectCloudContext(projectId, supabase).catch(() => null)
  let cloudFolder = null
  if (cloudCtx && parent.cloud_folder_id) {
    cloudFolder = await mirrorCreateFolder(cloudCtx, parent.cloud_folder_id, trimmed)
  }

  const { data: inserted, error } = await (supabase as any)
    .schema('tenants')
    .from('handover_folders')
    .insert({
      organisation_id: parent.organisation_id,
      project_id: projectId,
      parent_folder_id: parentFolderId,
      name: trimmed,
      category: parent.category,
      cloud_provider: cloudFolder ? cloudCtx!.provider : null,
      cloud_folder_id: cloudFolder?.id ?? null,
      cloud_folder_path: cloudFolder?.path ?? null,
      cloud_synced_at: cloudFolder ? new Date().toISOString() : null,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error || !inserted) return { error: `Insert failed: ${error?.message}` }

  revalidatePath(`/projects/${projectId}/handover`)
  return { ok: true, folderId: inserted.id as string, cloudMirrored: !!cloudFolder }
}

// ---------------------------------------------------------------------------
// uploadHandoverDocumentAction
// ---------------------------------------------------------------------------

export type UploadResult =
  | { ok: true; documentId: string; cloudMirrored: boolean }
  | { error: string }

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB — matches bucket limit in 00042

/**
 * FormData fields:
 *   projectId   — UUID
 *   folderId    — UUID (handover_folder_id; required)
 *   file        — File
 */
export async function uploadHandoverDocumentAction(
  formData: FormData,
): Promise<UploadResult> {
  const projectId = String(formData.get('projectId') ?? '')
  const folderId = String(formData.get('folderId') ?? '')
  const file = formData.get('file')

  if (!isUuid(projectId)) return { error: 'Invalid project id' }
  if (!isUuid(folderId)) return { error: 'Invalid folder id' }
  if (!(file instanceof File)) return { error: 'No file provided' }
  if (file.size === 0) return { error: 'File is empty' }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit` }
  }
  const safeName = file.name.replace(/[/\\:*?"<>|]/g, '_').slice(0, 200)
  if (!safeName) return { error: 'Filename invalid' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: folder } = await (supabase as any)
    .schema('tenants')
    .from('handover_folders')
    .select('id, organisation_id, project_id, category, folder_path, cloud_folder_id')
    .eq('id', folderId)
    .maybeSingle()
  if (!folder || folder.project_id !== projectId) return { error: 'Folder not found' }

  // Storage path: {org_id}/{project_id}/handover/{folder_path}/{ts}-{name}
  // The leading slash in folder_path is stripped so the path keys cleanly.
  const cleanFolderPath = (folder.folder_path as string).replace(/^\/+/, '').replace(/\/+/g, '/')
  const ts = Date.now()
  const storagePath = `${folder.organisation_id}/${projectId}/handover/${cleanFolderPath}/${ts}-${safeName}`

  // 1. Upload to Supabase Storage.
  const arrayBuf = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuf)
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (upErr) return { error: `Upload failed: ${upErr.message}` }

  // 2. Insert tenants.documents row linked to the handover folder.
  const { data: docRow, error: insErr } = await (supabase as any)
    .schema('tenants')
    .from('documents')
    .insert({
      organisation_id: folder.organisation_id,
      project_id: projectId,
      name: safeName,
      category: 'handover',
      storage_path: storagePath,
      mime_type: file.type || null,
      size_bytes: file.size,
      handover_folder_id: folderId,
      handover_category: folder.category,
      uploaded_by: user.id,
    })
    .select('id')
    .single()
  if (insErr || !docRow) {
    // Roll back the storage upload to avoid orphans.
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => undefined)
    return { error: `Document insert failed: ${insErr?.message}` }
  }

  // 3. Best-effort cloud mirror — only if folder has a cloud counterpart.
  let cloudMirrored = false
  if (folder.cloud_folder_id) {
    const cloudCtx = await loadProjectCloudContext(projectId, supabase).catch(() => null)
    if (cloudCtx) {
      const mirror = await mirrorUploadFile(
        cloudCtx,
        folder.cloud_folder_id as string,
        safeName,
        bytes,
        file.type || undefined,
      )
      if (mirror) {
        cloudMirrored = true
        await (supabase as any)
          .schema('tenants')
          .from('documents')
          .update({
            cloud_mirror_provider: cloudCtx.provider,
            cloud_mirror_file_id: mirror.id,
            cloud_mirror_path: mirror.path ?? null,
            cloud_mirror_synced_at: new Date().toISOString(),
          })
          .eq('id', docRow.id)
      }
    }
  }

  revalidatePath(`/projects/${projectId}/handover`)
  return { ok: true, documentId: docRow.id as string, cloudMirrored }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isUuid(s: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(s)
}

// Suppress unused-import warning for ProjectCloudContext.
export type _HandoverActionCloudContext = ProjectCloudContext

// ---------------------------------------------------------------------------
// Cloud-folder mapping actions (handover-specific — independent of the
// projects.cloud_storage_folder_id used by the documents/drawings tabs).
// ---------------------------------------------------------------------------

export type SetHandoverFolderResult = { ok: true } | { error: string }

export async function setHandoverCloudFolderAction(args: {
  projectId: string
  connectionId: string
  folderId: string
  folderPath?: string | null
}): Promise<SetHandoverFolderResult> {
  if (!isUuid(args.projectId)) return { error: 'Invalid project id' }
  if (!isUuid(args.connectionId)) return { error: 'Invalid connection id' }
  if (!args.folderId || typeof args.folderId !== 'string') {
    return { error: 'Invalid folder id' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Verify the connection belongs to the same org as the project — RLS
  // already gates both reads, but a belt-and-braces check keeps the error
  // shape user-friendly when something is mis-wired.
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('id, organisation_id')
    .eq('id', args.projectId)
    .maybeSingle()
  if (!project) return { error: 'Project not found' }

  // Persist BOTH the connection id (shared with the documents-tab mapping
  // because a provider auth is per-org, not per-tab) AND the dedicated
  // handover folder + path.
  const { error } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .update({
      cloud_storage_connection_id: args.connectionId,
      handover_cloud_folder_id: args.folderId,
      handover_cloud_folder_path: args.folderPath ?? null,
    })
    .eq('id', args.projectId)
  if (error) return { error: `Update failed: ${error.message}` }

  revalidatePath(`/projects/${args.projectId}/handover/documents`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// syncHandoverToCloudAction — push any unsynced folders + documents to the
// mapped handover cloud folder. Idempotent: only acts on rows where
// cloud_folder_id / cloud_mirror_file_id IS NULL.
//
// Use cases:
//   - Folders were initialised BEFORE a cloud mapping existed.
//   - Cloud mapping was re-pointed to a different folder (existing rows
//     keep their old IDs; clearing first + remapping + syncing pushes
//     everything fresh against the new root).
//   - Earlier cloud push failed for one folder; user re-clicks "Sync now".
//
// MAX_PER_RUN keeps a single action call bounded. Re-clicking the button
// processes the next chunk. Edge-function-style chunked sync (background
// pg_cron) is a Phase-2 if/when handover packs hit 1000s of files.
// ---------------------------------------------------------------------------

const SYNC_MAX_FOLDERS_PER_RUN = 100
const SYNC_MAX_FILES_PER_RUN = 30

export type SyncToCloudResult =
  | {
      ok: true
      foldersPushed: number
      filesPushed: number
      foldersRemaining: number
      filesRemaining: number
      failed: number
    }
  | { error: string }

export async function syncHandoverToCloudAction(
  projectId: string,
): Promise<SyncToCloudResult> {
  if (!isUuid(projectId)) return { error: 'Invalid project id' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const cloudCtx = await loadProjectCloudContext(projectId, supabase).catch(() => null)
  if (!cloudCtx) {
    return { error: 'Map a handover cloud folder first' }
  }

  let foldersPushed = 0
  let filesPushed = 0
  let failed = 0

  // ─── 1. Folders ─────────────────────────────────────────────────────────
  // Sort by folder_path ascending so parents are created before children.
  // Only fetch unsynced rows. Hard-cap at SYNC_MAX_FOLDERS_PER_RUN.
  const { data: pendingFolders } = await (supabase as any)
    .schema('tenants')
    .from('handover_folders')
    .select('id, parent_folder_id, name, folder_path, cloud_folder_id')
    .eq('project_id', projectId)
    .is('cloud_folder_id', null)
    .order('folder_path', { ascending: true })
    .limit(SYNC_MAX_FOLDERS_PER_RUN)

  // In-memory cache of folder_id → cloud_folder_id so subsequent children
  // can find their newly-created parent without an extra DB round-trip.
  const cloudParentCache = new Map<string, string>()
  for (const f of (pendingFolders ?? []) as Array<{
    id: string
    parent_folder_id: string | null
    name: string
    folder_path: string
  }>) {
    let parentCloudId: string
    if (f.parent_folder_id === null) {
      parentCloudId = cloudCtx.handoverRootFolderId
    } else if (cloudParentCache.has(f.parent_folder_id)) {
      parentCloudId = cloudParentCache.get(f.parent_folder_id)!
    } else {
      // Parent already had a cloud_folder_id (created in an earlier run).
      const { data: parentRow } = await (supabase as any)
        .schema('tenants')
        .from('handover_folders')
        .select('cloud_folder_id')
        .eq('id', f.parent_folder_id)
        .maybeSingle()
      const pcid = (parentRow as { cloud_folder_id: string | null } | null)?.cloud_folder_id
      if (!pcid) {
        // Parent isn't synced yet AND wasn't in this batch — skip; will be
        // picked up on a re-run after the parent lands.
        failed++
        continue
      }
      parentCloudId = pcid
    }

    const created = await mirrorCreateFolder(cloudCtx, parentCloudId, f.name)
    if (!created) {
      failed++
      continue
    }
    cloudParentCache.set(f.id, created.id)
    await (supabase as any)
      .schema('tenants')
      .from('handover_folders')
      .update({
        cloud_provider: cloudCtx.provider,
        cloud_folder_id: created.id,
        cloud_folder_path: created.path ?? null,
        cloud_synced_at: new Date().toISOString(),
      })
      .eq('id', f.id)
    foldersPushed++
  }

  // ─── 2. Documents ───────────────────────────────────────────────────────
  // Only files whose containing folder IS already synced (cloud_folder_id
  // NOT NULL) — otherwise we'd have nowhere to put them.
  const { data: pendingDocs } = await (supabase as any)
    .schema('tenants')
    .from('documents')
    .select('id, name, storage_path, mime_type, handover_folder_id')
    .eq('project_id', projectId)
    .not('handover_folder_id', 'is', null)
    .is('cloud_mirror_file_id', null)
    .limit(SYNC_MAX_FILES_PER_RUN)

  for (const d of (pendingDocs ?? []) as Array<{
    id: string
    name: string
    storage_path: string
    mime_type: string | null
    handover_folder_id: string
  }>) {
    // Folder cloud_folder_id from either cache (just created this run) or
    // DB (synced earlier).
    let folderCloudId = cloudParentCache.get(d.handover_folder_id)
    if (!folderCloudId) {
      const { data: fr } = await (supabase as any)
        .schema('tenants')
        .from('handover_folders')
        .select('cloud_folder_id')
        .eq('id', d.handover_folder_id)
        .maybeSingle()
      folderCloudId =
        (fr as { cloud_folder_id: string | null } | null)?.cloud_folder_id ?? undefined
    }
    if (!folderCloudId) {
      failed++
      continue
    }

    // Download bytes from Supabase Storage.
    const dl = await supabase.storage.from(BUCKET).download(d.storage_path)
    if (dl.error || !dl.data) {
      failed++
      continue
    }
    const bytes = new Uint8Array(await dl.data.arrayBuffer())

    const mirror = await mirrorUploadFile(
      cloudCtx,
      folderCloudId,
      d.name,
      bytes,
      d.mime_type ?? undefined,
    )
    if (!mirror) {
      failed++
      continue
    }

    await (supabase as any)
      .schema('tenants')
      .from('documents')
      .update({
        cloud_mirror_provider: cloudCtx.provider,
        cloud_mirror_file_id: mirror.id,
        cloud_mirror_path: mirror.path ?? null,
        cloud_mirror_synced_at: new Date().toISOString(),
      })
      .eq('id', d.id)
    filesPushed++
  }

  // ─── 3. Compute remaining counts for the UI ─────────────────────────────
  const { count: foldersRemaining } = await (supabase as any)
    .schema('tenants')
    .from('handover_folders')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .is('cloud_folder_id', null)
  const { count: filesRemaining } = await (supabase as any)
    .schema('tenants')
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .not('handover_folder_id', 'is', null)
    .is('cloud_mirror_file_id', null)

  revalidatePath(`/projects/${projectId}/handover/documents`)
  return {
    ok: true,
    foldersPushed,
    filesPushed,
    foldersRemaining: foldersRemaining ?? 0,
    filesRemaining: filesRemaining ?? 0,
    failed,
  }
}

export async function clearHandoverCloudFolderAction(
  projectId: string,
): Promise<SetHandoverFolderResult> {
  if (!isUuid(projectId)) return { error: 'Invalid project id' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .update({
      handover_cloud_folder_id: null,
      handover_cloud_folder_path: null,
    })
    .eq('id', projectId)
  if (error) return { error: `Clear failed: ${error.message}` }

  revalidatePath(`/projects/${projectId}/handover/documents`)
  return { ok: true }
}
