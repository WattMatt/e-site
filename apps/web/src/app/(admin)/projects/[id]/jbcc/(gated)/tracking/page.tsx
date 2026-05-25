import { createClient } from '@/lib/supabase/server'
import { listLetters, listNotices } from '@esite/shared'
import { TrackingList } from './TrackingList'

interface PageProps { params: Promise<{ id: string }> }

export default async function TrackingPage({ params }: PageProps) {
  const { id: projectId } = await params
  const supabase = await createClient()
  const [letters, notices] = await Promise.all([
    listLetters(supabase, projectId),
    listNotices(supabase),
  ])
  const noticeById = Object.fromEntries(notices.map(n => [n.id, n]))
  return (
    <TrackingList
      projectId={projectId}
      letters={letters}
      noticeById={noticeById}
    />
  )
}
