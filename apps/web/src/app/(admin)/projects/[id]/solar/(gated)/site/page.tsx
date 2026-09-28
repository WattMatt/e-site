import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { siteSupplyFormFromRow } from '@esite/shared'
import { SiteSupplyForm, type SiteNode } from './SiteSupplyForm'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

const STUDY_COLUMNS =
  'latitude, longitude, elevation_m, licensee_name, supply_type, nmd_kva, supply_voltage_v, poc_node_id, export_mode, export_limit_kw, constraints_note, updated_at'
const POC_KINDS = ['main_board', 'mini_sub', 'rmu']
const INCOMER_KINDS = ['main_board', 'mini_sub']

/** Site & Supply (spec §3). View level renders read-only; Edit and above can save. */
export default async function SolarSitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)

  const [{ data: project }, { data: study }, { data: nodeRows }] = await Promise.all([
    supabase.schema('projects').from('projects').select('address, city, province').eq('id', id).maybeSingle(),
    supabase.schema('solar').from('studies').select(STUDY_COLUMNS).eq('project_id', id).maybeSingle(),
    supabase.schema('structure').from('nodes').select('id, code, name, kind, rating_kva')
      .eq('project_id', id).eq('status', 'active').in('kind', POC_KINDS).order('code'),
  ])

  const p = (project ?? {}) as { address?: string | null; city?: string | null; province?: string | null }
  const address = [p.address, p.city, p.province].filter((v): v is string => Boolean(v && v.trim())).join(', ') || null
  const nodes: SiteNode[] = ((nodeRows ?? []) as Array<{ id: string; code: string; name: string | null; kind: string; rating_kva: number | string | null }>)
    .map((n) => {
      const rating = n.rating_kva === null || n.rating_kva === '' ? null : Number(n.rating_kva)
      return {
        id: n.id,
        label: n.name ? `${n.code} — ${n.name}` : n.code,
        kind: n.kind,
        ratingKva: rating !== null && Number.isFinite(rating) ? rating : null,
      }
    })
  const s = study as Record<string, unknown> | null
  const incomer = s?.nmd_kva == null ? nodes.find((n) => INCOMER_KINDS.includes(n.kind) && n.ratingKva !== null) : undefined

  return (
    <SiteSupplyForm
      projectId={id}
      initialForm={siteSupplyFormFromRow(s)}
      updatedAt={(s?.updated_at as string | undefined) ?? null}
      canEdit={level !== 'view'}
      address={address}
      nodes={nodes}
      nmdPrefill={incomer ? { value: String(incomer.ratingKva), from: incomer.label } : null}
    />
  )
}
