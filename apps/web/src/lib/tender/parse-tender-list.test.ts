import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { parseTenderList, splitEmails } from './parse-tender-list'

// Synthetic data only: the real list holds personal contact details. The shapes
// below mirror its quirks (continuation rows, several emails in one cell,
// "Name <email>" wrappers, quotes, a stray trailing '>', a #NAME? column).
async function build(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const el = wb.addWorksheet('ELECTRICAL')
  el.addRow(['COMPANY NAME', 'CONTACT PERSON', 'CELL', 'EMAIL', 'Column1'])
  el.addRow(['ALPHA ELECTRICAL ', 'Ann Able', '011 000 0001', 'ann@alpha.example', '#NAME?'])
  el.addRow(['BETA ELECTRICAL', 'Ben Bee', '082 000 0002\n011 000 0002', 'ben@beta.example  admin@beta.example', '#NAME?'])
  el.addRow(['GAMMA CC', 'Gail', '083 000 0003', "'gail@gamma.example'", null])
  el.addRow([null, 'Gus (second contact)', '084 000 0004', 'gus@gamma.example>', null])
  el.addRow(['DELTA', 'Dee', '085 000 0005', 'Dee Delta <dee@delta.example>', null])
  el.addRow(['NO MAIL CO', 'Nemo', '086 000 0006', null, null])
  el.addRow(['BROKEN MAIL', 'Bob', '087', 'bob@@broken', null])
  const gen = wb.addWorksheet('GENERATOR')
  gen.addRow(['COMPANY NAME', 'CONTACT PERSON', 'CELL', 'EMAIL'])
  gen.addRow(['EPSILON POWER', 'Eve', '011 000 0010', 'eve@epsilon.example'])
  const tl = wb.addWorksheet('TENDER LIST')
  tl.addRow(['WATSON MATTHEUS CONSULTING ELECTRICAL ENGINEERS'])
  tl.addRow(['ELECTRICAL  CONTRACT: '])
  tl.addRow(['TENDER LIST'])
  tl.addRow([null, 'COMPANY NAME', 'CONTACT PERSON', 'CELL', 'EMAIL', 'PRICE (EXCL VAT)', 'VAT', 'PRICE (INCL VAT)'])
  tl.addRow([1, 'ALPHA ELECTRICAL', 'Ann Able', '011 000 0001', 'ann@alpha.example', null, 0, 0])
  tl.addRow([2, 'BETA ELECTRICAL', 'Ben Bee', '082 000 0002', 'ben@beta.example', null, 0, 0])
  tl.addRow([3, null, null, null, null, null, 0, 0])
  wb.addWorksheet('Sheet1')
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('splitEmails', () => {
  it('splits, unwraps, lower-cases and validates', () => {
    expect(splitEmails('Ben@Beta.example  admin@beta.example')).toEqual({ valid: ['ben@beta.example', 'admin@beta.example'], invalid: [] })
    expect(splitEmails("'gail@gamma.example'")).toEqual({ valid: ['gail@gamma.example'], invalid: [] })
    expect(splitEmails('Dee Delta <dee@delta.example>')).toEqual({ valid: ['dee@delta.example'], invalid: [] })
    expect(splitEmails('gus@gamma.example>')).toEqual({ valid: ['gus@gamma.example'], invalid: [] })
    expect(splitEmails('a@x.example / b@x.example; c@x.example')).toEqual({ valid: ['a@x.example', 'b@x.example', 'c@x.example'], invalid: [] })
    expect(splitEmails('bob@@broken')).toEqual({ valid: [], invalid: ['bob@@broken'] })
    expect(splitEmails('paulvw@energy .co.za')).toEqual({ valid: [], invalid: ['paulvw@energy .co.za'] })
  })
})

describe('parseTenderList', () => {
  it('reads each trade sheet as companies with all their contacts', async () => {
    const r = await parseTenderList(await build())
    const el = r.trades.find((t) => t.trade === 'ELECTRICAL')!
    expect(el.companies.map((c) => c.companyName)).toEqual(['ALPHA ELECTRICAL', 'BETA ELECTRICAL', 'GAMMA CC', 'DELTA', 'NO MAIL CO', 'BROKEN MAIL'])
    const gamma = el.companies.find((c) => c.companyName === 'GAMMA CC')!
    expect(gamma.contacts.map((c) => [c.name, c.emails])).toEqual([
      ['Gail', ['gail@gamma.example']],
      ['Gus (second contact)', ['gus@gamma.example']],
    ])
    expect(el.companies.find((c) => c.companyName === 'BETA ELECTRICAL')!.contacts[0].emails).toEqual(['ben@beta.example', 'admin@beta.example'])
    expect(r.trades.map((t) => t.trade)).toEqual(['ELECTRICAL', 'GENERATOR'])
  })

  it('reads the project TENDER LIST (selected bidders), skipping empty numbered rows', async () => {
    const r = await parseTenderList(await build())
    expect(r.selected.map((s) => [s.number, s.companyName, s.emails])).toEqual([
      [1, 'ALPHA ELECTRICAL', ['ann@alpha.example']],
      [2, 'BETA ELECTRICAL', ['ben@beta.example']],
    ])
  })

  it('reports companies without a usable email instead of guessing', async () => {
    const r = await parseTenderList(await build())
    expect(r.problems).toEqual([
      { sheet: 'ELECTRICAL', row: 7, company: 'NO MAIL CO', problem: 'no email address' },
      { sheet: 'ELECTRICAL', row: 8, company: 'BROKEN MAIL', problem: 'invalid email "bob@@broken"' },
    ])
  })
})
