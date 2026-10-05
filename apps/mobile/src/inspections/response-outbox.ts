// apps/mobile/src/inspections/response-outbox.ts
//
// Local outbox for inspection answers and submissions captured on the device.
//
// Answers are written here first (so they survive no signal and app restarts),
// then uploaded straight to Supabase as the signed-in user by the outbox worker
// — the same shape as the photo/signature queue (attachment-queue.ts). PowerSync
// is NOT in this path: its upload hook (connector.ts) is a no-op, and a local
// write to a synced table would sit in its CRUD queue forever and stop every
// later download from applying ("Could not apply checkpoint … due to local data").
//
// The table lives in PowerSync's SQLite file but outside the sync boundary.
//
// Rules:
//   * one row per (inspection, section, field): a newer answer replaces the
//     older one, carrying the WHOLE merged row so a later partial edit can never
//     null an earlier column on the server;
//   * rows upload oldest first; a submit waits until every earlier answer on the
//     same inspection has landed, and is refused if one of them was refused;
//   * network-shaped failures back off and retry indefinitely; anything the
//     server refuses on its merits is kept as 'rejected' with the server's
//     sentence, for the capture screen to show, and the queue moves on;
//   * a row only uploads under the session of the user who captured it.

import type { Response } from '@esite/shared'

export interface SqlExecutor {
  execute(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>
}

export interface ResponseValues {
  value_bool: boolean | null
  value_number: number | null
  value_text: string | null
  value_array: string[] | null
  value_json: unknown | null
  pass_state: string | null
  fail_reason: string | null
}

export type OutboxStatus = 'pending' | 'failed' | 'rejected'

interface OutboxItemBase {
  seq: number
  inspectionId: string
  responderId: string
  status: OutboxStatus
  retryCount: number
  lastError: string | null
  nextAttemptAt: number
}

export interface ResponseOutboxItem extends OutboxItemBase {
  kind: 'response'
  sectionId: string
  fieldId: string
  values: ResponseValues
  respondedAt: string
}

export interface SubmitOutboxItem extends OutboxItemBase {
  kind: 'submit'
  completedAt: string
}

export type OutboxItem = ResponseOutboxItem | SubmitOutboxItem

/** What the Supabase client reports when a write fails. `status` is the HTTP
 *  status (0 or absent when the request never reached the server). */
export interface RemoteError {
  status?: number
  code?: string
  message: string
}

export interface OutboxRemote {
  upsertResponse(input: {
    inspectionId: string
    sectionId: string
    fieldId: string
    values: ResponseValues
    respondedBy: string
    respondedAt: string
  }): Promise<RemoteError | null>
  submitInspection(input: { inspectionId: string; completedAt: string }): Promise<RemoteError | null>
}

export interface DrainResult {
  uploaded: number
  retrying: number
  rejected: number
}

const TABLE = 'inspection_outbox'
const BASE_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 5 * 60_000

export async function ensureOutboxSchema(db: SqlExecutor): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      inspection_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('response','submit')),
      section_id TEXT,
      field_id TEXT,
      payload TEXT NOT NULL,
      responder_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','failed','rejected')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

export async function enqueueResponse(
  db: SqlExecutor,
  input: {
    inspectionId: string
    sectionId: string
    fieldId: string
    responderId: string
    values: ResponseValues
    respondedAt: string
  },
): Promise<void> {
  const payload = JSON.stringify({ values: input.values, respondedAt: input.respondedAt })
  await db.transaction(async (tx) => {
    await tx.execute(
      `DELETE FROM ${TABLE} WHERE kind = 'response' AND inspection_id = ? AND section_id = ? AND field_id = ?`,
      [input.inspectionId, input.sectionId, input.fieldId],
    )
    await tx.execute(
      `INSERT INTO ${TABLE} (inspection_id, kind, section_id, field_id, payload, responder_id)
       VALUES (?, 'response', ?, ?, ?, ?)`,
      [input.inspectionId, input.sectionId, input.fieldId, payload, input.responderId],
    )
  })
}

export async function enqueueSubmit(
  db: SqlExecutor,
  input: { inspectionId: string; responderId: string; completedAt: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(`DELETE FROM ${TABLE} WHERE kind = 'submit' AND inspection_id = ?`, [input.inspectionId])
    await tx.execute(
      `INSERT INTO ${TABLE} (inspection_id, kind, payload, responder_id) VALUES (?, 'submit', ?, ?)`,
      [input.inspectionId, JSON.stringify({ completedAt: input.completedAt }), input.responderId],
    )
  })
}

export async function listForInspection(db: SqlExecutor, inspectionId: string): Promise<OutboxItem[]> {
  const { rows } = await db.execute(`SELECT * FROM ${TABLE} WHERE inspection_id = ? ORDER BY seq`, [inspectionId])
  return rows.map(toItem)
}

/** Unsent row counts per inspection (for list badges). */
export async function countsByInspection(
  db: SqlExecutor,
): Promise<Record<string, { waiting: number; rejected: number }>> {
  const { rows } = await db.execute(
    `SELECT inspection_id,
            SUM(CASE WHEN status = 'rejected' THEN 0 ELSE 1 END) AS waiting,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected
     FROM ${TABLE} GROUP BY inspection_id`,
  )
  const out: Record<string, { waiting: number; rejected: number }> = {}
  for (const r of rows) {
    out[String(r.inspection_id)] = { waiting: Number(r.waiting ?? 0), rejected: Number(r.rejected ?? 0) }
  }
  return out
}

