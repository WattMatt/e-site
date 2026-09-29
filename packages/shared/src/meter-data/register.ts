/**
 * Meter registers (as-is/10 §4, §6.5). A consolidation summary maps meter file → layout name →
 * shop → area with the match method as confidence; LLM and UNMAPPED rows are never auto-applied
 * (3a-ii / 3b). A downloader log maps serial → tenant ; DB ; mall and is never load data.
 */
import type { ReportIssue } from './types'
import { splitLines, splitRow } from './text'

export type MatchMethod = 'exact' | 'llm' | 'unmapped' | 'none'

export interface RegisterRow {
  kind: 'summary' | 'download_log'
  fileName: string | null
  tenantName: string | null
  shopNo: string | null
  areaM2: number | null
  matchMethod: MatchMethod
  serial: string | null
  mallName: string | null
  downloaded: boolean | null
  qa: Record<string, string>
}

const SUFFIXES = ['MALL', 'SQUARE', 'CENTRE', 'CENTER', 'PLAZA', 'SHOPPING']

/** Canonical key for comparing site / mall names across filenames, registers and folders. */
export function siteKey(s: string): string {
  const words = s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  while (words.length > 1 && SUFFIXES.includes(words[words.length - 1])) words.pop()
  return words.join('')
}

export function mapMatchMethod(status: string | null | undefined): MatchMethod {
  const s = (status ?? '').trim()
  if (s === '') return 'none'
  if (/^direct|substring/i.test(s)) return 'exact'
  if (/gemini|llm/i.test(s)) return 'llm'
  if (/^unmapped$/i.test(s)) return 'unmapped'
  return 'none'
}

type Cell = string | number | null | undefined
const str = (v: Cell): string | null => {
  if (v === null || v === undefined) return null
  const t = String(v).trim()
  return t === '' ? null : t
}
const num = (v: Cell): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = str(v)
  return t !== null && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null
}

export function parseSummaryMatrix(matrix: Cell[][]): { rows: RegisterRow[]; warnings: ReportIssue[] } {
  const headerIdx = matrix.findIndex((r) => r.some((c) => str(c)?.toLowerCase() === 'area (sqm)'))
  if (headerIdx < 0) return { rows: [], warnings: [{ code: 'register_file', message: 'No "Area (sqm)" header found.' }] }
  const header = matrix[headerIdx].map((c) => str(c)?.toLowerCase() ?? '')
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h))
  const c = {
    file: col('meter filename'), layout: col('matched layout name'), shopName: col('shop name'),
    shopNo: col('shop number'), area: col('area (sqm)'), status: col('status'),
    dubbel: col('dubbel'), correct: col('correct'), added: col('added'), notOn: col('not on drawings'),
  }
  const at = (r: Cell[], i: number) => (i >= 0 ? r[i] : null)
  const rows: RegisterRow[] = []
  for (const r of matrix.slice(headerIdx + 1)) {
    if (r.every((v) => str(v) === null)) continue
    const qa: Record<string, string> = {}
    const put = (k: string, i: number) => {
      const v = str(at(r, i))
      if (v !== null) qa[k] = v
    }
    put('onDrawing', c.dubbel)
    put('csvOnSite', c.correct)
    put('added', c.added)
    put('notOnDrawings', c.notOn)
    rows.push({
      kind: 'summary',
      fileName: str(at(r, c.file)),
      tenantName: str(at(r, c.layout)) ?? str(at(r, c.shopName)),
      shopNo: str(at(r, c.shopNo)),
      areaM2: num(at(r, c.area)),
      matchMethod: c.status >= 0 ? mapMatchMethod(str(at(r, c.status))) : 'none',
      serial: null, mallName: null, downloaded: null, qa,
    })
  }
  return { rows, warnings: [] }
}

export function parseRegisterCsv(text: string): { rows: RegisterRow[]; warnings: ReportIssue[] } {
  return parseSummaryMatrix(splitLines(text).map((l) => splitRow(l, ',')))
}

export function parseDownloadLog(text: string): RegisterRow[] {
  return splitLines(text)
    .slice(1)
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const [serial, name, downloaded] = splitRow(l, ',')
      const parts = (name ?? '').split(/\s*;\s*/).filter((p) => p !== '')
      return {
        kind: 'download_log' as const,
        fileName: null,
        tenantName: parts[0] ?? null,
        shopNo: null,
        areaM2: null,
        matchMethod: 'none' as const,
        serial: str(serial),
        mallName: parts.length >= 2 ? parts[parts.length - 1] : null,
        downloaded: /^true$/i.test(downloaded ?? '') ? true : /^false$/i.test(downloaded ?? '') ? false : null,
        qa: {},
      }
    })
}
