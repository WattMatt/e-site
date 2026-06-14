import { describe, it, expect } from 'vitest'
import { rowToVariationOrder, rowToVariationLine, variationLineToRow } from './_variation-mappers'

describe('_variation-mappers', () => {
  describe('rowToVariationLine', () => {
    it('coerces numeric string value_change to number', () => {
      const line = rowToVariationLine({
        id: '00000000-0000-0000-0000-000000000001',
        variation_order_id: '00000000-0000-0000-0000-000000000002',
        kind: 'adjust',
        boq_item_id: '00000000-0000-0000-0000-000000000003',
        qty_delta: '-5',
        section_id: null,
        code: null,
        description: null,
        unit: null,
        quantity: null,
        rate_model: null,
        supply_rate: null,
        install_rate: null,
        rate: null,
        value_change: '-500',
        materialized_item_id: null,
      })
      expect(line.valueChange).toBe(-500)
      expect(line.qtyDelta).toBe(-5)
    })

    it('keeps qty_delta null when null', () => {
      const line = rowToVariationLine({
        id: '00000000-0000-0000-0000-000000000001',
        variation_order_id: '00000000-0000-0000-0000-000000000002',
        kind: 'add',
        boq_item_id: null,
        qty_delta: null,
        section_id: '00000000-0000-0000-0000-000000000004',
        code: 'A1',
        description: 'New cable tray',
        unit: 'm',
        quantity: '10',
        rate_model: 'supply_install',
        supply_rate: '100',
        install_rate: '25',
        rate: null,
        value_change: '1250',
        materialized_item_id: null,
      })
      expect(line.qtyDelta).toBeNull()
      expect(line.quantity).toBe(10)
      expect(line.supplyRate).toBe(100)
      expect(line.installRate).toBe(25)
      expect(line.valueChange).toBe(1250)
      expect(line.kind).toBe('add')
    })
  })

  describe('rowToVariationOrder', () => {
    it('maps vo_no and net_change correctly', () => {
      const vo = rowToVariationOrder({
        id: '00000000-0000-0000-0000-000000000001',
        project_id: '00000000-0000-0000-0000-000000000002',
        organisation_id: '00000000-0000-0000-0000-000000000003',
        boq_import_id: '00000000-0000-0000-0000-000000000004',
        vo_no: 1,
        vo_date: '2026-06-11',
        title: 'VO 001',
        reason: 'Extra works',
        status: 'draft',
        net_change: null,
        approved_by: null,
        approved_at: null,
      })
      expect(vo.voNo).toBe(1)
      expect(vo.netChange).toBeNull()
      expect(vo.status).toBe('draft')
      expect(vo.reason).toBe('Extra works')
    })

    it('maps approved fields when present', () => {
      const vo = rowToVariationOrder({
        id: '00000000-0000-0000-0000-000000000001',
        project_id: '00000000-0000-0000-0000-000000000002',
        organisation_id: '00000000-0000-0000-0000-000000000003',
        boq_import_id: '00000000-0000-0000-0000-000000000004',
        vo_no: 2,
        vo_date: '2026-06-11',
        title: 'VO 002',
        reason: null,
        status: 'approved',
        net_change: '1500.50',
        approved_by: '00000000-0000-0000-0000-000000000005',
        approved_at: '2026-06-11T10:00:00Z',
      })
      expect(vo.voNo).toBe(2)
      expect(vo.netChange).toBe(1500.5)
      expect(vo.approvedBy).toBe('00000000-0000-0000-0000-000000000005')
      expect(vo.approvedAt).toBe('2026-06-11T10:00:00Z')
    })
  })

  describe('variationLineToRow', () => {
    it('emits only defined keys (partial patch)', () => {
      const row = variationLineToRow({ qtyDelta: -3, valueChange: -300 })
      expect(row).toEqual({ qty_delta: -3, value_change: -300 })
    })

    it('maps all fields snake_case', () => {
      const row = variationLineToRow({
        kind: 'add',
        sectionId: '00000000-0000-0000-0000-000000000001',
        description: 'New item',
        unit: 'no',
        quantity: 5,
        rateModel: 'single',
        rate: 200,
        supplyRate: null,
        installRate: null,
        valueChange: 1000,
        materializedItemId: null,
      })
      expect(row.kind).toBe('add')
      expect(row.section_id).toBe('00000000-0000-0000-0000-000000000001')
      expect(row.rate_model).toBe('single')
      expect(row.value_change).toBe(1000)
      expect(row.materialized_item_id).toBeNull()
    })
  })
})
