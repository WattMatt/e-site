import { describe, it, expect } from 'vitest'
import { filterPortfolio, portfolioKpis, portfolioFilterOptions, STAGE_LABELS, type PortfolioRow } from './portfolio-model'

const row = (o: Partial<PortfolioRow>): PortfolioRow => ({
  projectId: 'p', projectName: 'P', province: 'Gauteng', city: null, licenseeName: 'City Power', stage: 'study',
  selectedCaseName: 'Base', selectedKwp: 100, proposedKwp: null, year1SavingZar: null, lastActivity: '2026-09-01T00:00:00Z', canSeeMoney: false, ...o,
})
const rows = [
  row({ projectId: 'a', stage: 'study', selectedKwp: 100, canSeeMoney: true, year1SavingZar: 50_000 }),
  row({ projectId: 'b', stage: 'proposal_issued', selectedKwp: 200, proposedKwp: 200, province: 'Western Cape', licenseeName: 'City of Cape Town' }),
  row({ projectId: 'c', stage: 'accepted', selectedKwp: 300, proposedKwp: 280, canSeeMoney: true, year1SavingZar: 150_000 }),
]

describe('portfolio model (§15)', () => {
  it('KPIs: kWp designed / proposed / accepted; saving only over rows the caller may see money on', () => {
    expect(portfolioKpis(rows)).toEqual({ projects: 3, kwpDesigned: 600, kwpProposed: 480, kwpAccepted: 280, year1SavingZar: 200_000, savingRows: 2 })
    expect(portfolioKpis(rows.map((r) => ({ ...r, canSeeMoney: false, year1SavingZar: null }))).year1SavingZar).toBeNull()
  })
  it('never sums a saving on a row whose money flag is off, even if a value leaked in', () => {
    const leaked = [row({ canSeeMoney: false, year1SavingZar: 99_999 })]
    expect(portfolioKpis(leaked)).toMatchObject({ year1SavingZar: null, savingRows: 0 })
  })
  it('filters by status, province and supply authority', () => {
    expect(filterPortfolio(rows, { stage: 'accepted', province: '', licensee: '' }).map((r) => r.projectId)).toEqual(['c'])
    expect(filterPortfolio(rows, { stage: '', province: 'Western Cape', licensee: '' }).map((r) => r.projectId)).toEqual(['b'])
    expect(filterPortfolio(rows, { stage: '', province: '', licensee: 'City Power' }).map((r) => r.projectId)).toEqual(['a', 'c'])
  })
  it('offers only the values present', () => {
    expect(portfolioFilterOptions(rows)).toEqual({ provinces: ['Gauteng', 'Western Cape'], licensees: ['City of Cape Town', 'City Power'] })
  })
  it('sorts options case-insensitively and deterministically (never locale-dependent)', () => {
    const r = [row({ licenseeName: 'eThekwini' }), row({ licenseeName: 'Eskom' }), row({ licenseeName: 'City Power' })]
    expect(portfolioFilterOptions(r).licensees).toEqual(['City Power', 'Eskom', 'eThekwini'])
  })
  it('labels every stage (operating arrives with Phase 7)', () => {
    expect(STAGE_LABELS).toEqual({ study: 'Study', proposal_issued: 'Proposal issued', accepted: 'Accepted', operating: 'Operating' })
  })
})
