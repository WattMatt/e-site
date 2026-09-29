import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ approve: vi.fn(), reject: vi.fn(), edit: vi.fn(), del: vi.fn(), url: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/tariff-review.actions', () => ({ approveChargeAction: h.approve, rejectChargeAction: h.reject, editChargeAction: h.edit, deleteTariffAction: h.del }))
vi.mock('@/actions/tariff-library.actions', () => ({ getTariffSourceUrlAdminAction: h.url }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/components/tariffs/SourceViewer', () => ({ SourceViewer: (p: { title: string }) => <div>viewer {p.title}</div> }))

import { ReviewQueue } from './ReviewQueue'
import type { ReviewTariff } from './review-model'

const model: ReviewTariff[] = [{
  id: 't1', name: 'Commercial', code: 'C1', structure: 'flat', issues: [],
  charges: [{
    id: 'c1', component: 'basic', season: 'all', tou: 'all', dayType: 'all', blockMin: null, blockMax: null,
    unit: 'R_per_month', amount: 400, vatBasis: 'assumed_excl', unitInferred: true, inferenceReason: 'no unit printed',
    reviewedAt: null, needsReview: true, sourceDocumentId: 'd1', locator: { page: 3 }, issues: [{ severity: 'block', message: 'Too high' }],
    seen: { amount: '400.00', unit: 'R_per_month', reviewedAt: null },
  }],
}]

beforeEach(() => { vi.clearAllMocks(); h.approve.mockResolvedValue({ ok: true }); h.reject.mockResolvedValue({ ok: true }) })

describe('ReviewQueue', () => {
  it('shows every charge with its inferred-unit reason and approves it', async () => {
    const user = userEvent.setup()
    render(<ReviewQueue tariffs={model} editable />)
    expect(screen.getByText('no unit printed')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(h.approve).toHaveBeenCalledWith({ chargeId: 'c1', expected: { amount: '400.00', unit: 'R_per_month', reviewedAt: null } })
    expect(h.refresh).toHaveBeenCalled()
  })
  it('Reject is two-step', async () => {
    const user = userEvent.setup()
    render(<ReviewQueue tariffs={model} editable />)
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(h.reject).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm reject' }))
    expect(h.reject).toHaveBeenCalledWith({ chargeId: 'c1', expected: { amount: '400.00', unit: 'R_per_month', reviewedAt: null } })
  })
  it('View source opens the source viewer titled with the tariff and component', async () => {
    const user = userEvent.setup()
    render(<ReviewQueue tariffs={model} editable />)
    await user.click(screen.getByRole('button', { name: 'View source' }))
    expect(screen.getByText('viewer Commercial — Basic charge')).toBeDefined()
  })
  it('shows stored tokens in words: structure, VAT basis and check severity', () => {
    render(<ReviewQueue tariffs={model} editable />)
    expect(screen.getByText('Commercial (C1) · Flat rate')).toBeDefined()
    expect(screen.getByText('Excl. VAT (assumed)')).toBeDefined()
    expect(screen.getByText('Blocks publishing')).toBeDefined()
    expect(screen.queryByText('assumed_excl')).toBeNull()
  })
  it('Save on an edit sends what the reviewer saw, so a stale charge is refused', async () => {
    h.edit.mockResolvedValue({ error: 'That charge changed or was removed since you loaded the page. Reload to see the current version.' })
    const user = userEvent.setup()
    render(<ReviewQueue tariffs={model} editable />)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(h.edit).toHaveBeenCalledWith(expect.objectContaining({ chargeId: 'c1', expected: { amount: '400.00', unit: 'R_per_month', reviewedAt: null } }))
    expect(await screen.findByText(/changed or was removed/)).toBeDefined()
  })
  it('Delete tariff is two-step and shows it is working while the delete runs', async () => {
    let finish: (v: { ok: true }) => void = () => {}
    h.del.mockReturnValue(new Promise((r) => { finish = r }))
    const user = userEvent.setup()
    render(<ReviewQueue tariffs={model} editable />)
    await user.click(screen.getByRole('button', { name: 'Delete tariff' }))
    expect(h.del).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm delete tariff' }))
    expect(h.del).toHaveBeenCalledWith({ tariffId: 't1' })
    const btn = screen.getByRole('button', { name: /delete tariff/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    finish({ ok: true })
  })
  it('a published year is read-only', () => {
    render(<ReviewQueue tariffs={model} editable={false} />)
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View source' })).toBeDefined()
  })
})
