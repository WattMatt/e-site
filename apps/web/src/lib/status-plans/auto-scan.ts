/**
 * Whether opening a sheet should scan it for DB blocks straight away
 * (upload → scan → map). Only a line diagram's PDF sheet with nothing drawn on
 * it yet, and only for someone who can add shapes: a sheet that already has
 * shapes is re-scanned by hand ("Scan sheet for blocks"), and a read-only
 * viewer never triggers a scan.
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
}

export function shouldAutoScan(i: AutoScanInput): boolean {
  return i.purpose === 'distribution_schematic' && i.canEdit && i.isPdf && i.hasFileUrl && i.shapeCount === 0
}
