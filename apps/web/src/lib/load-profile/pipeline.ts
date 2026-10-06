import 'server-only'
/**
 * Import pipeline for the Load profile tab. The browser uploads the raw file straight to Storage
 * ({project}/{sha256}.{ext}, never through a Vercel function — the 4.5 MB body cap); the server
 * downloads it with the CALLER's session (00230 storage policies), checks the bytes hash to the
 * path, and RE-PARSES it with the shared meter-data parsers. The browser's view is never trusted:
 * commit re-parses and re-plans before anything is written.
 */
import { isUsable, parseMeterFile, parseMeterWorkbook, sha256Hex, type MeterParseOutcome, type ParseOptions, type SeriesOutcome } from '@esite/shared/meter-data'
import { importQuality, planImport, toStoredChannel, type ImportPlan, type LoadRole } from '@esite/shared/load-profile'
import { parseLoadProfileFilePath } from './access'

export type Downloader = (path: string) => Promise<Uint8Array | null>

export interface ParsedPart {
  /** null for a CSV; the worksheet name for an .xlsx. */
  sheet: string | null
  plan: ImportPlan
  summary: { periodStart: string | null; periodEnd: string | null; dataRows: number; intervalMin: number | null }
}

export type ParseResult = { ok: true; path: string; fileName: string; parts: ParsedPart[] } | { ok: false; error: string }

async function outcomesOf(bytes: Uint8Array, fileName: string, ext: string, options?: ParseOptions): Promise<Array<{ sheet: string | null; outcome: MeterParseOutcome }>> {
  if (ext === 'xlsx') {
    const sheets = await parseMeterWorkbook({ bytes, fileName, options })
    return sheets.map((s) => ({ sheet: s.sheetName, outcome: s.outcome }))
  }
  return [{ sheet: null, outcome: await parseMeterFile({ bytes, fileName, options }) }]
}

async function loadVerified(download: Downloader, projectId: string, path: string): Promise<{ ok: true; bytes: Uint8Array; ext: string; sha256: string } | { ok: false; error: string }> {
  const parsed = parseLoadProfileFilePath(path, projectId)
  if (!parsed) return { ok: false, error: 'That file does not belong to this project.' }
  const bytes = await download(path)
  if (!bytes) return { ok: false, error: 'The uploaded file could not be read. Upload it again.' }
  if ((await sha256Hex(bytes)) !== parsed.sha256) return { ok: false, error: 'The stored file does not match its upload. Upload it again.' }
  return { ok: true, bytes, ext: parsed.ext, sha256: parsed.sha256 }
}

export async function parseStoredFile(input: { download: Downloader; projectId: string; path: string; fileName: string; options?: ParseOptions }): Promise<ParseResult> {
  const f = await loadVerified(input.download, input.projectId, input.path)
  if (!f.ok) return f
  const outs = await outcomesOf(f.bytes, input.fileName, f.ext, input.options)
  return {
    ok: true,
    path: input.path,
    fileName: input.fileName,
    parts: outs.map(({ sheet, outcome }) => ({
      sheet,
      plan: planImport(outcome),
      summary: {
        periodStart: outcome.report.periodStart,
        periodEnd: outcome.report.periodEnd,
        dataRows: outcome.report.dataRows,
        intervalMin: outcome.report.intervalMin,
      },
    })),
  }
}

export interface ChannelSelection { column: string; label: string; withKva: boolean; role: LoadRole }

/** One row for projects.load_profile_sources (kind 'meter'); parents are bound by trigger. */
export interface MeterSourceRow {
  kind: 'meter'
  label: string
  role: LoadRole
  file_path: string
  file_name: string
  file_sha256: string
  format: string
  source_column: string
  kva_column: string | null
  interval_min: number
  first_ts_end: string
  values: Array<number | null>
  quality: number[]
  kva_values: Array<number | null> | null
  conversion: string
  quality_report: ReturnType<typeof importQuality>
  parser_version: string
}

const finite = (v: number | null) => (v !== null && Number.isFinite(v) ? v : null)

/** Columns of a workbook sheet are keyed `sheet!column` so two sheets never collide on the re-import key. */
export const storedColumn = (sheet: string | null, column: string) => (sheet ? `${sheet}!${column}` : column)

export async function buildMeterRows(input: {
  download: Downloader
  projectId: string
  path: string
  fileName: string
  sheet: string | null
  options?: ParseOptions
  selections: ChannelSelection[]
}): Promise<{ ok: true; rows: MeterSourceRow[]; warnings: string[] } | { ok: false; error: string }> {
  if (input.selections.length === 0) return { ok: false, error: 'Choose at least one channel to import.' }
  const f = await loadVerified(input.download, input.projectId, input.path)
  if (!f.ok) return f
  const part = (await outcomesOf(f.bytes, input.fileName, f.ext, input.options)).find((o) => o.sheet === input.sheet)
  if (!part) return { ok: false, error: `The workbook has no sheet "${input.sheet}".` }
  const plan = planImport(part.outcome)
  if (plan.status !== 'ok') return { ok: false, error: plan.message }
  const series = part.outcome as SeriesOutcome
  const rows: MeterSourceRow[] = []
  const warnings: string[] = []
  for (const sel of input.selections) {
    const cand = plan.candidates.find((c) => c.column === sel.column)
    if (!cand) return { ok: false, error: `The file has no column "${sel.column}".` }
    if (cand.role !== 'kw' || !cand.eligible) return { ok: false, error: `"${sel.column}" cannot be imported as load: ${cand.reason ?? 'not an active-power import channel'}.` }
    const ch = series.channels.find((c) => c.spec.sourceColumn === sel.column)!
    let stored
    try {
      stored = toStoredChannel(ch.readings, ch.intervalMin)
    } catch {
      return { ok: false, error: `"${sel.column}" has irregular timestamps and cannot be stored as a fixed-interval profile.` }
    }
    let kvaValues: Array<number | null> | null = null
    let kvaColumn: string | null = null
    if (sel.withKva && cand.kvaColumn) {
      const kch = series.channels.find((c) => c.spec.sourceColumn === cand.kvaColumn)
      if (kch && kch.intervalMin === ch.intervalMin) {
        const byTs = new Map(kch.readings.filter(isUsable).map((r) => [r.tsEnd, r.value]))
        const step = stored.intervalMin * 60_000
        kvaValues = stored.values.map((_, i) => finite(byTs.get(stored.firstTsEnd + i * step) ?? null))
        kvaColumn = storedColumn(input.sheet, cand.kvaColumn)
      } else warnings.push(`"${cand.kvaColumn}" is not on the same ${ch.intervalMin}-minute grid as "${sel.column}", so maximum demand uses kW ÷ power factor instead.`)
    }
    const label = sel.label.trim().slice(0, 200) || storedColumn(input.sheet, sel.column)
    rows.push({
      kind: 'meter',
      label,
      role: sel.role,
      file_path: input.path,
      file_name: input.fileName,
      file_sha256: f.sha256,
      format: series.format,
      source_column: storedColumn(input.sheet, sel.column),
      kva_column: kvaColumn,
      interval_min: stored.intervalMin,
      first_ts_end: new Date(stored.firstTsEnd).toISOString(),
      values: stored.values.map(finite),
      quality: [...stored.quality],
      kva_values: kvaValues,
      conversion: cand.conversion,
      quality_report: importQuality(stored, series.report),
      parser_version: series.report.parserVersion,
    })
  }
  return { ok: true, rows, warnings }
}
