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

interface SettledSave {
  patch: GcrAssignmentPatch
  failed: boolean
}

/**
 * Save queue for tenant assignments.
 * - `pending` is the optimistic overlay (display = server + pending); it is set
 *   for EVERY commit immediately, so the UI always shows the user's intent.
 * - Per-node serialization is strict FIFO via tail-promise chaining: each commit
 *   synchronously captures each node's current tail, registers itself as the new
 *   tail for ALL its nodes (before any await), then awaits its predecessors once.
 *   This closes the queue-jump window — no later commit can overtake an earlier
 *   one on any shared node, even during the drain.
 * - If a predecessor FAILED, its fields are inherited into the new patch
 *   (last-write-wins per field) so nothing is silently dropped.
 * - Success: status flashes 'saved'; the node is marked settled, and reconcile
 *   drops its overlay on the NEXT props delivery (revalidatePath ran before the
 *   action returned, so that delivery contains the write) — no unbounded staleness.
 * - Failure: only the failed patch's keys leave the overlay (earlier still-pending
 *   fields survive); status carries the message and patch for retry.
 */
export function useAssignmentSaves(projectId: string) {
  const router = useRouter()
  const [pending, setPending] = useState<Record<string, GcrAssignmentPatch>>({})
  const [status, setStatus] = useState<Record<string, SaveStatus>>({})
  const inFlight = useRef<Map<string, Promise<SettledSave>>>(new Map())
  const settled = useRef<Set<string>>(new Set())
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
    // Show the user's intent immediately, even while queued behind earlier saves.
    setPending((prev) => {
      const next = { ...prev }
      for (const id of nodeIds) next[id] = { ...next[id], ...patch }
      return next
    })
    patchState(setStatus, nodeIds, { state: 'saving' } as SaveStatus)

    // Strict per-node FIFO: synchronously take each node's current tail promise
    // as our predecessor and register ourselves as the new tail — BEFORE any
    // await, so no later commit can jump the queue on any of our nodes.
    const predecessors = [...new Set(nodeIds.map((id) => inFlight.current.get(id)).filter(Boolean))] as Promise<SettledSave>[]
    let resolveSettled!: (v: SettledSave) => void
    const settledPromise = new Promise<SettledSave>((r) => { resolveSettled = r })
    for (const id of nodeIds) inFlight.current.set(id, settledPromise)

    let merged = patch
    let res!: Awaited<ReturnType<typeof bulkSaveTenantAssignmentsAction>>
    try {
      if (predecessors.length > 0) {
        const settledPredecessors = await Promise.all(predecessors)
        // Inherit the fields of FAILED predecessors so their intent isn't lost.
        for (const r of settledPredecessors) {
          if (r.failed) merged = { ...r.patch, ...merged }
        }
        // A failed predecessor's cleanup may have cleared our status/overlay —
        // re-assert them (now including any inherited fields) for the dispatch.
        setPending((prev) => {
          const next = { ...prev }
          for (const id of nodeIds) next[id] = { ...next[id], ...merged }
          return next
        })
        patchState(setStatus, nodeIds, { state: 'saving' } as SaveStatus)
      }

      try {
        res = await bulkSaveTenantAssignmentsAction(projectId, nodeIds, merged)
      } catch (e) {
        res = { error: e instanceof Error ? e.message : 'Save failed — check your connection' }
      }

      for (const id of nodeIds) {
        if (inFlight.current.get(id) === settledPromise) inFlight.current.delete(id)
      }

      if ('error' in res) {
        console.error('[gcr-tenants] save failed', { nodeIds, patch: merged, error: res.error })
        // Drop ONLY the failed patch's keys; earlier still-pending fields survive.
        setPending((prev) => {
          const next = { ...prev }
          for (const id of nodeIds) {
            const entry = next[id]
            if (!entry) continue
            const remaining = { ...entry }
            for (const key of Object.keys(merged) as (keyof GcrAssignmentPatch)[]) delete remaining[key]
            if (Object.keys(remaining).length === 0) delete next[id]
            else next[id] = remaining
          }
          return next
        })
        patchState(setStatus, nodeIds, { state: 'error', message: res.error, patch: merged } as SaveStatus)
      } else {
        for (const id of nodeIds) settled.current.add(id)
        patchState(setStatus, nodeIds, { state: 'saved' } as SaveStatus)
        for (const id of nodeIds) {
          const existing = timers.current.get(id)
          if (existing) clearTimeout(existing)
          timers.current.set(id, setTimeout(() => {
            setStatus((prev) => {
              if (prev[id]?.state !== 'saved') return prev
              const { [id]: dropped, ...rest } = prev
              void dropped
              return rest
            })
          }, SAVED_FLASH_MS))
        }
        router.refresh()
      }
    } finally {
      // Guaranteed resolution — successors must never hang.
      resolveSettled({ patch: merged, failed: 'error' in res })
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

  /**
   * Call when server props change. Drops pending overlays that the server now
   * agrees with, and overlays whose save succeeded (settled) — that props
   * delivery is guaranteed to contain the write. In-flight nodes are skipped.
   */
  function reconcile(serverMatches: (nodeId: string, patch: GcrAssignmentPatch) => boolean) {
    setPending((prev) => {
      let changed = false
      const next: typeof prev = {}
      for (const [id, entry] of Object.entries(prev)) {
        if (inFlight.current.has(id)) { next[id] = entry; continue }
        if (settled.current.has(id) || serverMatches(id, entry)) {
          settled.current.delete(id)
          changed = true
          continue
        }
        next[id] = entry
      }
      return changed ? next : prev
    })
  }

  return { pending, status, commit, commitWithResult, retry, reconcile }
}
