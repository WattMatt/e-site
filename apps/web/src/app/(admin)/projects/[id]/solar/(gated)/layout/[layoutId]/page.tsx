import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadLayoutEditor } from '@/lib/solar/layout-loader'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import { LayoutWorkspace } from '../_components/LayoutWorkspace'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Layout editor (functional spec §6). View reads; Edit edits. Props handed to the client are JSON only. */
export default async function SolarLayoutEditorPage({ params }: { params: Promise<{ id: string; layoutId: string }> }) {
  const { id, layoutId } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const service = createServiceClient() as unknown as AnyClient
  const data = await loadLayoutEditor(supabase, service, id, layoutId, async (bucket, path) => {
    const { data: s } = await supabase.storage.from(bucket).createSignedUrl(path, 3600)
    return s?.signedUrl ?? null
  })
  if (!data) notFound()
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12 }}><Link href={`/projects/${id}/solar/layout`}>← Layouts</Link> · {data.layout.name} · {data.source.label}</div>
      <LayoutWorkspace data={data} canEdit={level !== 'view'} />
      <SavedReportsPanel projectId={id} kind="solar_layout_sheet" source={{ table: 'solar.layouts', id: layoutId }} canManage={false} title="Exported sheets" />
    </div>
  )
}
