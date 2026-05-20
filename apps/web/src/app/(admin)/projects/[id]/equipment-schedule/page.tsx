import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, listNodes } from '@esite/shared'
import { Card, CardBody } from '@/components/ui/Card'
import { EquipmentTable } from './_components/EquipmentTable'
import type { NodeOrderData } from './_components/NodeOrderCell'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Equipment Schedule' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function EquipmentSchedulePage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  // ── Load all structure nodes for this project ─────────────────────────────
  // listNodes reads via .schema('structure') SELECT — reads are safe, only writes
  // are affected by the cross-schema service-role gotcha.
  // We load ALL kinds (no filter) so the EquipmentTable can compute existingCodes
  // across every kind for the code-uniqueness check.
  let nodes: Awaited<ReturnType<typeof listNodes>> = []
  let loadError: string | null = null

  try {
    nodes = await listNodes(supabase as never, projectId)
  } catch (err: unknown) {
    loadError = err instanceof Error ? err.message : 'Could not load equipment data'
  }

  // ── Load node_orders for equipment nodes (best-effort) ────────────────────
  // Equipment orders have scope_item_type_id = NULL (design-doc §4).
  // READ via .schema('structure') is safe — cross-schema gotcha is writes-only.
  const ordersByNodeId: Record<string, NodeOrderData> = {}
  const equipmentNodeIds = nodes.filter((n) => n.kind !== 'tenant_db').map((n) => n.id)

  if (equipmentNodeIds.length > 0) {
    try {
      const { data: orders } = await (supabase as any)
        .schema('structure')
        .from('node_orders')
        .select('id, node_id, status')
        .in('node_id', equipmentNodeIds)
        .is('scope_item_type_id', null)

      if (orders) {
        for (const o of orders as Array<{ id: string; node_id: string; status: NodeOrderData['status'] }>) {
          ordersByNodeId[o.node_id] = { id: o.id, status: o.status }
        }
      }
    } catch {
      // Non-fatal: order status column simply shows "—" if unavailable
    }
  }

  const equipmentNodes = nodes.filter((n) => n.kind !== 'tenant_db')
  const activeCount = equipmentNodes.filter((n) => n.status === 'active').length
  const totalCount = equipmentNodes.length

  return (
    <div className="animate-fadeup">
      {/* Breadcrumb */}
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← {project.name}
        </Link>
      </div>

      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Equipment Schedule</h1>
          <p className="page-subtitle">
            {project.name}
            {totalCount > 0 &&
              ` · ${activeCount} active item${activeCount !== 1 ? 's' : ''}${totalCount !== activeCount ? ` (${totalCount} total)` : ''}`}
          </p>
        </div>
      </div>

      {/* Fetch error */}
      {loadError && (
        <div
          style={{
            padding: '12px 16px',
            marginBottom: 16,
            background: 'var(--c-red-dim)',
            border: '1px solid var(--c-red)',
            borderRadius: 6,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--c-red)' }}>
            Could not load the equipment schedule.
          </div>
          <div style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{loadError}</div>
        </div>
      )}

      {/* Equipment table — grouped by kind, all CRUD inline */}
      <EquipmentTable nodes={nodes} projectId={projectId} ordersByNodeId={ordersByNodeId} />
    </div>
  )
}
