// apps/web/src/lib/whatsapp/channel.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processInbound, type ProcessorStore, type LinkRow, type InboundRow }
  from '../../../../edge-functions/supabase/functions/_shared/whatsapp/processor.ts'
import { CHANNEL } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/channel.ts'
import type { MetaClient } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/meta-client.ts'

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LINK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const KW = '11111111-1111-4111-8111-111111111111'
const FG = '22222222-2222-4222-8222-222222222222'
const ITEM = '33333333-3333-4333-8333-333333333333'
const POST = '44444444-4444-4444-8444-444444444444'
const PHONE = '+27821234567'
const NOW = new Date('2026-10-01T10:00:00Z')

const projects = [
  { id: KW, name: '(643) KINGSWALK', role: 'contractor' },
  { id: FG, name: '(649) PNP FAERIE GLEN', role: 'client_viewer' },
]

function link(over: Partial<LinkRow> = {}): LinkRow {
  return { id: LINK, user_id: USER, phone_e164: PHONE, status: 'active', active_item_id: null, active_item_at: null,
    pending_done_item_id: null, pending_done_at: null, pending_done_wants: null, pending_inbound_id: null,
    last_confirm_item_id: null, last_confirm_at: null, current_project_id: null, current_project_at: null, pending_post: null, ...over }
}
const row = (raw: Record<string, unknown>, id = 'in-1'): InboundRow =>
  ({ id, meta_message_id: 'wamid.' + id, from_e164: PHONE, attempts: 1,
     raw: { id: 'wamid.' + id, from: '27821234567', timestamp: '1', contextId: null, text: null, payload: null, imageId: null, imageMime: null, type: 'text', ...raw } })

let store: ProcessorStore & { calls: Array<[string, Record<string, unknown>]>; patches: Array<Record<string, unknown>> }
let meta: MetaClient & { sent: Array<{ kind: string; body: string; extra?: unknown }> }
let rpc: Record<string, unknown>
let current: LinkRow
const held: Record<string, InboundRow> = {}

beforeEach(() => {
  rpc = { wa_my_projects: projects }
  current = link()
  const calls: Array<[string, Record<string, unknown>]> = []
  const patches: Array<Record<string, unknown>> = []
  store = {
    calls, patches,
    linkByPhone: vi.fn(async () => current),
    updateLink: vi.fn(async (_id, p) => { patches.push(p); current = { ...current, ...p } as LinkRow }),
    itemForSentMessage: vi.fn(async () => null),
    itemInfo: vi.fn(async () => null),
    call: vi.fn(async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return (rpc[fn] as unknown) ?? { code: 'ok', id: 'E1', ref: 'TASK-9', organisation_id: 'O', assignee_name: 'Arno' } }),
    upload: vi.fn(async () => {}),
    unknownSenderRecentlyAnswered: vi.fn(async () => false),
    inboundById: vi.fn(async (id: string) => held[id] ?? null),
    markInbound: vi.fn(async () => {}),
  } as never
  const sent: Array<{ kind: string; body: string; extra?: unknown }> = []
  meta = {
    sent,
    sendTemplate: vi.fn(),
    sendText: vi.fn(async (_to: string, body: string) => { sent.push({ kind: 'text', body }); return 'o' }),
    sendButtons: vi.fn(async (_to: string, body: string, b: unknown) => { sent.push({ kind: 'buttons', body, extra: b }); return 'o' }),
    sendList: vi.fn(async (_to: string, body: string, _l: string, rows: unknown) => { sent.push({ kind: 'list', body, extra: rows }); return 'o' }),
    fetchMedia: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' })),
  } as never
})
const deps = () => ({ store, meta, now: () => NOW, appUrl: 'https://www.e-site.live' })
const ids = (i: number) => (meta.sent[i].extra as Array<{ id: string }>).map((r) => r.id)

