import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
const h = vi.hoisted(() => ({
  access: vi.fn(), list: vi.fn(), one: vi.fn(), view: vi.fn((p: unknown) => { void p }),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))
vi.mock('next/navigation', () => ({ notFound: h.notFound }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '198.51.100.2', 'user-agent': 'ua/2' }) }))
vi.mock('@/lib/portal/data', () => ({ requirePortalAccess: h.access }))
vi.mock('@/lib/solar/proposals/client', () => ({ loadPortalProposals: h.list, loadPortalProposal: h.one }))
vi.mock('@/components/solar/proposal/ProposalClientView', () => ({ ProposalClientView: (p: unknown) => { h.view(p); return <p>client view</p> } }))
import PortalProposalsPage from './page'
import PortalProposalPage from './[proposalId]/page'

beforeEach(() => { vi.clearAllMocks(); h.access.mockResolvedValue({ userId: 'cv1', organisationId: 'o1', projectId: 'p1' }) })

describe('portal Proposals list (§9.4, D-18)', () => {
  it('lists issued proposals with status, client price and validity, linking to the detail', async () => {
    h.list.mockResolvedValue([{ proposalId: 'pr1', version: 2, state: 'viewed', issuedAt: '2026-09-29T08:00:00Z', expiresAt: '2026-10-29T08:00:00Z', title: 'Rooftop PV for Acme', offerExclVatZar: 1_150_000 }])
    render(await PortalProposalsPage({ params: Promise.resolve({ projectId: 'p1' }) }))
    expect(h.list).toHaveBeenCalledWith('p1', 'cv1')
    expect(screen.getByRole('link', { name: 'Rooftop PV for Acme' }).getAttribute('href')).toBe('/portal/p1/proposals/pr1')
    expect(screen.getByText('v2 · Viewed · R 1 150 000 excl. VAT · valid until 2026-10-29')).toBeTruthy()
  })
  it('empty state', async () => {
    h.list.mockResolvedValue([])
    render(await PortalProposalsPage({ params: Promise.resolve({ projectId: 'p1' }) }))
    expect(screen.getByText('No proposals have been issued to you on this project.')).toBeTruthy()
  })
  it('no portal access: not found, nothing loaded', async () => {
    h.access.mockResolvedValue(null)
    await expect(PortalProposalsPage({ params: Promise.resolve({ projectId: 'p1' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.list).not.toHaveBeenCalled()
  })
})

describe('portal Proposal detail', () => {
  const view = { state: 'viewed', version: 2, expiresAt: null, snapshot: null, issuer: null, response: null }
  it('renders the SAME client view as the token page, with server-stamped IP/UA and no storage path', async () => {
    h.one.mockResolvedValue({ view, pdfPath: 'org/p/x.pdf' })
    render(await PortalProposalPage({ params: Promise.resolve({ projectId: 'p1', proposalId: 'pr1' }) }))
    expect(h.one).toHaveBeenCalledWith('p1', 'cv1', 'pr1', { ip: '198.51.100.2', ua: 'ua/2' })
    expect(h.view).toHaveBeenCalledWith({ mode: { kind: 'portal', projectId: 'p1', proposalId: 'pr1' }, view })
    expect(JSON.stringify(h.view.mock.calls[0]![0])).not.toContain('pdf')
  })
  it('not found for another project’s or a draft proposal', async () => {
    h.one.mockResolvedValue({ view: { ...view, state: 'not_found' }, pdfPath: null })
    await expect(PortalProposalPage({ params: Promise.resolve({ projectId: 'p1', proposalId: 'x' }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('no portal access: not found before any lookup', async () => {
    h.access.mockResolvedValue(null)
    await expect(PortalProposalPage({ params: Promise.resolve({ projectId: 'p1', proposalId: 'pr1' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.one).not.toHaveBeenCalled()
  })
})
