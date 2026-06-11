import { describe, it, expect } from 'vitest'
import { rowToValuation, rowToValuationLine, valuationLineToRow } from './_valuation-mappers'

describe('_valuation-mappers', () => {
  describe('rowToValuationLine', () => {
    it('coerces PostgREST numeric strings to numbers', () => {
      const line = rowToValuationLine({
        id: '00000000-0000-0000-0000-000000000001',
        valuation_id: '00000000-0000-0000-0000-000000000002',
        boq_item_id: '00000000-0000-0000-0000-000000000003',
        input_method: 'percent',
        percent_complete: '75.500',
        qty_complete: null,
        value_to_date: '100.00',
      })
      expect(line.valueToDate).toBe(100)
      expect(line.percentComplete).toBe(75.5)
    })

    it('keeps nulls null (does not coerce to 0)', () => {
      const line = rowToValuationLine({
        id: '00000000-0000-0000-0000-000000000001',
        valuation_id: '00000000-0000-0000-0000-000000000002',
        boq_item_id: '00000000-0000-0000-0000-000000000003',
        input_method: 'quantity',
        percent_complete: null,
        qty_complete: null,
        value_to_date: '0',
      })
      expect(line.percentComplete).toBeNull()
      expect(line.qtyComplete).toBeNull()
    })
  })

  describe('rowToValuation', () => {
    it('maps all snapshot fields and coerces numeric strings', () => {
      const val = rowToValuation({
        id: '00000000-0000-0000-0000-000000000010',
        project_id: '00000000-0000-0000-0000-000000000011',
        organisation_id: '00000000-0000-0000-0000-000000000012',
        boq_import_id: '00000000-0000-0000-0000-000000000013',
        valuation_no: 3,
        valuation_date: '2026-06-10',
        status: 'draft',
        retention_pct: '5.00',
        gross_to_date: '200000.00',
        retention_amount: '10000.00',
        net_to_date: '190000.00',
        previous_net: '150000.00',
        due_ex_vat: '40000.00',
        vat_amount: '6000.00',
        due_incl_vat: '46000.00',
        report_id: null,
        notes: null,
        certified_by: null,
        certified_at: null,
      })
      expect(val.retentionPct).toBe(5)
      expect(val.grossToDate).toBe(200000)
      expect(val.dueInclVat).toBe(46000)
      expect(val.reportId).toBeNull()
      expect(val.valuationNo).toBe(3)
    })
  })

  describe('valuationLineToRow', () => {
    it('round-trips a progress patch to snake_case row, only defined keys', () => {
      expect(
        valuationLineToRow({ percentComplete: 50, valueToDate: 1000 }),
      ).toEqual({ percent_complete: 50, value_to_date: 1000 })
    })

    it('omits undefined keys', () => {
      const row = valuationLineToRow({ valueToDate: 500 })
      expect(row).toEqual({ value_to_date: 500 })
      expect('percent_complete' in row).toBe(false)
      expect('qty_complete' in row).toBe(false)
    })
  })
})