describe('menu and projects', () => {
  it('"menu" with no current project lists the user\'s projects', async () => {
    await processInbound(row({ text: 'menu' }), deps())
    expect(meta.sent[0].kind).toBe('list')
    expect(ids(0)).toEqual([`proj:${KW}`, `proj:${FG}`])
  })
  it('typing a project name switches and shows the menu', async () => {
    await processInbound(row({ text: 'Kingswalk' }), deps())
    expect(store.patches[0]).toMatchObject({ current_project_id: KW })
    const menu = meta.sent.find((s) => s.kind === 'list')!
    expect((menu.extra as Array<{ id: string }>).map((r) => r.id)).toEqual(['menu:mine', 'menu:project', 'menu:post', 'menu:switch'])
  })
  it('a partial name is confirmed, never switched silently', async () => {
    rpc.wa_my_projects = [...projects, { id: POST, name: 'FAERIE GLEN EXT', role: 'contractor' }]
    await processInbound(row({ text: 'faerie' }), deps())
    expect(store.patches).toEqual([])
    expect(ids(0)).toEqual([`proj:${FG}`, `proj:${POST}`])
  })
  it('a client viewer\'s menu has no Post row', async () => {
    current = link({ current_project_id: FG })
    await processInbound(row({ text: 'menu' }), deps())
    expect(ids(0)).toEqual(['menu:mine', 'menu:project', 'menu:switch'])
  })
  it('picking a project from the list switches to it', async () => {
    await processInbound(row({ type: 'interactive', payload: `proj:${KW}` }), deps())
    expect(store.patches[0]).toMatchObject({ current_project_id: KW })
  })
  it('a project the user is not on is refused, even with a forged payload', async () => {
    await processInbound(row({ type: 'interactive', payload: `proj:${POST}` }), deps())
    expect(store.patches).toEqual([])
    expect(meta.sent[0].body).toBe(CHANNEL.notYourProject)
  })
})

describe('items', () => {
  it('My open items lists item rows for the current project', async () => {
    current = link({ current_project_id: KW })
    rpc.wa_project_items = [{ id: ITEM, ref: 'TASK-4', title: 'Loose cover', due_date: '2026-10-03', status: 'open' }]
    await processInbound(row({ type: 'interactive', payload: 'menu:mine' }), deps())
    expect(store.calls.find((c) => c[0] === 'wa_project_items')![1]).toEqual({ p_user: USER, p_project: KW, p_scope: 'mine' })
    expect(ids(0)).toEqual([`item:${ITEM}`])
  })
  it('an empty list says so', async () => {
    current = link({ current_project_id: KW })
    rpc.wa_project_items = []
    await processInbound(row({ type: 'interactive', payload: 'menu:project' }), deps())
    expect(meta.sent[0].body).toBe(CHANNEL.nothingOpen('(643) KINGSWALK'))
  })
  it('choosing an item re-sends its card with the three buttons and makes it active', async () => {
    rpc.wa_item_card = { code: 'ok', id: ITEM, ref: 'TASK-4', title: 'Loose cover', due_date: '2026-10-03', status: 'open', project_id: KW, project_name: '(643) KINGSWALK' }
    await processInbound(row({ type: 'interactive', payload: `item:${ITEM}` }), deps())
    expect(meta.sent[0].kind).toBe('buttons')
    expect((meta.sent[0].extra as Array<{ id: string }>).map((b) => b.id)).toEqual([`ack:${ITEM}`, `done:${ITEM}`, `open:${ITEM}`])
    expect(store.patches[0]).toMatchObject({ active_item_id: ITEM, current_project_id: KW })
  })
  it('a card the user cannot see is refused (RLS said no)', async () => {
    rpc.wa_item_card = { code: 'not_found' }
    await processInbound(row({ type: 'interactive', payload: `item:${ITEM}` }), deps())
    expect(meta.sent[0].body).toBe(CHANNEL.itemGone)
  })
  it('Open replies with the /wa link', async () => {
    await processInbound(row({ type: 'interactive', payload: `open:${ITEM}` }), deps())
    expect(meta.sent[0].body).toBe(`https://www.e-site.live/wa/${ITEM}`)
  })
})
