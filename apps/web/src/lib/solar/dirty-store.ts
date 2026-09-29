'use client'

/**
 * One "unsaved changes" flag for the Solar module. A form sets it through
 * useSolarDirtyGuard; the tab bar reads it before navigating and asks
 * "Discard unsaved changes?" inline (never window.confirm). The guard also
 * arms the browser's beforeunload prompt for tab-close / reload.
 */
import { useEffect, useState } from 'react'

let dirty = false

export function isSolarDirty(): boolean {
  return dirty
}

export function setSolarDirty(value: boolean): void {
  dirty = value
}

export function useSolarDirtyGuard(isDirty: boolean): void {
  useEffect(() => {
    setSolarDirty(isDirty)
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  useEffect(() => () => setSolarDirty(false), [])
}

/**
 * The same guard for in-page navigation (YF-08): opening another case, Compare, New case → Create
 * and the Financials case picker. `guard(proceed)` runs `proceed` at once when nothing is unsaved;
 * otherwise it holds it until the user presses Discard (render <DiscardChangesPrompt> while
 * `pending`). The flag is NOT cleared on Discard: the navigation remounts the editor, whose unmount
 * clears it — and a step that does not navigate (a refused create) must leave the draft guarded.
 */
export function useSolarDiscardGuard(): { pending: boolean; guard: (proceed: () => void) => void; discard: () => void; stay: () => void } {
  const [pending, setPending] = useState<(() => void) | null>(null)
  return {
    pending: pending !== null,
    guard: (proceed) => {
      if (isSolarDirty()) setPending(() => proceed)
      else proceed()
    },
    discard: () => {
      const p = pending
      setPending(null)
      p?.()
    },
    stay: () => setPending(null),
  }
}
