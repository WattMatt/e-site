'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { STAGES, type Stage } from '@esite/shared'

const LABEL: Record<Stage, string> = {
  plan: 'Plan',
  quote: 'Quote',
  order: 'Order',
  deliver: 'Deliver',
  pay: 'Pay',
}

export function SubNavPills({
  projectId,
  counts,
}: {
  projectId: string
  counts: Record<Stage, number>
}) {
  const pathname = usePathname()
  const base = `/projects/${projectId}/materials`

  const linkClass = (href: string): string => {
    const active = pathname === href
    return active ? 'badge badge-success' : 'badge badge-neutral'
  }

  return (
    <nav style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
      <Link href={base} className={linkClass(base)}>
        Hub
      </Link>
      {STAGES.map((stage) => {
        const href = `${base}/${stage}`
        return (
          <Link key={stage} href={href} className={linkClass(href)}>
            {LABEL[stage]}{' '}
            <span style={{ opacity: 0.7, marginLeft: '0.25rem' }}>{counts[stage]}</span>
          </Link>
        )
      })}
    </nav>
  )
}
