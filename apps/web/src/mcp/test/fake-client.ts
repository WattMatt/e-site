// A recording stand-in for the supabase-js client: chain any builder methods, then await.
export type RecordedCall = { path: string; method: string; args: unknown[] }
export type FakeResponse = { data: unknown; error?: unknown; count?: number | null }

export function fakeClient() {
  const calls: RecordedCall[] = []
  const queue: FakeResponse[] = []
  const next = () => {
    const r = queue.shift()
    return { data: [], error: null, count: null, ...r }
  }

  // Every method call on the builder is recorded and returns the builder; awaiting it takes the next response.
  const builder = (path: string): any => {
    const self: any = new Proxy({}, {
      get(_t, prop) {
        if (typeof prop === 'symbol') return undefined
        if (prop === 'then') return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej)
        return (...args: unknown[]) => { calls.push({ path, method: prop, args }); return self }
      },
    })
    return self
  }

  const rpc = (fn: string, args?: unknown, options?: unknown) => {
    const path = `rpc:${fn}`
    calls.push({ path, method: 'rpc', args: options === undefined ? [args] : [args, options] })
    return builder(path)
  }
  const client: any = {
    schema: (s: string) => ({ from: (t: string) => builder(`${s}.${t}`), rpc }),
    from: (t: string) => builder(t),
    rpc,
  }
  return { client, calls, respond: (r: FakeResponse) => { queue.push(r) } }
}
