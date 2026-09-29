import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadFinancialsPageData } from '@/lib/solar/cases/financials-page-data'
import { EmptyState } from '@/components/ui/EmptyState'
import { StaleBanner } from '../../_components/StaleBanner'
import { PricingChangedBanner } from '../../_components/PricingChangedBanner'
import { FinancialsEditor } from './FinancialsEditor'
import { FinancialResults } from './FinancialResults'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/**
 * Financials (functional spec §8) — Edit + financials only. The gate runs FIRST; nothing (not even the
 * service-client study read) happens for a caller below edit_financials. Every figure shown is from the
 * stored case_run_financials row; the view model is JSON only.
 */
export default async function SolarFinancialsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ case?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(id, 'edit_financials', supabase)
  const data = await loadFinancialsPageData(supabase, createServiceClient() as unknown as AnyClient, id, sp.case)
  if (!data.hasStudy) return <EmptyState title="Save Site & Supply first" description="Financials price a case’s stored run." />
  if (!data.caseId) return <EmptyState title="No cases yet" description="Create and run a case on Yield & Scenarios first." />
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {data.energyStale && <StaleBanner projectId={id} caseId={data.caseId} caseName={data.caseName} canRun />}
      {data.pricingChanged && <PricingChangedBanner projectId={id} caseId={data.caseId} caseName={data.caseName} canRunFinancials />}
      {data.financialsStale && <div role="status">These financials were computed on older inputs — press Run financials to update them.</div>}
      {/* Keyed on the case and its saved version: switching case or a refresh after Save remounts the draft. */}
      <FinancialsEditor key={`${data.caseId}:${data.configUpdatedAt ?? 'default'}`} projectId={id} data={data} />
      {data.results
        ? <FinancialResults projectId={id} caseId={data.caseId} view={data.results} />
        : <EmptyState dense title="No financial results yet" description="Save the financials, then press Run financials." />}
    </div>
  )
}
