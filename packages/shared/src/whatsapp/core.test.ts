// packages/shared/src/whatsapp/core.test.ts
import { describe, it, expect } from 'vitest'
import {
  normalisePhone, fromMetaWaId, maskPhone, classifyKeyword,
  encodePayload, decodePayload, placeholderEmailFor, isPlaceholderEmail,
} from './core'

const U = '3f1c2e4a-9b7d-4c1e-8a2b-1234567890ab'

describe('normalisePhone', () => {
  it.each([
    ['082 123 4567', '+27821234567'],
    ['0821234567', '+27821234567'],
    ['27821234567', '+27821234567'],
    ['+27 (82) 123-4567', '+27821234567'],
    ['0027821234567', '+27821234567'],
    ['+447700900123', '+447700900123'],
  ])('%s -> %s', (input, out) => expect(normalisePhone(input)).toBe(out))

  it.each(['', 'abc', '082123456', '+2782123456789', '+0821234567', '12345'])(
    'rejects %s', (input) => expect(normalisePhone(input)).toBeNull())
})

describe('fromMetaWaId', () => {
  it('prefixes + to Meta digits', () => expect(fromMetaWaId('27821234567')).toBe('+27821234567'))
  it('accepts non-ZA ids', () => expect(fromMetaWaId('447700900123')).toBe('+447700900123'))
  it('rejects junk', () => expect(fromMetaWaId('27abc')).toBeNull())
})

describe('maskPhone', () => {
  it('keeps country, prefix and last four', () => expect(maskPhone('+27821234567')).toBe('+27 82 *** 4567'))
})

describe('classifyKeyword', () => {
  it.each(['STOP', 'stop', ' Stop. ', 'unsubscribe', 'OPT OUT', 'stopp'])('%s is stop', (t) =>
    expect(classifyKeyword(t)).toBe('stop'))
  it.each(['START', 'start', 'Opt in'])('%s is start', (t) => expect(classifyKeyword(t)).toBe('start'))
  it.each(['stop the pump on DB3', 'ok', ''])('%s is neither', (t) => expect(classifyKeyword(t)).toBeNull())
})

describe('payload codec', () => {
  it.each([
    { kind: 'ack', itemId: U },
    { kind: 'done', itemId: U },
    { kind: 'optin', answer: 'yes', linkId: U },
    { kind: 'optin', answer: 'no', linkId: U },
    { kind: 'wrong', target: 'note', id: U },
    { kind: 'wrong', target: 'attachment', id: U },
    { kind: 'pick', itemId: U },
  ] as const)('round-trips %o', (p) => expect(decodePayload(encodePayload(p))).toEqual(p))

  it.each([null, undefined, '', 'ack', 'ack:not-a-uuid', 'nuke:' + U, 'optin:maybe:' + U, 'wrong:file:' + U])(
    'rejects %s', (s) => expect(decodePayload(s as string)).toBeNull())
})

describe('placeholder email', () => {
  it('is on the no-MX domain and recognised', () => {
    const e = placeholderEmailFor(U)
    expect(e).toBe(`wa-${U}@wa.e-site.live`)
    expect(isPlaceholderEmail(e)).toBe(true)
    expect(isPlaceholderEmail('WA-X@WA.E-SITE.LIVE')).toBe(true)
    expect(isPlaceholderEmail('arno@wmeng.co.za')).toBe(false)
    expect(isPlaceholderEmail(null)).toBe(false)
  })
})
