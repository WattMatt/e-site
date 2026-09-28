import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/actions/solar-load.actions', () => ({
  ensureSolarStudyAction: vi.fn(), searchLibraryMetersAction: vi.fn(), linkLibraryMetersAction: vi.fn(),
  confirmRegisterRowAction: vi.fn(), updateStudyMeterAction: vi.fn(), removeStudyMeterAction: vi.fn(),
}))
import { MetersPanel } from './MetersPanel'
import type { MetersView } from '@/lib/solar/load/view-types'

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
})
