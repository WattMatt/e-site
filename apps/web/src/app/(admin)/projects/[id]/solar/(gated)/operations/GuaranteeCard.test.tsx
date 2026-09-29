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
  it('Save guarantee is disabled while it is saving, so a double press cannot race the version guard (review round 2)', async () => {
    let release: (v: { ok: true; updatedAt: string }) => void = () => {}
    h.save.mockImplementationOnce((() => new Promise((r) => { release = r })) as never)
    render(<GuaranteeCard projectId="p1" installationId="i1" canEdit guarantee={g} />)
    const save = screen.getByRole('button', { name: 'Save guarantee' }) as HTMLButtonElement
    fireEvent.click(save)
    await waitFor(() => expect(save.disabled).toBe(true))
    fireEvent.click(save)
    expect(h.save).toHaveBeenCalledTimes(1)
    release({ ok: true, updatedAt: 'G2' })
    await waitFor(() => expect(save.disabled).toBe(false))
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
  it('a blank manual month is an error, never 0 kWh (review B5)', async () => {
    render(<GuaranteeCard projectId="p1" installationId="i1" canEdit guarantee={g} />)
    fireEvent.change(screen.getByLabelText('Guarantee basis'), { target: { value: 'manual' } })
    const months = screen.getAllByLabelText(/kWh guaranteed in/)
    months.forEach((el, k) => { if (k !== 4) fireEvent.change(el, { target: { value: '1000' } }) })
    fireEvent.click(screen.getByRole('button', { name: 'Save guarantee' }))
    expect(await screen.findByText('Enter the guaranteed kWh for every month (May is blank).')).toBeTruthy()
    expect(h.save).not.toHaveBeenCalled()
  })
  it('a View user sees the basis as text, with no inputs (review B9: controls above the level are hidden)', () => {
    render(<GuaranteeCard projectId="p1" installationId="i1" canEdit={false} guarantee={{ ...g, basis: 'pct_of_modelled', pct: 90 }} />)
    expect(screen.queryByLabelText('Guarantee basis')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText(/90 % of modelled|% of modelled/)).toBeTruthy()
    expect(screen.getByText(/0\.45 % a year/)).toBeTruthy()
  })
})
