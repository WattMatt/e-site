import { describe, it, expect } from 'vitest'
import {
  sheetEndpoints,
  runAssigned,
  nextStatusStep,
  applySaveToRun,
  pageScaleFor,
  applyCalibrationToSheet,
  lastSheetOf,
} from './route-canvas-logic'
import type { ActiveSheet, RunRow, RunSegment } from './types'

const seg = (over: Partial<RunSegment>): RunSegment => ({
  id: 's1', seq: 1, floorPlanId: 'plan-a', floorPlanName: 'A', pageIndex: 1,
  points: [0, 0, 30, 40], pixelsPerMeter: 10, lengthM: 5, ...over,
})

const run: RunRow = {
  supplyId: 'sup', fromCode: 'MB 1', toCode: 'DB 2', voltageV: 400, section: null, strands: 2,
  scheduleLengthM: null, route: null,
}

describe('sheetEndpoints', () => {
  it('returns both ends of every leg on THIS sheet and page only', () => {
    const legs = [
      { floorPlanId: 'plan-a', pageIndex: 1, points: [0, 0, 10, 0, 10, 10] },
      { floorPlanId: 'plan-a', pageIndex: 2, points: [5, 5, 6, 6] },
      { floorPlanId: 'plan-b', pageIndex: 1, points: [7, 7, 8, 8] },
      { floorPlanId: 'plan-a', pageIndex: 1, points: [1, 1] }, // degenerate
    ]
    expect(sheetEndpoints(legs, 'plan-a', 1)).toEqual([[0, 0], [10, 10]])
  })
})

describe('runAssigned', () => {
  it('is true only when the schedule holds the route total to the millimetre', () => {
    expect(runAssigned(12.34, 12.34, 1)).toBe(true)
    expect(runAssigned(12.35, 12.34, 1)).toBe(false)
    expect(runAssigned(12.34, 12.34, 0)).toBe(false)
    expect(runAssigned(null, 12.34, 1)).toBe(false)
  })
})

describe('nextStatusStep', () => {
  it('is 1 while anything is in progress, whatever the run holds', () => {
    expect(nextStatusStep({ pending: true, drafting: false, legs: 3, assigned: true })).toBe(1)
    expect(nextStatusStep({ pending: false, drafting: true, legs: 3, assigned: true })).toBe(1)
  })
  it('moves 1 → 2 → 3 with legs and then assignment', () => {
    expect(nextStatusStep({ pending: false, drafting: false, legs: 0, assigned: false })).toBe(1)
    expect(nextStatusStep({ pending: false, drafting: false, legs: 1, assigned: false })).toBe(2)
    expect(nextStatusStep({ pending: false, drafting: false, legs: 1, assigned: true })).toBe(3)
  })
})

describe('applySaveToRun', () => {
  it('recomputes traced and total from the returned legs and carries the new token', () => {
    const next = applySaveToRun(run, {
      segments: [seg({ lengthM: 5 }), seg({ id: 's2', seq: 2, lengthM: 7.25 })],
      riseM: 1.5, dropM: 0.5, updatedAt: '2026-09-22T10:00:00Z',
    })
    expect(next.route?.tracedM).toBeCloseTo(12.25, 6)
    expect(next.route?.totalM).toBeCloseTo(14.25, 6)
    expect(next.route?.updatedAt).toBe('2026-09-22T10:00:00Z')
    expect(next.route?.segments).toHaveLength(2)
    // The schedule figure is untouched: tracing never assigns.
    expect(next.scheduleLengthM).toBeNull()
  })
})

const sheet: ActiveSheet = {
  id: 'plan-a', name: 'A', signedUrl: null, isPdf: true, width_px: null, height_px: null,
  pixels_per_meter: 20, calibration_points: null, calibration_metres: null, calibration_page_index: null,
  page_scales: [{ pageIndex: 3, pixelsPerMeter: 33, points: null, metres: null }],
}

describe('pageScaleFor', () => {
  it('uses the page scale when present, the drawing scale on page 1 only, and null elsewhere', () => {
    expect(pageScaleFor(sheet, 3)).toBe(33)
    expect(pageScaleFor(sheet, 1)).toBe(20)
    expect(pageScaleFor(sheet, 2)).toBeNull()
  })
})

describe('applyCalibrationToSheet', () => {
  it('writes page 1 to the drawing-level columns and other pages to page_scales, replacing an existing entry', () => {
    const p1 = applyCalibrationToSheet(sheet, { pageIndex: 1, pixelsPerMeter: 25, points: [0, 0, 100, 0], metres: 4 })
    expect(p1.pixels_per_meter).toBe(25)
    expect(p1.calibration_page_index).toBe(1)
    expect(p1.page_scales).toEqual(sheet.page_scales)
    const p3 = applyCalibrationToSheet(sheet, { pageIndex: 3, pixelsPerMeter: 40, points: [0, 0, 80, 0], metres: 2 })
    expect(p3.pixels_per_meter).toBe(20)
    expect(p3.page_scales).toEqual([{ pageIndex: 3, pixelsPerMeter: 40, points: [0, 0, 80, 0], metres: 2 }])
  })
})

describe('lastSheetOf', () => {
  it('names the sheet and page of the last leg, and null for an untraced or orphaned run', () => {
    const traced: RunRow = { ...run, route: { riseM: 0, dropM: 0, tracedM: 5, totalM: 5, updatedAt: null, segments: [seg({}), seg({ id: 's2', floorPlanId: 'plan-b', pageIndex: 2 })] } }
    expect(lastSheetOf(traced)).toEqual({ planId: 'plan-b', page: 2 })
    expect(lastSheetOf(run)).toBeNull()
    const orphan: RunRow = { ...run, route: { riseM: 0, dropM: 0, tracedM: 5, totalM: 5, updatedAt: null, segments: [seg({ floorPlanId: null })] } }
    expect(lastSheetOf(orphan)).toBeNull()
  })
})
