'use server'

/**
 * tenant-documents.actions.ts — server actions for per-tenant document tracking.
 *
 * Covers:
 *   - listTenantDocumentsAction         — list docs + nested revisions for a node
 *   - createTenantDocumentAction        — create a new document + first revision
 *   - addTenantDocumentRevisionAction   — add a revision to an existing document
 *   - renameTenantDocumentAction        — rename a document
 *   - reorderTenantDocumentsAction      — update sort_order for a set of docs
 *   - deleteTenantDocumentRevisionAction — delete a revision + storage object
 *   - deleteTenantDocumentAction        — delete a document + all revisions + storage objects
 *   - getRevisionSignedUrlAction        — short-lived signed URL for a revision
 *
 * Cross-schema write pattern: same as tenant-scope.actions.ts — raw fetch with
 * Content-Profile: structure + service-role key for all writes. Reads go through
 * the cookie-authenticated supabase-js client (RLS-gated).
 *
 * DB triggers auto-derive tenant_details.layout_status / scope_status — these
 * actions do NOT set status manually.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, ORG_WRITE_ROLES } from '@esite/shared'

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type TenantDocumentKind = 'layout' | 'scope'

export interface TenantDocumentRevision {
  id: string
  tenant_document_id: string
  rev_label: string
  storage_path: string
  file_name: string
  note: string | null
  issued_at: string
  uploaded_by: string | null
  created_at: string
}

export interface TenantDocument {
  id: string
  node_id: string
  kind: TenantDocumentKind
  title: string
  sort_order: number
  revisions: TenantDocumentRevision[] // newest first; [0] = current
}

// ---------------------------------------------------------------------------
// Shared structure-write helpers (mirror tenant-scope.actions.ts)
// TODO: these structure-write helpers + guards are duplicated across tenant-scope/node-order/node-order-shop-drawing/tenant-documents action files; extract to apps/web/src/lib/structure/service-write-helpers.ts once those files are stabilised.
// ---------------------------------------------------------------------------

function structureHeaders(serviceKey: string): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'structure',
    Prefer: 'return=representation',
  }
}

async function structurePost(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  body: Record<string, unknown>,
  queryString = '',
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const url = `${supabaseUrl}/rest/v1/${table}${queryString ? `?${queryString}` : ''}`
  const res = await fetch(url, {
    method: 'POST',
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `INSERT structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true, data: await res.json() }
}

async function structurePatch(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `PATCH structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true }
}

async function structureDelete(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'DELETE',
    headers: structureHeaders(serviceKey),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `DELETE structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Auth + project-access guards
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid()

/**
 * Read guard: verifies the caller is authenticated and the project exists.
 * No role check — row-level access is enforced by RLS on the cookie client.
 * Use for list / signed-URL actions that narrower project members must access.
 */
async function guardProjectRead(projectId: string): Promise<
  | { error: string; orgId?: undefined; supabase?: undefined; user?: undefined }
  | { error?: undefined; user: { id: string } & object; orgId: string; supabase: Awaited<ReturnType<typeof createClient>> }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { error: 'Project not found' }

  return { user: user as { id: string } & object, orgId: project.organisation_id as string, supabase }
}

/** Write guard: verifies auth + project exists + caller has an ORG_WRITE_ROLES role. */
async function guardProjectAccess(projectId: string): Promise<
  | { error: string; orgId?: undefined; supabase?: undefined; user?: undefined }
  | { error?: undefined; user: { id: string } & object; orgId: string; supabase: Awaited<ReturnType<typeof createClient>> }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { error: 'Project not found' }

  const roleGate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!roleGate.ok) return { error: roleGate.error }

  return { user: user as { id: string } & object, orgId: project.organisation_id as string, supabase }
}

/**
 * Validate that nodeId belongs to projectId using the RLS-gated cookie client.
 */
async function guardNodeBelongsToProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nodeId: string,
  projectId: string,
): Promise<{ error: string } | null> {
  const { data: node } = await (supabase as any)
    .schema('structure')
    .from('nodes')
    .select('id')
    .eq('id', nodeId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!node) return { error: 'Node not found' }
  return null
}

// ---------------------------------------------------------------------------
// listTenantDocumentsAction
// ---------------------------------------------------------------------------

