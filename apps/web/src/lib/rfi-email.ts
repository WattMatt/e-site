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

    // Recipients = everyone on the project roster (active members). The
    // assignee + raiser are included defensively in case the resolved assignee
    // is a project-default who isn't (yet) a member.
    const { data: memberRows } = await (svc as any)
      .schema('projects')
      .from('project_members')
      .select('user_id')
      .eq('project_id', args.projectId)
      .eq('is_active', true)
    const memberIds: string[] = (memberRows ?? []).map((m: any) => m.user_id)

    const ids = [...new Set([...memberIds, args.assigneeId, args.raiserId].filter(
      (x): x is string => Boolean(x),
    ))]
    const { data: profileRows } = await svc
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ids)
    const profiles: Record<string, { full_name: string | null; email: string | null }> =
      Object.fromEntries((profileRows ?? []).map((p: any) => [p.id, p]))

    const { data: project } = await (svc as any)
      .schema('projects')
      .from('projects')
      .select('name')
      .eq('id', args.projectId)
      .maybeSingle()

    const assignee = args.assigneeId ? profiles[args.assigneeId] : null
    const raiser = profiles[args.raiserId] ?? null

    const recipients = buildRfiEmailRecipients({
      notifyRfiEmail: cfg.rfiEmail,
      emails: ids.map((id) => profiles[id]?.email),
    })
    if (recipients.length === 0) return

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

    // One personalised email per recipient (privacy: no shared To: header).
    await Promise.all(
      recipients.map((to) =>
        fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ type: 'rfi-created', payload: { to, subject, html } }),
        }).catch(() => {/* non-blocking */}),
      ),
    )
  } catch {
    // Email failures must never propagate to the user-visible action result.
  }
}
