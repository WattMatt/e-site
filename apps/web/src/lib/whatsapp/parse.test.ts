// apps/web/src/lib/whatsapp/parse.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseWebhook } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/parse.ts'

const wrap = (value: unknown) => ({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value }] }] })

describe('parseWebhook', () => {
  it('flattens a template quick-reply button', () => {
    const { messages } = parseWebhook(wrap({ messages: [{ id: 'wamid.1', from: '27821234567', timestamp: '1', type: 'button',
      context: { id: 'wamid.out' }, button: { payload: 'ack:11111111-1111-4111-8111-111111111111', text: 'Acknowledge' } }] }))
    expect(messages[0]).toMatchObject({ id: 'wamid.1', from: '27821234567', type: 'button', contextId: 'wamid.out',
      payload: 'ack:11111111-1111-4111-8111-111111111111', text: null, imageId: null })
  })
  it('reads interactive button and list replies', () => {
    const { messages } = parseWebhook(wrap({ messages: [
      { id: 'a', from: '1', timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'wrong:note:x', title: 'Wrong item' } } },
      { id: 'b', from: '1', timestamp: '1', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'pick:y', title: 'SNAG-1' } } },
    ] }))
    expect(messages.map((m) => m.payload)).toEqual(['wrong:note:x', 'pick:y'])
  })
  it('reads text and image-with-caption', () => {
    const { messages } = parseWebhook(wrap({ messages: [
      { id: 't', from: '1', timestamp: '1', type: 'text', text: { body: 'Cover refitted' } },
      { id: 'i', from: '1', timestamp: '1', type: 'image', image: { id: 'MEDIA', mime_type: 'image/jpeg', caption: 'after' } },
    ] }))
    expect(messages[0]).toMatchObject({ type: 'text', text: 'Cover refitted' })
    expect(messages[1]).toMatchObject({ type: 'image', imageId: 'MEDIA', imageMime: 'image/jpeg', text: 'after' })
  })
  it('reads statuses with error codes', () => {
    const { statuses } = parseWebhook(wrap({ statuses: [
      { id: 'wamid.out', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] },
      { id: 'wamid.o2', status: 'read' },
    ] }))
    expect(statuses).toEqual([
      { id: 'wamid.out', status: 'failed', errorCode: 131026, errorTitle: 'Message undeliverable' },
      { id: 'wamid.o2', status: 'read', errorCode: null, errorTitle: null },
    ])
  })
  it('never throws on junk', () => {
    expect(parseWebhook(null)).toEqual({ messages: [], statuses: [] })
    expect(parseWebhook({ entry: 'x' })).toEqual({ messages: [], statuses: [] })
  })
})

describe('parseWebhook: inspection forms (E4)', () => {
  const flowReply = { id: 'f', from: '27821234567', timestamp: '1', type: 'interactive', context: { from: 'B', id: 'wamid.flowmsg' },
    interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', body: 'Sent', response_json: '{"flow_token":"tok","s0_f0":"pass"}' } } }

  it('keeps a Flow reply\'s response_json and carries no payload', () => {
    const { messages } = parseWebhook(wrap({ messages: [flowReply] }))
    expect(messages[0]).toMatchObject({ type: 'interactive', payload: null, flowResponseJson: '{"flow_token":"tok","s0_f0":"pass"}', contextId: 'wamid.flowmsg' })
  })
  it('keeps Meta\'s original message object for the evidence log', () => {
    const { messages } = parseWebhook(wrap({ messages: [flowReply] }))
    expect(messages[0].metaRaw).toEqual(flowReply)
  })
  it('a non-Flow interactive reply has no flow response', () => {
    const { messages } = parseWebhook(wrap({ messages: [
      { id: 'a', from: '1', timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'x', title: 'X' } } }] }))
    expect(messages[0].flowResponseJson).toBeNull()
  })
})
