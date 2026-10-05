import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { StandardsBrowser, cellText, naturalClauseKey, type BrowserStandard, type BrowserTable } from './StandardsBrowser'

// Synthetic values only — licensed numbers never enter this public repository.
const NEW: BrowserStandard = { id: 's-new', code: 'SANS 99999-1', edition: '3.1', year: 2099, title: 'Synthetic wiring code', publisher: 'SABS', kind: 'standard', status: 'current', superseded_by: null, in_library: true, notes: null }
const OLD: BrowserStandard = { ...NEW, id: 's-old', edition: '2', year: 2090, status: 'superseded', superseded_by: 's-new' }
const MFR: BrowserStandard = { id: 's-mfr', code: 'Maker Facts', edition: 'as transcribed', year: null, title: 'Booklet', publisher: 'Maker', kind: 'manufacturer', status: 'current', superseded_by: null, in_library: false, notes: null }
const EMPTY: BrowserStandard = { ...NEW, id: 's-empty', code: 'SANS 77777', year: 2088, edition: '1' }

const cols = [
  { key: 'n', label: 'Number of cables', unit: null },
  { key: 'a', label: 'Touching', unit: null, group: 'Buried directly' },
  { key: 'b', label: '150 mm', unit: null, group: 'Buried directly' },
]
const cite = (page: number, a: string, b: string) => ({ clause: 'Table 9.1', page_pdf: page + 4, page_printed: page, printed: { n: '', a, b } })
const base = { section_number: '9.1', clause: 'Table 9.1', notes: null, source_ref: null, category: null, verification: null, topic: 'derating' as const, standard: 'x' }
const T_NEW: BrowserTable = {
  ...base, id: 't1', code: 'SANS_99999_1_2099_T9_1', title: 'Grouping factors', provenance: 'extracted', standard_id: 's-new', columns: cols,
  conditions: [{ key: 'ambient_c', label: 'Ambient temperature', unit: '°C', value: '30', page_pdf: 124, page_printed: 120 }],
  rows: [{ data: { n: 2, a: 0.5, b: 0.6 }, citation: cite(120, '0,50', '0,60') }, { data: { n: 3, a: 0.4, b: null }, citation: cite(120, '0,40', '–') }],
  usedBy: [{ calculator: 'Cable schedule', use: 'shows this table and page as the source of its derating factors', href: '/projects' }],
}
const T_OLD: BrowserTable = { ...T_NEW, id: 't2', code: 'SANS_99999_1_2090_T9_1', standard_id: 's-old', usedBy: [] }
const T_LEG: BrowserTable = {
  ...base, id: 't3', code: 'TABLE_6_3_3', title: 'Legacy grouping', clause: 'Table 6.3.3', section_number: '6.3.3', provenance: 'transcribed', standard_id: 's-mfr', conditions: null,
  columns: [{ key: 'n', label: 'Cables', unit: null }, { key: 'ground', label: 'Ground', unit: null }, { key: 'dims', label: 'Diameter', unit: 'mm' }],
  rows: [{ data: { n: 2, ground: 0.5, dims: 12 }, citation: null }], usedBy: [],
  verification: { status: 'partially_verified', checked_on: '2099-01-01', against: [{ standard: 'SANS 99999-1:2099', edition: '3.1', clause: 'Table 9.1', page_printed: 120 }], coverage: { ground: { up_to: 12, whole: true } } },
}
const T_RATING: BrowserTable = { ...T_NEW, id: 't4', code: 'SANS_99999_1_2099_T9_10', clause: 'Table 9.10', title: 'Ratings', topic: 'cable_ratings', usedBy: [] }

// The open table lives in the URL (?t=); every test starts from the list.
beforeEach(() => { window.history.replaceState(null, '', '/standards') })

const renderIt = () => render(<StandardsBrowser standards={[NEW, OLD, MFR, EMPTY]} tables={[T_LEG, T_OLD, T_NEW, T_RATING]} />)

describe('StandardsBrowser — landing', () => {
  it('groups tables by topic, current SANS first, manufacturer data separate', () => {
    renderIt()
    const derating = screen.getByRole('region', { name: 'Derating factors' })
    const summaries = within(derating).getAllByText(/SANS — current edition|SANS — earlier editions|Manufacturer data/).map((e) => e.textContent)
    expect(summaries.map((t) => t!.replace(/\d+$/, '').trim())).toEqual(['SANS — current edition', 'SANS — earlier editions', 'Manufacturer data (Aberdare) used by the cable schedule'])
    expect(screen.getByRole('region', { name: 'Cable current ratings' })).toBeTruthy()
  })
  it('lists source documents, including ones with nothing loaded yet', () => {
    renderIt()
    const sources = screen.getByRole('region', { name: 'Source documents' })
    expect(within(sources).getByText('In the library — no tables loaded yet')).toBeTruthy()
  })
  it('searches across titles, clauses and condition labels', () => {
    renderIt()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '6.3.3' } })
    expect(screen.getByRole('button', { name: /Legacy grouping/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Ratings/ })).toBeNull()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ambient' } })
    expect(screen.getByRole('button', { name: /Ratings/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(screen.getByText(/Nothing matches/)).toBeTruthy()
  })
})

