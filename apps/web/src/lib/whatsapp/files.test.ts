// apps/web/src/lib/whatsapp/files.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processInbound, type ProcessorStore, type LinkRow, type InboundRow }
  from '../../../../edge-functions/supabase/functions/_shared/whatsapp/processor.ts'
import { FILES, MAX_SEND_BYTES, type ReportsClient } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/files.ts'
import { encodePayload, decodePayload } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/core.ts'
import type { MetaClient } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/meta-client.ts'

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LINK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const KW = '11111111-1111-4111-8111-111111111111'
const PLAN = '55555555-5555-4555-8555-555555555555'
const DOC = '66666666-6666-4666-8666-666666666666'
const REP = '77777777-7777-4777-8777-777777777777'
const PHONE = '+27821234567'
const NOW = new Date('2026-10-06T10:00:00Z')

function link(over: Partial<LinkRow> = {}): LinkRow {
  return { id: LINK, user_id: USER, phone_e164: PHONE, status: 'active', active_item_id: null, active_item_at: null,
    pending_done_item_id: null, pending_done_at: null, pending_done_wants: null, pending_inbound_id: null,
    last_confirm_item_id: null, last_confirm_at: null, current_project_id: KW, current_project_at: NOW.toISOString(),
    pending_post: null, pending_search_at: null, ...over }
}
const row = (raw: Record<string, unknown>): InboundRow =>
  ({ id: 'in-1', meta_message_id: 'wamid.1', from_e164: PHONE, attempts: 1,
     raw: { id: 'wamid.1', from: '27821234567', timestamp: '1', contextId: null, text: null, payload: null, imageId: null, imageMime: null, type: 'text', ...raw } })
const tap = (payload: string) => row({ type: 'interactive', payload })

let rpc: Record<string, unknown>
let current: LinkRow
let calls: Array<[string, Record<string, unknown>]>
let store: ProcessorStore
let meta: MetaClient & { sent: Array<{ kind: string; body: string; extra?: unknown }> }
let reports: ReportsClient | undefined

beforeEach(() => {
  current = link()
  calls = []
  rpc = {
    wa_my_projects: [{ id: KW, name: '(643) KINGSWALK', role: 'contractor' }],
    wa_project_files: [
      { kind: 'p', id: PLAN, name: '643.E.101 - POWER LAYOUT GROUND FLOOR - REV. 3', sub: 'Ground' },
      { kind: 'd', id: DOC, name: 'Kiosk 1 test cert', sub: 'Handover' },
    ],
    wa_file: { code: 'ok', bucket: 'drawings', path: 'o/p/x.pdf', name: '643.E.101 - POWER LAYOUT', mime: 'application/pdf', project_id: KW },
    wa_report: { code: 'ok', bucket: 'reports', path: 'o/p/r.pdf', name: 'Tenant schedule', mime: 'application/pdf', version: 2 },
    wa_project_reports: { reports: [{ id: REP, kind: 'tenant_schedule', title: 'Tenant schedule', version: 2 }], cable_schedule: true },
  }
  store = {
    linkByPhone: vi.fn(async () => current),
    updateLink: vi.fn(async (_id, p) => { current = { ...current, ...p } as LinkRow }),
    itemForSentMessage: vi.fn(async () => null),
    itemInfo: vi.fn(async () => null),
    call: vi.fn(async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return rpc[fn] ?? null }),
    upload: vi.fn(async () => {}),
    download: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
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
    sendList: vi.fn(async (_to: string, body: string, _l: string, rows: unknown) => { sent.push({ kind: 'list', body, extra: rows }); return 'o' }),
    fetchMedia: vi.fn(),
    uploadMedia: vi.fn(async () => 'media-1'),
    sendDocument: vi.fn(async (_to: string, _m: string, filename: string) => { sent.push({ kind: 'document', body: filename }); return 'o' }),
  } as never
  reports = { cableSchedule: vi.fn(async () => ({ code: 'ok' as const, filename: 'KINGSWALK-cable-schedule.pdf', bytes: new Uint8Array([1]) })) }
})
const deps = () => ({ store, meta, now: () => NOW, appUrl: 'https://www.e-site.live', reports })
const rows = (i: number) => meta.sent[i].extra as Array<{ id: string; title: string; description?: string }>

describe('payloads', () => {
  it('file / rep / cab round-trip and reject junk', () => {
    for (const p of [{ kind: 'file', fileKind: 'p', id: PLAN }, { kind: 'file', fileKind: 'd', id: DOC },
      { kind: 'rep', reportId: REP }, { kind: 'cab', projectId: KW }, { kind: 'menu', row: 'files' }, { kind: 'menu', row: 'reports' }] as const) {
      expect(decodePayload(encodePayload(p as never))).toEqual(p)
    }
    expect(decodePayload(`file:x:${PLAN}`)).toBeNull()
    expect(decodePayload('rep:not-a-uuid')).toBeNull()
  })
})

describe('menu', () => {
  it('offers Drawings & documents and Reports & schedules on the project menu', async () => {
    await processInbound(row({ text: 'menu' }), deps())
    const titles = rows(0).map((r) => r.title)
    expect(titles).toContain(FILES.filesRow)
    expect(titles).toContain(FILES.reportsRow)
    expect(titles.length).toBeLessThanOrEqual(10)
  })
})

