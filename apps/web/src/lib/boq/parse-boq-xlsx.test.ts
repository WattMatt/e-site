// @vitest-environment node
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { parseBoqXlsx } from './parse-boq-xlsx'

const HDR = ['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'SUPPLY', 'INSTALL', 'AMOUNT']

// Build a tiny but representative workbook in code:
//  - a Main Summary (bill index + totals)
//  - one Mall sheet (1.x)  → folds into a synthetic MALL PORTION bill
//  - one tenant sheet (N-NN) → its own bill
//  - a prose sheet           → skipped
async function buildWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()

  // Mall sheet: C1.1 = 1×(100+50)=150, C1.2 = 2×(100+0)=200  → 350
  const mall = wb.addWorksheet('1.3 Low Voltage')
  mall.addRows([
    ['KINGSWALK'],
    [],
    HDR,
    ['C1', 'LV CABLE LAID IN GROUND'],
    [null, 'Rates to include for supply...'],
    ['C1.1', '4C x 240mm', 'm', 1, 100, 50, 150],
    ['C1.2', '4C x 185mm', 'm', 2, 100, 0, 200],
  ])

  // Tenant sheet: C1.1 = 10×(5+1)=60  → 60
  const tenant = wb.addWorksheet('7-18 Shoprite')
  tenant.addRows([
    HDR,
    ['C1', 'DISTRIBUTION BOARD'],
    ['C1.1', 'DB cabling', 'm', 10, 5, 1, 60],
  ])

  // Main Summary: item 1 = MALL (350); item 7 = Shoprite (60) — itemNo matches
  // the tenant sheet's leading number ("7-18 Shoprite" → 7); totals. The VAT and
  // incl-VAT rows are intentionally UNLABELED (just a value), mirroring the real
  // file, so the parser must read incl-VAT as the last numeric value.
  const summary = wb.addWorksheet('Main Summary')
  summary.addRows([
    ['ITEM', 'DESCRIPTION'],
    ['1', 'MALL', null, null, null, 350],
    ['7', 'Shoprite', null, null, null, 60],
    [null, 'TOTAL (EXCLUSIVE OF VAT)', null, null, null, 410],
    [null, null, null, null, null, 61.5],
    [null, null, null, null, null, 471.5],
  ])

  // Prose sheet.
  const prose = wb.addWorksheet('NOTES TO TENDERER')
  prose.addRows([['All "Rate only" requests must be...'], ['No header here']])

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

describe('parseBoqXlsx', () => {
  it('produces a MALL bill + a tenant bill, skips prose, and links the tree', async () => {
    const buf = await buildWorkbook()
    const parsed = await parseBoqXlsx(buf)

    // Two bills: MALL PORTION + Shoprite.
    expect(parsed.bills).toHaveLength(2)

    const mall = parsed.bills.find((b) => b.tempId === 'bill#MALL_PORTION')!
    expect(mall).toBeTruthy()
    expect(mall.title).toBe('MALL')
    expect(mall.expectedTotal).toBe(350)

    const tenant = parsed.bills.find((b) => b.tempId === 'bill#7-18 Shoprite')!
    expect(tenant).toBeTruthy()
    expect(tenant.title).toBe('Shoprite')
    expect(tenant.expectedTotal).toBe(60)

    // A known item amount survives the round-trip.
    const known = mall.items.find((i) => i.code === 'C1.1')!
    expect(known.amount).toBe(150)
    expect(known.supplyRate).toBe(100)
    expect(known.installRate).toBe(50)

    // Prose sheet is skipped (not a summary/bill).
    expect(parsed.skippedSheets).toContain('NOTES TO TENDERER')

    // Every non-root section has a non-empty parentTempId (the orchestrator
    // filled the empty parentTempId that parseSheet leaves on categories).
    const categories = [...mall.sections, ...tenant.sections].filter((s) => s.kind === 'category')
    expect(categories.length).toBeGreaterThan(0)
    for (const c of categories) expect(c.parentTempId).not.toBe('')

    // Summary totals captured.
    expect(parsed.totalExVatExpected).toBe(410)
    expect(parsed.grandTotalExpected).toBe(410)
    expect(parsed.vatExpected).toBe(61.5)
    expect(parsed.totalInclVatExpected).toBe(471.5)
  })

  it('folds 1.x sheets as section nodes under the MALL bill root', async () => {
    const buf = await buildWorkbook()
    const parsed = await parseBoqXlsx(buf)
    const mall = parsed.bills.find((b) => b.tempId === 'bill#MALL_PORTION')!

    // The 1.3 sheet became a section node parented to the bill root.
    const sheetNode = mall.sections.find((s) => s.tempId === 'section#1.3 Low Voltage')!
    expect(sheetNode).toBeTruthy()
    expect(sheetNode.kind).toBe('section')
    expect(sheetNode.parentTempId).toBe('bill#MALL_PORTION')

    // The category C1 is parented to that section node (not the bill root).
    const cat = mall.sections.find((s) => s.code === 'C1')!
    expect(cat.parentTempId).toBe('section#1.3 Low Voltage')

    // Items reference their category.
    expect(mall.items.find((i) => i.code === 'C1.1')!.sectionTempId).toBe(cat.tempId)
  })
})

// A workbook exercising the leading-number tenant match (Boxer vs Boxer Liquor)
// and a non-1.x bill sheet (P&G) that must fold into the MALL portion.
async function buildMatchWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()

  // P&G — a NON-tenant, non-1.x bill sheet with a single lump-sum coded row.
  const pg = wb.addWorksheet('P&G')
  pg.addRows([HDR, ['A1', 'Preliminaries & General', 'Sum', null, null, null, 5000]])

  // A 1.x mall sheet too, so MALL has both a 1.x and the P&G section.
  const mv = wb.addWorksheet('1.2 Medium Voltage')
  mv.addRows([HDR, ['C1', 'MV CAT'], ['C1.1', 'MV cable', 'm', 1, 100, 0, 100]])

  // Two tenants whose NAMES would collide under fuzzy matching but whose leading
  // numbers are distinct: "2-5 Boxer" → 2, "3-6 Boxer Liquor" → 3.
  const boxer = wb.addWorksheet('2-5 Boxer')
  boxer.addRows([HDR, ['C1', 'DB'], ['C1.1', 'cabling', 'm', 10, 5, 1, 60]])
  const boxerLiq = wb.addWorksheet('3-6 Boxer Liquor')
  boxerLiq.addRows([HDR, ['C1', 'DB'], ['C1.1', 'cabling', 'm', 20, 5, 1, 120]])

  // Summary: item 1 = MALL, item 2 = BOXER, item 3 = BOXER LIQUOR.
  const summary = wb.addWorksheet('Main Summary')
  summary.addRows([
    ['ITEM', 'DESCRIPTION'],
    ['1', 'MALL PORTION', null, null, null, 5100],
    ['2', 'BOXER', null, null, null, 60],
    ['3', 'BOXER LIQUOR', null, null, null, 120],
    [null, 'TOTAL (EXCLUSIVE OF VAT)', null, null, null, 5280],
  ])

  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('parseBoqXlsx — tenant matching + MALL grouping', () => {
  it('matches tenants by leading number, never swapping Boxer ↔ Boxer Liquor', async () => {
    const parsed = await parseBoqXlsx(await buildMatchWorkbook())

    const boxer = parsed.bills.find((b) => b.tempId === 'bill#2-5 Boxer')!
    expect(boxer.code).toBe('2')
    expect(boxer.title).toBe('BOXER')
    expect(boxer.expectedTotal).toBe(60)

    const boxerLiq = parsed.bills.find((b) => b.tempId === 'bill#3-6 Boxer Liquor')!
    expect(boxerLiq.code).toBe('3')
    expect(boxerLiq.title).toBe('BOXER LIQUOR')
    expect(boxerLiq.expectedTotal).toBe(120)
  })

  it('folds a non-1.x bill sheet (P&G) into the MALL portion as a section node', async () => {
    const parsed = await parseBoqXlsx(await buildMatchWorkbook())

    // P&G is NOT its own bill — only MALL + the two tenant bills exist.
    expect(parsed.bills.find((b) => b.tempId === 'bill#P&G')).toBeUndefined()
    expect(parsed.bills).toHaveLength(3)

    const mall = parsed.bills.find((b) => b.tempId === 'bill#MALL_PORTION')!
    // P&G is a section node under the MALL bill root.
    const pgNode = mall.sections.find((s) => s.tempId === 'section#P&G')!
    expect(pgNode).toBeTruthy()
    expect(pgNode.kind).toBe('section')
    expect(pgNode.parentTempId).toBe('bill#MALL_PORTION')

    // P&G's lump-sum item rode in under the MALL bill, value preserved.
    const pgItem = mall.items.find((i) => i.code === 'A1')!
    expect(pgItem.amount).toBe(5000)
    expect(pgItem.quantityMode).toBe('lump_sum')

    // MALL's stored amounts (P&G 5000 + MV 100) sum to its expected total 5100.
    const mallStored = mall.items.reduce((s, it) => s + (it.amount ?? 0), 0)
    expect(mallStored).toBe(5100)
    expect(mall.expectedTotal).toBe(5100)
  })
})