describe('StandardsBrowser — table view', () => {
  const openCurrent = () => {
    renderIt()
    const derating = screen.getByRole('region', { name: 'Derating factors' })
    fireEvent.click(within(derating).getAllByRole('button', { name: /Grouping factors/ })[0])
  }
  it('shows the citation line, the conditions box and the values as printed', () => {
    openCurrent()
    expect(screen.getByText('SANS 99999-1:2099 · Edition 3.1 · Table 9.1 · p.120')).toBeTruthy()
    const cond = screen.getByRole('note', { name: 'Conditions this table is valid for' })
    expect(within(cond).getByText(/30 °C/)).toBeTruthy()
    expect(screen.getByText('0.50')).toBeTruthy() // printed precision, not 0.5
    expect(screen.getByText('–')).toBeTruthy()
    expect(screen.queryByText(/A blank cell is blank in the standard/)).toBeNull()
  })
  it('reproduces the printed header group', () => {
    openCurrent()
    expect(screen.getByRole('columnheader', { name: 'Buried directly' }).getAttribute('colspan')).toBe('2')
  })
  it('names the other edition and whether its values match, and goes back to the list', () => {
    openCurrent()
    fireEvent.click(screen.getByText('Source and verification'))
    expect(screen.getByText(/same values/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '← All tables' }))
    expect(screen.getByRole('searchbox')).toBeTruthy()
  })
  it('a superseded edition links to the same clause in the current one', () => {
    renderIt()
    fireEvent.click(screen.getByText(/SANS — earlier editions/))
    fireEvent.click(within(screen.getByRole('region', { name: 'Derating factors' })).getAllByRole('button', { name: /Grouping factors/ })[1])
    expect(screen.getByText(/A newer edition is current/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Table 9.1 there' }))
    expect(screen.getByText('Current edition')).toBeTruthy()
  })
  it('explains a legacy verdict in plain words, naming compared and uncompared columns', () => {
    renderIt()
    fireEvent.click(screen.getByText(/Manufacturer data \(Aberdare\)/))
    fireEvent.click(screen.getByRole('button', { name: /Legacy grouping/ }))
    expect(screen.getByText('Equal to SANS where SANS has it')).toBeTruthy()
    fireEvent.click(screen.getByText('Source and verification'))
    expect(screen.getByText(/Columns compared cell by cell: Ground\./)).toBeTruthy()
    expect(screen.getByText(/Not tabulated by SANS \(manufacturer data only\): Diameter\./)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/cells_without|TABLE_6_3_3/)
  })
})

describe('helpers', () => {
  it('sorts clauses naturally', () => {
    expect(['Table 6.3.10', 'Table 6.3.2', 'Table 6.4(b)', 'Table 6.4(a)'].sort((a, b) => naturalClauseKey(a).localeCompare(naturalClauseKey(b))))
      .toEqual(['Table 6.3.2', 'Table 6.3.10', 'Table 6.4(a)', 'Table 6.4(b)'])
  })
  it('shows printed values with a decimal point, else numbers at the column precision', () => {
    expect(cellText(0.18, '0,180')).toBe('0.180')
    expect(cellText(1138, '1 138')).toBe('1 138')
    expect(cellText(null, '-')).toBe('–')
    expect(cellText(0.7, undefined, 2)).toBe('0.70')
    expect(cellText(null, undefined)).toBe('–')
  })
})

describe('StandardsBrowser — review fixes', () => {
  it('opens the table named in the URL on first render (deep link)', () => {
    render(<StandardsBrowser standards={[NEW]} tables={[T_NEW]} initialCode="SANS_99999_1_2099_T9_1" />)
    expect(screen.getByRole('button', { name: '← All tables' })).toBeTruthy()
  })
  it("shows an extracted table's remark", () => {
    render(<StandardsBrowser standards={[NEW]} tables={[{ ...T_NEW, notes: 'A dash means no correction applies.' }]} initialCode="SANS_99999_1_2099_T9_1" />)
    expect(screen.getByText('A dash means no correction applies.')).toBeTruthy()
  })
  it('files a table without a known topic under Other tables', () => {
    render(<StandardsBrowser standards={[NEW]} tables={[{ ...T_NEW, topic: null }]} />)
    expect(screen.getByRole('region', { name: 'Other tables' })).toBeTruthy()
  })
  it('an ungrouped column spans both header rows instead of sitting under an empty cell', () => {
    const mixed: BrowserTable = { ...T_NEW, columns: [...cols, { key: 'c', label: 'Loose', unit: null }], rows: [{ data: { n: 2, a: 0.5, b: 0.6, c: 9 }, citation: null }] }
    render(<StandardsBrowser standards={[NEW]} tables={[mixed]} initialCode="SANS_99999_1_2099_T9_1" />)
    expect(screen.getByRole('columnheader', { name: 'Loose' }).getAttribute('rowspan')).toBe('2')
    expect(screen.getAllByRole('columnheader').some((h) => h.textContent === '')).toBe(false)
  })
})
