import { describe, it, expect } from 'vitest'
import { boqService } from './boq.service'

// ─── Fake client helpers ──────────────────────────────────────────────────────

/** Build a fake Supabase-like client that returns `rows` from maybeSingle/single/select. */
function fakeClient(rows: Record<string, unknown>[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    is: () => chain,
    in: () => chain,
    update: () => chain,
    insert: () => chain,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: null }),
    then: undefined,
  }
  return { schema: () => ({ from: () => chain }) } as never
}

/** Fake client where every write no-ops and every read returns `rows`. */
function fakeWriteClient(readRows: Record<string, unknown>[]) {
  let callCount = 0
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    is: () => chain,
    in: () => chain,
    update: (_patch?: unknown) => chain,
    insert: (_rows?: unknown) => chain,
    maybeSingle: async () => ({ data: readRows[callCount++ % readRows.length] ?? null, error: null }),
    single: async () => ({ data: readRows[callCount++ % readRows.length] ?? null, error: null }),
    then: undefined,
  }
  return { schema: () => ({ from: () => chain }) } as never
}

const importRow = {
  id: 'imp1',
  project_id: 'p1',
  organisation_id: 'org1',
  source_filename: 'test.xlsx',
  storage_path: null,
  imported_by: null,
  imported_at: '2026-06-08T00:00:00Z',
  total_ex_vat: '51064581.53',
  vat_amount: '7659687.23',
  total_incl_vat: '58724268.76',
  line_item_count: 2994,
  is_current: true,
}

const itemRow = {
  id: 'item1',
  section_id: 'sec1',
  code: 'C1.1',
  description: '4C x 240mm XLPE',
  unit: 'm',
  quantity: 446,
  quantity_mode: 'measured',
  rate_model: 'supply_install',
  supply_rate: '628.3',
  install_rate: '18',
  rate: null,
  amount: '288249.8',
  sort_order: 1,
}

// ─── getCurrent ───────────────────────────────────────────────────────────────

describe('boqService.getCurrent', () => {
  it('returns the mapped current import', async () => {
    const out = await boqService.getCurrent(fakeClient([importRow]), 'p1')
    expect(out?.id).toBe('imp1')
    expect(out?.totalInclVat).toBe(58724268.76)
    expect(out?.totalExVat).toBe(51064581.53)
    expect(out?.vatAmount).toBe(7659687.23)
    expect(out?.isCurrent).toBe(true)
    expect(out?.lineItemCount).toBe(2994)
  })

  it('returns null when no current import exists', async () => {
    const out = await boqService.getCurrent(fakeClient([]), 'p1')
    expect(out).toBeNull()
  })

  it('throws when the client returns an error', async () => {
    const errChain = {
      select: function() { return this },
      eq: function() { return this },
      is: function() { return this },
      maybeSingle: async () => ({ data: null, error: { message: 'DB error' } }),
    }
    const errClient = { schema: () => ({ from: () => errChain }) } as never
    await expect(boqService.getCurrent(errClient, 'p1')).rejects.toThrow('DB error')
  })
})

// ─── updateItemRate ───────────────────────────────────────────────────────────

describe('boqService.updateItemRate', () => {
  it('recomputes amount from patched rates and returns mapped item', async () => {
    // Current item: supply_install, qty=446, supply=628.3, install=18 → amount=288249.8
    // Patch: installRate=20 → new amount = 446 × (628.3 + 20) = 446 × 648.3 = 289,141.8
    const updatedRow = { ...itemRow, install_rate: '20', amount: '289141.8' }
    const client = fakeWriteClient([itemRow, updatedRow])
    const result = await boqService.updateItemRate(client, 'item1', { installRate: 20 })
    expect(result.id).toBe('item1')
    expect(result.installRate).toBe(20)
    expect(result.amount).toBe(289141.8)
  })

  it('returns null amount when quantityMode is rate_only', async () => {
    const rateOnlyRow = { ...itemRow, quantity_mode: 'rate_only', quantity: null, amount: null }
    const client = fakeWriteClient([rateOnlyRow, { ...rateOnlyRow, supply_rate: '700' }])
    const result = await boqService.updateItemRate(client, 'item1', { supplyRate: 700 })
    expect(result.amount).toBeNull()
  })
})
