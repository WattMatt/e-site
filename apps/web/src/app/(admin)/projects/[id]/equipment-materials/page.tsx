/**
 * Equipment & Materials — the unified board-centric tab.
 *
 * One list where the BOARD is the unit of work and its procurement (status,
 * dates, documents) is an expandable detail. Existence-driven: every
 * structure.nodes row appears (D5); procurement is attached from node_orders.
 * Equipment boards carry one order; tenant/shop boards carry their scope-order
 * lines + a rollup.
 *
 * All reads go through loadEquipmentMaterialsData, which the PDF report shares —
 * the register on screen and the register in a saved report cannot drift apart.
 *
 * Read pattern: .schema('structure') SELECT is safe (the cross-schema gotcha is
 * writes-only). Writes go through the existing node-order.actions.ts /
 * node-order-document.actions.ts / node-order-shop-drawing.actions.ts.
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { Card, CardBody } from '@/components/ui/Card'
import { gatherUnifiedBoards, type ProcStatus } from '@/lib/equipment-materials/gather-unified-boards'
import { loadEquipmentMaterialsData } from '@/lib/equipment-materials/load'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import { listProjectReportsAction } from '@/actions/project-reports.actions'
import { UnifiedBoardGroup } from './_components/UnifiedBoardGroup'
import { AddBoardToolbar } from './_components/AddBoardToolbar'
import { EquipmentMaterialsReportButton } from './_components/EquipmentMaterialsReportButton'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Equipment & Materials' }

// ---------------------------------------------------------------------------
// Status pills — by_tenant is shown here (unlike the old Materials buy-list)
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<ProcStatus, string> = {
  by_tenant: 'By tenant',
  required: 'Required',
  ordered: 'Ordered',
  received: 'Received',
}
const STATUS_ORDER: ProcStatus[] = ['required', 'ordered', 'received', 'by_tenant']

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ status?: string; showDecommissioned?: string }>
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function EquipmentMaterialsPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { status: statusFilter, showDecommissioned: showDecomParam } = await searchParams

  const supabase = await createClient()

  // Every read lives in loadEquipmentMaterialsData, which the PDF report also
  // uses — so the register on screen and the register in a saved deliverable
  // cannot drift apart.
  const load = await loadEquipmentMaterialsData(supabase, projectId)
  if (!load.project) notFound()

  const project = load.project
  const openingDate = project.openingDate
  const { existingCodes, existingCustomTypes, loadError } = load

  // Only org write roles may generate this report — it prints order notes and
  // document status that the client portal withholds. The routes enforce this;
  // hiding the control just avoids offering a button that would 403.
  // Generated DB types predate this RPC (as in require-role.ts) — cast at the
  // query boundary rather than hand-patching types.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: effectiveRole } = await (supabase as any).rpc('user_effective_project_role', {
    p_project_id: projectId,
  })
  const canReport = ORG_WRITE_ROLES.includes(effectiveRole as never)

  const savedReportsResult = canReport
    ? await listProjectReportsAction(projectId, 'equipment_materials')
    : []
  const savedReports = Array.isArray(savedReportsResult) ? savedReportsResult : []

  // ── Shape: board-centric groups ──────────────────────────────────────────
  const showDecommissioned = showDecomParam === '1' || showDecomParam === 'true'
  const groups = gatherUnifiedBoards(load.gatherInput, { showDecommissioned })

  // ── Status filter ────────────────────────────────────────────────────────
  // A board is shown if ANY of its lines has the active status. Equipment
  // boards have one line; tenant boards may have several. An orderless board
  // (no lines — should not occur post-trigger) is matched by its summary status
  // (equipment → 'required'), so it is never hidden behind a filter.
  const validStatuses = new Set<string>(STATUS_ORDER)
  const activeStatus: ProcStatus | null =
    statusFilter && validStatuses.has(statusFilter) ? (statusFilter as ProcStatus) : null

  const filteredGroups = activeStatus
    ? groups
        .map((g) => ({
          ...g,
          boards: g.boards.filter((b) =>
            b.lines.length
              ? b.lines.some((l) => l.status === activeStatus)
              : b.summary.status === activeStatus,
          ),
        }))
        .filter((g) => g.boards.length > 0)
    : groups

  // Status pill counts — every line, plus orderless boards under their summary.
  const countByStatus: Record<ProcStatus, number> = { by_tenant: 0, required: 0, ordered: 0, received: 0 }
  let totalLines = 0
  for (const g of groups) {
    for (const b of g.boards) {
      if (b.lines.length) {
        for (const l of b.lines) {
          countByStatus[l.status]++
          totalLines++
        }
      } else if (b.summary.status !== 'none') {
        countByStatus[b.summary.status]++
        totalLines++
      }
    }
  }

  const totalBoards = filteredGroups.reduce((sum, g) => sum + g.boards.length, 0)
  const base = `/projects/${projectId}/equipment-materials`
  const decomQuery = showDecommissioned ? '&showDecommissioned=1' : ''
  const toggleHref = showDecommissioned
    ? `${base}${activeStatus ? `?status=${activeStatus}` : ''}`
    : `${base}?showDecommissioned=1${activeStatus ? `&status=${activeStatus}` : ''}`

  return (
    <div className="animate-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Equipment &amp; Materials</h1>
          <p className="page-subtitle">{project.name} · one board register + buy-list</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {canReport && <EquipmentMaterialsReportButton projectId={projectId} />}
          <AddBoardToolbar
            projectId={projectId}
            existingCodes={existingCodes}
            existingCustomTypes={existingCustomTypes}
          />
        </div>
      </div>

      {/* Status filter pills + decommissioned toggle */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <Link
          href={`${base}${showDecommissioned ? '?showDecommissioned=1' : ''}`}
          className={!activeStatus ? 'badge badge-green' : 'badge badge-muted'}
        >
          All
          <span style={{ marginLeft: '0.3rem', opacity: 0.7 }}>{totalLines}</span>
        </Link>
        {STATUS_ORDER.map((s) => (
          <Link
            key={s}
            href={`${base}?status=${s}${decomQuery}`}
            className={activeStatus === s ? 'badge badge-green' : 'badge badge-muted'}
          >
            {STATUS_LABEL[s]}
            <span style={{ marginLeft: '0.3rem', opacity: 0.7 }}>{countByStatus[s]}</span>
          </Link>
        ))}
        <Link
          href={toggleHref}
          className={showDecommissioned ? 'badge badge-amber' : 'badge badge-muted'}
          style={{ marginLeft: 'auto' }}
        >
          {showDecommissioned ? '✓ ' : ''}Show decommissioned
        </Link>
      </div>

      {!openingDate && totalLines > 0 && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--c-amber-dim)',
            border: '1px solid var(--c-amber)',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--c-amber)',
          }}
        >
          Set a project opening date in the Tenant Schedule to track these orders against
          beneficial-occupation deadlines.
        </div>
      )}

      {loadError && (
        <div style={{ padding: '12px 16px', background: 'var(--c-red-dim)', border: '1px solid var(--c-red)', borderRadius: 6 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--c-red)' }}>
            Could not load procurement.
          </div>
          <div style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{loadError}</div>
        </div>
      )}

      {!loadError && totalBoards === 0 && (
        <Card>
          <CardBody>
            <p style={{ color: 'var(--c-text-dim)', fontSize: 13, textAlign: 'center', padding: '2rem 0' }}>
              {activeStatus
                ? `No boards with a "${STATUS_LABEL[activeStatus]}" line.`
                : 'No boards yet. Add equipment boards in the Equipment Schedule or set scope items in the Tenant Schedule.'}
            </p>
          </CardBody>
        </Card>
      )}

      {filteredGroups.map((group) => (
        <UnifiedBoardGroup key={group.key} group={group} projectId={projectId} existingCodes={existingCodes} />
      ))}

      {/* Saved report history. Reads of this kind are role-gated, so the panel
          is only rendered for the roles that may see it. */}
      {canReport && (
        <SavedReportsPanel
          projectId={projectId}
          kind="equipment_materials"
          reports={savedReports}
          title="Saved reports"
        />
      )}
    </div>
  )
}
