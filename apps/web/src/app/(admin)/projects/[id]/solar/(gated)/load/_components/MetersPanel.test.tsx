import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/actions/solar-load.actions', () => ({
  ensureSolarStudyAction: vi.fn(), searchLibraryMetersAction: vi.fn(), linkLibraryMetersAction: vi.fn(),
  confirmRegisterRowAction: vi.fn(), updateStudyMeterAction: vi.fn(), removeStudyMeterAction: vi.fn(),
}))
vi.mock('./MeterComparison', () => ({ MeterComparison: ({ meters }: { meters: Array<{ id: string }> }) => <div data-testid="comparison">{meters.map((m) => m.id).join(',')}</div> }))
import { MetersPanel } from './MetersPanel'
import type { MeterView, MetersView } from '@/lib/solar/load/view-types'

const view: MetersView = { studyId: 's1', orgId: 'o1', meters: [], nodes: [], register: [], cloudMapped: false, isGrantor: false, bulkRecon: [] }

describe('MetersPanel', () => {
  it('empty state names the actions that fill it; Dropbox hidden without a mapping', () => {
    render(<MetersPanel projectId="p1" view={view} canEdit openMeterId={null} />)
    expect(screen.getByText(/Upload meter exports or synthesise load from the tenant schedule/)).toBeTruthy()
    expect(screen.getByLabelText('Upload meter files')).toBeTruthy()
    expect(screen.getByLabelText('Import meter register')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Import from Dropbox folder' })).toBeNull()
  })
  it('View users get the table only', () => {
    render(<MetersPanel projectId="p1" view={{ ...view, cloudMapped: true }} canEdit={false} openMeterId={null} />)
    expect(screen.queryByLabelText('Upload meter files')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy from org meter library' })).toBeNull()
  })
  it('lists meters with units on every number', () => {
    render(<MetersPanel projectId="p1" canEdit openMeterId={null} view={{ ...view, meters: [{
      id: 'm1', label: 'Pep', kind: 'tenant', siteLabel: 'YA', serials: [], nodeId: 'n1', tenantLabel: '12 · Pep', shopNo: '12', areaM2: null,
      supplyPointConfirmed: false, updatedAt: 'M0', primaryChannelId: 'c1', intervalMin: 30, periodStart: '2025-01-01T00:00:00Z', periodEnd: '2025-12-31T23:30:00Z',
      completeness: 0.985, peakKw: 12.34, annualKwh: 87600, fileIds: ['f1'], otherStudyLinks: 0, status: 'imported' }] }} />)
    expect(screen.getByText('12.3 kW')).toBeTruthy()
    expect(screen.getByText('87 600 kWh')).toBeTruthy()
    expect(screen.getByText('98.5 %')).toBeTruthy()
    expect(screen.getByText('30 min')).toBeTruthy()
  })

  describe('meter comparison (select 2–4, overlay)', () => {
    const m = (i: number): MeterView => ({
      id: `m${i}`, label: `Meter ${i}`, kind: 'tenant', siteLabel: null, serials: [], nodeId: null, tenantLabel: null, shopNo: null, areaM2: null,
      supplyPointConfirmed: false, updatedAt: 'M0', primaryChannelId: `c${i}`, intervalMin: 30, periodStart: null, periodEnd: null,
      completeness: 1, peakKw: 1, annualKwh: 1, fileIds: [], otherStudyLinks: 0, status: 'imported',
    })
    const five = { ...view, meters: [1, 2, 3, 4, 5].map(m) }
    const box = (i: number) => screen.getByLabelText(`Compare Meter ${i}`) as HTMLInputElement
    const compare = () => screen.getByRole('button', { name: /^Compare/ }) as HTMLButtonElement

    it('Compare is disabled with a reason at 0 and 1 selected, enabled at 2–4', async () => {
      render(<MetersPanel projectId="p1" canEdit={false} openMeterId={null} view={five} />)
      expect(compare().disabled).toBe(true)
      expect(screen.getByText(/Select 2 to 4 meters to compare/)).toBeTruthy()
      await userEvent.click(box(1))
      expect(compare().disabled).toBe(true)
      await userEvent.click(box(2))
      expect(compare().disabled).toBe(false)
      await userEvent.click(box(3))
      await userEvent.click(box(4))
      expect(compare().disabled).toBe(false)
    })
    it('a 5th meter is refused with a visible reason', async () => {
      render(<MetersPanel projectId="p1" canEdit={false} openMeterId={null} view={five} />)
      for (const i of [1, 2, 3, 4]) await userEvent.click(box(i))
      await userEvent.click(box(5))
      expect(box(5).checked).toBe(false)
      expect(box(4).checked).toBe(true)
      expect(screen.getByText(/at most 4 meters/)).toBeTruthy()
    })
    it('a picked meter that left the study (refresh) no longer counts toward the limit', async () => {
      const { rerender } = render(<MetersPanel projectId="p1" canEdit={false} openMeterId={null} view={five} />)
      for (const i of [1, 2, 3, 4]) await userEvent.click(box(i))
      rerender(<MetersPanel projectId="p1" canEdit={false} openMeterId={null} view={{ ...five, meters: [2, 3, 4, 5].map(m) }} />)
      expect(compare().textContent).toContain('(3)')
      await userEvent.click(box(5))
      expect(box(5).checked).toBe(true)
      expect(screen.queryByText(/at most 4 meters/)).toBeNull()
      await userEvent.click(compare())
      expect(screen.getByTestId('comparison').textContent).toBe('m2,m3,m4,m5')
    })
    it('ticking a meter does not open its drawer; Compare shows one overlay of the selected meters (View level too)', async () => {
      render(<MetersPanel projectId="p1" canEdit={false} openMeterId={null} view={five} />)
      await userEvent.click(box(2))
      await userEvent.click(box(4))
      expect(screen.queryByRole('complementary')).toBeNull()
      await userEvent.click(compare())
      expect(screen.getAllByTestId('comparison')).toHaveLength(1)
      expect(screen.getByTestId('comparison').textContent).toBe('m2,m4')
    })
  })
})
