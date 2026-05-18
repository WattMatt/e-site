/**
 * CSV renderers — four flat files exported from a single payload.
 *
 *   schedule    — one row per RUN (= supply). Parallel strands collapse
 *                under a "parallel_count" column; per-strand detail is in
 *                the `tags` and `change_log` variants.
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
  // ONE ROW PER RUN — collapse parallel strands under their shared logical
  // feed. Per-strand detail (individual measured length, ohm override, tag)
  // lives in the tags CSV (also a per-cable variant — `?type=tags`) and in
  // the change_log CSV. This sheet is the buyer's schedule.
  const header = [
    'run_no',
    'cable_tag',
    'from',
    'to',
    'voltage_v',
    'load_a',
    'parallel_count',
    'size_mm2',
    'cores',
    'conductor',
    'insulation',
    'ohm_per_km',
    'effective_length_m', // worst across strands
    'length_status',      // worst across strands
    'vd_pct',
    'cumulative_vd_pct',
    'combined_capacity_a', // sum across strands
    'under_rated',
    'installation_method',
    'depth_mm',
    'grouped_with',
    'mixed_properties',   // semicolon-joined list of divergent fields, blank when consistent
    'notes',              // head strand's notes
  ]
  function runTag(run: ExportPayload['runs'][number]): string {
    const head = run.cables[0]
    return head?.tag_override?.trim() || `${run.from_label}-${run.to_label}`
  }
  function runLen(run: ExportPayload['runs'][number]): number | '' {
    let worst: number | null = null
    for (const c of run.cables) {
      const l = c.confirmed_length_m ?? c.measured_length_m
      if (l == null) continue
      if (worst == null || l > worst) worst = l
    }
    return worst ?? ''
  }
  const lines = [header.join(',')]
  let runNo = 1
  for (const run of payload.runs) {
    const head = run.cables[0]
    lines.push(
      [
        runNo,
        runTag(run),
        run.from_label,
        run.to_label,
        run.voltage_v ?? '',
        run.load_a ?? '',
        run.parallel_count,
        run.size_mm2,
        run.cores,
        run.conductor,
        run.insulation,
        run.ohm_per_km ?? '',
        runLen(run),
        run.length_status,
        round2(run.vd_pct),
        round2(run.cumulative_vd_pct),
        run.combined_capacity_a ?? '',
        run.under_rated ? 'true' : 'false',
        run.installation_method ?? '',
        run.depth_mm ?? '',
        run.grouped_with,
        run.mixed_properties.fields.join(';'),
        head?.notes ?? '',
      ].map(esc).join(','),
    )
    runNo++
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
    'conductor',
    'total_length_m',
    'supply_rate_per_m',
    'install_rate_per_m',
    'termination_count',
    'termination_rate_each',
    'line_total_zar',
  ]
  const lines = [header.join(',')]

  type Agg = { size: number; conductor: 'CU' | 'AL'; totalLength: number; terms: number }
  const aggs = new Map<string, Agg>()
  const keyOf = (size: number, conductor: 'CU' | 'AL') => `${size}|${conductor}`

  for (const c of payload.cables) {
    const conductor = (c.conductor ?? 'CU') as 'CU' | 'AL'
    const k = keyOf(c.size_mm2, conductor)
    const existing = aggs.get(k) ?? { size: c.size_mm2, conductor, totalLength: 0, terms: 0 }
    const len = c.confirmed_length_m ?? c.measured_length_m ?? 0
    existing.totalLength += len
    existing.terms += 2
    aggs.set(k, existing)
  }

  // Seed cost_lines so rate-only rows (no cables yet) surface as zero-length
  // entries — matches Excel (T1) + PDF (T2) shape.
  for (const l of payload.costLines) {
    const conductor = (l.conductor ?? 'CU') as 'CU' | 'AL'
    const k = keyOf(l.size_mm2, conductor)
    if (!aggs.has(k)) {
      aggs.set(k, { size: l.size_mm2, conductor, totalLength: 0, terms: 0 })
    }
  }

  const ordered = Array.from(aggs.values()).sort((a, b) => {
    if (a.size !== b.size) return a.size - b.size
    return a.conductor.localeCompare(b.conductor) // AL before CU
  })

  let materialsTotal = 0
  for (const agg of ordered) {
    const line =
      payload.costLines.find((l) => l.size_mm2 === agg.size && (l.conductor ?? 'CU') === agg.conductor) ??
      payload.costLines.find((l) => l.size_mm2 === agg.size)
    const supply = line?.supply_rate_per_m ?? 0
    const install = line?.install_rate_per_m ?? 0
    const termRate = line?.termination_rate_each ?? 0
    const lineTotal = agg.totalLength * (supply + install) + agg.terms * termRate
    materialsTotal += lineTotal
    lines.push(
      [
        agg.size,
        agg.conductor,
        round2(agg.totalLength),
        round2(supply),
        round2(install),
        agg.terms,
        round2(termRate),
        round2(lineTotal),
      ].map(esc).join(','),
    )
  }

  // Totals block as trailing rows — same column layout, label in size col.
  // Contingency removed 2026-05-17 (net contracts). VAT applied directly to
  // materials+install subtotal.
  const vat = materialsTotal * 0.15
  lines.push('')
  lines.push(['MATERIALS_TOTAL', '', '', '', '', '', '', round2(materialsTotal)].map(esc).join(','))
  lines.push(['VAT_15PCT', '', '', '', '', '', '', round2(vat)].map(esc).join(','))
  lines.push(['GRAND_TOTAL', '', '', '', '', '', '', round2(materialsTotal + vat)].map(esc).join(','))

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
