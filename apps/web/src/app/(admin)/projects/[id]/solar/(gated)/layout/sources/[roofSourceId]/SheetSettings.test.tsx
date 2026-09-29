import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/actions/cable-route.actions', () => ({ calibrateFloorPlanAction: vi.fn() }))
vi.mock('@/actions/solar-roof-sources.actions', () => ({ setRoofNorthAction: vi.fn() }))
vi.mock('../../_components/SolarCanvas', () => ({ EMPTY_SELECTION: { ids: [], modules: [] } }))

import { SheetSettings } from './SheetSettings'
import type { RoofSourceRow } from '@/lib/solar/layout-loader'

const source: RoofSourceRow = {
  id: 'rs1', kind: 'drawing', floorPlanId: 'fp1', pageIndex: 1, label: 'Roof · page 1', pixelsPerMeter: null,
  northBearingDeg: null, northSet: false, drawingChanged: false, attribution: null, updatedAt: 'T',
}
const sheet = { key: 'rs1', signedUrl: null, isPdf: true, pageIndex: 1 }

describe('SheetSettings (review fix: calibration stays owner/admin/PM, decision 3)', () => {
  it('a Solar Edit user who cannot calibrate sees the button disabled with the reason', () => {
    render(<SheetSettings projectId="p1" source={source} sheet={sheet} canEdit canCalibrate={false} />)
    expect((screen.getByRole('button', { name: 'Calibrate scale' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Only an owner, admin or project manager can set a drawing’s scale.')).toBeTruthy()
  })
  it('an owner/admin/PM can calibrate', () => {
    render(<SheetSettings projectId="p1" source={source} sheet={sheet} canEdit canCalibrate />)
    expect((screen.getByRole('button', { name: 'Calibrate scale' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
