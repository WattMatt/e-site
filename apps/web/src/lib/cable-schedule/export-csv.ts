/**
 * CSV renderers — four flat files exported from a single payload.
 *
 *   schedule    — one row per cable
 *   tags        — one row per cable_tag (each cable has FROM + TO)
 *   cost        — one row per cost line + aggregate totals
 *   change_log  — chronological audit trail for the revision
 *
 * All values RFC-4180 escaped: wrap fields containing commas/quotes/
 * newlines in double quotes, double up internal quotes.
 */

import type { ExportPayload } from './export-payload'

const NL = '\r\n' // Windows-style — Excel + LibreOffice both happy

export type CsvKind = 'schedule' | 'tags' | 'cost' | 'change_log'

export function renderCsv(kind: CsvKind, payload: ExportPayload): string {
  switch (kind) {
    case 'schedule':   return scheduleCsv(payload)
    case 'tags':       return tagsCsv(payload)
    case 'cost':       return costCsv(payload)
    case 'change_log': return changeLogCsv(payload)
  }
}

function scheduleCsv(payload: ExportPayload): string {
  const header = [
    'cable_no',
    'cable_tag',
    'from',
    'to',
    'voltage_v',
    'load_a',
    'size_mm2',
    'cores',
    'conductor',
    'insulation',
    'armour',
    'standard',
    'ohm_per_km',
    'measured_length_m',
    'confirmed_length_m',
    'length_status',
    'vd_pct',
    'cumulative_vd_pct',
    'derated_current_rating_a',
    'installation_method',
    'depth_mm',
    'grouped_with',
    'ambient_temp_c',
    'tag_override',
    'manual_override',
    'notes',
  ]
  const lines = [header.join(',')]
  for (const c of payload.cables) {
    lines.push(
      [
        c.cable_no,
        c.cable_tag,
        c.from_label,
        c.to_label,
        c.voltage_v ?? '',
        c.load_a ?? '',
        c.size_mm2,
        c.cores,
        c.conductor,
        c.insulation,
        c.armour ?? '',
        c.standard ?? '',
        c.ohm_per_km ?? '',
        c.measured_length_m ?? '',
        c.confirmed_length_m ?? '',
        c.length_status,
        round2(c.vd_pct),
        round2(c.cumulative_vd_pct),
        c.derated_current_rating_a ?? '',
        c.installation_method ?? '',
        c.depth_mm ?? '',
        c.grouped_with,
        c.ambient_temp_c,
        c.tag_override ?? '',
        c.manual_override ? 'true' : 'false',
        c.notes ?? '',
      ].map(esc).join(','),
    )
  }
  return lines.join(NL) + NL
}

function tagsCsv(payload: ExportPayload): string {
  const header = [
    'cable_id',
    'cable_no',
    'cable_tag',
    'end_position',
    'tag_text',
    'printed',
    'printed_at',
  ]
  const lines = [header.join(',')]
  const cableById = new Map(payload.cables.map((c) => [c.id, c] as const))
  for (const t of payload.cableTags) {
    const cable = cableById.get(t.cable_id)
    lines.push(
      [
        t.cable_id,
        cable?.cable_no ?? '',
        cable?.cable_tag ?? '',
        t.end_position,
        t.tag_text,
        t.printed ? 'true' : 'false',
        t.printed_at ?? '',
      ].map(esc).join(','),
    )
  }
  return lines.join(NL) + NL
}

function costCsv(payload: ExportPayload): string {
  const header = [
    'size_mm2',
    'total_length_m',
    'supply_rate_per_m',
    'install_rate_per_m',
    'termination_count',
    'termination_rate_each',
    'line_total_zar',
  ]
  const lines = [header.join(',')]

  const lengthBySize = new Map<number, number>()
  const termsBySize = new Map<number, number>()
  for (const c of payload.cables) {
    const len = c.confirmed_length_m ?? c.measured_length_m ?? 0
    lengthBySize.set(c.size_mm2, (lengthBySize.get(c.size_mm2) ?? 0) + len)
    termsBySize.set(c.size_mm2, (termsBySize.get(c.size_mm2) ?? 0) + 2)
  }

  const sizes = Array.from(
    new Set([
      ...payload.costLines.map((l) => l.size_mm2),
      ...Array.from(lengthBySize.keys()),
    ]),
  ).sort((a, b) => a - b)

  let materialsTotal = 0
  for (const size of sizes) {
    const line = payload.costLines.find((l) => l.size_mm2 === size)
    const len = lengthBySize.get(size) ?? 0
    const terms = termsBySize.get(size) ?? 0
    const supply = line?.supply_rate_per_m ?? 0
    const install = line?.install_rate_per_m ?? 0
    const termRate = line?.termination_rate_each ?? 0
    const lineTotal = len * (supply + install) + terms * termRate
    materialsTotal += lineTotal
    lines.push(
      [
        size,
        round2(len),
        round2(supply),
        round2(install),
        terms,
        round2(termRate),
        round2(lineTotal),
      ].map(esc).join(','),
    )
  }

  // Totals block as trailing rows — same column layout, label in size col.
  const contingency = materialsTotal * 0.1
  const subTotal = materialsTotal + contingency
  const vat = subTotal * 0.15
  lines.push('')
  lines.push(['MATERIALS_TOTAL', '', '', '', '', '', round2(materialsTotal)].map(esc).join(','))
  lines.push(['CONTINGENCY_10PCT', '', '', '', '', '', round2(contingency)].map(esc).join(','))
  lines.push(['SUB_TOTAL', '', '', '', '', '', round2(subTotal)].map(esc).join(','))
  lines.push(['VAT_15PCT', '', '', '', '', '', round2(vat)].map(esc).join(','))
  lines.push(['GRAND_TOTAL', '', '', '', '', '', round2(subTotal + vat)].map(esc).join(','))

  return lines.join(NL) + NL
}

function changeLogCsv(payload: ExportPayload): string {
  const header = [
    'changed_at',
    'entity_type',
    'entity_id',
    'field_name',
    'old_value',
    'new_value',
    'changed_by',
    'reason',
  ]
  const lines = [header.join(',')]
  for (const r of payload.changeLog) {
    lines.push(
      [
        r.changed_at,
        r.entity_type,
        r.entity_id,
        r.field_name ?? '',
        renderJson(r.old_value),
        renderJson(r.new_value),
        r.changed_by_name ?? '',
        r.reason ?? '',
      ].map(esc).join(','),
    )
  }
  return lines.join(NL) + NL
}

function esc(v: unknown): string {
  if (v == null) return ''
  const s = typeof v === 'string' ? v : String(v)
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function round2(n: number): string {
  if (!Number.isFinite(n)) return ''
  return (Math.round(n * 100) / 100).toFixed(2)
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
