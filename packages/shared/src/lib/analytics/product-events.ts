// packages/shared/src/lib/analytics/product-events.ts
//
// The two registries the metrics stand on. Set equality with the SQL CHECK
// constraints is asserted in both directions by product-events.contract.test.ts.

/** Keys accepted by public.product_events.event. */
export const PRODUCT_EVENTS = [
  'rfi_created',
  'rfi_responded',
  'rfi_closed',
  'snag_resolved',
  'project_created',
  'project_deleted',
  'marketplace_order_placed',
  'onboarding_started',
  'backfill_completed',
] as const
export type ProductEvent = (typeof PRODUCT_EVENTS)[number]

/** Keys accepted by public.platform_metrics_weekly.metric_key. */
export const METRIC_KEYS = [
  'weekly_active',
  'contractor_active_frozen',
  'contractor_active_all',
  'client_active',
  'diary_same_day',
  'rfi_response_median_wd',
  'inbox_engagement',
  'report_schedules_per_project',
  'activation_first_session',
  'paying_organisations',
  'notifications_created',
] as const
export type MetricKey = (typeof METRIC_KEYS)[number]

/** §15 §(a). The single source of truth for every headline label, unit and target. */
export const METRIC_LABELS: Record<MetricKey, string> = {
  weekly_active: 'Weekly active users / frozen Sept-2026 cohort',
  contractor_active_frozen: 'Contractor accounts active weekly — frozen cohort',
  contractor_active_all: 'Contractor accounts active weekly — all',
  client_active: 'Client viewers active weekly — frozen cohort',
  diary_same_day: 'Diary entries logged same day',
  rfi_response_median_wd: 'Median working days to respond on RFIs (office calendar)',
  inbox_engagement: 'Inbox engagement',
  report_schedules_per_project: 'Report schedules per active project',
  activation_first_session: 'Activation — item closed in first session',
  paying_organisations: 'Signed paying organisations',
  notifications_created: 'Notifications per first-party write',
}

/**
 * How to render `value`. A bare number on a dashboard is a number nobody can
 * read: `rfi_response_median_wd` showing "7" and `notifications_created`
 * showing "241" mean completely different things, and the reader cannot see
 * which. Rendered immediately after the value on /metrics.
 */
export const METRIC_UNITS: Record<MetricKey, string> = {
  weekly_active: '%',
  contractor_active_frozen: '%',
  contractor_active_all: '%',
  client_active: '%',
  diary_same_day: '%',
  rfi_response_median_wd: ' working days',
  inbox_engagement: '%',
  report_schedules_per_project: ' per project',
  activation_first_session: '%',
  paying_organisations: ' organisations',
  notifications_created: ' per write',
}

/** Metric keys whose `value` is a 0..1 ratio and renders as a percentage. */
export const RATIO_METRIC_KEYS: ReadonlySet<MetricKey> = new Set<MetricKey>([
  'weekly_active',
  'contractor_active_frozen',
  'contractor_active_all',
  'client_active',
  'diary_same_day',
  'inbox_engagement',
  'activation_first_session',
])

/** Q1 targets, §15 §(a). */
export const METRIC_TARGET_Q1: Record<MetricKey, string | null> = {
  weekly_active: '35% of the frozen cohort',
  // §15's table says "6 / 13 (46%)". The frozen cohort is 12, not 13, because
  // rbac-test@e-site.live holds an active contractor role and metric_accounts
  // excludes it by §15's own rule. Restated on the real denominator.
  contractor_active_frozen: '6 of 12 (50%)',
  contractor_active_all: '40%',
  client_active: 'instrumented, baseline published',
  diary_same_day: 'instrumented, baseline published',
  rfi_response_median_wd: '≤ 7 working days, censored pair published',
  inbox_engagement: '60% Immediate / 35% overall',
  report_schedules_per_project: '0, instrumented',
  activation_first_session: '35%',
  paying_organisations: '0, instrumented',
  notifications_created: 'down ≥ 60% on the Sept-2026 baseline',
}
