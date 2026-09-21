/**
 * The two viewer decisions that were wrong in PR #196, extracted so they can be
 * tested without Konva.
 *
 * Both bugs were invisible to the action-level tests because those called
 * `saveFloorPlanMarkupAction` directly with an explicit `markupId`. Nothing
 * exercised the VIEWER's job: deciding what to send and what to keep. That is
 * the same mistake this repo keeps finding — the check and the artefact derived
 * from the same intent — so the decision is pulled out here rather than left
 * inline in a 900-line component that cannot be mounted under jsdom.
 *
 * Precedent: `markup-geometry.ts`, carved out of MarkupCanvas for exactly this.
 */

import type { ViewerMode } from './MarkupCanvas'

/** The layer the session is currently writing to. */
export type ActiveLayer = { id: string; name: string; updatedAt: string }

/**
 * Build the viewer's querystring for a mode change.
 *
 * ⚠ THE BUG THIS REPLACES: `const qs = next === 'view' ? '' : \`?mode=${next}\``
 * rebuilt the querystring from nothing and therefore dropped `markup=`. With a
 * saved layer open, pressing the RFI tab blanked the canvas — it is keyed on the
 * open layer, so it remounted with no scene — and then greyed both RFI buttons
 * because `shapes.length === 0`. The user's markup looked lost.
 *
 * Carrying the layer through is also the only thing that makes the sequence
 * "open a saved layer, then attach it to an RFI" possible at all.
 */
export function buildViewerQuery(next: ViewerMode, openMarkupId: string | null): string {
  const params = new URLSearchParams()
  // 'view' is the default, so it is expressed by the ABSENCE of mode — a bare
  // URL and `?mode=view` must not be two different things to share.
  if (next !== 'view') params.set('mode', next)
  if (openMarkupId) params.set('markup', openMarkupId)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/**
 * What a save must send, given the layer this session is already writing to.
 *
 * ⚠ THE BUG THIS REPLACES: the viewer read `openMarkup?.id`, which is sourced
 * from `?markup=` and is therefore NULL for a layer created in this session. So
 * the second press of Save INSERTed again, hit the (floor_plan_id, name) unique
 * constraint, and told the user to pick another name when they only wanted to
 * save their work again.
 *
 * `expectedUpdatedAt` must come from the same place as the id: it is the
 * concurrency token the server compares, and a token from page-load time would
 * be stale the moment this session saved once.
 */
export function saveTargetFor(
  active: ActiveLayer | null,
): { markupId?: string; expectedUpdatedAt?: string } {
  if (!active) return {}
  return { markupId: active.id, expectedUpdatedAt: active.updatedAt }
}

/**
 * Adopt the row a save returned, so the NEXT save updates it.
 *
 * Returns the previous layer unchanged when the action returned no row, because
 * a save that reports success without a row is a bug elsewhere and must not
 * silently detach the session from the layer it was writing to.
 */
export function adoptSavedLayer(
  prev: ActiveLayer | null,
  saved: { id: string; name: string; updatedAt: string } | undefined,
): ActiveLayer | null {
  if (!saved) return prev
  return { id: saved.id, name: saved.name, updatedAt: saved.updatedAt }
}
