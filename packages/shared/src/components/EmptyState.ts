/**
 * EmptyState — platform-agnostic empty state data.
 * Returns icon + heading + body text for common empty states.
 * Rendering is done by each platform.
 */

export interface EmptyStateConfig {
  icon: string          // emoji
  heading: string
  body: string
  actionLabel?: string  // optional CTA label
  actionHref?: string   // web href
  actionRoute?: string  // mobile route
}

export const EMPTY_STATES = {
  snags: {
    icon: '✅',
    heading: 'No snags',
    body: 'All clear — no snags logged on this project yet.',
    actionLabel: 'Log a snag',
    actionHref: '/snags/new',
    actionRoute: '/snags/create',
  },
  compliance: {
    icon: '📋',
    heading: 'No compliance sites',
    body: 'Add a compliance site to start tracking COC submissions.',
    actionLabel: 'Add site',
    actionHref: '/compliance/new',
  },
  notifications: {
    icon: '🔔',
    heading: 'No notifications',
    body: "You're all caught up.",
  },
  orders: {
    icon: '🛒',
    heading: 'No orders',
    body: 'Browse the marketplace to place your first order.',
    actionLabel: 'Browse marketplace',
    actionHref: '/marketplace',
    actionRoute: '/marketplace',
  },
  projects: {
    icon: '📁',
    heading: 'No projects yet',
    body: 'Create your first project to get started.',
    actionLabel: 'New project',
    actionHref: '/projects/new',
  },
  diary: {
    icon: '📓',
    heading: 'No diary entries',
    body: 'Start logging daily site activities.',
  },
  rfis: {
    icon: '❓',
    heading: 'No RFIs',
    body: 'No requests for information on this project.',
    actionLabel: 'Create RFI',
    actionHref: '/rfis/new',
  },
  search: {
    icon: '🔍',
    heading: 'No results',
    body: 'Try adjusting your search or filters.',
  },
  ratings: {
    icon: '⭐',
    heading: 'No ratings yet',
    body: 'This supplier has not been rated yet.',
  },
} satisfies Record<string, EmptyStateConfig>

export type EmptyStateKey = keyof typeof EMPTY_STATES

export function getEmptyState(key: EmptyStateKey): EmptyStateConfig {
  return EMPTY_STATES[key]
}
