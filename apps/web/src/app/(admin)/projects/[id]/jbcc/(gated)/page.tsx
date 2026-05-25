import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { listNotices, listClauses, listTimeBars } from '@esite/shared'
import { ReferenceTabs } from '../_components/ReferenceTabs'

export const metadata: Metadata = { title: 'JBCC Procedural Toolkit' }

interface PageProps {
  params:       Promise<{ id: string }>
  searchParams: Promise<{ view?: string }>
}

export default async function JbccLibraryPage({ params, searchParams }: PageProps) {
  const { id: projectId } = await params
  const { view }          = await searchParams

  const supabase = await createClient()
  const [notices, clauses, timebars] = await Promise.all([
    listNotices(supabase),
    listClauses(supabase),
    listTimeBars(supabase),
  ])

  return (
    <ReferenceTabs
      projectId={projectId}
      initialView={view ?? 'notices'}
      notices={notices}
      clauses={clauses}
      timebars={timebars}
    />
  )
}
