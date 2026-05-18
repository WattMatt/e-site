import { ReactNode } from 'react'
import { SubNavPills } from './_components/SubNavPills'
import { createClient } from '@/lib/supabase/server'
import {
  enrichScheduleItems,
  getStageCounts,
} from '@esite/shared'

export default async function MaterialsLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id: projectId } = await params
  const supabase = await createClient()

  let items: Awaited<ReturnType<typeof enrichScheduleItems>> = []
  try {
    items = await enrichScheduleItems(supabase, projectId)
  } catch {
    items = []
  }
  const counts = getStageCounts(items)

  return (
    <div className="animate-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <SubNavPills projectId={projectId} counts={counts} />
      {children}
    </div>
  )
}
