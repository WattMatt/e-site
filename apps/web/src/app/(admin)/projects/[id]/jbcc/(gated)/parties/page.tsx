import { createClient } from '@/lib/supabase/server'
import { listParties } from '@esite/shared'
import { PartiesEditor } from './PartiesEditor'

interface PageProps { params: Promise<{ id: string }> }

export default async function PartiesPage({ params }: PageProps) {
  const { id: projectId } = await params
  const supabase = await createClient()
  const parties  = await listParties(supabase as any, projectId)
  return <PartiesEditor projectId={projectId} initialParties={parties} />
}
