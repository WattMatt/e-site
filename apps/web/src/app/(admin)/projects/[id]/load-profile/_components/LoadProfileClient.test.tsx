import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { makeCharge, makeTariff, type TouCalendar } from '@esite/shared'
import { composeView, type SourceRow } from '@/lib/load-profile/compose'
import type { LoadProfileView } from '@/lib/load-profile/view-types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/load-profile.actions', () => ({
  addSyntheticSourceAction: vi.fn(), commitLoadProfileFileAction: vi.fn(), deleteLoadProfileSourceAction: vi.fn(),
  parseLoadProfileFileAction: vi.fn(), updateLoadProfileSourceAction: vi.fn(), saveLoadProfileSettingsAction: vi.fn(),
  listPublishedLicenseesAction: vi.fn(), listPublishedTariffsAction: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
// Canvas is not available under jsdom.
vi.mock('@/components/charts/HeatmapCanvas', () => ({ HeatmapCanvas: ({ title }: { title: string }) => <div>{title}</div> }))

const { LoadProfileClient } = await import('./LoadProfileClient')

const base: LoadProfileView = {
  projectId: '11111111-2222-3333-4444-555555555555', projectName: 'Mall', canEdit: true, profileId: null,
  settings: { referenceYear: 2025, powerFactor: 0.95, nmdKva: null, tariffId: null }, sources: [],
  tenants: { count: 3, withArea: 2, totalAreaM2: 450 }, analysis: null, cost: null, compositionNote: null,
}
const meter: SourceRow = {
  id: 'm', kind: 'meter', label: 'Bulk meter', included: true, file_name: 'bulk.csv', format: 'B', source_column: 'P (per kW)', kva_column: null,
  interval_min: 60, first_ts_end: new Date(Date.UTC(2025, 0, 1) - 7_200_000 + 3_600_000).toISOString(),
  values: Array(8760).fill(10), quality: Array(8760).fill(0), kva_values: null, conversion: 'kW as recorded (average over 60 min)', quality_report: null, params: null, role: 'tenant', solar_meter_id: null,
}
const flat: TouCalendar = {
  highSeasonMonths: [6, 7, 8], holidayTreatedAs: 'sunday', source: 'published',
  windows: (['high', 'low'] as const).flatMap((season) => (['weekday', 'saturday', 'sunday'] as const).map((dayType) => ({ season, dayType, startMinute: 0, endMinute: 1440, period: 'off_peak' as const }))),
}
const archetypes = [{ code: 'retail', name: 'Retail' }]

describe('LoadProfileClient', () => {
  it('empty state, editor: the call to action and both ways in', () => {
    render(<LoadProfileClient view={base} archetypes={archetypes} />)
    expect(screen.getByText('No load profile yet')).toBeTruthy()
    expect(screen.getByLabelText('Upload meter files')).toBeTruthy()
    expect(screen.getByText('Estimate from tenant schedule')).toBeTruthy()
    expect(screen.queryByText('Export Excel')).toBeNull()
  })
  it('empty state, reader: no upload control, says who can add data', () => {
    render(<LoadProfileClient view={{ ...base, canEdit: false }} archetypes={archetypes} />)
    expect(screen.queryByLabelText('Upload meter files')).toBeNull()
    expect(screen.getByText(/An owner, admin or project manager can add one/)).toBeTruthy()
  })
  it('with a profile and a tariff: figures, NMD, cost and exports', () => {
    const tariff = makeTariff({ name: 'Flat', structure: 'tou', charges: [makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200, tou: 'off_peak' })] })
    const c = composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: null, sources: [meter], tenants: [], costing: { tariffId: 't', tariff, calendar: flat, calendarAssumedEskom: false, label: 'City · 2025/26 · Flat' } })
    render(<LoadProfileClient view={{ ...base, ...c, settings: { ...base.settings, tariffId: 't' } }} archetypes={archetypes} />)
    expect(screen.getByText('87 600 kWh')).toBeTruthy()
    expect(screen.getByText('15 kVA')).toBeTruthy()
    expect(screen.getAllByText('R 175 200.00')).toHaveLength(2) // the KPI and the table's Year row
    expect(screen.getByText('Export Excel').getAttribute('href')).toBe('/api/projects/11111111-2222-3333-4444-555555555555/load-profile/export?format=xlsx')
    expect(screen.getByText(/NMD used for costing: 10.53 kVA \(not confirmed/)).toBeTruthy()
  })
})
