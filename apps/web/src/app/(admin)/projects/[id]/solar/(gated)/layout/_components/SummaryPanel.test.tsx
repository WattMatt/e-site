import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SummaryPanel } from './SummaryPanel'
import { GENERIC_INVERTER_50KW as INV, GENERIC_MODULE_550 as M, type LayoutObject } from '@esite/shared'

const q = (x: number, y: number) => [x, y, x + 10, y, x + 10, y + 20, x, y + 20]
const objs: LayoutObject[] = [
  { id: 'R', kind: 'roof', pixelsPerMeter: 10, geometry: { points: [0, 0, 200, 0, 200, 120, 0, 120] }, props: { name: 'R', roofType: 'flat', pitchDeg: 0, fallBearingDeg: null, heightM: 6, setbackM: 0.5, maxLoadKgM2: null } },
  { id: 'A', kind: 'array', pixelsPerMeter: 10, geometry: { modules: [q(10, 10), q(30, 10)] }, props: { roofId: 'R', module: M, orientation: 'portrait', mounting: 'racked', tiltDeg: 15, facingSheetDeg: 0, azimuthOverrideDeg: null, rowPitchM: 3.5, gapM: 0.02 } },
  { id: 'I', kind: 'inverter', pixelsPerMeter: 10, geometry: { x: 110, y: 10 }, props: { name: 'INV-1', inverter: INV } },
]

describe('SummaryPanel', () => {
  it('shows kWp, AC, ratio, counts, utilisation and a disabled Push to case with its reason', () => {
    render(<SummaryPanel objects={objs} conditions={{ tMinC: -5, tAmbMaxC: 35 }} layoutName="Option A" onDownloadBom={vi.fn()} />)
    expect(screen.getByText('1.10 kWp')).toBeTruthy()
    expect(screen.getByText('50.0 kW')).toBeTruthy()
    expect(screen.getByText('0.02')).toBeTruthy()
    expect(screen.getByText('2 modules')).toBeTruthy()
    expect(screen.getByText('1.7 %')).toBeTruthy()
    const push = screen.getByRole('button', { name: 'Push to case' }) as HTMLButtonElement
    expect(push.disabled).toBe(true)
    expect(push.title).toBe('Cases arrive with Yield & Scenarios.')
  })
})
