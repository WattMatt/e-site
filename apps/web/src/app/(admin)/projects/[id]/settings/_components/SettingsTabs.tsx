'use client'

/**
 * Top-tab nav for project settings.
 *
 * - 13 tabs in spec §8.1 order (Rates added after Contract).
 * - Active tab derived from usePathname() — matches the last `/settings/<slug>`.
 * - 🔒 marker on tabs the current role can't fully access (per spec §7).
 *   The tab is still clickable for VIEW if RBAC allows; the marker
 *   communicates "you can look but not save".
 * - ● dot marker (amber) on `dirtyTab` slug — set by <UnsavedChangesGuard>
 *   context so users can see they have unsaved work elsewhere.
 * - ⚠ marker on danger-zone tab regardless of role.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { COST_VIEW_ROLES, type OrgRole } from '@esite/shared'

type Slug =
  | 'general' | 'site' | 'dates' | 'client' | 'contract' | 'rates' | 'members'
  | 'jbcc-parties' | 'operational' | 'contacts' | 'integrations'
  | 'danger-zone' | 'history'

interface TabDef {
  slug: Slug
  label: string
  /** Roles that can VIEW this tab. Others see the tab in disabled style. */
  viewRoles: ReadonlyArray<OrgRole>
  /** Roles that can EDIT. If user's role isn't here but they can view, show 🔒. */
  editRoles: ReadonlyArray<OrgRole>
  warn?: boolean
}

const ALL: ReadonlyArray<OrgRole> = [
  'owner', 'admin', 'project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer',
]
const ORG_WRITE: ReadonlyArray<OrgRole> = ['owner', 'admin', 'project_manager']
const OWNER_ADMIN: ReadonlyArray<OrgRole> = ['owner', 'admin']
const OWNER_ONLY: ReadonlyArray<OrgRole> = ['owner']

const TABS: ReadonlyArray<TabDef> = [
  { slug: 'general',       label: 'General',       viewRoles: ALL,         editRoles: ORG_WRITE },
  { slug: 'site',          label: 'Site',          viewRoles: ALL,         editRoles: ORG_WRITE },
  { slug: 'dates',         label: 'Dates',         viewRoles: ALL,         editRoles: ORG_WRITE },
  { slug: 'client',        label: 'Client',        viewRoles: ALL,         editRoles: ORG_WRITE },
  { slug: 'contract',      label: 'Contract',      viewRoles: COST_VIEW_ROLES, editRoles: COST_VIEW_ROLES },
  { slug: 'rates',         label: 'Rates',         viewRoles: COST_VIEW_ROLES, editRoles: COST_VIEW_ROLES },
  { slug: 'members',       label: 'Members',       viewRoles: OWNER_ADMIN, editRoles: OWNER_ADMIN },
  { slug: 'jbcc-parties',  label: 'JBCC Parties',  viewRoles: ALL,         editRoles: ORG_WRITE },
  { slug: 'operational',   label: 'Operational',   viewRoles: ALL,         editRoles: ORG_WRITE },
  { slug: 'contacts',      label: 'Contacts',      viewRoles: ALL,         editRoles: ORG_WRITE },
  { slug: 'integrations',  label: 'Integrations',  viewRoles: OWNER_ADMIN, editRoles: OWNER_ADMIN },
  { slug: 'danger-zone',   label: 'Danger',        viewRoles: OWNER_ONLY,  editRoles: OWNER_ONLY,  warn: true },
  { slug: 'history',       label: 'History',       viewRoles: ALL,         editRoles: [] },
]

export interface SettingsTabsProps {
  projectId: string
  role: OrgRole
  /** Slug of the tab currently holding unsaved changes, or null. */
  dirtyTab: Slug | null
}

export function SettingsTabs({ projectId, role, dirtyTab }: SettingsTabsProps) {
  const pathname = usePathname()
  const activeSlug = extractSlug(pathname)

  return (
    <nav
      aria-label="Project settings tabs"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        borderBottom: '1px solid var(--c-border)',
        marginBottom: 18,
        paddingBottom: 0,
      }}
    >
      {TABS.map(tab => {
        const canView = tab.viewRoles.includes(role)
        const canEdit = tab.editRoles.includes(role)
        const isActive = tab.slug === activeSlug
        const isDirty = tab.slug === dirtyTab
        // We show all tabs to all members for discoverability, but visually
        // dim ones they can't even view (and the route itself redirects).
        const dimmed = !canView

        const markers = [
          isDirty && <span key="dot" aria-label="Unsaved changes" style={{ color: 'var(--c-amber)', marginRight: 4 }}>●</span>,
          (!canEdit && canView) || !canView ? <span key="lock" aria-label="Admin-only" style={{ marginLeft: 4 }}>🔒</span> : null,
          tab.warn ? <span key="warn" aria-label="Destructive actions" style={{ marginLeft: 4 }}>⚠</span> : null,
        ].filter(Boolean)

        return (
          <Link
            key={tab.slug}
            href={`/projects/${projectId}/settings/${tab.slug}`}
            aria-current={isActive ? 'page' : undefined}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 500,
              color: dimmed ? 'var(--c-text-dim)' : isActive ? 'var(--c-text-on-amber)' : 'var(--c-text-mid)',
              background: isActive ? 'var(--c-amber)' : 'transparent',
              borderRadius: '6px 6px 0 0',
              textDecoration: 'none',
              opacity: dimmed ? 0.5 : 1,
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {markers}
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}

function extractSlug(pathname: string | null): Slug | null {
  if (!pathname) return null
  const m = pathname.match(/\/settings\/([a-z-]+)/)
  return (m?.[1] ?? null) as Slug | null
}
