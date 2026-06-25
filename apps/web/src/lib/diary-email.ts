/**
 * Site-diary notifications — bell + email to the full project roster, via the
 * shared `notifyEntityEvent` helper (one live recipient resolve for both
 * channels). Called AFTER the entry AND its attachments are committed, so the
 * email carries the full entry plus inline photo thumbnails (signed URLs).
 * Email is gated by the project `notifyDiaryEmail` toggle. Best-effort and never
 * throws — a notification failure must not block (or surface from) the save.
 */

import { ENTRY_TYPE_LABELS, projectSettingsService, renderDiaryCreatedEmail, type DiaryEmailPhoto } from '@esite/shared'
import { createServiceClient } from '@/lib/supabase/server'
import { notifyEntityEvent } from './notify'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.e-site.live'
const MAX_INLINE_PHOTOS = 6
const SIGNED_URL_TTL = 60 * 60 * 24 * 7 // 7 days — survives email-client open delays

export interface NotifyDiaryCreatedArgs {
  entryId: string
  projectId: string
  /** The author (excluded from the bell). */
  authorId: string
}

export async function notifyDiaryEntryCreated(args: NotifyDiaryCreatedArgs): Promise<void> {
  try {
    const svc = createServiceClient()
    const cfg = await projectSettingsService.getNotificationConfig(svc as any, args.projectId)

    const { data: entry } = await (svc as any)
      .schema('projects').from('site_diary_entries')
      .select('id, entry_date, entry_type, progress_notes, safety_notes, quality_notes, delay_notes, delays, weather, workers_on_site')
      .eq('id', args.entryId).maybeSingle()
    if (!entry) return

    const { data: author } = await svc
      .from('profiles').select('full_name').eq('id', args.authorId).maybeSingle()
    const { data: project } = await (svc as any)
      .schema('projects').from('projects').select('name').eq('id', args.projectId).maybeSingle()

    // Attachments → inline image thumbnails (signed) + a count of the rest.
    const { data: attRows } = await (svc as any)
      .schema('projects').from('site_diary_attachments')
      .select('file_path, file_name, kind, sort_order')
      .eq('diary_entry_id', args.entryId)
      .order('sort_order', { ascending: true })
    const attachments = (attRows ?? []) as { file_path: string; file_name: string; kind: string }[]
    const images = attachments.filter((a) => a.kind === 'image').slice(0, MAX_INLINE_PHOTOS)
    let photos: DiaryEmailPhoto[] = []
    if (images.length) {
      const { data: signed } = await svc.storage
        .from('diary-attachments')
        .createSignedUrls(images.map((i) => i.file_path), SIGNED_URL_TTL)
      const byPath = new Map((signed ?? []).map((s: any) => [s.path, s.signedUrl]))
      photos = images
        .map((i) => ({ url: byPath.get(i.file_path) ?? '', fileName: i.file_name }))
        .filter((p) => p.url)
    }
    const otherAttachmentCount = attachments.length - photos.length

    const projectName = project?.name ?? 'your project'
    const entryTypeLabel = ENTRY_TYPE_LABELS[entry.entry_type as keyof typeof ENTRY_TYPE_LABELS] ?? 'Progress'

    const { subject, html } = renderDiaryCreatedEmail({
      authorName: author?.full_name ?? 'A team member',
      projectName,
      entryDate: entry.entry_date,
      entryTypeLabel,
      entryId: args.entryId,
      projectId: args.projectId,
      progressNotes: entry.progress_notes ?? '',
      safetyNotes: entry.safety_notes,
      qualityNotes: entry.quality_notes,
      delayNotes: entry.delay_notes,
      delays: entry.delays,
      weather: entry.weather,
      workersOnSite: entry.workers_on_site,
      photos,
      otherAttachmentCount,
      siteUrl: SITE_URL,
    })

    await notifyEntityEvent({
      projectId: args.projectId,
      actorId: args.authorId,
      bell: {
        title: 'New site diary entry',
        body: `${projectName} — ${entry.entry_date}`,
        route: `/projects/${args.projectId}/diary#entry-${args.entryId}`,
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
