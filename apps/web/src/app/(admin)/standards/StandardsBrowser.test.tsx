import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { StandardsBrowser, type BrowserStandard, type BrowserTable } from './StandardsBrowser'

// Synthetic values only — licensed numbers never enter this public repository.
const NEW: BrowserStandard = { id: 's-new', code: 'SANS 99999-1', edition: '3.1', year: 2099, title: 'Synthetic wiring code', publisher: 'SABS', kind: 'standard', status: 'current', superseded_by: null, in_library: true, notes: null }
const OLD: BrowserStandard = { ...NEW, id: 's-old', edition: '2', year: 2090, status: 'superseded', superseded_by: 's-new' }
const MFR: BrowserStandard = { id: 's-mfr', code: 'Maker Facts', edition: 'as transcribed', year: null, title: 'Booklet', publisher: 'Maker', kind: 'manufacturer', status: 'current', superseded_by: null, in_library: false, notes: null }

const cols = [{ key: 'n', label: 'Number of cables', unit: null }, { key: 'f', label: 'Touching', unit: null }]
const row = (n: number, f: number, page: number) => ({ data: { n, f }, citation: { clause: 'Table 9.1', page_pdf: page + 4, page_printed: page } })
const base = { title: 'Grouping factors', standard: 'x', section_number: '9.1', clause: 'Table 9.1', columns: cols, notes: null, source_ref: null, category: null, verification: null }
const T_NEW: BrowserTable = { ...base, id: 't1', code: 'NEW_T9_1', provenance: 'extracted', standard_id: 's-new', rows: [row(2, 0.5, 120), row(3, 0.4, 120)], usedBy: [{ calculator: 'Cable schedule', use: 'Cites the derating factors', href: '/projects' }] }
const T_OLD: BrowserTable = { ...base, id: 't2', code: 'OLD_T9_1', provenance: 'extracted', standard_id: 's-old', rows: [row(2, 0.5, 119)], usedBy: [] }
const T_LEG: BrowserTable = { ...base, id: 't3', code: 'LEGACY_9', title: 'Legacy grouping', clause: 'Table 6.3.3', provenance: 'transcribed', standard_id: 's-mfr', rows: [{ data: { n: 2, f: 0.5 }, citation: null }], usedBy: [],
  verification: { status: 'verified', checked_on: '2099-01-01', against: [{ standard: 'SANS 99999-1:2099', edition: '3.1', clause: 'Table 9.1', page_printed: 120 }] } }

const renderIt = () => render(<StandardsBrowser standards={[NEW, OLD, MFR]} tables={[T_NEW, T_OLD, T_LEG]} />)

describe('StandardsBrowser', () => {
  it('lists standards with edition and status badges', () => {
    renderIt()
    const index = screen.getByRole('complementary', { name: 'Standards and tables' })
    expect(within(index).getAllByText('Current').length).toBeGreaterThan(0)
    expect(within(index).getByText('Superseded')).toBeTruthy()
    expect(within(index).getByText('Not in library')).toBeTruthy()
  })

  it('shows the clause, printed page and a citation on every row of an extracted table', () => {
    renderIt()
    fireEvent.click(screen.getAllByRole('button', { name: /Table 9\.1/ })[0])
    expect(screen.getByText(/SANS 99999-1:2099 · Ed 3\.1 · Table 9\.1 · p\.120/)).toBeTruthy()
    expect(screen.getByText('Every value cited')).toBeTruthy()
    expect(screen.getAllByText('Table 9.1, p.120')).toHaveLength(2)
    expect(screen.getAllByText(/printed p\.120 \(PDF p\.124\)/)).toHaveLength(2) // the phone card view
    expect(screen.getByRole('link', { name: 'Cable schedule' }).getAttribute('href')).toBe('/projects')
  })

  it('sends a superseded edition to the same clause in the current one', () => {
    renderIt()
    fireEvent.click(screen.getAllByRole('button', { name: /Table 9\.1/ })[1])
    expect(screen.getByText(/Superseded by SANS 99999-1:2099 Ed 3\.1/)).toBeTruthy()
    expect(screen.getByText('Reference only — no calculator reads this table.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Table 9.1 in the current edition' }))
    expect(screen.getByText(/· p\.120/)).toBeTruthy()
  })

  it('shows a legacy table’s verdict and what it was compared with', () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: /Legacy grouping/ }))
    expect(screen.getByText('Verified against SANS')).toBeTruthy()
    expect(screen.getByText(/Compared cell by cell with SANS 99999-1:2099 Ed 3\.1 Table 9\.1, p\.120 on 2099-01-01/)).toBeTruthy()
  })

  it('searches across standards, tables and clauses', () => {
    renderIt()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '6.3.3' } })
    expect(screen.getByRole('button', { name: /Legacy grouping/ })).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /Table 9\.1/ })).toHaveLength(0)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    expect(screen.getByText(/Nothing matches/)).toBeTruthy()
  })
})
