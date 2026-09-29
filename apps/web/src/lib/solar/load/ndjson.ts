// apps/web/src/lib/solar/load/ndjson.ts
import type { RebuildEvent } from './view-types'

/** Split a streamed NDJSON buffer into complete events and the unfinished tail. */
export function parseNdjson(rest: string, chunk: string): { events: RebuildEvent[]; rest: string } {
  const buf = rest + chunk
  const parts = buf.split('\n')
  const tail = parts.pop() ?? ''
  const events = parts.filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as RebuildEvent)
  return { events, rest: tail }
}
