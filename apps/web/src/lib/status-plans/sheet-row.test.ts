import { describe, it, expect } from 'vitest'
import type { StatusPlanSheetRow } from '@esite/shared/status-plans'
import { SHEET_COLUMNS, summaryOf, toSheetSummary } from './sheet-row'
import { jsonUnsafePath } from './json-safe'

const ROW: StatusPlanSheetRow = {
  id: 'sh1', status_plan_id: 'pl1', organisation_id: 'o', sort_order: 2, label: 'Level 1', file_path: 'o/p/pl1/sh1/2.pdf',
  page_index: 3, file_name: 'E-101 rev C.pdf', mime: 'application/pdf', revision: 2, replaced_at: '2026-10-12T10:00:00Z',
  replaced_from_path: 'o/p/pl1/sh1/1.pdf', pixels_per_meter: '31.25', calibration_points: [0, 0, 125, 0], calibration_metres: '4',
  created_by: 'u', created_at: 't0', updated_at: 't1',
}

describe('toSheetSummary', () => {
  it('keeps what the page needs, coerces numerics, and is JSON', () => {
    const s = toSheetSummary(ROW)
    expect(s).toEqual({
      id: 'sh1', label: 'Level 1', sortOrder: 2, fileName: 'E-101 rev C.pdf', mime: 'application/pdf', pageIndex: 3,
      revision: 2, replacedAt: '2026-10-12T10:00:00Z', pixelsPerMeter: 31.25, updatedAt: 't1',
    })
    expect(jsonUnsafePath(s)).toBeNull()
  })
  it('an unscaled sheet has a null scale', () => {
    expect(toSheetSummary({ ...ROW, pixels_per_meter: null }).pixelsPerMeter).toBeNull()
  })
  it('selects every column the summary reads', () => {
    for (const c of ['id', 'sort_order', 'label', 'file_path', 'page_index', 'file_name', 'mime', 'revision', 'replaced_at', 'pixels_per_meter', 'updated_at']) {
      expect(SHEET_COLUMNS.split(', ')).toContain(c)
    }
  })
})

describe('summaryOf', () => {
  it('drops the canvas-only fields', () => {
    const sheet = { ...toSheetSummary(ROW), signedUrl: 'https://x', isPdf: true }
    expect(summaryOf(sheet)).toEqual(toSheetSummary(ROW))
  })
})
