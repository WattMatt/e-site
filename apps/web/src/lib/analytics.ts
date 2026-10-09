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

import { after } from 'next/server'
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
//
// posthog-node's capture()/identify() only QUEUE. A send starts when the queue
// reaches flushAt or the flushInterval timer fires, and nothing awaits it. On
// Vercel the function is frozen once the response is sent, so a queued event
// (or an un-awaited background send) is very likely never delivered. Until
// 2026-10-07 this module used flushAt: 20 / flushInterval: 10 s and never
// flushed, so the server funnel events were in practice lost.
//
// Each call now builds its own client with flushAt: 1 / flushInterval: 0
// (PostHog's serverless settings) and awaits shutdown(), which sends whatever
// is queued. The await is handed to next/server's after(): Next keeps the
// function alive until it settles, after the user's response has gone out.
// One client per call means a request only ever waits on its own event.
//
// Nothing here may throw into the calling action: a failure is logged and
// dropped. A send PostHog rejects (a bad key is status=401) does not reject
// shutdown(): posthog-node reports it only through its 'error' event and an
// un-awaited console.error that can lose the race with the freeze. So each
// client's 'error' event is collected and logged once shutdown() settles.

/** Upper bound on how long an after() task may spend delivering one event. */
const SHUTDOWN_TIMEOUT_MS = 5_000

type PostHogClient = import('posthog-node').PostHog

async function createPostHogNode(): Promise<PostHogClient | null> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return null
  const { PostHog } = await import('posthog-node')
  return new PostHog(key, {
    // Same region as the browser client: the project is in the EU (see posthog-hosts.ts).
    host: posthogHosts.apiHost,
    flushAt: 1,
    flushInterval: 0,
    // Keep a failing send inside SHUTDOWN_TIMEOUT_MS: the library default is
    // 3 retries 3 s apart with a 10 s request timeout.
    fetchRetryCount: 1,
    fetchRetryDelay: 1_000,
    requestTimeout: 3_000,
  })
}

function logAnalyticsFailure(what: string, err: unknown) {
  console.warn(`[analytics] PostHog ${what} was not sent:`, err instanceof Error ? err.message : err)
}

/**
 * Queue one message on a fresh client, then deliver it: after the response
 * when called inside a request, inline otherwise (scripts, tests — after()
 * throws outside a request scope).
 */
async function deliver(what: string, enqueue: (ph: PostHogClient) => void): Promise<void> {
  let ph: PostHogClient | null
  try {
    ph = await createPostHogNode()
    if (!ph) return
    enqueue(ph)
  } catch (err) {
    logAnalyticsFailure(what, err)
    return
  }

  const client = ph
  const sendErrors: unknown[] = []
  try {
    client.on('error', (err) => sendErrors.push(err))
  } catch {
    // A client without the listener still sends; only the log line is lost.
  }

  const send = async () => {
    try {
      await client.shutdown(SHUTDOWN_TIMEOUT_MS)
    } catch (err) {
      logAnalyticsFailure(what, err)
    }
    if (sendErrors.length > 0) logAnalyticsFailure(what, sendErrors[0])
  }

  try {
    after(send)
  } catch {
    await send()
  }
}

export async function trackServer(
  userId: string,
  event: AnalyticsEvent,
  properties?: Record<string, unknown>
): Promise<void> {
  await deliver(`event ${event}`, (ph) => ph.capture({ distinctId: userId, event, properties }))
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
  await deliver('identify', (ph) => ph.identify({ distinctId: userId, properties: traits }))
}
