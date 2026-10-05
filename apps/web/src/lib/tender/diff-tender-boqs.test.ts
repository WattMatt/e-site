import { describe, it, expect } from 'vitest'
import { parseTenderWorkbook } from './parse-tender-workbook'
import { diffTenderBoqs } from './diff-tender-boqs'
import { buildMvlWorkbook, buildWmWorkbook } from './__fixtures__/workbooks'

describe('diffTenderBoqs', () => {
  it('an issued copy and its pre-priced copy are structurally identical', async () => {
    const issued = await parseTenderWorkbook(await buildWmWorkbook())
    const priced = await parseTenderWorkbook(await buildWmWorkbook({ priced: true }))
    expect(diffTenderBoqs(issued, priced)).toEqual({ identical: true, added: [], removed: [], changed: [] })
  })

  it('reports a changed quantity, a removed row and an added row between revisions', async () => {
    const r8 = await parseTenderWorkbook(await buildWmWorkbook())
    const r9 = await parseTenderWorkbook(await buildWmWorkbook({ c12Qty: 150, dropC13: true, addC14: true }))
    const d = diffTenderBoqs(r8, r9)
    expect(d.identical).toBe(false)
    expect(d.changed).toEqual([{ sheet: 'C - Reticulation', code: 'C1.2', field: 'quantity', before: 120, after: 150 }])
    expect(d.removed).toEqual([{ sheet: 'C - Reticulation', code: 'C1.3', description: 'Cable terminations 95mm² 4c' }])
    expect(d.added).toEqual([{ sheet: 'C - Reticulation', code: 'C1.4', description: 'Earth leakage relay' }])
  })

  it('reports a description edit', async () => {
    const a = await parseTenderWorkbook(await buildMvlWorkbook())
    const b = await parseTenderWorkbook(await buildMvlWorkbook())
    const item = b.sheets[2].rows.find((r) => r.code === '3.2')!
    item.description = 'Scanning of cable route (GPR)'
    expect(diffTenderBoqs(a, b).changed).toEqual([
      { sheet: 'Bill No 3', code: '3.2', field: 'description', before: 'Scanning of cable route', after: 'Scanning of cable route (GPR)' },
    ])
  })

  it('a priced copy that put a price on a heading shows it as an added item', async () => {
    // The MVL file prices "2.1.4 Cable Marking Tape" AND its child "2.1.4.1 S - Supply".
    const issued = await parseTenderWorkbook(await buildMvlWorkbook({ unpriced: true }))
    const priced = await parseTenderWorkbook(await buildMvlWorkbook())
    const d = diffTenderBoqs(issued, priced)
    expect(d.added.map((a) => a.code)).toContain('2.1.4')
  })
})
