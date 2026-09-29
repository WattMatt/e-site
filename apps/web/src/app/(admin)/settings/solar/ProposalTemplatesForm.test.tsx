import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/actions/solar-proposal-templates.actions', () => ({ saveSolarProposalTemplatesAction: h.save }))
import { ProposalTemplatesForm } from './ProposalTemplatesForm'

beforeEach(() => vi.clearAllMocks())

describe('ProposalTemplatesForm', () => {
  it('saves terms, disclaimer and validity with the stale guard, then keeps the new stamp', async () => {
    h.save.mockResolvedValueOnce({ ok: true, updatedAt: 'T1' }).mockResolvedValueOnce({ ok: true, updatedAt: 'T2' })
    render(<ProposalTemplatesForm initial={{ termsText: 'Old', disclaimerText: '', validityDays: 30 }} updatedAt={null} />)
    fireEvent.change(screen.getByLabelText('Proposal terms and conditions'), { target: { value: 'New terms' } })
    fireEvent.change(screen.getByLabelText('Default validity (days)'), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save templates' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ termsText: 'New terms', disclaimerText: '', validityDays: 45, expectedUpdatedAt: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Save templates' }))
    await waitFor(() => expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: 'T1' })))
  })
  it('shows field errors', async () => {
    h.save.mockResolvedValue({ fieldErrors: { validityDays: 'Between 1 and 365 days' } })
    render(<ProposalTemplatesForm initial={{ termsText: '', disclaimerText: '', validityDays: 30 }} updatedAt="T0" />)
    fireEvent.click(screen.getByRole('button', { name: 'Save templates' }))
    expect(await screen.findByText('Between 1 and 365 days')).toBeTruthy()
  })
  it('a refusal is an alert sentence', async () => {
    h.save.mockResolvedValue({ error: 'Only an organisation owner or admin can change proposal templates.' })
    render(<ProposalTemplatesForm initial={{ termsText: '', disclaimerText: '', validityDays: 30 }} updatedAt="T0" />)
    fireEvent.click(screen.getByRole('button', { name: 'Save templates' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Only an organisation owner or admin can change proposal templates.')
  })
})
