/**
 * Mobile PostHog analytics. Mirrors apps/web/src/lib/analytics.ts — re-exports
 * the same event-name constants so the web and mobile funnels stay aligned.
 *
 * Requires `posthog-react-native` (see docs/t061-observability-runbook.md).
 * When the package or key is missing, every call is a silent no-op.
 */

// Keep event names in lockstep with apps/web/src/lib/analytics.ts. If you add
// an event on one surface, add it on the other.
export const ANALYTICS_EVENTS = {
  SIGNUP_STARTED:           'signup_started',
  SIGNUP_COMPLETED:         'signup_completed',
  ONBOARDING_STARTED:       'onboarding_started',
  ONBOARDING_COMPLETED:     'onboarding_completed',
  COC_UPLOAD_STARTED:       'coc_upload_started',
  COC_UPLOADED:             'coc_uploaded',
  COC_APPROVED:             'coc_approved',
  CATALOGUE_VIEWED:         'catalogue_viewed',
  ORDER_STARTED:            'order_started',
  ORDER_PLACED:             'marketplace_order_placed',
  ORDER_DELIVERED:          'order_delivered',
  PROJECT_CREATED:          'project_created',
  SNAG_LOGGED:              'snag_logged',
  SNAG_RESOLVED:            'snag_resolved',
  SUPPLIER_REGISTERED:      'supplier_registered',
  SUPPLIER_PAYSTACK_LINKED: 'supplier_paystack_linked',
  CATALOGUE_ITEM_PUBLISHED: 'catalogue_item_published',
} as const

export type AnalyticsEvent = typeof ANALYTICS_EVENTS[keyof typeof ANALYTICS_EVENTS]

let client: any = null
let initPromise: Promise<void> | null = null

async function getClient(): Promise<any> {
  if (client) return client
  if (initPromise) { await initPromise; return client }

  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY
  if (!key) return null

  initPromise = (async () => {
    try {
      const { PostHog } = await import('posthog-react-native' as any)
      client = new PostHog(key, {
        host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com',
        captureAppLifecycleEvents: true,
      })
    } catch {
      // posthog-react-native not installed — silent no-op.
      if (__DEV__) console.warn('[analytics] package not installed, skipping init')
    }
  })()
  await initPromise
  return client
}

export async function track(
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
): Promise<void> {
  const c = await getClient()
  c?.capture(event, properties)
}

export async function identify(
  userId: string,
  traits?: Record<string, unknown>,
): Promise<void> {
  const c = await getClient()
  c?.identify(userId, traits)
}

export async function reset(): Promise<void> {
  const c = await getClient()
  c?.reset()
}
