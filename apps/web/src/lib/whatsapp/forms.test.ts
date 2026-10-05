// apps/web/src/lib/whatsapp/forms.test.ts
// @vitest-environment node
//
// Inspection forms over WhatsApp, edge side (E4): the processor routes menu rows, Flow replies,
// photos and SUBMIT to the web app's form service and relays what it says. It decides nothing
// about access or the form itself.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processInbound, type ProcessorStore, type LinkRow, type InboundRow }
  from '../../../../edge-functions/supabase/functions/_shared/whatsapp/processor.ts'
import type { MetaClient } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/meta-client.ts'
import { FORMS, type FormsClient, type FormsReply } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/forms.ts'

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LINK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const KW = '11111111-1111-4111-8111-111111111111'
const INSP = '55555555-5555-4555-8555-555555555555'
const SESS = '66666666-6666-4666-8666-666666666666'
const PHONE = '+27821234567'
const NOW = new Date('2026-10-05T10:00:00Z')
const MIN = 60_000

function link(over: Partial<LinkRow> = {}): LinkRow {
  return { id: LINK, user_id: USER, phone_e164: PHONE, status: 'active', active_item_id: null, active_item_at: null,
    pending_done_item_id: null, pending_done_at: null, pending_done_wants: null, pending_inbound_id: null,
    last_confirm_item_id: null, last_confirm_at: null, current_project_id: KW, current_project_at: null, pending_post: null,
    current_form_session_id: null, current_form_session_at: null, ...over }
}
const row = (raw: Record<string, unknown>, id = 'in-1'): InboundRow =>
  ({ id, meta_message_id: 'wamid.' + id, from_e164: PHONE, attempts: 1,
     raw: { id: 'wamid.' + id, from: '27821234567', timestamp: '1', contextId: null, text: null, payload: null,
            imageId: null, imageMime: null, flowResponseJson: null, type: 'text', ...raw } })

let store: ProcessorStore & { calls: Array<[string, Record<string, unknown>]>; patches: Array<Record<string, unknown>>; uploads: unknown[] }
let meta: MetaClient & { sent: Array<{ kind: string; body: string; extra?: unknown }> }
let forms: FormsClient & { ops: Array<[string, Record<string, unknown>]> }
let reply: FormsReply
let rpc: Record<string, unknown>
let current: LinkRow
let media: Uint8Array

beforeEach(() => {
  rpc = {
    wa_my_projects: [{ id: KW, name: '(643) KINGSWALK', role: 'contractor' }],
    wa_my_inspections: [{ id: INSP, label: 'MINIATURE SUBSTATION 1', template_name: 'Miniature Substation Inspection Report', mine: true }],
    wa_open_items: [],
  }
  current = link()
  media = new Uint8Array([0xff, 0xd8, 0xff])
  reply = { code: 'ok', messages: [{ type: 'text', body: 'from web' }] }
  const calls: Array<[string, Record<string, unknown>]> = []
  const patches: Array<Record<string, unknown>> = []
  const uploads: unknown[] = []
  store = {
    calls, patches, uploads,
    linkByPhone: vi.fn(async () => current),
    updateLink: vi.fn(async (_id, p) => { patches.push(p); current = { ...current, ...p } as LinkRow }),
    itemForSentMessage: vi.fn(async () => null),
    itemInfo: vi.fn(async () => null),
    call: vi.fn(async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return rpc[fn] ?? { code: 'ok' } }),
    upload: vi.fn(async (bucket: string, path: string, bytes: Uint8Array, mime: string) => { uploads.push({ bucket, path, size: bytes.length, mime }) }),
    unknownSenderRecentlyAnswered: vi.fn(async () => false),
    inboundById: vi.fn(async () => null),
    markInbound: vi.fn(async () => {}),
  } as never
  const sent: Array<{ kind: string; body: string; extra?: unknown }> = []
  meta = {
    sent,
    sendTemplate: vi.fn(),
    sendText: vi.fn(async (_to: string, body: string) => { sent.push({ kind: 'text', body }); return 'o' }),
    sendButtons: vi.fn(async (_to: string, body: string, b: unknown) => { sent.push({ kind: 'buttons', body, extra: b }); return 'o' }),
    sendList: vi.fn(async (_to: string, body: string, _l: string, rows: unknown, section?: string) => { sent.push({ kind: 'list', body, extra: { rows, section } }); return 'o' }),
    sendFlow: vi.fn(async (_to: string, f: { body: string }) => { sent.push({ kind: 'flow', body: f.body, extra: f }); return 'wamid.flow' }),
    sendDocument: vi.fn(),
    uploadMedia: vi.fn(),
    fetchMedia: vi.fn(async () => ({ bytes: media, mime: 'image/jpeg' })),
  } as never
  const ops: Array<[string, Record<string, unknown>]> = []
  forms = { ops, call: vi.fn(async (op: string, body: Record<string, unknown>) => { ops.push([op, body]); return reply }) } as never
})
const deps = (withForms = true) => ({ store, meta, now: () => NOW, appUrl: 'https://www.e-site.live', ...(withForms ? { forms } : {}) })
const rowIds = (i: number) => ((meta.sent[i].extra as { rows: Array<{ id: string }> }).rows ?? meta.sent[i].extra as never).map((r: { id: string }) => r.id)

