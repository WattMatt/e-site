import { describe, it, expect } from 'vitest'
import { detectBlocks } from './detect-blocks'
import { boxesOverlap, detectedTagFor, detectionSummary, reviewDetection, runDetection } from './detect-review'
import { rectToPoints } from './geometry'
import type { MatchableNode } from './match-nodes'
import { ALPHA, BRAVO, CHARLIE, DELTA_NO_TAG, blockItems, textAt } from './__fixtures__/db-block-layout'

const NODES: MatchableNode[] = [
  { id: 'n-71', kind: 'tenant_db', code: 'DB-71', shop_number: null, name: 'Alpha Store' },
  { id: 'n-72', kind: 'tenant_db', code: 'DB-72', shop_number: null, name: 'Bravo Shop' },
]

// Four blocks far apart: matched, matched, unmatched (combined), no tag.
const ITEMS = [
  ...blockItems({ x: 100, y: 100, values: ALPHA }),
  ...blockItems({ x: 400, y: 100, values: BRAVO }),
  ...blockItems({ x: 100, y: 400, values: CHARLIE }),
  ...blockItems({ x: 400, y: 400, values: DELTA_NO_TAG }),
]

describe('reviewDetection', () => {
  it('sorts proposals into matched · need you · without a tag', () => {
    const r = reviewDetection(detectBlocks(ITEMS), NODES, [])
    expect(r.counts).toEqual({ detected: 4, matched: 2, needsYou: 1, noTag: 1 })
    expect(r.rows.map((x) => [x.block.tag, x.category, x.nodeId])).toEqual([
      ['DB-71', 'matched', 'n-71'],
      ['DB-72', 'matched', 'n-72'],
      ['DB-90/91', 'needs_you', null],
      [null, 'no_tag', null],
    ])
    expect(r.rows[2].reason).toBe('No board in this project has the tag DB-90/91.')
    expect(r.alreadyOnPlan).toBe(0)
    expect(detectionSummary(r)).toBe('Detected 4 blocks — 2 matched · 1 needs you · 1 without a tag')
  })

  it('leaves out blocks that overlap a shape already on the plan (re-run)', () => {
    const existing = [{ id: 's1', points: rectToPoints(90, 80, 150, 120), nodeId: null }]
    const r = reviewDetection(detectBlocks(ITEMS), NODES, existing)
    expect(r.alreadyOnPlan).toBe(1)
    expect(r.rows.map((x) => x.block.tag)).toEqual(['DB-72', 'DB-90/91', null])
  })

  it('a matched board already on the plan elsewhere needs a person', () => {
    const existing = [{ id: 's1', points: rectToPoints(900, 900, 950, 950), nodeId: 'n-71' }]
    const r = reviewDetection(detectBlocks(ITEMS), NODES, existing)
    const row = r.rows.find((x) => x.block.tag === 'DB-71')!
    expect(row.category).toBe('needs_you')
    expect(row.nodeId).toBeNull()
    expect(row.reason).toBe('DB-71 matches a board that is already on this plan.')
  })

  it('two proposals that read as the same board both need a person', () => {
    const twice = [...blockItems({ x: 100, y: 100, values: ALPHA }), ...blockItems({ x: 400, y: 100, values: ALPHA })]
    const r = reviewDetection(detectBlocks(twice), NODES, [])
    expect(r.rows.map((x) => x.category)).toEqual(['needs_you', 'needs_you'])
    expect(r.rows[0].candidateIds).toEqual(['n-71'])
    expect(r.counts.matched).toBe(0)
  })

  it('pluralises the summary', () => {
    const r = reviewDetection(detectBlocks(blockItems({ x: 100, y: 100, values: CHARLIE })), NODES, [])
    expect(detectionSummary(r)).toBe('Detected 1 block — 0 matched · 1 needs you · 0 without a tag')
  })
})

describe('runDetection', () => {
  it('no text at all → no_text (never a silent empty review)', () => {
    expect(runDetection([], NODES, [])).toEqual({ kind: 'no_text' })
  })
  it('text but no complete block → no_blocks with the label count and reasons', () => {
    const out = runDetection([textAt('NO:', 10, 10), textAt('DB-71', 60, 10)], NODES, [])
    expect(out.kind).toBe('no_blocks')
    if (out.kind === 'no_blocks') {
      expect(out.labelCount).toBe(1)
      expect(out.rejected[0].reason).toContain('NAME:')
    }
  })
  it('blocks → review', () => {
    expect(runDetection(ITEMS, NODES, []).kind).toBe('review')
  })
})

describe('detectedTagFor / boxesOverlap', () => {
  it('stores the tag, else the NAME hint, cut to 64 characters', () => {
    expect(detectedTagFor({ tag: 'DB-71', name: 'ALPHA STORE' })).toBe('DB-71')
    expect(detectedTagFor({ tag: null, name: 'DELTA KIOSK' })).toBe('NAME: DELTA KIOSK')
    expect(detectedTagFor({ tag: null, name: null })).toBeNull()
    expect(detectedTagFor({ tag: 'X'.repeat(80), name: null })).toHaveLength(64)
  })
  it('boxes that only touch do not overlap', () => {
    const a = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
    expect(boxesOverlap(a, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(false)
    expect(boxesOverlap(a, { minX: 9, minY: 9, maxX: 20, maxY: 20 })).toBe(true)
  })
})
