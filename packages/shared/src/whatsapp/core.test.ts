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
import { resolveTarget, nextSendTime, sastDate, isWithin, doneRouteFor } from './core'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const NOW = new Date('2026-10-01T10:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

describe('resolveTarget', () => {
  const base = { payloadItemId: null, contextItemId: null, pendingDoneItemId: null, pendingDoneAt: null,
                 pendingDoneWants: 'photo' as const,
                 activeItemId: null, activeItemAt: null, isImage: false, now: NOW }
  it('a pending ANSWER captures the next TEXT, not a photo', () => {
    const p = { ...base, pendingDoneItemId: A, pendingDoneAt: ago(60_000), pendingDoneWants: 'answer' as const }
    expect(resolveTarget({ ...p, isImage: false })).toEqual({ kind: 'item', itemId: A, via: 'pending_done' })
    expect(resolveTarget({ ...p, isImage: true })).toEqual({ kind: 'pick' })
  })
  it('button wins over everything', () =>
    expect(resolveTarget({ ...base, payloadItemId: A, contextItemId: B, activeItemId: B, activeItemAt: ago(1000) }))
      .toEqual({ kind: 'item', itemId: A, via: 'button' }))
  it('swipe-reply context wins over active item', () =>
    expect(resolveTarget({ ...base, contextItemId: A, activeItemId: B, activeItemAt: ago(1000) }))
      .toEqual({ kind: 'item', itemId: A, via: 'context' }))
  it('pending done captures the next PHOTO', () =>
    expect(resolveTarget({ ...base, isImage: true, pendingDoneItemId: A, pendingDoneAt: ago(60_000), activeItemId: B, activeItemAt: ago(1000) }))
      .toEqual({ kind: 'item', itemId: A, via: 'pending_done' }))
  it('pending done does NOT capture text', () =>
    expect(resolveTarget({ ...base, isImage: false, pendingDoneItemId: A, pendingDoneAt: ago(60_000), activeItemId: B, activeItemAt: ago(1000) }))
      .toEqual({ kind: 'item', itemId: B, via: 'active' }))
  it('expired pending done is ignored', () =>
    expect(resolveTarget({ ...base, isImage: true, pendingDoneItemId: A, pendingDoneAt: ago(31 * 60_000) }))
      .toEqual({ kind: 'pick' }))
  it('active item within 24h is used', () =>
    expect(resolveTarget({ ...base, activeItemId: B, activeItemAt: ago(23 * 3600_000) }))
      .toEqual({ kind: 'item', itemId: B, via: 'active' }))
  it('stale active item forces a pick, never a guess', () =>
    expect(resolveTarget({ ...base, activeItemId: B, activeItemAt: ago(25 * 3600_000) }))
      .toEqual({ kind: 'pick' }))
  it('nothing known forces a pick', () => expect(resolveTarget(base)).toEqual({ kind: 'pick' }))
})

describe('nextSendTime (SAST = UTC+2, overnight window 18:00-06:30)', () => {
  it.each([
    ['2026-10-01T17:00:00Z', '2026-10-02T04:30:00.000Z'], // 19:00 SAST -> next 06:30
    ['2026-10-01T21:59:00Z', '2026-10-02T04:30:00.000Z'], // 23:59 SAST
    ['2026-10-01T22:30:00Z', '2026-10-02T04:30:00.000Z'], // 00:30 SAST next day
    ['2026-10-01T03:00:00Z', '2026-10-01T04:30:00.000Z'], // 05:00 SAST same day
    ['2026-10-01T04:30:00Z', '2026-10-01T04:30:00.000Z'], // exactly 06:30 -> send now
    ['2026-10-01T08:00:00Z', '2026-10-01T08:00:00.000Z'], // 10:00 -> send now
    ['2026-10-01T15:59:00Z', '2026-10-01T15:59:00.000Z'], // 17:59 -> send now
  ])('%s -> %s', (now, out) =>
    expect(nextSendTime(new Date(now), '18:00:00', '06:30:00').toISOString()).toBe(out))

  it('daytime window 12:00-13:00', () =>
    expect(nextSendTime(new Date('2026-10-01T10:30:00Z'), '12:00', '13:00').toISOString())
      .toBe('2026-10-01T11:00:00.000Z'))
  it('equal start/end means no quiet hours', () =>
    expect(nextSendTime(NOW, '00:00', '00:00')).toEqual(NOW))
})

describe('sastDate / isWithin', () => {
  it('rolls the date at SAST midnight, not UTC', () => {
    expect(sastDate(new Date('2026-10-01T21:59:00Z'))).toBe('2026-10-01')
    expect(sastDate(new Date('2026-10-01T22:00:00Z'))).toBe('2026-10-02')
  })
  it('isWithin', () => {
    expect(isWithin(ago(1000), NOW, 2000)).toBe(true)
    expect(isWithin(ago(3000), NOW, 2000)).toBe(false)
    expect(isWithin(null, NOW, 2000)).toBe(false)
  })
})

describe('doneRouteFor', () => {
  it.each([
    ['task', 'manual', 'spine'],
    ['snag', 'manual', 'spine'],
    ['snag', 'split', 'spine'],
    ['snag', 'mirror', 'snag'],
    ['rfi', 'mirror', 'rfi'],
    ['inspection', 'mirror', 'link_out'],
    ['qc_defect', 'mirror', 'link_out'],
  ])('%s/%s -> %s', (t, o, r) => expect(doneRouteFor(t, o)).toBe(r))
})
