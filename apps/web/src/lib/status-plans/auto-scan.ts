/**
 * Whether opening a sheet should scan it straight away (upload → scan → map),
 * only for someone who can add shapes and only for a PDF with a file link; a
 * read-only viewer never triggers a scan.
 *
 * - Line diagram: a sheet with nothing drawn on it yet. A sheet that already
 *   has shapes is re-scanned by hand ("Scan sheet for blocks").
 * - Floor plan: a sheet with no shop linked to a board yet, or one whose file
 *   was replaced (its shapes may no longer sit on the new drawing).
 */
import type { StatusPlanPurpose } from '@esite/shared/status-plans'

export interface AutoScanInput {
  purpose: StatusPlanPurpose
  canEdit: boolean
  isPdf: boolean
  /** The sheet's signed file URL is present. */
  hasFileUrl: boolean
  /** Shapes already on THIS sheet. */
  shapeCount: number
  /** Shapes on THIS sheet that are linked to a board (see `countLinkedShapes`). */
  linkedShapeCount: number
  /** The sheet's file was replaced and not yet re-anchored. */
  replaced: boolean
}

/** A shape counts only when linked to a board; area-typed shapes carry no node. */
export function countLinkedShapes(shapes: ReadonlyArray<{ nodeId: string | null }>): number {
  return shapes.filter((s) => s.nodeId !== null).length
}

export function shouldAutoScan(i: AutoScanInput): boolean {
  if (!i.canEdit || !i.isPdf || !i.hasFileUrl) return false
  if (i.purpose === 'distribution_schematic') return i.shapeCount === 0
  if (i.purpose === 'tenant_layout') return i.linkedShapeCount === 0 || i.replaced
  return false
}
