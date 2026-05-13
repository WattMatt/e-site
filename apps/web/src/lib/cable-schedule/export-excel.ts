/**
 * Excel renderer for a cable-schedule revision. Output is shaped so the
 * C7 importer (excel-importer.ts) can round-trip it back into a DRAFT
 * — same sheet name, same header labels, same Aluminium/Copper +
 * Normal/Emergency section-header convention, and the cable_tag in
 * column B (which the importer reads positionally).
 *
 * Multi-sheet workbook:
 *   CABLE SCHEDULE        — the schedule grid, importer-round-trip safe
 *   COST SUMMARY          — per-size rates + computed line totals
 *   FACTS AND FIGURES     — Ω/km lookup table actually used by this rev
 *   REVISION HISTORY      — chronological change_log entries
 *
 * The importer only parses the CABLE SCHEDULE sheet today, so the
 * other three are reference-only — they don't need to match any parser
 * shape.
 */

import ExcelJS from 'exceljs'
import type { ExportPayload, EnrichedCable } from './export-payload'

const WM_AMBER = 'FFE69500'
const HEADER_GREY = 'FF2A2A2A'
const SECTION_GREY = 'FF383838'

export async function renderScheduleWorkbook(
  payload: ExportPayload,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'E-Site'
  wb.created = new Date()
  wb.title = `${payload.project.name} — ${payload.revision.code} cable schedule`

  buildScheduleSheet(wb, payload)
  buildCostSheet(wb, payload)
  buildFactsSheet(wb, payload)
  buildHistorySheet(wb, payload)

  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out)
}

