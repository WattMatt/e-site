// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/reports/file-inspection-report', () => ({ renderInspectionPdf: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ dispatchNotification: vi.fn() }))
vi.mock('@/lib/whatsapp/kick-worker', () => ({ kickWhatsAppWorker: vi.fn() }))
import { afterWhatsAppSubmit, afterWebSubmitOfWhatsAppForm, outboundPdfPath, type AfterSubmitDeps } from './after-submit'

let log: string[]
let sessionRow: Record<string, unknown> | null
let liveRows: Array<{ id: string }>
let renderFails: boolean

function deps(): AfterSubmitDeps {
  const q = (table: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: self, eq: self, in: self, order: self, gt: (c: string, v: string) => { log.push(`gt ${c} ${v}`); return chain },
      limit: async () => ({ data: liveRows, error: null }),
      maybeSingle: async () => ({ data: table === 'form_sessions' ? sessionRow : { verifier_id: 'v-1', target_label: 'MINI SUB 1', project_id: 'p-1' }, error: null }),
      update: (p: Record<string, unknown>) => { log.push(`update ${table} ${JSON.stringify(p)}`); return { eq: async () => ({ error: null }) } },
    })
    return chain
  }
  return {
    sb: {
      schema: () => ({ from: q, rpc: async (fn: string, args: unknown) => { log.push(`rpc ${fn} ${JSON.stringify(args)}`); return { error: null } } }),
      storage: { from: (b: string) => ({ upload: async (p: string) => { log.push(`upload ${b} ${p}`); return { error: null } } }) },
    } as never,
    render: async () => { if (renderFails) throw new Error('render'); log.push('render'); return Buffer.from('%PDF') },
    notify: vi.fn(async () => { log.push('notify') }) as never,
    kick: vi.fn(async () => { log.push('kick') }) as never,
    now: () => new Date('2026-10-05T10:00:00Z'),
  }
}

beforeEach(() => {
  log = []
  sessionRow = { id: 's-1', user_id: 'u-1', inspection_id: 'i-1', status: 'answered' }
  liveRows = [{ id: 's-1' }]
  renderFails = false
})

describe('afterWhatsAppSubmit', () => {
  it('queues the messages and notifies before the slow PDF, and closes the session last', async () => {
    await afterWhatsAppSubmit('s-1', { notifyVerifier: true }, deps())
    expect(log[0]).toBe('rpc enqueue_form_submitted {"p_session":"s-1"}')
    expect(log[1]).toBe('notify')
    expect(log[2]).toBe('render')
    expect(log[3]).toBe(`upload whatsapp-media ${outboundPdfPath('s-1')}`)
    expect(log[4]).toBe('kick')
    expect(log[5]).toMatch(/^update form_sessions .*"status":"submitted"/)
  })
  it('does not notify the verifier twice when the web submit already did', async () => {
    await afterWhatsAppSubmit('s-1', { notifyVerifier: false }, deps())
    expect(log).not.toContain('notify')
  })
  it('a failed PDF still sends the confirmation and the summary', async () => {
    renderFails = true
    await afterWhatsAppSubmit('s-1', { notifyVerifier: true }, deps())
    expect(log.some((l) => l.startsWith('upload'))).toBe(false)
    expect(log).toContain('rpc enqueue_form_submitted {"p_session":"s-1"}')
  })
})

describe('afterWebSubmitOfWhatsAppForm', () => {
  it('runs the follow-up for the submitter\'s live WhatsApp session, without a second verifier notice', async () => {
    await afterWebSubmitOfWhatsAppForm('i-1', 'u-1', deps())
    expect(log).toContain('rpc enqueue_form_submitted {"p_session":"s-1"}')
    expect(log).not.toContain('notify')
  })
  it('H3: only a session that has not expired gets the follow-up', async () => {
    await afterWebSubmitOfWhatsAppForm('i-1', 'u-1', deps())
    expect(log).toContain('gt expires_at 2026-10-05T10:00:00.000Z')
  })
  it('does nothing when the inspection was never opened on WhatsApp', async () => {
    liveRows = []
    await afterWebSubmitOfWhatsAppForm('i-1', 'u-1', deps())
    expect(log.filter((l) => !l.startsWith('gt '))).toEqual([])
  })
  it('never throws into the web submit', async () => {
    sessionRow = null
    await expect(afterWebSubmitOfWhatsAppForm('i-1', 'u-1', deps())).resolves.toBeUndefined()
  })
})
