/**
 * GET /api/rates/export?stat=median|p75[&province&contractor&category&from&to&q]
 *
 * Budget export (E6): one CSV row per catalogue item with the chosen
 * statistic (median by default — owner decision D2) escalated to the latest
 * CPI month, plus the nominal figure. Keyed by catalogue code so a budget
 * workbook can look rates up.
 *
 * Gate: COST_VIEW_ROLES on the caller's org (owner / admin / project_manager).
 * The rates are read through the caller's own client, so 00229's RLS is the
 * real boundary. Every export is written to rate_library_access_log.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { budgetCsv, COST_VIEW_ROLES, type BudgetStatistic } from '@esite/shared'
import { requireRoleAPI } from '@/lib/auth/require-role'
import { createClient } from '@/lib/supabase/server'
import { loadLibrary, logRateAccess, type AnyClient, type LibraryFilters } from '@/lib/rate-library/data'

export const dynamic = 'force-dynamic'

const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const guard = await requireRoleAPI(COST_VIEW_ROLES)
  if (!guard.ok) return guard.response
  const orgId = guard.ctx.organisationId

  const sp = req.nextUrl.searchParams
  const stat = (sp.get('stat') ?? 'median') as BudgetStatistic
  if (stat !== 'median' && stat !== 'p75') return NextResponse.json({ error: 'stat must be median or p75' }, { status: 400 })
  const f: LibraryFilters = {
    province: sp.get('province') || undefined, contractor: sp.get('contractor') || undefined,
    category: sp.get('category') || undefined, q: sp.get('q') || undefined,
    from: sp.get('from') && ISO.test(sp.get('from')!) ? sp.get('from')! : undefined,
    to: sp.get('to') && ISO.test(sp.get('to')!) ? sp.get('to')! : undefined,
  }

  const db = (await createClient()) as AnyClient
  const lib = await loadLibrary(db, orgId, f)
  const pick = (s: { median: number | null; p75: number | null }) => (stat === 'p75' ? s.p75 : s.median)
  const today = new Date().toISOString().slice(0, 10)
  const csv = budgetCsv({
    statistic: stat, escalatedTo: lib.cpiLatest ?? '', generatedOn: today,
    items: lib.summaries.map(s => ({
      // n counts the observations behind the escalated rate (pre-2015 prices cannot be escalated).
      code: s.item.code, description: s.item.description, unit: s.item.unit, n: s.escalated.n,
      rate: pick(s.escalated), nominal: pick(s.nominal),
      earliest: s.earliest, latest: s.nominal.latest?.pricedOn ?? null,
    })),
  })
  await logRateAccess(db, orgId, 'export_budget', null, { statistic: stat, filters: f, items: lib.summaries.length })

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rate-library-${stat}-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
