import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ push: vi.fn(), assign: vi.fn(), fetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: h.push }) }))

import { SubscribeButton } from './SubscribeButton'
import { solarSubscribeBodySchema } from '@/lib/paystack/solar-subscribe-body'

const originalLocation = window.location
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', h.fetch)
  Object.defineProperty(window, 'location', { configurable: true, value: { assign: h.assign } })
})
afterAll(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

describe('SubscribeButton', () => {
  it('POSTs a body the 1B route ACCEPTS (its own schema) and follows authorization_url', async () => {
    const PID = '7c1f4a8e-2b3d-4e5f-9a6b-1c2d3e4f5a6b'
    h.fetch.mockResolvedValue(json(200, { authorization_url: 'https://checkout.paystack.com/abc' }))
    render(<SubscribeButton projectId={PID} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
    const [url, init] = h.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/paystack/solar-subscribe')
    expect(init.method).toBe('POST')
    // Checked against the schema the route itself parses with — a body the
    // button and the route disagree on can no longer pass (review C1: the
    // first cut sent {projectId} and the route 400'd every press).
    const parsed = solarSubscribeBodySchema.safeParse(JSON.parse(String(init.body)))
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.project_id).toBe(PID)
    expect(h.assign).toHaveBeenCalledWith('https://checkout.paystack.com/abc')
  })

  it('403 (not owner/admin, or project not visible — one message) shows the route’s sentence', async () => {
    h.fetch.mockResolvedValue(json(403, { error: 'Only an organisation owner or admin can subscribe.' }))
    render(<SubscribeButton projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Only an organisation owner or admin can subscribe.')
  })

  it('403 without a body falls back to a fixed sentence', async () => {
    h.fetch.mockResolvedValue(json(403, {}))
    render(<SubscribeButton projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Only an organisation owner or admin can subscribe.')
  })

  it('503 (plan not configured) → "Solar can’t be purchased yet — ask E-Site support"', async () => {
    h.fetch.mockResolvedValue(json(503, { error: 'Solar subscription plan not configured' }))
    render(<SubscribeButton projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
    expect((await screen.findByRole('alert')).textContent).toBe("Solar can't be purchased yet — ask E-Site support")
  })

  it('429 → wait and try again', async () => {
    h.fetch.mockResolvedValue(json(429, {}))
    render(<SubscribeButton projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Too many attempts — wait a minute and try again.')
  })

  it('409 already subscribed → straight to the Overview', async () => {
    h.fetch.mockResolvedValue(json(409, { error: 'Solar is already active for this organisation.' }))
    render(<SubscribeButton projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/overview')
  })

  it('anything else → "Payment could not start — try again."', async () => {
    h.fetch.mockResolvedValue(json(500, {}))
    render(<SubscribeButton projectId="p1" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Subscribe' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Payment could not start — try again.')
  })
})
