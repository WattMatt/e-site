import Link from 'next/link'
import { COST_VIEW_ROLES } from '@esite/shared'
import { requireRolePage } from '@/lib/auth/require-role'
import { createClient } from '@/lib/supabase/server'
import { Card, CardBody } from '@/components/ui/Card'
import { loadLibrary, logRateAccess, type AnyClient, type LibraryFilters } from '@/lib/rate-library/data'
import { qs, zar } from '@/lib/rate-library/format'
import { RatesNav } from './_components/RatesNav'

export const dynamic = 'force-dynamic'

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined
const ISO = /^\d{4}-\d{2}-\d{2}$/

export default async function RateLibraryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireRolePage(COST_VIEW_ROLES)
  const sp = await searchParams
  const f: LibraryFilters = {
    q: one(sp.q), category: one(sp.category), province: one(sp.province), contractor: one(sp.contractor),
    from: one(sp.from) && ISO.test(one(sp.from)!) ? one(sp.from) : undefined,
    to: one(sp.to) && ISO.test(one(sp.to)!) ? one(sp.to) : undefined,
  }
  const basis = one(sp.basis) === 'nominal' ? 'nominal' : 'escalated'
  const db = (await createClient()) as AnyClient
  const [lib, queued] = await Promise.all([
    loadLibrary(db, ctx.organisationId, f),
    db.from('rate_source_lines').select('id', { count: 'exact', head: true })
      .eq('organisation_id', ctx.organisationId).in('match_status', ['suggested', 'unmatched', 'rejected']),
  ])
  await logRateAccess(db, ctx.organisationId, 'view_library', null, { filters: f })
  const filterQs = { q: f.q, category: f.category, province: f.province, contractor: f.contractor, from: f.from, to: f.to }

  const th = { padding: 8, textAlign: 'left' as const, fontWeight: 600, whiteSpace: 'nowrap' as const }
  const td = { padding: 8, verticalAlign: 'top' as const }
  const num = { ...td, textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const, whiteSpace: 'nowrap' as const }
  const input = { padding: '6px 8px', border: '1px solid var(--c-border)', borderRadius: 6, background: 'var(--c-base)', color: 'inherit', minWidth: 0 }

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16 }}>
      <RatesNav active="/rates" queued={queued.count ?? 0} />

      <Card>
        <CardBody>
          <form method="get" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: 4 }}>Search<input name="q" defaultValue={f.q} placeholder="e.g. 95 mm² cable" style={input} /></label>
            <label style={{ display: 'grid', gap: 4 }}>Category
              <select name="category" defaultValue={f.category ?? ''} style={input}>
                <option value="">All</option>{lib.facets.categories.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4 }}>Province
              <select name="province" defaultValue={f.province ?? ''} style={input}>
                <option value="">All</option>{lib.facets.provinces.map(p => <option key={p}>{p}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4 }}>Contractor
              <select name="contractor" defaultValue={f.contractor ?? ''} style={input}>
                <option value="">All</option>{lib.facets.contractors.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4 }}>Priced from<input type="date" name="from" defaultValue={f.from} style={input} /></label>
            <label style={{ display: 'grid', gap: 4 }}>Priced to<input type="date" name="to" defaultValue={f.to} style={input} /></label>
            <label style={{ display: 'grid', gap: 4 }}>Show
              <select name="basis" defaultValue={basis} style={input}>
                <option value="escalated">Today&apos;s money (CPI)</option><option value="nominal">As priced</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="submit" style={{ ...input, cursor: 'pointer', fontWeight: 600 }}>Apply</button>
              <Link href="/rates" style={{ alignSelf: 'center' }}>Clear</Link>
            </div>
          </form>
        </CardBody>
      </Card>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ margin: 0, color: 'var(--c-text-dim)' }}>
          {lib.summaries.length} item(s). {basis === 'escalated'
            ? `Rates escalated to ${lib.cpiLatest ?? 'the latest month'} with the Stats SA CPI headline index (Dec 2024 = 100).`
            : 'Rates as priced, without escalation.'} ZAR excl. VAT.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a href={`/api/rates/export${qs({ ...filterQs, stat: 'median' })}`}>Export budget CSV (median)</a>
          <a href={`/api/rates/export${qs({ ...filterQs, stat: 'p75' })}`}>Export (P75)</a>
        </div>
      </div>

      {lib.summaries.length === 0 ? (
        <Card><CardBody>
          <strong>No rates match.</strong>
          <p style={{ color: 'var(--c-text-dim)', marginTop: 6 }}>
            Rates arrive when a priced BOQ is added to the library: from a project&apos;s Rates tab (&ldquo;Add this BOQ to the rate
            library&rdquo;) or by the historical backfill. Lines the matcher cannot name wait in the review queue.
          </p>
        </CardBody></Card>
      ) : (
        <Card>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                <th style={th}>Item</th><th style={th}>Unit</th><th style={{ ...th, textAlign: 'right' }}>n</th>
                <th style={{ ...th, textAlign: 'right' }}>Min</th><th style={{ ...th, textAlign: 'right' }}>Median</th>
                <th style={{ ...th, textAlign: 'right' }}>P75</th><th style={{ ...th, textAlign: 'right' }}>Max</th>
                <th style={{ ...th, textAlign: 'right' }}>Latest</th><th style={th}>Contractors</th>
              </tr></thead>
              <tbody>
                {lib.summaries.map(s => {
                  const st = basis === 'escalated' ? s.escalated : s.nominal
                  return (
                    <tr key={s.item.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                      <td style={td}>
                        <Link href={`/rates/${s.item.id}${qs({ ...filterQs, basis })}`}>{s.item.description}</Link>
                        <div style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>{s.item.code}</div>
                      </td>
                      <td style={td}>{s.item.unit}</td>
                      <td style={num}>{s.nominal.n}</td>
                      <td style={num}>{zar(st.min)}</td><td style={num}><strong>{zar(st.median)}</strong></td>
                      <td style={num}>{zar(st.p75)}</td><td style={num}>{zar(st.max)}</td>
                      <td style={num}>{zar(st.latest?.rate)}<div style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>{st.latest?.pricedOn ?? ''}</div></td>
                      <td style={td}>{s.contractors}{s.provinces.length ? <div style={{ color: 'var(--c-text-dim)', fontSize: 12 }}>{s.provinces.join(', ')}</div> : null}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
