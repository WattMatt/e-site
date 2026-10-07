'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'

const PH_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY

let initialized = false

/**
 * Tender links carry secrets: the invitation token in the path, and a
 * single-use sign-in (k, t) plus the bidder's address (e) in the query. None
 * of it may reach analytics.
 */
const SECRET_PARAMS = ['k', 't', 'e', 'token', 'token_hash', 'code']
export function scrubUrl(url: string): string {
  try {
    const u = new URL(url, 'http://x.invalid')
    for (const p of SECRET_PARAMS) u.searchParams.delete(p)
    const path = u.pathname.replace(/^\/tender\/invite\/[^/]+/, '/tender/invite/[token]')
    const q = u.searchParams.toString()
    const rel = path + (q ? `?${q}` : '')
    return url.startsWith('http') ? `${u.origin}${rel}` : rel
  } catch {
    return url
  }
}
const URL_PROPS = ['$current_url', '$referrer', '$initial_referrer', '$pathname', '$initial_current_url']

// useSearchParams() opts the caller into client-side-only rendering. Isolating
// it inside its own Suspense boundary keeps the rest of the tree (including
// the auth pages) server-renderable.
function PageViewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!PH_KEY || !initialized) return
    // Recordings carry URLs too: none on the tender portal.
    if (pathname.startsWith('/tender')) posthog.stopSessionRecording()
    const url = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : '')
    posthog.capture('$pageview', { $current_url: scrubUrl(url) })
  }, [pathname, searchParams])

  return null
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!PH_KEY || initialized) return
    posthog.init(PH_KEY, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.posthog.com',
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: false,
      persistence: 'localStorage+cookie',
      session_recording: { maskAllInputs: true },
      sanitize_properties: (props) => {
        for (const k of URL_PROPS) if (typeof props[k] === 'string') props[k] = scrubUrl(props[k] as string)
        return props
      },
    })
    initialized = true
  }, [])

  return (
    <>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {children}
    </>
  )
}

/** Track events from any client component */
export function trackEvent(event: string, props?: Record<string, unknown>) {
  if (!PH_KEY || typeof window === 'undefined') return
  posthog.capture(event, props)
}

/** Identify authenticated user in PostHog */
export function identifyUser(userId: string, traits?: Record<string, unknown>) {
  if (!PH_KEY || typeof window === 'undefined') return
  posthog.identify(userId, traits)
}
