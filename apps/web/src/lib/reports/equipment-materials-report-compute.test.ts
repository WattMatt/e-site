import { describe, it, expect } from 'vitest'
import { isWinAnsiSafe } from '@/lib/pdf/winansi'
import type { UnifiedGroup, UnifiedBoard, ProcLine } from '@/lib/equipment-materials/gather-unified-boards'
import { computeEquipmentReportModel } from './equipment-materials-report-compute'

// ---------------------------------------------------------------------------
// Fixture builders — hand-built UnifiedGroups keep this a pure unit test.
// ---------------------------------------------------------------------------

const EMPTY_DOCS = (): ProcLine['documents'] => ({ quote: [], order_instruction: [] })

function line(over: Partial<ProcLine> = {}): ProcLine {
  return {
    orderId: 'o1',
    scopeLabel: null,
    status: 'required',
    ordered_at: null,
    received_at: null,
    required_by: null,
    rag: 'neutral',
    documents: EMPTY_DOCS(),
    shopDrawings: [],
    ...over,
    // Set after the spread: Partial<ProcLine> widens notes to
    // `string | undefined`, which ProcLine does not permit.
    notes: over.notes ?? '',
  }
}

function board(over: Partial<UnifiedBoard> = {}): UnifiedBoard {
  return {
    nodeId: 'n1',
    code: 'MB-1',
    name: 'Main Board 1',
    kind: 'main_board',
    customKindLabel: null,
    type: 'equipment',
    cocRequired: false,
    status: 'active',
    lines: [line()],
    summary: { status: 'required', rollup: null, requiredBy: null, rag: 'neutral' },
    ...over,
  }
}

function group(boards: UnifiedBoard[], over: Partial<UnifiedGroup> = {}): UnifiedGroup {
  return { key: 'main_board', label: 'Main Boards', boards, ...over }
}

// ---------------------------------------------------------------------------

describe('computeEquipmentReportModel — KPIs', () => {
  it('counts boards and lines across groups', () => {
    const { kpis } = computeEquipmentReportModel({
      groups: [
        group([board({ nodeId: 'a' }), board({ nodeId: 'b' })]),
        group([board({ nodeId: 'c', lines: [line(), line({ orderId: 'o2' })] })], {
          key: 'tenant_db',
          label: 'Tenant / Shop Boards',
        }),
      ],
      decommissionedCount: 0,
    })

    expect(kpis.totalBoards).toBe(3)
    expect(kpis.totalLines).toBe(4)
  })

  it('tallies the status mix over every line', () => {
    const { kpis } = computeEquipmentReportModel({
      groups: [
        group([
          board({ nodeId: 'a', lines: [line({ status: 'received' })] }),
          board({ nodeId: 'b', lines: [line({ status: 'received' })] }),
          board({ nodeId: 'c', lines: [line({ status: 'ordered' })] }),
          board({ nodeId: 'd', lines: [line({ status: 'required' })] }),
          board({ nodeId: 'e', lines: [line({ status: 'by_tenant' })] }),
        ]),
      ],
      decommissionedCount: 0,
    })

    expect(kpis.status).toEqual({ required: 1, ordered: 1, received: 2, byTenant: 1 })
  })

  it('excludes by_tenant lines from the received percentage', () => {
    // 2 received of 4 actionable (by_tenant is not ours to procure) = 50%,
    // NOT 2/5 = 40%.
    const { kpis } = computeEquipmentReportModel({
      groups: [
        group([
          board({ nodeId: 'a', lines: [line({ status: 'received' })] }),
          board({ nodeId: 'b', lines: [line({ status: 'received' })] }),
          board({ nodeId: 'c', lines: [line({ status: 'ordered' })] }),
          board({ nodeId: 'd', lines: [line({ status: 'required' })] }),
          board({ nodeId: 'e', lines: [line({ status: 'by_tenant' })] }),
        ]),
      ],
      decommissionedCount: 0,
    })

    expect(kpis.actionableLines).toBe(4)
    expect(kpis.receivedPct).toBe(50)
  })

  it('reports 0% rather than NaN when there is nothing actionable', () => {
    const { kpis } = computeEquipmentReportModel({
      groups: [group([board({ lines: [line({ status: 'by_tenant' })] })])],
      decommissionedCount: 0,
    })
    expect(kpis.receivedPct).toBe(0)
  })

  it('derives schedule health from the RAG of each line', () => {
    const { kpis } = computeEquipmentReportModel({
      groups: [
        group([
          board({ nodeId: 'a', lines: [line({ rag: 'red' })] }),
          board({ nodeId: 'b', lines: [line({ rag: 'red' })] }),
          board({ nodeId: 'c', lines: [line({ rag: 'amber' })] }),
          board({ nodeId: 'd', lines: [line({ rag: 'green' })] }),
          board({ nodeId: 'e', lines: [line({ rag: 'neutral' })] }),
        ]),
      ],
      decommissionedCount: 0,
    })

    expect(kpis.schedule).toEqual({ overdue: 2, dueSoon: 1, onTrack: 1, noDate: 1 })
  })

  it('counts document presence per line', () => {
    const withQuote = line({
      documents: { quote: [{ id: 'd1', storage_path: 'p', file_name: 'q.pdf', label: null, kind: 'original' }], order_instruction: [] },
    })
    const withBoth = line({
      orderId: 'o2',
      documents: {
        quote: [{ id: 'd2', storage_path: 'p', file_name: 'q.pdf', label: null, kind: 'original' }],
        order_instruction: [{ id: 'd3', storage_path: 'p', file_name: 'oi.pdf', label: null, kind: 'original' }],
      },
      shopDrawings: [{ id: 's1', file_name: 'sd.pdf', storage_path: 'p', status: 'received', handover_category: null }],
    })

    const { kpis } = computeEquipmentReportModel({
      groups: [group([board({ lines: [withQuote, withBoth, line({ orderId: 'o3' })] })])],
      decommissionedCount: 0,
    })

    expect(kpis.documents).toEqual({ withQuote: 2, withOrderInstruction: 1, withShopDrawing: 1 })
  })

  it('carries the excluded decommissioned count through', () => {
    const { kpis } = computeEquipmentReportModel({ groups: [], decommissionedCount: 7 })
    expect(kpis.decommissionedExcluded).toBe(7)
  })

  it('handles an empty project without dividing by zero', () => {
    const { kpis, rows } = computeEquipmentReportModel({ groups: [], decommissionedCount: 0 })
    expect(kpis.totalBoards).toBe(0)
    expect(kpis.totalLines).toBe(0)
    expect(kpis.receivedPct).toBe(0)
    expect(rows).toEqual([])
  })
})

