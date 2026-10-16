import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ChargeGroupView, ChargeRowView } from '@esite/shared'

vi.mock('@/actions/tariff-explorer.actions', () => ({ getTariffSourceUrlAction: vi.fn() }))

import { ExplorerChargesTable, groupContext, rowLabel, varyingDims } from './ExplorerChargesTable'

const r = (p: Partial<ChargeRowView>): ChargeRowView => ({
  id: Math.random().toString(36), component: 'energy', season: 'All year', period: 'All hours', dayType: 'Every day', block: '—', amount: '1.00 c/kWh',
  vatBasis: 'stated_excl', unitNote: null, yoy: { kind: 'no_previous' }, citation: 'Book, page 1', canViewSource: true, sourceDocumentId: 'd', locator: {}, ...p,
})

describe('row labels', () => {
  it('names only what varies within the group', () => {
    const rows = [r({ season: 'High demand (winter)', period: 'Peak' }), r({ season: 'High demand (winter)', period: 'Standard' })]
    expect(varyingDims(rows)).toEqual(['period'])
    expect(rowLabel(rows[0], varyingDims(rows))).toBe('Peak')
  })
  it('blocks read as their range', () => {
    const rows = [r({ block: '0–50 kWh/month' }), r({ block: 'Above 50 kWh/month' })]
    expect(rows.map((x) => rowLabel(x, varyingDims(rows)))).toEqual(['0–50 kWh/month', 'Above 50 kWh/month'])
  })
  it('a row at the defaults among varying siblings still reads differently', () => {
    const rows = [r({ season: 'High demand (winter)' }), r({})]
    expect(rows.map((x) => rowLabel(x, varyingDims(rows)))).toEqual(['High demand (winter)', 'All year'])
  })
  it('what every row shares goes to the heading, so a constant "Weekdays" is not lost', () => {
    const rows = [r({ dayType: 'Weekdays', period: 'Peak' }), r({ dayType: 'Weekdays', period: 'Standard' })]
    expect(groupContext(rows)).toBe('Weekdays')
    expect(groupContext([r({ period: 'Peak' }), r({ period: 'Standard' })])).toBeNull()
  })
  it('a lone uniform row says "all year, all hours" rather than three filler words', () => {
    expect(rowLabel(r({}), [])).toBe('All year, all hours')
    expect(rowLabel(r({ dayType: 'Weekdays' }), [])).toBe('Weekdays')
  })
})

describe('ExplorerChargesTable', () => {
  const groups: ChargeGroupView[] = [
    { component: 'energy', label: 'Energy', rows: [r({ block: '0–50 kWh/month', vatBasis: 'assumed_excl', yoy: { kind: 'changed', pct: -2 } }), r({ block: 'Above 50 kWh/month', vatBasis: 'assumed_excl', yoy: { kind: 'new' } })] },
    { component: 'basic', label: 'Basic charge', rows: [r({ component: 'basic', amount: 'R10.00/month', vatBasis: 'stated_incl', canViewSource: false })] },
  ]
  it('says a shared VAT basis once in the heading, and colours the YoY', () => {
    render(<ExplorerChargesTable groups={groups} previousFy="2098/99" />)
    const energy = screen.getByRole('region', { name: 'Energy' })
    expect(within(energy).getByText('VAT basis not stated; read as excl. VAT · 2 rates')).toBeDefined()
    expect(within(energy).queryAllByText(/^VAT basis not stated; read as excl\. VAT$/)).toHaveLength(0)
    expect(within(energy).getByText('-2.0 %', { exact: false }).getAttribute('data-tone')).toBe('better')
    expect(within(energy).getByText('New')).toBeDefined()
    // The stored amount is excl. VAT; the note must not read as if the price includes it.
    expect(within(screen.getByRole('region', { name: 'Basic charge' })).getByText('Source printed incl. VAT; shown excl.')).toBeDefined()
  })
  it('an export credit that rises is good news: green, not red', () => {
    render(<ExplorerChargesTable groups={[{ component: 'export_credit', label: 'Export credit', rows: [r({ component: 'export_credit', yoy: { kind: 'changed', pct: 5 } })] }]} previousFy="2098/99" />)
    const chip = within(screen.getByRole('region', { name: 'Export credit' })).getByText('+5.0 %', { exact: false })
    expect(chip.getAttribute('data-tone')).toBe('better')
  })
  it('a charge without a source document cannot open the viewer', () => {
    render(<ExplorerChargesTable groups={groups} previousFy={null} />)
    expect((screen.getByRole('button', { name: 'View source for Basic charge, All year, all hours' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'View source for Energy, 0–50 kWh/month' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
