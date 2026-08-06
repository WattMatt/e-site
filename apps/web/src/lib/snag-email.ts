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
  renderSnagVisitCompletedEmail,
  computeVisitBuckets,
  CLOSED_STATUSES,
  type SnagVisitEmailPhoto,
  type SnagVisitDefectLine,
} from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveProjectRecipients } from './recipients'
import { notifyEntityEvent } from './notify'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.e-site.live'

/** Inline thumbnails in the visit email; the rest are summarised as a count. */
const MAX_EMAIL_PHOTOS = 6
/** Defects listed inline; the rest are summarised as a count. */
const MAX_EMAIL_DEFECTS = 5
/** Signed-URL lifetime for email thumbnails — the mail outlives a short TTL. */
const PHOTO_URL_TTL_SECONDS = 7 * 24 * 60 * 60

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

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
  /**
   * Suppress the individual roster email (the in-app bell still fires).
   *
   * Set when the snag is raised against a site visit that is still in progress:
   * those defects are reported together in the visit-completion email, so a
   * 40-snag walk sends one message instead of forty. Standalone snags — and
   * snags added to an already-completed visit — email immediately as before.
   */
  suppressEmail?: boolean
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
      email: { enabled: cfg.snagEmail && !args.suppressEmail, subject, html },
    })
  } catch {
    // Notification failures must never propagate to the snag write.
  }
}

export interface NotifySnagVisitCompletedArgs {
  visitId: string
  projectId: string
  /** Who pressed Complete — excluded from the bell, included in the email. */
  completedById: string
}

/**
 * Fan out the "site visit completed" bell + roster email.
 *
 * This is the module's headline notification: ONE message per completed walk,
 * carrying the outcome (counts, top defects, before/after thumbnails) and a
 * deep link to the visit page where the issued report is downloadable.
 *
 * Thumbnails are signed URLs with a 7-day TTL — the email long outlives the
 * 1-hour TTL used for in-app previews, and `data:` URIs are stripped by most
 * webmail clients.
 *
 * Best-effort: never throws. A notification failure must not undo a completed
 * visit or its issued report.
 */
