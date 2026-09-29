import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-tariff.actions', () => ({ saveSolarEscalationAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { EscalationTable } from './EscalationTable'

beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, updatedAt: 'T2' }) })

describe('EscalationTable', () => {
  it('shows each year with its source and saves only the years the user changed', async () => {
    const user = userEvent.setup()
    render(<EscalationTable projectId="p1" updatedAt="T1" rows={[
      { year: 2, pct: 12.74, source: 'published', financialYear: '2026/27' },
      { year: 3, pct: 8.75, source: 'default', financialYear: null },
    ]} />)
    expect(screen.getByText('Approved increase 2026/27')).toBeDefined()
    expect(screen.getByText('Org default (D-07)')).toBeDefined()
    await user.type(screen.getByLabelText('Year 3 escalation %'), '10')
    await user.click(screen.getByRole('button', { name: 'Save escalation' }))
    expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', expectedUpdatedAt: 'T1', form: { '3': '10' } })
  })
  it('Reset to defaults arms first, names what it drops, then clears every override', async () => {
    const user = userEvent.setup()
    render(<EscalationTable projectId="p1" updatedAt="T1" rows={[
      { year: 2, pct: 20, source: 'override', financialYear: null },
      { year: 3, pct: 9, source: 'override', financialYear: null },
    ]} />)
    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(h.save).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm reset (drops 2 project values)' }))
    expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', expectedUpdatedAt: 'T1', form: {} })
  })
  it('Reset to defaults is not offered when nothing is set for this project', () => {
    render(<EscalationTable projectId="p1" updatedAt="T1" rows={[{ year: 2, pct: 12, source: 'published', financialYear: '2026/27' }]} />)
    expect(screen.queryByRole('button', { name: 'Reset to defaults' })).toBeNull()
  })
  it('no rows: says where the path comes from', () => {
    render(<EscalationTable projectId="p1" updatedAt="T1" rows={[]} />)
    expect(screen.getByText(/No escalation path yet/)).toBeDefined()
  })
})
