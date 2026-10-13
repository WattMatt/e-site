/**
 * "Show on drawing" (spec 2026-10-13 §2): the canvas zooms so a box fills ~60 % of the
 * view, then blinks an outline round it for 2 s. Pure timing, so the rule is testable
 * without Konva.
 */
export const FOCUS_FILL = 0.6
export const FOCUS_PULSE_MS = 2000
export const FOCUS_BLINK_MS = 250
/** How often the canvas re-renders while a pulse runs. */
export const FOCUS_TICK_MS = 125
/** The selection blue: a pulse reads as "this one". */
export const FOCUS_COLOUR = '#2563EB'

export function pulseVisible(elapsedMs: number): boolean {
  if (!(elapsedMs >= 0) || elapsedMs >= FOCUS_PULSE_MS) return false
  return Math.floor(elapsedMs / FOCUS_BLINK_MS) % 2 === 0
}
