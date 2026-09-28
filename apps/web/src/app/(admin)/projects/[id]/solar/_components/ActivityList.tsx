import Link from 'next/link'
import { formatSolarDate } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import type { SolarActivityItem } from '@/lib/solar/activity-types'

/** Recent activity (spec §2.1 item 4, §2.2 "Activity item"). */
export function ActivityList({ projectId, items, isGrantor }: { projectId: string; items: SolarActivityItem[]; isGrantor: boolean }) {
  const hrefFor = (target: SolarActivityItem['target']): string | null => {
    if (target === 'site') return `/projects/${projectId}/solar/site`
    if (target === 'access' && isGrantor) return `/projects/${projectId}/solar/access`
    return null
  }
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Recent activity</span></CardHeader>
      <CardBody>
        {items.length === 0
          ? <p style={{ fontSize: 13, color: 'var(--c-text-dim)', margin: 0 }}>No activity yet</p>
          : <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {items.map((it) => {
                const href = hrefFor(it.target)
                return (
                  <li key={it.id} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--c-border)', fontSize: 13 }}>
                    <span style={{ color: 'var(--c-text-dim)', minWidth: 160 }}>{`${formatSolarDate(it.at)} · ${it.actorName}`}</span>
                    {href ? <Link href={href}>{it.text}</Link> : <span>{it.text}</span>}
                  </li>
                )
              })}
            </ul>}
      </CardBody>
    </Card>
  )
}
