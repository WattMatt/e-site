import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ record: vi.fn(), del: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-tariff.actions', () => ({ recordSolarBillCheckAction: h.record, deleteSolarBillCheckAction: h.del }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { BillCheckPanel } from './BillCheckPanel'

beforeEach(() => vi.clearAllMocks())

describe('BillCheckPanel', () => {
  it('flat tariff: one kWh box; a > 5 % difference is amber with the model', async () => {
    h.record.mockResolvedValue({ ok: true, result: { modelled: 2900, actual: 2700, differencePct: 7.407, warn: true, notModelled: ['saturday-only charges are not modelled'] } })
    const user = userEvent.setup()
    render(<BillCheckPanel projectId="p1" isTou={false} history={[]} canRun />)
    expect(screen.queryByLabelText('Peak kWh')).toBeNull()
    await user.type(screen.getByLabelText('Billing month'), '2026-03')
    await user.type(screen.getByLabelText('Energy (kWh)'), '1000')
    await user.type(screen.getByLabelText('Bill total excl. VAT (R)'), '2700')
    await user.click(screen.getByRole('button', { name: 'Check this bill' }))
    expect(await screen.findByText('Model differs from the bill')).toBeDefined()
    expect(screen.getByText('Modelled R2,900.00 vs actual R2,700.00 (+7.407 %)').parentElement!.dataset.tone).toBe('amber')
    expect(screen.getByText('saturday-only charges are not modelled')).toBeDefined()
  })
  it('within ±5 %: no warning, and the result is not amber', async () => {
    h.record.mockResolvedValue({ ok: true, result: { modelled: 2100, actual: 2000, differencePct: 5, warn: false, notModelled: [] } })
    const user = userEvent.setup()
    render(<BillCheckPanel projectId="p1" isTou={false} history={[]} canRun />)
    await user.type(screen.getByLabelText('Billing month'), '2026-03')
    await user.type(screen.getByLabelText('Energy (kWh)'), '680')
    await user.type(screen.getByLabelText('Bill total excl. VAT (R)'), '2000')
    await user.click(screen.getByRole('button', { name: 'Check this bill' }))
    const status = await screen.findByText('Modelled R2,100.00 vs actual R2,000.00 (+5 %)')
    expect(screen.queryByText('Model differs from the bill')).toBeNull()
    expect((status.parentElement as HTMLElement).dataset.tone).toBe('ok')
  })
  it('history: 5.00 % is not amber; 5.01 % is', () => {
    render(<BillCheckPanel projectId="p1" isTou={false} canRun history={[
      { id: 'b1', month: '2026-02', actual: 2000, modelled: 2100, differencePct: 5, createdAt: 'T' },
      { id: 'b2', month: '2026-03', actual: 2000, modelled: 2100.2, differencePct: 5.01, createdAt: 'T' },
    ]} />)
    expect(screen.getByText('+5 %').dataset.tone).toBe('ok')
    expect(screen.getByText('+5.01 %').dataset.tone).toBe('amber')
  })
  it('TOU tariff asks for the three periods; no tariff means no button', () => {
    const { unmount } = render(<BillCheckPanel projectId="p1" isTou history={[]} canRun />)
    expect(screen.getByLabelText('Peak kWh')).toBeDefined()
    unmount()
    render(<BillCheckPanel projectId="p1" isTou={false} history={[]} canRun={false} />)
    expect(screen.queryByRole('button', { name: 'Check this bill' })).toBeNull()
    expect(screen.getByText('Choose a tariff first.')).toBeDefined()
  })
  it('an empty history says so; deleting a past check is two-step', async () => {
    h.del.mockResolvedValue({ ok: true })
    const { unmount } = render(<BillCheckPanel projectId="p1" isTou={false} history={[]} canRun />)
    expect(screen.getByText('No bills checked yet. Enter one above to compare it with the model.')).toBeDefined()
    unmount()
    const user = userEvent.setup()
    render(<BillCheckPanel projectId="p1" isTou={false} canRun
      history={[{ id: 'b1', month: '2026-03', actual: 2700, modelled: 2900, differencePct: 7.407, createdAt: 'T' }]} />)
    await user.click(screen.getByRole('button', { name: 'Delete the 2026-03 check' }))
    expect(h.del).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm delete of the 2026-03 check' }))
    expect(h.del).toHaveBeenCalledWith({ projectId: 'p1', id: 'b1' })
  })
})
