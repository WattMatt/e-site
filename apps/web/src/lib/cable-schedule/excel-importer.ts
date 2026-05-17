/**
 * Cable schedule Excel importer — parses an .xlsx into a preview shape
 * the validation grid can render. Aimed at the reference file
 * CABLE SCHEDULE PMM.xlsx but tolerant of column-order / header-row
 * variations so future projects ingest cleanly.
 *
 * Pipeline:
 *   1. Open workbook via exceljs.
 *   2. Inspect every sheet, propose a role (CABLE SCHEDULE / COST SUMMARY /
 *      FACTS AND FIGURES / IGNORE) — but ONLY the CABLE SCHEDULE sheet
 *      gets parsed in C-7.1. The other two roles come in a follow-up slice.
 *   3. On the chosen schedule sheet, scan the first 25 rows for the header
 *      row (most matches against the canonical labels).
 *   4. Auto-map columns by header text.
 *   5. Walk data rows: skip blank, treat "Aluminium" / "Copper" /
 *      "Emergency" / "Normal" header rows as conductor / section
 *      defaults applied downward, skip placeholder rows.
 *   6. Evaluate formula cells via cell.result (exceljs pre-computes
 *      the saved evaluation). Track #VALUE! / #N/A as warnings.
 *   7. Group rows by (FROM, TO) into supplies. Increment cable_no
 *      within each group. Detect duplicate tag rows as red.
 *   8. Return ImportPreview with one row per detected cable, status
 *      badge per row, plus an aggregate summary at the top.
 *
 * No DB writes in here — that's the commit phase.
 */

import ExcelJS from 'exceljs'

export interface ImportedCable {
  /** 1-based sequential index in the source workbook (after skipping
   *  non-data rows). Used to anchor the preview UI on the source. */
  source_row: number
  /** Provided tag text (column A or B) if non-empty, else null. */
  tag_input: string | null
  from_label: string
  to_label: string
  voltage_v: number | null
  load_a: number | null
  size_mm2: number | null
  ohm_per_km: number | null
  cable_no: number
  /** When > 0, this row was fanned out from a single Excel row with a "Parallel" column. Records which strand in the set this is (1..parallel_count). 0 means single. */
  fanned_from_parallel?: number
  measured_length_m: number | null
  /** Workbook's own VD% column reading — used for fidelity verification. */
  source_vd_pct: number | null
  /** Conductor inherited from the most recent 'Aluminium' / 'Copper' header. */
  conductor: 'CU' | 'AL'
  /** Section inherited from the most recent 'Normal' / 'Emergency' header. */
  section: 'NORMAL' | 'EMERGENCY' | null
  /** Notes / warnings the parser attached to this row. */
  warnings: string[]
  /** Hard errors blocking import. */
  errors: string[]
}

export interface ImportPreview {
  schedule_sheet_name: string | null
  schedule_header_row: number | null
  detected_columns: Record<string, string>     // logical → A1 column letter
  cables: ImportedCable[]
  section_breaks: number                       // count of blank-row separators detected
  conductor_headers: number                    // count of 'Aluminium' / 'Copper' header rows
  placeholders_skipped: number                 // 'insert rows' etc.
  duplicate_tags: number
  /**
   * Round-trip / legacy detection — empty in the normal one-row-per-cable
   * legacy case. Populated when:
   *  - parallel_fanouts > 0: rows had an explicit "Parallel" column ≥ 2;
   *    each such row was fanned out into N ImportedCable entries.
   *  - legacy_format_detected: no "Parallel" column was found AND at least
   *    one (FROM, TO) group repeats. The importer's pre-existing grouping
   *    already collapses these into one supply with N cables — this flag
   *    just surfaces the fact in the preview UI.
   */
  parallel_fanouts: number
  legacy_format_detected: boolean
  sheet_summary: Array<{
    name: string
    role: 'CABLE SCHEDULE' | 'COST SUMMARY' | 'FACTS AND FIGURES' | 'IGNORE'
    row_count: number
  }>
}

const HEADER_LABELS: Record<string, RegExp> = {
  cable_tag:        /^cable\s*tag$/i,
  from_node:        /^from$/i,
  to_node:          /^to$/i,
  voltage_v:        /^voltage/i,
  design_load_a:    /^(load|current|breaker)$/i,
  size_mm2:         /^(type|size|mm.?|csa)/i,
  ohm_per_km:       /^(ohm\/km|Ω\/km|impedance|r\s*per\s*km)/i,
  cable_no:         /^(cable\s*no|c\/no|cable\s*number)/i,
  // Parallel column: one row per RUN with a count → fan out into N cables.
  // Accepts plain "Parallel", "Parallel cables", "Cables", "×N", "x N".
  parallel_count:   /^(parallel(\s*cables)?|cables(\s*in\s*parallel)?|×\s*n|x\s*n)$/i,
  measured_length_m:/^(length|route\s*length|measured\s*length)/i,
  volt_drop_pct:    /^(volt\s*drop|vd\s*%|voltage\s*drop)/i,
}

