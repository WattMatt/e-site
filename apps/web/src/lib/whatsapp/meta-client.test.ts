// apps/web/src/lib/whatsapp/meta-client.test.ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createMetaClient, classifyMetaError, MetaError } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/meta-client.ts'

function fakeFetch(responses: Array<{ status: number; json?: unknown; bytes?: Uint8Array; type?: string }>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const r = responses.shift()!
    return new Response((r.bytes as BodyInit | undefined) ?? JSON.stringify(r.json ?? {}), { status: r.status, headers: { 'content-type': r.type ?? 'application/json' } })
  })
  return { fn, calls }
}

describe('createMetaClient', () => {
  it('sends a template with body params and buttons, stripping the plus', async () => {
    const f = fakeFetch([{ status: 200, json: { messages: [{ id: 'wamid.OUT' }] } }])
    const c = createMetaClient({ token: 'T', phoneNumberId: 'P', fetchImpl: f.fn as unknown as typeof fetch })
    const id = await c.sendTemplate('+27821234567', 'esite_item_assigned', ['T-1', 'KINGSWALK', 'Fix it', 'Fri 3 Oct'],
      [{ type: 'quick_reply', index: 0, payload: 'ack:x' }, { type: 'url', index: 2, suffix: 'abc' }])
    expect(id).toBe('wamid.OUT')
    expect(f.calls[0].url).toBe('https://graph.facebook.com/v23.0/P/messages')
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer T')
    const sent = JSON.parse(String(f.calls[0].init.body))
    expect(sent.to).toBe('27821234567')
    expect(sent.template.name).toBe('esite_item_assigned')
    expect(sent.template.components[0]).toEqual({ type: 'body', parameters: [
      { type: 'text', text: 'T-1' }, { type: 'text', text: 'KINGSWALK' }, { type: 'text', text: 'Fix it' }, { type: 'text', text: 'Fri 3 Oct' }] })
    expect(sent.template.components[1]).toEqual({ type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'ack:x' }] })
    expect(sent.template.components[2]).toEqual({ type: 'button', sub_type: 'url', index: '2', parameters: [{ type: 'text', text: 'abc' }] })
  })

  it('sends reply buttons threaded to the inbound message, titles clipped to 20', async () => {
    const f = fakeFetch([{ status: 200, json: { messages: [{ id: 'm' }] } }])
    const c = createMetaClient({ token: 'T', phoneNumberId: 'P', fetchImpl: f.fn as unknown as typeof fetch })
    await c.sendButtons('+27821234567', 'Attached', [{ id: 'wrong:note:x', title: 'Wrong item — undo this now' }], 'wamid.IN')
    const sent = JSON.parse(String(f.calls[0].init.body))
    expect(sent.context).toEqual({ message_id: 'wamid.IN' })
    expect(sent.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20)
  })

  it('throws a classified MetaError', async () => {
    const f = fakeFetch([{ status: 400, json: { error: { code: 131026, message: 'undeliverable' } } }])
    const c = createMetaClient({ token: 'T', phoneNumberId: 'P', fetchImpl: f.fn as unknown as typeof fetch })
    await expect(c.sendText('+27821234567', 'hi')).rejects.toMatchObject({ code: 131026, klass: 'recipient' })
  })

  it('fetches media in two hops with the bearer token', async () => {
    const f = fakeFetch([
      { status: 200, json: { url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/jpeg', file_size: 3 } },
      { status: 200, bytes: new Uint8Array([1, 2, 3]), type: 'image/jpeg' },
    ])
    const c = createMetaClient({ token: 'T', phoneNumberId: 'P', fetchImpl: f.fn as unknown as typeof fetch })
    const media = await c.fetchMedia('MEDIA')
    expect(f.calls[0].url).toBe('https://graph.facebook.com/v23.0/MEDIA')
    expect((f.calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer T')
    expect(Array.from(media.bytes)).toEqual([1, 2, 3])
    expect(media.mime).toBe('image/jpeg')
  })

  it('refuses media over 16 MB before downloading', async () => {
    const f = fakeFetch([{ status: 200, json: { url: 'u', mime_type: 'image/jpeg', file_size: 17 * 1024 * 1024 } }])
    const c = createMetaClient({ token: 'T', phoneNumberId: 'P', fetchImpl: f.fn as unknown as typeof fetch })
    await expect(c.fetchMedia('MEDIA')).rejects.toBeInstanceOf(MetaError)
    expect(f.calls).toHaveLength(1)
  })
})

describe('classifyMetaError', () => {
  it.each([
    [131026, 400, 'recipient'], [131047, 400, 'recipient'], [131051, 400, 'recipient'],
    [132001, 400, 'policy'], [132015, 400, 'policy'], [368, 400, 'policy'], [190, 401, 'policy'],
    [130429, 429, 'transient'], [131056, 400, 'transient'], [131000, 500, 'transient'], [0, 503, 'transient'],
  ])('%i/%i -> %s', (code, status, klass) => expect(classifyMetaError(code, status)).toBe(klass))
})
