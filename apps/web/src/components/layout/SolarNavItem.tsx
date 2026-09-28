'use client'
/**
 * Sidebar "Solar" entry (spec §1.1). Visible to every project member except
 * suppliers and client viewers; badge per project AND user: lock (not
 * subscribed / no grant), clock (request pending), none (granted). Renders
 * nothing until the state is known so a supplier never sees it flash.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Clock, Lock, Sun } from 'lucide-react'
import type { SolarNavBadge } from '@esite/shared'
import { getSolarNavStateAction } from '@/actions/solar-requests.actions'

export function SolarNavItem({ projectId, active }: { projectId: string; active: boolean }) {
  const [badge, setBadge] = useState<SolarNavBadge | null>(null)

  useEffect(() => {
    let live = true
    setBadge(null)
    getSolarNavStateAction(projectId)
      .then((b) => { if (live) setBadge(b) })
      .catch(() => { if (live) setBadge('hidden') })
    return () => { live = false }
  }, [projectId])

  if (badge === null || badge === 'hidden') return null

  return (
    <Link
      href={`/projects/${projectId}/solar`}
      className={`sidebar-nav-item${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      <Sun className="sidebar-nav-icon" size={16} />
      Solar
      {badge === 'locked' && <Lock size={12} aria-label="Solar is locked" style={{ marginLeft: 'auto', opacity: 0.7 }} />}
      {badge === 'pending' && <Clock size={12} aria-label="Solar access request pending" style={{ marginLeft: 'auto', opacity: 0.7 }} />}
    </Link>
  )
}
