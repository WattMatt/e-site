import Link from 'next/link'
import type { ReadinessStep } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { StatusDot } from './StatusDot'

/** Overview checklist (spec §2.2): one row per step, same rules as the tab dots. */
export function ReadinessChecklist({ projectId, steps }: { projectId: string; steps: ReadinessStep[] }) {
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Readiness</span></CardHeader>
      <CardBody>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {steps.map((s) => (
            <li key={s.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--c-border)', fontSize: 13 }}>
              <StatusDot status={s.status} reason={s.reason} />
              {s.live
                ? <Link href={`/projects/${projectId}/solar/${s.slug}`}>{s.label}</Link>
                : <span style={{ color: 'var(--c-text-dim)' }}>{s.label}</span>}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-text-dim)' }}>{s.reason}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}
