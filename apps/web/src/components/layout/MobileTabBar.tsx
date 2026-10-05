'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import type { OrgRole } from '@esite/shared'
import { FolderOpen, Camera, Inbox, Menu, ChevronRight, ArrowLeft, BookOpen, LogOut } from 'lucide-react'
import { BottomSheet } from './BottomSheet'
import { navForRole, MARKETPLACE_ENABLED } from './Sidebar'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { NotificationList, UnreadBadge, useNotifications } from '@/components/ui/NotificationCentre'
import { captureHref, currentProjectId } from '@/lib/mobile/shell'
import { useActiveProjects, type ProjectRef } from '@/lib/mobile/use-projects'

type SheetName = 'capture' | 'inbox' | 'more' | null

const LAST_PROJECT_KEY = 'esite.capture.lastProject'

function readLastProject(): string | null {
  try { return window.localStorage.getItem(LAST_PROJECT_KEY) } catch { return null }
}
function writeLastProject(id: string) {
  try { window.localStorage.setItem(LAST_PROJECT_KEY, id) } catch { /* private mode: convenience only */ }
}

interface MobileTabBarProps {
  role: OrgRole | null
  tariffAdmin: boolean
}

/**
 * The phone shell's bottom navigation (shown below 768 px by CSS; the desktop
 * sidebar is hidden there). Projects is a link. Capture goes to the current
 * project's Capture page (E1 — it owns the role-aware action list); outside a
 * project it first asks which project. Inbox and More open bottom sheets.
 */
export function MobileTabBar(props: MobileTabBarProps) {
  return (
    <Suspense fallback={null}>
      <MobileTabBarInner {...props} />
    </Suspense>
  )
}

function MobileTabBarInner({ role, tariffAdmin }: MobileTabBarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const projectId = currentProjectId(pathname, searchParams.get('projectId'))
  const [sheet, setSheet] = useState<SheetName>(null)
  const close = useCallback(() => setSheet(null), [])
  const { unreadCount } = useNotifications()

  // A navigation (including one started from inside a sheet) closes the sheet.
  useEffect(() => { setSheet(null) }, [pathname, searchParams])

  const captureActive = sheet === null && /^\/projects\/[^/]+\/capture(\/|$)/.test(pathname)
  const projectsActive = sheet === null && !captureActive && (pathname === '/projects' || pathname.startsWith('/projects/') || pathname.startsWith('/rfis'))

  return (
    <>
      <nav className="mobile-tabbar no-print" aria-label="Phone navigation">
        <Link href="/projects" className={`mobile-tab${projectsActive ? ' active' : ''}`} aria-current={projectsActive ? 'page' : undefined}>
          <FolderOpen size={22} aria-hidden="true" />
          <span>Projects</span>
        </Link>
        {projectId ? (
          <Link href={captureHref(projectId)} className={`mobile-tab${captureActive ? ' active' : ''}`} aria-current={captureActive ? 'page' : undefined} onClick={() => writeLastProject(projectId)}>
            <Camera size={22} aria-hidden="true" />
            <span>Capture</span>
          </Link>
        ) : (
          <button type="button" className={`mobile-tab${sheet === 'capture' ? ' active' : ''}`} onClick={() => setSheet('capture')} aria-haspopup="dialog" aria-expanded={sheet === 'capture'}>
            <Camera size={22} aria-hidden="true" />
            <span>Capture</span>
          </button>
        )}
        <button
          type="button"
          className={`mobile-tab${sheet === 'inbox' ? ' active' : ''}`}
          onClick={() => setSheet('inbox')}
          aria-haspopup="dialog"
          aria-expanded={sheet === 'inbox'}
          aria-label={unreadCount > 0 ? `Inbox, ${unreadCount} unread` : 'Inbox'}
        >
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Inbox size={22} aria-hidden="true" />
            <UnreadBadge count={unreadCount} style={{ top: -6, right: -10 }} />
          </span>
          <span aria-hidden="true">Inbox</span>
        </button>
        <button type="button" className={`mobile-tab${sheet === 'more' ? ' active' : ''}`} onClick={() => setSheet('more')} aria-haspopup="dialog" aria-expanded={sheet === 'more'}>
          <Menu size={22} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>

      <BottomSheet open={sheet === 'capture'} onClose={close} title="Capture">
        <ProjectPickerBody onNavigate={close} />
      </BottomSheet>
      <BottomSheet open={sheet === 'inbox'} onClose={close} title="Inbox">
        <NotificationList showTitle={false} onNavigate={close} />
      </BottomSheet>
      <BottomSheet open={sheet === 'more'} onClose={close} title="More">
        <MoreSheetBody role={role} tariffAdmin={tariffAdmin} pathname={pathname} onNavigate={close} />
      </BottomSheet>
    </>
  )
}

