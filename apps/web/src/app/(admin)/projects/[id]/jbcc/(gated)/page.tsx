import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { listNotices, listClauses, listTimeBars, listLetters } from '@esite/shared'
import { ReferenceTabs } from '../_components/ReferenceTabs'
import { DeadlineStrip } from '../_components/DeadlineStrip'

export const metadata: Metadata = { title: 'JBCC Procedural Toolkit' }

interface PageProps {
  params:       Promise<{ id: string }>
  searchParams: Promise<{ view?: string }>
}

export default async function JbccLibraryPage({ params, searchParams }: PageProps) {
  const { id: projectId } = await params
  const { view }          = await searchParams

  const supabase = await createClient()
  const [notices, clauses, timebars, letters] = await Promise.all([
    listNotices(supabase),
    listClauses(supabase),
    listTimeBars(supabase),
    listLetters(supabase, projectId),
  ])

  return (
    <>
      <DeadlineStrip projectId={projectId} letters={letters} />
      <ReferenceTabs
        projectId={projectId}
        initialView={view ?? 'notices'}
        notices={notices}
        clauses={clauses}
        timebars={timebars}
      />
    </>
  )
}
