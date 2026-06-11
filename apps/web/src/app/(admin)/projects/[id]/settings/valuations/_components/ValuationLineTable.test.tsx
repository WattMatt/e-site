import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { BoqItem, ValuationLine } from '@esite/shared'

// ValuationLineTable imports valuation actions indirectly (via onCommit prop);
// no server-action imports live at the module level, so no mock needed.

import { ValuationLineTable } from './ValuationLineTable'

const noop: () => Promise<null> = () => Promise.resolve(null)

/** Minimal BoqItem fixture for a quantity-mode line. */
function makeItem(over: Partial<BoqItem> = {}): BoqItem {
  return {
    id: 'item1',
    sectionId: 'sec1',
    code: '1.1',
    description: 'Earthworks',
    unit: 'm³',
    quantity: 100,
    quantityMode: 'measured',
    rateModel: 'single',
    supplyRate: null,
    installRate: null,
    rate: 100,
    amount: 1000,
    sortOrder: 0,
    origin: 'contract',
    variationLineId: null,
    ...over,
  }
}

/** Minimal ValuationLine fixture. */
function makeLine(over: Partial<ValuationLine> = {}): ValuationLine {
  return {
    id: 'line1',
    valuationId: 'val1',
    boqItemId: 'item1',
    inputMethod: 'quantity',
    percentComplete: null,
    qtyComplete: 0,
    valueToDate: 0,
    ...over,
  }
}

// ── Fix B: over-measure badge respects the revised amount ────────────────────

describe('ValuationLineTable — over-measure badge', () => {
  /**
   * Item: amount=1000, rate=100 (rateModel='single').
   * qtyComplete=12 → 12 × 100 = 1200 > 1000 → over-measure WITHOUT revised.
   * With revisedAmount=1300: 1200 ≤ 1300 → NOT over-measure.
   */
  const item = makeItem({ amount: 1000, rate: 100, rateModel: 'single' })
  const line = makeLine({ qtyComplete: 12, inputMethod: 'quantity' })
  const linesByItem = new Map([['item1', line]])

  it('shows the over-measure badge when qtyComplete × rate exceeds contract amount (no revised)', () => {
    render(
      <ValuationLineTable
        items={[item]}
        linesByItem={linesByItem}
        canEdit={false}
        onCommit={noop}
      />,
    )
    expect(screen.getByText('over-measure')).toBeTruthy()
  })

  it('suppresses the over-measure badge when revisedAmount covers the quantity', () => {
    const revisedByItem = new Map<string, number | null>([['item1', 1300]])
    render(
      <ValuationLineTable
        items={[item]}
        linesByItem={linesByItem}
        revisedByItem={revisedByItem}
        canEdit={false}
        onCommit={noop}
      />,
    )
    expect(screen.queryByText('over-measure')).toBeNull()
  })
})
