import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { loadAdjudication } from '@/lib/tender/load-adjudication'
import { formatRand } from '../../_components/format'
import { AdjudicationActions } from '../../_components/AdjudicationActions'

export const dynamic = 'force-dynamic'

export default async function AdjudicationPage({ params }: { params: Promise<{ id: string; tenderId: string }> }) {
  const { id, tenderId } = await params
  const supabase = await createClient()
  const guard = await requireEffectiveRole(supabase, id, ORG_WRITE_ROLES)
  if (!guard.ok) redirect(`/projects/${id}`)
  const res = await loadAdjudication(tenderId)
  if (!res.ok) {
    return (
      <div style={{ display: 'grid', gap: 12 }}>
        <Link href={`/projects/${id}/tenders/${tenderId}`} style={{ fontSize: 13 }}>← Tender</Link>
        <p role="alert">{res.error}</p>
      </div>
    )
  }
  const { adjudication: a, tender, draftsAtClosing } = res.data
  if (tender.project_id !== id) redirect(`/projects/${id}/tenders`)
  const bidders = a.totals

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <Link href={`/projects/${id}/tenders/${tenderId}`} style={{ fontSize: 13 }}>← Tender</Link>
        <h1 className="page-title" style={{ marginTop: 4 }}>Adjudication — {tender.package}: {tender.title}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <Badge variant="info">{tender.status}</Badge>
          <a className="btn btn-sm" href={`/api/tenders/${tenderId}/adjudication`}>Download adjudication (Excel)</a>
          <AdjudicationActions tenderId={tenderId} status={tender.status} />
        </div>
        {draftsAtClosing.length > 0 && (
          <p style={{ fontSize: 13 }}>Not submitted by the closing time (excluded): {draftsAtClosing.join(', ')}.</p>
        )}
      </div>

      <Card>
        <CardHeader><span className="data-panel-title">Ranked bids ({bidders.length})</span></CardHeader>
        <CardBody>
          {bidders.length === 0 ? <p style={{ margin: 0 }}>No bid was submitted.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr><th>Rank</th><th style={{ textAlign: 'left' }}>Company</th><th>Total excl. VAT</th><th>vs estimate</th>{a.bills.map((b) => <th key={b}>Bill {b}</th>)}<th>Flags</th></tr>
                </thead>
                <tbody>
                  {bidders.map((t) => (
                    <tr key={t.participantId}>
                      <td>{t.rank}</td>
                      <td>{t.company}</td>
                      <td style={{ textAlign: 'right' }}>{formatRand(t.total)}</td>
                      <td style={{ textAlign: 'right' }}>{t.vsEstimatePct == null ? '—' : `${t.vsEstimatePct > 0 ? '+' : ''}${t.vsEstimatePct} %`}</td>
                      {a.bills.map((b) => <td key={b} style={{ textAlign: 'right' }}>{formatRand(t.byBill[b] ?? 0)}</td>)}
                      <td style={{ fontSize: 12 }}>
                        {t.flags.high} high · {t.flags.low} low · {t.flags.zero} zero · {t.flags.unpriced} unpriced
                      </td>
                    </tr>
                  ))}
                  {a.estimateTotal != null && (
                    <tr style={{ fontStyle: 'italic' }}>
                      <td /><td>WM estimate</td><td style={{ textAlign: 'right' }}>{formatRand(a.estimateTotal)}</td><td />
                      {a.bills.map((b) => <td key={b} style={{ textAlign: 'right' }}>{formatRand(a.estimateByBill[b] ?? 0)}</td>)}
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><span className="data-panel-title">Documents and declarations</span></CardHeader>
        <CardBody>
          {a.checklist.length === 0 ? <p style={{ margin: 0 }}>None were requested.</p> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
                <thead><tr><th style={{ textAlign: 'left' }}>Requirement</th>{bidders.map((t) => <th key={t.participantId}>{t.company}</th>)}</tr></thead>
                <tbody>
                  {a.checklist.map((c) => (
                    <tr key={c.requirement.id}>
                      <td>{c.requirement.label}{c.requirement.mandatory ? '' : ' (optional)'}</td>
                      {bidders.map((t) => {
                        const x = c.byBidder[t.participantId]
                        return <td key={t.participantId}>{x?.ok ? <Badge variant="success">✓</Badge> : <Badge variant="danger">missing</Badge>} <span style={{ fontSize: 11 }}>{x?.ok ? x.detail : ''}</span></td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><span className="data-panel-title">Item comparison (outliers more than {Math.round(a.threshold * 100)} % from the median are marked)</span></CardHeader>
        <CardBody>
          <div style={{ overflowX: 'auto', maxHeight: 640 }}>
            <table className="data-table" style={{ width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  <th>Item</th><th style={{ textAlign: 'left' }}>Description</th><th>Qty</th><th>Estimate</th><th>Median</th>
                  {bidders.map((t) => <th key={t.participantId}>{t.company}</th>)}
                </tr>
              </thead>
              <tbody>
                {a.rows.map((r) => (
                  <tr key={r.item.id}>
                    <td>{r.item.code ?? ''}</td>
                    <td>{r.item.description}</td>
                    <td style={{ textAlign: 'right' }}>{r.item.quantity ?? ''}</td>
                    <td style={{ textAlign: 'right' }}>{r.item.rate_cell_type === 'fixed' ? 'fixed' : r.estimate?.rate ?? ''}</td>
                    <td style={{ textAlign: 'right' }}>{r.medianRate ?? ''}</td>
                    {bidders.map((t) => {
                      const c = r.bids[t.participantId]
                      const bg = c.flag === 'high' ? 'var(--c-red-dim)' : c.flag === 'low' || c.flag === 'zero' ? 'var(--c-amber-dim, #fff4cc)' : undefined
                      return (
                        <td key={t.participantId} style={{ textAlign: 'right', background: bg }} title={c.flag ?? undefined}>
                          {r.item.rate_cell_type === 'fixed' ? formatRand(c.amount) : c.rate == null ? (c.flag === 'not_priced' ? 'n/p' : '—') : c.rate}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
