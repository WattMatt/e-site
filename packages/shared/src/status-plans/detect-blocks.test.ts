import { describe, it, expect } from 'vitest'
import { detectBlocks } from './detect-blocks'
import { rectToPoints } from './geometry'
import { textItemsToImageSpace } from './text-space'
import { ALPHA, BRAVO, CHARLIE, DELTA_NO_TAG, PITCH, blockItems, textAt, toRotated90UserSpace } from './__fixtures__/db-block-layout'

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

const tags = (r: ReturnType<typeof detectBlocks>) => r.blocks.map((b) => b.tag)

describe('detectBlocks — neighbours never leak into each other', () => {
  it('a neighbouring block crowded against the value column does not lend its values', () => {
    // ALPHA's values end at x = 216; BRAVO's label column starts at 230 and its
    // values at 280, well inside ALPHA's 25h value window (up to 350).
    const r = detectBlocks([...blockItems({ x: 100, y: 100, values: ALPHA }), ...blockItems({ x: 230, y: 100, values: BRAVO })])
    expect(tags(r)).toEqual(['DB-71', 'DB-72'])
    expect(r.blocks[0].name).toBe('ALPHA STORE')
    expect(r.blocks[0].fields.CT).toBe('250/5A')
    expect(r.blocks[1].name).toBe('BRAVO SHOP')
    expect(r.blocks[1].fields.CT).toBeNull()
  })

  it('two blocks stacked tight in one column are each read whole', () => {
    // CHARLIE's NO: sits one row pitch below ALPHA's CT:.
    const r = detectBlocks([
      ...blockItems({ x: 100, y: 100, values: ALPHA }),
      ...blockItems({ x: 100, y: 100 + 7 * PITCH, values: CHARLIE }),
    ])
    expect(tags(r)).toEqual(['DB-71', 'DB-90/91'])
    expect(r.blocks[1].fields.NAME).toBe('CHARLIE HALL')
    expect(Object.values(r.blocks[0].fields).filter((v) => v !== null)).toHaveLength(7)
  })

  it('text far right on the same baseline is not part of the value', () => {
    const r = detectBlocks([...blockItems({ x: 100, y: 100, values: ALPHA }), textAt('FAR NOTE', 100 + 260, 116)])
    expect(r.blocks[0].name).toBe('ALPHA STORE')
  })
})

describe('detectBlocks — a damaged block drops, it never merges', () => {
  it('MUTATION FIXTURE: a label shifted off its column drops that block only', () => {
    const r = detectBlocks([
      ...blockItems({ x: 100, y: 100, values: ALPHA, shiftLabel: { row: 1, dx: 20 } }),
      ...blockItems({ x: 230, y: 100, values: BRAVO }),
      ...blockItems({ x: 100, y: 100 + 7 * PITCH, values: CHARLIE }),
    ])
    expect(tags(r)).toEqual(['DB-72', 'DB-90/91'])
    expect(r.blocks.find((b) => b.tag === 'DB-90/91')!.fields.NAME).toBe('CHARLIE HALL')
    expect(r.labelCount).toBe(3)
    expect(r.rejected).toHaveLength(1)
    expect(r.rejected[0].tag).toBe('DB-71')
    expect(r.rejected[0].reason).toContain('NAME:')
  })

  it('MUTATION FIXTURE (row gap): a missing CT: never reaches a stray CT: far below', () => {
    const r = detectBlocks([
      ...blockItems({ x: 100, y: 100, values: ALPHA, omitLabel: 6 }),
      textAt('CT:', 100, 100 + 5 * PITCH + 60), // a legend entry 6h below SERIAL:
    ])
    expect(r.blocks).toEqual([])
    expect(r.rejected[0].reason).toContain('CT:')
  })

  it("MUTATION FIXTURE (expected label): a missing CT: never takes the next block's NO:", () => {
    // CHARLIE's NO: sits exactly where ALPHA's CT: would be (ALPHA's CT value
    // is blanked too, or it would share CHARLIE's NO: baseline and value column).
    const alphaNoCt = [...ALPHA.slice(0, 6), ''] as unknown as typeof ALPHA
    const r = detectBlocks([
      ...blockItems({ x: 100, y: 100, values: alphaNoCt, omitLabel: 6 }),
      ...blockItems({ x: 100, y: 100 + 6 * PITCH, values: CHARLIE }),
    ])
    expect(tags(r)).toEqual(['DB-90/91'])
    expect(Object.values(r.blocks[0].fields).filter((v) => v !== null)).toHaveLength(7)
  })
})

describe('detectBlocks — a /Rotate 90 sheet', () => {
  it('reads the same blocks as the upright layout once items pass through the viewport', () => {
    const upright = [
      ...blockItems({ x: 100, y: 100, values: ALPHA }),
      ...blockItems({ x: 230, y: 100, values: BRAVO }),
      ...blockItems({ x: 100, y: 100 + 7 * PITCH, values: DELTA_NO_TAG }),
    ]
    const viewport90 = [0, 2, 2, 0, 0, 0] as const
    const fromPdf = textItemsToImageSpace(toRotated90UserSpace(upright), viewport90)
    expect(fromPdf).toEqual(upright)
    expect(detectBlocks(fromPdf)).toEqual(detectBlocks(upright))
    expect(tags(detectBlocks(fromPdf))).toEqual(['DB-71', 'DB-72', null])
  })
})
