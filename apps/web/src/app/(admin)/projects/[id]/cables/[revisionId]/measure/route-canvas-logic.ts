/**
 * The decisions the measure tool makes, pulled out of the components so they
 * can be tested without Konva or a DOM. The components own state; this module
 * owns the rules.
 */
import { routeTotalM } from '@esite/shared'
import type { ActiveSheet, RunRow, RunSegment } from './types'

/**
 * Where a new leg on this sheet may join up: both ends of every leg already
 * saved on this sheet AND page. Fed to `snapRouteVertex` for the first vertex.
 */
export function sheetEndpoints(
  legs: ReadonlyArray<{ floorPlanId: string | null; pageIndex: number; points: number[] }>,
  planId: string,
  page: number,
): Array<[number, number]> {
  return legs
    .filter((l) => l.floorPlanId === planId && l.pageIndex === page && l.points.length >= 4)
    .flatMap((l) => [
      [l.points[0], l.points[1]],
      [l.points[l.points.length - 2], l.points[l.points.length - 1]],
    ] as Array<[number, number]>)
}

/** The schedule holds exactly this route's total: nothing left to assign. */
export function runAssigned(scheduleLengthM: number | null, totalM: number, legs: number): boolean {
  return scheduleLengthM != null && legs > 0 && Math.abs(scheduleLengthM - totalM) < 0.005
}

/**
 * Which of the three steps the status strip should light: 1 trace, 2 rise &
 * drop, 3 schedule. Anything in progress on the canvas is step 1, whatever
 * the run already holds — the person is tracing.
 */
export function nextStatusStep(s: { pending: boolean; drafting: boolean; legs: number; assigned: boolean }): 1 | 2 | 3 {
  if (s.pending || s.drafting) return 1
  if (s.legs === 0) return 1
  return s.assigned ? 3 : 2
}

/**
 * Fold a save's result into the run row the worklist shows, so the list is
 * right the moment the server confirms a leg — without a `router.refresh()`,
 * which would re-mint the sheet's signed URL under the canvas.
 */
export function applySaveToRun(
  run: RunRow,
  saved: { segments: RunSegment[]; riseM: number; dropM: number; updatedAt: string | null },
): RunRow {
  const tracedM = routeTotalM({ segments: saved.segments.map((g) => ({ length_m: g.lengthM })), riseM: 0, dropM: 0 })
  const totalM = routeTotalM({ segments: saved.segments.map((g) => ({ length_m: g.lengthM })), riseM: saved.riseM, dropM: saved.dropM })
  return {
    ...run,
    route: { riseM: saved.riseM, dropM: saved.dropM, tracedM, totalM, updatedAt: saved.updatedAt, segments: saved.segments },
  }
}

/**
 * The scale in force on a page of the sheet: the page's own (00199) when it
 * has one, else the drawing-level scale on page 1 only. Page 2+ without its
 * own scale is UNSCALED, and a leg traced there is refused by the server.
 */
export function pageScaleFor(sheet: Pick<ActiveSheet, 'pixels_per_meter' | 'page_scales'>, page: number): number | null {
  const own = sheet.page_scales.find((s) => s.pageIndex === page)
  if (own) return own.pixelsPerMeter
  return page === 1 ? sheet.pixels_per_meter : null
}

/** Record a calibration the canvas just saved, on the sheet the page holds. */
export function applyCalibrationToSheet(
  sheet: ActiveSheet,
  c: { pageIndex: number; pixelsPerMeter: number; points: number[]; metres: number },
): ActiveSheet {
  if (c.pageIndex === 1) {
    return {
      ...sheet,
      pixels_per_meter: c.pixelsPerMeter,
      calibration_points: c.points,
      calibration_metres: c.metres,
      calibration_page_index: 1,
    }
  }
  const rest = sheet.page_scales.filter((s) => s.pageIndex !== c.pageIndex)
  return { ...sheet, page_scales: [...rest, { pageIndex: c.pageIndex, pixelsPerMeter: c.pixelsPerMeter, points: c.points, metres: c.metres }] }
}

/** The sheet a run should open on: the one its last leg was traced on. */
export function lastSheetOf(run: RunRow | null | undefined): { planId: string; page: number } | null {
  const legs = run?.route?.segments ?? []
  const last = legs[legs.length - 1]
  return last && last.floorPlanId ? { planId: last.floorPlanId, page: last.pageIndex } : null
}
