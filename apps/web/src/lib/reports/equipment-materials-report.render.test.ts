// @vitest-environment node
/**
 * Renders the real document and reads the text back out of the PDF content
 * streams. Asserting on the model alone would not catch a glyph that react-pdf
 * silently mis-encodes, nor a page that fails to render at all.
 */
import { describe, it, expect } from 'vitest'
import zlib from 'node:zlib'
import { renderEquipmentMaterialsReport } from './render-equipment-materials'
import { resolveBranding } from './branding'
import { buildEquipmentMaterialsBrandingInput } from './equipment-materials-report-branding'
import type { EquipmentMaterialsReportData } from './equipment-materials-report-data'
import { computeEquipmentReportModel } from './equipment-materials-report-compute'
import type { UnifiedGroup, ProcLine } from '@/lib/equipment-materials/gather-unified-boards'

// ---------------------------------------------------------------------------
// WinAnsi-aware extraction. Decoding these streams as latin1 would mangle every
// byte in 0x80–0x9F — the bug fixed in extractPdfTextPerStream in PR #161, which
// made assertions on real punctuation pass vacuously.
// ---------------------------------------------------------------------------

const WINANSI_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
}

function fromWinAnsi(bytes: Buffer): string {
  let out = ''
  for (const b of bytes) out += WINANSI_HIGH[b] ?? String.fromCharCode(b)
  return out
}

function extractPdfText(buf: Buffer): string {
  let text = ''
  const streamMarker = Buffer.from('stream')
  const endMarker = Buffer.from('endstream')
  let cursor = 0
  for (;;) {
    const start = buf.indexOf(streamMarker, cursor)
    if (start === -1) break
    const end = buf.indexOf(endMarker, start)
    if (end === -1) break
    let dataStart = start + streamMarker.length
    while (buf[dataStart] === 0x0d || buf[dataStart] === 0x0a) dataStart++
    const chunk = buf.subarray(dataStart, end)
    let decoded: string
    try {
      decoded = zlib.inflateSync(chunk).toString('latin1')
    } catch {
      decoded = chunk.toString('latin1')
    }
    for (const m of decoded.matchAll(/<([0-9a-fA-F]+)>/g)) {
      text += fromWinAnsi(Buffer.from(m[1], 'hex'))
    }
    cursor = end + endMarker.length
  }
  return text
}

// ---------------------------------------------------------------------------

const EMPTY_DOCS = (): ProcLine['documents'] => ({ quote: [], order_instruction: [] })

function line(over: Partial<ProcLine> = {}): ProcLine {
  return {
    orderId: 'o1', scopeLabel: null, status: 'required',
    ordered_at: null, received_at: null, required_by: null, rag: 'neutral',
    documents: EMPTY_DOCS(), shopDrawings: [], notes: '', ...over,
  }
}

const GROUPS: UnifiedGroup[] = [
  {
    key: 'main_board',
    label: 'Main Boards',
    boards: [
      {
        nodeId: 'n1', code: 'MB-1', name: 'Main Board 1', kind: 'main_board',
        customKindLabel: null, type: 'equipment', cocRequired: false, status: 'active',
        lines: [line({ status: 'received', ordered_at: '2026-06-01', received_at: '2026-07-02', rag: 'green' })],
        summary: { status: 'received', rollup: null, requiredBy: null, rag: 'green' },
      },
    ],
  },
  {
    key: 'tenant_db',
    label: 'Tenant / Shop Boards',
    boards: [
      {
        nodeId: 'n2', code: 'DB-04', name: 'KFC', kind: 'tenant_db',
        customKindLabel: null, type: 'tenant', cocRequired: true, status: 'active',
        lines: [
          line({ orderId: 'o2', scopeLabel: 'Lighting', status: 'ordered', ordered_at: '2026-06-05', required_by: '2026-05-01', rag: 'red', notes: 'Chase supplier — split delivery' }),
          line({ orderId: 'o3', scopeLabel: 'DB', status: 'by_tenant' }),
        ],
        summary: { status: 'ordered', rollup: null, requiredBy: '2026-05-01', rag: 'red' },
      },
    ],
  },
]

function buildData(): EquipmentMaterialsReportData {
  const { kpis, rows } = computeEquipmentReportModel({ groups: GROUPS, decommissionedCount: 3 })
  return {
    projectName: 'KINGSWALK',
    kpis,
    rows,
    brandingInput: {
      orgName: 'WM Consulting', orgLogoDataUri: null, orgAccent: null, projectAccent: null,
      clientLogoDataUri: null, projectMarkDataUri: null, projectSubtitle: 'Equipment & materials',
    },
  }
}

async function render(data: EquipmentMaterialsReportData): Promise<string> {
  const branding = resolveBranding(buildEquipmentMaterialsBrandingInput(data, '2026-08-13'))
  const pdf = await renderEquipmentMaterialsReport(data, branding)
  expect(pdf.length).toBeGreaterThan(1000)
  return extractPdfText(pdf)
}

describe('Equipment & Materials report render', () => {
  it('renders the cover, KPIs and register', async () => {
    const text = await render(buildData())

    expect(text).toContain('Equipment & Materials Report')
    expect(text).toContain('KINGSWALK')
    expect(text).toContain('Procurement KPIs')
    expect(text).toContain('Board register')
  }, 60_000)

  it('states the scope and the excluded decommissioned boards on the KPI page', async () => {
    const text = await render(buildData())
    expect(text).toContain('Scope: all active boards.')
    expect(text).toContain('3 decommissioned boards excluded.')
  }, 60_000)

  it('prints the computed figures, not placeholders', async () => {
    const data = buildData()
    // 3 lines: 1 received, 1 ordered, 1 by_tenant → 2 actionable, 50% received.
    expect(data.kpis.totalBoards).toBe(2)
    expect(data.kpis.totalLines).toBe(3)
    expect(data.kpis.actionableLines).toBe(2)
    expect(data.kpis.receivedPct).toBe(50)

    const text = await render(data)
    expect(text).toContain('50% of 2 to procure')
  }, 60_000)

  it('renders board rows with real data', async () => {
    const text = await render(buildData())

    expect(text).toContain('MB-1')
    expect(text).toContain('DB-04')
    expect(text).toContain('KFC')
    expect(text).toContain('Lighting')
    expect(text).toContain('2026-07-02')
    expect(text).toContain('Main Boards')
    expect(text).toContain('Tenant / Shop Boards')
  }, 60_000)

  it('labels status and schedule in words, never as symbols', async () => {
    const text = await render(buildData())

    expect(text).toContain('Received')
    expect(text).toContain('Ordered')
    expect(text).toContain('By tenant')
    expect(text).toContain('Overdue')

    // The screen rollup uses these; they must never reach the PDF, where
    // react-pdf would silently draw 'Ð' / 'Ë' instead.
    for (const bad of ['✓', '◐', '○', 'Ð', 'Ë']) {
      expect(text, `report text contains ${bad}`).not.toContain(bad)
    }
  }, 60_000)

  it('prints order notes as a sub-line', async () => {
    const text = await render(buildData())
    expect(text).toContain('Chase supplier')
  }, 60_000)

  it('renders an empty project without throwing', async () => {
    const { kpis, rows } = computeEquipmentReportModel({ groups: [], decommissionedCount: 0 })
    const text = await render({ ...buildData(), kpis, rows })
    expect(text).toContain('No active boards')
  }, 60_000)
})
