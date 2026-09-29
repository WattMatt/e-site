import Link from 'next/link'
import type { Metadata } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OWNER_ADMIN } from '@esite/shared'
import { EQUIPMENT_CSV_HEADER } from '@esite/shared/solar-cases'
import { createClient } from '@/lib/supabase/server'
import { requireRolePage } from '@/lib/auth/require-role'
import { EquipmentCatalogue, type EquipmentRowView } from './EquipmentCatalogue'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Solar equipment' }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * /settings/solar/equipment (spec §11) — owner/admin of the active org (gate FIRST). Rows are read through
 * the caller's session (RLS: the org library + platform rows), then narrowed to the ACTIVE org + platform,
 * which is the set the equipment actions write to.
 */
export default async function SolarEquipmentPage() {
  const ctx = await requireRolePage(OWNER_ADMIN)
  const supabase = (await createClient()) as unknown as AnyClient
  const { data } = await supabase.schema('solar').from('equipment').select('id, organisation_id, kind, make, model, specs, source, retired_at, updated_at')
    .order('kind').order('make').order('model')
  const rows: EquipmentRowView[] = ((data ?? []) as Row[])
    .filter((r) => r.organisation_id === null || r.organisation_id === ctx.organisationId)
    .map((r) => ({ id: r.id, kind: r.kind, make: r.make, model: r.model, specs: r.specs ?? {}, platform: r.organisation_id === null, retired: r.retired_at !== null, source: r.source, updatedAt: r.updated_at }))
  return (
    <div className="animate-fadeup" style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/settings/solar" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}>← Solar defaults</Link>
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Equipment catalogue</h1>
          <p className="page-subtitle">Modules, inverters and batteries your cases can use. Retire an item to hide it from new cases — existing cases keep their copy.</p>
        </div>
      </div>
      {rows.length === 0 && <p>No equipment visible — the catalogue needs an active Solar subscription.</p>}
      <EquipmentCatalogue rows={rows} csvHeader={EQUIPMENT_CSV_HEADER.join(',')} />
    </div>
  )
}
