'use client'
/**
 * Sidebar "Solar" entry (spec §1.1). Visible to every project member except
 * suppliers and client viewers; badge per project AND user: lock (not
 * subscribed / no grant), clock (request pending), none (granted). Renders
 * nothing until the state is known so a supplier never sees it flash.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Clock, Lock, Sun } from 'lucide-react'
import type { SolarNavBadge } from '@esite/shared'
import { getSolarNavStateAction } from '@/actions/solar-requests.actions'

export function SolarNavItem({
  projectId, active, refreshKey, variant = 'sidebar',
}: {
  projectId: string
  active: boolean
  /** Changes on every navigation (the pathname) so an approval or withdraw shows without a reload. */
  refreshKey?: string
  /** 'chip' renders it in the phone shell's project chip bar, with the same visibility rule. */
  variant?: 'sidebar' | 'chip'
}) {
  const [badge, setBadge] = useState<SolarNavBadge | null>(null)
  const shownFor = useRef<string | null>(null)

  useEffect(() => {
    let live = true
    // A new project clears the badge (nothing shows until its state is known);
    // a re-read on the same project keeps the current badge — no flicker.
    if (shownFor.current !== projectId) {
      setBadge(null)
      shownFor.current = projectId
    }
    getSolarNavStateAction(projectId)
      .then((b) => { if (live) setBadge(b) })
      .catch(() => { if (live) setBadge('hidden') })
    return () => { live = false }
  }, [projectId, refreshKey])

  if (badge === null || badge === 'hidden') return null

  return (
    <Link
      href={`/projects/${projectId}/solar`}
      className={variant === 'chip' ? `project-chip${active ? ' active' : ''}` : `sidebar-nav-item${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {variant === 'sidebar' && <Sun className="sidebar-nav-icon" size={16} />}
      Solar
      {badge === 'locked' && <Lock size={12} aria-label="Solar is locked" style={{ marginLeft: 'auto', opacity: 0.7 }} />}
      {badge === 'pending' && <Clock size={12} aria-label="Solar access request pending" style={{ marginLeft: 'auto', opacity: 0.7 }} />}
    </Link>
  )
}
