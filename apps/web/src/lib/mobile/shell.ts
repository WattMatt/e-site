/**
 * Pure helpers for the phone shell (below 768 px). Kept free of React so the
 * rules are unit-tested directly.
 */

/**
 * The project the user is "in", or null. Mirrors the sidebar: a
 * `/projects/<id>/…` path, else a `?projectId=` query (the RFI pages). Unlike
 * the sidebar's matcher it ignores `/projects/new`, which is a form, not a
 * project.
 */
export function currentProjectId(pathname: string, projectIdParam: string | null): string | null {
  const m = pathname.match(/^\/projects\/([^/?#]+)/)
  if (m && m[1] !== 'new') return m[1]
  return projectIdParam || null
}

/**
 * Where the Capture tab sends a user who has picked a project: E1's in-project
 * Capture page, which owns the role-aware list of capture actions
 * (lib/capture/capture-actions.ts). The phone shell never keeps its own list.
 */
export function captureHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/capture`
}

/**
 * Field-first ordering for the in-project chip bar: the sections a phone user
 * opens on site come first, desk modules after in their sidebar order. Keyed on
 * the ROUTE, not the label, so renaming a sidebar label cannot silently
 * reshuffle the phone.
 */
const FIELD_FIRST = ['', '/capture', '/snags', '/diary', '/forms', '/inspections', '/quality-control', '/rfis', '/floor-plans']

function sectionOf(href: string): string {
  const path = href.split('?')[0]
  if (path === '/rfis' || path.startsWith('/rfis/')) return '/rfis'
  return path.replace(/^\/projects\/[^/]+/, '')
}

export function orderForPhone<T extends { href: string }>(items: readonly T[]): T[] {
  const rank = (href: string) => {
    const i = FIELD_FIRST.indexOf(sectionOf(href))
    return i === -1 ? FIELD_FIRST.length : i
  }
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.href) - rank(b.item.href) || a.i - b.i)
    .map(({ item }) => item)
}

/** Whether a nav href is the active one for the current location. */
export function isActiveHref(href: string, pathname: string, exact: boolean): boolean {
  const base = href.split('?')[0]
  return exact ? pathname === base : pathname === base || pathname.startsWith(base + '/')
}
