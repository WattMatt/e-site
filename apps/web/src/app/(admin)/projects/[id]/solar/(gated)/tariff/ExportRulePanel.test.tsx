import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-tariff.actions', () => ({ saveSolarExportRuleAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { ExportRulePanel } from './ExportRulePanel'
import { netBillingRule } from '@esite/shared'

beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, updatedAt: 'T2' }) })

describe('ExportRulePanel', () => {
  it('municipal: defaults to no credit; manual needs a source note before saving', async () => {
    const user = userEvent.setup()
    render(<ExportRulePanel projectId="p1" updatedAt="T1" rule={null} rates={[]} sourceNote={null} linkedExportTariff={null} sseg={netBillingRule('municipal')} ssegFromLibrary={false} />)
    expect((screen.getByLabelText('No export credit (R0)') as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByLabelText('Linked export tariff (published)')).toBeNull()
    await user.click(screen.getByLabelText('Enter export rate manually'))
    await user.type(screen.getByLabelText('Rate 1 amount'), '95')
    await user.click(screen.getByRole('button', { name: 'Save export rule' }))
    expect(screen.getByText('Say where this rate comes from (document and page)')).toBeDefined()
    expect(h.save).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Source of the rate'), 'City of Tshwane SSEG schedule 2026/27 p4')
    await user.click(screen.getByRole('button', { name: 'Save export rule' }))
    expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', expectedUpdatedAt: 'T1', form: {
      method: 'manual', sourceNote: 'City of Tshwane SSEG schedule 2026/27 p4', rates: [{ season: 'all', tou: 'all', unit: 'c_per_kWh', amount: '95' }],
    } })
  })
  it('shows the Net-Billing rule it applies, and says when it is the Rules default', () => {
    render(<ExportRulePanel projectId="p1" updatedAt="T1" rule={null} rates={[]} sourceNote={null} linkedExportTariff={null} sseg={netBillingRule('municipal')} ssegFromLibrary={false} />)
    expect(screen.getByText(/Carry forward to the end of the financial year \(June\)/)).toBeDefined()
    expect(screen.getByText(/NERSA Net-Billing Rules default: no licensee-specific rule in the library/)).toBeDefined()
  })
  it('a missing rule is called out (it blocks Tariff readiness)', () => {
    render(<ExportRulePanel projectId="p1" updatedAt="T1" rule={null} rates={[]} sourceNote={null} linkedExportTariff={null} sseg={netBillingRule('municipal')} ssegFromLibrary={false} />)
    expect(screen.getByText('No export rule saved yet: the Tariff step stays incomplete until you save one.')).toBeDefined()
  })
})
