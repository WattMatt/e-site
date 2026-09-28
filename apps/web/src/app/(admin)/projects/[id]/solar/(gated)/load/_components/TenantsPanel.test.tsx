import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ save: vi.fn(), apply: vi.fn(), vacant: vi.fn(), common: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-load.actions', () => ({ saveTenantBasisAction: h.save, applyAutoMatchAction: h.apply, excludeVacantAction: h.vacant, saveCommonAreaAction: h.common }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { TenantsPanel } from './TenantsPanel'
import type { TenantsView } from '@/lib/solar/load/view-types'

const view: TenantsView = {
  studyId: 's1', studyUpdatedAt: 'T0', commonAreaPct: 5,
  tenants: [
    { nodeId: 'n1', shopNumber: '12', name: 'Pep', category: 'standard', areaM2: 100, boDate: '2026-05-02', basis: null, summary: null, vacant: false, defaultDensity: 25, defaultArchetype: 'retail' },
    { nodeId: 'n2', shopNumber: '13', name: 'VACANT', category: null, areaM2: 50, boDate: null, basis: null, summary: null, vacant: true, defaultDensity: 25, defaultArchetype: 'retail' },
  ],
  studyMeters: [{ id: 'm1', label: 'Pep meter', kind: 'tenant' }],
  proposals: [
    { nodeId: 'n1', nodeLabel: '12 · Pep', meterId: 'm1', meterLabel: 'Pep meter', source: 'register', confidence: 'low', preTicked: false, note: 'Meter register row matched by an LLM — check before applying' },
  ],
}
beforeEach(() => {
  vi.clearAllMocks()
  h.save.mockResolvedValue({ ok: true, updatedAt: 'B1' })
  h.apply.mockResolvedValue({ ok: true, applied: 1 })
  h.vacant.mockResolvedValue({ ok: true, count: 1 })
  h.common.mockResolvedValue({ ok: true, updatedAt: 'T1' })
})

describe('TenantsPanel', () => {
  it('Metered needs at least one meter; assigning meters with a weight saves them', async () => {
    render(<TenantsPanel projectId="p1" view={view} canEdit />)
    const row = screen.getByRole('row', { name: /Pep/ })
    expect((within(row).getByRole('option', { name: 'Metered' }) as HTMLOptionElement).disabled).toBe(true)
    await userEvent.click(within(row).getByRole('button', { name: 'Assign meters' }))
    await userEvent.click(screen.getByLabelText('Pep meter'))
    await userEvent.clear(screen.getByLabelText('Weight for Pep meter'))
    await userEvent.type(screen.getByLabelText('Weight for Pep meter'), '0')
    expect(screen.getByText('Every weight must be greater than 0.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Use these meters' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.clear(screen.getByLabelText('Weight for Pep meter'))
    await userEvent.type(screen.getByLabelText('Weight for Pep meter'), '0.5')
    await userEvent.click(screen.getByRole('button', { name: 'Use these meters' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }))
    expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', nodeId: 'n1', source: 'metered', meters: [{ meterId: 'm1', weight: 0.5 }], archetype: null, densityOverride: null, expectedUpdatedAt: null })
  })
  it('a saved row carries its loaded version on the next save', async () => {
    const withBasis: TenantsView = { ...view, tenants: [{ ...view.tenants[0]!, basis: { id: 'b1', source: 'synthesised', meters: [], archetype: 'gym', densityOverride: 40, updatedAt: 'B0' } }] }
    render(<TenantsPanel projectId="p1" view={withBasis} canEdit />)
    const row = screen.getByRole('row', { name: /Pep/ })
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }))
    expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'synthesised', archetype: 'gym', densityOverride: 40, expectedUpdatedAt: 'B0' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }))
    expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: 'B1' }))
  })
  it('a refreshed view (auto-match landed a meter) re-seeds the row, and the next Save carries the NEW version', async () => {
    const { rerender } = render(<TenantsPanel projectId="p1" view={view} canEdit />)
    const refreshed: TenantsView = { ...view, tenants: [{ ...view.tenants[0]!, basis: { id: 'b1', source: 'metered', meters: [{ meterId: 'm1', weight: 1 }], archetype: null, densityOverride: null, updatedAt: 'B5' } }, view.tenants[1]!] }
    rerender(<TenantsPanel projectId="p1" view={refreshed} canEdit />)
    const row = screen.getByRole('row', { name: /Pep/ })
    expect(within(row).getByText(/Pep meter/)).toBeTruthy()
    expect((within(row).getByRole('combobox', { name: /Source for/ }) as HTMLSelectElement).value).toBe('metered')
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }))
    expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'metered', meters: [{ meterId: 'm1', weight: 1 }], expectedUpdatedAt: 'B5' }))
  })
  it('auto-match never pre-ticks an LLM match and applies only ticked pairs', async () => {
    render(<TenantsPanel projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Auto-match meters' }))
    const box = screen.getByLabelText(/Pep meter → 12 · Pep/) as HTMLInputElement
    expect(box.checked).toBe(false)
    expect((screen.getByRole('button', { name: 'Apply 0 pairs' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(box)
    await userEvent.click(screen.getByRole('button', { name: 'Apply 1 pair' }))
    expect(h.apply).toHaveBeenCalledWith({ projectId: 'p1', pairs: [{ nodeId: 'n1', meterId: 'm1' }] })
  })
  it('exclude vacant is two-step and shows the count', async () => {
    render(<TenantsPanel projectId="p1" view={view} canEdit />)
    await userEvent.click(screen.getByRole('button', { name: 'Exclude vacant (1)' }))
    expect(h.vacant).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Exclude 1 vacant tenant?' }))
    expect(h.vacant).toHaveBeenCalledWith({ projectId: 'p1', nodeIds: ['n2'] })
  })
  it('common-area allowance saves on the study version', async () => {
    render(<TenantsPanel projectId="p1" view={view} canEdit />)
    await userEvent.clear(screen.getByLabelText('Common-area allowance (%)'))
    await userEvent.type(screen.getByLabelText('Common-area allowance (%)'), '7.5')
    await userEvent.click(screen.getByRole('button', { name: 'Save allowance' }))
    expect(h.common).toHaveBeenCalledWith({ projectId: 'p1', commonAreaPct: 7.5, expectedUpdatedAt: 'T0' })
  })
  it('empty state points to the Tenant Schedule; View users see values, no controls', () => {
    const { unmount } = render(<TenantsPanel projectId="p1" view={{ ...view, tenants: [] }} canEdit />)
    expect(screen.getByText(/No tenants in the tenant schedule/)).toBeTruthy()
    unmount()
    render(<TenantsPanel projectId="p1" view={view} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Auto-match meters' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Assign meters' })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText(/Common-area allowance: 5 %/)).toBeTruthy()
  })
})
