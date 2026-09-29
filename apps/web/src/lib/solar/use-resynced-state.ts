'use client'
/**
 * State seeded from props that RE-SEEDS whenever `version` (the source row's updated_at) changes.
 *
 * A form copies its row into useState once; after router.refresh() brings a newer row (someone's
 * auto-match, another editor on the same study row, our own save), plain useState keeps the old copy,
 * so the form shows stale values and its next save is refused as someone else's change. Keyed on the
 * version, the refreshed row replaces the local copy and the next save carries the new version.
 */
import { useState, type Dispatch, type SetStateAction } from 'react'

export function useResyncedState<T>(fromProps: T, version: unknown): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(fromProps)
  const [seen, setSeen] = useState<unknown>(version)
  if (!Object.is(seen, version)) {
    // React's "adjust state when a prop changes" pattern: set during render, no effect round-trip.
    setSeen(version)
    setValue(fromProps)
  }
  return [value, setValue]
}
