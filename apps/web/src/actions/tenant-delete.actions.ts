'use server'

/**
 * tenant-delete.actions.ts — hard-delete a tenant board (structure.nodes,
 * kind='tenant_db') from the Tenant Schedule. DESTRUCTIVE + irreversible.
 *
 *   - getTenantDeleteSummaryAction — pre-flight: blockers OR the destruction summary
 *   - hardDeleteTenantAction       — the orchestrated destroy
 *
 * Permission: owner / admin / project_manager (ORG_WRITE_ROLES), matching every
 * other destructive action — enforced via guardProjectAccess → requireEffectiveRole.
 *
 * Cross-schema WRITES use the raw-fetch + service-role PostgREST pattern (the
 * supabase-js `.schema().delete()` silently strips the service-role auth header —
 * documented gotcha). A generic `serviceDelete(schema, table, filter)` parameterises
 * the Content-Profile so we can delete across structure / cable_schedule / tenants.
 * READS go through the cookie-authenticated supabase-js client (RLS-gated).
 *
 * Cascade (a single DELETE FROM structure.nodes WHERE id=:node cascades, FK
 * ON DELETE CASCADE): tenant_details, tenant_scope_items, tenant_units,
 * tenant_documents → tenant_document_revisions, node_orders → node_order_documents
 * + node_order_shop_drawings. inspections.inspections.target_node_id is SET NULL.
 * The DB cascade does NOT touch Storage objects, nor the handover tenants.documents
 * rows (linked only by a plain UUID node_order_shop_drawings.handover_document_id,
 * no FK) — both are handled explicitly here.
 *
 * The delete is BLOCKED (NO-ACTION FKs) when the node is referenced by
 * cable_schedule.supplies in an ISSUED revision, or has child nodes
 * (parent_node_id). DRAFT-revision supplies referencing the node are removed
 * first (a cable run to a deleted board is meaningless; only DRAFT is mutated).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, ORG_WRITE_ROLES } from '@esite/shared'

const TENANT_DOCS_BUCKET = 'tenant-documents'
const NODE_ORDER_DOCS_BUCKET = 'node-order-documents'
const HANDOVER_BUCKET = 'project-documents'

// ---------------------------------------------------------------------------
// Exported result types
// ---------------------------------------------------------------------------

export interface TenantDeleteCounts {
  scopeItems: number
  documents: number
  documentRevisions: number
  units: number
  orders: number
  shopDrawings: number
  orderDocuments: number
  cableSupplies: number
  inspectionsTargeting: number
  storageFiles: number
}

export type TenantDeleteSummary =
  | { blocked: true; reason: string }
  | { ok: true; code: string; name: string | null; counts: TenantDeleteCounts }
  | { error: string }

export type HardDeleteResult = { ok: true } | { error: string }

// ---------------------------------------------------------------------------
// Generic service-role raw-fetch DELETE (mirrors structureDelete, but the
// Content-Profile schema is a parameter — needed for cross-schema deletes).
// ---------------------------------------------------------------------------

async function serviceDelete(
  supabaseUrl: string,
  serviceKey: string,
  schema: string,
  table: string,
  filterQuery: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Content-Profile': schema,
      Prefer: 'return=minimal',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `DELETE ${schema}.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Guards (mirror tenant-documents.actions.ts)
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid()

/** Write guard: auth + project exists + caller holds an ORG_WRITE_ROLES role. */
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

interface TenantNodeRow {
  id: string
  kind: string
  code: string
  name: string | null
  status: string
}

/**
 * Load the node, assert it belongs to the project AND is a tenant_db.
 * Reads through the RLS-gated cookie client.
 */
async function loadTenantNode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nodeId: string,
  projectId: string,
): Promise<{ node: TenantNodeRow } | { error: string }> {
  const { data: node } = await (supabase as any)
    .schema('structure')
    .from('nodes')
    .select('id, kind, code, name, status')
    .eq('id', nodeId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!node) return { error: 'Tenant not found' }
  if ((node as TenantNodeRow).kind !== 'tenant_db') {
    return { error: 'This action can only delete a tenant board' }
  }
  return { node: node as TenantNodeRow }
}

/**
 * Compute the two NO-ACTION-FK blockers:
 *   - issued-revision supplies referencing the node (from_node_id OR to_node_id)
 *   - child nodes (parent_node_id = node)
 *
 * Returns the supplies referencing the node (joined with revision status) so the
 * caller can both classify blockers and count/delete the DRAFT ones.
 */
interface SupplyRow {
  id: string
  revision: { status?: string } | null
}

async function readBlockerInputs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nodeId: string,
): Promise<{ supplies: SupplyRow[]; childCount: number }> {
  const { data: supplies } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .select('id, revision:revisions!revision_id(status)')
    .or(`from_node_id.eq.${nodeId},to_node_id.eq.${nodeId}`)

  const { data: children } = await (supabase as any)
    .schema('structure')
    .from('nodes')
    .select('id')
    .eq('parent_node_id', nodeId)

  return {
    supplies: (supplies as SupplyRow[]) ?? [],
    childCount: ((children as Array<{ id: string }>) ?? []).length,
  }
}

