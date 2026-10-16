/**
 * TOU calendar rows <-> the engine's TouCalendar (2a tou.ts), the fallback
 * rule (a licensee without its own calendar uses Eskom's hours, flagged
 * assumed_eskom: municipal books state seasons, never hours), window
 * validation for the admin editor, and the half-hour grid the diagram draws
 * (2a's touPeriodAt, so the diagram and the engine read the same windows).
 */
import { touPeriodAt, type TouCalendar, type TouWindow, type WindowDayType } from '../../tariffs/tou'
import type { BillingSeason, TouPeriod } from '../../tariffs/types'

export interface TouCalendarRow {
  id: string
  licenseeId: string
  validFrom: string
  validTo: string | null
  highSeasonMonths: number[]
  source: 'published' | 'assumed_eskom'
  holidayTreatedAs: 'saturday' | 'sunday' | null
}

export function calendarFromRows(cal: TouCalendarRow, windows: readonly TouWindow[]): TouCalendar {
  return {
    highSeasonMonths: [...cal.highSeasonMonths],
    holidayTreatedAs: cal.holidayTreatedAs,
    source: cal.source,
    windows: windows.map((w) => ({ season: w.season, dayType: w.dayType, startMinute: w.startMinute, endMinute: w.endMinute, period: w.period })),
  }
}

/** The calendar valid on a date: validFrom <= on < validTo; the latest start wins. */
export function pickCalendar<T extends Pick<TouCalendarRow, 'validFrom' | 'validTo'>>(rows: readonly T[], onIso: string): T | null {
  const on = onIso.slice(0, 10)
  const valid = rows.filter((r) => r.validFrom <= on && (r.validTo === null || on < r.validTo))
  return valid.sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null
}

/** The TOU hours notice (functional spec §5): the Tariff tab and a case run's provenance say it the same way. */
export const ASSUMED_ESKOM_HOURS = "TOU hours assumed equal to Eskom's — confirm against the municipality's by-law"

/** One line for a run's TOU provenance (solar-cases TouHoursRef); null for a run made before it was recorded. */
export function touHoursLabel(
  t: { source: 'published' | 'assumed_eskom'; calendarLicenseeName: string; validFrom: string; datedHolidays: number } | undefined,
): string | null {
  if (!t) return null
  const whose = `${t.calendarLicenseeName} from ${t.validFrom}`
  const base = t.source === 'assumed_eskom' ? `${ASSUMED_ESKOM_HOURS} (${whose})` : `TOU hours ${whose}`
  if (t.datedHolidays === 0) return base
  return `${base}; ${t.datedHolidays} public ${t.datedHolidays === 1 ? 'holiday' : 'holidays'} billed per the tariff’s dated schedule`
}
export function resolveStudyCalendar(
  own: TouCalendar | null, eskom: TouCalendar | null,
): { calendar: TouCalendar | null; assumedEskom: boolean; fromEskomFallback: boolean } {
  if (own) return { calendar: own, assumedEskom: own.source === 'assumed_eskom', fromEskomFallback: false }
  if (eskom) return { calendar: { ...eskom, source: 'assumed_eskom' }, assumedEskom: true, fromEskomFallback: true }
  return { calendar: null, assumedEskom: false, fromEskomFallback: false }
}

export function minutesLabel(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function parseTimeLabel(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null
  return h * 60 + min
}

const SEASON_WORD: Record<BillingSeason, string> = { high: 'High season', low: 'Low season' }
const DAY_TYPES: readonly WindowDayType[] = ['weekday', 'saturday', 'sunday']
const SEASONS: readonly BillingSeason[] = ['high', 'low']

export interface WindowIssue {
  season: BillingSeason
  dayType: WindowDayType
  message: string
}

/** Overlaps are errors (a minute in two periods). Gaps are legal: uncovered minutes bill as off-peak. */
export function validateTouWindows(windows: readonly TouWindow[]): WindowIssue[] {
  const issues: WindowIssue[] = []
  for (const season of SEASONS) {
    for (const dayType of DAY_TYPES) {
      const ws = windows.filter((w) => w.season === season && w.dayType === dayType).sort((a, b) => a.startMinute - b.startMinute)
      for (let i = 1; i < ws.length; i++) {
        if (ws[i].startMinute < ws[i - 1].endMinute) {
          issues.push({
            season, dayType,
            message: `${SEASON_WORD[season]} ${dayType}: ${minutesLabel(ws[i - 1].startMinute)}-${minutesLabel(ws[i - 1].endMinute)} overlaps ${minutesLabel(ws[i].startMinute)}-${minutesLabel(ws[i].endMinute)}`,
          })
        }
      }
    }
  }
  return issues
}

export interface GridRow {
  season: BillingSeason
  dayType: WindowDayType
  /** 48 half-hour slots from 00:00. */
  slots: TouPeriod[]
}

export function windowGrid(cal: Pick<TouCalendar, 'windows'>): GridRow[] {
  return SEASONS.flatMap((season) => DAY_TYPES.map((dayType) => ({
    season, dayType,
    slots: Array.from({ length: 48 }, (_, k) => touPeriodAt(cal, season, dayType, k * 30)),
  })))
}
