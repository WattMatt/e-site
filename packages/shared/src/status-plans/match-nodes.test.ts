import { describe, it, expect } from 'vitest'
import { buildNodeIndex, matchBlock, normaliseTag, type MatchableNode } from './match-nodes'

const n = (id: string, kind: string, code: string | null, shop_number: string | null, name: string | null): MatchableNode =>
  ({ id, kind, code, shop_number, name })

// Invented project.
const NODES: MatchableNode[] = [
  n('n-71', 'tenant_db', 'DB-71', '71', 'Alpha Store'),
  n('n-72', 'tenant_db', 'DB72', null, 'Bravo Shop'),
  n('n-04', 'tenant_db', null, '04', 'Kiosk Four'),
  n('n-73a', 'tenant_db', 'DB-73', null, 'Delta One'),
  n('n-73b', 'tenant_db', null, 'DB 73', 'Delta Two'),
  n('n-90', 'tenant_db', 'DB-90', null, 'Ninety'),
  n('n-91', 'tenant_db', 'DB-91', null, 'Ninety One'),
  n('n-mb92', 'main_board', null, null, 'MAIN BOARD 9.2'),
  n('n-mb93', 'main_board', 'MAIN BOARD 9.3', null, 'Main board 9.3'),
  n('n-fake', 'tenant_db', null, null, 'MAIN BOARD 9.4'),
  n('n-s9', 'tenant_db', null, 'S-9', 'Sierra'),
]
const index = buildNodeIndex(NODES)
const match = (tag: string | null, name: string | null = null) => matchBlock({ tag, name }, index)

describe('normaliseTag', () => {
  it('uppercases and strips spaces, hyphens, dashes and dots but keeps /', () => {
    expect(normaliseTag('db - 7.1')).toBe('DB71')
    expect(normaliseTag('DB-90/91')).toBe('DB90/91')
    expect(normaliseTag('DB–7 1')).toBe('DB71')
    expect(normaliseTag('DB-SR1')).toBe('DBSR1')
  })
})

describe('matchBlock', () => {
  it('matches nodes.code after normalisation', () => {
    expect(match('DB-71')).toEqual({ state: 'matched', nodeId: 'n-71', via: 'code', tieBrokenByName: false })
    expect(match('db 72')).toEqual({ state: 'matched', nodeId: 'n-72', via: 'code', tieBrokenByName: false })
  })

  it('matches nodes.shop_number', () => {
    expect(match('S 9')).toEqual({ state: 'matched', nodeId: 'n-s9', via: 'shop_number', tieBrokenByName: false })
  })

  it('tries the tag without a leading DB', () => {
    expect(match('DB-04')).toEqual({ state: 'matched', nodeId: 'n-04', via: 'without_db', tieBrokenByName: false })
  })

  it('maps MB-x.y to MAIN BOARD x.y (main-board name or any code)', () => {
    expect(match('MB-9.2')).toEqual({ state: 'matched', nodeId: 'n-mb92', via: 'main_board', tieBrokenByName: false })
    expect(match('MB 9.3')).toEqual({ state: 'matched', nodeId: 'n-mb93', via: 'main_board', tieBrokenByName: false })
  })

  it("never takes the MAIN BOARD alias from a tenant node's name", () => {
    expect(match('MB-9.4')).toEqual({ state: 'unmatched' })
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

  it('no tag → no_tag', () => {
    expect(match(null, 'Alpha Store')).toEqual({ state: 'no_tag' })
    expect(match(' - ')).toEqual({ state: 'no_tag' })
  })

  it('a node whose code and shop number both equal the key counts once', () => {
    const idx = buildNodeIndex([n('only', 'tenant_db', 'DB-55', 'DB55', 'X')])
    expect(matchBlock({ tag: 'DB-55', name: null }, idx)).toMatchObject({ state: 'matched', nodeId: 'only' })
  })
})
