// apps/mobile/src/inspections/outbox-worker.ts
//
// Drains the inspection outbox (response-outbox.ts) to Supabase as the
// signed-in user: every 5 s, and at once when kicked (an answer was saved or
// Submit was pressed). Started on app boot from app/_layout.tsx beside the
// photo/signature upload worker.
import { supabase } from '../lib/supabase'
import { powerSyncExecutor } from '../lib/powersync/executor'
import { createInspectionRemote, type SchemaClient } from './inspection-remote'
import { drainOnce, type DrainResult } from './response-outbox'

export const inspectionRemote = createInspectionRemote(supabase as unknown as SchemaClient)

const TICK_MS = 5_000
const listeners = new Set<() => void>()
let running = false
let wake: (() => void) | null = null
let draining: Promise<DrainResult | null> | null = null

/** Subscribe to "the outbox changed" (rows uploaded, refused or backing off). */
export function onOutboxChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function notifyOutboxChanged(): void {
  for (const cb of listeners) {
    try {
      cb()
    } catch {
      // a listener's failure must not stop the others
    }
  }
}

/** Run one drain now (shared if one is already running). */
export function drainNow(): Promise<DrainResult | null> {
  if (draining) return draining
  draining = (async () => {
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user.id
    if (!userId) return null
    const result = await drainOnce(powerSyncExecutor, inspectionRemote, { responderId: userId, now: Date.now() })
    if (result.uploaded || result.retrying || result.rejected) notifyOutboxChanged()
    if (result.retrying || result.rejected) {
      console.warn('[inspection-outbox]', result)
    }
    return result
  })().finally(() => {
    draining = null
  })
  return draining
}

/** Wake the worker early (e.g. right after an answer is queued). */
export function kickOutbox(): void {
  wake?.()
}

export async function startOutboxWorker(): Promise<void> {
  if (running) return
  running = true
  while (running) {
    try {
      await drainNow()
    } catch (e) {
      // Never let the loop die (e.g. SQLite busy); try again next tick.
      console.warn('[inspection-outbox] drain error', e)
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, TICK_MS)
      wake = () => {
        clearTimeout(timer)
        resolve()
      }
    })
    wake = null
  }
}

export function stopOutboxWorker(): void {
  running = false
  wake?.()
}
