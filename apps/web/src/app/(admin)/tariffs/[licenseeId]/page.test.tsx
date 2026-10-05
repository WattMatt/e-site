import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ lw: vi.fn(), list: vi.fn(), notFound: vi.fn(() => { throw new Error('NOT_FOUND') }) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/tariffs/explorer-data', () => ({ loadLicenseeWithYears: h.lw, loadYearTariffList: h.list }))
vi.mock('next/navigation', () => ({ notFound: h.notFound }))
vi.mock('next/link', () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }))

import LicenseeTariffsPage from './page'

const LID = '2255aace-9932-46ac-a5de-5e08b2c74170'
const year = (fy: string, id: string, state = 'published') => ({ id, licenseeId: LID, financialYear: fy, state, effectiveFrom: '2099-07-01', effectiveTo: '2100-06-30', approvedIncreasePct: 9.5, publishedAt: null })
const row = (id: string, name: string, category: string, p: Record<string, unknown> = {}) => ({
  id, name, code: null, family: null, category, structure: 'flat', metering: 'conventional', isLegacy: false,
  headline: { energy: { min: 100, max: 100 }, fixed: [], capacityOrDemand: false }, ...p,
})
const run = (sp: Record<string, string> = {}) => LicenseeTariffsPage({ params: Promise.resolve({ licenseeId: LID }), searchParams: Promise.resolve(sp) })

beforeEach(() => {
  vi.clearAllMocks()
  h.lw.mockResolvedValue({ licensee: { id: LID, name: 'CITY OF SAMPLE', kind: 'metro', province: 'GP', nersaLicenceNo: null, mdbCode: null }, years: [year('2099/00', 'y2'), year('2098/99', 'y1', 'superseded')] })
  h.list.mockResolvedValue([
    row('t1', 'Home Lite', 'domestic', { structure: 'ibt', headline: { energy: { min: 150.5, max: 310.25 }, fixed: [{ component: 'basic', label: 'Basic charge', text: 'R12.34/day' }], capacityOrDemand: false } }),
    row('t2', 'Big Works (BW1)', 'industrial', { code: 'BW1', structure: 'tou', family: 'Works', headline: { energy: { min: 50, max: 400 }, fixed: [], capacityOrDemand: true } }),
    row('t3', 'Big Works Legacy', 'industrial', { family: 'Works', isLegacy: true }),
  ])
})

describe('supply authority page', () => {
  it('leads with the year at a glance, in readable dates', async () => {
    render(await run())
    expect(screen.getAllByText('City of Sample').length).toBe(2) // breadcrumb and heading
    const glance = screen.getByRole('group', { name: 'Year at a glance' })
    expect(within(glance).getByText('1 Jul 2099')).toBeDefined()
    expect(within(glance).getByText('9.5 %')).toBeDefined()
    expect(within(glance).getByText('3')).toBeDefined()
  })
  it('shows each tariff with its type and headline rates, without repeating a code the name carries', async () => {
    render(await run())
    const dom = screen.getByRole('region', { name: 'Domestic' })
    expect(within(dom).getByText('150.50–310.25 c/kWh')).toBeDefined()
    expect(within(dom).getByText('Basic charge R12.34/day')).toBeDefined()
    expect(within(dom).getByText('Inclining blocks')).toBeDefined()
    const works = screen.getByRole('region', { name: 'Works' })
    expect(within(works).getByText('Capacity/demand charges')).toBeDefined()
    expect(within(works).getByText('Legacy')).toBeDefined()
    expect(within(works).queryByText(/· BW1/)).toBeNull()
  })
  it('filters by category through the URL, keeping the year', async () => {
    render(await run({ fy: '2098/99', cat: 'industrial' }))
    const nav = screen.getByRole('navigation', { name: 'Category' })
    expect(within(nav).getByRole('link', { name: 'Domestic · 1' }).getAttribute('href')).toBe(`/tariffs/${LID}?fy=2098%2F99&cat=domestic`)
    expect(within(nav).getByRole('link', { name: 'Industrial · 2' }).getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('region', { name: 'Domestic' })).toBeNull()
    expect(h.list).toHaveBeenCalledWith(expect.anything(), 'y1')
  })
  it('an unknown category shows everything rather than nothing', async () => {
    render(await run({ cat: 'nonsense' }))
    expect(screen.getByRole('region', { name: 'Domestic' })).toBeDefined()
    expect(within(screen.getByRole('navigation', { name: 'Category' })).getByRole('link', { name: 'All · 3' }).getAttribute('aria-current')).toBe('page')
  })
  it('without headline figures the tariffs still list, and say why the rates are missing', async () => {
    h.list.mockResolvedValue([row('t1', 'Home Lite', 'domestic', { headline: null })])
    render(await run())
    expect(screen.getByRole('link', { name: /Home Lite/ })).toBeDefined()
    expect(screen.getByText(/Headline rates could not be loaded/)).toBeDefined()
  })
  it('a long list of fixed charges is cut to three with a count', async () => {
    const fixed = ['basic', 'service', 'admin', 'gcc', 'ancillary'].map((c) => ({ component: c, label: c, text: 'R1.00/day' }))
    h.list.mockResolvedValue([row('t1', 'Home Lite', 'domestic', { headline: { energy: null, fixed, capacityOrDemand: false } })])
    render(await run())
    expect(screen.getByText('+2 more fixed charges')).toBeDefined()
    expect(screen.queryByText('ancillary R1.00/day')).toBeNull()
  })
  it('a licensee with no published year says so', async () => {
    h.lw.mockResolvedValue({ licensee: { id: LID, name: 'OTHERTOWN', kind: 'municipal', province: 'WC', nersaLicenceNo: null, mdbCode: null }, years: [] })
    render(await run())
    expect(screen.getByText(/No tariff year is published for Othertown yet/)).toBeDefined()
  })
})
