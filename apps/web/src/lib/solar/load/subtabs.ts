export const LOAD_SUBTABS = [
  { key: 'meters', label: 'Meters' },
  { key: 'tenants', label: 'Tenants' },
  { key: 'profile', label: 'Site profile' },
  { key: 'checks', label: 'Checks' },
] as const
export type LoadSubTab = (typeof LOAD_SUBTABS)[number]['key']

export function parseSubTab(v: string | string[] | undefined): LoadSubTab {
  const s = Array.isArray(v) ? v[0] : v
  return (LOAD_SUBTABS.some((t) => t.key === s) ? s : 'meters') as LoadSubTab
}

export function loadHref(projectId: string, tab: LoadSubTab, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ tab, ...extra })
  return `/projects/${projectId}/solar/load?${q.toString()}`
}
