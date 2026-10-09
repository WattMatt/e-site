'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { createClient } from '@/lib/supabase/client'
import { getTenderUploadUrlAction } from '@/actions/tender.actions'
import {
  prepareInvitationsAction,
  readTenderListAction,
  regenerateInvitationLinkAction,
  revokeInvitationAction,
  sendTenderInvitationsAction,
  type Invitee,
  type InvitationRow,
} from '@/actions/tender-invite.actions'
import type { ParsedTenderList } from '@/lib/tender/parse-tender-list'

const statusVariant = (s: string) =>
  s === 'accepted' ? 'success' : s === 'sent' ? 'info' : s === 'revoked' || s === 'declined' ? 'danger' : 'ghost'

export function InvitationsPanel({
  tenderId,
  invitations,
  sendingEnabled,
  open,
}: {
  tenderId: string
  invitations: InvitationRow[]
  sendingEnabled: boolean
  open: boolean
}) {
  const router = useRouter()
  const [manual, setManual] = useState<Invitee>({ companyName: '', contactName: '', email: '', phone: '' })
  const [list, setList] = useState<ParsedTenderList | null>(null)
  const [picked, setPicked] = useState<Record<string, Invitee>>({})
  const [links, setLinks] = useState<{ email: string; link: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function prepare(invitees: Invitee[], source: 'manual' | 'tender_list') {
    setBusy(true)
    setMsg(null)
    try {
      const r = await prepareInvitationsAction(tenderId, invitees, source)
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      setLinks((l) => [...r.data.prepared.map((p) => ({ email: p.email, link: p.link })), ...l])
      const rej = r.data.rejected.map((x) => `${x.email}: ${x.reason}`).join('; ')
      setMsg({ ok: r.data.rejected.length === 0, text: `${r.data.prepared.length} prepared.${rej ? ` Not prepared: ${rej}` : ''}` })
      setPicked({})
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function readList(file: File) {
    setBusy(true)
    setMsg(null)
    try {
      const signed = await getTenderUploadUrlAction(tenderId, 'list', file.name)
      if ('error' in signed) return setMsg({ ok: false, text: signed.error })
      const { error } = await createClient().storage.from('tender-files').uploadToSignedUrl(signed.data.path, signed.data.token, file)
      if (error) return setMsg({ ok: false, text: 'Upload failed. Try again.' })
      const r = await readTenderListAction(tenderId, signed.data.path)
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      setList(r.data)
    } finally {
      setBusy(false)
    }
  }

  async function act(fn: () => Promise<{ data: unknown } | { error: string }>, after?: (d: unknown) => void) {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fn()
      if ('error' in r) return setMsg({ ok: false, text: r.error })
      after?.(r.data)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const togglePick = (key: string, inv: Invitee) =>
    setPicked((p) => {
      const n = { ...p }
      if (n[key]) delete n[key]
      else n[key] = inv
      return n
    })

  const pendingIds = invitations.filter((i) => i.status === 'prepared' || i.status === 'sent').map((i) => i.id)

  return (
    <Card>
      <CardHeader><span className="data-panel-title">Invited companies ({invitations.length})</span></CardHeader>
      <CardBody>
        <div style={{ display: 'grid', gap: 16 }}>
          {invitations.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
                <thead><tr><th style={{ textAlign: 'left' }}>Company</th><th>Contact</th><th>Email</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {invitations.map((i) => (
                    <tr key={i.id}>
                      <td>{i.company_name}</td>
                      <td>{i.contact_name ?? ''}</td>
                      <td>{i.email}</td>
                      <td><Badge variant={statusVariant(i.status)}>{i.status}</Badge></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {(i.status === 'prepared' || i.status === 'sent') && open && (
                          <>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => regenerateInvitationLinkAction(i.id), (d) => setLinks((l) => [{ email: i.email, link: (d as { link: string }).link }, ...l]))}>New link</Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => revokeInvitationAction(i.id))}>Withdraw</Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {links.length > 0 && (
            <div role="status" style={{ border: '1px solid var(--c-amber)', borderRadius: 8, padding: 12, fontSize: 13 }}>
              <strong>Links (shown once — copy them now; only a hash is stored)</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {links.map((l) => (
                  <li key={l.link} style={{ wordBreak: 'break-all' }}>
                    {l.email}: <code>{l.link}</code>{' '}
                    <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(l.link)}>Copy</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {open && (
            <>
              <div>
                <strong style={{ fontSize: 14 }}>Add a company</strong>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginTop: 6 }}>
                  <input placeholder="Company name" aria-label="Company name" value={manual.companyName} onChange={(e) => setManual({ ...manual, companyName: e.target.value })} />
                  <input placeholder="Contact person" aria-label="Contact person" value={manual.contactName ?? ''} onChange={(e) => setManual({ ...manual, contactName: e.target.value })} />
                  <input placeholder="Email" aria-label="Email" type="email" value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} />
                  <input placeholder="Phone" aria-label="Phone" value={manual.phone ?? ''} onChange={(e) => setManual({ ...manual, phone: e.target.value })} />
                  <Button disabled={busy || !manual.companyName || !manual.email} onClick={() => prepare([manual], 'manual').then(() => setManual({ companyName: '', contactName: '', email: '', phone: '' }))}>Prepare invitation</Button>
                </div>
              </div>

              <div>
                <strong style={{ fontSize: 14 }}>Or pick from a SUB-CONTRACTORS TENDER LIST workbook</strong>
                <div style={{ marginTop: 6 }}>
                  <input type="file" accept=".xlsx,.xlsm" aria-label="Tender list workbook" onChange={(e) => e.target.files?.[0] && readList(e.target.files[0])} />
                </div>
                {list && (
                  <div style={{ marginTop: 8, display: 'grid', gap: 8, fontSize: 13 }}>
                    {list.selected.length > 0 && (
                      <fieldset>
                        <legend>Tender list for this project</legend>
                        {list.selected.map((s) => {
                          const key = `sel-${s.number}`
                          return (
                            <label key={key} style={{ display: 'block' }}>
                              <input type="checkbox" disabled={s.emails.length === 0} checked={!!picked[key]} onChange={() => togglePick(key, { companyName: s.companyName, contactName: s.contactName, email: s.emails[0] ?? '', phone: s.phone })} />{' '}
                              {s.number}. {s.companyName} — {s.contactName ?? ''} {s.emails[0] ?? '(no email)'}
                            </label>
                          )
                        })}
                      </fieldset>
                    )}
                    {list.trades.map((t) => (
                      <details key={t.trade}>
                        <summary>{t.trade} ({t.companies.length})</summary>
                        {t.companies.map((c) => {
                          const key = `${t.trade}-${c.row}`
                          const contact = c.contacts.find((x) => x.emails.length > 0)
                          return (
                            <label key={key} style={{ display: 'block' }}>
                              <input type="checkbox" disabled={!contact} checked={!!picked[key]} onChange={() => contact && togglePick(key, { companyName: c.companyName, contactName: contact.name, email: contact.emails[0], phone: contact.phone })} />{' '}
                              {c.companyName} — {contact ? `${contact.name ?? ''} ${contact.emails[0]}` : '(no email)'}
                            </label>
                          )
                        })}
                      </details>
                    ))}
                    {list.problems.length > 0 && (
                      <details>
                        <summary>{list.problems.length} row(s) without a usable email</summary>
                        <ul>{list.problems.map((p) => <li key={`${p.sheet}-${p.row}`}>{p.sheet} row {p.row}: {p.company} — {p.problem}</li>)}</ul>
                      </details>
                    )}
                    <Button disabled={busy || Object.keys(picked).length === 0} onClick={() => prepare(Object.values(picked), 'tender_list')}>
                      Prepare {Object.keys(picked).length} invitation(s)
                    </Button>
                  </div>
                )}
              </div>

              <div style={{ fontSize: 13 }}>
                <Button variant="secondary" disabled={busy || !sendingEnabled || pendingIds.length === 0} onClick={() => act(() => sendTenderInvitationsAction(tenderId, pendingIds), (d) => setMsg({ ok: true, text: `${(d as { sent: number }).sent} sent.` }))}>
                  Email invitations
                </Button>{' '}
                {!sendingEnabled && <span>Emailing contractors is switched off until the owner turns it on. Copy each link instead.</span>}
              </div>
            </>
          )}

          {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ margin: 0, fontSize: 13, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</p>}
        </div>
      </CardBody>
    </Card>
  )
}