function normaliseText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  if (typeof v === 'object' && 'text' in (v as any)) return String((v as any).text).trim()
  if (typeof v === 'object' && 'richText' in (v as any)) {
    return (v as any).richText.map((r: any) => r.text).join('').trim()
  }
  if (typeof v === 'object' && 'result' in (v as any)) return normaliseText((v as any).result)
  return String(v).trim()
}

function cellNumber(c: ExcelJS.Cell): number | null {
  const raw = (c.value as any)
  // Formulas: prefer .result (pre-computed), fall back to .value
  const candidate =
    raw != null && typeof raw === 'object' && 'result' in raw ? raw.result : raw
  if (candidate == null || candidate === '') return null
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  const n = Number(candidate)
  return Number.isFinite(n) ? n : null
}

function cellText(c: ExcelJS.Cell): string {
  return normaliseText(c.value)
}

function cellHasError(c: ExcelJS.Cell): boolean {
  const raw = c.value as any
  if (raw == null) return false
  if (typeof raw === 'object' && 'error' in raw) return true
  // Formula cells with no resolved result also count as "needs lookup"
  if (typeof raw === 'object' && 'formula' in raw && raw.result == null) return true
  return false
}

function classifySheet(
  ws: ExcelJS.Worksheet,
): 'CABLE SCHEDULE' | 'COST SUMMARY' | 'FACTS AND FIGURES' | 'IGNORE' {
  // Scan the first 20 rows for clues.
  const upper = 20
  let hasFrom = false, hasTo = false, hasCableTag = false
  let hasSumif = false, hasCostText = false, hasFactsText = false, hasOhmCol = false
  for (let r = 1; r <= Math.min(upper, ws.rowCount); r++) {
    const row = ws.getRow(r)
    row.eachCell({ includeEmpty: false }, (cell) => {
      const t = cellText(cell)
      if (/cable.?tag/i.test(t)) hasCableTag = true
      if (/^from$/i.test(t)) hasFrom = true
      if (/^to$/i.test(t)) hasTo = true
      if (/cost\s*summary/i.test(t)) hasCostText = true
      if (/terminations/i.test(t)) hasCostText = true
      if (/facts\s*and\s*figures/i.test(t)) hasFactsText = true
      if (/^table\s*\d/i.test(t)) hasFactsText = true
      if (/(ω|ohm).?\/.?km/i.test(t)) hasOhmCol = true
      const f = (cell.value as any)?.formula
      if (typeof f === 'string' && /sumif/i.test(f)) hasSumif = true
    })
  }
  if (hasCableTag && hasFrom && hasTo) return 'CABLE SCHEDULE'
  if (hasCostText || hasSumif) return 'COST SUMMARY'
  if (hasFactsText || hasOhmCol) return 'FACTS AND FIGURES'
  // Almost-empty sheet
  if (ws.rowCount < 3 || ws.columnCount < 3) return 'IGNORE'
  return 'IGNORE'
}

function findHeaderRow(ws: ExcelJS.Worksheet): { row: number | null; columns: Record<string, string> } {
  const maxScan = Math.min(25, ws.rowCount)
  let best = { row: 0, score: 0, columns: {} as Record<string, string> }
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r)
    const matches: Record<string, string> = {}
    let score = 0
    row.eachCell({ includeEmpty: false }, (cell) => {
      const t = normaliseText(cell.value).toLowerCase()
      for (const [logical, re] of Object.entries(HEADER_LABELS)) {
        if (re.test(t) && !matches[logical]) {
          matches[logical] = cell.address.match(/^[A-Z]+/)?.[0] ?? ''
          score++
        }
      }
    })
    if (score > best.score) best = { row: r, score, columns: matches }
  }
  return { row: best.score >= 3 ? best.row : null, columns: best.columns }
}

function colToText(col: ExcelJS.Column | number | string): string {
  if (typeof col === 'string') return col
  if (typeof col === 'number') {
    // exceljs column number 1-based → 'A', 'B' …
    let n = col
    let s = ''
    while (n > 0) {
      const r = (n - 1) % 26
      s = String.fromCharCode(65 + r) + s
      n = Math.floor((n - 1) / 26)
    }
    return s
  }
  return col.letter
}