describe('the Inspections menu row', () => {
  it('appears when the member has a writable inspection on the current project', async () => {
    await processInbound(row({ text: 'menu' }), deps())
    expect(rowIds(0)).toEqual(['menu:mine', 'menu:project', 'menu:post', 'menu:forms', 'menu:switch'])
    expect(store.calls).toContainEqual(['wa_my_inspections', { p_user: USER, p_project: KW }])
  })
  it('is absent when the database lists none (flag off, no access, nothing open)', async () => {
    rpc.wa_my_inspections = []
    await processInbound(row({ text: 'menu' }), deps())
    expect(rowIds(0)).not.toContain('menu:forms')
  })
  it('is absent, and nothing is asked, when the forms service is not configured', async () => {
    await processInbound(row({ text: 'menu' }), deps(false))
    expect(rowIds(0)).not.toContain('menu:forms')
    expect(store.calls.map((c) => c[0])).not.toContain('wa_my_inspections')
  })
  it('lists the inspections as insp: rows under an Inspections section', async () => {
    await processInbound(row({ type: 'interactive', payload: 'menu:forms' }), deps())
    expect(meta.sent[0].kind).toBe('list')
    expect(meta.sent[0].extra).toMatchObject({ section: 'Inspections', rows: [{ id: `insp:${INSP}`, title: 'MINIATURE SUBSTATION 1' }] })
  })
  it('says so when there is nothing to fill in', async () => {
    rpc.wa_my_inspections = []
    await processInbound(row({ type: 'interactive', payload: 'menu:forms' }), deps())
    expect(meta.sent[0]).toMatchObject({ kind: 'text', body: FORMS.noneOpen('(643) KINGSWALK') })
  })
})

describe('opening an inspection', () => {
  it('asks the web app, relays the Flow and remembers the session', async () => {
    reply = { code: 'ok', session_id: SESS, messages: [{ type: 'flow', flowId: '9', token: 'tok', cta: 'Open the form',
      body: 'MINIATURE SUBSTATION 1', mode: 'draft', firstScreen: 'SECTION_A' }] }
    await processInbound(row({ type: 'interactive', payload: `insp:${INSP}` }), deps())
    expect(forms.ops).toEqual([['open', { user_id: USER, link_id: LINK, inspection_id: INSP }]])
    expect(meta.sent[0]).toMatchObject({ kind: 'flow', extra: { flowId: '9', token: 'tok', mode: 'draft', firstScreen: 'SECTION_A' } })
    expect(current.current_form_session_id).toBe(SESS)
    expect(current.current_form_session_at).toBe(NOW.toISOString())
  })
  it('relays a refusal as text and keeps no session', async () => {
    reply = { code: 'no_access', messages: [{ type: 'text', body: 'not yours' }] }
    await processInbound(row({ type: 'interactive', payload: `insp:${INSP}` }), deps())
    expect(meta.sent).toEqual([{ kind: 'text', body: 'not yours' }])
    expect(current.current_form_session_id).toBeNull()
  })
})

describe('a completed Flow', () => {
  it('goes to the web app verbatim with the inbound id, whatever the link points at', async () => {
    await processInbound(row({ type: 'interactive', flowResponseJson: '{"flow_token":"tok","s0_f0":"pass"}' }, 'in-9'), deps())
    expect(forms.ops).toEqual([['flow_reply', { user_id: USER, link_id: LINK, inbound_id: 'in-9', response_json: '{"flow_token":"tok","s0_f0":"pass"}' }]])
    expect(meta.sent).toEqual([{ kind: 'text', body: 'from web' }])
  })
  it('without a forms service it is declined, not mistaken for an item reply', async () => {
    const r = await processInbound(row({ type: 'interactive', flowResponseJson: '{}' }), deps(false))
    expect(r.outcome).toBe('refused')
    expect(store.calls.map((c) => c[0])).not.toContain('wa_open_items')
  })
})

