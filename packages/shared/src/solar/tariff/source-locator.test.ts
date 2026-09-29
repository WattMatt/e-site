import { describe, it, expect } from 'vitest'
import { describeLocator, findTextBox } from './source-locator'

describe('source locators', () => {
  it('a PDF locator points at a page', () => {
    expect(describeLocator({ page: 12, raw_text: 'Energy charge 247.76 c/kWh', label: 'Energy' }))
      .toEqual({ kind: 'pdf_page', page: 12, rawText: 'Energy charge 247.76 c/kWh', label: 'Energy' })
  })
  it('a workbook locator is a cell snippet', () => {
    expect(describeLocator({ sheet: 'CITY POWER', cell: 'D14', label: 'Basic', raw_text: '157.91', raw_unit: 'R/month' }))
      .toEqual({ kind: 'cell', sheet: 'CITY POWER', cell: 'D14', label: 'Basic', rawText: '157.91', rawUnit: 'R/month' })
    expect(describeLocator({ sheet: 'S', row: 14, col: 'D' })).toMatchObject({ kind: 'cell', cell: 'D14' })
  })
  it('nothing to show', () => {
    expect(describeLocator({})).toEqual({ kind: 'none' })
  })
  it('finds the text item holding the cited value on a PDF page', () => {
    const items = [
      { str: 'Basic charge', transform: [1, 0, 0, 10, 50, 700], width: 60, height: 10 },
      { str: 'Energy charge  247.76 c/kWh', transform: [1, 0, 0, 10, 50, 680], width: 140, height: 10 },
    ]
    expect(findTextBox(items, 'Energy charge 247.76 c/kWh')).toEqual({ x: 50, y: 680, width: 140, height: 10 })
    expect(findTextBox(items, '247.76')).toEqual({ x: 50, y: 680, width: 140, height: 10 })
    expect(findTextBox(items, 'nowhere')).toBeNull()
  })
})
