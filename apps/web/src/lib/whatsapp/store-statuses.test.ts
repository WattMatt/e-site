// @vitest-environment node
// H3 (E4 review): Meta reports "outside the 24-hour window" (131047) as a LATE `failed` status.
// That is a reason to drop one free-form message, never to stop messaging the number.
import { describe, it, expect } from 'vitest'
import { applyStatuses } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/store.ts'
import { fakeSupabase } from './fake-supabase'

const failed = (code: number) => [{ id: 'wamid.OUT', status: 'failed' as const, errorCode: code, errorTitle: 'x' }]

describe('applyStatuses: late failures', () => {
  it('131047 (window closed) fails the message but leaves the link active', async () => {
    const sb = fakeSupabase({ 'outbox:select': [{ data: { id: 'o1', status: 'sent', link_id: 'l1', user_id: 'u1' } }], 'outbox:update': [{ data: null }] })
    await applyStatuses(sb, failed(131047))
    expect(sb.calls.some((c) => c.table === 'phone_links')).toBe(false)
    expect(sb.calls.find((c) => c.op === 'update')!.args[0]).toMatchObject({ status: 'failed', error_code: 131047 })
  })
  it('a real recipient failure still marks the number undeliverable', async () => {
    const sb = fakeSupabase({ 'outbox:select': [{ data: { id: 'o1', status: 'sent', link_id: 'l1', user_id: 'u1' } }],
      'outbox:update': [{ data: null }], 'phone_links:update': [{ data: null }] })
    await applyStatuses(sb, failed(131026))
    expect(sb.calls.some((c) => c.table === 'phone_links' && c.op === 'update')).toBe(true)
  })
})