describe('photos for a form', () => {
  const live = () => link({ current_form_session_id: SESS, current_form_session_at: new Date(NOW.getTime() - 5 * MIN).toISOString() })

  it('a numbered photo is copied to Storage at once, then attached by the web app', async () => {
    current = live()
    await processInbound(row({ type: 'image', imageId: 'MEDIA', imageMime: 'image/jpeg', text: 'item 10' }, 'in-7'), deps())
    expect(meta.fetchMedia).toHaveBeenCalledWith('MEDIA')
    expect(store.uploads).toEqual([{ bucket: 'whatsapp-media', path: 'inbound/in-7', size: 3, mime: 'image/jpeg' }])
    expect(forms.ops).toEqual([['photo', { user_id: USER, link_id: LINK, session_id: SESS, inbound_id: 'in-7',
      staging_path: 'inbound/in-7', caption: 'item 10' }]])
  })
  it('a numbered photo still reaches an older session (the number says what it is for)', async () => {
    current = link({ current_form_session_id: SESS, current_form_session_at: new Date(NOW.getTime() - 5 * 3600_000).toISOString() })
    await processInbound(row({ type: 'image', imageId: 'MEDIA', text: '10' }), deps())
    expect(forms.ops.map((o) => o[0])).toEqual(['photo'])
  })
  it('an unnumbered photo goes to the form only while it is active', async () => {
    current = link({ current_form_session_id: SESS, current_form_session_at: new Date(NOW.getTime() - 31 * MIN).toISOString() })
    await processInbound(row({ type: 'image', imageId: 'MEDIA' }), deps())
    expect(forms.ops).toEqual([])
  })
  it('refuses a photo over 5 MB without storing it', async () => {
    current = live()
    media = new Uint8Array(5 * 1024 * 1024 + 1)
    const r = await processInbound(row({ type: 'image', imageId: 'MEDIA', text: '10' }), deps())
    expect(r).toMatchObject({ outcome: 'refused', reason: 'photo_too_large' })
    expect(store.uploads).toEqual([])
    expect(forms.ops).toEqual([])
    expect(meta.sent[0].body).toBe(FORMS.photoTooLarge)
  })
  it('a session the web app no longer recognises is forgotten and the photo falls through', async () => {
    current = live()
    reply = { code: 'no_session', messages: [] }
    await processInbound(row({ type: 'image', imageId: 'MEDIA', text: '10' }), deps())
    expect(current.current_form_session_id).toBeNull()
    expect(store.calls.map((c) => c[0])).toContain('wa_open_items')
  })
  it('a bare number after a held photo is sent as the item choice', async () => {
    current = live()
    await processInbound(row({ text: '10' }), deps())
    expect(forms.ops).toEqual([['item_choice', { user_id: USER, link_id: LINK, session_id: SESS, inbound_id: 'in-1', text: '10' }]])
  })
  it('a bare number with no photo waiting falls through', async () => {
    current = live()
    reply = { code: 'not_waiting', messages: [] }
    await processInbound(row({ text: '10' }), deps())
    expect(meta.sent.every((s) => s.body !== 'from web')).toBe(true)
  })
})

describe('SUBMIT', () => {
  it('typed while a form is open submits it', async () => {
    current = link({ current_form_session_id: SESS, current_form_session_at: NOW.toISOString() })
    await processInbound(row({ text: 'Submit' }), deps())
    expect(forms.ops).toEqual([['submit', { user_id: USER, link_id: LINK, session_id: SESS }]])
  })
  it('the Submit button names its own session', async () => {
    await processInbound(row({ type: 'interactive', payload: `fsubmit:${SESS}` }), deps())
    expect(forms.ops).toEqual([['submit', { user_id: USER, link_id: LINK, session_id: SESS }]])
  })
  it('typed with no form open is ordinary text', async () => {
    await processInbound(row({ text: 'submit' }), deps())
    expect(forms.ops).toEqual([])
  })
})

import { createFormsClient, FORMS_PATH, SIGNATURE_HEADER } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/forms-client.ts'
import { verifyInternal } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/core.ts'

