import { describe, expect, it } from 'vitest'
import {
  primaryStage,
  secondaryStages,
  getStageCounts,
  itemsForStage,
  type EnrichedItem,
} from '../materials.service'

// ---------- fixtures ----------

const baseItem: EnrichedItem = {
  id: 'item-1',
  organisation_id: 'org-1',
  item_code: 'EQ-001',
  description: 'Test item',
  quantity: 1,
  unit: 'ea',
  estimated_unit_cost: 100,
  currency: 'ZAR',
  status: 'open',
  shop_drawing_required: false,
  procurement_items: [],
}

type PiOverrides = Partial<EnrichedItem['procurement_items'][number]>

function withProc(overrides: PiOverrides = {}): EnrichedItem {
  return {
    ...baseItem,
    procurement_items: [
      {
        id: 'pi-1',
        organisation_id: 'org-1',
        description: 'Procurement row',
        quantity: 1,
        unit: 'ea',
        status: 'draft',
        po_number: null,
        quoted_price: null,
        selected_quote_id: null,
        photo_paths: [],
        procurement_quotes: [],
        shop_drawings: [],
        goods_received_notes: [],
        supplier_invoices: [],
        ...overrides,
      },
    ],
  }
}

// ---------- primaryStage ----------

describe('primaryStage', () => {
  it('returns plan when no procurement_items exist', () => {
    expect(primaryStage(baseItem)).toBe('plan')
  })

  it('returns quote when procurement_item exists in draft status with no quotes', () => {
    expect(primaryStage(withProc({ status: 'draft' }))).toBe('quote')
  })

  it('returns quote when procurement_item is sent (out for quoting)', () => {
    expect(primaryStage(withProc({ status: 'sent' }))).toBe('quote')
  })

  it('returns quote when procurement_item is quoted but no quote selected yet', () => {
    const item = withProc({
      status: 'quoted',
      procurement_quotes: [{ id: 'q1', supplier_id: null, supplier_name: 'Acme', quoted_price: 500, currency: 'ZAR', is_selected: false, received_at: '2026-05-01' }],
    })
    expect(primaryStage(item)).toBe('quote')
  })

  it('returns order when procurement_item is approved (PO issued or pending)', () => {
    const item = withProc({
      status: 'approved',
      po_number: 'PO-001',
      procurement_quotes: [{ id: 'q1', supplier_id: null, supplier_name: 'Acme', quoted_price: 500, currency: 'ZAR', is_selected: true, received_at: '2026-05-01' }],
      selected_quote_id: 'q1',
    })
    expect(primaryStage(item)).toBe('order')
  })

  it('returns order when approved status set without po_number yet entered', () => {
    expect(primaryStage(withProc({ status: 'approved' }))).toBe('order')
  })

  it('returns deliver when any GRN exists (any condition)', () => {
    const item = withProc({
      status: 'approved',
      po_number: 'PO-001',
      goods_received_notes: [{ id: 'g1', delivered_at: '2026-05-10', quantity_received: 1, condition: 'complete' }],
    })
    expect(primaryStage(item)).toBe('deliver')
  })

  it('returns deliver when GRN condition is partial', () => {
    const item = withProc({
      goods_received_notes: [{ id: 'g1', delivered_at: '2026-05-10', quantity_received: 0.5, condition: 'partial' }],
    })
    expect(primaryStage(item)).toBe('deliver')
  })

  it('returns deliver when GRN condition is damaged', () => {
    const item = withProc({
      goods_received_notes: [{ id: 'g1', delivered_at: '2026-05-10', quantity_received: 1, condition: 'damaged' }],
    })
    expect(primaryStage(item)).toBe('deliver')
  })

  it('returns pay when supplier_invoice exists in received status', () => {
    const item = withProc({
      goods_received_notes: [{ id: 'g1', delivered_at: '2026-05-10', quantity_received: 1, condition: 'complete' }],
      supplier_invoices: [{ id: 'inv1', invoice_number: 'INV-001', amount: 500, status: 'received', paid_at: null }],
    })
    expect(primaryStage(item)).toBe('pay')
  })

  it('returns pay when all invoices are paid (still in pay stage = pipeline complete)', () => {
    const item = withProc({
      supplier_invoices: [{ id: 'inv1', invoice_number: 'INV-001', amount: 500, status: 'paid', paid_at: '2026-05-20' }],
    })
    expect(primaryStage(item)).toBe('pay')
  })

  it('returns pay when invoice is disputed', () => {
    const item = withProc({
      supplier_invoices: [{ id: 'inv1', invoice_number: 'INV-001', amount: 500, status: 'disputed', paid_at: null }],
    })
    expect(primaryStage(item)).toBe('pay')
  })

  it('latest stage wins — invoice received overrides approved PO + GRN', () => {
    const item = withProc({
      status: 'approved',
      po_number: 'PO-001',
      goods_received_notes: [{ id: 'g1', delivered_at: '2026-05-10', quantity_received: 1, condition: 'complete' }],
      supplier_invoices: [{ id: 'inv1', invoice_number: 'INV-001', amount: 500, status: 'received', paid_at: null }],
    })
    expect(primaryStage(item)).toBe('pay')
  })

  it('fulfilled procurement_item with no invoices stays in deliver if GRN exists', () => {
    const item = withProc({
      status: 'fulfilled',
      goods_received_notes: [{ id: 'g1', delivered_at: '2026-05-10', quantity_received: 1, condition: 'complete' }],
    })
    expect(primaryStage(item)).toBe('deliver')
  })

  it('cancelled procurement_item with no other activity falls through to plan', () => {
    // status='cancelled' is not in (draft|sent|quoted), no quotes, no GRN, no invoice
    expect(primaryStage(withProc({ status: 'cancelled' }))).toBe('plan')
  })
})

