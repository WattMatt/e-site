// A web submit of an inspection that was opened on WhatsApp runs the WhatsApp follow-up
// (confirmation + PDF to the person, summary to the site), for the person who submitted (E4).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { afterWeb, notify, updateResult, blocker, updated } = vi.hoisted(() => ({
  blocker: { value: null as string | null },
  updated: vi.fn(),
  afterWeb: vi.fn(async () => {}),
  notify: vi.fn(async () => {}),
  updateResult: { error: null as null | { message: string }, data: [{ id: 'i-1' }] as Array<{ id: string }> },
}))

function client() {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  Object.assign(chain, {
    from: self, select: self, eq: self,
    update: (patch: unknown) => { updated(patch); return { eq: () => ({ in: () => ({ select: async () => updateResult }) }) } },
    single: async () => ({ data: { verifier_id: 'v-1', target_label: 'MINI SUB 1' }, error: null }),
  })
  return { auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) }, schema: () => chain }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client(), createServiceClient: () => client() }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/features', () => ({ requireFeature: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ dispatchNotification: notify }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/whatsapp-forms/after-submit', () => ({ afterWebSubmitOfWhatsAppForm: afterWeb }))
vi.mock('@/lib/inspections/submit-check', () => ({ submitBlocker: async () => blocker.value }))

import { submitInspectionAction } from './inspections.actions'

beforeEach(() => { afterWeb.mockClear(); notify.mockClear(); updated.mockClear(); blocker.value = null; updateResult.error = null; updateResult.data = [{ id: 'i-1' }] })

describe('submitInspectionAction and WhatsApp', () => {
  it('runs the WhatsApp follow-up for the submitter after a successful submit', async () => {
    expect(await submitInspectionAction('i-1', 'p-1')).toEqual({ ok: true })
    expect(afterWeb).toHaveBeenCalledWith('i-1', 'u-1')
  })
  it('does not run it when the submit itself failed', async () => {
    updateResult.error = { message: 'nope' }
    expect(await submitInspectionAction('i-1', 'p-1')).toEqual({ ok: false, error: 'nope' })
    expect(afterWeb).not.toHaveBeenCalled()
  })
  it('M4: a submit that moved nothing (someone else already submitted) sends no follow-up and no notice', async () => {
    updateResult.data = []
    await submitInspectionAction('i-1', 'p-1')
    expect(afterWeb).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })
  it('refuses an incomplete inspection with the reason, before changing anything', async () => {
    blocker.value = '2 required items are still missing.'
    expect(await submitInspectionAction('i-1', 'p-1')).toEqual({ ok: false, error: '2 required items are still missing.' })
    expect(updated).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })
})
