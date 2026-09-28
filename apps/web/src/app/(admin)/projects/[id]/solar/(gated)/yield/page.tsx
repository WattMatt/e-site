import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadYieldPageData } from '@/lib/solar/cases/page-data'
import { EmptyState } from '@/components/ui/EmptyState'
import { StaleBanner } from '../../_components/StaleBanner'
import { CaseList } from './CaseList'
import { CaseEditor } from './CaseEditor'
import { RunResults } from './RunResults'
import { CompareView } from './CompareView'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/**
 * Yield & Scenarios (functional spec §7). Every figure below comes from a stored run; the loader
 * returns JSON-only view models (no Float64Array / Date / function reaches a client component).
 */
export default async function SolarYieldPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ case?: string; compare?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const data = await loadYieldPageData(supabase, createServiceClient() as unknown as AnyClient, id, level, { caseId: sp.case, compare: sp.compare })
  if (!data.hasStudy) return <EmptyState title="Save Site & Supply first" description="Cases need the site’s coordinates and supply." />
  const selected = data.cases.find((c) => c.selected)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {selected?.status === 'stale' && <StaleBanner projectId={id} caseId={selected.id} caseName={selected.name} canRun={level !== 'view'} />}
      <CaseList projectId={id} level={level} cases={data.cases} studyUpdatedAt={data.studyUpdatedAt} openCaseId={data.editor?.caseId ?? null} />
      {data.compare && <CompareView columns={data.compare} showMoney={level === 'edit_financials'} />}
      {data.editor && (
        <>
          {/* Keyed on the case and its saved version: a refresh after Save (or opening another case) remounts the draft. */}
          <CaseEditor key={`${data.editor.caseId}:${data.editor.updatedAt}`} projectId={id} level={level} data={data.editor} equipment={data.equipment} />
          {data.editor.lastRun
            ? <RunResults key={data.editor.lastRun.id} projectId={id} caseId={data.editor.caseId} run={data.editor.lastRun} />
            : <EmptyState dense title="This case has not been run yet" description={level === 'view' ? 'Ask an editor to run it.' : 'Save it, then press Run.'} />}
        </>
      )}
    </div>
  )
}
