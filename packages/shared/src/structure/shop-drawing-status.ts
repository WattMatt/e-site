/** Pure status-lifecycle helpers for material-order shop drawings. */

export type ShopDrawingStatus = 'awaiting' | 'received' | 'approved'

const FORWARD: Record<ShopDrawingStatus, ShopDrawingStatus | null> = {
  awaiting: 'received',
  received: 'approved',
  approved: null,
}

const BACKWARD: Record<ShopDrawingStatus, ShopDrawingStatus | null> = {
  awaiting: null,
  received: 'awaiting',
  approved: 'received',
}

export function nextStatus(s: ShopDrawingStatus): ShopDrawingStatus | null {
  return FORWARD[s]
}

export function prevStatus(s: ShopDrawingStatus): ShopDrawingStatus | null {
  return BACKWARD[s]
}

/** True only for a single forward step (no skipping, no no-ops). */
export function canAdvanceTo(from: ShopDrawingStatus, to: ShopDrawingStatus): boolean {
  return FORWARD[from] === to
}
