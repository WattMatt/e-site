import Link from 'next/link'
import type { Metadata } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OWNER_ADMIN, readSolarOrgSettings, solarSettingsToForm } from '@esite/shared'
import { templateFromRow } from '@esite/shared/solar-operations/client'
import { createClient } from '@/lib/supabase/server'
import { requireRolePage } from '@/lib/auth/require-role'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { SolarSettingsForm } from './SolarSettingsForm'
import { ProposalTemplatesForm } from './ProposalTemplatesForm'
import { HandoverTemplateForm } from './HandoverTemplateForm'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Solar defaults' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

const LATER = [
  { title: 'Load densities', body: 'W/m² per tenant category and archetype mapping — with the load modelling tab.' },
]

/** /settings/solar (spec §11) — org owners/admins. Rate card + finance/opex/loss defaults live; equipment on its own page; proposal templates live; load densities later. */
export default async function SolarSettingsPage() {
  const ctx = await requireRolePage(OWNER_ADMIN)
  const supabase = (await createClient()) as unknown as AnyClient
  const { data } = await supabase
    .schema('solar').from('org_settings').select('settings, updated_at')
    .eq('organisation_id', ctx.organisationId).maybeSingle()
  const row = data as { settings?: unknown; updated_at?: string } | null
  // Read through the caller's session (00216 SELECT policy); an unsubscribed org just sees the defaults.
  const { data: tpl } = await supabase.schema('solar').from('proposal_templates')
    .select('terms_text, disclaimer_text, validity_days, updated_at').eq('organisation_id', ctx.organisationId).maybeSingle()
  const t = tpl as { terms_text?: string; disclaimer_text?: string; validity_days?: number; updated_at?: string } | null
  // Phase 7: the org's handover checklist template (00217 SELECT policy); none saved → the built-in default.
  const { data: hoRow } = await supabase.schema('solar').from('handover_templates')
    .select('name, items, updated_at').eq('organisation_id', ctx.organisationId).maybeSingle()
  const ho = hoRow as { name?: unknown; items?: unknown; updated_at?: string } | null

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
      <p style={{ fontSize: 13, marginBottom: 16 }}>
        <Link href="/settings/solar/equipment">Equipment catalogue →</Link>{' '}
        Modules, inverters and batteries (add, edit, retire, import from CSV).
      </p>
      <SolarSettingsForm initial={solarSettingsToForm(readSolarOrgSettings(row?.settings ?? null))} updatedAt={row?.updated_at ?? null} />
      <div style={{ marginTop: 16 }}>
        <ProposalTemplatesForm
          initial={{ termsText: t?.terms_text ?? '', disclaimerText: t?.disclaimer_text ?? '', validityDays: t?.validity_days ?? 30 }}
          updatedAt={t?.updated_at ?? null}
        />
      </div>
      <div style={{ marginTop: 16 }}>
        <HandoverTemplateForm initial={templateFromRow(ho ? { name: ho.name, items: ho.items } : null)} updatedAt={ho?.updated_at ?? null} />
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