function buildScheduleSheet(wb: ExcelJS.Workbook, payload: ExportPayload): void {
  const ws = wb.addWorksheet('CABLE SCHEDULE', {
    properties: { tabColor: { argb: WM_AMBER } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 6 }],
  })

  // Title block (rows 1–4) — informational, importer ignores it.
  ws.mergeCells('A1:K1')
  ws.getCell('A1').value = payload.project.name.toUpperCase()
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  ws.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: HEADER_GREY },
  }
  ws.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle' }
  ws.getRow(1).height = 22

  ws.mergeCells('A2:K2')
  ws.getCell('A2').value = `CABLE SCHEDULE · ${payload.revision.code} · ${payload.revision.status}`
  ws.getCell('A2').font = { bold: true, size: 11, color: { argb: WM_AMBER } }
  ws.getCell('A2').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: HEADER_GREY },
  }
  ws.getCell('A2').alignment = { horizontal: 'left', vertical: 'middle' }
  ws.getRow(2).height = 18

  const issuedBits = [
    payload.revision.issued_at
      ? `Issued ${payload.revision.issued_at.slice(0, 10)}`
      : `Created ${payload.revision.created_at.slice(0, 10)}`,
    payload.revision.issued_by_name ? `by ${payload.revision.issued_by_name}` : null,
    payload.revision.fault_level_ka != null
      ? `Fault level: ${payload.revision.fault_level_ka} kA`
      : null,
  ].filter(Boolean)
  ws.mergeCells('A3:K3')
  ws.getCell('A3').value = issuedBits.join('  ·  ')
  ws.getCell('A3').font = { size: 10, color: { argb: 'FF808080' } }

  if (payload.revision.description) {
    ws.mergeCells('A4:K4')
    ws.getCell('A4').value = payload.revision.description
    ws.getCell('A4').font = { italic: true, size: 10, color: { argb: 'FF808080' } }
  }

  // Header row at row 6 — labels MUST match the importer's HEADER_LABELS
  // regex. See excel-importer.ts:72-83.
  //
  //   cable_tag        /^cable\s*tag$/i           → 'Cable Tag'
  //   from_node        /^from$/i                  → 'From'
  //   to_node          /^to$/i                    → 'To'
  //   voltage_v        /^voltage/i                → 'Voltage (V)'
  //   design_load_a    /^(load|current|breaker)$/i→ 'Load'       [strict]
  //   size_mm2         /^(type|size|mm.?|csa)/i   → 'Size mm²'
  //   ohm_per_km       /^(ohm\/km|Ω\/km|…)/i      → 'Ω/km'
  //   cable_no         /^(cable\s*no|c\/no|…)/i   → 'Cable No'
  //   measured_length_m/^(length|route\s*length…)/i→'Length (m)'
  //   volt_drop_pct    /^(volt\s*drop|vd\s*%|…)/i → 'VD %'
  //
  // The importer also hardcodes the cable tag at column B, so we keep
  // the tag IN B regardless of how we order anything else.
  const HEADERS: Array<[string, string]> = [
    ['A', 'Cable No'],
    ['B', 'Cable Tag'],
    ['C', 'From'],
    ['D', 'To'],
    ['E', 'Voltage (V)'],
    ['F', 'Load'],
    ['G', 'Size mm²'],
    ['H', 'Cores'],
    ['I', 'Conductor'],
    ['J', 'Insulation'],
    ['K', 'Ω/km'],
    ['L', 'Length (m)'],
    ['M', 'VD %'],
    ['N', 'Cumulative VD %'],
    ['O', 'Derated In A'],
    ['P', 'Install method'],
    ['Q', 'Tag override'],
    ['R', 'Notes'],
  ]
  for (const [letter, label] of HEADERS) {
    const cell = ws.getCell(`${letter}6`)
    cell.value = label
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_GREY },
    }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = {
      bottom: { style: 'medium', color: { argb: WM_AMBER } },
    }
  }
  ws.getRow(6).height = 30

  // Reasonable column widths
  ws.getColumn('A').width = 9
  ws.getColumn('B').width = 18
  ws.getColumn('C').width = 14
  ws.getColumn('D').width = 14
  ws.getColumn('E').width = 11
  ws.getColumn('F').width = 9
  ws.getColumn('G').width = 10
  ws.getColumn('H').width = 8
  ws.getColumn('I').width = 11
  ws.getColumn('J').width = 11
  ws.getColumn('K').width = 9
  ws.getColumn('L').width = 11
  ws.getColumn('M').width = 9
  ws.getColumn('N').width = 13
  ws.getColumn('O').width = 12
  ws.getColumn('P').width = 16
  ws.getColumn('Q').width = 14
  ws.getColumn('R').width = 30

  // Group cables by (section, conductor) so we can stamp section header
  // rows the way the importer expects. Section first (NORMAL/EMERGENCY,
  // pulled from the cable's supply), conductor second (CU/AL).
  const grouped = groupBySectionConductor(payload.cables, payload.supplies)
  let rowIdx = 7

  for (const group of grouped) {
    if (group.section) {
      writeSectionHeaderRow(ws, rowIdx, group.section)
      rowIdx++
    }
    writeSectionHeaderRow(ws, rowIdx, group.conductor === 'CU' ? 'Copper' : 'Aluminium')
    rowIdx++

    for (const c of group.cables) {
      writeCableRow(ws, rowIdx, c)
      rowIdx++
    }
  }
}

interface CableGroup {
  section: 'NORMAL' | 'EMERGENCY' | null
  conductor: 'CU' | 'AL'
  cables: EnrichedCable[]
}

function groupBySectionConductor(
  cables: EnrichedCable[],
  supplies: ExportPayload['supplies'],
): CableGroup[] {
  // Map supply_id → section so we can route each cable
  const sectionBySupply = new Map<string, 'NORMAL' | 'EMERGENCY' | null>()
  for (const s of supplies) {
    const v = s.section
    sectionBySupply.set(
      s.id,
      v === 'EMERGENCY' ? 'EMERGENCY' : v === 'NORMAL' ? 'NORMAL' : null,
    )
  }

  // Bucket: section then conductor
  const buckets = new Map<string, CableGroup>()
  const orderKeys: string[] = []
  for (const c of cables) {
    const section = sectionBySupply.get(c.supply_id) ?? null
    const key = `${section ?? '_'}|${c.conductor}`
    if (!buckets.has(key)) {
      buckets.set(key, { section, conductor: c.conductor, cables: [] })
      orderKeys.push(key)
    }
    buckets.get(key)!.cables.push(c)
  }
  // Stable order: NORMAL first, then EMERGENCY, then null. CU before AL.
  orderKeys.sort((a, b) => {
    const [sa, ca] = a.split('|')
    const [sb, cb] = b.split('|')
    const sectionRank = (s: string) =>
      s === 'NORMAL' ? 0 : s === 'EMERGENCY' ? 1 : 2
    if (sectionRank(sa) !== sectionRank(sb)) return sectionRank(sa) - sectionRank(sb)
    const condRank = (c: string) => (c === 'CU' ? 0 : 1)
    return condRank(ca) - condRank(cb)
  })

  return orderKeys.map((k) => buckets.get(k)!)
}