/** A blocking reason, or null if the node is deletable. */
function blockerReason(supplies: SupplyRow[], childCount: number): string | null {
  const issued = supplies.filter((s) => s.revision?.status && s.revision.status !== 'DRAFT')
  if (issued.length > 0) {
    return 'This tenant is wired into an issued cable revision. Start a new revision (or remove the connection from the draft) before deleting.'
  }
  if (childCount > 0) {
    return `This tenant board has ${childCount} sub-board${childCount === 1 ? '' : 's'} nested under it. Delete or re-parent them first.`
  }
  return null
}

// ---------------------------------------------------------------------------
// getTenantDeleteSummaryAction
// ---------------------------------------------------------------------------

export async function getTenantDeleteSummaryAction(
  projectId: string,
  nodeId: string,
): Promise<TenantDeleteSummary> {
  const parsed = z.object({ projectId: uuidSchema, nodeId: uuidSchema }).safeParse({ projectId, nodeId })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const loaded = await loadTenantNode(guard.supabase, nodeId, projectId)
  if ('error' in loaded) return { error: loaded.error }
  const { node } = loaded

  const { supplies, childCount } = await readBlockerInputs(guard.supabase, nodeId)
  const blocked = blockerReason(supplies, childCount)
  if (blocked) return { blocked: true, reason: blocked }

  const sb = guard.supabase as any

  // Read the count inputs. Document revisions, order-documents and shop-drawings
  // are read via the node's parent rows; storageFiles sums the storage-path-bearing
  // rows (the DB cascade won't remove the underlying objects).
  const [
    scopeRes,
    docsRes,
    unitsRes,
    ordersRes,
    inspRes,
  ] = await Promise.all([
    sb.schema('structure').from('tenant_scope_items').select('id').eq('node_id', nodeId),
    sb.schema('structure').from('tenant_documents').select('id').eq('node_id', nodeId),
    sb.schema('structure').from('tenant_units').select('id').eq('node_id', nodeId),
    sb.schema('structure').from('node_orders').select('id').eq('node_id', nodeId),
    sb.schema('inspections').from('inspections').select('id').eq('target_node_id', nodeId),
  ])

  const docIds = ((docsRes.data as Array<{ id: string }>) ?? []).map((d) => d.id)
  const orderIds = ((ordersRes.data as Array<{ id: string }>) ?? []).map((o) => o.id)

  // Revisions of the node's documents; order-docs + shop-drawings of the node's orders.
  const [revsRes, orderDocsRes, drawingsRes] = await Promise.all([
    docIds.length
      ? sb.schema('structure').from('tenant_document_revisions').select('id, storage_path').in('tenant_document_id', docIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? sb.schema('structure').from('node_order_documents').select('id, storage_path').in('node_order_id', orderIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? sb.schema('structure').from('node_order_shop_drawings').select('id, storage_path, handover_document_id').in('node_order_id', orderIds)
      : Promise.resolve({ data: [] }),
  ])

  const revs = (revsRes.data as Array<{ storage_path: string }>) ?? []
  const orderDocs = (orderDocsRes.data as Array<{ storage_path: string }>) ?? []
  const drawings = (drawingsRes.data as Array<{ storage_path: string; handover_document_id: string | null }>) ?? []
  const handoverCount = drawings.filter((d) => d.handover_document_id).length

  const counts: TenantDeleteCounts = {
    scopeItems: ((scopeRes.data as unknown[]) ?? []).length,
    documents: docIds.length,
    documentRevisions: revs.length,
    units: ((unitsRes.data as unknown[]) ?? []).length,
    orders: orderIds.length,
    shopDrawings: drawings.length,
    orderDocuments: orderDocs.length,
    cableSupplies: supplies.length,
    inspectionsTargeting: ((inspRes.data as unknown[]) ?? []).length,
    // Every stored object the cascade leaves orphaned: doc revisions, order docs,
    // shop drawings, and the handover copies of approved shop drawings.
    storageFiles: revs.length + orderDocs.length + drawings.length + handoverCount,
  }

  return { ok: true, code: node.code, name: node.name, counts }
}

// ---------------------------------------------------------------------------
// hardDeleteTenantAction
// ---------------------------------------------------------------------------

export async function hardDeleteTenantAction(
  projectId: string,
  nodeId: string,
): Promise<HardDeleteResult> {
  const parsed = z.object({ projectId: uuidSchema, nodeId: uuidSchema }).safeParse({ projectId, nodeId })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const loaded = await loadTenantNode(guard.supabase, nodeId, projectId)
  if ('error' in loaded) return { error: loaded.error }

  // 1. Re-check the blockers (defends against a stale pre-flight).
  const { supplies, childCount } = await readBlockerInputs(guard.supabase, nodeId)
  const blocked = blockerReason(supplies, childCount)
  if (blocked) return { error: blocked }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const sb = guard.supabase as any

  // 2. Collect storage paths + handover doc ids BEFORE deleting — the joins die
  //    with the cascade, so everything must be gathered up front.
  const { data: docsForNode } = await sb
    .schema('structure').from('tenant_documents').select('id').eq('node_id', nodeId)
  const docIds = ((docsForNode as Array<{ id: string }>) ?? []).map((d) => d.id)

  const { data: ordersForNode } = await sb
    .schema('structure').from('node_orders').select('id').eq('node_id', nodeId)
  const orderIds = ((ordersForNode as Array<{ id: string }>) ?? []).map((o) => o.id)

  const [revsRes, orderDocsRes, drawingsRes] = await Promise.all([
    docIds.length
      ? sb.schema('structure').from('tenant_document_revisions').select('storage_path').in('tenant_document_id', docIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? sb.schema('structure').from('node_order_documents').select('storage_path').in('node_order_id', orderIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? sb.schema('structure').from('node_order_shop_drawings').select('storage_path, handover_document_id').in('node_order_id', orderIds)
      : Promise.resolve({ data: [] }),
  ])

  const tenantDocPaths = ((revsRes.data as Array<{ storage_path: string }>) ?? [])
    .map((r) => r.storage_path).filter(Boolean)
  const nodeOrderPaths = [
    ...((orderDocsRes.data as Array<{ storage_path: string }>) ?? []).map((r) => r.storage_path),
    ...((drawingsRes.data as Array<{ storage_path: string }>) ?? []).map((r) => r.storage_path),
  ].filter(Boolean)

  // Handover copies: each approved shop drawing points to a tenants.documents row
  // (plain UUID, no FK) → resolve its storage_path (project-documents bucket) and
  // its id (the row must be deleted explicitly — nothing cascades it).
  const handoverDocIds = ((drawingsRes.data as Array<{ handover_document_id: string | null }>) ?? [])
    .map((d) => d.handover_document_id)
    .filter((id): id is string => !!id)

  const handoverPaths: string[] = []
  if (handoverDocIds.length) {
    const { data: handoverDocs } = await sb
      .schema('tenants').from('documents').select('id, storage_path').in('id', handoverDocIds)
    for (const row of ((handoverDocs as Array<{ storage_path: string }>) ?? [])) {
      if (row.storage_path) handoverPaths.push(row.storage_path)
    }
  }

  // 3. Delete the handover tenants.documents rows (no FK removes them).
  if (handoverDocIds.length) {
    const del = await serviceDelete(supabaseUrl, serviceKey, 'tenants', 'documents', `id=in.(${handoverDocIds.join(',')})`)
    if (!del.ok) return { error: del.error ?? 'Failed to delete handover documents' }
  }

  // 4. Delete the DRAFT-revision cable supplies referencing the node. The blocker
  //    check above guarantees every referencing supply is in a DRAFT revision, so
  //    removing all referencing supplies (from + to) is safe.
  const fromDel = await serviceDelete(supabaseUrl, serviceKey, 'cable_schedule', 'supplies', `from_node_id=eq.${nodeId}`)
  if (!fromDel.ok) return { error: fromDel.error ?? 'Failed to remove cable connections' }
  const toDel = await serviceDelete(supabaseUrl, serviceKey, 'cable_schedule', 'supplies', `to_node_id=eq.${nodeId}`)
  if (!toDel.ok) return { error: toDel.error ?? 'Failed to remove cable connections' }

  // 5. Delete the node — cascades tenant_details / scope / units / documents +
  //    revisions / orders + order-docs + shop-drawings; nulls inspection targets.
  const nodeDel = await serviceDelete(supabaseUrl, serviceKey, 'structure', 'nodes', `id=eq.${nodeId}`)
  if (!nodeDel.ok) return { error: nodeDel.error ?? 'Failed to delete the tenant board' }

  // 6. Best-effort storage cleanup — the rows are gone; orphaned objects are
  //    tolerable, so a storage failure must NOT fail the action.
  try {
    if (tenantDocPaths.length) await guard.supabase.storage.from(TENANT_DOCS_BUCKET).remove(tenantDocPaths)
    if (nodeOrderPaths.length) await guard.supabase.storage.from(NODE_ORDER_DOCS_BUCKET).remove(nodeOrderPaths)
    if (handoverPaths.length) await guard.supabase.storage.from(HANDOVER_BUCKET).remove(handoverPaths)
  } catch {
    // ignore — orphaned storage objects are acceptable
  }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  revalidatePath(`/projects/${projectId}/equipment-materials`)
  revalidatePath(`/projects/${projectId}/cables`)
  return { ok: true }
}
