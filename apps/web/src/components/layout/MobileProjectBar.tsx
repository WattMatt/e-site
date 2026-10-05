'use client'

import { Suspense, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { projectNav } from './Sidebar'
import { SolarNavItem } from './SolarNavItem'
import { currentProjectId, isActiveHref, orderForPhone } from '@/lib/mobile/shell'
import { useProjectName } from '@/lib/mobile/use-projects'
import { usePhoneViewport } from '@/lib/mobile/use-phone-viewport'

/**
 * Phone shell (below 768 px): when the user is inside a project, a sticky bar
 * under the header carries the project's name, a way back to all projects and
 * the project's sections as a horizontally scrollable chip row — the sidebar's
 * project nav, re-laid out for a thumb. Renders nothing outside a project.
 */
export function MobileProjectBar({ mvVisible }: { mvVisible: boolean }) {
  return (
    <Suspense fallback={null}>
      <MobileProjectBarInner mvVisible={mvVisible} />
    </Suspense>
  )
}

function MobileProjectBarInner({ mvVisible }: { mvVisible: boolean }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const projectId = currentProjectId(pathname, searchParams.get('projectId'))
  const phone = usePhoneViewport()
  const name = useProjectName(phone ? projectId : null)
  const rowRef = useRef<HTMLDivElement>(null)

  // Bring the active chip into view so the user can see where they are.
  useEffect(() => {
    const active = rowRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    active?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }, [pathname, projectId])

  if (!projectId) return null

  const items = orderForPhone(
    projectNav(projectId).filter(({ href }) => mvVisible || !href.includes('/medium-voltage')),
  )

  return (
    <div className="mobile-project-bar no-print">
      <div className="mobile-project-title">
        <Link href="/projects" className="mobile-project-back" aria-label="All projects">
          <ChevronLeft size={20} aria-hidden="true" />
        </Link>
        <span className="mobile-project-name">{name ?? 'Project'}</span>
      </div>
      <div className="project-chip-row" ref={rowRef} role="navigation" aria-label="Project sections">
        {items.map(({ href, label, exact }) => {
          const active = isActiveHref(href, pathname, exact)
          if (href.split('?')[0] === `/projects/${projectId}/solar`) {
            // The Solar entry runs an access check per navigation; skip it where the bar is hidden.
            if (!phone) return null
            return <SolarNavItem key={href} projectId={projectId} active={active} refreshKey={pathname} variant="chip" />
          }
          return (
            <Link key={href} href={href} className={`project-chip${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
              {label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