function writeSectionHeaderRow(
  ws: ExcelJS.Worksheet,
  rowIdx: number,
  label: string,
): void {
  const cell = ws.getCell(`A${rowIdx}`)
  cell.value = label
  cell.font = { bold: true, italic: true, size: 11, color: { argb: WM_AMBER } }
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: SECTION_GREY },
  }
  cell.alignment = { horizontal: 'left', vertical: 'middle' }
  // Faint amber underline across the whole row to draw the eye
  for (let col = 1; col <= 18; col++) {
    const c = ws.getRow(rowIdx).getCell(col)
    if (col !== 1) {
      c.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: SECTION_GREY },
      }
    }
    c.border = {
      bottom: { style: 'thin', color: { argb: WM_AMBER } },
    }
  }
}

function writeCableRow(
  ws: ExcelJS.Worksheet,
  rowIdx: number,
  c: EnrichedCable,
): void {
  ws.getCell(`A${rowIdx}`).value = c.cable_no
  ws.getCell(`B${rowIdx}`).value = c.cable_tag
  ws.getCell(`C${rowIdx}`).value = c.from_label
  ws.getCell(`D${rowIdx}`).value = c.to_label
  ws.getCell(`E${rowIdx}`).value = c.voltage_v
  ws.getCell(`F${rowIdx}`).value = c.load_a
  ws.getCell(`G${rowIdx}`).value = c.size_mm2
  ws.getCell(`H${rowIdx}`).value = c.cores
  ws.getCell(`I${rowIdx}`).value = c.conductor
  ws.getCell(`J${rowIdx}`).value = c.insulation
  ws.getCell(`K${rowIdx}`).value = c.ohm_per_km
  ws.getCell(`L${rowIdx}`).value = effectiveLength(c)
  ws.getCell(`M${rowIdx}`).value = c.vd_pct
  ws.getCell(`N${rowIdx}`).value = c.cumulative_vd_pct
  ws.getCell(`O${rowIdx}`).value = c.derated_current_rating_a
  ws.getCell(`P${rowIdx}`).value = c.installation_method
  ws.getCell(`Q${rowIdx}`).value = c.tag_override
  ws.getCell(`R${rowIdx}`).value = c.notes

  // Number formats
  ws.getCell(`G${rowIdx}`).numFmt = '0'
  ws.getCell(`K${rowIdx}`).numFmt = '0.000'
  ws.getCell(`L${rowIdx}`).numFmt = '0.00'
  ws.getCell(`M${rowIdx}`).numFmt = '0.00'
  ws.getCell(`N${rowIdx}`).numFmt = '0.00'
  ws.getCell(`O${rowIdx}`).numFmt = '0'

  // Faint dividers
  for (let col = 1; col <= 18; col++) {
    ws.getRow(rowIdx).getCell(col).border = {
      bottom: { style: 'hair', color: { argb: 'FF333333' } },
    }
  }

  // Light fill if the manual_override flag is set, signalling "engineer
  // typed Ω/km manually — SANS lookup didn't cover this row".
  if (c.manual_override) {
    for (let col = 1; col <= 18; col++) {
      ws.getRow(rowIdx).getCell(col).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF332600' },
      }
    }
  }
}

function effectiveLength(c: EnrichedCable): number | null {
  if (c.confirmed_length_m != null) return c.confirmed_length_m
  if (c.measured_length_m != null) return c.measured_length_m
  return null
}

