// apps/mobile/src/lib/powersync/executor.ts
//
// The SqlExecutor the inspection outbox runs on: PowerSync's SQLite connection,
// used for local-only tables (never synced ones — see
// no-local-writes-to-synced-tables.contract.test.ts).
import type { SqlExecutor } from '../../inspections/response-outbox'
import { powerSyncDb } from './database'

type Rowsish = { rows?: { _array?: unknown[] } | unknown[] }

function rowsOf(rs: Rowsish): Record<string, unknown>[] {
  const r = rs.rows
  if (!r) return []
  if (Array.isArray((r as { _array?: unknown[] })._array)) return (r as { _array: Record<string, unknown>[] })._array
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : []
}

export const powerSyncExecutor: SqlExecutor = {
  async execute(sql, params) {
    return { rows: rowsOf((await powerSyncDb.execute(sql, params as unknown[])) as Rowsish) }
  },
  async transaction(fn) {
    return powerSyncDb.writeTransaction(async (tx) => {
      const inner: SqlExecutor = {
        execute: async (sql, params) => ({ rows: rowsOf((await tx.execute(sql, params as unknown[])) as Rowsish) }),
        transaction: (f) => f(inner),
      }
      return fn(inner)
    })
  },
}
