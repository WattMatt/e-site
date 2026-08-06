import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { renderRevisionPdf } from '../export-pdf'
import { renderTagListPdf } from '../export-tag-list-pdf'
import { renderAveryLabelsPdf } from '../export-avery-labels'
import type { EnrichedCable, EnrichedRun, ExportPayload } from '../export-payload'

/**
 * Full-render regression tests for every PDF renderer.
 *
 * Nothing exercised these end-to-end before 2026-07-31, which is how the
 * revision-pack PDF shipped broken for its entire life: pdf-lib's standard
 * Helvetica only encodes WinAnsi (CP1252), and the `Ω/km` column header +
 * the `→` in tag cards threw `WinAnsi cannot encode` on every render —
 * surfacing as HTTP 500 on the pdf/zip/multi-zip/tag-labels routes.
 *
 * The fixture is deliberately hostile: Greek, arrows, CJK and emoji in
 * every user-controlled string. If any drawText call site misses the
 * winAnsiSafe wrapper, these tests throw.
 */

function makeCable(over: Partial<EnrichedCable>): EnrichedCable {
  return {
    id: 'c1',
    supply_id: 's1',
    cable_no: 1,
    size_mm2: 70,
    cores: '4',
    conductor: 'AL',
    insulation: 'PVC',
    armour: 'SWA',
    standard: 'SANS 1507',
    ohm_per_km: 0.539,
    measured_length_m: 48,
    confirmed_length_m: null,
    length_status: 'MEASURED',
    derated_current_rating_a: 130,
    installation_method: 'BURIED',
    depth_mm: 500,
    grouped_with: 1,
    grouping_arrangement: 'TOUCHING',
    ambient_temp_c: 30,
    tag_override: null,
    manual_override: false,
    notes: 'note → Ω 中文',
    from_label: 'MAIN BOARD Ω.1',
    to_label: 'DB-67→中',
    voltage_v: 400,
    load_a: 120,
    vd_pct: 1.34,
    cumulative_vd_pct: 1.58,
    cable_tag: 'MB-DB67-C1',
    ...over,
  }
}

function makeRun(cables: EnrichedCable[], over: Partial<EnrichedRun>): EnrichedRun {
  const head = cables[0]
  return {
    supply_id: head.supply_id,
    section: 'NORMAL',
    from_label: head.from_label,
    to_label: head.to_label,
    voltage_v: head.voltage_v ?? 400,
    load_a: head.load_a,
    parallel_count: cables.length,
    size_mm2: head.size_mm2,
    cores: head.cores,
    conductor: head.conductor,
    insulation: head.insulation,
    installation_method: head.installation_method,
    depth_mm: head.depth_mm,
    grouped_with: head.grouped_with,
    ohm_per_km: head.ohm_per_km,
    active_length_m: head.measured_length_m,
    length_status: head.length_status,
    combined_capacity_a: head.derated_current_rating_a,
    under_rated: false,
    breaker_a: 63,
    pole_config: 'TP',
    vd_pct: head.vd_pct,
    cumulative_vd_pct: head.cumulative_vd_pct,
    mixed_properties: { fields: [] },
    cables,
    ...over,
  }
}

function hostilePayload(): ExportPayload {
  const c1 = makeCable({})
  const c2 = makeCable({
    id: 'c2',
    supply_id: 's2',
    conductor: 'CU',
    measured_length_m: null,
    length_status: 'UNMEASURED',
    vd_pct: 0,
    cumulative_vd_pct: 0,
    from_label: 'GEN-Ω',
    to_label: 'MINIATURE SUBSTATION 1-120-1 WITH A VERY LONG NAME',
    cable_tag: 'Consumer RMU-MINIATURE SUBSTATION 1-120-1 Ω→中文',
  })
  return {
    costRedacted: false,
    project: { id: 'p1', name: '(999) Ω→中文 🚀 PROJECT', organisation_id: 'org1' },
    revision: {
      id: 'r1',
      code: 'Rev Ω',
      description: 'hostile → description',
      status: 'DRAFT',
      issued_at: null,
      issued_by_name: 'Tester Ω',
      fault_level_ka: 10,
      change_notes: 'line one Ω\nline two → 中文 🚀',
      created_at: '2026-07-31T00:00:00Z',
      vat_pct: 15,
    },
    sources: [{ id: 'src1', code: 'UTIL-Ω', type: 'utility', rating_kva: 500, voltage_v: 11000, notes: null }],
    nodes: [],
    supplies: [
      { id: 's1', from_source_id: 'src1', from_node_id: null, to_node_id: 'n1', voltage_v: 400, design_load_a: 120, section: 'NORMAL' },
      { id: 's2', from_source_id: null, from_node_id: 'n1', to_node_id: 'n2', voltage_v: 400, design_load_a: 60, section: 'EMERGENCY' },
    ],
    cables: [c1, c2],
    runs: [makeRun([c1], {}), makeRun([c2], { section: 'EMERGENCY' })],
    cableTags: [
      { id: 't1', cable_id: 'c1', end_position: 'FROM', tag_text: 'MB-Ω→中-C1', printed: false, printed_at: null },
      { id: 't2', cable_id: 'c1', end_position: 'TO', tag_text: 'Consumer RMU-MINIATURE SUBSTATION 1-120-1', printed: false, printed_at: null },
      { id: 't3', cable_id: 'c2', end_position: 'FROM', tag_text: '🚀', printed: false, printed_at: null },
      // Embedded newline/CR/tab — widthOfTextAtSize throws on these even
      // though drawText line-splits them (2026-07-31 review finding).
      { id: 't4', cable_id: 'c2', end_position: 'TO', tag_text: 'PASTED\nTAG\r\tX', printed: false, printed_at: null },
    ],
    costLines: [
      { id: 'cl1', size_mm2: 70, conductor: 'AL', supply_rate_per_m: 226.6, install_rate_per_m: 15.3, termination_rate_each: 1036 },
    ],
    changeLog: [],
  }
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPageCount()
}

