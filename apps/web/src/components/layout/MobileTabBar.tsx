'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import type { OrgRole } from '@esite/shared'
import {
  FolderOpen, Camera, Inbox, Menu, ChevronRight, ArrowLeft,
  BookOpen, AlertTriangle, FileText, ClipboardCheck, MessageSquare, LogOut,
} from 'lucide-react'
import { BottomSheet } from './BottomSheet'
import { navForRole, MARKETPLACE_ENABLED } from './Sidebar'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { NotificationList, UnreadBadge, useNotifications } from '@/components/ui/NotificationCentre'
import { captureTargets, currentProjectId, type CaptureTarget } from '@/lib/mobile/shell'
import { useActiveProjects, useProjectName, type ProjectRef } from '@/lib/mobile/use-projects'

type SheetName = 'capture' | 'inbox' | 'more' | null

const CAPTURE_ICON: Record<CaptureTarget['key'], typeof Camera> = {
  diary: BookOpen,
  snag: AlertTriangle,
  form: FileText,
  inspection: ClipboardCheck,
  rfi: MessageSquare,
}

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
 * sidebar is hidden there). Projects is a link; Capture, Inbox and More open
 * bottom sheets so the user never leaves the page they are on to choose.
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

  const projectsActive = sheet === null && (pathname === '/projects' || pathname.startsWith('/projects/') || pathname.startsWith('/rfis'))

  return (
    <>
      <nav className="mobile-tabbar no-print" aria-label="Phone navigation">
        <Link href="/projects" className={`mobile-tab${projectsActive ? ' active' : ''}`} aria-current={projectsActive ? 'page' : undefined}>
          <FolderOpen size={22} aria-hidden="true" />
          <span>Projects</span>
        </Link>
        <button type="button" className={`mobile-tab${sheet === 'capture' ? ' active' : ''}`} onClick={() => setSheet('capture')} aria-haspopup="dialog" aria-expanded={sheet === 'capture'}>
          <Camera size={22} aria-hidden="true" />
          <span>Capture</span>
        </button>
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
        <CaptureSheetBody projectId={projectId} />
      </BottomSheet>
      <BottomSheet open={sheet === 'inbox'} onClose={close} title="Inbox">
        <NotificationList showTitle={false} onNavigate={close} />
      </BottomSheet>
      <BottomSheet open={sheet === 'more'} onClose={close} title="More">
        <MoreSheetBody role={role} tariffAdmin={tariffAdmin} pathname={pathname} />
      </BottomSheet>
    </>
  )
}

/**
 * Inside a project: the capture verbs for that project. Elsewhere: pick a
 * project first (the last one used is listed first), then the verbs.
 */
function CaptureSheetBody({ projectId }: { projectId: string | null }) {
  const [chosen, setChosen] = useState<string | null>(projectId)
  const { projects, error } = useActiveProjects(chosen === null)
  const chosenName = useProjectName(chosen)

  useEffect(() => { if (chosen) writeLastProject(chosen) }, [chosen])

  if (chosen) {
    return (
      <div>
        <div className="sheet-context">
          <span className="sheet-context-label">Project</span>
          <span className="sheet-context-value">{chosenName ?? '…'}</span>
          {!projectId && (
            <button type="button" className="sheet-context-change" onClick={() => setChosen(null)}>
              Change
            </button>
          )}
        </div>
        <ul className="sheet-list">
          {captureTargets(chosen).map(t => {
            const Icon = CAPTURE_ICON[t.key]
            return (
              <li key={t.key}>
                <Link href={t.href} className="sheet-row">
                  <span className="sheet-row-icon"><Icon size={20} aria-hidden="true" /></span>
                  <span className="sheet-row-text">
                    <span className="sheet-row-label">{t.label}</span>
                    <span className="sheet-row-hint">{t.hint}</span>
                  </span>
                  <ChevronRight size={18} aria-hidden="true" className="sheet-row-chevron" />
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

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
            <button type="button" className="sheet-row" onClick={() => setChosen(p.id)}>
              <span className="sheet-row-text">
                <span className="sheet-row-label">{p.name}</span>
                {p.id === last && <span className="sheet-row-hint">Last used</span>}
              </span>
              <ChevronRight size={18} aria-hidden="true" className="sheet-row-chevron" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MoreSheetBody({ role, tariffAdmin, pathname }: { role: OrgRole | null; tariffAdmin: boolean; pathname: string }) {
  const { globalNav, footerItems } = navForRole(role)
  const rows = [
    ...globalNav.map(({ href, label, Icon }) => ({ href, label, Icon, note: href === '/marketplace' && !MARKETPLACE_ENABLED ? 'In development' : null })),
    ...footerItems.map(({ href, label, Icon }) => ({ href, label, Icon, note: null })),
    ...(tariffAdmin ? [{ href: '/admin/tariffs', label: 'Tariff library', Icon: BookOpen, note: null }] : []),
  ]
  return (
    <div>
      {pathname.startsWith('/projects/') && (
        <Link href="/projects" className="sheet-row">
          <span className="sheet-row-icon"><ArrowLeft size={20} aria-hidden="true" /></span>
          <span className="sheet-row-text"><span className="sheet-row-label">All projects</span></span>
        </Link>
      )}
      <ul className="sheet-list">
        {rows.map(({ href, label, Icon, note }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <li key={href}>
              <Link href={href} className={`sheet-row${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
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
