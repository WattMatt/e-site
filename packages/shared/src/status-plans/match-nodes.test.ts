import { describe, it, expect } from 'vitest'
import { isTagShaped, buildNodeIndex, matchBlock, normaliseTag, stripLeadingZeros, parseNoText, type MatchableNode } from './match-nodes'

const n = (id: string, kind: string, code: string | null, shop_number: string | null, name: string | null): MatchableNode =>
  ({ id, kind, code, shop_number, name })

// Invented project.
const NODES: MatchableNode[] = [
  n('n-71', 'tenant_db', 'DB-71', '71', 'Alpha Store'),
  n('n-72', 'tenant_db', 'DB72', null, 'Bravo Shop'),
  n('n-93', 'tenant_db', null, '93', 'Kiosk Four'),
  n('n-73a', 'tenant_db', 'DB-73', null, 'Delta One'),
  n('n-73b', 'tenant_db', null, 'DB 73', 'Delta Two'),
  n('n-90', 'tenant_db', 'DB-90', null, 'Ninety'),
  n('n-91', 'tenant_db', 'DB-91', null, 'Ninety One'),
  n('n-mb92', 'main_board', null, null, 'MAIN BOARD 9.2'),
  n('n-mb93', 'main_board', 'MAIN BOARD 9.3', null, 'Main board 9.3'),
  n('n-fake', 'tenant_db', null, null, 'MAIN BOARD 9.4'),
  n('n-k41', 'tenant_db', 'DB-K41', null, 'Kiosk Forty One'),
  n('n-k7', 'tenant_db', 'DB-K7', null, 'Kiosk Seven'),
  n('n-s9', 'tenant_db', null, 'S-9', 'Sierra'),
]
const index = buildNodeIndex(NODES)
const match = (tag: string | null, name: string | null = null) => matchBlock({ tag, name }, index)

describe('normaliseTag', () => {
  it('uppercases and strips spaces, hyphens, dashes and dots but keeps /', () => {
    expect(normaliseTag('db - 7.1')).toBe('DB71')
    expect(normaliseTag('DB-90/91')).toBe('DB90/91')
    expect(normaliseTag('DB–7 1')).toBe('DB71')
    expect(normaliseTag('DB-ZR7')).toBe('DBZR7')
  })
})

