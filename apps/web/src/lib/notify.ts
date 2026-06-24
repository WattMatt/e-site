/**
 * Unified entity-event notifier — one path for bell (+push) and batched email,
 * used by every module (RFI / snags / diary).
 *
 * Resolves the canonical site roster ONCE (live, service-role) via
 * resolveProjectRecipients: bell goes to everyone minus the actor; email (if the
 * module toggle is on) goes to the whole roster including the actor. Best-effort
 * and never throws — a notification failure must not block the user's action.
 */

import { resolveProjectRecipients } from './recipients'
import { dispatchNotification } from './notifications'

export interface NotifyEntityEventArgs {
  projectId: string
  /** The user performing the action — excluded from the in-app bell (no self-ping). */
  actorId: string
  bell: {
    title: string
    body: string
    route: string
    type: string
    entityType?: string
    entityId?: string
  }
  /** Email channel; fires only when enabled (the module's project toggle). */
  email?: { enabled: boolean; subject: string; html: string }
}

export async function notifyEntityEvent(args: NotifyEntityEventArgs): Promise<void> {
  try {
    const { recipients } = await resolveProjectRecipients(args.projectId)
    const bellUserIds = recipients.filter((r) => r.userId !== args.actorId).map((r) => r.userId)
    const emails = recipients.map((r) => r.email).filter((e): e is string => Boolean(e))

    // In-app bell + push (existing helper, never-throws).
    if (bellUserIds.length) {
      await dispatchNotification({ userIds: bellUserIds, ...args.bell })
    }

    // Batched email to the whole roster, gated by the caller's module toggle.
    if (args.email?.enabled && emails.length) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!supabaseUrl || !serviceKey) return
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ type: 'rfi-created', payload: { to: emails, subject: args.email.subject, html: args.email.html } }),
        })
        if (res.ok) {
          console.warn('[notify] sent', { type: args.bell.type, bell: bellUserIds.length, email: emails.length })
        } else {
          const body = await res.text().catch(() => '')
          console.error('[notify] email failed', { type: args.bell.type, status: res.status, body: body.slice(0, 200) })
        }
      } catch (e) {
        console.error('[notify] email threw', { type: args.bell.type, err: String(e) })
      }
    }
  } catch (e) {
    console.error('[notify] failed', { projectId: args.projectId, err: String(e) })
  }
}
