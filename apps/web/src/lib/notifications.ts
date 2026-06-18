/**
 * Cross-action notification helper.
 *
 * Wraps the `send-notification` Supabase Edge Function (service-role)
 * with a never-throw contract — notification failures are best-effort
 * and must not propagate to the user-visible action result.
 *
 * Used by rfi.actions and anywhere else the app fans out an in-app +
 * push notification on an entity change.
 */

export interface NotifyArgs {
  userIds: string[]
  title: string
  body: string
  /** App route the notification deep-links to (e.g. `/rfis/abc-123`). */
  route: string
  /** Notification type (e.g. `rfi_assigned`, `quote_selected`). */
  type: string
  /** Entity scope for in-app filtering (e.g. `rfi`, `node_order`). */
  entityType?: string
  /** Entity uuid. */
  entityId?: string
}

export async function dispatchNotification({
  userIds, title, body, route, type, entityType, entityId,
}: NotifyArgs): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return

    const unique = [...new Set(userIds.filter(Boolean))]
    if (unique.length === 0) return

    await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        userIds: unique,
        title,
        body,
        type,
        entityType,
        entityId,
        data: { route },
      }),
    }).catch(() => {/* non-blocking */})
  } catch {
    // Notification failure must never propagate.
  }
}

/**
 * Best-effort transactional email dispatch via the `send-email` Edge Function.
 *
 * MUST be service-role: send-email rejects every non-public `type` unless the
 * caller's JWT role is `service_role` (send-email/index.ts). Invoking via the
 * cookie/user client therefore 403s and the email silently never sends. This
 * helper sets `Authorization: Bearer <SERVICE_ROLE_KEY>` directly — mirroring
 * dispatchNotification — so internal email types actually reach Resend.
 *
 * Same never-throw contract: email failure must never propagate to the action.
 */
export async function dispatchEmail(
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return

    await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ type, payload }),
    }).catch(() => {/* non-blocking */})
  } catch {
    // Email failure must never propagate.
  }
}