describe('matchBlock', () => {
  it('matches nodes.code after normalisation', () => {
    expect(match('DB-71')).toEqual({ state: 'matched', nodeId: 'n-71', via: 'code', tieBrokenByName: false })
    expect(match('db-72')).toEqual({ state: 'matched', nodeId: 'n-72', via: 'code', tieBrokenByName: false })
  })

  it('matches nodes.shop_number', () => {
    expect(match('S-9')).toEqual({ state: 'matched', nodeId: 'n-s9', via: 'shop_number', tieBrokenByName: false })
  })

  it('tries the tag without a leading DB', () => {
    expect(match('DB-93')).toEqual({ state: 'matched', nodeId: 'n-93', via: 'without_db', tieBrokenByName: false })
  })

  it('maps MB-x.y to MAIN BOARD x.y (main-board name or any code)', () => {
    expect(match('MB-9.2')).toEqual({ state: 'matched', nodeId: 'n-mb92', via: 'main_board', tieBrokenByName: false })
    expect(match('MB-9.3')).toEqual({ state: 'matched', nodeId: 'n-mb93', via: 'main_board', tieBrokenByName: false })
  })

  it('a NAME reads as MAIN BOARD x.y only on a main board or rmu, never a tenant', () => {
    expect(match('MB-9.4')).toEqual({ state: 'unmatched' })
    const idx = buildNodeIndex([n('t2', 'tenant_db', 'DB-77', null, 'MAIN BOARD 2')])
    expect(matchBlock({ tag: 'MB-2', name: null }, idx)).toEqual({ state: 'unmatched' })
  })

  it('takes the MAIN BOARD alias from any node kind by code, and from a main board or rmu by name (MAINBOARD, MB x.y spellings too)', () => {
    const idx = buildNodeIndex([
      n('rmu-1', 'rmu', 'MAIN BOARD 6.1', null, 'MAIN BOARD 6.1'),
      n('rmu-2', 'rmu', 'MAIN BOARD 6.2', null, 'MAINBOARD 6.2'),
      n('rmu-3', 'rmu', null, null, 'MAINBOARD 6.3'),
      n('rmu-4', 'rmu', null, null, 'MB 6.4'),
      n('ms-7', 'mini_sub', 'MAIN BOARD 6.7', null, null),
      n('dup-a', 'rmu', 'MAIN BOARD 6.5', null, null),
      n('dup-b', 'main_board', null, null, 'Mainboard 6.5'),
    ])
    const m = (tag: string) => matchBlock({ tag, name: null }, idx)
    expect(m('MB-6.1')).toMatchObject({ state: 'matched', nodeId: 'rmu-1', via: 'main_board' })
    expect(m('MB-6.2')).toMatchObject({ state: 'matched', nodeId: 'rmu-2' })
    expect(m('MB-6.3')).toMatchObject({ state: 'matched', nodeId: 'rmu-3' })
    expect(m('MB-6.4')).toMatchObject({ state: 'matched', nodeId: 'rmu-4' })
    expect(m('MB-06.1')).toMatchObject({ state: 'matched', nodeId: 'rmu-1' })
    expect(m('MB-6.5')).toEqual({ state: 'ambiguous', candidateIds: ['dup-a', 'dup-b'] })
    expect(m('MB-6.7')).toMatchObject({ state: 'matched', nodeId: 'ms-7', via: 'main_board' })
  })

  it('reads KIOSK n as DB-Knn (padded) or DB-Kn', () => {
    expect(match('KIOSK 41')).toEqual({ state: 'matched', nodeId: 'n-k41', via: 'code', tieBrokenByName: false })
    expect(match('kiosk041')).toEqual({ state: 'matched', nodeId: 'n-k41', via: 'code', tieBrokenByName: false })
    expect(match('KIOSK 7')).toEqual({ state: 'matched', nodeId: 'n-k7', via: 'code', tieBrokenByName: false })
    expect(match('KIOSK 55')).toEqual({ state: 'unmatched' })
  })

  it('treats multi-word NO: text without a leading tag as no tag', () => {
    for (const t of ['GENERATOR 8.1 INCOMING', 'GENERATOR BUS 1', 'BULK CHECK METER', 'ABCDEFGHIJKLMNOPQ1']) {
      expect(match(t)).toEqual({ state: 'no_tag' })
    }
  })

  it('leaves a combined tag unmatched even when both halves exist', () => {
    expect(match('DB-90/91')).toEqual({ state: 'unmatched' })
  })

  it('several candidates → needs a decision, unless the NAME picks exactly one', () => {
    expect(match('DB-73')).toEqual({ state: 'ambiguous', candidateIds: ['n-73a', 'n-73b'] })
    expect(match('DB-73', 'DELTA  ONE')).toEqual({ state: 'matched', nodeId: 'n-73a', via: 'code', tieBrokenByName: true })
    expect(match('DB-73', 'Somebody Else')).toEqual({ state: 'ambiguous', candidateIds: ['n-73a', 'n-73b'] })
  })

  it('never links on the NAME alone', () => {
    expect(match('DB-99', 'Alpha Store')).toEqual({ state: 'unmatched' })
  })

  it('a tag with one space after a short alpha prefix still matches (DB 72, MB 9.3)', () => {
    expect(match('DB 72')).toEqual({ state: 'matched', nodeId: 'n-72', via: 'code', tieBrokenByName: false })
    expect(match('MB 9.3')).toEqual({ state: 'matched', nodeId: 'n-mb93', via: 'main_board', tieBrokenByName: false })
  })

  it('dots are significant: DB-2.1 never auto-matches DB-21, but offers it for a person to confirm', () => {
    const idx = buildNodeIndex([n('d21', 'tenant_db', 'DB-21', null, 'Twenty One'), n('d2-1', 'tenant_db', 'DB-2.1', null, 'Two One')])
    expect(matchBlock({ tag: 'DB-2.1', name: null }, idx)).toMatchObject({ state: 'matched', nodeId: 'd2-1' })
    expect(matchBlock({ tag: 'DB-21', name: null }, idx)).toMatchObject({ state: 'matched', nodeId: 'd21' })
    const only21 = buildNodeIndex([n('d21', 'tenant_db', 'DB-21', null, 'Twenty One')])
    expect(matchBlock({ tag: 'DB-2.1', name: null }, only21)).toEqual({ state: 'ambiguous', candidateIds: ['d21'], dotsOnly: true })
  })

  it('a leading-zero tag matches the unpadded board when exactly one does', () => {
    const idx = buildNodeIndex([
      n('d1', 'tenant_db', 'DB-1', '1', 'One'),
      n('d2a', 'tenant_db', 'DB-2a', '2a', 'Two A'),
      n('d9', 'tenant_db', 'DB-9', null, 'Nine'),
    ])
    const m = (tag: string) => matchBlock({ tag, name: null }, idx)
    expect(m('DB-01')).toEqual({ state: 'matched', nodeId: 'd1', via: 'code', tieBrokenByName: false, leadingZeros: true })
    expect(m('DB-02A')).toMatchObject({ state: 'matched', nodeId: 'd2a', leadingZeros: true })
    expect(m('DB-009')).toMatchObject({ state: 'matched', nodeId: 'd9' })
    // Zeros inside a number stay: DB-10 is not DB-1.
    expect(m('DB-10')).toEqual({ state: 'unmatched' })
  })

  it('an exact match (zeros kept) wins over a zero-stripped one', () => {
    const idx = buildNodeIndex([n('d1', 'tenant_db', 'DB-1', null, 'One'), n('d01', 'tenant_db', 'DB-01', null, 'Oh One')])
    expect(matchBlock({ tag: 'DB-01', name: null }, idx)).toMatchObject({ state: 'matched', nodeId: 'd01' })
    expect(matchBlock({ tag: 'DB-1', name: null }, idx)).toMatchObject({ state: 'matched', nodeId: 'd1' })
    expect(matchBlock({ tag: 'DB-1', name: null }, idx)).not.toHaveProperty('leadingZeros')
  })

  it('several boards matching only once zeros are ignored need a person, nothing preselected', () => {
    const idx = buildNodeIndex([n('d1', 'tenant_db', 'DB-1', null, 'One'), n('d01', 'tenant_db', 'DB-01', null, 'Oh One')])
    expect(matchBlock({ tag: 'DB-001', name: null }, idx)).toEqual({ state: 'ambiguous', candidateIds: ['d1', 'd01'], zerosOnly: true })
  })

  it('a zero-stripped match still keeps dots significant', () => {
    const idx = buildNodeIndex([n('d21', 'tenant_db', 'DB-21', null, 'Twenty One')])
    expect(matchBlock({ tag: 'DB-02.1', name: null }, idx)).toEqual({ state: 'ambiguous', candidateIds: ['d21'], dotsOnly: true })
  })

  it('a composite main-board NO: matches its tag when the role is the board itself', () => {
    const idx = buildNodeIndex([n('mb', 'rmu', 'MAIN BOARD 6.1', null, 'MAIN BOARD 6.1')])
    expect(matchBlock({ tag: 'MB-6.1 LOCAL MAIN', name: 'MAIN BOARD 6.1' }, idx)).toMatchObject({ state: 'matched', nodeId: 'mb', via: 'main_board' })
    expect(matchBlock({ tag: 'MB-6.1 MAIN', name: null }, idx)).toMatchObject({ state: 'matched', nodeId: 'mb' })
    expect(matchBlock({ tag: 'MB-6.1 LOCAL MAIN BOARD', name: null }, idx)).toMatchObject({ state: 'matched', nodeId: 'mb' })
    expect(matchBlock({ tag: 'MB-6.1 MAIN LOCAL', name: null }, idx)).toMatchObject({ state: 'matched', nodeId: 'mb' })
    expect(matchBlock({ tag: 'MB-6.1 MAINBOARD', name: null }, idx)).toMatchObject({ state: 'matched', nodeId: 'mb' })
  })

  it('any other words after the tag never link: the board is offered for a person to confirm', () => {
    const idx = buildNodeIndex([
      n('mb', 'rmu', 'MAIN BOARD 6.1', null, 'MAIN BOARD 6.1'),
      n('d10', 'tenant_db', 'DB-10', null, 'Ten'),
      n('d05', 'tenant_db', 'DB-05', null, 'Five'),
    ])
    const m = (tag: string) => matchBlock({ tag, name: null }, idx)
    for (const tag of ['MB-6.1 GEN', 'MB-6.1 SPARE', 'MB-6.1 SECTION B', 'MB-6.1 WHATEVER ELSE']) {
      expect(m(tag)).toEqual({ state: 'unconfirmed', tag: 'MB-6.1', text: tag, candidateIds: ['mb'] })
    }
    expect(m('DB-10 SHOP')).toEqual({ state: 'unconfirmed', tag: 'DB-10', text: 'DB-10 SHOP', candidateIds: ['d10'] })
    // METER ROOM is a place, not a meter.
    expect(m('DB-05 METER ROOM')).toEqual({ state: 'unconfirmed', tag: 'DB-05', text: 'DB-05 METER ROOM', candidateIds: ['d05'] })
    expect(m('DB-99 SHOP')).toEqual({ state: 'unconfirmed', tag: 'DB-99', text: 'DB-99 SHOP', candidateIds: [] })
  })

  it('a meter or incomer inside a main board is part of it, not a board', () => {
    const idx = buildNodeIndex([n('mb', 'rmu', 'MAIN BOARD 6.1', null, 'MAIN BOARD 6.1')])
    expect(matchBlock({ tag: 'MB-6.1 BULK CHECK METER', name: 'MAIN BOARD 6.1' }, idx)).toEqual({ state: 'part_of', tag: 'MB-6.1', role: 'meter' })
    expect(matchBlock({ tag: 'MB-6.1 INCOMMING COUNCIL', name: 'x' }, idx)).toEqual({ state: 'part_of', tag: 'MB-6.1', role: 'incomer' })
    // No board needed: the parent is named, never linked.
    expect(matchBlock({ tag: 'MB-7.7 INCOMING GEN', name: null }, idx)).toEqual({ state: 'part_of', tag: 'MB-7.7', role: 'incomer' })
  })

  it('no tag → no_tag', () => {
    expect(match(null, 'Alpha Store')).toEqual({ state: 'no_tag' })
    expect(match(' - ')).toEqual({ state: 'no_tag' })
  })

  it('a node whose code and shop number both equal the key counts once', () => {
    const idx = buildNodeIndex([n('only', 'tenant_db', 'DB-55', 'DB55', 'X')])
    expect(matchBlock({ tag: 'DB-55', name: null }, idx)).toMatchObject({ state: 'matched', nodeId: 'only' })
  })
})