/**
 * Capture outside a project: choose the project (the last one used first),
 * then land on that project's Capture page.
 */
function ProjectPickerBody({ onNavigate }: { onNavigate: () => void }) {
  const { projects, error } = useActiveProjects(true)

  if (error) return <p className="sheet-empty">Could not load your projects. Check your connection and try again.</p>
  if (!projects) return <p className="sheet-empty">Loading projects…</p>
  if (projects.length === 0) return <p className="sheet-empty">You have no active projects to capture against.</p>

  const last = readLastProject()
  const ordered: ProjectRef[] = last
    ? [...projects.filter(p => p.id === last), ...projects.filter(p => p.id !== last)]
    : projects

  return (
    <div>
      <p className="sheet-prompt">Which project is this for?</p>
      <ul className="sheet-list">
        {ordered.map(p => (
          <li key={p.id}>
            <Link
              href={captureHref(p.id)}
              className="sheet-row"
              onClick={() => { writeLastProject(p.id); onNavigate() }}
            >
              <span className="sheet-row-text">
                <span className="sheet-row-label">{p.name}</span>
                {p.id === last && <span className="sheet-row-hint">Last used</span>}
              </span>
              <ChevronRight size={18} aria-hidden="true" className="sheet-row-chevron" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Links close the sheet on tap: a link to the page you are already on changes
// neither pathname nor query, so the navigation effect alone would leave it open.
function MoreSheetBody({ role, tariffAdmin, pathname, onNavigate }: { role: OrgRole | null; tariffAdmin: boolean; pathname: string; onNavigate: () => void }) {
  const { globalNav, footerItems } = navForRole(role)
  const rows = [
    ...globalNav.map(({ href, label, Icon }) => ({ href, label, Icon, note: href === '/marketplace' && !MARKETPLACE_ENABLED ? 'In development' : null })),
    ...footerItems.map(({ href, label, Icon }) => ({ href, label, Icon, note: null })),
    ...(tariffAdmin ? [{ href: '/admin/tariffs', label: 'Tariff library', Icon: BookOpen, note: null }] : []),
  ]
  return (
    <div>
      {pathname.startsWith('/projects/') && (
        <Link href="/projects" className="sheet-row" onClick={onNavigate}>
          <span className="sheet-row-icon"><ArrowLeft size={20} aria-hidden="true" /></span>
          <span className="sheet-row-text"><span className="sheet-row-label">All projects</span></span>
        </Link>
      )}
      <ul className="sheet-list">
        {rows.map(({ href, label, Icon, note }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <li key={href}>
              <Link href={href} className={`sheet-row${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
                <span className="sheet-row-icon"><Icon size={20} aria-hidden="true" /></span>
                <span className="sheet-row-text">
                  <span className="sheet-row-label">{label}</span>
                  {note && <span className="sheet-row-hint">{note}</span>}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      <div className="sheet-row sheet-row-static">
        <span className="sheet-row-text"><span className="sheet-row-label">Appearance</span></span>
        <ThemeToggle />
      </div>
      <form action="/auth/signout" method="post">
        <button type="submit" className="sheet-row">
          <span className="sheet-row-icon"><LogOut size={20} aria-hidden="true" /></span>
          <span className="sheet-row-text"><span className="sheet-row-label">Sign out</span></span>
        </button>
      </form>
    </div>
  )
}
