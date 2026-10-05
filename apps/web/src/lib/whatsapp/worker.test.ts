// apps/web/src/lib/whatsapp/worker.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drainOutbox, type WorkerStore, type OutboxRow } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/worker.ts'
import { MetaError, type MetaClient } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/meta-client.ts'

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const I = '11111111-1111-4111-8111-111111111111'
const L = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DAY = new Date('2026-10-01T08:00:00Z')      // 10:00 SAST
const NIGHT = new Date('2026-10-01T18:00:00Z')    // 20:00 SAST

const orow = (over: Partial<OutboxRow> = {}): OutboxRow =>
  ({ id: 'o1', user_id: U, work_item_id: I, link_id: null, trigger: 'assigned', payload: {}, attempts: 1, ...over })

let store: WorkerStore & { marks: Array<[string, Record<string, unknown>]> }
let meta: MetaClient
let rows: OutboxRow[]

beforeEach(() => {
  rows = [orow()]
  const marks: Array<[string, Record<string, unknown>]> = []
  store = {
    marks,
    sendingEnabled: vi.fn(async () => true),
    claim: vi.fn(async () => rows),
    activeLink: vi.fn(async () => ({ id: L, phone_e164: '+27821234567', status: 'active', quiet_start: '18:00:00', quiet_end: '06:30:00' })),
    linkById: vi.fn(async () => ({ id: L, phone_e164: '+27821234567', status: 'pending_optin' })),
    canReceive: vi.fn(async () => ({ ok: true, item_id: I, ref: 'T-1', title: 'Fix', project_name: 'K', due_date: '2026-10-03', days_overdue: 0 })),
    sentItemCountToday: vi.fn(async () => 0),
    enqueueFold: vi.fn(async () => {}),
    mark: vi.fn(async (id, patch) => { marks.push([id, patch]) }),
    setLinkActiveItem: vi.fn(async () => {}),
    markLinkUndeliverable: vi.fn(async () => {}),
    recordPolicyError: vi.fn(async () => {}),
  } as never
  meta = { sendTemplate: vi.fn(async () => 'wamid.OUT'), sendText: vi.fn(), sendButtons: vi.fn(), sendList: vi.fn(), fetchMedia: vi.fn() } as never
})

const run = (now = DAY) => drainOutbox({ store, meta, now: () => now })

