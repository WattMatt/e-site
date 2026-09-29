/** Solar portfolio (spec §15) — pure model shared by the page and the client table. */
export type PortfolioStage = 'study' | 'proposal_issued' | 'accepted' | 'operating'
export const STAGE_LABELS: Record<PortfolioStage, string> = { study: 'Study', proposal_issued: 'Proposal issued', accepted: 'Accepted', operating: 'Operating' }

export interface PortfolioRow {
  projectId: string; projectName: string; province: string | null; city: string | null; licenseeName: string | null
  stage: PortfolioStage; selectedCaseName: string | null; selectedKwp: number | null; proposedKwp: number | null
  year1SavingZar: number | null; lastActivity: string | null; canSeeMoney: boolean
}
export interface PortfolioFilter { stage: string; province: string; licensee: string }

export function filterPortfolio(rows: PortfolioRow[], f: PortfolioFilter): PortfolioRow[] {
  return rows.filter((r) =>
    (!f.stage || r.stage === f.stage) && (!f.province || r.province === f.province) && (!f.licensee || r.licenseeName === f.licensee))
}

export function portfolioFilterOptions(rows: PortfolioRow[]): { provinces: string[]; licensees: string[] } {
  // Case-insensitive code-unit order: the same on the server and in every browser (localeCompare is ICU-dependent).
  const key = (s: string) => s.toLowerCase()
  const byKey = (a: string, b: string) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a < b ? -1 : a > b ? 1 : 0)
  const uniq = (xs: Array<string | null>) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort(byKey)
  return { provinces: uniq(rows.map((r) => r.province)), licensees: uniq(rows.map((r) => r.licenseeName)) }
}

export function portfolioKpis(rows: PortfolioRow[]) {
  const sum = (xs: Array<number | null>) => xs.reduce<number>((a, x) => a + (x ?? 0), 0)
  const money = rows.filter((r) => r.canSeeMoney && r.year1SavingZar !== null)
  return {
    projects: rows.length,
    kwpDesigned: sum(rows.map((r) => r.selectedKwp)),
    kwpProposed: sum(rows.filter((r) => r.stage === 'proposal_issued' || r.stage === 'accepted').map((r) => r.proposedKwp)),
    kwpAccepted: sum(rows.filter((r) => r.stage === 'accepted').map((r) => r.proposedKwp)),
    year1SavingZar: money.length ? sum(money.map((r) => r.year1SavingZar)) : null,
    savingRows: money.length,
  }
}
