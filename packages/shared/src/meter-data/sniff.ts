import type { MeterFormatId } from './types'
import { splitLines, splitRow } from './text'

export interface SniffResult {
  format: MeterFormatId
  delimiter: string | null
  /** 0-based line index of the header row. */
  headerLineIndex: number | null
  dataStartIndex: number | null
  /** PnP line-1 serials (B/C). */
  serials: string[]
  reason: 'empty_file' | 'header_only' | 'escaped_copy' | 'no_header' | null
}

/** A cell that looks like a date with an optional time; used by the generic path only. */
export const GENERIC_TS_RE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/

const none = (format: MeterFormatId, reason: SniffResult['reason']): SniffResult => ({
  format, delimiter: null, headerLineIndex: null, dataStartIndex: null, serials: [], reason,
})

function hasDataAfter(lines: string[], headerIdx: number): boolean {
  return lines.slice(headerIdx + 1).some((l) => l.trim() !== '')
}

/** Fixed order; the first match wins (as-is/10 §6.1 step 3). */
export function sniffMeterText(text: string): SniffResult {
  const lines = splitLines(text)
  const nonBlank = lines.filter((l) => l.trim() !== '')
  if (nonBlank.length === 0) return none('empty', 'empty_file')
  const first = lines[0].replace(/^﻿/, '')

  if (/^Serial,Name,Downloaded,Timestamp\s*$/i.test(first)) {
    return { format: 'E', delimiter: ',', headerLineIndex: 0, dataStartIndex: 1, serials: [], reason: null }
  }
  // D before G: a D file starts with the summary header followed by a LITERAL "\n".
  if (nonBlank.length === 1 && first.includes('\\n') && /(^|\\n)date,/i.test(first)) {
    return { format: 'D', delimiter: ',', headerLineIndex: null, dataStartIndex: null, serials: [], reason: 'escaped_copy' }
  }
  if (/^(Shop Name|Matched Layout Name),Shop Number,Area \(sqm\)/i.test(first) || /^Meter Filename,Matched Layout Name/i.test(first)) {
    return { format: 'G', delimiter: ',', headerLineIndex: 0, dataStartIndex: 1, serials: [], reason: null }
  }
  if (/^kwh\+,/i.test(first)) return { format: 'F', delimiter: ',', headerLineIndex: 0, dataStartIndex: 1, serials: [], reason: null }

  const sep = first.match(/^sep=(.)\s*$/i)
  if (sep) {
    const d = sep[1]
    const h = lines.findIndex((l, i) => i > 0 && l.toLowerCase().startsWith(`date${d}`))
    if (h < 0) return none('empty', 'empty_file')
    if (!hasDataAfter(lines, h)) return none('empty', 'header_only')
    return { format: 'A', delimiter: d, headerLineIndex: h, dataStartIndex: h + 1, serials: [], reason: null }
  }

  if (/^"?pnpscada\.com"?\s*,/i.test(first)) {
    const serials = splitRow(first, ',').slice(1).filter((s) => s !== '')
    const header = lines[1] ?? ''
    const cells = splitRow(header, ',').map((c) => c.toUpperCase())
    const isB = cells.includes('DATE') && cells.includes('TIME') && cells.includes('STATUS')
    const isC = /^time,/i.test(header)
    if (!isB && !isC) return { ...none('generic', 'no_header'), serials }
    if (!hasDataAfter(lines, 1)) return { ...none('empty', 'header_only'), serials }
    return { format: isB ? 'B' : 'C', delimiter: ',', headerLineIndex: 1, dataStartIndex: 2, serials, reason: null }
  }

  return sniffGeneric(lines)
}

function modeOf(xs: number[]): number {
  const counts = new Map<number, number>()
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1)
  let best = 0
  let bestN = -1
  for (const [x, n] of counts) if (n > bestN || (n === bestN && x > best)) [best, bestN] = [x, n]
  return best
}

function sniffGeneric(lines: string[]): SniffResult {
  const sample = lines.slice(0, 60).filter((l) => l.trim() !== '')
  let best: { d: string; cols: number; tsShare: number } | null = null
  for (const d of [',', ';', '\t', '|']) {
    const split = sample.map((l) => splitRow(l, d))
    const counts = split.map((c) => c.length)
    const mode = modeOf(counts)
    const share = counts.filter((c) => c === mode).length / counts.length
    const tsShare = split.filter((c) => c.some((x) => GENERIC_TS_RE.test(x))).length / split.length
    if (mode < 2 || share < 0.8 || tsShare === 0) continue
    if (!best || tsShare > best.tsShare || (tsShare === best.tsShare && mode > best.cols)) best = { d, cols: mode, tsShare }
  }
  if (!best) return none('generic', 'no_header')
  const d = best.d
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const cells = splitRow(lines[i], d)
    if (cells.length < 2 || cells.some((c) => GENERIC_TS_RE.test(c))) continue
    const next = lines.slice(i + 1).filter((l) => l.trim() !== '').slice(0, 20)
    if (next.length === 0) continue
    if (next.every((l) => splitRow(l, d).some((c) => GENERIC_TS_RE.test(c)))) {
      return { format: 'generic', delimiter: d, headerLineIndex: i, dataStartIndex: i + 1, serials: [], reason: null }
    }
  }
  return { ...none('generic', 'no_header'), delimiter: d }
}
