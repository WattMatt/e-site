import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ save: vi.fn(async () => ({ ok: true, updatedAt: 'G2' })), refresh: vi.fn() }))
vi.mock('@/actions/solar-operations.actions', () => ({ saveGuaranteeAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
import { GuaranteeCard } from './GuaranteeCard'

const g = { basis: 'p50' as const, pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0.45, updatedAt: 'G1' }
beforeEach(() => vi.clearAllMocks())

describe('GuaranteeCard', () => {
  it('saves % of modelled with its percentage', async () => {
    render(<GuaranteeCard projectId="p1" installationId="i1" canEdit guarantee={g} />)
    fireEvent.change(screen.getByLabelText('Guarantee basis'), { target: { value: 'pct_of_modelled' } })
    fireEvent.change(screen.getByLabelText('Percentage of modelled'), { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save guarantee' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', expectedUpdatedAt: 'G1',
      guarantee: { basis: 'pct_of_modelled', pct: 90, manualMonthlyKwh: null, degradationPctPerYear: 0.45 } }))
  })
  it('manual basis offers twelve months', async () => {
    render(<GuaranteeCard projectId="p1" installationId="i1" canEdit guarantee={g} />)
    fireEvent.change(screen.getByLabelText('Guarantee basis'), { target: { value: 'manual' } })
    expect(screen.getAllByLabelText(/kWh guaranteed in/)).toHaveLength(12)
  })
  it('explains that nobody retypes it monthly', () => {
    render(<GuaranteeCard projectId="p1" installationId="i1" canEdit={false} guarantee={g} />)
    expect(screen.getByText(/derived for every month automatically/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save guarantee' })).toBeNull()
  })
})
