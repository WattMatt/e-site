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

export interface CaptureTarget {
  key: 'diary' | 'snag' | 'form' | 'inspection' | 'rfi'
  label: string
  hint: string
  href: string
}

/**
 * The capture verbs offered by the Capture tab, each pre-scoped to a project.
 * Every target is an existing route that applies its own role gate — the sheet
 * never decides who may create what.
 */
export function captureTargets(projectId: string): CaptureTarget[] {
  const p = encodeURIComponent(projectId)
  return [
    { key: 'diary', label: 'Diary entry', hint: 'Progress, weather, workforce and photos', href: `/projects/${p}/diary?new=1` },
    { key: 'snag', label: 'Snag', hint: 'A defect with evidence photos', href: `/projects/${p}/snags/new` },
    { key: 'form', label: 'Site form', hint: 'Termination and making safe record', href: `/projects/${p}/forms/new` },
    { key: 'inspection', label: 'Inspection', hint: 'Start a structured inspection', href: `/projects/${p}/inspections/new` },
    { key: 'rfi', label: 'RFI', hint: 'Ask the design team a question', href: `/rfis/new?projectId=${p}` },
  ]
}

/**
 * Field-first ordering for the in-project chip bar: the things a phone user
 * opens on site come first, desk modules after. Unknown labels keep their
 * sidebar order at the end.
 */
const FIELD_FIRST = ['Overview', 'Snags', 'Site Diary', 'Forms', 'Inspections', 'Quality Control', 'RFIs', 'Floor Plans']
export function orderForPhone<T extends { label: string }>(items: readonly T[]): T[] {
  const rank = (l: string) => {
    const i = FIELD_FIRST.indexOf(l)
    return i === -1 ? FIELD_FIRST.length : i
  }
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.label) - rank(b.item.label) || a.i - b.i)
    .map(({ item }) => item)
}

/** Whether a nav href is the active one for the current location. */
export function isActiveHref(href: string, pathname: string, exact: boolean): boolean {
  const base = href.split('?')[0]
  return exact ? pathname === base : pathname === base || pathname.startsWith(base + '/')
}
