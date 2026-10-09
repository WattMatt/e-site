import { describe, it, expect } from 'vitest'
import { detectBlocks } from './detect-blocks'
import { rectToPoints } from './geometry'
import { ALPHA, CHARLIE, DELTA_NO_TAG, blockItems, textAt } from './__fixtures__/db-block-layout'

describe('detectBlocks — one block', () => {
  it('reads the tag, the name, every field and the block rectangle', () => {
    const r = detectBlocks(blockItems({ x: 100, y: 100, values: ALPHA }))
    expect(r.labelCount).toBe(1)
    expect(r.rejected).toEqual([])
    expect(r.blocks).toHaveLength(1)
    const [b] = r.blocks
    expect(b.tag).toBe('DB-71')
    expect(b.name).toBe('ALPHA STORE')
    expect(b.fields).toEqual({
      NO: 'DB-71', NAME: 'ALPHA STORE', AREA: '412.50m2', RATING: '250A TP',
      CABLE: '4C 95mm2 CU', SERIAL: 'ZX-0001', CT: '250/5A',
    })
    // pad = 0.5h = 5: left 100-5; top = NO top (90) - 5; right = widest value (150 + 11*6 = 216) + 5;
    // bottom = CT baseline (196) + 0.25h + 5
    expect(b.box).toEqual({ minX: 95, minY: 85, maxX: 221, maxY: 203.5 })
    expect(b.points).toEqual(rectToPoints(95, 85, 221, 203.5))
  })

  it('proposes a block whose NO: cell is empty, with a null tag and its name kept', () => {
    const r = detectBlocks(blockItems({ x: 100, y: 100, values: DELTA_NO_TAG }))
    expect(r.blocks).toHaveLength(1)
    expect(r.blocks[0].tag).toBeNull()
    expect(r.blocks[0].name).toBe('DELTA KIOSK')
    expect(r.blocks[0].fields.SERIAL).toBeNull()
  })

  it('keeps a combined tag verbatim', () => {
    const r = detectBlocks(blockItems({ x: 100, y: 100, values: CHARLIE }))
    expect(r.blocks[0].tag).toBe('DB-90/91')
  })

  it('reads a label and its value printed as one text run ("NO: DB-74")', () => {
    const items = blockItems({ x: 100, y: 100, values: ['', 'ECHO UNIT', '1m2', '10A SP', '2C', 'ZX-9', '-'] })
    const noLabel = items.findIndex((i) => i.str === 'NO:')
    items[noLabel] = textAt('NO: DB-74', 100, 100)
    const r = detectBlocks(items)
    expect(r.blocks[0].tag).toBe('DB-74')
  })

  it('reads a block printed at twice the text height (tolerances scale with the label)', () => {
    const r = detectBlocks(blockItems({ x: 100, y: 100, values: ALPHA, h: 20 }))
    expect(r.blocks).toHaveLength(1)
    expect(r.blocks[0].fields.CT).toBe('250/5A')
  })

  it('finds nothing on a page with no NO: labels', () => {
    const r = detectBlocks([textAt('NOTE: SEE LEGEND', 10, 10), textAt('DB-71', 100, 100)])
    expect(r).toEqual({ labelCount: 0, blocks: [], rejected: [] })
  })
})