describe('createFormsClient', () => {
  it('is off without a secret', () => {
    expect(createFormsClient({ appUrl: 'https://x', secret: '' })).toBeUndefined()
  })
  it('signs the exact body it sends, and the web side can verify it', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const f = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ code: 'ok', messages: [] }), { status: 200 })
    })
    const c = createFormsClient({ appUrl: 'https://www.e-site.live/', secret: 'S', fetchImpl: f as unknown as typeof fetch, now: () => NOW })!
    const r = await c.call('submit', { user_id: USER, session_id: SESS })
    expect(r.code).toBe('ok')
    expect(calls[0].url).toBe(`https://www.e-site.live${FORMS_PATH}`)
    const body = String(calls[0].init.body)
    expect(JSON.parse(body)).toEqual({ op: 'submit', user_id: USER, session_id: SESS })
    const sig = (calls[0].init.headers as Record<string, string>)[SIGNATURE_HEADER]
    expect(await verifyInternal('S', sig, body, Math.floor(NOW.getTime() / 1000))).toBe(true)
  })
  it('throws on a non-2xx so the message is retried, never half-handled', async () => {
    const f = vi.fn(async () => new Response('nope', { status: 500 }))
    const c = createFormsClient({ appUrl: 'https://x', secret: 'S', fetchImpl: f as unknown as typeof fetch })!
    await expect(c.call('open', {})).rejects.toThrow(/HTTP 500/)
  })
})

describe('review fixes (edge routing)', () => {
  const ITEM = '77777777-7777-4777-8777-777777777777'
  const recent = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString()

  it('H2: a photo sent as a reply to a work-item card goes to the item, not the form', async () => {
    current = link({ current_form_session_id: SESS, current_form_session_at: recent(5) })
    ;(store.itemForSentMessage as ReturnType<typeof vi.fn>).mockResolvedValue(ITEM)
    await processInbound(row({ type: 'image', imageId: 'MEDIA', contextId: 'wamid.card' }), deps())
    expect(forms.ops).toEqual([])
  })
  it('H2: an unnumbered photo after acknowledging an item (newer than the form) goes to the item', async () => {
    current = link({ current_form_session_id: SESS, current_form_session_at: recent(10), active_item_id: ITEM, active_item_at: recent(1) })
    await processInbound(row({ type: 'image', imageId: 'MEDIA' }), deps())
    expect(forms.ops).toEqual([])
  })
  it('H2: a numbered photo still goes to the form even right after an item', async () => {
    current = link({ current_form_session_id: SESS, current_form_session_at: recent(10), active_item_id: ITEM, active_item_at: recent(1) })
    await processInbound(row({ type: 'image', imageId: 'MEDIA', text: '10' }), deps())
    expect(forms.ops.map((o) => o[0])).toEqual(['photo'])
  })
  it('H2: a "not mine" answer does not keep the form window open', async () => {
    current = link({ current_form_session_id: SESS, current_form_session_at: recent(5) })
    reply = { code: 'not_waiting', messages: [] }
    await processInbound(row({ text: '10' }), deps())
    expect(current.current_form_session_at).toBe(recent(5))
  })
  it('M2: tapping Submit on an OLD session does not forget the live one', async () => {
    const OLD = '88888888-8888-4888-8888-888888888888'
    current = link({ current_form_session_id: SESS, current_form_session_at: recent(5) })
    reply = { code: 'no_session', messages: [], session_id: null }
    await processInbound(row({ type: 'interactive', payload: `fsubmit:${OLD}` }), deps())
    expect(current.current_form_session_id).toBe(SESS)
  })
  it('M2: submitting the live session does clear it', async () => {
    current = link({ current_form_session_id: SESS, current_form_session_at: recent(5) })
    reply = { code: 'ok', messages: [{ type: 'text', body: 'done' }], session_id: null }
    await processInbound(row({ type: 'interactive', payload: `fsubmit:${SESS}` }), deps())
    expect(current.current_form_session_id).toBeNull()
  })
  it('LOW: SUBMIT on a form that has gone says so instead of becoming a note', async () => {
    current = link({ current_form_session_id: SESS, current_form_session_at: recent(5) })
    reply = { code: 'no_session', messages: [] }
    const r = await processInbound(row({ text: 'submit' }), deps())
    expect(meta.sent.map((s) => s.body)).toContain(FORMS.noOpenForm)
    expect(r.reason).toBe('form_submit:no_session')
  })
})
