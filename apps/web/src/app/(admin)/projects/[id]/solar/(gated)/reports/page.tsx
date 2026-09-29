import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadReportsPageData } from '@/lib/solar/reports/page-data'
import { loadSolarReadinessExtra } from '@/lib/solar/cases/page-data'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import { StaleBanner } from '../../_components/StaleBanner'
import { PricingChangedBanner } from '../../_components/PricingChangedBanner'
import { ReportGenerator } from './ReportGenerator'
import { ProposalsPanel } from './ProposalsPanel'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Reports & Proposal (spec §9). Technical for View+; feasibility and proposals for Edit + financials only. */
export default async function SolarReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const svc = createServiceClient() as unknown as AnyClient
  const [data, extra, { data: isGrantor }] = await Promise.all([
    loadReportsPageData(supabase, svc, id, level),
    loadSolarReadinessExtra(supabase, svc, id, level),
    supabase.rpc('solar_is_grantor', { p_project_id: id }),
  ])
  const money = level === 'edit_financials'
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {extra.stale && <StaleBanner projectId={id} caseId={extra.stale.caseId} caseName={extra.stale.caseName} canRun={level !== 'view'} />}
      {extra.pricingChanged && <PricingChangedBanner projectId={id} caseId={extra.pricingChanged.caseId} caseName={extra.pricingChanged.caseName} canRunFinancials={money} />}
      <ReportGenerator projectId={id} level={level} selected={data.selected} feasibility={data.feasibility} layoutSheet={data.layoutSheet} />
      <SavedReportsPanel projectId={id} kind="solar_technical" title="Technical reports" canManage={isGrantor === true} />
      {money && <SavedReportsPanel projectId={id} kind="solar_feasibility" title="Feasibility reports" canManage={isGrantor === true} />}
      {money && (
        <ProposalsPanel
          projectId={id} proposals={data.proposals} selected={data.selected} clientContacts={data.clientContacts}
          narrative={data.narrative} emailEnabled={data.emailEnabled}
        />
      )}
      {money && <SavedReportsPanel projectId={id} kind="solar_proposal" title="Issued proposal PDFs" canManage={false} />}
    </div>
  )
}
