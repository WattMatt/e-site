'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { updateTenderDetailsAction, type TenderDetailsInput } from '@/actions/tender-documents.actions'

export interface TenderParticulars {
  reference: string | null
  description: string | null
  site_inspection: string | null
  queries_close_at: string | null
  validity_days: number | null
  contact_name: string | null
  contact_email: string | null
}

const za = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'full', timeStyle: 'short' }) : ''
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')

/**
 * The tender's particulars: what a bidder reads beside the BOQ. Editable while
 * the tender is a draft; the database freezes them at issue (an issued change
 * goes out as an addendum).
 */
export function DetailsPanel({ tenderId, particulars, isDraft }: { tenderId: string; particulars: TenderParticulars; isDraft: boolean }) {
  const router = useRouter()
  const [d, setD] = useState({
    reference: particulars.reference ?? '',
    description: particulars.description ?? '',
    siteInspection: particulars.site_inspection ?? '',
    queriesCloseLocal: toLocal(particulars.queries_close_at),
    validityDays: particulars.validity_days == null ? '' : String(particulars.validity_days),
    contactName: particulars.contact_name ?? '',
    contactEmail: particulars.contact_email ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const validity = d.validityDays.trim() === '' ? null : Number(d.validityDays)
      const input: TenderDetailsInput = {
        reference: d.reference,
        description: d.description,
        siteInspection: d.siteInspection,
        queriesCloseAt: d.queriesCloseLocal ? new Date(d.queriesCloseLocal).toISOString() : null,
        validityDays: validity != null && Number.isFinite(validity) ? validity : null,
        contactName: d.contactName,
        contactEmail: d.contactEmail,
      }
      const r = await updateTenderDetailsAction(tenderId, input)
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      setMsg({ ok: true, text: 'Saved.' })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (!isDraft) {
    const rows: [string, string][] = [
      ['Tender reference', particulars.reference ?? '—'],
      ['Scope of work', particulars.description ?? '—'],
      ['Site inspection', particulars.site_inspection ?? '—'],
      ['Queries by', particulars.queries_close_at ? za(particulars.queries_close_at) : '—'],
      ['Validity of offers', particulars.validity_days ? `${particulars.validity_days} days after closing` : '—'],
      ['Queries contact', [particulars.contact_name, particulars.contact_email].filter(Boolean).join(' · ') || '—'],
    ]
    return (
      <Card>
        <CardHeader><span className="data-panel-title">Tender particulars</span></CardHeader>
        <CardBody>
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px', margin: 0, fontSize: 14 }}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt style={{ fontWeight: 600 }}>{k}</dt>
                <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{v}</dd>
              </div>
            ))}
          </dl>
          <p style={{ fontSize: 12, margin: '8px 0 0', color: 'var(--c-text-muted)' }}>Frozen since the tender was issued. Changes go out as an addendum.</p>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><span className="data-panel-title">Tender particulars</span></CardHeader>
      <CardBody>
        <p style={{ marginTop: 0, fontSize: 13 }}>
          What a bidder reads beside the BOQ: shown on the portal and frozen when the tender is issued.
        </p>
        <div style={{ display: 'grid', gap: 8, maxWidth: 720 }}>
          <label style={{ fontSize: 13 }}>Tender reference (your tender number)
            <input value={d.reference} onChange={(e) => setD({ ...d, reference: e.target.value })} placeholder="e.g. WM-2026-SAXBY-E01" style={{ width: '100%' }} />
          </label>
          <label style={{ fontSize: 13 }}>Scope of work
            <textarea rows={3} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="A short description of the works being tendered." style={{ width: '100%' }} />
          </label>
          <label style={{ fontSize: 13 }}>Site inspection
            <textarea rows={2} value={d.siteInspection} onChange={(e) => setD({ ...d, siteInspection: e.target.value })} placeholder="Date, venue and whether attendance is compulsory. Leave blank if none." style={{ width: '100%' }} />
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13 }}>Queries by
              <input type="datetime-local" value={d.queriesCloseLocal} onChange={(e) => setD({ ...d, queriesCloseLocal: e.target.value })} />
            </label>
            <label style={{ fontSize: 13 }}>Offers stay open for (days)
              <input type="number" min={1} max={365} value={d.validityDays} onChange={(e) => setD({ ...d, validityDays: e.target.value })} style={{ width: 90 }} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13 }}>Queries contact
              <input value={d.contactName} onChange={(e) => setD({ ...d, contactName: e.target.value })} placeholder="Name" />
            </label>
            <label style={{ fontSize: 13 }}>Contact email
              <input type="email" value={d.contactEmail} onChange={(e) => setD({ ...d, contactEmail: e.target.value })} placeholder="name@company.co.za" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button size="sm" isLoading={busy} onClick={save}>Save particulars</Button>
            {msg && <span role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</span>}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
