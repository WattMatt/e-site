'use client'
/**
 * Start the org subscription (spec §1.2). The route belongs to Phase 1B:
 * POST /api/paystack/solar-subscribe {project_id}; the org is derived from the
 * PROJECT server-side. Responses (1B contract, 2026-09-28):
 *   200 {authorization_url}  → go to Paystack; it returns the user to
 *                              /projects/<id>/solar/locked?payment=received
 *   403  not owner/admin of the project's org, or project not visible (one message)
 *   409  already subscribed  → straight to the Overview
 *   429  rate limited
 *   503  plan not configured → "Solar can't be purchased yet — ask E-Site support"
 * Nothing is written until the webhook.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import type { SolarSubscribeBody } from '@/lib/paystack/solar-subscribe-body'

const FALLBACK = 'Payment could not start — try again.'
const NOT_ADMIN = 'Only an organisation owner or admin can subscribe.'
const NOT_CONFIGURED = "Solar can't be purchased yet — ask E-Site support"
const RATE_LIMITED = 'Too many attempts — wait a minute and try again.'

export function SubscribeButton({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/paystack/solar-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId } satisfies SolarSubscribeBody),
      })
      const body = (await res.json().catch(() => ({}))) as { authorization_url?: unknown; error?: unknown }
      const said = typeof body.error === 'string' && body.error.trim() ? body.error : null
      if (res.ok && typeof body.authorization_url === 'string') {
        window.location.assign(body.authorization_url)
        return
      }
      if (res.status === 409) {
        router.push(`/projects/${projectId}/solar/overview`)
        return
      }
      if (res.status === 503) { setError(NOT_CONFIGURED); return }
      if (res.status === 403) { setError(said ?? NOT_ADMIN); return }
      if (res.status === 429) { setError(said ?? RATE_LIMITED); return }
      setError(FALLBACK)
    } catch {
      setError(FALLBACK)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <Button type="button" onClick={start} isLoading={busy}>Subscribe</Button>
      {error && <p role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--c-red)' }}>{error}</p>}
    </div>
  )
}
