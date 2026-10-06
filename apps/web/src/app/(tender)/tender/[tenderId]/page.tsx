import Link from 'next/link'
import { notFound } from 'next/navigation'
import { portalTenderAction } from '@/actions/tender-portal.actions'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ProfileForm } from '../../_components/ProfileForm'

export const dynamic = 'force-dynamic'

const money = (n: number) => `R ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`

export default async function TenderPortalPage({ params }: { params: Promise<{ tenderId: string }> }) {
  const { tenderId } = await params
  const res = await portalTenderAction(tenderId)
  if ('error' in res) {
    if (res.error === 'Tender not found') notFound()
    return <p role="alert">{res.error}</p>
  }
  const { tender, items, requirements, profile } = res.data
  const sheets = Array.from(new Set(items.map((i) => i.sheet_name)))

  return (
    <>
      <div>
        <Link href="/tender" style={{ fontSize: 13 }}>← Your tenders</Link>
        <h1 style={{ margin: '4px 0', fontSize: 22 }}>{tender.package} — {tender.title}</h1>
        <div style={{ fontSize: 14 }}>
          {tender.project_name}{tender.organisation_name ? ` · issued by ${tender.organisation_name}` : ''} · {tender.status}
          {tender.closing_at && ` · closes ${new Date(tender.closing_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'full', timeStyle: 'short' })}`}
        </div>
      </div>

      <Card>
        <CardHeader><span className="data-panel-title">1. Company details</span></CardHeader>
        <CardBody>
          <ProfileForm tenderId={tender.id} initial={profile} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><span className="data-panel-title">2. Documents requested</span></CardHeader>
        <CardBody>
          {requirements.length === 0 ? (
            <p style={{ margin: 0 }}>No documents have been listed yet.</p>
          ) : (
            <ul style={{ margin: 0 }}>
              {requirements.map((r) => (
                <li key={r.id}>{r.label}{r.mandatory ? ' (required)' : ' (optional)'}{r.detail ? ` — ${r.detail}` : ''}</li>
              ))}
            </ul>
          )}
          <p style={{ fontSize: 13, color: 'var(--c-text-muted)', marginBottom: 0 }}>Uploading opens with pricing in the next release.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><span className="data-panel-title">3. Bill of quantities ({items.filter((i) => i.kind === 'item').length} items)</span></CardHeader>
        <CardBody>
          <p style={{ marginTop: 0, fontSize: 13, color: 'var(--c-text-muted)' }}>
            The BOQ as issued. Descriptions, units and quantities are fixed. Online pricing and the Excel upload open in the next release.
          </p>
          {sheets.map((s) => (
            <details key={s} open={sheets.length === 1}>
              <summary style={{ fontWeight: 600, cursor: 'pointer' }}>{s}</summary>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
                  <thead><tr><th>Item</th><th style={{ textAlign: 'left' }}>Description</th><th>Unit</th><th>Qty</th><th>Pricing</th></tr></thead>
                  <tbody>
                    {items.filter((i) => i.sheet_name === s && i.kind !== 'total').map((i) => (
                      <tr key={i.id}>
                        <td style={{ fontWeight: i.kind === 'heading' ? 600 : 400 }}>{i.code ?? ''}</td>
                        <td style={{ fontWeight: i.kind === 'heading' ? 600 : 400, fontStyle: i.kind === 'note' ? 'italic' : 'normal' }}>{i.description}</td>
                        <td>{i.unit ?? ''}</td>
                        <td style={{ textAlign: 'right' }}>{i.quantity ?? ''}</td>
                        <td>
                          {i.rate_cell_type === 'fixed' && (i.fixed_amount != null ? `Fixed ${money(Number(i.fixed_amount))}` : 'Fixed sum')}
                          {i.rate_cell_type === 'rate_only' && 'Rate only'}
                          {i.rate_cell_type === 'not_priced' && 'Optional'}
                          {i.rate_cell_type === 'priced' && 'Rate'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </CardBody>
      </Card>
    </>
  )
}