function buildCostSheet(wb: ExcelJS.Workbook, payload: ExportPayload): void {
  const ws = wb.addWorksheet('COST SUMMARY', {
    properties: { tabColor: { argb: 'FF4A9E6E' } },
  })
  ws.getColumn('A').width = 14
  ws.getColumn('B').width = 14
  ws.getColumn('C').width = 14
  ws.getColumn('D').width = 16
  ws.getColumn('E').width = 14
  ws.getColumn('F').width = 14
  ws.getColumn('G').width = 14

  ws.mergeCells('A1:G1')
  ws.getCell('A1').value = `COST SUMMARY · ${payload.revision.code}`
  ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }
  ws.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: HEADER_GREY },
  }
  ws.getRow(1).height = 22

  const headers = [
    'Size mm²',
    'Total length m',
    'Supply R/m',
    'Install R/m',
    'Terminations',
    'Term. R each',
    'Line total ZAR',
  ]
  headers.forEach((h, i) => {
    const cell = ws.getRow(3).getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_GREY },
    }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
  ws.getRow(3).height = 22

  // Aggregate length-by-size + termination-count-by-size
  const lengthBySize = new Map<number, number>()
  const termsBySize = new Map<number, number>()
  for (const c of payload.cables) {
    const len = effectiveLength(c) ?? 0
    lengthBySize.set(c.size_mm2, (lengthBySize.get(c.size_mm2) ?? 0) + len)
    termsBySize.set(c.size_mm2, (termsBySize.get(c.size_mm2) ?? 0) + 2)
  }

  let rowIdx = 4
  let grandTotal = 0
  // Sort by size ascending
  const sizes = Array.from(
    new Set([
      ...payload.costLines.map((l) => l.size_mm2),
      ...Array.from(lengthBySize.keys()),
    ]),
  ).sort((a, b) => a - b)

  for (const size of sizes) {
    const line = payload.costLines.find((l) => l.size_mm2 === size)
    const totalLen = lengthBySize.get(size) ?? 0
    const terms = termsBySize.get(size) ?? 0
    const supplyRate = line?.supply_rate_per_m ?? 0
    const installRate = line?.install_rate_per_m ?? 0
    const termRate = line?.termination_rate_each ?? 0
    const lineTotal =
      totalLen * (supplyRate + installRate) + terms * termRate
    grandTotal += lineTotal

    ws.getCell(`A${rowIdx}`).value = size
    ws.getCell(`B${rowIdx}`).value = totalLen
    ws.getCell(`C${rowIdx}`).value = supplyRate
    ws.getCell(`D${rowIdx}`).value = installRate
    ws.getCell(`E${rowIdx}`).value = terms
    ws.getCell(`F${rowIdx}`).value = termRate
    ws.getCell(`G${rowIdx}`).value = lineTotal

    ws.getCell(`B${rowIdx}`).numFmt = '0.00'
    ws.getCell(`C${rowIdx}`).numFmt = '0.00'
    ws.getCell(`D${rowIdx}`).numFmt = '0.00'
    ws.getCell(`F${rowIdx}`).numFmt = '0.00'
    ws.getCell(`G${rowIdx}`).numFmt = '#,##0.00'
    rowIdx++
  }

  // Totals block
  rowIdx++
  const contingency = grandTotal * 0.1
  const subTotal = grandTotal + contingency
  const vat = subTotal * 0.15

  function totalRow(label: string, val: number, bold = false): void {
    ws.getCell(`F${rowIdx}`).value = label
    ws.getCell(`G${rowIdx}`).value = val
    ws.getCell(`G${rowIdx}`).numFmt = '#,##0.00'
    if (bold) {
      ws.getCell(`F${rowIdx}`).font = { bold: true }
      ws.getCell(`G${rowIdx}`).font = { bold: true, color: { argb: WM_AMBER } }
    }
    rowIdx++
  }
  totalRow('Materials + install', grandTotal)
  totalRow('+ 10% contingency', contingency)
  totalRow('Sub-total', subTotal)
  totalRow('+ 15% VAT', vat)
  totalRow('Grand total', subTotal + vat, true)
}

