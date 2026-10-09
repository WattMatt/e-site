/**
 * A tiny PostgREST-shaped fake for loader tests. Every builder method records
 * its call and returns the builder; awaiting it resolves to the rows given for
 * `<schema>.<table>`. It does NOT filter: give it only the rows the query
 * should see, and assert the recorded filters separately.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type FakeTables = Record<string, Array<Record<string, unknown>>>

export interface FakeCall {
  table: string
  ops: Array<[string, unknown[]]>
}

export function fakeTablesClient(tables: FakeTables): { client: any; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  const from = (schema: string) => (table: string) => {
    const key = `${schema}.${table}`
    const call: FakeCall = { table: key, ops: [] }
    calls.push(call)
    const rows = () => tables[key] ?? []
    const builder: any = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === 'symbol') return undefined
          if (prop === 'then') {
            return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve({ data: rows(), error: null }).then(resolve, reject)
          }
          if (prop === 'maybeSingle' || prop === 'single') {
            return () => Promise.resolve({ data: rows()[0] ?? null, error: null })
          }
          return (...args: unknown[]) => {
            call.ops.push([prop, args])
            return builder
          }
        },
      },
    )
    return builder
  }
  const client = { schema: (s: string) => ({ from: from(s) }), from: from('public') }
  return { client, calls }
}
