import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { OWNER_ADMIN } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { orgHasSolar } from '@/lib/solar/access'
import { solarPriceLine } from '@/lib/solar/price'
import { loadPortfolio } from '@/lib/solar/portfolio'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FeatureSummary } from '@/app/(admin)/projects/[id]/solar/_components/FeatureSummary'
import { SubscribeButton } from '@/app/(admin)/projects/[id]/solar/_components/SubscribeButton'
import { PortfolioTable } from './PortfolioTable'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Solar portfolio' }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/**
 * Solar portfolio (spec §15): every Solar project of the active org the caller may see.
 * Client viewers are bounced to /portal by (admin)/layout.tsx; `solar_portfolio` returns only
 * projects where `solar_can_view` holds and a saving only where `solar_can_see_money` holds.
 */
export default async function SolarPortfolioPage() {
  const ctx = await getOrgContext()
  if (!ctx) redirect('/login?next=/solar')
  const supabase = (await createClient()) as unknown as AnyClient
  const isAdmin = OWNER_ADMIN.includes(ctx.role)

  if (!(await orgHasSolar(ctx.organisationId, supabase))) {
    const [{ data: org }, { data: firstProject }] = await Promise.all([
      supabase.from('organisations').select('name').eq('id', ctx.organisationId).maybeSingle(),
      supabase.schema('projects').from('projects').select('id').eq('organisation_id', ctx.organisationId).order('created_at', { ascending: true }).limit(1).maybeSingle(),
    ])
    const orgName = (org as { name?: string } | null)?.name ?? 'your organisation'
    const projectId = (firstProject as { id?: string } | null)?.id ?? null
    return (
      <div style={{ display: 'grid', gap: 16, maxWidth: 960 }}>
        <h1 className="page-title">Solar portfolio</h1>
        <FeatureSummary />
        <Card>
          <CardHeader><span className="data-panel-title">{`Solar is not active for ${orgName}`}</span></CardHeader>
          <CardBody>
            {isAdmin
              ? (projectId
                ? <><p style={{ fontSize: 13 }}>{solarPriceLine()}</p><SubscribeButton projectId={projectId} /></>
                : <p style={{ fontSize: 13 }}>Create a project first — Solar is subscribed from a project’s Solar tab.</p>)
              : <p style={{ fontSize: 13 }}>Ask an organisation owner or admin to subscribe (from any project’s Solar tab).</p>}
          </CardBody>
        </Card>
      </div>
    )
  }

  const rows = await loadPortfolio(supabase, ctx.organisationId)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Solar portfolio</h1>
          <p className="page-subtitle">Every Solar study you have access to in this organisation. A map view is not available — E-Site has no map component yet; filter by province or supply authority instead.</p>
        </div>
      </div>
      <PortfolioTable rows={rows} isAdmin={isAdmin} />
    </div>
  )
}
