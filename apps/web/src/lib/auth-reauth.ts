import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Verify a password without mutating the cookie-bound session.
 *
 * Calling `signInWithPassword` on the cookie-bound server client
 * REPLACES the current session and rotates refresh tokens — undesirable
 * for a "confirm your password before this destructive action" flow.
 *
 * Build a fresh anon client with `persistSession: false` so the
 * round-trip authenticates against Supabase but never touches our
 * cookies. Returns `true` on correct credentials, `false` otherwise.
 */
export async function verifyPasswordIsolated(email: string, password: string): Promise<boolean> {
  const fresh = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'reauth-isolated' } },
  )
  const { error } = await fresh.auth.signInWithPassword({ email, password })
  return !error
}