/**
 * Decode every page content stream so colour operators are assertable.
 * pdf-lib Flate-compresses content streams on save, so a raw byte search
 * can't see `r g b rg` fill operators — decompress first.
 */
async function contentStreamText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  let text = ''
  for (const page of doc.getPages()) {
    const contents = page.node.Contents()
    if (!contents) continue
    const items = contents instanceof PDFArray ? contents.asArray() : [contents]
    for (const item of items) {
      const stream = page.node.context.lookup(item)
      if (stream instanceof PDFRawStream) {
        text += new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode())
      }
    }
  }
  return text
}

/** Historical hard-coded Watson Mattheus amber — rgb(0.902, 0.584, 0). */
const AMBER_FILL_OP = '0.902 0.584 0 rg'
/** #336699 → rgb(0.2, 0.4, 0.6) through the accentColor chokepoint. */
const CUSTOM_ACCENT = '#336699'
const CUSTOM_FILL_OP = '0.2 0.4 0.6 rg'

describe('renderRevisionPdf', () => {
  it('renders the full pack with hostile unicode everywhere (Ω/km header + → tag cards)', async () => {
    const bytes = await renderRevisionPdf(hostilePayload())
    expect(bytes.length).toBeGreaterThan(0)
    // cover + >=1 schedule + cost + >=1 tag page
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(4)
  })

  it('omits the cost page (and only that) when costRedacted', async () => {
    const full = await renderRevisionPdf(hostilePayload())
    const redacted = await renderRevisionPdf({
      ...hostilePayload(),
      costRedacted: true,
      costLines: [],
    })
    expect(await pageCount(redacted)).toBe((await pageCount(full)) - 1)
  })

  it('renders an empty revision without throwing', async () => {
    const bytes = await renderRevisionPdf({
      ...hostilePayload(),
      cables: [],
      runs: [],
      cableTags: [],
      costLines: [],
    })
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(2)
  })
})

describe('branding accent wiring (payload.accent → accentColor)', () => {
  it('defaults to the historical WM amber when no accent is set (output unchanged)', async () => {
    const payload = hostilePayload()
    expect(payload.accent).toBeUndefined()
    const text = await contentStreamText(await renderRevisionPdf(payload))
    expect(text).toContain(AMBER_FILL_OP)
    expect(text).not.toContain(CUSTOM_FILL_OP)
  })

  it('renders the pack in a custom project/org accent when payload.accent is set', async () => {
    const text = await contentStreamText(
      await renderRevisionPdf({ ...hostilePayload(), accent: CUSTOM_ACCENT }),
    )
    expect(text).toContain(CUSTOM_FILL_OP)
    expect(text).not.toContain(AMBER_FILL_OP)
  })

  it('falls back to the default amber on a malformed accent hex (never crashes a render)', async () => {
    const text = await contentStreamText(
      await renderRevisionPdf({ ...hostilePayload(), accent: 'not-a-colour' }),
    )
    expect(text).toContain(AMBER_FILL_OP)
  })

  it('tag renderers accept an accented payload and stay monochrome (no accent furniture)', async () => {
    const payload = { ...hostilePayload(), accent: CUSTOM_ACCENT }
    const tagText = await contentStreamText(await renderTagListPdf(payload))
    const averyText = await contentStreamText(await renderAveryLabelsPdf(payload))
    expect(tagText).not.toContain(CUSTOM_FILL_OP)
    expect(averyText).not.toContain(CUSTOM_FILL_OP)
  })
})

describe('tag renderers with hostile unicode', () => {
  it('renderTagListPdf resolves', async () => {
    const bytes = await renderTagListPdf(hostilePayload())
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1)
  })

  it('renderAveryLabelsPdf resolves', async () => {
    const bytes = await renderAveryLabelsPdf(hostilePayload())
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1)
  })

  it('empty-state placeholders survive a hostile project name (2026-07-31 review finding)', async () => {
    // The zero-tags path draws the project name with its own raw
    // page.drawText calls — it must be sanitised too.
    const empty = { ...hostilePayload(), cableTags: [] }
    expect(await pageCount(await renderTagListPdf(empty))).toBe(1)
    expect(await pageCount(await renderAveryLabelsPdf(empty))).toBe(1)
  })
})
