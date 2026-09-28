import { notFound } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { ssegFormFromRow } from '@/lib/tariffs/sseg-form'
import { SsegRuleForm } from './SsegRuleForm'

export const dynamic = 'force-dynamic'

export default async function SsegPage({ params }: { params: Promise<{ yearId: string }> }) {
  const { yearId } = await params
  const { supabase } = await requirePlatformTariffAdminPage()
  const t = supabase.schema('tariffs')
  const { data: y } = await t.from('tariff_year').select('id, financial_year, state, licensee:licensee_id(name)').eq('id', yearId).maybeSingle()
  const year = y as { id: string; financial_year: string; state: string; licensee: { name: string } | null } | null
  if (!year) notFound()
  const [{ data: rule }, { data: docs }] = await Promise.all([
    t.from('sseg_rule').select('*').eq('tariff_year_id', year.id).maybeSingle(),
    t.from('source_document').select('id, title').order('created_at', { ascending: false }).limit(200),
  ])
  return (
    <Card>
      <CardHeader><span className="data-panel-title">SSEG rule — {year.licensee?.name ?? ''} {year.financial_year}</span></CardHeader>
      <CardBody>
        <SsegRuleForm yearId={year.id} initial={ssegFormFromRow(rule as Record<string, unknown> | null)}
          initialUpdatedAt={((rule as { updated_at?: string } | null)?.updated_at) ?? null}
          editable={year.state === 'ingesting' || year.state === 'in_review'}
          documents={((docs ?? []) as Array<{ id: string; title: string }>)} />
      </CardBody>
    </Card>
  )
}
