/**
 * RFI notifications — bell + email to the full project roster, for every event
 * the project toggle promises.
 *
 * WHAT WAS WRONG. The `notifyRfiEmail` toggle reads "Send an email to the
 * project team when an RFI is raised, responded to, or closed", and only the
 * create path ever dispatched one. Respond and close fired `dispatchNotification`
 * alone — and `public.push_tokens` holds ZERO rows, so the push half delivered
 * nothing and the whole notification was one database row nobody is guaranteed
 * to look at. Every responded RFI in production was raised by a client-side user
 * and answered by the engineer: the external party got an email when they asked
 * the question and silence when it was answered.
 *
 * All three events now go through `notifyEntityEvent`, the same channel diary,
 * QC, snags and site forms use. That also settles an audience inconsistency:
 * create used to email the whole roster while respond/close notified only
 * raiser + assignee (and all five responded RFIs had `assigned_to = null`, so
 * "both" was one person).
 *
 * ⚠ WHY CLOSE IS CONDITIONAL. On the four production RFIs that had both a
 * response and a close, the close landed 43s, 20s, 10s and 6s after the
 * response — the engineer answers and closes in one sitting. Wiring both events
 * naively would double-mail nearly every exchange, which is how a project team
 * learns to filter the sender. So the close email is withheld when a response
 * was dispatched inside RFI_CLOSE_EMAIL_SUPPRESSION_WINDOW_MS; the bell always
 * fires, and a close hours or days later (or with no response at all — a
 * withdrawn RFI) is still its own email.
 *
 * The bounce/complaint suppression consult lives inside `notifyEntityEvent`, on
 * the email leg only, so it is not repeated here.
 *
 * ⚠ NOT COVERED: apps/mobile/app/rfis/[id].tsx calls `rfiService.respond/close`
 * directly and bypasses these server actions, and `rfiService` dispatches
 * nothing. An RFI answered from the phone is still silent on every channel. The
 * clean fix is a notifier injected into the shared service (it cannot import
 * from apps/web); that file is out of scope here.
 */

import {
  projectSettingsService,
  renderRfiCreatedEmail,
  renderBrandedEmail,
  escapeHtml,
  DEFAULT_ACCENT_COLOR,
} from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { notifyEntityEvent } from './notify'

/**
 * How close to a response a close has to be for its email to be withheld.
 *
 * Sized off the real data (worst observed gap 43s) with a wide margin, so an
 * engineer who answers, re-reads the thread and then closes still counts as one
 * exchange. Long enough to catch the pattern; far short of "closed the next
 * morning", which is genuinely new information.
 */
export const RFI_CLOSE_EMAIL_SUPPRESSION_WINDOW_MS = 15 * 60 * 1000

/**
 * Should closing this RFI send its own email?
 *
 * Pure, so the judgement is testable without a database. Fails towards TELLING
 * people: an absent or unparseable response timestamp sends the email.
 */
export function shouldEmailOnClose(
  latestResponseAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!latestResponseAt) return true
  const at = Date.parse(latestResponseAt)
  if (Number.isNaN(at)) return true
  return now.getTime() - at >= RFI_CLOSE_EMAIL_SUPPRESSION_WINDOW_MS
}

export type RfiEventKind = 'created' | 'responded' | 'closed'

export interface NotifyRfiEventArgs {
  event: RfiEventKind
  projectId: string
  rfiId: string
  rfiSubject: string
  /** The user performing the action — excluded from the in-app bell. */
  actorId: string
  /** `created` only: priority / due date shown in the email body. */
  priority?: string
  dueDate?: string | null
  /** Resolved assignee (may be null — unassigned RFI). */
  assigneeId?: string | null
  /** `created` only: the person who raised the RFI (the email's author line). */
  raiserId?: string | null
  /** `responded` only: the response row id, so the bell deep-links to it. */
  bellEntityId?: string
}

type AnyClient = any // eslint-disable-line @typescript-eslint/no-explicit-any

