import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Database } from '@esite/db'

// @supabase/ssr@0.5.x returns SupabaseClient<DB, SchemaName, Schema> (3 args) but
// supabase-js@2.50+ expanded SupabaseClient to 5 type params. Passing Schema as the
// 3rd positional arg corrupts the type chain and makes every query return `never`.
// Casting to SupabaseClient<Database> (1 arg, all defaults) lets TS resolve the full
// generic chain correctly: SchemaNameOrClientOptions→'public', SchemaName→'public',
// Schema→Database['public'], ClientOptions→{PostgrestVersion:"14.5"}.
export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from Server Component — cookies set in middleware
          }
        },
      },
    }
  ) as unknown as SupabaseClient<Database>
}

// True service-role client — uses @supabase/supabase-js directly so the service
// role key is never overridden by the user's auth cookie. Bypasses RLS entirely.
// Only use in server actions after manually verifying the user via createClient().
export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
