/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A small chainable Supabase fake for server-action and loader tests.
 *
 *   const { client, calls } = fakeSupabase({
 *     userId: 'u1',
 *     rpc: { solar_is_grantor: { data: true, error: null } },
 *     tables: { 'solar.project_access': [{ project_id: 'p1', user_id: 'u2', level: 'view' }] },
 *     writes: { 'solar.project_access:update': { data: [] } },   // 0 rows affected
 *   })
 *
 * SELECTs filter `tables[schema.table]` by eq / neq / in / gte / gt (string order) / is; or, ilike,
 * overlaps, not and range pass through unfiltered. `schema(s).rpc(n)` resolves `rpc['s.n']`. Writes are recorded
 * in `calls` and resolve to `writes['schema.table:op']` (default: the payload
 * echoed back as one row; delete → []). `client.from(t)` is schema `public`.
 */
import { vi } from 'vitest'

export type FakeError = { message: string; code?: string }
export type FakeResult = { data: unknown; error: FakeError | null }
type Filter = ['eq' | 'neq' | 'in' | 'gte' | 'gt' | 'is', string, unknown]

export interface FakeCall {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert'
  payload?: unknown
  filters: Filter[]
}

export interface FakeOptions {
  userId?: string | null
  rpc?: Record<string, FakeResult | ((args: Record<string, unknown>) => FakeResult)>
  tables?: Record<string, Array<Record<string, unknown>>>
  /** A fixed result per `schema.table:op`, or a function of the call (e.g. 0 rows for one filter value). */
  writes?: Record<string, Partial<FakeResult> | ((call: FakeCall) => Partial<FakeResult>)>
}

export function fakeSupabase(opts: FakeOptions = {}) {
  const calls: FakeCall[] = []
  const userId = opts.userId === undefined ? 'user-1' : opts.userId

  const matches = (row: Record<string, unknown>, filters: Filter[]) =>
    filters.every(([op, col, val]) =>
      op === 'eq' ? row[col] === val
        : op === 'neq' ? row[col] !== val
          : op === 'gte' ? String(row[col] ?? '') >= String(val)
          : op === 'gt' ? String(row[col] ?? '') > String(val)
            : op === 'is' ? (row[col] ?? null) === val
              : (val as unknown[]).includes(row[col]))

  function builder(table: string) {
    const state: { op: FakeCall['op']; payload?: unknown; filters: Filter[]; limit?: number } = { op: 'select', filters: [] }
    const run = (): Promise<FakeResult> => {
      const call: FakeCall = { table, op: state.op, payload: state.payload, filters: [...state.filters] }
      calls.push(call)
      if (state.op === 'select') {
        let rows = (opts.tables?.[table] ?? []).filter((r) => matches(r, state.filters))
        if (state.limit !== undefined) rows = rows.slice(0, state.limit)
        return Promise.resolve({ data: rows, error: null })
      }
      const spec = opts.writes?.[`${table}:${state.op}`]
      const w = typeof spec === 'function' ? spec(call) : spec
      const echo = state.op === 'delete' ? [] : Array.isArray(state.payload) ? state.payload : [state.payload]
      return Promise.resolve({ data: w?.data ?? echo, error: w?.error ?? null })
    }
    const first = () =>
      run().then((r) => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }))
    const b: any = {
      select: () => b,
      insert: (p: unknown) => { state.op = 'insert'; state.payload = p; return b },
      update: (p: unknown) => { state.op = 'update'; state.payload = p; return b },
      delete: () => { state.op = 'delete'; return b },
      eq: (c: string, v: unknown) => { state.filters.push(['eq', c, v]); return b },
      neq: (c: string, v: unknown) => { state.filters.push(['neq', c, v]); return b },
      in: (c: string, v: unknown[]) => { state.filters.push(['in', c, v]); return b },
      gte: (c: string, v: unknown) => { state.filters.push(['gte', c, v]); return b },
      gt: (c: string, v: unknown) => { state.filters.push(['gt', c, v]); return b },
      is: (c: string, v: unknown) => { state.filters.push(['is', c, v]); return b },
      upsert: (p: unknown) => { state.op = 'upsert'; state.payload = p; return b },
      or: () => b,
      ilike: () => b,
      overlaps: () => b,
      not: () => b,
      range: () => b,
      order: () => b,
      limit: (n: number) => { state.limit = n; return b },
      maybeSingle: first,
      single: first,
      then: (res: (v: FakeResult) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    }
    return b
  }

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    const r = opts.rpc?.[name]
    if (!r) return { data: null, error: null }
    return typeof r === 'function' ? r(args) : r
  })
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: userId ? { id: userId } : null } })) },
    rpc,
    schema: (s: string) => ({
      from: (t: string) => builder(`${s}.${t}`),
      rpc: (name: string, args: Record<string, unknown>) => rpc(`${s}.${name}`, args),
    }),
    from: (t: string) => builder(`public.${t}`),
  }
  return { client, calls }
}

export function callsTo(calls: FakeCall[], table: string, op: FakeCall['op']): FakeCall[] {
  return calls.filter((c) => c.table === table && c.op === op)
}
