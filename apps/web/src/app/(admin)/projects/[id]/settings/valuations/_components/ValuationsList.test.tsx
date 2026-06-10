import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Valuation } from '@esite/shared'

// ValuationsList imports the create server action; mock the leaf so it renders
// in jsdom without a server.
vi.mock('@/actions/valuation.actions', () => ({ createValuationAction: vi.fn() }))

import { ValuationsList } from './ValuationsList'

const noop = () => {}

function val(over: Partial<Valuation>): Valuation {
  return {
    id: 'v1',
    projectId: 'p1',
    organisationId: 'o1',
    boqImportId: 'imp1',
    valuationNo: 1,
    valuationDate: '2026-06-10',
    status: 'draft',
    retentionPct: 5,
    grossToDate: null,
    retentionAmount: null,
    netToDate: null,
    previousNet: null,
    dueExVat: null,
    vatAmount: null,
    dueInclVat: null,
    reportId: null,
    notes: null,
    certifiedBy: null,
    certifiedAt: null,
    ...over,
  }
}

describe('ValuationsList — empty state', () => {
  it('shows the empty state + New valuation when canEdit', () => {
    render(
      <ValuationsList projectId="p1" valuations={[]} canEdit selectedId={null} onSelect={noop} onCreated={noop} />,
    )
    expect(screen.getByText(/No valuations yet/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /new valuation/i })).toBeTruthy()
  })

  it('hides New valuation when canEdit is false', () => {
    render(
      <ValuationsList projectId="p1" valuations={[]} canEdit={false} selectedId={null} onSelect={noop} onCreated={noop} />,
    )
    expect(screen.queryByRole('button', { name: /new valuation/i })).toBeNull()
  })
})

describe('ValuationsList — populated', () => {
  it('renders each valuation with its number + status badge', () => {
    render(
      <ValuationsList
        projectId="p1"
        valuations={[
          val({ id: 'v1', valuationNo: 1, status: 'certified', dueInclVat: 6325 }),
          val({ id: 'v2', valuationNo: 2, status: 'draft' }),
        ]}
        canEdit
        selectedId="v2"
        onSelect={noop}
        onCreated={noop}
      />,
    )
    expect(screen.getByText('Valuation No. 1')).toBeTruthy()
    expect(screen.getByText('Valuation No. 2')).toBeTruthy()
    expect(screen.getByText('certified')).toBeTruthy()
    expect(screen.getByText('draft')).toBeTruthy()
    expect(screen.getByText('2 valuations')).toBeTruthy()
    // Certified valuation shows its frozen due incl-VAT.
    expect(screen.getByText(/Due incl-VAT/)).toBeTruthy()
  })
})