describe('drawings & documents', () => {
  it('lists the latest files for the current project as the person, and arms the search', async () => {
    await processInbound(tap(encodePayload({ kind: 'menu', row: 'files' })), deps())
    expect(calls).toContainEqual(['wa_project_files', { p_user: USER, p_project: KW, p_query: '' }])
    expect(rows(0).map((r) => r.id)).toEqual([encodePayload({ kind: 'file', fileKind: 'p', id: PLAN }), encodePayload({ kind: 'file', fileKind: 'd', id: DOC })])
    expect(rows(0).every((r) => r.title.length <= 24)).toBe(true)
    expect(current.pending_search_at).toBe(NOW.toISOString())
  })

  it('free text while the search is armed searches by name', async () => {
    current = link({ pending_search_at: new Date(NOW.getTime() - 60_000).toISOString() })
    await processInbound(row({ text: 'E.101' }), deps())
    expect(calls).toContainEqual(['wa_project_files', { p_user: USER, p_project: KW, p_query: 'E.101' }])
    expect(meta.sent[0].body).toBe(FILES.matches('E.101'))
  })

  it('an expired search does not swallow later text', async () => {
    current = link({ pending_search_at: new Date(NOW.getTime() - 11 * 60_000).toISOString() })
    await processInbound(row({ text: 'E.101' }), deps())
    expect(calls.some(([fn]) => fn === 'wa_project_files')).toBe(false)
  })

  it('"menu" during a search still opens the menu', async () => {
    current = link({ pending_search_at: NOW.toISOString() })
    await processInbound(row({ text: 'menu' }), deps())
    expect(calls.some(([fn]) => fn === 'wa_project_files')).toBe(false)
    expect(rows(0).map((r) => r.title)).toContain(FILES.filesRow)
  })

  it('no match says so', async () => {
    current = link({ pending_search_at: NOW.toISOString() })
    rpc.wa_project_files = []
    await processInbound(row({ text: 'zzz' }), deps())
    expect(meta.sent[0].body).toBe(FILES.noMatch('zzz'))
  })

  it('picking a file sends it as a document only after wa_file said ok, and disarms the search', async () => {
    current = link({ pending_search_at: NOW.toISOString() })
    await processInbound(tap(encodePayload({ kind: 'file', fileKind: 'p', id: PLAN })), deps())
    expect(calls).toContainEqual(['wa_file', { p_user: USER, p_kind: 'p', p_id: PLAN }])
    expect(store.download).toHaveBeenCalledWith('drawings', 'o/p/x.pdf')
    expect(meta.sent.at(-1)).toEqual({ kind: 'document', body: '643.E.101 - POWER LAYOUT.pdf' })
    expect(current.pending_search_at).toBeNull()
  })

  it('a file the person cannot see is refused and never downloaded', async () => {
    rpc.wa_file = { code: 'not_found' }
    await processInbound(tap(encodePayload({ kind: 'file', fileKind: 'p', id: PLAN })), deps())
    expect(store.download).not.toHaveBeenCalled()
    expect(meta.sent[0].body).toBe(FILES.gone)
  })

  it('an oversized file is not uploaded to WhatsApp', async () => {
    ;(store.download as ReturnType<typeof vi.fn>).mockResolvedValue({ length: MAX_SEND_BYTES + 1 } as Uint8Array)
    await processInbound(tap(encodePayload({ kind: 'file', fileKind: 'd', id: DOC })), deps())
    expect(meta.uploadMedia).not.toHaveBeenCalled()
    expect(meta.sent[0].body).toBe(FILES.tooBig)
  })
})

describe('reports & schedules', () => {
  it('lists the cable schedule first, then saved reports', async () => {
    await processInbound(tap(encodePayload({ kind: 'menu', row: 'reports' })), deps())
    expect(calls).toContainEqual(['wa_project_reports', { p_user: USER, p_project: KW }])
    expect(rows(0).map((r) => r.id)).toEqual([encodePayload({ kind: 'cab', projectId: KW }), encodePayload({ kind: 'rep', reportId: REP })])
  })

  it('without the report service the cable schedule is not offered', async () => {
    reports = undefined
    await processInbound(tap(encodePayload({ kind: 'menu', row: 'reports' })), deps())
    expect(rows(0).map((r) => r.id)).toEqual([encodePayload({ kind: 'rep', reportId: REP })])
  })

  it('nothing to offer says so', async () => {
    rpc.wa_project_reports = { reports: [], cable_schedule: false }
    await processInbound(tap(encodePayload({ kind: 'menu', row: 'reports' })), deps())
    expect(meta.sent[0].body).toBe(FILES.noReports('(643) KINGSWALK'))
  })

  it('a saved report is sent from the reports bucket after wa_report said ok', async () => {
    await processInbound(tap(encodePayload({ kind: 'rep', reportId: REP })), deps())
    expect(store.download).toHaveBeenCalledWith('reports', 'o/p/r.pdf')
    expect(meta.sent.at(-1)).toEqual({ kind: 'document', body: 'Tenant schedule.pdf' })
  })

  it('the cable schedule is built by the report service for this person and project', async () => {
    await processInbound(tap(encodePayload({ kind: 'cab', projectId: KW })), deps())
    expect(reports!.cableSchedule).toHaveBeenCalledWith(USER, KW)
    expect(meta.sent.at(-1)).toEqual({ kind: 'document', body: 'KINGSWALK-cable-schedule.pdf' })
  })

  it('no access to the cable schedule is said plainly, nothing is sent', async () => {
    ;(reports!.cableSchedule as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 'no_access' })
    await processInbound(tap(encodePayload({ kind: 'cab', projectId: KW })), deps())
    expect(meta.uploadMedia).not.toHaveBeenCalled()
    expect(meta.sent[0].body).toBe(FILES.cableNoAccess)
  })
})
