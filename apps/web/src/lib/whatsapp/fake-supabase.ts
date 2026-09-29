// apps/web/src/lib/whatsapp/fake-supabase.ts
// Test-only chainable fake. `responses['<table>:<op>']` is a queue of
// { data, error } results consumed in order; `calls` records every chain step.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function fakeSupabase(responses: Record<string, Array<{ data?: any; error?: any; count?: number }>> = {}) {
  const calls: Array<{ table: string; op: string; args: any[] }> = []
  const next = (key: string) => {
    const q = responses[key]
    return Promise.resolve(q && q.length ? { data: null, error: null, ...q.shift() } : { data: null, error: null })
  }
  function from(table: string) {
    let op = 'select'
    const b: any = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'gte', 'lte', 'is', 'not', 'or']) {
      b[m] = (...args: any[]) => { calls.push({ table, op: m, args }); return b }
    }
    for (const m of ['insert', 'update', 'upsert', 'delete']) {
      b[m] = (...args: any[]) => { op = m; calls.push({ table, op: m, args }); return b }
    }
    b.single = () => next(`${table}:${op}`)
    b.maybeSingle = () => next(`${table}:${op}`)
    b.then = (ok: any, bad: any) => next(`${table}:${op}`).then(ok, bad)
    return b
  }
  const rpc = (fn: string, args: any) => { calls.push({ table: 'rpc', op: fn, args: [args] }); return next(`rpc:${fn}`) }
  return { calls, from, rpc, schema: () => ({ from, rpc }) }
}