// ---------- secondaryStages ----------

describe('secondaryStages', () => {
  it('returns empty when only one stage is active', () => {
    expect(secondaryStages(baseItem)).toEqual([])
  })

  it('returns [] for a plan item even when nothing is happening', () => {
    expect(secondaryStages(withProc({ status: 'draft' }))).toEqual([])
  })

  it('returns [quote] when primary is order AND an unselected quote exists', () => {
    const item = withProc({
      status: 'approved',
      po_number: 'PO-001',
      procurement_quotes: [
        { id: 'q1', supplier_id: null, supplier_name: 'Acme', quoted_price: 500, currency: 'ZAR', is_selected: true, received_at: '2026-05-01' },
        { id: 'q2', supplier_id: null, supplier_name: 'Beta', quoted_price: 480, currency: 'ZAR', is_selected: false, received_at: '2026-05-02' },
      ],
    })
    expect(primaryStage(item)).toBe('order')
    expect(secondaryStages(item)).toEqual(['quote'])
  })

  it('returns [deliver] when primary=pay AND delivery still incomplete (sum GRN < qty)', () => {
    const item = withProc({
      quantity: 5,
      goods_received_notes: [
        { id: 'g1', delivered_at: '2026-05-10', quantity_received: 2, condition: 'partial' },
      ],
      supplier_invoices: [
        { id: 'inv1', invoice_number: 'INV-001', amount: 500, status: 'received', paid_at: null },
      ],
    })
    expect(primaryStage(item)).toBe('pay')
    expect(secondaryStages(item)).toContain('deliver')
  })

  it('returns [] when primary=pay AND delivery complete', () => {
    const item = withProc({
      quantity: 5,
      goods_received_notes: [
        { id: 'g1', delivered_at: '2026-05-10', quantity_received: 5, condition: 'complete' },
      ],
      supplier_invoices: [
        { id: 'inv1', invoice_number: 'INV-001', amount: 500, status: 'paid', paid_at: '2026-05-20' },
      ],
    })
    expect(primaryStage(item)).toBe('pay')
    expect(secondaryStages(item)).toEqual([])
  })

  it('does not list the primary stage as a secondary', () => {
    const item = withProc({
      procurement_quotes: [{ id: 'q1', supplier_id: null, supplier_name: 'Acme', quoted_price: 500, currency: 'ZAR', is_selected: false, received_at: '2026-05-01' }],
    })
    expect(primaryStage(item)).toBe('quote')
    expect(secondaryStages(item)).not.toContain('quote')
  })
})

// ---------- getStageCounts ----------

describe('getStageCounts', () => {
  it('counts every item by its primary stage', () => {
    const items: EnrichedItem[] = [
      baseItem, // plan
      withProc({ status: 'sent' }), // quote
      withProc({ status: 'approved', po_number: 'PO-002' }), // order
      withProc({ goods_received_notes: [{ id: 'g', delivered_at: '2026-05-10', quantity_received: 1, condition: 'complete' }] }), // deliver
      withProc({ supplier_invoices: [{ id: 'i', invoice_number: 'INV-X', amount: 1, status: 'received', paid_at: null }] }), // pay
    ]
    expect(getStageCounts(items)).toEqual({ plan: 1, quote: 1, order: 1, deliver: 1, pay: 1 })
  })

  it('totals equal items.length (each item in exactly one stage)', () => {
    const items = Array.from({ length: 7 }, () => baseItem)
    const counts = getStageCounts(items)
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    expect(total).toBe(items.length)
  })
})

// ---------- itemsForStage ----------

describe('itemsForStage', () => {
  it('filters by primary stage', () => {
    const plan = baseItem
    const quote = withProc({ status: 'sent' })
    expect(itemsForStage([plan, quote], 'plan')).toEqual([plan])
    expect(itemsForStage([plan, quote], 'quote')).toEqual([quote])
    expect(itemsForStage([plan, quote], 'pay')).toEqual([])
  })
})
