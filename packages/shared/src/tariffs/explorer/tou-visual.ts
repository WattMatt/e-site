/**
 * Geometry and series for the TOU visuals: a 24-hour clock per season and
 * day type, and the active-energy rate per TOU period. The period at every
 * minute comes from touPeriodAt — the function the bill engine uses — so the
 * picture and the bill cannot disagree.
 */
import { randPerKwh } from '../units'
import { touPeriodAt, type TouCalendar, type WindowDayType } from '../tou'
import type { BillingSeason, Charge, Tariff, TouPeriod } from '../types'

export interface ClockSegment {
  startMinute: number
  endMinute: number
  period: TouPeriod
}

/** The day as runs of one period. Boundaries are the window edges, so no minute is sampled twice. */
export function clockSegments(cal: Pick<TouCalendar, 'windows'>, season: BillingSeason, dayType: WindowDayType): ClockSegment[] {
  const edges = new Set<number>([0, 1440])
  for (const w of cal.windows) {
    if (w.season !== season || w.dayType !== dayType) continue
    edges.add(w.startMinute)
    edges.add(w.endMinute)
  }
  const cuts = [...edges].sort((a, b) => a - b)
  const out: ClockSegment[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const period = touPeriodAt(cal, season, dayType, cuts[i])
    const last = out[out.length - 1]
    if (last && last.period === period && last.endMinute === cuts[i]) last.endMinute = cuts[i + 1]
    else out.push({ startMinute: cuts[i], endMinute: cuts[i + 1], period })
  }
  return out
}

const round = (x: number) => Math.round(x * 1000) / 1000

/** An annular sector from startMinute to endMinute, midnight at 12 o'clock, clockwise. */
export function annularSectorPath(cx: number, cy: number, r0: number, r1: number, startMinute: number, endMinute: number): string {
  const span = Math.min(endMinute - startMinute, 1439.999)
  const a0 = (startMinute / 1440) * 2 * Math.PI
  const a1 = ((startMinute + span) / 1440) * 2 * Math.PI
  const pt = (r: number, a: number) => `${round(cx + r * Math.sin(a))} ${round(cy - r * Math.cos(a))}`
  const large = span > 720 ? 1 : 0
  return `M ${pt(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${pt(r1, a1)} L ${pt(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${pt(r0, a0)} Z`
}

export interface PeriodRate {
  season: BillingSeason
  period: TouPeriod
  cPerKwh: number
}

const SEASONS: readonly BillingSeason[] = ['high', 'low']
const PERIODS: readonly TouPeriod[] = ['peak', 'standard', 'off_peak']

/** Active energy per season x TOU period in c/kWh (first block, weekday or all-days charges). */
export function energyRatesByPeriod(t: Tariff): { rates: PeriodRate[]; note: string | null } {
  const energy = t.charges.filter((c): c is Charge & { tou: TouPeriod } =>
    c.component === 'energy' && c.tou !== 'all' && (c.unit === 'c_per_kWh' || c.unit === 'R_per_kWh') && (c.dayType === 'all' || c.dayType === 'weekday'))
  const hasBlocks = energy.some((c) => c.blockMinKwh !== null && c.blockMinKwh > 0)
  const rates: PeriodRate[] = []
  for (const season of SEASONS) {
    for (const period of PERIODS) {
      const own = energy
        .filter((c) => c.tou === period && (c.season === season || c.season === 'all'))
        .sort((a, b) => Number(b.season === season) - Number(a.season === season) || (a.blockMinKwh ?? 0) - (b.blockMinKwh ?? 0))
      if (own[0]) rates.push({ season, period, cPerKwh: round(randPerKwh(own[0]) * 100) })
    }
  }
  return { rates, note: hasBlocks ? 'Showing the first block of each period; later blocks are in the charges table.' : null }
}
