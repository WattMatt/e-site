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
import { isMenuWord, matchProjects, normaliseName, PENDING_POST_TTL_MS } from './core'

const P1 = { id: '11111111-1111-4111-8111-111111111111', name: '(643) KINGSWALK' }
const P2 = { id: '22222222-2222-4222-8222-222222222222', name: '(649) PNP FAERIE GLEN' }
const P3 = { id: '33333333-3333-4333-8333-333333333333', name: 'PNP2 FAERIE GLEN EXTENSION' }
const P4 = { id: '44444444-4444-4444-8444-444444444444', name: '(657) MAMAILA PHASE 2' }
const ALL = [P1, P2, P3, P4]

describe('channel core', () => {
  it.each(['menu', 'MENU', ' Hi ', 'hello', 'help', 'start', 'hey!'])('%s is a menu word', (t) => expect(isMenuWord(t)).toBe(true))
  it.each(['menu please now', 'cable pulled', '', 'hi there team'])('%s is not', (t) => expect(isMenuWord(t)).toBe(false))
  it('normaliseName strips punctuation and case', () => expect(normaliseName('(643) Kingswalk,  Mall!')).toBe('643 KINGSWALK MALL'))
  it('exact name without the job number is an exact match', () =>
    expect(matchProjects('kingswalk', ALL)).toEqual({ kind: 'exact', project: P1 }))
  it('job number alone is an exact match', () =>
    expect(matchProjects('643', ALL)).toEqual({ kind: 'exact', project: P1 }))
  it('a partial name is only ever a candidate list (always confirmed)', () =>
    expect(matchProjects('faerie', ALL)).toEqual({ kind: 'candidates', projects: [P2, P3] }))
  it('short or unmatched text is none — never a guess', () => {
    expect(matchProjects('pnp', ALL)).toEqual({ kind: 'none' })
    expect(matchProjects('ok', ALL)).toEqual({ kind: 'none' })
    expect(matchProjects('cover refitted on DB3', ALL)).toEqual({ kind: 'none' })
  })
  it('candidates are capped at 10', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ id: `${i}`.padStart(8, '0') + '-0000-4000-8000-000000000000', name: `SITE ${i}` }))
    const m = matchProjects('site', many)
    expect(m.kind === 'candidates' && m.projects.length).toBe(10)
  })
  it('post TTL is 30 minutes', () => expect(PENDING_POST_TTL_MS).toBe(30 * 60 * 1000))
})

describe('channel payloads', () => {
  const U = '3f1c2e4a-9b7d-4c1e-8a2b-1234567890ab'
  it.each([
    { kind: 'menu', row: 'mine' }, { kind: 'menu', row: 'project' }, { kind: 'menu', row: 'post' }, { kind: 'menu', row: 'switch' },
    { kind: 'proj', projectId: U }, { kind: 'item', itemId: U }, { kind: 'open', itemId: U },
    { kind: 'post', choice: 'diary', postId: U }, { kind: 'post', choice: 'issue', postId: U },
  ] as const)('round-trips %o', (p) => expect(decodePayload(encodePayload(p))).toEqual(p))
  it.each(['menu:nuke', 'proj:x', 'post:shout:' + U, 'item:'])('rejects %s', (s) => expect(decodePayload(s)).toBeNull())
})

import { parseLinkCode, linkCodeMessage } from './core'

describe('inbound link code', () => {
  it.each([
    ['LINK 482917', '482917'], ['link 482917', '482917'], ['  Link   482917 ', '482917'], ['LINK482917', '482917'],
  ])('%s -> %s', (t, c) => expect(parseLinkCode(t)).toBe(c))
  it.each(['482917', 'LINK 48291', 'LINK 4829170', 'please LINK 482917', 'LINK abcdef', ''])('rejects %s', (t) =>
    expect(parseLinkCode(t)).toBeNull())
  it('message and parser agree', () => expect(parseLinkCode(linkCodeMessage('004211'))).toBe('004211'))
})
