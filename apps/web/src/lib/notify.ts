/**
 * Unified entity-event notifier — one path for bell (+push) and batched email,
 * used by every module (RFI / snags / diary / QC / site forms).
 *
 * Resolves the canonical site roster ONCE (live, service-role) via
 * resolveProjectRecipients: bell goes to everyone minus the actor; email (if the
 * module toggle is on) goes to the whole roster including the actor. Best-effort
 * and never throws — a notification failure must not block the user's action.
 *
 * ⚠ THE BOUNCE/COMPLAINT CONSULT SITS ON THE EMAIL LEG, NOT ON THE RESOLVER.
 * `resolveProjectRecipients` is the choke point for the in-app BELL as well as
 * for mail. Filtering suppressed addresses there would silently kill a person's
 * in-app notifications and push because their mail server bounced once, or
 * because they hit "spam" in a webmail client. Only `emails` is filtered;
 * `bellUserIds` is untouched, and a test pins that.
 */

import { filterSuppressed } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
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

/** What actually went out — so a caller can tell the actor the audience shrank. */
export interface NotifyEntityEventResult {
  /** People who received the in-app bell. */
  bell: number
  /** Addresses handed to send-email. */
  emailed: number
  /** Addresses withheld because Resend hard-bounced or a recipient complained. */
  suppressed: number
}

const NOTHING: NotifyEntityEventResult = { bell: 0, emailed: 0, suppressed: 0 }

export async function notifyEntityEvent(
  args: NotifyEntityEventArgs,
): Promise<NotifyEntityEventResult> {
  try {
    const { recipients } = await resolveProjectRecipients(args.projectId)
    const bellUserIds = recipients.filter((r) => r.userId !== args.actorId).map((r) => r.userId)
    const rosterEmails = recipients.map((r) => r.email).filter((e): e is string => Boolean(e))

    // In-app bell + push (existing helper, never-throws). Deliberately NOT
    // gated on suppression — see the file header.
    if (bellUserIds.length) {
      await dispatchNotification({ userIds: bellUserIds, ...args.bell })
    }

    // Batched email to the whole roster, gated by the caller's module toggle.
    if (!args.email?.enabled || rosterEmails.length === 0) {
      return { ...NOTHING, bell: bellUserIds.length }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return { ...NOTHING, bell: bellUserIds.length }

    // One `.in()` for the whole roster. Fails open on a read error.
    const { allowed: emails, suppressed } = await filterSuppressed(
      createServiceClient() as never,
      rosterEmails,
    )
    if (suppressed.length) {
      console.warn('[notify] suppressed', {
        type: args.bell.type,
        count: suppressed.length,
        addresses: suppressed,
      })
    }
    if (emails.length === 0) {
      return { bell: bellUserIds.length, emailed: 0, suppressed: suppressed.length }
    }

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ type: 'rfi-created', payload: { to: emails, subject: args.email.subject, html: args.email.html } }),
      })
      if (res.ok) {
        console.warn('[notify] sent', { type: args.bell.type, bell: bellUserIds.length, email: emails.length, suppressed: suppressed.length })
      } else {
        const body = await res.text().catch(() => '')
        console.error('[notify] email failed', { type: args.bell.type, status: res.status, body: body.slice(0, 200) })
      }
    } catch (e) {
      console.error('[notify] email threw', { type: args.bell.type, err: String(e) })
    }

    return { bell: bellUserIds.length, emailed: emails.length, suppressed: suppressed.length }
  } catch (e) {
    console.error('[notify] failed', { projectId: args.projectId, err: String(e) })
    return { ...NOTHING }
  }
}
