'use client'
/**
 * After Paystack returns the owner to /solar/locked?payment=received (1B's
 * callback), poll the server — the WEBHOOK is the only writer (spec §1.2
 * "Return handling"). getSolarSubscriptionStateAction is true only when the
 * org is subscribed AND the caller has a level (org_has_solar + level via
 * loadSolarEntry); then open the Overview. Every 3 s for 30 s, then every
 * 10 s with the "not yet" sentence, so the page still updates when it lands.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSolarSubscriptionStateAction } from '@/actions/solar-requests.actions'

const WAITING = 'Payment received — activating Solar…'
const SLOW = 'We have not received confirmation from Paystack yet. This page will update when it arrives.'

export function PaymentReturnPoller({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    let stopped = false
    const started = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (stopped) return
      const { active } = await getSolarSubscriptionStateAction(projectId).catch(() => ({ active: false }))
      if (stopped) return
      if (active) {
        router.push(`/projects/${projectId}/solar/overview`)
        return
      }
      const late = Date.now() - started >= 30_000
      if (late) setSlow(true)
      timer = setTimeout(tick, late ? 10_000 : 3_000)
    }
    timer = setTimeout(tick, 0)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [projectId, router])

  return <p role="status" style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>{slow ? SLOW : WAITING}</p>
}
