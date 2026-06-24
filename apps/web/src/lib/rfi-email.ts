/**
 * RFI email dispatch — best-effort second channel (alongside dispatchNotification).
 *
 * Renders the email server-side via the shared `renderRfiCreatedEmail` and
 * forwards { to, subject, html } to the `send-email` Edge Function's
 * `rfi-created` passthrough branch, once per recipient. Gated by the project's
 * `notifyRfiEmail` toggle. Never throws — an email failure must not block (or
 * surface from) RFI creation.
 */

import {
  projectSettingsService,
  buildRfiEmailRecipients,
  renderRfiCreatedEmail,
} from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveProjectRecipients } from './recipients'

export interface DispatchRfiEmailArgs {
  projectId: string
  rfiId: string
  rfiSubject: string
  priority: string
  dueDate?: string | null
  /** Resolved assignee (may be null — unassigned RFI). */
  assigneeId: string | null
  /** The person who raised the RFI. */
  raiserId: string
}

export async function dispatchRfiEmail(args: DispatchRfiEmailArgs): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return

    // Resolve recipients with the service-role client (bypasses RLS). The raiser
    // can't read the profiles/emails of project members who belong to a
    // different org or sub-org, so an RLS-scoped read collapses the recipient
    // list to just the raiser — this guarantees the full roster.
    const svc = createServiceClient()

    // Toggle gates the whole RFI email feature for this project.
    const cfg = await projectSettingsService.getNotificationConfig(svc as any, args.projectId)
    if (!cfg.rfiEmail) return

    // Canonical recipient list — every active member + implicit org admins,
    // resolved live (00146 project_notification_recipients). Email goes to the
    // whole roster, including the raiser.
    const { emails: rosterEmails } = await resolveProjectRecipients(args.projectId)
    const recipients = buildRfiEmailRecipients({ notifyRfiEmail: cfg.rfiEmail, emails: rosterEmails })
    if (recipients.length === 0) return

    // Names for the email body (raiser, assignee, project).
    const nameIds = [args.assigneeId, args.raiserId].filter((x): x is string => Boolean(x))
    const { data: profileRows } = await svc
      .from('profiles').select('id, full_name').in('id', nameIds)
    const profiles: Record<string, { full_name: string | null }> =
      Object.fromEntries((profileRows ?? []).map((p: any) => [p.id, p]))
    const { data: project } = await (svc as any)
      .schema('projects').from('projects').select('name').eq('id', args.projectId).maybeSingle()
    const raiser = profiles[args.raiserId] ?? null
    const assignee = args.assigneeId ? profiles[args.assigneeId] : null

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.e-site.live'
    const { subject, html } = renderRfiCreatedEmail({
      raisedByName: raiser?.full_name ?? 'A team member',
      assigneeName: assignee?.full_name ?? null,
      rfiSubject: args.rfiSubject,
      projectName: project?.name ?? 'your project',
      priority: args.priority,
      dueDate: args.dueDate ?? null,
      rfiId: args.rfiId,
      siteUrl,
    })

    // One batched request — send-email fans out via Resend's batch endpoint, so
    // the per-request rate limit can't silently drop recipients (each gets their
    // own email; no shared To:). Logged so dropped/failed sends are visible.
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ type: 'rfi-created', payload: { to: recipients, subject, html } }),
      })
      if (res.ok) {
        console.warn('[rfi-email] sent', { projectId: args.projectId, recipients: recipients.length })
      } else {
        const body = await res.text().catch(() => '')
        console.error('[rfi-email] send-email failed', { projectId: args.projectId, recipients: recipients.length, status: res.status, body: body.slice(0, 300) })
      }
    } catch (e) {
      console.error('[rfi-email] send-email threw', { projectId: args.projectId, recipients: recipients.length, err: String(e) })
    }
  } catch {
    // Email failures must never propagate to the user-visible action result.
  }
}
