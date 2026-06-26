'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { signOutOthersAction, signOutEverywhereAction, type ActiveSession } from '@/actions/security.actions'

function formatRelative(iso: string): string {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)} hr ago`
  return `${Math.floor(secs / 86400)} d ago`
}

function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device'
  const lower = ua.toLowerCase()
  let device = 'Browser'
  if (/iphone|ipad|ipod/.test(lower)) device = 'iOS'
  else if (/android/.test(lower)) device = 'Android'
  else if (/macintosh|mac os/.test(lower)) device = 'Mac'
  else if (/windows/.test(lower)) device = 'Windows'
  else if (/linux/.test(lower)) device = 'Linux'

  let app = 'browser'
  if (/expo|esite-mobile|reactnative/.test(lower)) app = 'mobile app'
  else if (/chrome\//.test(lower)) app = 'Chrome'
  else if (/safari\//.test(lower)) app = 'Safari'
  else if (/firefox\//.test(lower)) app = 'Firefox'
  return `${device} · ${app}`
}

export function SessionList({ sessions }: { sessions: ActiveSession[] }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onOthers() {
    setError(null)
    startTransition(async () => {
      const r = await signOutOthersAction()
      if (r.ok) router.refresh()
      else setError(r.error ?? 'Could not sign out other sessions.')
    })
  }

  function onAll() {
    setError(null)
    if (!confirm('Sign out of EVERY device, including this one?')) return
    startTransition(async () => {
      const r = await signOutEverywhereAction()
      if (r.ok) router.replace('/login')
      else setError(r.error ?? 'Could not sign out everywhere.')
    })
  }

  if (sessions.length === 0) {
    return (
      <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
        No active sessions found. (You may need to refresh.)
      </p>
    )
  }

  return (
    <div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sessions.map((s) => (
          <li
            key={s.id}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 12px',
              border: '1px solid var(--c-border)', borderRadius: 6,
              background: s.isCurrent ? 'var(--c-amber-dim)' : 'transparent',
            }}
          >
            <div>
              <div style={{ fontSize: 13, color: 'var(--c-text)', fontWeight: 600 }}>
                {describeUserAgent(s.user_agent)}
                {s.isCurrent && (
                  <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', background: 'var(--c-amber)', color: 'var(--c-bg)', borderRadius: 3, fontFamily: 'var(--font-mono)' }}>
                    THIS DEVICE
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 2 }}>
                {s.ip ?? 'Unknown IP'} · {formatRelative(s.updated_at ?? s.created_at)}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {error && <p style={{ color: 'var(--c-red)', fontSize: 12, marginTop: 12 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <Button type="button" size="sm" variant="secondary" isLoading={pending} onClick={onOthers}>
          Sign out everywhere else
        </Button>
        <Button type="button" size="sm" variant="danger" isLoading={pending} onClick={onAll}>
          Sign out everywhere (incl. this device)
        </Button>
      </div>
    </div>
  )
}
