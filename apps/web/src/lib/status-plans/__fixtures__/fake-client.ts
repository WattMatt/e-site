/**
 * A tiny PostgREST-shaped fake: `.schema(s).from(t)` builders that record
 * every chained call, answer from a responder at await time, and look enough
 * like supabase-js for the status-plan loaders and actions.
 *
 * Responses are keyed `${schema}.${table}:${op}`. `queued` serves each key's
 * list in order and repeats the last entry, so a readAll page loop that gets a
 * short page stops after one call.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FakeCall {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  ops: Array<[string, unknown[]]>
  payload?: unknown
}

export interface FakeResponse {
  data?: unknown
  error?: { code?: string; message: string } | null
}

export type Responder = (call: FakeCall) => FakeResponse

export const FAKE_USER_ID = '00000000-0000-4000-8000-000000000001'

export function queued(map: Record<string, FakeResponse[]>): Responder {
  const queues = new Map(Object.entries(map).map(([k, v]) => [k, [...v]]))
  return (call) => {
    const q = queues.get(`${call.table}:${call.op}`)
    if (!q || q.length === 0) return { data: null, error: null }
    return q.length === 1 ? q[0]! : q.shift()!
  }
}

export function fakeClient(respond: Responder, opts: { userId?: string | null } = {}) {
  const calls: FakeCall[] = []
  const table = (schema: string) => (name: string) => {
    const call: FakeCall = { table: `${schema}.${name}`, op: 'select', ops: [] }
    calls.push(call)
    const b: any = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'range', 'limit']) {
      b[m] = (...args: unknown[]) => {
        call.ops.push([m, args])
        return b
      }
    }
    b.insert = (p: unknown) => { call.op = 'insert'; call.payload = p; return b }
    b.update = (p: unknown) => { call.op = 'update'; call.payload = p; return b }
    b.delete = () => { call.op = 'delete'; return b }
    const result = () => {
      const r = respond(call)
      return { data: r.data ?? null, error: r.error ?? null }
    }
    b.maybeSingle = async () => {
      const r = result()
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }
    }
    b.then = (ok: any, ko: any) => Promise.resolve(result()).then(ok, ko)
    return b
  }
  const userId = opts.userId === undefined ? FAKE_USER_ID : opts.userId
  const client = {
    schema: (s: string) => ({ from: table(s) }),
    from: table('public'),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed.test/${bucket}/${path}` }, error: null }),
      }),
    },
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
  }
  return { client, calls }
}

/** The ops of the first call to `table` with `op`, for assertions. */
export function opsOf(calls: FakeCall[], table: string, op: FakeCall['op'] = 'select'): Array<[string, unknown[]]> {
  return calls.find((c) => c.table === table && c.op === op)?.ops ?? []
}
