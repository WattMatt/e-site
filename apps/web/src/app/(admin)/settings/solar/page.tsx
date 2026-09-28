import Link from 'next/link'
import type { Metadata } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_SOLAR_SCHEDULE_TEMPLATE, OWNER_ADMIN, readScheduleTemplate, readSolarOrgSettings, solarSettingsToForm } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { requireRolePage } from '@/lib/auth/require-role'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { SolarSettingsForm } from './SolarSettingsForm'
import { ScheduleTemplateEditor } from './ScheduleTemplateEditor'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Solar defaults' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

const LATER = [
  { title: 'Rate card', body: 'R/Wp by size band, battery and inverter rates, BOS, fees, PM, contingency and margin — with the financial model.' },
  { title: 'Load densities', body: 'W/m² per tenant category and archetype mapping — with the load modelling tab.' },
  { title: 'Equipment catalogue', body: 'Modules, inverters and batteries (add, edit, retire, import) — with the PV layout tool.' },
  { title: 'Branding for Solar reports', body: 'Solar-specific disclaimer and terms — with feasibility reports and proposals.' },
]

/** /settings/solar (spec §11) — org owners/admins. A skeleton: three sections live, four later. */
export default async function SolarSettingsPage() {
  const ctx = await requireRolePage(OWNER_ADMIN)
  const supabase = (await createClient()) as unknown as AnyClient
  const { data } = await supabase
    .schema('solar').from('org_settings').select('settings, updated_at')
    .eq('organisation_id', ctx.organisationId).maybeSingle()
  const row = data as { settings?: unknown; updated_at?: string } | null
  const { data: tpl } = await supabase
    .schema('solar').from('schedule_templates').select('content, updated_at')
    .eq('organisation_id', ctx.organisationId).maybeSingle()
  const tplRow = tpl as { content?: unknown; updated_at?: string } | null
  // An invalid stored template shows the standard programme but keeps the row's
  // updated_at, so saving overwrites it rather than conflicting.
  const orgItems = readScheduleTemplate(tplRow?.content ?? null)

  return (
    <div className="animate-fadeup" style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 16 }}>
        <Link href="/settings" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}>
          ← Settings
        </Link>
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Solar defaults</h1>
          <p className="page-subtitle">Every new case copies these. A case keeps its own copy, so changing them never alters past results.</p>
        </div>
      </div>
      <SolarSettingsForm initial={solarSettingsToForm(readSolarOrgSettings(row?.settings ?? null))} updatedAt={row?.updated_at ?? null} />
      <div style={{ marginTop: 16 }}>
        <ScheduleTemplateEditor
          initialItems={orgItems ?? DEFAULT_SOLAR_SCHEDULE_TEMPLATE}
          updatedAt={tplRow?.updated_at ?? null}
          isDefault={orgItems === null}
        />
      </div>
      <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
        {LATER.map((s) => (
          <Card key={s.title}>
            <CardHeader><span className="data-panel-title">{`${s.title} — coming in a later phase`}</span></CardHeader>
            <CardBody><p style={{ fontSize: 13, color: 'var(--c-text-dim)', margin: 0 }}>{s.body}</p></CardBody>
          </Card>
        ))}
      </div>
    </div>
  )
}
