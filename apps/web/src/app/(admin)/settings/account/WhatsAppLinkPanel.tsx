// apps/web/src/app/(admin)/settings/account/WhatsAppLinkPanel.tsx
'use client'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { maskPhone } from '@esite/shared'
import {
  getWhatsAppLinkStatusAction, removeWhatsAppLinkAction, requestWhatsAppCodeAction, setWhatsAppQuietHoursAction,
} from '@/actions/whatsapp-link.actions'

export interface LinkView {
  status: string
  phone_e164: string
  quiet_start: string
  quiet_end: string
  undeliverable_reason: string | null
}

interface Waiting { masked: string; message: string; waNumber: string | null; expiresAt: string }

const CONSENT =
  'By linking, you agree that E-Site may send you WhatsApp messages about site items assigned to you, ' +
  'and that your replies, photos and notes sent to E-Site on WhatsApp are recorded against those items. ' +
  'Reply STOP at any time to stop.'

const POLL_MS = 4000

const input: React.CSSProperties = { padding: '7px 10px', fontSize: 13, border: '1px solid var(--c-border)', borderRadius: 6, background: 'var(--c-panel)', color: 'var(--c-text)' }
const btn: React.CSSProperties = { padding: '7px 14px', fontSize: 13, borderRadius: 6, border: '1px solid var(--c-border)', background: 'var(--c-amber)', color: '#111', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' }

export function WhatsAppLinkPanel({ link }: { link: LinkView | null }) {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [waiting, setWaiting] = useState<Waiting | null>(null)
  const [linked, setLinked] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [quiet, setQuiet] = useState({ start: link?.quiet_start.slice(0, 5) ?? '18:00', end: link?.quiet_end.slice(0, 5) ?? '06:30' })
  const [pending, start] = useTransition()

  // While waiting, poll until the webhook activates the link (the code arrived FROM the phone).
  useEffect(() => {
    if (!waiting || linked) return
    const t = setInterval(async () => {
      const r = await getWhatsAppLinkStatusAction()
      if ('status' in r && r.status === 'active') {
        setLinked(true)
        router.refresh()
      }
    }, POLL_MS)
    return () => clearInterval(t)
  }, [waiting, linked, router])

  const run = (fn: () => Promise<{ ok?: true; error?: string }>) =>
    start(async () => {
      const r = await fn()
      setMsg('error' in r && r.error ? r.error : null)
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

  if (linked) {
    return <p style={{ fontSize: 13, color: 'var(--c-green)' }}>✅ Linked. Site items will now arrive on WhatsApp.</p>
  }

  if (waiting) {
    const href = waiting.waNumber ? `https://wa.me/${waiting.waNumber}?text=${encodeURIComponent(waiting.message)}` : null
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 13, margin: 0 }}>
          From WhatsApp on <strong>{waiting.masked}</strong>, send this message to E-Site:
        </p>
        <code style={{ fontSize: 20, fontWeight: 600, letterSpacing: 1, padding: '8px 12px', border: '1px dashed var(--c-border)', borderRadius: 6, alignSelf: 'flex-start' }}>
          {waiting.message}
        </code>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" style={btn}>Open WhatsApp with this message</a>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0 }}>Send it to the E-Site WhatsApp number.</p>
        )}
        <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0 }}>
          Waiting for it to arrive… this page updates by itself. The code expires at{' '}
          {new Date(waiting.expiresAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}.
        </p>
        <div>
          <button type="button" style={{ ...btn, background: 'transparent' }} onClick={() => setWaiting(null)}>Use a different number</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{CONSENT}</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label htmlFor="wa-phone" style={{ fontSize: 12 }}>Mobile number</label>
        <input id="wa-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="082 123 4567" style={input} />
        <button type="button" disabled={pending || !phone} style={btn}
          onClick={() => start(async () => {
            const r = await requestWhatsAppCodeAction({ phone })
            if ('error' in r) { setMsg(r.error); return }
            setMsg(null)
            setWaiting({ masked: r.masked, message: r.message, waNumber: r.waNumber, expiresAt: r.expiresAt })
          })}>Get my link code</button>
      </div>
      {msg && <p style={{ fontSize: 12, color: 'var(--c-red)' }}>{msg}</p>}
    </div>
  )
}
