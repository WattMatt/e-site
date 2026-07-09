import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getLetter, getNoticeById, listLetterAttachments,
  listLetterEvents, listLetterRecipients,
} from '@esite/shared'
import { LetterDetail } from './LetterDetail'

interface PageProps { params: Promise<{ id: string; letterId: string }> }

export default async function LetterDetailPage({ params }: PageProps) {
  const { id: projectId, letterId } = await params
  const supabase = await createClient()

  const letter = await getLetter(supabase as any, letterId)
  if (!letter || letter.project_id !== projectId) notFound()

  const [notice, attachments, events, recipients] = await Promise.all([
    getNoticeById(supabase as any, letter.notice_id),
    listLetterAttachments(supabase as any, letter.id),
    listLetterEvents(supabase as any, letter.id),
    listLetterRecipients(supabase as any, letter.id),
  ])

  // Resolve actor display names for the audit trail (best-effort).
  const actorIds = Array.from(new Set(
    [letter.created_by, ...events.map(e => e.actor_id)].filter(Boolean),
  ))
  const actorNames: Record<string, string> = {}
  if (actorIds.length) {
    const { data: profiles } = await supabase
      .from('profiles').select('id, full_name').in('id', actorIds)
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (p.full_name) actorNames[p.id] = p.full_name
    }
  }

  // Signed URL for the generated .docx (5 minute TTL).
  const { data: signed } = await supabase.storage
    .from('jbcc-letters')
    .createSignedUrl(letter.document_path, 60 * 5)

  const attachmentsWithUrls = await Promise.all(
    attachments.map(async a => {
      const { data: s } = await supabase.storage
        .from('jbcc-letters').createSignedUrl(a.file_path, 60 * 5)
      return { ...a, signedUrl: s?.signedUrl ?? null }
    }),
  )

  return (
    <LetterDetail
      projectId={projectId}
      letter={letter}
      notice={notice}
      letterUrl={signed?.signedUrl ?? null}
      attachments={attachmentsWithUrls}
      events={events}
      recipients={recipients}
      actorNames={actorNames}
    />
  )
}
