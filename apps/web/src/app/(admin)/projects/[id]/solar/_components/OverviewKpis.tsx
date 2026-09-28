import Link from 'next/link'
import { BarChart3 } from 'lucide-react'
import type { SolarAccessLevel } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'

/**
 * Headline KPIs of the selected case (spec §2.4) — in Phase 1 no case can
 * exist, so this is the empty state plus the §2.2 case controls in their
 * documented disabled states. Controls above the caller's level are hidden:
 * "Change selected case" needs Edit; "Generate feasibility report" needs Edit
 * AND financials.
 */
export function OverviewKpis({ projectId, level }: { projectId: string; level: SolarAccessLevel }) {
  const canWrite = level === 'edit' || level === 'edit_financials'
  const canMoney = level === 'edit_financials'
  return (
    <Card>
      <CardHeader><span className="data-panel-title">Headline results</span></CardHeader>
      <CardBody>
        <EmptyState
          icon={BarChart3}
          dense
          title="No case has been run yet — start at Site & Supply."
          action={<Link href={`/projects/${projectId}/solar/site`}>Go to Site & Supply</Link>}
        />
        {canWrite && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <label htmlFor="solar-selected-case" style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>Change selected case</label>
            <select id="solar-selected-case" disabled>
              <option>No completed runs</option>
            </select>
            <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Run a case on Yield & Scenarios first</span>
            {canMoney && (
              <Button type="button" size="sm" variant="secondary" disabled title="Available once a case has been run">
                Generate feasibility report
              </Button>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