describe('drainOutbox', () => {
  it('sends an assigned card and records the Meta id', async () => {
    const s = await run()
    expect(s.sent).toBe(1)
    expect(meta.sendTemplate).toHaveBeenCalledWith('+27821234567', 'esite_item_assigned', ['T-1', 'K', 'Fix', 'Sat 3 Oct'], expect.any(Array))
    expect(store.marks[0]).toEqual(['o1', expect.objectContaining({ status: 'sent', meta_message_id: 'wamid.OUT' })])
    expect(store.setLinkActiveItem).toHaveBeenCalledWith(L, I, DAY.toISOString())
  })
  it('platform switch off: suppresses, sends nothing', async () => {
    ;(store.sendingEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    await run()
    expect(meta.sendTemplate).not.toHaveBeenCalled()
    expect(store.marks[0][1]).toMatchObject({ status: 'suppressed', error_text: 'platform_disabled' })
  })
  it('quiet hours: holds until 06:30 SAST', async () => {
    const s = await run(NIGHT)
    expect(s.held).toBe(1)
    expect(meta.sendTemplate).not.toHaveBeenCalled()
    expect(store.marks[0][1]).toMatchObject({ status: 'held_quiet', send_after: '2026-10-02T04:30:00.000Z' })
  })
  it('lost access / ball moved: suppressed with the reason', async () => {
    ;(store.canReceive as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, reason: 'ball_moved' })
    await run()
    expect(store.marks[0][1]).toMatchObject({ status: 'suppressed', error_text: 'ball_moved' })
  })
  it('daily cap: suppresses and folds', async () => {
    ;(store.sentItemCountToday as ReturnType<typeof vi.fn>).mockResolvedValue(8)
    await run()
    expect(meta.sendTemplate).not.toHaveBeenCalled()
    expect(store.enqueueFold).toHaveBeenCalledWith(U, '2026-10-01')
    expect(store.marks[0][1]).toMatchObject({ status: 'suppressed', error_text: 'daily_cap' })
  })
  it('OTP goes out immediately even at night, and the code is scrubbed after', async () => {
    rows = [orow({ trigger: 'otp', work_item_id: null, link_id: L, payload: { code: '042917' } })]
    ;(store.linkById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: L, phone_e164: '+27821234567', status: 'pending_otp' })
    await run(NIGHT)
    expect(meta.sendTemplate).toHaveBeenCalledWith('+27821234567', 'esite_otp', ['042917'], expect.any(Array))
    expect(store.marks[0][1]).toMatchObject({ status: 'sent', payload: {} })
  })
  it('opt-in is only sent while the link is still pending', async () => {
    rows = [orow({ trigger: 'optin', work_item_id: null, link_id: L, payload: { inviter: 'Arno', project: 'K' } })]
    ;(store.linkById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: L, phone_e164: '+27821234567', status: 'active' })
    await run()
    expect(meta.sendTemplate).not.toHaveBeenCalled()
    expect(store.marks[0][1]).toMatchObject({ status: 'suppressed', error_text: 'link_state' })
  })
  it('transient error: retry with backoff', async () => {
    ;(meta.sendTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(new MetaError(130429, 'rate', 'transient'))
    const s = await run()
    expect(s.retried).toBe(1)
    expect(store.marks[0][1]).toMatchObject({ status: 'retry', error_code: 130429, send_after: '2026-10-01T08:01:00.000Z' })
  })
  it('transient error on the 5th attempt: failed', async () => {
    rows = [orow({ attempts: 5 })]
    ;(meta.sendTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(new MetaError(131000, 'x', 'transient'))
    await run()
    expect(store.marks[0][1]).toMatchObject({ status: 'failed' })
  })
  it('recipient error: failed + link undeliverable', async () => {
    ;(meta.sendTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(new MetaError(131026, 'undeliverable', 'recipient'))
    await run()
    expect(store.markLinkUndeliverable).toHaveBeenCalledWith(L, '131026 undeliverable')
    expect(store.marks[0][1]).toMatchObject({ status: 'failed' })
  })
  it('policy error: failed + recorded for admins', async () => {
    ;(meta.sendTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(new MetaError(132015, 'template paused', 'policy'))
    await run()
    expect(store.recordPolicyError).toHaveBeenCalledWith('132015 template paused')
  })
})

describe('drainOutbox: inspection forms (E4)', () => {
  const S = '66666666-6666-4666-8666-666666666666'
  const summary = { label: 'MINIATURE SUBSTATION 1', templateName: 'Miniature Substation Inspection Report',
    projectName: '(643) KINGSWALK', submitterName: 'Johan B', verifierName: 'Arno' }
  let pdf: Uint8Array | null
  let check: string
  let approved: boolean

  beforeEach(() => {
    pdf = new Uint8Array([37, 80, 68, 70])
    check = 'ok'
    approved = true
    Object.assign(store, {
      formReceiveCheck: vi.fn(async () => check),
      formSummary: vi.fn(async () => summary),
      outboundPdf: vi.fn(async () => pdf),
      templateApproved: vi.fn(async () => approved),
    })
    Object.assign(meta, {
      uploadMedia: vi.fn(async () => 'MEDIA1'),
      sendDocument: vi.fn(async () => 'wamid.DOC'),
      sendText: vi.fn(async () => 'wamid.TXT'),
    })
  })

  it('confirmation: sends the PDF as a document with the summary as caption, even at night', async () => {
    rows = [orow({ trigger: 'form_confirm', work_item_id: null, payload: {}, form_session_id: S })]
    const s = await run(NIGHT)
    expect(s.sent).toBe(1)
    expect(meta.uploadMedia).toHaveBeenCalledWith(pdf, 'application/pdf', expect.stringMatching(/\.pdf$/))
    expect(meta.sendDocument).toHaveBeenCalledWith('+27821234567', 'MEDIA1', expect.stringMatching(/MINIATURE SUBSTATION 1.*\.pdf$/),
      expect.stringContaining('Submitted'))
    expect(store.marks[0][1]).toMatchObject({ status: 'sent', meta_message_id: 'wamid.DOC' })
  })
  it('confirmation without a PDF goes as text', async () => {
    pdf = null
    rows = [orow({ trigger: 'form_confirm', work_item_id: null, form_session_id: S })]
    await run()
    expect(meta.sendDocument).not.toHaveBeenCalled()
    expect(meta.sendText).toHaveBeenCalledWith('+27821234567', expect.stringContaining('Submitted'))
  })
  it('confirmation outside the 24-hour window is dropped, and the number is NOT marked undeliverable', async () => {
    rows = [orow({ trigger: 'form_confirm', work_item_id: null, form_session_id: S })]
    ;(meta.sendDocument as ReturnType<typeof vi.fn>).mockRejectedValue(new MetaError(131047, 'Re-engagement message', 'recipient'))
    const s = await run()
    expect(s.suppressed).toBe(1)
    expect(store.marks[0][1]).toMatchObject({ status: 'suppressed', error_text: 'window_closed' })
    expect(store.markLinkUndeliverable).not.toHaveBeenCalled()
  })
  it('summary: the approved template with who, what, which form and where', async () => {
    rows = [orow({ trigger: 'form_submitted', work_item_id: null, form_session_id: S })]
    await run()
    expect(meta.sendTemplate).toHaveBeenCalledWith('+27821234567', 'esite_form_submitted',
      ['Johan B', 'MINIATURE SUBSTATION 1', 'Miniature Substation Inspection Report', '(643) KINGSWALK'], [])
  })
  it('summary respects quiet hours', async () => {
    rows = [orow({ trigger: 'form_submitted', work_item_id: null, form_session_id: S })]
    const s = await run(NIGHT)
    expect(s.held).toBe(1)
    expect(meta.sendTemplate).not.toHaveBeenCalled()
  })
  it('re-checks at send time: flag off, project off or access gone suppresses with the reason', async () => {
    for (const reason of ['flag_off', 'project_off', 'no_access']) {
      check = reason
      store.marks.length = 0
      rows = [orow({ trigger: 'form_submitted', work_item_id: null, form_session_id: S })]
      await run()
      expect(store.marks[0][1]).toMatchObject({ status: 'suppressed', error_text: reason })
    }
    expect(meta.sendTemplate).not.toHaveBeenCalled()
  })
  it('summary: held back while Meta has not approved the template (no per-recipient policy errors)', async () => {
    approved = false
    rows = [orow({ trigger: 'form_submitted', work_item_id: null, form_session_id: S })]
    await run()
    expect(meta.sendTemplate).not.toHaveBeenCalled()
    expect(store.marks[0][1]).toMatchObject({ status: 'suppressed', error_text: 'template_not_approved' })
  })
})
