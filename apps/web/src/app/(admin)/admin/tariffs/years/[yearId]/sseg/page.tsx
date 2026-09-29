import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { ssegFormFromRow } from '@/lib/tariffs/sseg-form'
import { SsegRuleForm } from './SsegRuleForm'
import { ExportTariffLinks, type ExportLinkTariff } from './ExportTariffLinks'

export const dynamic = 'force-dynamic'

export default async function SsegPage({ params }: { params: Promise<{ yearId: string }> }) {
  const { yearId } = await params
  const { supabase } = await requirePlatformTariffAdminPage()
  const t = supabase.schema('tariffs')
  const { data: y } = await t.from('tariff_year').select('id, financial_year, state, licensee:licensee_id(name)').eq('id', yearId).maybeSingle()
  const year = y as { id: string; financial_year: string; state: string; licensee: { name: string } | null } | null
  if (!year) notFound()
  const [{ data: rule }, { data: docs }, { data: tariffRows }] = await Promise.all([
    t.from('sseg_rule').select('*').eq('tariff_year_id', year.id).maybeSingle(),
    t.from('source_document').select('id, title').order('created_at', { ascending: false }).limit(200),
    t.from('tariff').select('id, name, code, category, export_tariff_id, updated_at').eq('tariff_year_id', year.id).order('name'),
  ])
  const editable = year.state === 'ingesting' || year.state === 'in_review'
  const links: ExportLinkTariff[] = ((tariffRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), name: String(r.name), code: (r.code as string | null) ?? null, category: String(r.category),
    exportTariffId: (r.export_tariff_id as string | null) ?? null, updatedAt: String(r.updated_at),
  }))
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader><span className="data-panel-title">SSEG rule — {year.licensee?.name ?? ''} {year.financial_year}</span></CardHeader>
        <CardBody>
          <SsegRuleForm yearId={year.id} initial={ssegFormFromRow(rule as Record<string, unknown> | null)}
            initialUpdatedAt={((rule as { updated_at?: string } | null)?.updated_at) ?? null}
            editable={editable}
            documents={((docs ?? []) as Array<{ id: string; title: string }>)} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader><span className="data-panel-title">Export tariffs</span></CardHeader>
        <CardBody>
          <p style={{ fontSize: 13, marginTop: 0 }}>
            A project whose export rule is &ldquo;linked tariff&rdquo; is credited at the export tariff chosen here for its tariff.
            {!editable && ' This year is published: the links are read-only.'}
          </p>
          <ExportTariffLinks tariffs={links} editable={editable} />
        </CardBody>
      </Card>
    </div>
  )
}
