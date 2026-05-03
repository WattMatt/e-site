import type { SupabaseClient } from '@supabase/supabase-js'

export type AuthEventType =
  | 'login'
  | 'logout'
  | 'password_changed'
  | 'password_reset_requested'
  | 'magic_link_requested'
  | 'lockout'
  | 'mfa_enrolled'
  | 'mfa_unenrolled'
  | 'account_deleted'
  | 'account_email_changed'

export interface LogAuthEventArgs {
  userId:     string | null
  eventType:  AuthEventType
  ipAddress?: string | null
  userAgent?: string | null
  metadata?:  Record<string, unknown>
}

/**
 * Insert an auth audit row. Best-effort — never throws or blocks the caller.
 *
 * The auth_events table is service-role-only writeable (no INSERT policy for
 * authenticated). Pass a service-role-keyed client.
 */
export async function logAuthEvent(
  client: SupabaseClient,
  args:   LogAuthEventArgs,
): Promise<void> {
  try {
    const { error } = await client.from('auth_events').insert({
      user_id:     args.userId,
      event_type:  args.eventType,
      ip_address:  args.ipAddress ?? null,
      user_agent:  args.userAgent ?? null,
      metadata:    args.metadata ?? {},
    })
    if (error) {
      console.error('logAuthEvent: insert failed', { eventType: args.eventType, userId: args.userId, error })
    }
  } catch (err) {
    console.error('logAuthEvent: insert threw', { eventType: args.eventType, userId: args.userId, err })
  }
}
