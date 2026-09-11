import 'server-only'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

/**
 * Record that the signed-in user is using the product, right now.
 *
 * public.touch_presence() upserts public.user_presence AND extends-or-opens a
 * public.user_sessions row in one RPC, keyed on auth.uid(), so this is called
 * through the CALLER's own client — never the service client, which has no
 * auth.uid() and would write nothing.
 *
 * Why this exists in Q1 item 1 rather than item 4: without ANY writer, the
 * frozen October baseline for metric 1 is events-only and every later week is
 * sessions+events, so the number rises when item 4's 60-second heartbeat lands
 * and it looks like the programme worked. Shipping a table with no writer is
 * the pathology this whole item exists to name — notifications.read_at, the
 * snag photo_type literal, email_sequence_events.opened_at.
 *
 * Never throws: presence must not be able to fail a page render.
 */
export type PresencePlatform = 'web' | 'mobile_web' | 'mobile_app'

// public.touch_presence is not in the generated Database types
// (packages/db/src/types.ts predates migration 00194), so the call is typed
// against the one surface it needs rather than widened to `any`.
type RpcClient = {
  rpc: (
    fn: 'touch_presence',
    args: Record<string, unknown>,
  ) => PromiseLike<{ error: { message: string } | null }>
}

export async function touchPresence(platform: PresencePlatform = 'web'): Promise<void> {
  try {
    // The REAL user agent — user_sessions.user_agent has no other writer, and a
    // column nothing writes is the thing this item refuses to ship. The SQL
    // caps it at 512 chars and blank-collapses it. Read inside the try:
    // headers() throws outside a request scope, and that must log, not render.
    const userAgent = (await headers()).get('user-agent')
    const supabase = (await createClient()) as unknown as RpcClient
    const { error } = await supabase.rpc('touch_presence', {
      p_platform: platform,
      // ?? null, never undefined: JSON.stringify drops an undefined value.
      p_user_agent: userAgent ?? null,
    })
    if (error) console.error('[presence] touch_presence failed', { err: error.message })
  } catch (e) {
    console.error('[presence] threw', { err: String(e) })
  }
}
