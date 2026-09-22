/**
 * The shapes the measure page hands its client components. Kept in a plain
 * module so the pure logic and the tests can import them without pulling in
 * a 'use client' component.
 */

export interface PlanRow {
  id: string
  name: string
  isPdf: boolean
  /** PDF or a raster the canvas can render; DWG and friends are listed but not traceable. */
  renderable: boolean
  filePath: string
  pixelsPerMeter: number | null
}

export interface RunSegment {
  id: string
  seq: number
  /** NULL when the drawing was deleted or de-activated after tracing. */
  floorPlanId: string | null
  floorPlanName: string
  pageIndex: number
  points: number[]
  pixelsPerMeter: number
  lengthM: number
}

export interface RunRoute {
  riseM: number
  dropM: number
  tracedM: number
  totalM: number
  /** The concurrency token every save must present. */
  updatedAt: string | null
  segments: RunSegment[]
}

export interface RunRow {
  supplyId: string
  fromCode: string
  toCode: string
  voltageV: number
  section: string | null
  strands: number
  /** What the schedule currently says, if anything (any strand's figure). */
  scheduleLengthM: number | null
  route: RunRoute | null
}

export interface PageScale {
  pageIndex: number
  pixelsPerMeter: number
  points: number[] | null
  metres: number | null
}

/** The sheet open on the canvas, with everything the canvas needs to draw it. */
export interface ActiveSheet {
  id: string
  name: string
  signedUrl: string | null
  isPdf: boolean
  width_px: number | null
  height_px: number | null
  /** The drawing-level scale — the page-1 scale for a PDF. */
  pixels_per_meter: number | null
  calibration_points: number[] | null
  calibration_metres: number | null
  calibration_page_index: number | null
  /** Scales for pages other than 1 (00199). */
  page_scales: PageScale[]
}
