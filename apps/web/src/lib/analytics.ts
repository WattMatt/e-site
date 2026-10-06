/**
 * T-061: PostHog analytics — funnel tracking
 *
 * Funnel: signup → first COC upload → first marketplace order
 *
 * Server-side events use the PostHog Node library (posthog-node).
 * Client-side events use posthog-js, initialised in components/providers/AnalyticsProvider.tsx
 * with lib/analytics/posthog-client-options.ts.
 *
 * Usage:
 *   // Server action / route handler
 *   import { trackServer } from '@/lib/analytics'
 *   await trackServer(userId, 'coc_uploaded', { org_id, site_id })
 *
 *   // Client component
 *   import { trackEvent } from '@/components/providers/AnalyticsProvider'
 *   trackEvent('marketplace_order_placed', { supplier_id, amount })
 */

import { posthogHosts } from './analytics/posthog-hosts'

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
  PROJECT_DELETED:          'project_deleted',
  SNAG_LOGGED:              'snag_logged',
  SNAG_RESOLVED:            'snag_resolved',
  RFI_CREATED:              'rfi_created',
  RFI_RESPONDED:            'rfi_responded',
  RFI_CLOSED:               'rfi_closed',
  DIARY_ENTRY_CREATED:      'diary_entry_created',
  FLOORPLAN_MARKUP_SAVED:   'floorplan_markup_saved',

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
      // Same region as the browser client: the project is in the EU (see posthog-hosts.ts).
      host: posthogHosts.apiHost,
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
