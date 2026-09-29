import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ select: vi.fn(), refresh: vi.fn(), push: vi.fn() }))
vi.mock('@/actions/solar-tariff.actions', () => ({ selectSolarTariffAction: h.select }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: h.push }), usePathname: () => '/projects/p1/solar/tariff' }))

import { TariffPicker } from './TariffPicker'
import type { TariffListItem } from '@esite/shared'

const t = (p: Partial<TariffListItem>): TariffListItem => ({ id: 'x', code: null, name: 'T', category: 'commercial', metering: 'conventional', structure: 'flat',
  voltageBand: null, phase: null, minKva: null, maxKva: null, minAmps: null, maxAmps: null, isLegacy: false, exportTariffId: null, ...p })
const tariffs = [t({ id: '11111111-1111-1111-1111-111111111111', name: 'Commercial' }), t({ id: '22222222-2222-2222-2222-222222222222', name: 'Megaflex', category: 'industrial', minKva: 1000 })]
const years = [{ id: 'y25', financialYear: '2025/26', state: 'published' as const, effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30', approvedIncreasePct: null },
  { id: 'y24', financialYear: '2024/25', state: 'superseded' as const, effectiveFrom: '2024-07-01', effectiveTo: '2025-06-30', approvedIncreasePct: null }]

beforeEach(() => { vi.clearAllMocks(); h.select.mockResolvedValue({ ok: true, updatedAt: 'T2' }) })

describe('TariffPicker', () => {
  it('lists only eligible tariffs; Show all reveals the rest with the reason', async () => {
    const user = userEvent.setup()
    render(<TariffPicker projectId="p1" years={years} selectedYearId="y25" yearNote={null} tariffs={tariffs} supply={{ nmdKva: 500, supplyVoltageV: 400 }} pinnedTariffId={null} lockedReason={null} updatedAt="T1" />)
    expect(screen.getByRole('radio', { name: /Commercial/ })).toBeDefined()
    expect(screen.queryByRole('radio', { name: /Megaflex/ })).toBeNull()
    expect(screen.getByText('1 more not eligible for this supply')).toBeDefined()
    await user.click(screen.getByLabelText('Show all'))
    expect(screen.getByText('NMD 500 kVA is below the 1000 kVA minimum')).toBeDefined()
  })
  it('choosing a tariff saves with the loaded timestamp', async () => {
    const user = userEvent.setup()
    render(<TariffPicker projectId="p1" years={years} selectedYearId="y25" yearNote={null} tariffs={tariffs} supply={{ nmdKva: 500, supplyVoltageV: 400 }} pinnedTariffId={null} lockedReason={null} updatedAt="T1" />)
    await user.click(screen.getByRole('radio', { name: /Commercial/ }))
    expect(h.select).toHaveBeenCalledWith({ projectId: 'p1', tariffId: '11111111-1111-1111-1111-111111111111', expectedUpdatedAt: 'T1' })
    expect(h.refresh).toHaveBeenCalled()
  })
  it('labels superseded years and moves between years by URL', async () => {
    const user = userEvent.setup()
    render(<TariffPicker projectId="p1" years={years} selectedYearId="y25" yearNote="2026/27 not yet published in the library — using 2025/26 with escalation" tariffs={tariffs} supply={{ nmdKva: null, supplyVoltageV: null }} pinnedTariffId={null} lockedReason={null} updatedAt="T1" />)
    expect(screen.getByRole('option', { name: '2024/25 (superseded)' })).toBeDefined()
    expect(screen.getByText('2026/27 not yet published in the library — using 2025/26 with escalation')).toBeDefined()
    await user.selectOptions(screen.getByLabelText('Financial year'), '2024/25')
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/tariff?fy=2024%2F25')
  })
  it('locked while a project override exists', () => {
    render(<TariffPicker projectId="p1" years={years} selectedYearId="y25" yearNote={null} tariffs={tariffs} supply={{ nmdKva: 500, supplyVoltageV: 400 }} pinnedTariffId={tariffs[0].id} lockedReason="Revert the project override before choosing another tariff." updatedAt="T1" />)
    expect((screen.getByRole('radio', { name: /Commercial/ }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('Revert the project override before choosing another tariff.')).toBeDefined()
  })
  it('an empty year says so', () => {
    render(<TariffPicker projectId="p1" years={years} selectedYearId="y25" yearNote={null} tariffs={[]} supply={{ nmdKva: null, supplyVoltageV: null }} pinnedTariffId={null} lockedReason={null} updatedAt="T1" />)
    expect(screen.getByText('No tariffs match.')).toBeDefined()
    expect(screen.queryByText(/Tick "Show all"/)).toBeNull()
  })
  it('nothing eligible but some hidden: the hint names "Show all", and ticking it reveals them', async () => {
    const user = userEvent.setup()
    render(<TariffPicker projectId="p1" years={years} selectedYearId="y25" yearNote={null} tariffs={[tariffs[1]]} supply={{ nmdKva: 500, supplyVoltageV: 400 }} pinnedTariffId={null} lockedReason={null} updatedAt="T1" />)
    expect(screen.getByText('No tariffs match. Tick "Show all" to see tariffs outside this supply\'s NMD or voltage.')).toBeDefined()
    await user.click(screen.getByLabelText('Show all'))
    expect(screen.getByRole('radio', { name: /Megaflex/ })).toBeDefined()
    expect(screen.queryByText(/No tariffs match/)).toBeNull()
  })
})
