/**
 * Which scale is in force on a page of a drawing.
 *
 * A PDF page other than 1 needs its own scale (tenants.floor_plan_page_scales,
 * 00199); page 1 falls back to the drawing's own floor_plans.pixels_per_meter.
 * Page 2+ without its own scale is UNSCALED: anything measured there would be
 * a guess, and every consumer must treat null as "no area / no length".
 *
 * Shared by the cable measure page and status plans so the two can never
 * disagree about the scale of the same page.
 */
export interface PageScaleRow {
  pageIndex: number
  pixelsPerMeter: number
}

export interface ScaledSheet {
  pixels_per_meter: number | null
  page_scales: ReadonlyArray<PageScaleRow>
}

export function pageScaleFor(sheet: ScaledSheet, page: number): number | null {
  const own = sheet.page_scales.find((s) => s.pageIndex === page)
  if (own) return own.pixelsPerMeter
  return page === 1 ? sheet.pixels_per_meter : null
}

/**
 * The sheet after a calibration was saved on `pageIndex`. The page's own entry
 * is always written, so `pageScaleFor` returns the new figure whichever table
 * the server wrote; page 1 also updates the drawing-level figure.
 */
export function withPageScale<S extends ScaledSheet>(sheet: S, pageIndex: number, pixelsPerMeter: number): S {
  const rest = sheet.page_scales.filter((s) => s.pageIndex !== pageIndex)
  return {
    ...sheet,
    pixels_per_meter: pageIndex === 1 ? pixelsPerMeter : sheet.pixels_per_meter,
    page_scales: [...rest, { pageIndex, pixelsPerMeter }],
  } as S
}
