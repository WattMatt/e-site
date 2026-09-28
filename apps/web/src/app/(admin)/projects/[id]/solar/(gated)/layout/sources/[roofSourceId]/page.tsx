import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadRoofSources } from '@/lib/solar/layout-loader'
import { SheetSettings } from './SheetSettings'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export default async function SolarRoofSheetPage({ params }: { params: Promise<{ id: string; roofSourceId: string }> }) {
  const { id, roofSourceId } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const { sources } = await loadRoofSources(supabase, id)
  const source = sources.find((s) => s.id === roofSourceId)
  if (!source) notFound()
  const { data: row } = await supabase.schema('solar').from('roof_sources').select('storage_path').eq('id', roofSourceId).maybeSingle()
  const { data: plan } = source.floorPlanId
    ? await supabase.schema('tenants').from('floor_plans').select('file_path').eq('id', source.floorPlanId).maybeSingle()
    : { data: null }
  const bucket = source.kind === 'satellite' ? 'solar-roof-images' : 'drawings'
  const path = source.kind === 'satellite' ? (row as { storage_path?: string } | null)?.storage_path : (plan as { file_path?: string } | null)?.file_path
  const { data: signed } = path ? await supabase.storage.from(bucket).createSignedUrl(path, 3600) : { data: null }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 12 }}><Link href={`/projects/${id}/solar/site`}>← Site &amp; Supply</Link></div>
      <SheetSettings projectId={id} source={source} canEdit={level !== 'view'}
        sheet={{ key: source.id, signedUrl: signed?.signedUrl ?? null, isPdf: /\.pdf$/i.test(path ?? ''), pageIndex: source.pageIndex }} />
    </div>
  )
}
