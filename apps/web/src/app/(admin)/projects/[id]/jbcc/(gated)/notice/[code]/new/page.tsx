import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getNotice, getNoticeFields, listParties } from '@esite/shared'
import { GenerateLetterForm } from './GenerateLetterForm'

interface PageProps {
  params: Promise<{ id: string; code: string }>
}

export default async function GenerateLetterPage({ params }: PageProps) {
  const { id: projectId, code } = await params
  const supabase = await createClient()

  const notice = await getNotice(supabase as any, code)
  if (!notice) notFound()

  const [fields, parties] = await Promise.all([
    getNoticeFields(supabase as any, notice.id),
    listParties(supabase as any, projectId),
  ])

  return (
    <GenerateLetterForm
      projectId={projectId}
      notice={notice}
      fields={fields}
      parties={parties}
    />
  )
}
