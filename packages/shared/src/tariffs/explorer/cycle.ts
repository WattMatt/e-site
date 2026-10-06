/**
 * The annual tariff cycle at a glance (E7 admin dashboard). Eskom's year
 * starts 1 April, municipal years 1 July (financial-year.ts). For the
 * financial year in force today, each regime's licensees are counted by the
 * state of that year — a licensee with no row for it is "missing".
 */
import type { TariffRegime } from '../financial-year'

export function regimeFinancialYearOn(regime: TariffRegime, isoDate: string): string {
  const [y, m] = isoDate.slice(0, 10).split('-').map(Number)
  const start = regime === 'eskom' ? 4 : 7
  const s = m >= start ? y : y - 1
  return `${s}/${String((s + 1) % 100).padStart(2, '0')}`
}

export function nextDueDate(regime: TariffRegime, isoDate: string): string {
  const start = regimeFinancialYearOn(regime, isoDate).slice(0, 4)
  return `${Number(start) + 1}-${regime === 'eskom' ? '04' : '07'}-01`
}

export interface CycleYear {
  id: string
  licenseeId: string
  financialYear: string
  state: string
  validationBlocking: number | null
  validatedAt: string | null
  publishedAt: string | null
}

export interface CycleRow { yearId: string; licenseeId: string; licensee: string; financialYear: string; blocking: number | null }

export interface RegimeCycle {
  targetFy: string
  nextDue: string
  counts: { published: number; in_review: number; ingesting: number; missing: number }
  readyToPublish: CycleRow[]
  blocked: CycleRow[]
  notChecked: CycleRow[]
  missing: Array<{ licenseeId: string; licensee: string }>
}

export function summariseCycle(
  licensees: ReadonlyArray<{ id: string; name: string; kind: string }>,
  years: readonly CycleYear[],
  todayIso: string,
): { eskom: RegimeCycle; municipal: RegimeCycle; publishHistory: Array<CycleRow & { publishedAt: string }> } {
  const name = new Map(licensees.map((l) => [l.id, l.name]))
  const regimeOf = (kind: string): TariffRegime => (kind === 'eskom' ? 'eskom' : 'municipal')
  const build = (regime: TariffRegime): RegimeCycle => {
    const targetFy = regimeFinancialYearOn(regime, todayIso)
    const mine = licensees.filter((l) => regimeOf(l.kind) === regime)
    const ids = new Set(mine.map((l) => l.id))
    const current = years.filter((y) => ids.has(y.licenseeId) && y.financialYear === targetFy)
    const row = (y: CycleYear): CycleRow => ({ yearId: y.id, licenseeId: y.licenseeId, licensee: name.get(y.licenseeId) ?? 'Unknown', financialYear: y.financialYear, blocking: y.validationBlocking })
    const byName = (a: { licensee: string }, b: { licensee: string }) => a.licensee.localeCompare(b.licensee)
    const have = new Set(current.map((y) => y.licenseeId))
    const review = current.filter((y) => y.state === 'in_review')
    return {
      targetFy,
      nextDue: nextDueDate(regime, todayIso),
      counts: {
        published: current.filter((y) => y.state === 'published' || y.state === 'superseded').length,
        in_review: review.length,
        ingesting: current.filter((y) => y.state === 'ingesting').length,
        missing: mine.filter((l) => !have.has(l.id)).length,
      },
      readyToPublish: review.filter((y) => y.validatedAt !== null && y.validationBlocking === 0).map(row).sort(byName),
      blocked: review.filter((y) => (y.validationBlocking ?? 0) > 0).map(row).sort((a, b) => (b.blocking ?? 0) - (a.blocking ?? 0) || byName(a, b)),
      notChecked: review.filter((y) => y.validatedAt === null).map(row).sort(byName),
      missing: mine.filter((l) => !have.has(l.id)).map((l) => ({ licenseeId: l.id, licensee: l.name })).sort(byName),
    }
  }
  const publishHistory = years
    .filter((y): y is CycleYear & { publishedAt: string } => y.publishedAt !== null)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .map((y) => ({ yearId: y.id, licenseeId: y.licenseeId, licensee: name.get(y.licenseeId) ?? 'Unknown', financialYear: y.financialYear, blocking: y.validationBlocking, publishedAt: y.publishedAt }))
  return { eskom: build('eskom'), municipal: build('municipal'), publishHistory }
}
