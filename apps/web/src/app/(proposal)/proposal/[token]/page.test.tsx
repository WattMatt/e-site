import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
const h = vi.hoisted(() => ({ load: vi.fn(), limit: vi.fn(() => true), view: vi.fn((p: unknown) => { void p; return null }) }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'agent/1' }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.limit }))
vi.mock('@/lib/solar/proposals/client', () => ({ loadProposalByToken: h.load }))
vi.mock('@/components/solar/proposal/ProposalClientView', () => ({ ProposalClientView: (p: unknown) => { h.view(p); return <p>client view</p> } }))
import ProposalTokenPage from './page'

const TOKEN = 'A'.repeat(43)
const view = { state: 'viewed', version: 1, expiresAt: null, snapshot: null, issuer: null, response: null }

beforeEach(() => { vi.clearAllMocks(); h.limit.mockReturnValue(true) })

describe('public proposal page (§9.4)', () => {
  it('looks the token up with server-stamped IP and user agent and renders ONLY the client view model', async () => {
    h.load.mockResolvedValue({ view, pdfPath: 'org/p/proposal.pdf', projectId: 'p1' })
    render(await ProposalTokenPage({ params: Promise.resolve({ token: TOKEN }) }))
    expect(h.load).toHaveBeenCalledWith(TOKEN, { ip: '203.0.113.7', ua: 'agent/1' })
    expect(h.view).toHaveBeenCalledWith({ mode: { kind: 'token', token: TOKEN }, view })
    // No storage path or project id reaches the browser.
    expect(JSON.stringify(h.view.mock.calls[0]![0])).not.toMatch(/pdfPath|org\/p|projectId/)
  })
  it('rate-limited per IP: no lookup, a sentence instead', async () => {
    h.limit.mockReturnValue(false)
    render(await ProposalTokenPage({ params: Promise.resolve({ token: TOKEN }) }))
    expect(h.load).not.toHaveBeenCalled()
    expect(screen.getByText('Too many requests — wait a minute and reload.')).toBeTruthy()
  })
})
