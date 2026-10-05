// Test helper: a real SQLite engine (node:sqlite) behind the same SqlExecutor
// interface the app gives PowerSync's connection. The outbox's SQL therefore
// runs against SQLite itself in tests, not against a hand-written mirror of it.
import type { SqlExecutor } from '../response-outbox'

// Vite's resolver does not list `node:sqlite` as a builtin and tries to load it
// as a file, so take it from the runtime directly (Node >= 22.5).
type SqliteModule = typeof import('node:sqlite')
const { DatabaseSync } = (process as unknown as {
  getBuiltinModule(id: 'node:sqlite'): SqliteModule
}).getBuiltinModule('node:sqlite')

export function createSqliteExecutor(): SqlExecutor & { close(): void } {
  const db = new DatabaseSync(':memory:')
  const exec: SqlExecutor = {
    async execute(sql, params = []) {
      const stmt = db.prepare(sql)
      if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
        return { rows: stmt.all(...(params as never[])) as Record<string, unknown>[] }
      }
      stmt.run(...(params as never[]))
      return { rows: [] }
    },
    async transaction(fn) {
      db.exec('BEGIN')
      try {
        const out = await fn(exec)
        db.exec('COMMIT')
        return out
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
  return { ...exec, close: () => db.close() }
}
