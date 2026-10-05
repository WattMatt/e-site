import { COST_VIEW_ROLES, normaliseUnit } from '@esite/shared'
import { requireRolePage } from '@/lib/auth/require-role'
import { createClient } from '@/lib/supabase/server'
import { Card, CardBody } from '@/components/ui/Card'
import { loadItems, loadQueue, logRateAccess, type AnyClient } from '@/lib/rate-library/data'
import { aiSuggestionStatus } from '@/actions/rate-catalogue.actions'
import { RatesNav } from '../_components/RatesNav'
import { QueueGroupCard, type QueueGroupView } from '../_components/QueueGroupCard'

export const dynamic = 'force-dynamic'

const MISSING: Record<string, string> = {
  install: 'installation method not stated', profile: 'trunking profile not stated', component: 'fitting not named',
  width: 'width not stated', rating: 'rating not stated', poles: 'poles not stated', cores: 'cores not stated',
  conductor: 'conductor not stated', kv: 'voltage not stated', voltage: 'voltage not stated', size: 'size not stated',
  trade: 'trade not recognised', time: 'time band not stated', unit: 'unit not recognised', ways: 'ways not stated', levers: 'levers not stated',
}

export default async function RateReviewPage() {
  const ctx = await requireRolePage(COST_VIEW_ROLES)
  const db = (await createClient()) as AnyClient
  const [groups, items, ai] = await Promise.all([loadQueue(db, ctx.organisationId), loadItems(db, ctx.organisationId), aiSuggestionStatus()])
  await logRateAccess(db, ctx.organisationId, 'view_review', null, { groups: groups.length })
  const options = items.filter(i => i.is_active).map(i => ({ id: i.id, code: i.code, description: i.description, unit: i.unit }))
  const byId = new Map(options.map(o => [o.id, o]))
  const views: QueueGroupView[] = groups.map(g => {
    const u = normaliseUnit(g.unit)
    const missing = Array.isArray(g.detail?.missing) ? (g.detail.missing as string[]) : []
    const category = typeof g.detail?.category === 'string' ? (g.detail.category as string).replace(/_/g, ' ') : null
    return {
      groupKey: g.groupKey, heading: g.heading, description: g.description, unit: g.unit,
      normalisedUnit: u === 'sum' || u === 'lot' ? 'no' : u, status: g.status, lines: g.lines, sources: g.sources,
      suggested: g.suggestedItemId ? byId.get(g.suggestedItemId) ?? null : null, method: g.method,
      reason: typeof g.detail?.reason === 'string' ? (g.detail.reason as string) : null,
      hint: category ? `looks like ${category}${missing.length ? `; ${missing.map(m => MISSING[m] ?? m).join(', ')}` : ''}` : null,
      sampleRate: g.sampleRate,
    }
  })
  const suggested = views.filter(v => v.status === 'suggested').length
  const lines = views.reduce((a, v) => a + v.lines, 0)

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16 }}>
      <RatesNav active="/rates/review" queued={lines} />
      <p style={{ margin: 0, color: 'var(--c-text-dim)', maxWidth: 760 }}>
        {views.length} group(s), {lines} line(s): {suggested} with a suggestion to confirm. Lines that read the same are reviewed together.
        A rule match that fills every attribute is confirmed automatically; anything less waits here and is never merged without a person.
      </p>
      {views.length === 0 ? (
        <Card><CardBody><strong>The queue is empty.</strong></CardBody></Card>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {views.map(v => <QueueGroupCard key={v.groupKey} g={v} items={options} ai={ai} />)}
        </div>
      )}
    </div>
  )
}
