/**
 * T-061: PostHog analytics — funnel tracking
 *
 * Funnel: signup → first COC upload → first marketplace order
 *
 * Server-side events use the PostHog Node library (posthog-node).
 * Client-side events use the posthog-js snippet initialised in PostHogProvider.
 *
 * Usage:
 *   // Server action / route handler
 *   import { trackServer } from '@/lib/analytics'
 *   await trackServer(userId, 'coc_uploaded', { org_id, site_id })
 *
 *   // Client component (via PostHog React hook)
 *   import { usePostHog } from 'posthog-js/react'
 *   const ph = usePostHog()
 *   ph.capture('marketplace_order_placed', { supplier_id, amount })
 */

// ─── Funnel event names (single source of truth) ─────────────────────────────

export const ANALYTICS_EVENTS = {
  // Auth funnel
  SIGNUP_STARTED:           'signup_started',
  SIGNUP_COMPLETED:         'signup_completed',           // user created + email verified
  ONBOARDING_STARTED:       'onboarding_started',
  ONBOARDING_COMPLETED:     'onboarding_completed',       // step 4 finished

  // Compliance funnel
  COC_UPLOAD_STARTED:       'coc_upload_started',
  COC_UPLOADED:             'coc_uploaded',               // file stored successfully
  COC_APPROVED:             'coc_approved',               // reviewer sets status = approved

  // Marketplace funnel
  CATALOGUE_VIEWED:         'catalogue_viewed',
  ORDER_STARTED:            'order_started',
  ORDER_PLACED:             'marketplace_order_placed',   // status = pending
  ORDER_DELIVERED:          'order_delivered',            // status = delivered

  // Project funnel
  PROJECT_CREATED:          'project_created',
  SNAG_LOGGED:              'snag_logged',
  SNAG_RESOLVED:            'snag_resolved',

  // Supplier funnel
  SUPPLIER_REGISTERED:      'supplier_registered',
  SUPPLIER_PAYSTACK_LINKED: 'supplier_paystack_linked',
  CATALOGUE_ITEM_PUBLISHED: 'catalogue_item_published',
} as const

export type AnalyticsEvent = typeof ANALYTICS_EVENTS[keyof typeof ANALYTICS_EVENTS]

// ─── Server-side tracking ─────────────────────────────────────────────────────

let _posthogNode: any = null

async function getPostHogNode() {
  if (_posthogNode) return _posthogNode
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return null
  try {
    const { PostHog } = await import('posthog-node')
    _posthogNode = new PostHog(key, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
      flushAt: 20,
      flushInterval: 10_000,
    })
    return _posthogNode
  } catch {
    return null
  }
}

export async function trackServer(
  userId: string,
  event: AnalyticsEvent,
  properties?: Record<string, unknown>
): Promise<void> {
  const ph = await getPostHogNode()
  if (!ph) return
  ph.capture({ distinctId: userId, event, properties })
}

/**
 * Identify a user on the server after signup/login.
 * Associates org membership and role to the PostHog profile.
 */
export async function identifyServer(
  userId: string,
  traits: {
    email?: string
    full_name?: string
    org_id?: string
    org_name?: string
    role?: string
    plan?: string
  }
): Promise<void> {
  const ph = await getPostHogNode()
  if (!ph) return
  ph.identify({ distinctId: userId, properties: traits })
}

// ─── Client-side PostHog provider setup ──────────────────────────────────────

/**
 * Config object consumed by PostHogProvider in layout.tsx.
 * Client components call `usePostHog()` from 'posthog-js/react'.
 */
export const posthogConfig = {
  key: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '',
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
  options: {
    capture_pageview: false,       // manual pageview via usePathname() effect
    capture_pageleave: true,
    autocapture: false,            // explicit events only — avoids PII leakage
    persistence: 'localStorage+cookie' as const,
    session_recording: {
      maskAllInputs: true,         // never record passwords / form data
    },
  },
}
