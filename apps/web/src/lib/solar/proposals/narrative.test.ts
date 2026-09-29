import { describe, it, expect, vi, beforeEach } from 'vitest'
// The SDK is mocked at the module boundary: no test ever reaches the network.
const h = vi.hoisted(() => ({ create: vi.fn(), ctor: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation((opts: unknown) => { h.ctor(opts); return { messages: { create: h.create } } }),
}))
import {
  draftNarrative, narrativeAvailable, narrativeModel, narrativeStatus, NO_KEY_REASON, NARRATIVE_UNAVAILABLE, DEFAULT_NARRATIVE_MODEL,
} from './narrative'

const facts = { projectName: 'Acme Mall', clientName: 'Acme Retail', dcKwp: 500, acKw: 400, batteryKwh: null, year1Mwh: 845, solarSharePct: 58.1, offerExclVat: 'R 1 150 000.00', financeOptions: ['Cash purchase'] }

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.SOLAR_NARRATIVE_MODEL
})

describe('narrative (D-17, owner decision)', () => {
  it('is unavailable without a server key, with a JSON-safe reason for the page', () => {
    expect(narrativeAvailable()).toBe(false)
    expect(NO_KEY_REASON).toBe('The AI narrative is not configured on this server (no Anthropic API key).')
    expect(narrativeStatus()).toEqual({ narrativeAvailable: false, narrativeReason: NO_KEY_REASON })
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    expect(narrativeAvailable()).toBe(true)
    expect(narrativeStatus()).toEqual({ narrativeAvailable: true, narrativeReason: null })
    expect(JSON.parse(JSON.stringify(narrativeStatus()))).toEqual(narrativeStatus())
  })
  it('never calls the SDK without a key', async () => {
    await expect(draftNarrative(facts)).resolves.toEqual({ ok: false, error: NO_KEY_REASON })
    expect(h.create).not.toHaveBeenCalled()
  })
  it('model comes from SOLAR_NARRATIVE_MODEL, defaulting to claude-opus-5-5', () => {
    expect(DEFAULT_NARRATIVE_MODEL).toBe('claude-opus-5-5')
    expect(narrativeModel()).toBe('claude-opus-5-5')
    process.env.SOLAR_NARRATIVE_MODEL = 'claude-opus-5'
    expect(narrativeModel()).toBe('claude-opus-5')
  })
  it('calls messages.create server-side with only the facts, no fallbacks, and returns the trimmed text', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    h.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '  A 500 kWp system for Acme.  ' }] })
    await expect(draftNarrative(facts)).resolves.toEqual({ ok: true, text: 'A 500 kWp system for Acme.' })
    expect(h.ctor).toHaveBeenCalledWith({ apiKey: 'sk-test' })
    const req = h.create.mock.calls[0]![0] as Record<string, unknown> & { messages: Array<{ role: string; content: string }>; system: string }
    expect(req.model).toBe('claude-opus-5-5')
    expect(req.max_tokens).toBe(16000)
    expect(req.output_config).toEqual({ effort: 'medium' })
    expect(req).not.toHaveProperty('fallbacks')
    expect(req).not.toHaveProperty('betas')
    expect(req.system).toContain('Never invent a number')
    expect(req.messages).toHaveLength(1)
    expect(req.messages[0]!.role).toBe('user')
    expect(JSON.parse(req.messages[0]!.content)).toEqual(facts)
  })
  it('uses the env model on the request', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    process.env.SOLAR_NARRATIVE_MODEL = 'claude-opus-5'
    h.create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] })
    await draftNarrative(facts)
    expect((h.create.mock.calls[0]![0] as { model: string }).model).toBe('claude-opus-5')
  })
  it('a refusal, an API error, a thrown constructor or empty text all become the one named sentence', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    expect(NARRATIVE_UNAVAILABLE).toBe('Narrative unavailable — write it yourself')
    const unavailable = { ok: false, error: NARRATIVE_UNAVAILABLE }
    h.create.mockResolvedValueOnce({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, content: [{ type: 'text', text: 'partial' }] })
    await expect(draftNarrative(facts)).resolves.toEqual(unavailable)
    h.create.mockRejectedValueOnce(Object.assign(new Error('overloaded'), { status: 529 }))
    await expect(draftNarrative(facts)).resolves.toEqual(unavailable)
    h.create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: '   ' }] })
    await expect(draftNarrative(facts)).resolves.toEqual(unavailable)
    h.create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [] })
    await expect(draftNarrative(facts)).resolves.toEqual(unavailable)
    h.ctor.mockImplementationOnce(() => { throw new Error('bad config') })
    await expect(draftNarrative(facts)).resolves.toEqual(unavailable)
  })
})
