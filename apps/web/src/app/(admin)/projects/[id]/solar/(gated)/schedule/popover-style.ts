import type { CSSProperties } from 'react'

/** The shared look of the toolbar's drop-down panels. */
export const POPOVER: CSSProperties = {
  position: 'absolute', zIndex: 20, top: '100%', marginTop: 4, padding: 12,
  background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 6, fontSize: 12,
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
}
