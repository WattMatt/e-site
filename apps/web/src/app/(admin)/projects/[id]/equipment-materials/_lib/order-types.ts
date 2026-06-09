/**
 * order-types — procurement-document types for the Equipment & Materials tab.
 *
 * Relocated here from the (now-deleted) Materials-tab components so the live
 * unified tab no longer depends on dead files for its types. These describe the
 * documents attached to a node order: quote / order-instruction slots and the
 * shop-drawing list.
 */

import type { HandoverCategory } from '@esite/shared'

/** A single attached order document (Quote / Order instruction). */
export interface OrderDoc {
  storage_path: string
  file_name: string
}

export type ShopDrawingStatus = 'awaiting' | 'received' | 'approved'

/** One shop drawing on a node order. */
export interface ShopDrawing {
  id: string
  file_name: string
  storage_path: string
  status: ShopDrawingStatus
  handover_category: HandoverCategory | null
}
