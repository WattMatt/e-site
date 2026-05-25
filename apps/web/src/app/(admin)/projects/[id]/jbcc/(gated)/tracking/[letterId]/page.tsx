import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getLetter, getNoticeById, listLetterAttachments,
} from '@esite/shared'
import { LetterDetail } from './LetterDetail'

interface PageProps { params: Promise<{ id: string; letterId: string }> }

export default async function LetterDetailPage({ params }: PageProps) {
  const { id: projectId, letterId } = await params
  const supabase = await createClient()

  const letter = await getLetter(supabase as any, letterId)
  if (!letter || letter.project_id !== projectId) notFound()

  const [notice, attachments] = await Promise.all([
    getNoticeById(supabase as any, letter.notice_id),
    listLetterAttachments(supabase as any, letter.id),
  ])

  // Signed URL for the generated .docx (5 minute TTL).
  const { data: signed } = await supabase.storage
    .from('jbcc-letters')
    .createSignedUrl(letter.document_path, 60 * 5)

  // Signed URLs for attachments, batched.
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
    />
  )
}
