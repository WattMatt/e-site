/**
 * Pure model for the Equipment & Materials report — no I/O, no Supabase.
 *
 * Takes the SAME UnifiedGroup[] the admin tab renders (via gatherUnifiedBoards)
 * and flattens it into KPI figures plus one register row per procurement line.
 * Sharing the shaping is deliberate: a report that re-derived the register would
 * drift from the screen.
 *
 * Every string this module emits is passed through winAnsiSafe. react-pdf does
 * not raise on an unencodable glyph — it truncates the code point to its low
 * byte and draws a different character (see lib/pdf/winansi.ts). gatherUnifiedBoards
 * builds its on-screen rollup out of '✓', '◐' and '○', so an unguarded string
 * from it would print 'Ð' / 'Ë' on a client deliverable.
 */
import { winAnsiSafe } from '@/lib/pdf/winansi'
import type { UnifiedGroup, ProcLine, ProcStatus } from '@/lib/equipment-materials/gather-unified-boards'

const DASH = '—' // U+2014, WinAnsi-safe

const STATUS_LABEL: Record<ProcStatus, string> = {
  required: 'Required',
  ordered: 'Ordered',
  received: 'Received',
  by_tenant: 'By tenant',
}

const RAG_LABEL: Record<ProcLine['rag'], string> = {
  red: 'Overdue',
  amber: 'Due soon',
  green: 'On track',
  neutral: DASH,
}

export interface EquipmentReportKpis {
  totalBoards: number
  totalLines: number
  /** Lines the landlord must actually procure (everything but by_tenant). */
  actionableLines: number
  decommissionedExcluded: number
  status: { required: number; ordered: number; received: number; byTenant: number }
  /** Received as a percentage of actionable lines; 0 when nothing is actionable. */
  receivedPct: number
  schedule: { overdue: number; dueSoon: number; onTrack: number; noDate: number }
  documents: { withQuote: number; withOrderInstruction: number; withShopDrawing: number }
}

export interface EquipmentRegisterRow {
  group: string
  board: string
  line: string
  status: string
  ordered: string
  received: string
  requiredBy: string
  rag: string
  quote: string
  orderInstruction: string
  shopDrawing: string
  notes: string
}

export interface EquipmentReportModel {
  kpis: EquipmentReportKpis
  rows: EquipmentRegisterRow[]
}

export interface EquipmentComputeInput {
  /** Output of gatherUnifiedBoards — active boards only. */
  groups: UnifiedGroup[]
  /** Boards excluded from `groups` because they are decommissioned. */
  decommissionedCount: number
}

const safe = (v: string | null | undefined): string => (v ? winAnsiSafe(v) : DASH)
const yesNo = (present: boolean): string => (present ? 'Yes' : DASH)

/** "CODE — Name", or just the code when the board has no distinct name. */
function boardLabel(code: string, name: string | null): string {
  const c = winAnsiSafe(code)
  if (!name) return c
  const n = winAnsiSafe(name)
  return n === c ? c : `${c} ${DASH} ${n}`
}

export function computeEquipmentReportModel(input: EquipmentComputeInput): EquipmentReportModel {
  const { groups, decommissionedCount } = input

  const kpis: EquipmentReportKpis = {
    totalBoards: 0,
    totalLines: 0,
    actionableLines: 0,
    decommissionedExcluded: decommissionedCount,
    status: { required: 0, ordered: 0, received: 0, byTenant: 0 },
    receivedPct: 0,
    schedule: { overdue: 0, dueSoon: 0, onTrack: 0, noDate: 0 },
    documents: { withQuote: 0, withOrderInstruction: 0, withShopDrawing: 0 },
  }

  const rows: EquipmentRegisterRow[] = []

  for (const grp of groups) {
    const groupLabel = winAnsiSafe(grp.label)

    for (const b of grp.boards) {
      kpis.totalBoards += 1
      const label = boardLabel(b.code, b.name)

      // An orderless board still belongs in the register — it is a buy-list item
      // that needs ordering. Emit one row carrying its summary status so it is
      // never silently absent from a deliverable.
      if (b.lines.length === 0) {
        rows.push({
          group: groupLabel,
          board: label,
          line: 'Equipment',
          status: b.summary.status === 'none' ? DASH : STATUS_LABEL[b.summary.status],
          ordered: DASH,
          received: DASH,
          requiredBy: safe(b.summary.requiredBy),
          rag: RAG_LABEL[b.summary.rag],
          quote: DASH,
          orderInstruction: DASH,
          shopDrawing: DASH,
          notes: '',
        })
        continue
      }

      for (const l of b.lines) {
        kpis.totalLines += 1

        if (l.status === 'by_tenant') kpis.status.byTenant += 1
        else {
          kpis.actionableLines += 1
          if (l.status === 'required') kpis.status.required += 1
          else if (l.status === 'ordered') kpis.status.ordered += 1
          else if (l.status === 'received') kpis.status.received += 1
        }

        if (l.rag === 'red') kpis.schedule.overdue += 1
        else if (l.rag === 'amber') kpis.schedule.dueSoon += 1
        else if (l.rag === 'green') kpis.schedule.onTrack += 1
        else kpis.schedule.noDate += 1

        const hasQuote = l.documents.quote.length > 0
        const hasOrderInstruction = l.documents.order_instruction.length > 0
        const hasShopDrawing = l.shopDrawings.length > 0
        if (hasQuote) kpis.documents.withQuote += 1
        if (hasOrderInstruction) kpis.documents.withOrderInstruction += 1
        if (hasShopDrawing) kpis.documents.withShopDrawing += 1

        rows.push({
          group: groupLabel,
          board: label,
          // A null scopeLabel is the equipment line (equipment boards carry one).
          line: l.scopeLabel ? winAnsiSafe(l.scopeLabel) : 'Equipment',
          status: STATUS_LABEL[l.status],
          ordered: safe(l.ordered_at),
          received: safe(l.received_at),
          requiredBy: safe(l.required_by),
          rag: RAG_LABEL[l.rag],
          quote: yesNo(hasQuote),
          orderInstruction: yesNo(hasOrderInstruction),
          shopDrawing: yesNo(hasShopDrawing),
          // winAnsiSafe folds newlines to spaces — a pasted multi-line note must
          // not break the single-line table cell.
          notes: l.notes ? winAnsiSafe(l.notes) : '',
        })
      }
    }
  }

  kpis.receivedPct =
    kpis.actionableLines > 0 ? Math.round((kpis.status.received / kpis.actionableLines) * 100) : 0

  return { kpis, rows }
}
