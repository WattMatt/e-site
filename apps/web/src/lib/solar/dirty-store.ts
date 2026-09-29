'use client'

/**
 * One "unsaved changes" flag for the Solar module. A form sets it through
 * useSolarDirtyGuard; the tab bar reads it before navigating and asks
 * "Discard unsaved changes?" inline (never window.confirm). The guard also
 * arms the browser's beforeunload prompt for tab-close / reload.
 */
import { useEffect } from 'react'

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