export async function listTenantDocumentsAction(
  projectId: string,
  nodeId: string,
): Promise<{ documents: TenantDocument[] } | { error: string }> {
  const parsed = z.object({ projectId: uuidSchema, nodeId: uuidSchema }).safeParse({ projectId, nodeId })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  // Auth + project-exists check only. Reads are allowed for any project member —
  // the cookie client is RLS-gated so non-members see nothing. No role gate here.
  const guard = await guardProjectRead(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const supabase = guard.supabase as any

  const { data: docs, error: docsErr } = await supabase
    .schema('structure')
    .from('tenant_documents')
    .select('id, node_id, kind, title, sort_order')
    .eq('node_id', nodeId)
    .order('kind', { ascending: true })
    .order('sort_order', { ascending: true })

  if (docsErr) return { error: docsErr.message ?? 'Failed to load documents' }

  const docRows: Array<{ id: string; node_id: string; kind: TenantDocumentKind; title: string; sort_order: number }> =
    docs ?? []

  if (docRows.length === 0) return { documents: [] }

  const docIds = docRows.map((d) => d.id)

  const { data: revs, error: revsErr } = await supabase
    .schema('structure')
    .from('tenant_document_revisions')
    .select('id, tenant_document_id, rev_label, storage_path, file_name, note, issued_at, uploaded_by, created_at')
    .in('tenant_document_id', docIds)
    .order('issued_at', { ascending: false })

  if (revsErr) return { error: revsErr.message ?? 'Failed to load revisions' }

  const revRows: TenantDocumentRevision[] = revs ?? []

  // Group revisions under their document (newest first — already sorted by the DB query)
  const revsByDocId = new Map<string, TenantDocumentRevision[]>()
  for (const rev of revRows) {
    const list = revsByDocId.get(rev.tenant_document_id) ?? []
    list.push(rev)
    revsByDocId.set(rev.tenant_document_id, list)
  }

  const documents: TenantDocument[] = docRows.map((doc) => ({
    ...doc,
    revisions: revsByDocId.get(doc.id) ?? [],
  }))

  return { documents }
}

// ---------------------------------------------------------------------------
// createTenantDocumentAction
// ---------------------------------------------------------------------------

const createDocumentSchema = z.object({
  projectId: uuidSchema,
  nodeId: uuidSchema,
  kind: z.enum(['layout', 'scope']),
  title: z.string().min(1).max(200),
  firstRevision: z.object({
    storagePath: z.string().min(1),
    fileName: z.string().min(1),
    revLabel: z.string().min(1).max(50),
    note: z.string().nullable().optional(),
  }),
})

export async function createTenantDocumentAction(
  projectId: string,
  nodeId: string,
  kind: TenantDocumentKind,
  title: string,
  firstRevision: { storagePath: string; fileName: string; revLabel: string; note?: string | null },
): Promise<{ ok: true; documentId: string } | { error: string }> {
  const parsed = createDocumentSchema.safeParse({ projectId, nodeId, kind, title, firstRevision })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const docResult = await structurePost(supabaseUrl, serviceKey, 'tenant_documents', {
    node_id: nodeId,
    kind,
    title: parsed.data.title,
    sort_order: 0,
  })

  if (!docResult.ok) return { error: docResult.error ?? 'Failed to create document' }

  const docRows = docResult.data as Array<{ id: string }>
  const documentId = docRows?.[0]?.id
  if (!documentId) return { error: 'INSERT returned no document row' }

  const userId = (guard.user as { id: string }).id

  const revResult = await structurePost(supabaseUrl, serviceKey, 'tenant_document_revisions', {
    tenant_document_id: documentId,
    rev_label: parsed.data.firstRevision.revLabel,
    storage_path: parsed.data.firstRevision.storagePath,
    file_name: parsed.data.firstRevision.fileName,
    note: parsed.data.firstRevision.note ?? null,
    issued_at: new Date().toISOString(),
    uploaded_by: userId,
  })

  if (!revResult.ok) return { error: revResult.error ?? 'Failed to create first revision' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true, documentId }
}

// ---------------------------------------------------------------------------
// addTenantDocumentRevisionAction
// ---------------------------------------------------------------------------

const addRevisionSchema = z.object({
  projectId: uuidSchema,
  documentId: uuidSchema,
  rev: z.object({
    storagePath: z.string().min(1),
    fileName: z.string().min(1),
    revLabel: z.string().min(1).max(50),
    note: z.string().nullable().optional(),
  }),
})

export async function addTenantDocumentRevisionAction(
  projectId: string,
  documentId: string,
  rev: { storagePath: string; fileName: string; revLabel: string; note?: string | null },
): Promise<{ ok: true } | { error: string }> {
  const parsed = addRevisionSchema.safeParse({ projectId, documentId, rev })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  // Verify the document belongs to this project before the service-role write
  const { data: doc } = await (guard.supabase as any)
    .schema('structure')
    .from('tenant_documents')
    .select('node_id')
    .eq('id', documentId)
    .maybeSingle()
  if (!doc) return { error: 'Document not found' }
  const nodeErr = await guardNodeBelongsToProject(guard.supabase, (doc as { node_id: string }).node_id, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const userId = (guard.user as { id: string }).id

  const revResult = await structurePost(supabaseUrl, serviceKey, 'tenant_document_revisions', {
    tenant_document_id: documentId,
    rev_label: parsed.data.rev.revLabel,
    storage_path: parsed.data.rev.storagePath,
    file_name: parsed.data.rev.fileName,
    note: parsed.data.rev.note ?? null,
    issued_at: new Date().toISOString(),
    uploaded_by: userId,
  })

  if (!revResult.ok) return { error: revResult.error ?? 'Failed to add revision' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// renameTenantDocumentAction
// ---------------------------------------------------------------------------

const renameSchema = z.object({
  projectId: uuidSchema,
  documentId: uuidSchema,
  title: z.string().min(1).max(200),
})

export async function renameTenantDocumentAction(
  projectId: string,
  documentId: string,
  title: string,
): Promise<{ ok: true } | { error: string }> {
  const parsed = renameSchema.safeParse({ projectId, documentId, title })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  // Verify the document belongs to this project before the service-role write
  const { data: doc } = await (guard.supabase as any)
    .schema('structure')
    .from('tenant_documents')
    .select('node_id')
    .eq('id', documentId)
    .maybeSingle()
  if (!doc) return { error: 'Document not found' }
  const nodeErr = await guardNodeBelongsToProject(guard.supabase, (doc as { node_id: string }).node_id, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const result = await structurePatch(
    supabaseUrl,
    serviceKey,
    'tenant_documents',
    `id=eq.${documentId}`,
    { title: parsed.data.title },
  )

  if (!result.ok) return { error: result.error ?? 'Failed to rename document' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// reorderTenantDocumentsAction
// ---------------------------------------------------------------------------

const reorderSchema = z.object({
  projectId: uuidSchema,
  nodeId: uuidSchema,
  kind: z.enum(['layout', 'scope']),
  orderedIds: z.array(uuidSchema).min(1),
})

export async function reorderTenantDocumentsAction(
  projectId: string,
  nodeId: string,
  kind: TenantDocumentKind,
  orderedIds: string[],
): Promise<{ ok: true } | { error: string }> {
  const parsed = reorderSchema.safeParse({ projectId, nodeId, kind, orderedIds })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, parsed.data.nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // Patch each document with its new sort_order (index position).
  // Scoping to node_id ensures a stray/foreign document id is a no-op.
  for (let i = 0; i < parsed.data.orderedIds.length; i++) {
    const id = parsed.data.orderedIds[i]
    const result = await structurePatch(
      supabaseUrl,
      serviceKey,
      'tenant_documents',
      `id=eq.${id}&node_id=eq.${parsed.data.nodeId}`,
      { sort_order: i },
    )
    if (!result.ok) return { error: result.error ?? `Failed to reorder document ${id}` }
  }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// deleteTenantDocumentRevisionAction
// ---------------------------------------------------------------------------

const deleteRevisionSchema = z.object({
  projectId: uuidSchema,
  revisionId: uuidSchema,
})

export async function deleteTenantDocumentRevisionAction(
  projectId: string,
  revisionId: string,
): Promise<{ ok: true } | { error: string }> {
  const parsed = deleteRevisionSchema.safeParse({ projectId, revisionId })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // Read the storage_path + owning document before deleting
  const { data: rev } = await (guard.supabase as any)
    .schema('structure')
    .from('tenant_document_revisions')
    .select('id, storage_path, tenant_document_id')
    .eq('id', revisionId)
    .maybeSingle()

  if (!rev) return { error: 'Revision not found' }

  const revRow = rev as { storage_path: string; tenant_document_id: string }
  const storagePath: string = revRow.storage_path

  // Verify the owning document belongs to this project before the service-role delete
  const { data: docForRev } = await (guard.supabase as any)
    .schema('structure')
    .from('tenant_documents')
    .select('node_id')
    .eq('id', revRow.tenant_document_id)
    .maybeSingle()
  if (!docForRev) return { error: 'Document not found' }
  const revNodeErr = await guardNodeBelongsToProject(
    guard.supabase,
    (docForRev as { node_id: string }).node_id,
    projectId,
  )
  if (revNodeErr) return revNodeErr

  const result = await structureDelete(
    supabaseUrl,
    serviceKey,
    'tenant_document_revisions',
    `id=eq.${revisionId}`,
  )

  if (!result.ok) return { error: result.error ?? 'Failed to delete revision' }

  // Best-effort storage removal — row is already gone
  await guard.supabase.storage.from('tenant-documents').remove([storagePath])

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// deleteTenantDocumentAction
// ---------------------------------------------------------------------------

const deleteDocumentSchema = z.object({
  projectId: uuidSchema,
  documentId: uuidSchema,
})

export async function deleteTenantDocumentAction(
  projectId: string,
  documentId: string,
): Promise<{ ok: true } | { error: string }> {
  const parsed = deleteDocumentSchema.safeParse({ projectId, documentId })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // Verify the document belongs to this project before the service-role delete
  const { data: docToDelete } = await (guard.supabase as any)
    .schema('structure')
    .from('tenant_documents')
    .select('node_id')
    .eq('id', documentId)
    .maybeSingle()
  if (!docToDelete) return { error: 'Document not found' }
  const deleteNodeErr = await guardNodeBelongsToProject(
    guard.supabase,
    (docToDelete as { node_id: string }).node_id,
    projectId,
  )
  if (deleteNodeErr) return deleteNodeErr

  // Read all revision storage paths before deleting
  const { data: revs } = await (guard.supabase as any)
    .schema('structure')
    .from('tenant_document_revisions')
    .select('id, storage_path')
    .eq('tenant_document_id', documentId)

  const storagePaths: string[] = ((revs as Array<{ storage_path: string }>) ?? []).map((r) => r.storage_path)

  // Delete the document row — revisions cascade in the DB
  const result = await structureDelete(
    supabaseUrl,
    serviceKey,
    'tenant_documents',
    `id=eq.${documentId}`,
  )

  if (!result.ok) return { error: result.error ?? 'Failed to delete document' }

  // Best-effort storage removal for all revision objects
  if (storagePaths.length > 0) {
    await guard.supabase.storage.from('tenant-documents').remove(storagePaths)
  }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// getRevisionSignedUrlAction
// ---------------------------------------------------------------------------

const signedUrlSchema = z.object({
  projectId: uuidSchema,
  revisionId: uuidSchema,
})

export async function getRevisionSignedUrlAction(
  projectId: string,
  revisionId: string,
): Promise<{ ok: true; url: string } | { error: string }> {
  const parsed = signedUrlSchema.safeParse({ projectId, revisionId })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  // Read-only — any project member may fetch a signed URL; RLS enforces row access.
  const guard = await guardProjectRead(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  // Look up the storage path for this revision
  const { data: rev } = await (guard.supabase as any)
    .schema('structure')
    .from('tenant_document_revisions')
    .select('id, storage_path')
    .eq('id', revisionId)
    .maybeSingle()

  if (!rev) return { error: 'Revision not found' }

  const storagePath: string = (rev as { storage_path: string }).storage_path

  const { data, error } = await guard.supabase.storage
    .from('tenant-documents')
    .createSignedUrl(storagePath, 300)

  if (error || !data?.signedUrl) return { error: error?.message ?? 'Could not generate signed URL' }

  return { ok: true, url: data.signedUrl }
}
