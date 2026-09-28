'use client'
/**
 * Schematics list (functional spec §13.1). Edit: add, replace drawing, delete selected, the
 * "No schematic required" waiver. View: the list and the saved sheets, no controls.
 * Delete, waiver and replace are two-step inline confirms (never window.confirm).
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { deleteSchematicsAction, setSchematicWaivedAction } from '@/actions/solar-schematics.actions'
import { useArmedConfirm } from '@/app/(admin)/projects/[id]/solar/_components/useArmedConfirm'
import { SavedReportsPanel } from '@/components/reports/SavedReportsPanel'
import type { SchematicsListView } from '@/lib/solar/schematics/view-types'
import { useResyncedState } from '@/lib/solar/use-resynced-state'
import { AddSchematicDialog } from './AddSchematicDialog'
import { ReplaceDrawingDialog } from './ReplaceDrawingDialog'

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-ZA') }

export function SchematicsList({ projectId, view, canEdit }: { projectId: string; view: SchematicsListView; canEdit: boolean }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [replacing, setReplacing] = useState<{ id: string; updatedAt: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // The waiver lives on the study row the Load page also saves: re-seed on its version.
  const [waived, setWaived] = useResyncedState(view.waived, view.studyUpdatedAt)
  const [version, setVersion] = useResyncedState(view.studyUpdatedAt, view.studyUpdatedAt)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const confirmDel = useArmedConfirm()
  const confirmWaive = useArmedConfirm()
  const n = selected.size

  async function setWaiver(next: boolean) {
    setBusy(true); setError(null)
    const r = await setSchematicWaivedAction({ projectId, waived: next, expectedUpdatedAt: version })
    setBusy(false)
    if ('error' in r) { setError(r.error); return }
    setWaived(next); setVersion(r.updatedAt); router.refresh()
  }

  return (
    <div style={{ display: 'grid', gap: 12, fontSize: 13 }}>
      {canEdit && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <button type="button" onClick={() => setAdding(true)}>Add schematic</button>
          {n > 0 && (!confirmDel.armed
            ? <button type="button" onClick={confirmDel.arm}>{`Delete selected (${n})`}</button>
            : <button type="button" style={{ color: '#dc2626' }} disabled={busy} onClick={async () => {
                confirmDel.disarm(); setBusy(true); setError(null)
                const r = await deleteSchematicsAction({ projectId, ids: [...selected] })
                setBusy(false)
                if ('error' in r) setError(r.error); else { setSelected(new Set()); router.refresh() }
              }}>{`Delete ${n} schematic${n === 1 ? '' : 's'}?`}</button>)}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            {waived ? (
              <>
                <span>Marked &quot;No schematic required&quot;.</span>
                <button type="button" disabled={busy} onClick={() => void setWaiver(false)}>A schematic is required</button>
              </>
            ) : !confirmWaive.armed
              ? <button type="button" disabled={busy} onClick={confirmWaive.arm}>No schematic required</button>
              : <button type="button" style={{ color: '#d97706' }} disabled={busy} onClick={() => { confirmWaive.disarm(); void setWaiver(true) }}>Mark &quot;No schematic required&quot;?</button>}
          </span>
        </div>
      )}
      {!canEdit && waived && <p style={{ margin: 0 }}>Marked &quot;No schematic required&quot;.</p>}
      {error && <p role="alert" style={{ color: '#dc2626', margin: 0 }}>{error}</p>}
      {view.schematics.length === 0 ? (
        <p style={{ color: 'var(--c-text-mid)', margin: 0 }}>Add a single-line diagram from the project&apos;s drawings</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead><tr>{canEdit && <th />}<th align="left">Name</th><th align="left">Source drawing</th><th align="right">Meters placed</th><th align="left">Updated</th>{canEdit && <th />}</tr></thead>
            <tbody>
              {view.schematics.map((s) => (
                <tr key={s.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                  {canEdit && <td><input type="checkbox" aria-label={`Select ${s.name}`} checked={selected.has(s.id)} onChange={(e) => { confirmDel.disarm(); setSelected((p) => { const x = new Set(p); if (e.target.checked) x.add(s.id); else x.delete(s.id); return x }) }} /></td>}
                  <td><Link href={`/projects/${projectId}/solar/schematics/${s.id}`}>{s.name}</Link>{s.description ? <span style={{ color: 'var(--c-text-dim)' }}> — {s.description}</span> : null}</td>
                  <td>{s.kind === 'blank' ? 'Blank canvas' : `${s.drawingName} · page ${s.pageIndex}`}</td>
                  <td align="right">{`${s.placed} / ${view.studyMeterCount}`}</td>
                  <td>{when(s.updatedAt)}</td>
                  {canEdit && <td>{s.kind === 'drawing' && <button type="button" onClick={() => setReplacing({ id: s.id, updatedAt: s.updatedAt })}>Replace drawing</button>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SavedReportsPanel projectId={projectId} kind="solar_schematic_sheet" canManage={canEdit} title="Exported schematic sheets" />
      {adding && <AddSchematicDialog projectId={projectId} drawings={view.drawings} onClose={() => setAdding(false)} />}
      {replacing && <ReplaceDrawingDialog projectId={projectId} schematicId={replacing.id} expectedUpdatedAt={replacing.updatedAt} drawings={view.drawings}
        onClose={() => setReplacing(null)} onDone={() => { setReplacing(null); router.refresh() }} />}
    </div>
  )
}
