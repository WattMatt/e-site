import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { User } from '@supabase/supabase-js'
import type { JwtClaims } from './jwt'

// A request-scoped bearer identity. While `runWithBearer` is on the stack,
// `createClient()` returns a client bound to this token and never reads cookies,
// so server actions that call `createClient()` internally act as the bearer user.
export type BearerContext = { accessToken: string; user: User; claims: JwtClaims }

const store = new AsyncLocalStorage<BearerContext>()

export function runWithBearer<T>(ctx: BearerContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn)
}

export function getBearerContext(): BearerContext | null {
  return store.getStore() ?? null
}