export async function parseScheduleWorkbook(buffer: Buffer): Promise<ImportPreview> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as ArrayBuffer)

  const sheet_summary: ImportPreview['sheet_summary'] = []
  let scheduleWs: ExcelJS.Worksheet | null = null
  for (const ws of wb.worksheets) {
    const role = classifySheet(ws)
    sheet_summary.push({ name: ws.name, role, row_count: ws.rowCount })
    if (role === 'CABLE SCHEDULE' && !scheduleWs) scheduleWs = ws
  }

  if (!scheduleWs) {
    return {
      schedule_sheet_name: null,
      schedule_header_row: null,
      detected_columns: {},
      cables: [],
      section_breaks: 0,
      conductor_headers: 0,
      placeholders_skipped: 0,
      duplicate_tags: 0,
      parallel_fanouts: 0,
      legacy_format_detected: false,
      sheet_summary,
    }
  }

  const { row: headerRow, columns } = findHeaderRow(scheduleWs)
  if (!headerRow) {
    return {
      schedule_sheet_name: scheduleWs.name,
      schedule_header_row: null,
      detected_columns: {},
      cables: [],
      section_breaks: 0,
      conductor_headers: 0,
      placeholders_skipped: 0,
      duplicate_tags: 0,
      parallel_fanouts: 0,
      legacy_format_detected: false,
      sheet_summary,
    }
  }

  let section_breaks = 0
  let conductor_headers = 0
  let placeholders_skipped = 0
  let conductorContext: 'CU' | 'AL' = 'CU'
  let sectionContext: 'NORMAL' | 'EMERGENCY' | null = null
  const cables: ImportedCable[] = []
  const seenTags = new Map<string, number>()
  let duplicate_tags = 0
  let parallel_fanouts = 0

  // Map logical → col letter → for fast access
  const col = (logical: string) => columns[logical]
  function getCell(rowIdx: number, logical: string): ExcelJS.Cell | null {
    const letter = col(logical)
    if (!letter) return null
    return scheduleWs!.getCell(`${letter}${rowIdx}`)
  }

  // Track running cable_no per (from, to) group
  const cableNoByGroup = new Map<string, number>()

  for (let r = headerRow + 1; r <= scheduleWs.rowCount; r++) {
    const row = scheduleWs.getRow(r)
    // Stop at a second occurrence of the header (reference file has one at
    // row 164 as a scratch area)
    const firstCellText = cellText(row.getCell(col('from_node') || 'A')).toLowerCase()
    if (firstCellText === 'from') break

    // Detect all-blank row
    let nonEmpty = 0
    row.eachCell({ includeEmpty: false }, () => { nonEmpty++ })
    if (nonEmpty === 0) { section_breaks++; continue }

    // Detect conductor / section header row (only column A populated with a
    // recognised keyword)
    if (nonEmpty <= 2) {
      const aText = cellText(row.getCell('A'))
      const lower = aText.toLowerCase()
      if (/aluminium/.test(lower) || /copper/.test(lower)) {
        conductorContext = /aluminium/.test(lower) ? 'AL' : 'CU'
        conductor_headers++
        continue
      }
      if (/^emergency$/i.test(lower) || /^normal$/i.test(lower)) {
        sectionContext = /emergency/i.test(lower) ? 'EMERGENCY' : 'NORMAL'
        continue
      }
      if (/insert\s*rows?/i.test(lower)) {
        placeholders_skipped++
        continue
      }
    }

    // Real data row — pull cells
    const from = cellText(row.getCell(col('from_node') || 'A')).trim()
    const to = cellText(row.getCell(col('to_node') || 'A')).trim()
    if (!from && !to) { section_breaks++; continue }

    const warnings: string[] = []
    const errors: string[] = []

    const sizeCell = getCell(r, 'size_mm2')
    const ohmCell  = getCell(r, 'ohm_per_km')
    const lenCell  = getCell(r, 'measured_length_m')
    const vCell    = getCell(r, 'voltage_v')
    const aCell    = getCell(r, 'design_load_a')
    const vdCell   = getCell(r, 'volt_drop_pct')

    if (sizeCell && cellHasError(sizeCell)) warnings.push('size derived from IF chain — unresolved')
    if (ohmCell  && cellHasError(ohmCell))  warnings.push('Ω/km lookup unresolved (#VALUE! / #N/A)')

    const sizeNum = sizeCell ? cellNumber(sizeCell) : null
    const ohmNum  = ohmCell  ? cellNumber(ohmCell)  : null
    const lenNum  = lenCell  ? cellNumber(lenCell)  : null
    const vNum    = vCell    ? cellNumber(vCell)    : null
    const aNum    = aCell    ? cellNumber(aCell)    : null
    const vdNum   = vdCell   ? cellNumber(vdCell)   : null

    if (!from) errors.push('FROM is empty')
    if (!to)   errors.push('TO is empty')
    if (sizeNum == null) errors.push('Size missing')

    // Parallel column — when present and ≥ 2, this single Excel row
    // represents a run of N parallel cables and we fan it out into N
    // ImportedCable entries with cable_no 1..N. Default 1 (single).
    const parCell = getCell(r, 'parallel_count')
    let parallelCount = parCell ? cellNumber(parCell) : null
    if (parallelCount == null || !Number.isFinite(parallelCount) || parallelCount < 1) {
      parallelCount = 1
    }
    parallelCount = Math.max(1, Math.floor(parallelCount))
    if (parallelCount > 1) parallel_fanouts++

    const groupKey = `${from}||${to}`
    const tagInput = cellText(row.getCell('B')) || null

    for (let strandIdx = 1; strandIdx <= parallelCount; strandIdx++) {
      const nextCableNo = (cableNoByGroup.get(groupKey) ?? 0) + 1
      cableNoByGroup.set(groupKey, nextCableNo)

      // Tag fingerprint: when fanning out, append the strand index so the
      // dup-tag detector doesn't fire on intentional parallels sharing a
      // single Excel-row tag.
      const tagFingerprint = tagInput
        ? (parallelCount > 1 ? `${tagInput}#${strandIdx}` : tagInput)
        : `${from}-${to}-${sizeNum}-${nextCableNo}`
      if (seenTags.has(tagFingerprint)) {
        duplicate_tags++
        warnings.push(`Duplicate tag — also at source row ${seenTags.get(tagFingerprint)}`)
      } else {
        seenTags.set(tagFingerprint, r)
      }

      cables.push({
        source_row: r,
        tag_input: tagInput,
        from_label: from,
        to_label: to,
        voltage_v: vNum,
        load_a: aNum,
        size_mm2: sizeNum,
        ohm_per_km: ohmNum,
        cable_no: nextCableNo,
        fanned_from_parallel: parallelCount > 1 ? strandIdx : undefined,
        measured_length_m: lenNum,
        source_vd_pct: vdNum,
        conductor: conductorContext,
        section: sectionContext,
        warnings,
        errors,
      })
    }
  }

  // Legacy-format detection: no explicit Parallel column AND at least one
  // (FROM, TO) group has multiple cables. The existing group-by-from-to
  // counter already produces correctly-grouped parallels for these — the
  // flag just lets the preview UI tell the user "We detected the old
  // per-cable layout and grouped these into runs automatically".
  const hasParallelColumn = !!columns['parallel_count']
  const groupHadMultiples = Array.from(cableNoByGroup.values()).some((n) => n > 1)
  const legacy_format_detected = !hasParallelColumn && groupHadMultiples

  return {
    schedule_sheet_name: scheduleWs.name,
    schedule_header_row: headerRow,
    detected_columns: columns,
    cables,
    section_breaks,
    conductor_headers,
    placeholders_skipped,
    duplicate_tags,
    parallel_fanouts,
    legacy_format_detected,
    sheet_summary,
  }
}

/**
 * Recompute VD% with the workbook's exact formula and compare against the
 * source workbook's L column. Returns true when the row passes within
 * tolerance — the round-trip fidelity gate per spec §16.13.
 */
export function vdFidelityOk(c: ImportedCable, tolerancePct = 0.001): {
  ok: boolean
  computed: number | null
  source: number | null
  delta: number | null
} {
  if (
    c.ohm_per_km == null ||
    c.measured_length_m == null ||
    c.load_a == null ||
    c.voltage_v == null ||
    c.voltage_v <= 0
  ) {
    return { ok: true, computed: null, source: c.source_vd_pct, delta: null }
  }
  const computed = c.ohm_per_km * (c.measured_length_m / 100) * c.load_a * (10 / c.voltage_v)
  if (c.source_vd_pct == null) return { ok: true, computed, source: null, delta: null }
  const delta = computed - c.source_vd_pct
  return { ok: Math.abs(delta) <= tolerancePct, computed, source: c.source_vd_pct, delta }
}
