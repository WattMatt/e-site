import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ create: vi.fn(), revert: vi.fn(), edit: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-tariff.actions', () => ({ createSolarTariffOverrideAction: h.create, revertSolarTariffOverrideAction: h.revert, editSolarOverrideChargeAction: h.edit }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { OverridePanel } from './OverridePanel'
import type { OverrideChargeRow } from '@esite/shared'

const row: OverrideChargeRow = { id: 'oc1', baseChargeId: 'c1', component: 'energy', season: 'all', tou: 'all', dayType: 'all', blockMinKwh: null, blockMaxKwh: null,
  blockBasis: null, unit: 'c_per_kWh', demandBasis: null, amountExclVat: 250, vatRate: 0.15, vatBasis: 'stated_excl', sourceLocator: {}, reason: null, editedAt: null, editedBy: null, updatedAt: 'R1' }

beforeEach(() => { vi.clearAllMocks(); h.create.mockResolvedValue({ ok: true }); h.revert.mockResolvedValue({ ok: true }); h.edit.mockResolvedValue({ ok: true }) })

describe('OverridePanel', () => {
  it('no override: Create project override copies the pinned tariff', async () => {
    const user = userEvent.setup()
    render(<OverridePanel projectId="p1" studyUpdatedAt="T1" override={null} published={{}} />)
    await user.click(screen.getByRole('button', { name: 'Create project override' }))
    expect(h.create).toHaveBeenCalledWith({ projectId: 'p1', expectedUpdatedAt: 'T1' })
  })
  it('editing a rate requires a reason; the unit select is required', async () => {
    const user = userEvent.setup()
    h.edit.mockResolvedValueOnce({ fieldErrors: { reason: 'Say why this rate differs from the published one' } })
    render(<OverridePanel projectId="p1" studyUpdatedAt="T1" override={{ id: 'o1', rows: [row] }} published={{ c1: { amount: 250, unit: 'c_per_kWh' } }} />)
    expect(screen.getByText('Project-specific rates: the bill check uses these instead of the published tariff.')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByLabelText('New amount'))
    await user.type(screen.getByLabelText('New amount'), '199')
    await user.click(screen.getByRole('button', { name: 'Save rate' }))
    expect(h.edit).toHaveBeenCalledWith({ projectId: 'p1', chargeId: 'oc1', expectedUpdatedAt: 'R1', form: { amount: '199', unit: 'c_per_kWh', reason: '' } })
    expect(screen.getByText('Say why this rate differs from the published one')).toBeDefined()
  })
  it('the unit is required: blank is offered as "Choose a unit", sent as blank, and its refusal is shown', async () => {
    const user = userEvent.setup()
    h.edit.mockResolvedValueOnce({ fieldErrors: { unit: 'Choose a unit' } })
    render(<OverridePanel projectId="p1" studyUpdatedAt="T1" override={{ id: 'o1', rows: [row] }} published={{}} />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const unit = screen.getByLabelText('Unit') as HTMLSelectElement
    expect(unit.required).toBe(true)
    await user.selectOptions(unit, '')
    await user.type(screen.getByLabelText('Reason'), 'Lease cl. 14')
    await user.click(screen.getByRole('button', { name: 'Save rate' }))
    expect(h.edit).toHaveBeenCalledWith(expect.objectContaining({ form: { amount: '250', unit: '', reason: 'Lease cl. 14' } }))
    expect(screen.getByRole('alert').textContent).toBe('Choose a unit')
    expect(h.refresh).not.toHaveBeenCalled()
  })
  it('Revert is two-step', async () => {
    const user = userEvent.setup()
    render(<OverridePanel projectId="p1" studyUpdatedAt="T1" override={{ id: 'o1', rows: [row] }} published={{}} />)
    await user.click(screen.getByRole('button', { name: 'Revert to published tariff' }))
    expect(h.revert).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm revert (drops 1 project rate)' }))
    expect(h.revert).toHaveBeenCalledWith({ projectId: 'p1', expectedUpdatedAt: 'T1' })
  })
})
