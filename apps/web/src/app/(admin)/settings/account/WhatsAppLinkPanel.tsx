// apps/web/src/app/(admin)/settings/account/WhatsAppLinkPanel.tsx
'use client'
import { useState, useTransition } from 'react'
import { maskPhone } from '@esite/shared'
import {
  confirmWhatsAppCodeAction, removeWhatsAppLinkAction, requestWhatsAppCodeAction, setWhatsAppQuietHoursAction,
} from '@/actions/whatsapp-link.actions'

export interface LinkView {
  status: string
  phone_e164: string
  quiet_start: string
  quiet_end: string
  undeliverable_reason: string | null
}

const CONSENT =
  'By linking, you agree that E-Site may send you WhatsApp messages about site items assigned to you, ' +
  'and that your replies, photos and notes sent to E-Site on WhatsApp are recorded against those items. ' +
  'Reply STOP at any time to stop.'

const input: React.CSSProperties = { padding: '7px 10px', fontSize: 13, border: '1px solid var(--c-border)', borderRadius: 6, background: 'var(--c-panel)', color: 'var(--c-text)' }
const btn: React.CSSProperties = { padding: '7px 14px', fontSize: 13, borderRadius: 6, border: '1px solid var(--c-border)', background: 'var(--c-amber)', color: '#111', cursor: 'pointer' }

export function WhatsAppLinkPanel({ link }: { link: LinkView | null }) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [quiet, setQuiet] = useState({ start: link?.quiet_start.slice(0, 5) ?? '18:00', end: link?.quiet_end.slice(0, 5) ?? '06:30' })
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<{ ok?: true; masked?: string; error?: string }>, after?: (r: { masked?: string }) => void) =>
    start(async () => {
      const r = await fn()
      if ('error' in r && r.error) setMsg(r.error)
      else { setMsg(null); after?.(r) }
    })

  if (link && (link.status === 'active' || link.status === 'undeliverable')) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13 }}>Linked number: <strong>{maskPhone(link.phone_e164)}</strong></div>
        {link.status === 'undeliverable' && (
          <p style={{ fontSize: 12, color: 'var(--c-red)' }}>
            We couldn&apos;t deliver to this number ({link.undeliverable_reason}). Check WhatsApp is installed on it, then remove and link it again.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <label htmlFor="wa-qs">Quiet from</label>
          <input id="wa-qs" type="time" value={quiet.start} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })} style={input} />
          <label htmlFor="wa-qe">until</label>
          <input id="wa-qe" type="time" value={quiet.end} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })} style={input} />
          <button type="button" disabled={pending} style={btn} onClick={() => run(() => setWhatsAppQuietHoursAction(quiet))}>Save</button>
        </div>
        <div>
          <button type="button" disabled={pending} style={{ ...btn, background: 'transparent' }}
            onClick={() => run(() => removeWhatsAppLinkAction())}>Remove</button>
        </div>
        {msg && <p style={{ fontSize: 12, color: 'var(--c-red)' }}>{msg}</p>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{CONSENT}</p>
      {!sentTo ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label htmlFor="wa-phone" style={{ fontSize: 12 }}>Mobile number</label>
          <input id="wa-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="082 123 4567" style={input} />
          <button type="button" disabled={pending || !phone} style={btn}
            onClick={() => run(() => requestWhatsAppCodeAction({ phone }), (r) => setSentTo(r.masked ?? phone))}>Send code</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12 }}>We sent a code on WhatsApp to {sentTo}.</span>
          <label htmlFor="wa-code" style={{ fontSize: 12 }}>6-digit code</label>
          <input id="wa-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} style={{ ...input, width: 90 }} />
          <button type="button" disabled={pending || code.length !== 6} style={btn}
            onClick={() => run(() => confirmWhatsAppCodeAction({ code }), () => setMsg('Linked. Refresh to see your settings.'))}>Confirm</button>
        </div>
      )}
      {msg && <p style={{ fontSize: 12, color: msg.startsWith('Linked') ? 'var(--c-green)' : 'var(--c-red)' }}>{msg}</p>}
    </div>
  )
}