describe('computeEquipmentReportModel — register rows', () => {
  it('renders one row per line, carrying the group label', () => {
    const { rows } = computeEquipmentReportModel({
      groups: [
        group([
          board({
            code: 'MB-1',
            name: 'Main Board 1',
            lines: [
              line({ status: 'received', ordered_at: '2026-06-01', received_at: '2026-07-02' }),
              line({ orderId: 'o2', scopeLabel: 'Lighting', status: 'ordered', ordered_at: '2026-06-05' }),
            ],
          }),
        ]),
      ],
      decommissionedCount: 0,
    })

    expect(rows).toHaveLength(2)
    expect(rows[0].group).toBe('Main Boards')
    expect(rows[0].board).toBe('MB-1 — Main Board 1')
    expect(rows[0].line).toBe('Equipment')
    expect(rows[0].status).toBe('Received')
    expect(rows[0].ordered).toBe('2026-06-01')
    expect(rows[0].received).toBe('2026-07-02')
    expect(rows[1].line).toBe('Lighting')
    expect(rows[1].status).toBe('Ordered')
    expect(rows[1].received).toBe('—')
  })

  it('still emits a row for a board that has no procurement lines', () => {
    // An orderless equipment board is a buy-list item that needs ordering — it
    // must never vanish from the register just because no order row exists.
    const { rows } = computeEquipmentReportModel({
      groups: [
        group([
          board({
            code: 'GEN-2',
            name: null,
            lines: [],
            summary: { status: 'required', rollup: null, requiredBy: null, rag: 'neutral' },
          }),
        ]),
      ],
      decommissionedCount: 0,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].board).toBe('GEN-2')
    expect(rows[0].status).toBe('Required')
    expect(rows[0].line).toBe('Equipment')
  })

  it('labels RAG in words and marks document presence without symbols', () => {
    const { rows } = computeEquipmentReportModel({
      groups: [
        group([
          board({
            lines: [
              line({
                rag: 'red',
                required_by: '2026-05-01',
                documents: {
                  quote: [{ id: 'd1', storage_path: 'p', file_name: 'q.pdf', label: null, kind: 'original' }],
                  order_instruction: [],
                },
              }),
            ],
          }),
        ]),
      ],
      decommissionedCount: 0,
    })

    expect(rows[0].rag).toBe('Overdue')
    expect(rows[0].requiredBy).toBe('2026-05-01')
    expect(rows[0].quote).toBe('Yes')
    expect(rows[0].orderInstruction).toBe('—')
    expect(rows[0].shopDrawing).toBe('—')
  })

  it('maps every RAG value to a word', () => {
    const rags: Array<[ProcLine['rag'], string]> = [
      ['red', 'Overdue'],
      ['amber', 'Due soon'],
      ['green', 'On track'],
      ['neutral', '—'],
    ]
    for (const [rag, label] of rags) {
      const { rows } = computeEquipmentReportModel({
        groups: [group([board({ lines: [line({ rag })] })])],
        decommissionedCount: 0,
      })
      expect(rows[0].rag).toBe(label)
    }
  })
})

describe('computeEquipmentReportModel — PDF glyph safety', () => {
  // react-pdf silently truncates a non-WinAnsi code point to its low byte and
  // renders the wrong character (see lib/pdf/winansi.ts). gatherUnifiedBoards
  // builds its on-screen rollup out of '✓', '◐' and '○', so piping any of its
  // strings straight into the PDF would print 'Ð' and 'Ë' on a client
  // deliverable. Every emitted string must therefore be WinAnsi-safe.
  it('emits only WinAnsi-safe strings, including for hostile input', () => {
    const { rows } = computeEquipmentReportModel({
      groups: [
        group(
          [
            board({
              code: 'DB-✓-01',
              name: 'Ω Board → café ○',
              lines: [
                line({
                  scopeLabel: 'Lighting ◐',
                  status: 'received',
                  notes: 'Delivered ✓ — see drawing №3\nsecond line',
                }),
              ],
            }),
          ],
          { label: 'Tenant / Shop Boards ○' },
        ),
      ],
      decommissionedCount: 0,
    })

    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        expect(isWinAnsiSafe(value), `row.${key} is not WinAnsi-safe: ${JSON.stringify(value)}`).toBe(true)
      }
    }
  })

  it('never lets a newline through into a drawn string', () => {
    const { rows } = computeEquipmentReportModel({
      groups: [group([board({ lines: [line({ notes: 'line one\nline two\r\nthree' })] })])],
      decommissionedCount: 0,
    })
    expect(rows[0].notes).not.toMatch(/[\n\r]/)
  })
})
