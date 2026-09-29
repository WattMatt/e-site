import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ load: vi.fn(), sign: vi.fn(async () => 'https://signed.example/x'), rateLimit: vi.fn(() => true) }))
vi.mock('@/lib/solar/proposals/client', () => ({ loadProposalByToken: h.load, signedProposalPdfUrl: h.sign }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: h.rateLimit }))
import { POST } from './route'

const TOKEN = 'A'.repeat(43)
const req = (b: unknown, headers: Record<string, string> = {}) => new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) })
beforeEach(() => vi.clearAllMocks())

describe('POST /api/solar/proposal-download', () => {
  it('returns a 7-day signed URL for a readable proposal, stamping ip/ua from headers', async () => {
    h.load.mockResolvedValue({ view: { state: 'accepted', version: 2 }, pdfPath: 'o/p/x.pdf', projectId: 'p' })
    const r = await POST(req({ token: TOKEN }, { 'x-real-ip': '198.51.100.1', 'user-agent': 'ua' }))
    await expect(r.json()).resolves.toEqual({ url: 'https://signed.example/x' })
    expect(h.load).toHaveBeenCalledWith(TOKEN, { ip: '198.51.100.1', ua: 'ua' })
    expect(h.sign).toHaveBeenCalledWith('o/p/x.pdf', 2)
  })
  it('410 for an expired or withdrawn proposal (no URL)', async () => {
    h.load.mockResolvedValue({ view: { state: 'withdrawn', version: 2 }, pdfPath: null, projectId: null })
    expect((await POST(req({ token: TOKEN }))).status).toBe(410)
    expect(h.sign).not.toHaveBeenCalled()
  })
  it('400 for a non-token string without a lookup; 429 when rate-limited', async () => {
    expect((await POST(req({ token: 'f'.repeat(64) }))).status).toBe(400)
    expect(h.load).not.toHaveBeenCalled()
    h.rateLimit.mockReturnValueOnce(false)
    expect((await POST(req({ token: TOKEN }))).status).toBe(429)
  })
})
