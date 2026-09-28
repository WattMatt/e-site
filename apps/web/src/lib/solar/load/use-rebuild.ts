'use client'
/** Drives POST …/site-load/rebuild and reports its NDJSON progress (spec §4.5 "Server job; shows progress"). */
import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseNdjson } from './ndjson'
import type { RebuildEvent } from './view-types'

export interface RebuildState {
  running: boolean
  message: string | null
  error: string | null
  done: { basis: string; referenceYear: number; checks: number } | null
}

export function rebuildMessage(e: RebuildEvent): string {
  if (e.type === 'error') return e.message
  if (e.type === 'done') return `Site profile rebuilt — basis ${e.basis}, reference year ${e.referenceYear}, ${e.checks} checks to review.`
  if (e.stage === 'reading') return e.total > 1 ? `Reading meter data… ${e.done} of ${e.total} channels` : 'Reading meter data…'
  return e.stage === 'building' ? 'Building the site profile…' : 'Saving…'
}

export function useRebuild(projectId: string) {
  const router = useRouter()
  const [state, setState] = useState<RebuildState>({ running: false, message: null, error: null, done: null })
  const run = useCallback(async (): Promise<boolean> => {
    setState({ running: true, message: 'Starting…', error: null, done: null })
    let ok = false
    try {
      const res = await fetch(`/api/projects/${projectId}/solar/site-load/rebuild`, { method: 'POST' })
      if (!res.ok || !res.body) {
        setState({ running: false, message: null, done: null, error: res.status === 403 ? 'You need Solar edit access to rebuild the profile.' : 'The site profile could not be built — try again.' })
        return false
      }
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let rest = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        const parsed = parseNdjson(rest, dec.decode(value, { stream: true }))
        rest = parsed.rest
        for (const e of parsed.events) {
          if (e.type === 'progress') setState((s) => ({ ...s, message: rebuildMessage(e) }))
          else if (e.type === 'error') setState({ running: false, message: null, done: null, error: e.message })
          else { ok = true; setState({ running: false, message: rebuildMessage(e), error: null, done: { basis: e.basis, referenceYear: e.referenceYear, checks: e.checks } }) }
        }
      }
      if (!ok) setState((s) => (s.error ? s : { running: false, message: null, done: null, error: 'The site profile could not be built — try again.' }))
    } catch {
      setState({ running: false, message: null, done: null, error: 'The site profile could not be built — check your connection and try again.' })
    } finally {
      // Refresh on failure too: the save that preceded the rebuild (or a partial rebuild) may have moved
      // the study version, and every editor on the page re-seeds its version from the refreshed props.
      router.refresh()
    }
    return ok
  }, [projectId, router])
  return { state, run }
}
