/**
 * Site-diary notifications — bell + email to the full project roster on every
 * entry, via the shared `notifyEntityEvent` helper (one live recipient resolve
 * for both channels). Email is gated by the project `notifyDiaryEmail` toggle.
 * Best-effort and never throws — a notification failure must not block (or
 * surface from) diary entry creation.
 */

import { projectSettingsService, renderDiaryCreatedEmail } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { notifyEntityEvent } from './notify'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.e-site.live'
const SUMMARY_MAX = 280

export interface NotifyDiaryCreatedArgs {
  entryId: string
  projectId: string
  entryDate: string
  /** The entry's progress notes — truncated into the email excerpt. */
  progressNotes: string
  /** The author (excluded from the bell). */
  authorId: string
}

export async function notifyDiaryEntryCreated(args: NotifyDiaryCreatedArgs): Promise<void> {
  try {
    const svc = createServiceClient()
    const cfg = await projectSettingsService.getNotificationConfig(svc as any, args.projectId)

    const { data: author } = await svc
      .from('profiles').select('full_name').eq('id', args.authorId).maybeSingle()
    const { data: project } = await (svc as any)
      .schema('projects').from('projects').select('name').eq('id', args.projectId).maybeSingle()

    const trimmed = args.progressNotes.trim()
    const summary = trimmed.length > SUMMARY_MAX ? `${trimmed.slice(0, SUMMARY_MAX)}…` : trimmed
    const projectName = project?.name ?? 'your project'

    const { subject, html } = renderDiaryCreatedEmail({
      authorName: author?.full_name ?? 'A team member',
      projectName,
      entryDate: args.entryDate,
      summary,
      projectId: args.projectId,
      siteUrl: SITE_URL,
    })

    await notifyEntityEvent({
      projectId: args.projectId,
      actorId: args.authorId,
      bell: {
        title: 'New site diary entry',
        body: `${projectName} — ${args.entryDate}`,
        route: `/projects/${args.projectId}/diary`,
        type: 'diary_created',
        entityType: 'diary',
        entityId: args.entryId,
      },
      email: { enabled: cfg.diaryEmail, subject, html },
    })
  } catch {
    // Notification failures must never propagate to the diary write.
  }
}
