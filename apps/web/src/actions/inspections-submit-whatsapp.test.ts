// A web submit of an inspection that was opened on WhatsApp runs the WhatsApp follow-up
// (confirmation + PDF to the person, summary to the site), for the person who submitted (E4).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { afterWeb, notify, updateResult } = vi.hoisted(() => ({
  afterWeb: vi.fn(async () => {}),
  notify: vi.fn(async () => {}),
  updateResult: { error: null as null | { message: string } },
}))

function client() {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  Object.assign(chain, {
    from: self, select: self, eq: self,
    update: () => ({ eq: () => ({ in: async () => updateResult }) }),
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

import { submitInspectionAction } from './inspections.actions'

beforeEach(() => { afterWeb.mockClear(); updateResult.error = null })

describe('submitInspectionAction and WhatsApp', () => {
  it('runs the WhatsApp follow-up for the submitter after a successful submit', async () => {
    await submitInspectionAction('i-1', 'p-1')
    expect(afterWeb).toHaveBeenCalledWith('i-1', 'u-1')
  })
  it('does not run it when the submit itself failed', async () => {
    updateResult.error = { message: 'nope' }
    await expect(submitInspectionAction('i-1', 'p-1')).rejects.toBeTruthy()
    expect(afterWeb).not.toHaveBeenCalled()
  })
})