/** Read the most recent response timestamp for the close-window decision. */
async function latestResponseAt(svc: AnyClient, rfiId: string): Promise<string | null> {
  try {
    const { data } = await svc
      .schema('projects')
      .from('rfi_responses')
      .select('created_at')
      .eq('rfi_id', rfiId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return (data as { created_at?: string } | null)?.created_at ?? null
  } catch {
    // Unreadable → treat as "no response", i.e. send the email. A missed
    // duplicate is a smaller failure than a silent close.
    return null
  }
}

/**
 * Fan an RFI event out to the whole project roster: in-app bell to everyone but
 * the actor, email to the roster when `notifyRfiEmail` is on. Never throws — an
 * email failure must not surface from (or block) the RFI write.
 */
export async function notifyRfiEvent(args: NotifyRfiEventArgs): Promise<void> {
  try {
    const svc = createServiceClient() as AnyClient

    const cfg = await projectSettingsService.getNotificationConfig(svc, args.projectId)
    let emailEnabled = Boolean(cfg.rfiEmail)

    if (args.event === 'closed' && emailEnabled) {
      emailEnabled = shouldEmailOnClose(await latestResponseAt(svc, args.rfiId))
    }

    // Names for the email body: the actor, plus the raiser/assignee on create.
    const nameIds = [args.actorId, args.raiserId, args.assigneeId].filter(
      (x): x is string => Boolean(x),
    )
    let profiles: Record<string, { full_name: string | null }> = {}
    if (nameIds.length) {
      const { data: rows } = await svc.from('profiles').select('id, full_name').in('id', nameIds)
      profiles = Object.fromEntries(((rows ?? []) as any[]).map((p) => [p.id, p]))
    }
    const { data: project } = await svc
      .schema('projects')
      .from('projects')
      .select('name')
      .eq('id', args.projectId)
      .maybeSingle()

    const projectName = (project as { name?: string } | null)?.name ?? 'your project'
    const actorName = profiles[args.actorId]?.full_name ?? 'A team member'
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.e-site.live'

    const { bell, email } = buildRfiEventContent({
      ...args,
      projectName,
      actorName,
      raiserName: args.raiserId ? profiles[args.raiserId]?.full_name ?? null : null,
      assigneeName: args.assigneeId ? profiles[args.assigneeId]?.full_name ?? null : null,
      siteUrl,
    })

    await notifyEntityEvent({
      projectId: args.projectId,
      actorId: args.actorId,
      bell,
      email: { enabled: emailEnabled, ...email },
    })
  } catch (e) {
    console.error('[rfi-email] notify failed', { rfiId: args.rfiId, event: args.event, err: String(e) })
  }
}

interface RfiContentArgs extends NotifyRfiEventArgs {
  projectName: string
  actorName: string
  raiserName: string | null
  assigneeName: string | null
  siteUrl: string
}

/** Bell copy + rendered email for one RFI event. */
function buildRfiEventContent(a: RfiContentArgs): {
  bell: { title: string; body: string; route: string; type: string; entityType: string; entityId: string }
  email: { subject: string; html: string }
} {
  const route = `/rfis/${a.rfiId}`
  const link = `${a.siteUrl}${route}`

  if (a.event === 'created') {
    const priority = a.priority ?? 'medium'
    return {
      bell: {
        title: 'New RFI raised',
        body: `"${a.rfiSubject}" — ${priority} priority${a.dueDate ? ` · due ${a.dueDate}` : ''}`,
        route,
        type: 'rfi_created',
        entityType: 'rfi',
        entityId: a.rfiId,
      },
      email: renderRfiCreatedEmail({
        raisedByName: a.raiserName ?? a.actorName,
        assigneeName: a.assigneeName,
        rfiSubject: a.rfiSubject,
        projectName: a.projectName,
        priority,
        dueDate: a.dueDate ?? null,
        rfiId: a.rfiId,
        siteUrl: a.siteUrl,
      }),
    }
  }

  const responded = a.event === 'responded'
  const title = responded ? 'RFI response received' : 'RFI closed'
  const lead = responded
    ? `<strong>${escapeHtml(a.actorName)}</strong> responded to an RFI on <strong>${escapeHtml(a.projectName)}</strong>.`
    : `<strong>${escapeHtml(a.actorName)}</strong> closed an RFI on <strong>${escapeHtml(a.projectName)}</strong>.`

  return {
    bell: {
      title,
      body: responded
        ? `"${a.rfiSubject}" — new response posted`
        : `"${a.rfiSubject}" — closed`,
      route,
      type: responded ? 'rfi_response' : 'rfi_closed',
      entityType: responded ? 'rfi_response' : 'rfi',
      entityId: a.bellEntityId ?? a.rfiId,
    },
    email: {
      subject: responded
        ? `RFI responded: ${a.rfiSubject}`
        : `RFI closed: ${a.rfiSubject}`,
      html: renderBrandedEmail({
        accentColor: DEFAULT_ACCENT_COLOR,
        logoUrl: null,
        projectName: a.projectName,
        title,
        siteUrl: a.siteUrl,
        contentHtml:
          `<p>${lead}</p>` +
          `<p><strong>Subject:</strong> ${escapeHtml(a.rfiSubject)}</p>` +
          `<p><a class="btn" href="${escapeHtml(link)}" style="display:inline-block;background:${DEFAULT_ACCENT_COLOR};color:#0F172A;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:700;font-size:14px">View RFI</a></p>`,
      }),
    },
  }
}
