'use client'
/**
 * The ONE load-basis control (spec §4.2 "Load basis select at the top of the tab"). Changing it saves on
 * the loaded version (stale refused) and immediately rebuilds the site profile, because the basis
 * changes the series (spec §4.5 "Saving recomputes solar.site_load").
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LOAD_BASIS_OPTIONS, type LoadBasisChoice } from '@esite/shared'
import { saveLoadBasisAction } from '@/actions/solar-load.actions'
import { useRebuild } from '@/lib/solar/load/use-rebuild'
import { useResyncedState } from '@/lib/solar/use-resynced-state'
import { RebuildStatus } from './RebuildStatus'

export function LoadBasisBar({ projectId, basis, updatedAt, canEdit, hint }: {
  projectId: string; basis: LoadBasisChoice | ''; updatedAt: string | null; canEdit: boolean; hint: string | null
}) {
  const router = useRouter()
  // This bar stays mounted across ?tab=, while the settings / common-area / waiver editors save the
  // same study row: re-seed from the refreshed props so the next change carries the current version.
  const [value, setValue] = useResyncedState<LoadBasisChoice | ''>(basis, updatedAt)
  const [version, setVersion] = useResyncedState(updatedAt, updatedAt)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { state, run } = useRebuild(projectId)
  const label = LOAD_BASIS_OPTIONS.find((o) => o.value === value)?.label ?? 'Not chosen — Sum of tenants is used'

  if (!canEdit) {
    return <p style={{ fontSize: 13, margin: '8px 0' }}><strong>Load basis:</strong> {label}</p>
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '8px 0' }}>
      <label htmlFor="load-basis" style={{ fontSize: 13, fontWeight: 600 }}>Load basis</label>
      <select id="load-basis" value={value} disabled={saving || state.running}
        onChange={async (e) => {
          const next = e.target.value as LoadBasisChoice
          const prev = value
          setValue(next)
          setError(null)
          setSaving(true)
          const r = await saveLoadBasisAction({ projectId, basis: next, expectedUpdatedAt: version })
          setSaving(false)
          if ('error' in r) { setValue(prev); setError(r.error); return }
          setVersion(r.updatedAt)
          router.refresh()
          await run()
        }}>
        {value === '' && <option value="">Choose…</option>}
        {LOAD_BASIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {saving && <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>Saving…</span>}
      {hint && <span style={{ fontSize: 12, color: 'var(--c-amber)' }}>{hint}</span>}
      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13, width: '100%', margin: 0 }}>{error}</p>}
      <div style={{ width: '100%' }}><RebuildStatus state={state} /></div>
    </div>
  )
}
