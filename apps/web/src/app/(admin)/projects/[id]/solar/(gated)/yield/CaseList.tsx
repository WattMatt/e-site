'use client'
/** Case list (functional spec §7.1). Controls above the caller's level are hidden, not disabled. */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { SolarAccessLevel } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { deleteSolarCaseAction, duplicateSolarCaseAction, renameSolarCaseAction, setSelectedSolarCaseAction } from '@/actions/solar-cases.actions'
import type { CaseCardView } from '@/lib/solar/cases/page-data'
import { useArmedConfirm } from '../../_components/useArmedConfirm'
import { mwh, num, rand, sastDateTime } from '@/components/solar/format'
import { NewCaseDialog } from './NewCaseDialog'

const STATUS_VARIANT = { not_run: 'ghost', running: 'info', done: 'success', failed: 'danger', stale: 'warning' } as const
type ActionOutcome = { error?: string; fieldErrors?: Record<string, string> }

function Card({ c, projectId, canWrite, studyUpdatedAt, ticked, onTick, open }: { c: CaseCardView; projectId: string; canWrite: boolean; studyUpdatedAt: string | null; ticked: boolean; onTick: () => void; open: boolean }) {
  const router = useRouter()
  const del = useArmedConfirm()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(c.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    const r = (await fn()) as ActionOutcome
    setBusy(false)
    if (r.error) setError(r.error)
    else if (r.fieldErrors) setError(Object.values(r.fieldErrors)[0] ?? 'Check the form.')
    else { setRenaming(false); router.refresh() }
  }
  return (
    <li style={{ border: `1px solid ${open ? 'var(--c-amber)' : 'var(--c-border, #e5e7eb)'}`, borderRadius: 8, padding: 12, display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="checkbox" aria-label={`Compare ${c.name}`} checked={ticked} onChange={onTick} />
        {renaming
          ? <input aria-label="New name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          : <Link href={`/projects/${projectId}/solar/yield?case=${c.id}`} style={{ fontWeight: 600 }}>{c.name}</Link>}
        <Badge variant={STATUS_VARIANT[c.status]}>{c.statusLabel}</Badge>
        {c.selected && <Badge variant="info">Selected</Badge>}
      </div>
      <span>{`${num(c.dcKwp)} kWp · ${num(c.acKw)} kW AC`}</span>
      {c.batteryKwh !== null && <span>{`Battery ${num(c.batteryKwh)} kWh`}</span>}
      {c.annualPvKwh !== null && <span>{`${mwh(c.annualPvKwh)}/yr`}</span>}
      {c.year1SavingZar !== null && <span>{`Year-1 bill saving ${rand(c.year1SavingZar)}`}</span>}
      {c.lastRunAt && <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Last run {sastDateTime(c.lastRunAt)}</span>}
      {canWrite && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => act(() => duplicateSolarCaseAction({ projectId, caseId: c.id }))}>Duplicate</Button>
          {renaming
            ? <Button type="button" size="sm" disabled={busy} onClick={() => act(() => renameSolarCaseAction({ projectId, caseId: c.id, name, expectedUpdatedAt: c.updatedAt }))}>Save name</Button>
            : <Button type="button" size="sm" variant="secondary" onClick={() => setRenaming(true)}>Rename</Button>}
          <Button type="button" size="sm" variant="secondary" disabled={busy || c.selected || !c.canSelect || !studyUpdatedAt}
            title={c.canSelect ? undefined : 'Run this case first'}
            onClick={() => act(() => setSelectedSolarCaseAction({ projectId, caseId: c.id, expectedUpdatedAt: studyUpdatedAt! }))}>Set as selected</Button>
          <Button type="button" size="sm" variant={del.armed ? 'danger' : 'secondary'} disabled={busy}
            onClick={() => {
              if (!del.armed) { del.arm(); return }
              del.disarm()
              void act(() => deleteSolarCaseAction({ projectId, caseId: c.id }))
            }}>
            {del.armed ? `Delete “${c.name}”?` : 'Delete'}
          </Button>
        </div>
      )}
      {error && <span role="alert" style={{ color: 'var(--c-red, #dc2626)', fontSize: 12 }}>{error}</span>}
    </li>
  )
}

export function CaseList({ projectId, level, cases, studyUpdatedAt, openCaseId }: { projectId: string; level: SolarAccessLevel; cases: CaseCardView[]; studyUpdatedAt: string | null; openCaseId: string | null }) {
  const router = useRouter()
  const canWrite = level !== 'view'
  const [ticked, setTicked] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  return (
    <section aria-label="Cases" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {canWrite && <Button type="button" onClick={() => setAdding(true)}>New case</Button>}
        <Button type="button" variant="secondary" disabled={ticked.length < 2 || ticked.length > 4}
          title="Tick 2 to 4 cases" onClick={() => router.push(`/projects/${projectId}/solar/yield?compare=${ticked.join(',')}`)}>Compare</Button>
      </div>
      {adding && <NewCaseDialog projectId={projectId} cases={cases.map((c) => ({ id: c.id, name: c.name }))} onClose={() => setAdding(false)} />}
      {cases.length === 0
        ? <EmptyState dense title="No cases yet" description="A case is one design option: a system size, losses, battery and export settings." />
        : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {cases.map((c) => (
              <Card key={c.id} c={c} projectId={projectId} canWrite={canWrite} studyUpdatedAt={studyUpdatedAt} open={c.id === openCaseId}
                ticked={ticked.includes(c.id)} onTick={() => setTicked((t) => (t.includes(c.id) ? t.filter((x) => x !== c.id) : [...t, c.id]))} />
            ))}
          </ul>
        )}
    </section>
  )
}
