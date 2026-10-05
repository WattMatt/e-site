import { describe, expect, it } from 'vitest'
import { parsePricedSheets, splitExtractedSheetText } from './parse-priced-sheets'

// Synthetic sheet in the MVL layout. Invented rates — never a real contractor's.
const TEXT = `--- sheet: Summary ---
ITEM, DESCRIPTION, UNIT, QTY, TOTAL, ,
1, BILL NO. 1 :, , , , ,

--- sheet: Bill No 2 ---
BILLS OF QUANTITIES, , , , , , 01/02/2026,
ITEM, DESCRIPTION, , UNIT, QTY, RATE Excl VAT, TOTAL Excl VAT,
2.1, SUPPLY CABLE TO SITE, , , , , ,
2.1.1, Excavate, backfill and compact, by hand, , m, 10, 100, 1000,
2.1.3, MV Cable 95mm² x 3 AL 11KV XLPE , , , , , ,
2.1.3.1, S - Supply , , m, 10, 50, 500,
2.1.3.2, I - Install, , m, 10, 5, 50,
2.1.3.3, T - End Glanded Terminated , , no, 2, 300, 600,
2.1.3.5, Pot End Cable, , no, 0, , 0,
, Concrete Block Protection for Cables, , , , , ,
2.1.5, Cable Route Markers, , , , , ,
2.1.5.1, S - Supply, , no, 4, 10, 40,
TOTAL FOR BILL NO 2 - CARRIED FORWARD TO SUMMARY, , , , , , 2190,
`

describe('splitExtractedSheetText', () => {
  it('rebuilds rows and keeps commas that belong to a description', () => {
    const sheets = splitExtractedSheetText(TEXT)
    expect(sheets.map(s => s.name)).toEqual(['Summary', 'Bill No 2'])
    const row = sheets[1].rows.find(r => r[0] === '2.1.1')!
    expect(row.slice(0, 7)).toEqual(['2.1.1', 'Excavate, backfill and compact, by hand', '', 'm', '10', '100', '1000'])
  })
})

describe('parsePricedSheets', () => {
  const parsed = parsePricedSheets(splitExtractedSheetText(TEXT))

  it('builds the section path from heading rows', () => {
    const exc = parsed.lines.find(l => l.code === '2.1.1')!
    expect(exc.sectionPath).toEqual(['Bill No 2', 'SUPPLY CABLE TO SITE'])
    expect(exc).toMatchObject({ unit: 'm', quantity: 10, rate: 100, amount: 1000, sheet: 'Bill No 2' })
  })

  it('merges S - Supply and I - Install under one parent into one line', () => {
    const cable = parsed.lines.find(l => l.code === '2.1.3.1')!
    expect(cable).toMatchObject({
      description: 'MV Cable 95mm² x 3 AL 11KV XLPE', supplyRate: 50, installRate: 5, rate: null, amount: 550, mergedCodes: ['2.1.3.1', '2.1.3.2'],
    })
    expect(cable.sectionPath.at(-1)).toBe('MV Cable 95mm² x 3 AL 11KV XLPE')
    expect(parsed.lines.find(l => l.code === '2.1.3.2')).toBeUndefined()
  })

  it('keeps a supply-only child as supply-only', () => {
    const m = parsed.lines.find(l => l.code === '2.1.5.1')!
    expect(m).toMatchObject({ description: 'Cable Route Markers', supplyRate: 10, installRate: null })
  })

  it('reconciles each bill to its stated total, to the cent', () => {
    const rec = parsed.reconciliation.find(r => r.sheet === 'Bill No 2')!
    expect(rec).toEqual({ sheet: 'Bill No 2', statedTotal: 2190, sumOfLines: 2190, difference: 0 })
  })

  it('a priced row is the parent of the rows under it (never an earlier heading)', () => {
    const sheets = splitExtractedSheetText(`--- sheet: B ---
ITEM, DESCRIPTION, , UNIT, QTY, RATE Excl VAT, TOTAL Excl VAT,
2.1.3, MV Cable 95mm² x 3 AL 11KV XLPE , , , , , ,
2.1.3.1, S - Supply , , m, 10, 50, 500,
2.1.4, Cable Marking Tape, , m, 10, 1, 10,
2.1.4.1, S - Supply, , m, 10, 2, 20,
`)
    const tape = parsePricedSheets(sheets).lines.find(l => l.code === '2.1.4.1')!
    expect(tape.description).toBe('Cable Marking Tape')
    expect(tape.sectionPath.at(-1)).toBe('Cable Marking Tape')
  })

  it('a numbered heading followed by siblings introduces them', () => {
    const sheets = splitExtractedSheetText(`--- sheet: B ---
ITEM, DESCRIPTION, , UNIT, QTY, RATE Excl VAT, TOTAL Excl VAT,
2.1.1, Excavate for Linear Meter, , m, 10, , ,
2.1.1.1, Excavate 600mm Wide & 1400mm deep, , , , , ,
2.1.1.2, Pickable Soil, , m, 5, 100, 500,
2.1.2, Cross Cuts, , , , , ,
2.1.2.1, Crosscut, , no, 1, 10, 10,
`)
    const lines = parsePricedSheets(sheets).lines
    expect(lines.find(l => l.code === '2.1.1.2')!.sectionPath).toEqual(['B', 'Excavate for Linear Meter', 'Excavate 600mm Wide & 1400mm deep'])
    expect(lines.find(l => l.code === '2.1.2.1')!.sectionPath).toEqual(['B', 'Cross Cuts'])
  })

  it('keeps the source row number of every line', () => {
    expect(parsed.lines.find(l => l.code === '2.1.3.3')!.row).toBeGreaterThan(0)
  })
})
