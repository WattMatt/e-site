import { describe, it, expect } from 'vitest'
import { rowToBoqItem, boqItemToRow } from './_boq-mappers'

describe('_boq-mappers', () => {
  it('coerces PostgREST numeric strings to numbers', () => {
    const item = rowToBoqItem({
      id: 'i1', section_id: 's1', code: 'C1.1', description: '4C', unit: 'm',
      quantity: '2363', quantity_mode: 'measured', rate_model: 'supply_install',
      supply_rate: '540.75', install_rate: '18', rate: null, amount: '1320326.25', sort_order: 0,
    })
    expect(item.quantity).toBe(2363)
    expect(item.supplyRate).toBe(540.75)
    expect(item.amount).toBe(1320326.25)
  })
  it('round-trips a rate patch to snake_case row', () => {
    expect(boqItemToRow({ supplyRate: 10, amount: 200 })).toEqual({ supply_rate: 10, amount: 200 })
  })
  it('keeps nulls null (does not coerce to 0)', () => {
    const item = rowToBoqItem({ id: 'i', section_id: 's', description: 'x', quantity: null,
      quantity_mode: 'rate_only', rate_model: 'supply_install', amount: null, sort_order: 0 } as never)
    expect(item.quantity).toBeNull()
    expect(item.amount).toBeNull()
  })
})
