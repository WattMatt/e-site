'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'

interface Details {
  clientName: string
  redirectUri: string
  scopes: string[]
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; details: Details }
  | { kind: 'redirecting' }
  | { kind: 'error'; message: string }

const BUTTON_BASE = {
  minHeight: 44,
  padding: '0 18px',
  borderRadius: 6,
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
  cursor: 'pointer',
} as const

export default function ConsentClient({ authorizationId }: { authorizationId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error } = await createClient().auth.oauth.getAuthorizationDetails(authorizationId)
      if (cancelled) return
      if (error || !data) {
        setPhase({ kind: 'error', message: error?.message ?? 'This authorization request could not be loaded.' })
        return
      }
      // The user already consented to this client: Supabase hands back the
      // redirect straight away, so there is nothing to ask.
      if (!('authorization_id' in data)) {
        setPhase({ kind: 'redirecting' })
        window.location.assign(data.redirect_url)
        return
      }
      setPhase({
        kind: 'ready',
        details: {
          clientName: data.client.name,
          redirectUri: data.redirect_uri,
          scopes: data.scope.split(/\s+/).filter(Boolean),
        },
      })
    }
    load().catch((e: unknown) => {
      if (!cancelled) setPhase({ kind: 'error', message: e instanceof Error ? e.message : 'This authorization request could not be loaded.' })
    })
    return () => {
      cancelled = true
    }
  }, [authorizationId])

  async function decide(decision: 'approve' | 'deny') {
    setBusy(true)
    setActionError(null)
    try {
      const oauth = createClient().auth.oauth
      const { data, error } =
        decision === 'approve'
          ? await oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
          : await oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true })
      if (error || !data) {
        setActionError(error?.message ?? 'Something went wrong. Please try again.')
        setBusy(false)
        return
      }
      setPhase({ kind: 'redirecting' })
      window.location.assign(data.redirect_url)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'var(--c-base)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 480 }}>
        <Card>
          <CardHeader>
            <h1 style={{ margin: 0, fontSize: 18, color: 'var(--c-text)' }}>Connect to E-Site</h1>
          </CardHeader>
          <CardBody>
            {phase.kind === 'loading' && <p style={{ margin: 0, color: 'var(--c-text-mid)' }}>Loading request…</p>}
            {phase.kind === 'redirecting' && <p style={{ margin: 0, color: 'var(--c-text-mid)' }}>Returning you to the app…</p>}
            {phase.kind === 'error' && (
              <p role="alert" style={{ margin: 0, color: 'var(--c-red)' }}>
                {phase.message}
              </p>
            )}
            {phase.kind === 'ready' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>Application</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-text)', overflowWrap: 'anywhere' }}>
                    {phase.details.clientName}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>Returns to</div>
                  <div style={{ fontSize: 13, color: 'var(--c-text)', overflowWrap: 'anywhere' }}>{phase.details.redirectUri}</div>
                </div>
                {phase.details.scopes.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>Requested scopes</div>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--c-text)' }}>
                      {phase.details.scopes.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p style={{ margin: 0, fontSize: 14, color: 'var(--c-text)' }}>
                  Claude will be able to read your E-Site projects and run imports you preview and confirm, as you.
                </p>
                {actionError && (
                  <p role="alert" style={{ margin: 0, color: 'var(--c-red)' }}>
                    {actionError}
                  </p>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide('approve')}
                    style={{
                      ...BUTTON_BASE,
                      flex: '1 1 140px',
                      background: 'var(--c-amber)',
                      color: '#0A0808',
                      border: 'none',
                      fontWeight: 700,
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide('deny')}
                    style={{
                      ...BUTTON_BASE,
                      flex: '1 1 140px',
                      background: 'var(--c-panel)',
                      color: 'var(--c-text-mid)',
                      border: '1px solid var(--c-border)',
                      fontWeight: 500,
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    Deny
                  </button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </main>
  )
}