function buildFactsSheet(wb: ExcelJS.Workbook, payload: ExportPayload): void {
  const ws = wb.addWorksheet('FACTS AND FIGURES', {
    properties: { tabColor: { argb: 'FF5B83B5' } },
  })
  ws.getColumn('A').width = 12
  ws.getColumn('B').width = 12
  ws.getColumn('C').width = 14
  ws.getColumn('D').width = 14
  ws.getColumn('E').width = 12

  ws.mergeCells('A1:E1')
  ws.getCell('A1').value = 'FACTS AND FIGURES — Ω/km values used in this revision'
  ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }
  ws.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: HEADER_GREY },
  }
  ws.getRow(1).height = 22

  const headers = ['Size mm²', 'Conductor', 'Insulation', 'Cores', 'Ω/km']
  headers.forEach((h, i) => {
    const cell = ws.getRow(3).getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_GREY },
    }
    cell.alignment = { horizontal: 'center' }
  })

  // De-dupe the (size, conductor, insulation, cores) tuples actually
  // used by cables in this revision.
  const seen = new Map<string, EnrichedCable>()
  for (const c of payload.cables) {
    if (c.ohm_per_km == null) continue
    const key = `${c.size_mm2}|${c.conductor}|${c.insulation}|${c.cores}`
    if (!seen.has(key)) seen.set(key, c)
  }
  const rows = Array.from(seen.values()).sort(
    (a, b) =>
      a.conductor.localeCompare(b.conductor) ||
      a.insulation.localeCompare(b.insulation) ||
      a.size_mm2 - b.size_mm2,
  )
  let rowIdx = 4
  for (const c of rows) {
    ws.getCell(`A${rowIdx}`).value = c.size_mm2
    ws.getCell(`B${rowIdx}`).value = c.conductor
    ws.getCell(`C${rowIdx}`).value = c.insulation
    ws.getCell(`D${rowIdx}`).value = c.cores
    ws.getCell(`E${rowIdx}`).value = c.ohm_per_km
    ws.getCell(`E${rowIdx}`).numFmt = '0.000'
    rowIdx++
  }
}

function buildHistorySheet(wb: ExcelJS.Workbook, payload: ExportPayload): void {
  const ws = wb.addWorksheet('REVISION HISTORY', {
    properties: { tabColor: { argb: 'FF888888' } },
  })
  ws.getColumn('A').width = 19
  ws.getColumn('B').width = 14
  ws.getColumn('C').width = 22
  ws.getColumn('D').width = 32
  ws.getColumn('E').width = 32
  ws.getColumn('F').width = 18
  ws.getColumn('G').width = 28

  ws.mergeCells('A1:G1')
  ws.getCell('A1').value = `REVISION HISTORY · ${payload.revision.code}`
  ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }
  ws.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: HEADER_GREY },
  }
  ws.getRow(1).height = 22

  const headers = [
    'Changed at',
    'Entity',
    'Field',
    'Old value',
    'New value',
    'By',
    'Reason',
  ]
  headers.forEach((h, i) => {
    const cell = ws.getRow(3).getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: HEADER_GREY },
    }
    cell.alignment = { horizontal: 'center' }
  })

  let rowIdx = 4
  for (const r of payload.changeLog) {
    ws.getCell(`A${rowIdx}`).value = r.changed_at.replace('T', ' ').slice(0, 19)
    ws.getCell(`B${rowIdx}`).value = r.entity_type
    ws.getCell(`C${rowIdx}`).value = r.field_name ?? ''
    ws.getCell(`D${rowIdx}`).value = renderJson(r.old_value)
    ws.getCell(`E${rowIdx}`).value = renderJson(r.new_value)
    ws.getCell(`F${rowIdx}`).value = r.changed_by_name ?? ''
    ws.getCell(`G${rowIdx}`).value = r.reason ?? ''
    rowIdx++
  }
}

function renderJson(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
