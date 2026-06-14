import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { BoqItem, BoqSection } from '@esite/shared'

// Mock the server action leaf so the editor renders + submits in jsdom.
const upsertMock = vi.fn()
vi.mock('@/actions/variation.actions', () => ({
  upsertVariationLineAction: (...args: unknown[]) => upsertMock(...args),
}))

import { VariationLineEditor } from './VariationLineEditor'

const noop = () => {}

const section: BoqSection = {
  id: 's1',
  importId: 'imp1',
  parentSectionId: null,
  kind: 'bill',
  code: '1',
  title: 'Bill 1',
  sortOrder: 1,
  nodeId: null,
}

const item: BoqItem = {
  id: 'i1',
  sectionId: 's1',
  code: '1.1',
  description: 'Light switch, 1-lever',
  unit: 'No',
  quantity: 10,
  quantityMode: 'measured',
  rateModel: 'supply_install',
  supplyRate: 50,
  installRate: 30,
  rate: null,
  amount: 800,
  sortOrder: 1,
  origin: 'contract',
  variationLineId: null,
}

beforeEach(() => {
  upsertMock.mockReset()
})

describe('VariationLineEditor — adjust + the qty floor', () => {
  it('picks an item, previews the value change, and surfaces the floor error inline', async () => {
    upsertMock.mockResolvedValue({ error: 'Delta would take the revised quantity below zero' })

    render(
      <VariationLineEditor
        projectId="p1"
        voId="vo1"
        sections={[section]}
        items={[item]}
        onSaved={noop}
        onCancel={noop}
      />,
    )

    // Search + pick the contract item.
    fireEvent.change(screen.getByLabelText(/find contract item/i), { target: { value: 'switch' } })
    fireEvent.click(screen.getByRole('option', { name: /light switch/i }))
    expect(screen.getByText(/Contract qty/)).toBeTruthy()

    // A negative delta previews via computeLineChange: −20 × (50+30) = −R1600.
    fireEvent.change(screen.getByLabelText(/qty delta/i), { target: { value: '-20' } })
    expect(screen.getByText(/−R/)).toBeTruthy()

    // Submit → the server's floor error renders inline.
    fireEvent.click(screen.getByRole('button', { name: /save line/i }))
    await waitFor(() =>
      expect(screen.getByText('Delta would take the revised quantity below zero')).toBeTruthy(),
    )
    expect(upsertMock).toHaveBeenCalledWith('p1', 'vo1', {
      kind: 'adjust',
      boqItemId: 'i1',
      qtyDelta: -20,
    })
  })
})
