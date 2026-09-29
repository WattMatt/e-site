import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ portalRespond: vi.fn(), portalPdf: vi.fn() }))
vi.mock('@/actions/solar-portal-proposals.actions', () => ({ respondToPortalProposalAction: h.portalRespond, getPortalProposalPdfUrlAction: h.portalPdf }))
import { financeOptionTable, keyFigures } from '@esite/shared/solar-reports'
import { proposalSnapshot } from '@/test/proposal-fixture'
import { ProposalClientView } from './ProposalClientView'
import type { ClientProposalView } from '@/lib/solar/proposals/client'

const snap = proposalSnapshot()
const view = (o: Partial<ClientProposalView> = {}): ClientProposalView => ({ state: 'viewed', version: 2, expiresAt: snap.proposal.validUntil, snapshot: snap, issuer: snap.issuer, response: null, ...o })
const TOKEN = 'A'.repeat(43)
const fetchMock = vi.fn()
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('fetch', fetchMock) })

describe('ProposalClientView (§9.4)', () => {
  it('prints EXACTLY the snapshot’s key figures and finance table — the same strings the PDF prints', () => {
    render(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view()} />)
    keyFigures(snap).forEach((f, i) => {
      expect(screen.getByTestId(`kf-label-${i}`).textContent).toBe(f.label)
      expect(screen.getByTestId(`kf-value-${i}`).textContent).toBe(f.value)
    })
    const t = financeOptionTable(snap)
    t.rows.forEach((r, ri) => r.forEach((c, ci) => expect(screen.getByTestId(`fo-${ri}-${ci}`).textContent).toBe(c)))
  })
  it('expired / withdrawn / not found: the no-longer-available message naming the proposer, no figures', () => {
    const { rerender } = render(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view({ state: 'expired', snapshot: null })} />)
    expect(screen.getByText('This proposal has expired — contact Pat Proposer (pat@sun.example).')).toBeTruthy()
    expect(screen.queryByTestId('kf-value-0')).toBeNull()
    rerender(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view({ state: 'withdrawn', snapshot: null })} />)
    expect(screen.getByText('This proposal is no longer available — contact Pat Proposer (pat@sun.example).')).toBeTruthy()
    rerender(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view({ state: 'not_found', snapshot: null, issuer: null })} />)
    expect(screen.getByText('This proposal is no longer available.')).toBeTruthy()
  })
  it('Accept (token): typed name, email, authority tick; two-step; posts to the public route; shows the result', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, state: 'accepted' }) })
    render(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view()} />)
    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: 'Client Name' } })
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'c@acme.example' } })
    const accept = screen.getByRole('button', { name: 'Accept proposal' }) as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('I have authority to accept on behalf of Acme Retail (Pty) Ltd'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept proposal' }))
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm acceptance' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/solar/proposal-response', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)
    expect(body).toEqual({ token: TOKEN, decision: 'accepted', name: 'Client Name', email: 'c@acme.example', authority: true, signature: null, reason: null })
    expect(await screen.findByText('Thank you — you accepted this proposal.')).toBeTruthy()
  })
  it('Decline (portal) with a reason goes through the portal action', async () => {
    h.portalRespond.mockResolvedValue({ ok: true, state: 'declined' })
    render(<ProposalClientView mode={{ kind: 'portal', projectId: 'p1', proposalId: 'pr1' }} view={view()} />)
    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: 'CV' } })
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'cv@acme.example' } })
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Too expensive' } })
    fireEvent.click(screen.getByRole('button', { name: 'Decline proposal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decline' }))
    await waitFor(() => expect(h.portalRespond).toHaveBeenCalledWith({ projectId: 'p1', proposalId: 'pr1', decision: 'declined', name: 'CV', email: 'cv@acme.example', authority: false, signature: null, reason: 'Too expensive' }))
    expect(await screen.findByText('You declined this proposal.')).toBeTruthy()
  })
  it('a refusal from the server is shown as the sentence', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'This proposal has expired.' }) })
    render(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view()} />)
    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: 'Client Name' } })
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'c@acme.example' } })
    fireEvent.click(screen.getByLabelText('I have authority to accept on behalf of Acme Retail (Pty) Ltd'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept proposal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm acceptance' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This proposal has expired.')
  })
  it('already answered: shows who answered, no form', () => {
    render(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view({ state: 'accepted', response: { kind: 'accepted', name: 'Client Name', at: '2026-10-01T10:00:00Z' } })} />)
    expect(screen.getByText('Accepted by Client Name on 2026-10-01.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept proposal' })).toBeNull()
  })
  it('Download PDF: token posts the token in the body; portal uses the portal action; failures are sentences', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'This proposal is no longer available.' }) })
    const { unmount } = render(<ProposalClientView mode={{ kind: 'token', token: TOKEN }} view={view()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/solar/proposal-download', expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: TOKEN }) })))
    expect((await screen.findByRole('alert')).textContent).toBe('This proposal is no longer available.')
    unmount()
    h.portalPdf.mockResolvedValue({ error: 'You do not have access to this project.' })
    render(<ProposalClientView mode={{ kind: 'portal', projectId: 'p1', proposalId: 'pr1' }} view={view()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(h.portalPdf).toHaveBeenCalledWith({ projectId: 'p1', proposalId: 'pr1' }))
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have access to this project.')
  })
})
