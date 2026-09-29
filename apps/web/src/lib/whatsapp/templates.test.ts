// apps/web/src/lib/whatsapp/templates.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { itemCardSend, otpSend, optinSend, foldSend, humanDate, cleanParam } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/templates.ts'

const ID = '11111111-1111-4111-8111-111111111111'

describe('templates', () => {
  it('humanDate', () => expect(humanDate('2026-10-03')).toBe('Sat 3 Oct'))
  it('cleanParam strips newlines/tabs and long runs of spaces (Meta rejects them)', () =>
    expect(cleanParam('a\n\tb     c')).toBe('a b   c'))
  it('assigned card', () => {
    const s = itemCardSend('assigned', { itemId: ID, ref: 'T-4', projectName: 'KINGSWALK', title: 'Loose\nDB-3 cover', dueDate: '2026-10-03' })
    expect(s.name).toBe('esite_item_assigned')
    expect(s.body).toEqual(['T-4', 'KINGSWALK', 'Loose DB-3 cover', 'Sat 3 Oct'])
    expect(s.buttons).toEqual([
      { type: 'quick_reply', index: 0, payload: `ack:${ID}` },
      { type: 'quick_reply', index: 1, payload: `done:${ID}` },
      { type: 'url', index: 2, suffix: ID },
    ])
  })
  it('overdue card carries the day count', () => {
    const s = itemCardSend('overdue', { itemId: ID, ref: 'T-4', projectName: 'K', title: 't', dueDate: '2026-10-03', daysOverdue: 4 })
    expect(s.name).toBe('esite_item_overdue')
    expect(s.body[4]).toBe('4')
  })
  it('otp puts the code in the body AND the copy-code button', () =>
    expect(otpSend('042917')).toEqual({ name: 'esite_otp', body: ['042917'], buttons: [{ type: 'url', index: 0, suffix: '042917' }] }))
  it('optin carries both answers bound to the link', () =>
    expect(optinSend('Arno', 'KINGSWALK', ID).buttons).toEqual([
      { type: 'quick_reply', index: 0, payload: `optin:yes:${ID}` },
      { type: 'quick_reply', index: 1, payload: `optin:no:${ID}` },
    ]))
  it('fold', () => expect(foldSend(5)).toEqual({ name: 'esite_items_waiting', body: ['5'], buttons: [] }))
})
