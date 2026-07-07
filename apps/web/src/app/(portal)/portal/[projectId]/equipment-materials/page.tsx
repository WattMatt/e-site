import { notFound } from 'next/navigation'
import { getPortalEquipmentMaterials } from '@/lib/portal/data'
import { PortalCard, EmptyState, thStyle, tdStyle, fmtDate } from '@/components/portal/PortalBits'
import type {
  ProcLine,
  UnifiedBoard,
} from '@/app/(admin)/projects/[id]/equipment-materials/_lib/gather-unified-boards'

export const dynamic = 'force-dynamic'

/**
 * Equipment & Materials — read-only board register with procurement status.
 * No documents, notes or drawings are exposed here (commercial artefacts stay
 * staff-side); no write affordances exist by construction.
 */

const STATUS_LABEL: Record<string, string> = {
  by_tenant: 'By tenant',
  required: 'Required',
  ordered: 'Ordered',
  received: 'Received',
  none: '—', // orderless tenant board — matches the admin BoardRow ghost badge
}
const STATUS_COLOR: Record<string, string> = {
  by_tenant: 'var(--c-text-dim)',
  required: 'var(--c-amber)',
  ordered: 'var(--c-text-mid)',
  received: 'var(--c-success, #22C55E)',
  none: 'var(--c-text-dim)',
}
const RAG_COLOR: Record<ProcLine['rag'], string> = {
  red: 'var(--c-danger)',
  amber: 'var(--c-amber)',
  green: 'var(--c-success, #22C55E)',
  neutral: 'var(--c-text-dim)',
}

function ProcBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? 'var(--c-text-mid)'
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)', fontSize: 11, color,
        border: `1px solid ${color}`, borderRadius: 4, padding: '1px 7px',
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

function RagDot({ rag }: { rag: ProcLine['rag'] }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: RAG_COLOR[rag], marginRight: 6, verticalAlign: 'middle',
      }}
    />
  )
}

/** One table row per procurement line; an orderless board still gets a row. */
function boardRows(board: UnifiedBoard) {
  const label = (line: ProcLine | null) =>
    line?.scopeLabel ?? (board.type === 'tenant' ? '—' : 'Equipment')
  const lines: Array<ProcLine | null> = board.lines.length > 0 ? board.lines : [null]

  return lines.map((line, i) => (
    <tr key={line?.orderId ?? `${board.nodeId}-${i}`}>
      <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
        {i === 0 ? board.code : ''}
      </td>
      <td style={tdStyle}>{i === 0 ? (board.name ?? '—') : ''}</td>
      <td style={tdStyle}>{label(line)}</td>
      <td style={tdStyle}>
        <ProcBadge status={line?.status ?? board.summary.status} />
      </td>
      <td style={tdStyle}>{fmtDate(line?.ordered_at)}</td>
      <td style={tdStyle}>{fmtDate(line?.received_at)}</td>
      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
        <RagDot rag={line?.rag ?? board.summary.rag} />
        {line?.required_by ?? board.summary.requiredBy ?? '—'}
      </td>
    </tr>
  ))
}

export default async function PortalEquipmentMaterialsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const groups = await getPortalEquipmentMaterials(projectId)
  if (groups === null) notFound()

  if (groups.length === 0) {
    return (
      <PortalCard>
        <EmptyState label="No equipment or materials register on this site yet." />
      </PortalCard>
    )
  }

  return (
    <div>
      {groups.map((group) => (
        <PortalCard key={group.key}>
          <h2 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>
            {group.label}
          </h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Board</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Item</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Ordered</th>
                  <th style={thStyle}>Received</th>
                  <th style={thStyle}>Required by</th>
                </tr>
              </thead>
              <tbody>{group.boards.flatMap((b) => boardRows(b))}</tbody>
            </table>
          </div>
        </PortalCard>
      ))}
      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--c-text-dim)' }}>
        Procurement status only — order documents live with your project team.
      </p>
    </div>
  )
}