describe('stripLeadingZeros', () => {
  it('drops leading zeros from every run of digits, keeping a lone zero', () => {
    expect(stripLeadingZeros('DB01')).toBe('DB1')
    expect(stripLeadingZeros('DB02A')).toBe('DB2A')
    expect(stripLeadingZeros('MB01.01')).toBe('MB1.1')
    expect(stripLeadingZeros('DB10')).toBe('DB10')
    expect(stripLeadingZeros('DB0')).toBe('DB0')
    expect(stripLeadingZeros('DB-00')).toBe('DB-0')
  })
})

describe('parseNoText', () => {
  it('splits a leading tag from its role words', () => {
    expect(parseNoText('MB-1.1 LOCAL MAIN')).toEqual({ tag: 'MB-1.1', role: 'board' })
    expect(parseNoText('MB-1.1 BULK CHECK METER')).toEqual({ tag: 'MB-1.1', role: 'meter' })
    expect(parseNoText('mb-1.1 check meter')).toEqual({ tag: 'mb-1.1', role: 'meter' })
    expect(parseNoText('MB-1.1 METER')).toEqual({ tag: 'MB-1.1', role: 'meter' })
    expect(parseNoText('MB-1.1 SOLAR CHECK')).toEqual({ tag: 'MB-1.1', role: 'meter' })
    expect(parseNoText('MB-1.1 INCOMING')).toEqual({ tag: 'MB-1.1', role: 'incomer' })
    expect(parseNoText('MB-1.4 INCOMMING GEN')).toEqual({ tag: 'MB-1.4', role: 'incomer' })
    expect(parseNoText('MB-1.4 INCOMING GENERATOR')).toEqual({ tag: 'MB-1.4', role: 'incomer' })
    expect(parseNoText('MB-1.1 INCOMMING COUNCIL')).toEqual({ tag: 'MB-1.1', role: 'incomer' })
    expect(parseNoText('MB-1.1 INCOMER SUPPLY')).toEqual({ tag: 'MB-1.1', role: 'incomer' })
    expect(parseNoText('MB-1.1 BULK METER')).toEqual({ tag: 'MB-1.1', role: 'meter' })
    expect(parseNoText('MB-1.1 INCOMING SOLAR')).toEqual({ tag: 'MB-1.1', role: 'incomer' })
    expect(parseNoText('MB-1.1 MAIN LOCAL')).toEqual({ tag: 'MB-1.1', role: 'board' })
  })
  it('words that are not exactly a board, meter or incomer phrase are unknown', () => {
    for (const t of ['MB-1.1 SPARE', 'MB-1.1 GEN', 'MB-1.1 SECTION B', 'DB-05 METER ROOM', 'MB-1.1 CHECK METER ROOM', 'MB-1.1 INCOMING GEN SPARE', 'MB-1.1 GEN INCOMING', 'MB-1.1 LOCAL SHOP']) {
      expect(parseNoText(t)?.role).toBe('unknown')
    }
  })
  it('reads a spaced head tag (DB 72, MB 1.1) followed by words', () => {
    expect(parseNoText('MB 1.1 BULK CHECK METER')).toEqual({ tag: 'MB 1.1', role: 'meter' })
    expect(parseNoText('DB 72 LOCAL MAIN')).toEqual({ tag: 'DB 72', role: 'board' })
    expect(parseNoText('MB 1.4 INCOMMING GEN')).toEqual({ tag: 'MB 1.4', role: 'incomer' })
    // The second token must carry a digit: a word is not a tag.
    expect(parseNoText('MB LOCAL MAIN')).toBeNull()
  })
  it('a single tag is the board; text without a leading tag is not parsed', () => {
    expect(parseNoText('DB-05')).toEqual({ tag: 'DB-05', role: 'board' })
    expect(parseNoText('KIOSK 7')).toEqual({ tag: 'KIOSK 7', role: 'board' })
    for (const t of ['GENERATOR 2.1 INCOMING', 'BULK CHECK METER', 'GENERATOR BUS 1', '', null, 'MB-1.1 2 3']) expect(parseNoText(t)).toBeNull()
  })
})

describe('isTagShaped', () => {
  it('accepts board tags and KIOSK n', () => {
    for (const t of ['DB-05', 'DB-20/21', 'DB-ZR7', 'MB-3.1', 'DB-K07', 'DB-CM', ' KIOSK 7 ', 'DB 72', 'MB 3.1']) expect(isTagShaped(t)).toBe(true)
  })
  it('rejects empty, sentences and over-long text', () => {
    for (const t of ['', '  ', null, 'BULK CHECK METER', 'HELLO', 'A-1234567890123456', 'GENERATOR 2.1 INCOMING', 'MB-1.1 LOCAL MAIN']) expect(isTagShaped(t)).toBe(false)
  })
})
