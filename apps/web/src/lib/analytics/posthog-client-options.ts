import type { PostHogConfig } from 'posthog-js'
import { posthogHosts } from './posthog-hosts'

/**
 * posthog.init options for the web app.
 *
 * There is no consent banner: /legal/privacy relies on legitimate interest for
 * "aggregate, anonymised" analytics "without auto-capture of clicks or form
 * values, and without session recordings", and /cookies promises functional
 * cookies only. So everything beyond explicit events and page views is pinned
 * OFF here rather than left to the PostHog project's remote settings — a
 * dashboard toggle must not be able to widen collection past that notice.
 * Changing any of these needs a policy change (and probably a consent banner)
 * first; posthog-client-options.test.ts holds the line.
 */
export const posthogClientOptions: Partial<PostHogConfig> = {
  api_host: posthogHosts.apiHost,
  ui_host: posthogHosts.uiHost,
  // Page views are sent manually on route change (AnalyticsProvider).
  capture_pageview: false,
  capture_pageleave: true,
  // No click / form capture.
  autocapture: false,
  rageclick: false,
  capture_dead_clicks: false,
  capture_heatmaps: false,
  // No session recordings, surveys, tours or chat widgets.
  disable_session_recording: true,
  disable_surveys: true,
  disable_product_tours: true,
  disable_conversations: true,
  disable_web_experiments: true,
  // No exception or performance capture (page URLs + stack traces are Sentry's job).
  capture_exceptions: false,
  capture_performance: false,
  // No cookie: the anonymous id lives in localStorage only. Never identify a
  // person from the browser, so no person profiles are created.
  persistence: 'localStorage',
  person_profiles: 'identified_only',
}
