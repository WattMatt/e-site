import { describe, expect, it } from 'vitest'
import { cellValueFromExcel, colToLetters, gridFromCells, lettersToCol, parseAddress } from './grid'

describe('grid', () => {
  it('converts column letters both ways', () => {
    expect(colToLetters(1)).toBe('A')
    expect(colToLetters(28)).toBe('AB')
    expect(lettersToCol('AC')).toBe(29)
    expect(parseAddress('X11')).toEqual({ row: 11, col: 24 })
  })
  it('reads exceljs rich text, shared-formula results and plain values', () => {
    expect(cellValueFromExcel({ richText: [{ text: 'R37' }, { text: ',64' }] })).toBe('R37,64')
    expect(cellValueFromExcel({ result: 378.67, sharedFormula: 'J11' })).toBe(378.67)
    expect(cellValueFromExcel({ formula: 'ROUND(E11*1.15,2)' })).toBeNull()
    expect(cellValueFromExcel(227.28)).toBe(227.28)
    expect(cellValueFromExcel(undefined)).toBeNull()
  })
  it('serves a fixture as a grid', () => {
    const g = gridFromCells('S', { A1: 'x', C4: 2 })
    expect([g.maxRow, g.maxCol, g.get(4, 3), g.get(2, 2)]).toEqual([4, 3, 2, null])
  })
})
