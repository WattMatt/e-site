import Link from 'next/link'
import { notFound } from 'next/navigation'
import { previousFinancialYear } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { requirePlatformTariffAdminPage } from '@/lib/tariffs/admin-gate'
import { loadPreviousPublished, loadYearTariffs } from '@/lib/tariffs/load-year'
import { computeYearChecks } from '@/lib/tariffs/year-checks'
import { buildReviewModel } from './review-model'
import { ReviewQueue } from './ReviewQueue'
import { PublishPanel } from './PublishPanel'

export const dynamic = 'force-dynamic'

export default async function YearReviewPage({ params }: { params: Promise<{ yearId: string }> }) {
  const { yearId } = await params
  const { supabase } = await requirePlatformTariffAdminPage()
  const { data: y } = await supabase.schema('tariffs').from('tariff_year')
    .select('id, licensee_id, financial_year, state, approved_increase_pct, validated_at, validation_blocking, effective_from, effective_to, licensee:licensee_id(name)')
    .eq('id', yearId).maybeSingle()
  const year = y as { id: string; licensee_id: string; financial_year: string; state: string; approved_increase_pct: string | number | null; validated_at: string | null; validation_blocking: number | null; effective_from: string; effective_to: string; licensee: { name: string } | null } | null
  if (!year) notFound()
  const loaded = await loadYearTariffs(supabase, year.id)
  const prev = await loadPreviousPublished(supabase, year.licensee_id, previousFinancialYear(year.financial_year))
  const checks = computeYearChecks(loaded.map((l) => l.tariff), prev?.tariffs ?? null, year.approved_increase_pct === null ? null : Number(year.approved_increase_pct))
  const model = buildReviewModel(loaded, checks.issues)
  const unreviewed = model.reduce((a, t) => a + t.charges.filter((c) => c.needsReview).length, 0)
  const draft = year.state === 'ingesting' || year.state === 'in_review'
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader>
          <span className="data-panel-title">{year.licensee?.name ?? 'Unknown'} {year.financial_year} · {year.state.replace('_', ' ')}</span>
          <span style={{ display: 'flex', gap: 12, fontSize: 13 }}>
            <Link href={`/admin/tariffs/years/${year.id}/diff`}>Year-on-year diff</Link>
            <Link href={`/admin/tariffs/years/${year.id}/sseg`}>SSEG rule</Link>
          </span>
        </CardHeader>
        <CardBody>
          <p style={{ fontSize: 13, marginTop: 0 }}>
            Effective {year.effective_from} to {year.effective_to}. Approved increase {year.approved_increase_pct ?? 'not recorded'} %. {loaded.length} tariffs.
          </p>
          <PublishPanel yearId={year.id} state={year.state} validatedAt={year.validated_at} blocking={year.validation_blocking} unreviewedInferred={unreviewed} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader><span className="data-panel-title">Automatic checks: {checks.blocking} blocking · {checks.review} to review · {checks.warn} warnings</span></CardHeader>
        <CardBody>
          {checks.issues.length === 0
            ? <p style={{ fontSize: 13 }}>No issues found.</p>
            : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>{checks.issues.map((i, k) => <li key={k}><strong>{i.severity}</strong> {i.tariff ? `${i.tariff}: ` : ''}{i.message}</li>)}</ul>}
        </CardBody>
      </Card>
      <ReviewQueue tariffs={model} editable={draft} />
    </div>
  )
}
