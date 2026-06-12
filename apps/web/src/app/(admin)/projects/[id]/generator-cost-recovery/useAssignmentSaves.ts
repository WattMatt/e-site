'use client'

import { useRef, useState, useEffect, type Dispatch, type SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import { bulkSaveTenantAssignmentsAction } from './gcr.actions'
import type { GcrAssignmentPatch } from './gcr.schemas'

export type SaveStatus =
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'error'; message: string; patch: GcrAssignmentPatch }

const SAVED_FLASH_MS = 1500

/**
 * Save queue for tenant assignments.
 * - `pending` is the optimistic overlay (display = server + pending).
 * - Saves for a node already in flight coalesce into one follow-up save.
 * - Success: status flashes 'saved', router.refresh() pulls server truth;
 *   the overlay entry is dropped by reconcile() once props match it.
 * - Failure: overlay dropped immediately (cells snap back), status carries
 *   the message and the failed patch for retry.
 */
export function useAssignmentSaves(projectId: string) {
  const router = useRouter()
  const [pending, setPending] = useState<Record<string, GcrAssignmentPatch>>({})
  const [status, setStatus] = useState<Record<string, SaveStatus>>({})
  const inFlight = useRef<Set<string>>(new Set())
  const queued = useRef<Map<string, GcrAssignmentPatch>>(new Map())
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t) }, [])

  function patchState<T>(setter: Dispatch<SetStateAction<Record<string, T>>>, ids: string[], value: T | undefined) {
    setter((prev) => {
      const next = { ...prev }
      for (const id of ids) {
        if (value === undefined) delete next[id]
        else next[id] = value
      }
      return next
    })
  }

  async function commitWithResult(
    nodeIds: string[],
    patch: GcrAssignmentPatch,
  ): Promise<{ ok: true; updated: number } | { error: string }> {
    const now: string[] = []
    for (const id of nodeIds) {
      if (inFlight.current.has(id)) {
        queued.current.set(id, { ...queued.current.get(id), ...patch })
      } else {
        now.push(id)
        inFlight.current.add(id)
      }
    }
    if (now.length === 0) return { ok: true, updated: 0 } // everything coalesced into queued follow-ups

    setPending((prev) => {
      const next = { ...prev }
      for (const id of now) next[id] = { ...next[id], ...patch }
      return next
    })
    patchState(setStatus, now, { state: 'saving' } as SaveStatus)

    let res: Awaited<ReturnType<typeof bulkSaveTenantAssignmentsAction>>
    try {
      res = await bulkSaveTenantAssignmentsAction(projectId, now, patch)
    } catch (e) {
      res = { error: e instanceof Error ? e.message : 'Save failed — check your connection' }
    }

    for (const id of now) inFlight.current.delete(id)

    if ('error' in res) {
      console.error('[gcr-tenants] save failed', { nodeIds: now, patch, error: res.error })
      patchState(setPending, now, undefined)
      patchState(setStatus, now, { state: 'error', message: res.error, patch } as SaveStatus)
    } else {
      patchState(setStatus, now, { state: 'saved' } as SaveStatus)
      for (const id of now) {
        const existing = timers.current.get(id)
        if (existing) clearTimeout(existing)
        timers.current.set(id, setTimeout(() => {
          setStatus((prev) => (prev[id]?.state === 'saved' ? (({ [id]: _, ...rest }) => rest)(prev) : prev))
        }, SAVED_FLASH_MS))
      }
      router.refresh()
    }

    // Follow-ups queued while this save was in flight
    for (const id of now) {
      const q = queued.current.get(id)
      if (q) {
        queued.current.delete(id)
        void commitWithResult([id], q)
      }
    }
    return res
  }

  /** Fire-and-track save — per-row UI feedback only, no caller result needed. */
  function commit(nodeIds: string[], patch: GcrAssignmentPatch) {
    void commitWithResult(nodeIds, patch)
  }

  function retry(nodeId: string) {
    const st = status[nodeId]
    if (st?.state === 'error') commit([nodeId], st.patch)
  }

  /** Drop pending overlays the server now agrees with (call when props change). */
  function reconcile(serverMatches: (nodeId: string, patch: GcrAssignmentPatch) => boolean) {
    setPending((prev) => {
      let changed = false
      const next: typeof prev = {}
      for (const [id, patch] of Object.entries(prev)) {
        if (!inFlight.current.has(id) && serverMatches(id, patch)) { changed = true; continue }
        next[id] = patch
      }
      return changed ? next : prev
    })
  }

  return { pending, status, commit, commitWithResult, retry, reconcile }
}