export function classifyRemoteError(err: RemoteError): 'retry' | 'reject' {
  const status = err.status ?? 0
  if (status === 0) return 'retry' // never reached the server
  if (status === 401) return 'retry' // expired token: refreshed before the next attempt
  if (status === 408 || status === 429 || status >= 500) return 'retry'
  return 'reject'
}

export async function drainOnce(
  db: SqlExecutor,
  remote: OutboxRemote,
  opts: { responderId: string; now: number },
): Promise<DrainResult> {
  const result: DrainResult = { uploaded: 0, retrying: 0, rejected: 0 }
  for (;;) {
    const item = await nextEligible(db, opts)
    if (!item) return result

    let error: RemoteError | null
    if (item.kind === 'submit') {
      const refused = await countEarlierRejected(db, item)
      if (refused > 0) {
        await markRejected(
          db,
          item.seq,
          `Not submitted: ${refused} answer${refused === 1 ? ' was' : 's were'} refused by the server. Fix ${refused === 1 ? 'it' : 'them'} and submit again.`,
        )
        result.rejected++
        continue
      }
      error = await remote.submitInspection({ inspectionId: item.inspectionId, completedAt: item.completedAt })
    } else {
      error = await remote.upsertResponse({
        inspectionId: item.inspectionId,
        sectionId: item.sectionId,
        fieldId: item.fieldId,
        values: item.values,
        respondedBy: item.responderId,
        respondedAt: item.respondedAt,
      })
    }

    if (!error) {
      await db.execute(`DELETE FROM ${TABLE} WHERE seq = ?`, [item.seq])
      result.uploaded++
      continue
    }
    if (classifyRemoteError(error) === 'retry') {
      const delay = Math.min(BASE_BACKOFF_MS * 2 ** item.retryCount, MAX_BACKOFF_MS)
      await db.execute(
        `UPDATE ${TABLE} SET status = 'failed', retry_count = retry_count + 1, last_error = ?, next_attempt_at = ?
         WHERE seq = ?`,
        [error.message, opts.now + delay, item.seq],
      )
      result.retrying++
      return result // most likely offline: stop this round
    }
    await markRejected(db, item.seq, error.message)
    result.rejected++
  }
}

/** The full set of value columns for an answer, so an upload always writes
 *  the whole row (a partial upsert would leave stale columns on the server). */
export function toResponseValues(r: Response): ResponseValues {
  return {
    value_bool: r.value_bool ?? null,
    value_number: r.value_number ?? null,
    value_text: r.value_text ?? null,
    value_array: r.value_array ?? null,
    value_json: r.value_json ?? null,
    pass_state: r.pass_state ?? null,
    fail_reason: r.fail_reason ?? null,
  }
}

export function mergeOutboxIntoResponses(server: Response[], outbox: OutboxItem[]): Response[] {
  const key = (s: string, f: string) => `${s}\u0000${f}`
  const byKey = new Map(server.map((r) => [key(r.section_id, r.field_id), r]))
  for (const item of outbox) {
    if (item.kind !== 'response') continue
    const v = item.values
    byKey.set(key(item.sectionId, item.fieldId), {
      section_id: item.sectionId,
      field_id: item.fieldId,
      value_bool: v.value_bool,
      value_number: v.value_number,
      value_text: v.value_text,
      value_array: v.value_array,
      value_json: v.value_json,
      pass_state: (v.pass_state ?? undefined) as Response['pass_state'],
      fail_reason: v.fail_reason,
    })
  }
  return [...byKey.values()]
}

async function nextEligible(
  db: SqlExecutor,
  opts: { responderId: string; now: number },
): Promise<OutboxItem | null> {
  // Strict FIFO: the oldest unsent row is the head, and while it is backing
  // off the whole queue waits — offline, that is one request per back-off
  // window rather than one per row per tick.
  const { rows } = await db.execute(
    `SELECT * FROM ${TABLE}
     WHERE responder_id = ? AND status IN ('pending','failed')
     ORDER BY seq
     LIMIT 1`,
    [opts.responderId],
  )
  if (!rows.length) return null
  const head = toItem(rows[0])
  return head.nextAttemptAt <= opts.now ? head : null
}

async function countEarlierRejected(db: SqlExecutor, item: OutboxItem): Promise<number> {
  const { rows } = await db.execute(
    `SELECT COUNT(*) AS n FROM ${TABLE}
     WHERE inspection_id = ? AND kind = 'response' AND status = 'rejected' AND seq < ?`,
    [item.inspectionId, item.seq],
  )
  return Number(rows[0]?.n ?? 0)
}

async function markRejected(db: SqlExecutor, seq: number, message: string): Promise<void> {
  await db.execute(`UPDATE ${TABLE} SET status = 'rejected', last_error = ? WHERE seq = ?`, [message, seq])
}

function toItem(row: Record<string, unknown>): OutboxItem {
  const payload = JSON.parse(String(row.payload))
  const base: OutboxItemBase = {
    seq: Number(row.seq),
    inspectionId: String(row.inspection_id),
    responderId: String(row.responder_id),
    status: row.status as OutboxStatus,
    retryCount: Number(row.retry_count ?? 0),
    lastError: row.last_error == null ? null : String(row.last_error),
    nextAttemptAt: Number(row.next_attempt_at ?? 0),
  }
  if (row.kind === 'submit') return { ...base, kind: 'submit', completedAt: payload.completedAt }
  return {
    ...base,
    kind: 'response',
    sectionId: String(row.section_id),
    fieldId: String(row.field_id),
    values: payload.values,
    respondedAt: payload.respondedAt,
  }
}
