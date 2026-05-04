import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@esite/db'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Browser-context Supabase client.
 *
 * Build-tolerant: if NEXT_PUBLIC_SUPABASE_URL / ANON_KEY are missing at
 * build time (CI runner without the secret bound, or a static-prerender
 * pass), return a Proxy stub that throws only on actual property access.
 * This lets pages that call `const supabase = createClient()` at
 * component-eval prerender to HTML without exploding — the stub is
 * replaced by a real client when the env vars are present at runtime.
 *
 * On the actual browser, missing env vars are a real configuration bug
 * — the throw is loud and immediate on first method call.
 */
export function createClient(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    if (typeof window === 'undefined') {
      // Server-side prerender without env vars — return stub so the
      // module evaluates without throwing.
      return new Proxy({} as SupabaseClient<Database>, {
        get(_t, prop) {
          if (prop === 'then' || prop === Symbol.toPrimitive) return undefined
          throw new Error(
            `Supabase client unavailable during prerender (missing NEXT_PUBLIC_SUPABASE_URL/ANON_KEY). Property accessed: ${String(prop)}`,
          )
        },
      })
    }
    // Browser without env — config bug worth surfacing loudly.
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.')
  }

  return createBrowserClient<Database>(url, key) as unknown as SupabaseClient<Database>
}
