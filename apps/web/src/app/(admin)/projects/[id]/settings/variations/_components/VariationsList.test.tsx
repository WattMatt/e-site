import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { VariationOrder } from '@esite/shared'

// VariationsList imports the create server action; mock the leaf so it renders
// in jsdom without a server.
vi.mock('@/actions/variation.actions', () => ({ createVariationOrderAction: vi.fn() }))

import { VariationsList } from './VariationsList'

const noop = () => {}

function vo(over: Partial<VariationOrder>): VariationOrder {
  return {
    id: 'vo1',
    projectId: 'p1',
    organisationId: 'o1',
    boqImportId: 'imp1',
    voNo: 1,
    voDate: '2026-06-10',
    title: 'Remeasure — Level 2',
    reason: null,
    status: 'draft',
    netChange: null,
    approvedBy: null,
    approvedAt: null,
    ...over,
  }
}

describe('VariationsList — empty state', () => {
  it('shows the empty state + New VO when canEdit', () => {
    render(
      <VariationsList projectId="p1" vos={[]} canEdit selectedId={null} onSelect={noop} onCreated={noop} />,
    )
    expect(screen.getByText(/No variation orders yet/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /new vo/i })).toBeTruthy()
  })

  it('hides New VO when canEdit is false', () => {
    render(
      <VariationsList projectId="p1" vos={[]} canEdit={false} selectedId={null} onSelect={noop} onCreated={noop} />,
    )
    expect(screen.queryByRole('button', { name: /new vo/i })).toBeNull()
  })
})

describe('VariationsList — populated', () => {
  it('renders each VO with its number, title + status badge', () => {
    render(
      <VariationsList
        projectId="p1"
        vos={[
          vo({ id: 'vo1', voNo: 1, title: 'Extra DBs', status: 'approved', netChange: 12500 }),
          vo({ id: 'vo2', voNo: 2, title: 'Omit spare ways', status: 'draft' }),
        ]}
        canEdit
        selectedId="vo2"
        onSelect={noop}
        onCreated={noop}
      />,
    )
    expect(screen.getByText(/VO 1 · Extra DBs/)).toBeTruthy()
    expect(screen.getByText(/VO 2 · Omit spare ways/)).toBeTruthy()
    expect(screen.getByText('approved')).toBeTruthy()
    expect(screen.getByText('draft')).toBeTruthy()
    expect(screen.getByText('2 variation orders')).toBeTruthy()
    // Approved VO shows its frozen net change, signed +.
    expect(screen.getByText(/Net change/)).toBeTruthy()
    expect(screen.getByText(/\+R/)).toBeTruthy()
  })

  it('renders a negative net change with a − sign (jsdom drops var() colours)', () => {
    render(
      <VariationsList
        projectId="p1"
        vos={[vo({ id: 'vo1', voNo: 1, status: 'approved', netChange: -4200 })]}
        canEdit
        selectedId={null}
        onSelect={noop}
        onCreated={noop}
      />,
    )
    // The − sign is the semantic marker; the red/green is inline var() styling
    // that jsdom strips from the style attribute, so assert the sign only.
    expect(screen.getByText(/−R/)).toBeTruthy()
    expect(screen.queryByText(/\+R/)).toBeNull()
  })
})
