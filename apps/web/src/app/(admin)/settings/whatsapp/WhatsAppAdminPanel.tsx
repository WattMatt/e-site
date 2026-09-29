// apps/web/src/app/(admin)/settings/whatsapp/WhatsAppAdminPanel.tsx
'use client'
import { useState, useTransition } from 'react'
import { setWhatsAppAlertEmailAction, setWhatsAppSendingAction } from '@/actions/whatsapp-admin.actions'

interface Props {
  sendingEnabled: boolean
  alertEmail: string
  lastPolicyError: string | null
  links: Array<{ name: string; phone: string; status: string; reason: string | null }>
  staleOptins: number
  outbound7d: Array<[string, number]>
  templateMessages7d: number
  inbound7d: Array<[string, number]>
  templates: Array<{ name: string; category: string; status: string }>
}

export function WhatsAppAdminPanel(p: Props) {
  const [enabled, setEnabled] = useState(p.sendingEnabled)
  const [email, setEmail] = useState(p.alertEmail)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const section: React.CSSProperties = { border: '1px solid var(--c-border)', borderRadius: 8, padding: 16, marginBottom: 16 }

  return (
    <div>
      {p.lastPolicyError && <div style={{ ...section, borderColor: 'var(--c-red)', color: 'var(--c-red)', fontSize: 12 }}>Last Meta policy error — {p.lastPolicyError}</div>}
      <div style={section}>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={enabled} disabled={pending} onChange={(e) => {
            const v = e.target.checked; setEnabled(v)
            start(async () => { const r = await setWhatsAppSendingAction({ enabled: v }); if ('error' in r) { setEnabled(!v); setMsg(r.error) } })
          }} />
          Sending enabled (platform-wide). Off stops every outbound message within a minute.
        </label>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, fontSize: 12, alignItems: 'center' }}>
          <label htmlFor="wa-alert">Alert email</label>
          <input id="wa-alert" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="button" disabled={pending} onClick={() => start(async () => { const r = await setWhatsAppAlertEmailAction({ email }); setMsg('error' in r ? r.error : 'Saved.') })}>Save</button>
        </div>
        {msg && <p style={{ fontSize: 12 }}>{msg}</p>}
      </div>
      <div style={section}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Last 7 days</h2>
        <p style={{ fontSize: 12 }}>Template messages delivered (the billable count): <strong>{p.templateMessages7d}</strong></p>
        <p style={{ fontSize: 12 }}>Outbound by status: {p.outbound7d.map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'}</p>
        <p style={{ fontSize: 12 }}>Inbound by outcome: {p.inbound7d.map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'}</p>
        <p style={{ fontSize: 12 }}>Opt-ins waiting more than 48 h: <strong>{p.staleOptins}</strong></p>
      </div>
      <div style={section}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Linked numbers</h2>
        <table style={{ width: '100%', fontSize: 12 }}><tbody>
          {p.links.map((l, i) => <tr key={i}><td>{l.name}</td><td>{l.phone}</td><td>{l.status}</td><td>{l.reason ?? ''}</td></tr>)}
        </tbody></table>
      </div>
      <div style={section}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Templates</h2>
        <table style={{ width: '100%', fontSize: 12 }}><tbody>
          {p.templates.map((t) => <tr key={t.name}><td>{t.name}</td><td>{t.category}</td><td>{t.status}</td></tr>)}
        </tbody></table>
      </div>
    </div>
  )
}