export async function notifySnagVisitCompleted(args: NotifySnagVisitCompletedArgs): Promise<void> {
  try {
    const svc = createServiceClient()
    const cfg = await projectSettingsService.getNotificationConfig(svc as any, args.projectId)

    const field = (svc as any).schema('field')

    // Visit under completion + every visit in the project (bucketing needs the
    // full set to resolve carry-forward across visit numbers).
    const { data: visit } = await field
      .from('snag_visits')
      .select('id, visit_no, is_backlog, visit_date, conducted_by, attendees, notes')
      .eq('id', args.visitId)
      .maybeSingle()
    if (!visit) return

    const { data: allVisits } = await field
      .from('snag_visits')
      .select('id, visit_no')
      .eq('project_id', args.projectId)

    const { data: snagRows } = await field
      .from('snags')
      .select('id, title, priority, status, location, created_at, raised_on_visit_id, closed_on_visit_id, snag_photos(id, file_path, caption, photo_type, sort_order)')
      .eq('project_id', args.projectId)

    const snags = (snagRows ?? []) as any[]
    const buckets = computeVisitBuckets(
      { id: visit.id, visit_no: visit.visit_no },
      (allVisits ?? []) as any[],
      snags as any[],
    )

    const closedSet = new Set<string>(CLOSED_STATUSES as readonly string[])
    const totalOutstanding = snags.filter((s) => !closedSet.has(s.status)).length

    // ── Top defects: newest-raised first within priority order ───────────────
    const ranked = [...buckets.newSnags].sort((a: any, b: any) => {
      const pr = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
      return pr !== 0 ? pr : String(a.created_at).localeCompare(String(b.created_at))
    })
    const topDefects: SnagVisitDefectLine[] = ranked.slice(0, MAX_EMAIL_DEFECTS).map((s: any, i) => ({
      number: `S-${String(i + 1).padStart(3, '0')}`,
      title: s.title,
      priority: s.priority ?? 'low',
      location: s.location ?? null,
    }))
    const moreDefectCount = Math.max(0, ranked.length - topDefects.length)

    // ── Thumbnails: closed-this-visit before/after pairs first (they prove the
    //    work), then evidence from newly-raised defects. ───────────────────────
    type Candidate = { path: string; label: string }
    const candidates: Candidate[] = []
    for (const s of buckets.closedThisVisit as any[]) {
      const photos = (s.snag_photos ?? []) as any[]
      const before = photos.find((p) => p.photo_type === 'evidence')
      const after = photos.find((p) => p.photo_type === 'closeout')
      if (before) candidates.push({ path: before.file_path, label: `${s.title} — before` })
      if (after) candidates.push({ path: after.file_path, label: `${s.title} — after` })
    }
    for (const s of ranked as any[]) {
      for (const p of ((s.snag_photos ?? []) as any[]).filter((x) => x.photo_type !== 'closeout')) {
        candidates.push({ path: p.file_path, label: s.title })
      }
    }

    const chosen = candidates.slice(0, MAX_EMAIL_PHOTOS)
    const photos: SnagVisitEmailPhoto[] = []
    for (const c of chosen) {
      const { data } = await svc.storage
        .from('snag-photos')
        .createSignedUrl(c.path, PHOTO_URL_TTL_SECONDS)
      if (data?.signedUrl) photos.push({ url: data.signedUrl, label: c.label })
    }
    const morePhotoCount = Math.max(0, candidates.length - photos.length)

    // ── Names ────────────────────────────────────────────────────────────────
    const nameIds = [visit.conducted_by, args.completedById].filter((x): x is string => Boolean(x))
    const { data: profileRows } = await svc.from('profiles').select('id, full_name').in('id', nameIds)
    const profiles: Record<string, { full_name: string | null }> =
      Object.fromEntries((profileRows ?? []).map((p: any) => [p.id, p]))

    const { data: project } = await (svc as any)
      .schema('projects').from('projects').select('name').eq('id', args.projectId).maybeSingle()

    const attendees: string[] = Array.isArray(visit.attendees)
      ? (visit.attendees as any[])
          .map((a) => (typeof a === 'string' ? a : (a?.name ?? a?.full_name ?? '')))
          .filter((s: string) => Boolean(s && s.trim()))
      : []

    const visitLabel = visit.is_backlog ? 'Initial Backlog' : `Site Visit ${visit.visit_no}`

    const { subject, html } = renderSnagVisitCompletedEmail({
      projectId: args.projectId,
      visitId: args.visitId,
      projectName: project?.name ?? 'your project',
      visitLabel,
      visitDate: visit.visit_date,
      conductedByName: profiles[visit.conducted_by]?.full_name ?? 'A team member',
      completedByName: profiles[args.completedById]?.full_name ?? null,
      attendees,
      counts: {
        newSnags: buckets.newSnags.length,
        stillOpen: buckets.stillOpen.length,
        closedThisVisit: buckets.closedThisVisit.length,
        totalOutstanding,
      },
      topDefects,
      moreDefectCount,
      photos,
      morePhotoCount,
      notes: visit.notes ?? null,
      siteUrl: SITE_URL,
    })

    await notifyEntityEvent({
      projectId: args.projectId,
      actorId: args.completedById,
      bell: {
        title: `${visitLabel} complete`,
        body: `${buckets.newSnags.length} new · ${buckets.closedThisVisit.length} closed · ${totalOutstanding} outstanding`,
        route: `/projects/${args.projectId}/snags/visits/${args.visitId}`,
        type: 'snag_visit_completed',
        entityType: 'snag_visit',
        entityId: args.visitId,
      },
      email: { enabled: cfg.snagEmail, subject, html },
    })
  } catch (e) {
    console.error('[snag-email] visit-completed notify failed', {
      visitId: args.visitId,
      err: String(e),
    })
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
