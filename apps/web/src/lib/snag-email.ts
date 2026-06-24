/**
 * Snag notifications — bell + email to the full project roster.
 *
 * `notifySnagCreated` fans out the in-app bell (whole roster minus the raiser)
 * and the roster email (gated by the project `notifySnagEmail` toggle) via the
 * shared `notifyEntityEvent` helper — one live recipient resolve for both
 * channels. `dispatchSnagStatusEmail` emails the roster on status change /
 * sign-off; the targeted bell for those events stays inline in the action.
 * Both are best-effort and never throw — a notification failure must not block
 * (or surface from) the snag write.
 */

import {
  projectSettingsService,
  buildRfiEmailRecipients,
  renderSnagCreatedEmail,
  renderSnagStatusEmail,
} from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveProjectRecipients } from './recipients'
import { notifyEntityEvent } from './notify'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.e-site.live'

export interface NotifySnagCreatedArgs {
  snagId: string
  projectId: string
  title: string
  priority: string
  dueDate?: string | null
  /** Resolved assignee (may be null — unassigned snag). */
  assigneeId: string | null
  /** The person who raised the snag (excluded from the bell). */
  raiserId: string
}

export async function notifySnagCreated(args: NotifySnagCreatedArgs): Promise<void> {
  try {
    const svc = createServiceClient()
    const cfg = await projectSettingsService.getNotificationConfig(svc as any, args.projectId)

    // Names for the email body (raiser, assignee, project). Service-role read —
    // the raiser can't read cross-org/sub-org profiles under RLS.
    const nameIds = [args.assigneeId, args.raiserId].filter((x): x is string => Boolean(x))
    const { data: profileRows } = await svc.from('profiles').select('id, full_name').in('id', nameIds)
    const profiles: Record<string, { full_name: string | null }> =
      Object.fromEntries((profileRows ?? []).map((p: any) => [p.id, p]))
    const { data: project } = await (svc as any)
      .schema('projects').from('projects').select('name').eq('id', args.projectId).maybeSingle()

    const { subject, html } = renderSnagCreatedEmail({
      raisedByName: profiles[args.raiserId]?.full_name ?? 'A team member',
      assigneeName: args.assigneeId ? (profiles[args.assigneeId]?.full_name ?? null) : null,
      snagTitle: args.title,
      projectName: project?.name ?? 'your project',
      priority: args.priority,
      dueDate: args.dueDate ?? null,
      snagId: args.snagId,
      siteUrl: SITE_URL,
    })

    // Bell to the whole roster (minus raiser) + batched roster email (gated).
    await notifyEntityEvent({
      projectId: args.projectId,
      actorId: args.raiserId,
      bell: {
        title: 'New snag raised',
        body: `"${args.title}" — ${args.priority} priority`,
        route: `/snags/${args.snagId}`,
        type: 'snag_created',
        entityType: 'snag',
        entityId: args.snagId,
      },
      email: { enabled: cfg.snagEmail, subject, html },
    })
  } catch {
    // Notification failures must never propagate to the snag write.
  }
}

export interface DispatchSnagStatusEmailArgs {
  snagId: string
  projectId: string
  title: string
  /** Human-readable new status, e.g. "Signed Off". */
  statusLabel: string
  /** Who changed the status (null → omit the actor line). */
  changedById: string | null
}

/**
 * Email the whole project roster that a snag's status changed (incl. sign-off).
 * Gated by `notifySnagEmail`. The targeted in-app bell is sent separately by the
 * caller, so this is email-only.
 */
export async function dispatchSnagStatusEmail(args: DispatchSnagStatusEmailArgs): Promise<void> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return

    const svc = createServiceClient()
    const cfg = await projectSettingsService.getNotificationConfig(svc as any, args.projectId)
    if (!cfg.snagEmail) return

    const { emails } = await resolveProjectRecipients(args.projectId)
    const recipients = buildRfiEmailRecipients({ notifyRfiEmail: cfg.snagEmail, emails })
    if (recipients.length === 0) return

    let changedByName: string | null = null
    if (args.changedById) {
      const { data: prof } = await svc
        .from('profiles').select('full_name').eq('id', args.changedById).maybeSingle()
      changedByName = prof?.full_name ?? null
    }
    const { data: project } = await (svc as any)
      .schema('projects').from('projects').select('name').eq('id', args.projectId).maybeSingle()

    const { subject, html } = renderSnagStatusEmail({
      snagTitle: args.title,
      projectName: project?.name ?? 'your project',
      statusLabel: args.statusLabel,
      changedByName,
      snagId: args.snagId,
      siteUrl: SITE_URL,
    })

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ type: 'rfi-created', payload: { to: recipients, subject, html } }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.error('[snag-email] send-email failed', { projectId: args.projectId, recipients: recipients.length, status: res.status, body: body.slice(0, 300) })
      }
    } catch (e) {
      console.error('[snag-email] send-email threw', { projectId: args.projectId, err: String(e) })
    }
  } catch {
    // Email failures must never propagate.
  }
}
