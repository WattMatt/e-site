/**
 * Time handling. SAST = UTC+2, no DST, fixed (engine spec §1.2). All arithmetic goes through
 * Date.UTC / getUTC*; local-time Date getters are never used.
 */
import type { DateOrder } from './types'

export const SAST_OFFSET_MS = 2 * 3_600_000

export interface ParsedLabel {
  utcMs: number
  was2400: boolean
}

/** Returns epoch ms UTC for a SAST wall-clock time, or null if it is not a real time. Accepts 24:00:00. */
export function sastLocalToUtcMs(y: number, mo: number, d: number, h: number, mi: number, s = 0): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 24 || mi < 0 || mi > 59 || s < 0 || s > 59) return null
  if (h === 24 && (mi !== 0 || s !== 0)) return null
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null
  return Date.UTC(y, mo - 1, d, h, mi, s) - SAST_OFFSET_MS
}

export function utcMsToSast(ms: number): { year: number; month: number; day: number; hour: number; minute: number; isoDate: string } {
  const d = new Date(ms + SAST_OFFSET_MS)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return { year, month, day, hour: d.getUTCHours(), minute: d.getUTCMinutes(), isoDate: `${year}-${pad(month)}-${pad(day)}` }
}

function label(y: number, mo: number, d: number, h: number, mi: number, s: number): ParsedLabel | null {
  const utcMs = sastLocalToUtcMs(y, mo, d, h, mi, s)
  return utcMs === null ? null : { utcMs, was2400: h === 24 }
}

/** Format A: DD/MM/YYYY HH:MM[:SS] (as-is/10 §2.1). */
export function parseLabelA(cell: string): ParsedLabel | null {
  const m = cell.trim().match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/)
  return m ? label(+m[3], +m[2], +m[1], +m[4], +m[5], +(m[6] ?? 0)) : null
}

/** Format B: DATE YYYY-MM-DD and TIME HH:MM[:SS] in separate columns. */
export function parseLabelB(dateCell: string, timeCell: string): ParsedLabel | null {
  const d = dateCell.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const t = timeCell.trim().match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/)
  return d && t ? label(+d[1], +d[2], +d[3], +t[1], +t[2], +(t[3] ?? 0)) : null
}

/** Format C: YYYY-MM-DD HH:MM[:SS]. */
export function parseLabelC(cell: string): ParsedLabel | null {
  const m = cell.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  return m ? label(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0)) : null
}

const GENERIC = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/

export function parseLabelGeneric(cell: string, order: DateOrder): ParsedLabel | null {
  const m = cell.trim().match(GENERIC)
  if (!m) return null
  const [a, b, c] = [m[1], +m[2], m[3]]
  const [h, mi, s] = [+(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)]
  if (a.length === 4) return label(+a, b, +c, h, mi, s)
  if (c.length !== 4) return null
  return order === 'MDY' ? label(+c, +a, b, h, mi, s) : label(+c, b, +a, h, mi, s)
}

/** File-level date order (engine spec §2.1 step 1): decided once for the whole file, never per row. */
export function detectDateOrder(cells: string[]): { order: DateOrder | null; ambiguous: boolean } {
  let dmy = false
  let mdy = false
  let ymd = 0
  let other = 0
  for (const cell of cells) {
    const m = cell.trim().match(GENERIC)
    if (!m) continue
    if (m[1].length === 4) { ymd++; continue }
    other++
    if (+m[1] > 12) dmy = true
    if (+m[2] > 12) mdy = true
  }
  if (ymd > 0 && other === 0) return { order: 'YMD', ambiguous: false }
  if (dmy && !mdy) return { order: 'DMY', ambiguous: false }
  if (mdy && !dmy) return { order: 'MDY', ambiguous: false }
  return { order: null, ambiguous: true }
}
