'use client'
/**
 * Import a programme (spec §14.1): CSV / XLSX / MS Project XML. The file is
 * parsed on the server (POST …/schedule/import/parse); column mapping, preview
 * and validation (dates, loops) happen here; the commit is ONE transaction.
 * Replace is a two-step confirm that says how many tasks it removes.
 *
 * Owners (owner decision Q5): the server matches email first, then a unique
 * full name, against the Solar-ELIGIBLE list (Q4). Every row it could not
 * match is LISTED here after the import — never silently dropped — and the
 * dialog stays open until the user has read it. Not undoable (Q8): the parent
 * says so.
 */
import { useMemo, useState } from 'react'
import {
  GANTT_STATUS_LABELS, IMPORT_FIELDS, IMPORT_FIELD_LABELS, formatCalendarDate, mapImportTable, validateImportPlan,
  type ImportIssue, type ImportMapping, type ImportPlan, type WorkCalendar,
} from '@esite/shared'
import { commitScheduleImportAction, type UnmatchedOwnerRow } from '@/actions/solar-schedule-import.actions'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

type Parsed = { kind: 'table'; rows: string[][]; mapping: ImportMapping } | { kind: 'plan'; plan: ImportPlan; issues: ImportIssue[] }

export interface ImportDialogProps {
  projectId: string
  cal: WorkCalendar
  existingCount: number
  onClose: () => void
  /** Called once the import is committed, with a sentence for the page. The parent refreshes; closing is onClose. */
  onImported: (message: string) => void
}

const PREVIEW_ROWS = 20

export function ImportDialog({ projectId, cal, existingCount, onClose, onImported }: ImportDialogProps) {
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [mapping, setMapping] = useState<ImportMapping | null>(null)
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [unmatched, setUnmatched] = useState<UnmatchedOwnerRow[] | null>(null)
  const confirm = useArmedConfirm()

  async function upload(file: File) {
    setError(null)
    setParsed(null)
    setMapping(null)
    setBusy(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch(`/api/projects/${projectId}/solar/schedule/import/parse`, { method: 'POST', body: fd })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) { setError(typeof body?.error === 'string' ? body.error : 'That file could not be read.'); return }
      if (body.kind === 'table' && Array.isArray(body.rows) && body.rows.length > 0) {
        setParsed({ kind: 'table', rows: body.rows, mapping: body.mapping })
        setMapping(body.mapping as ImportMapping)
      } else if (body.kind === 'plan') {
        setParsed({ kind: 'plan', plan: body.plan, issues: body.issues ?? [] })
      } else {
        setError('That file has no rows to import.')
      }
    } catch {
      setError('The file could not be uploaded. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const result = useMemo((): { plan: ImportPlan; issues: ImportIssue[] } | null => {
    if (!parsed) return null
    if (parsed.kind === 'plan') return { plan: parsed.plan, issues: parsed.issues }
    const m = mapImportTable(parsed.rows, mapping ?? parsed.mapping, cal)
    return { plan: m.plan, issues: m.issues.length ? m.issues : validateImportPlan(m.plan) }
  }, [parsed, mapping, cal])

  async function commit() {
    if (!result) return
    setError(null)
    setBusy(true)
    const res = await commitScheduleImportAction({ projectId, mode, plan: result.plan })
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    const n = `${res.created} ${res.created === 1 ? 'task' : 'tasks'} imported.`
    const k = res.unmatchedOwners.length
    onImported(k
      ? `${n} ${k} ${k === 1 ? 'owner' : 'owners'} in the file could not be matched to anyone who can own solar tasks on this project, so those tasks went to the default owner.`
      : n)
    if (res.unmatchedRows.length) setUnmatched(res.unmatchedRows)
    else onClose()
  }

  const count = result?.plan.tasks.length ?? 0
  const blocked = !result || result.issues.length > 0 || count === 0 || busy
  const taskNoun = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`
  return (
    <div role="dialog" aria-modal="true" aria-label="Import a programme" style={{ position: 'fixed', inset: 0, background: '#0006', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', padding: 16, borderRadius: 8, width: 760, maxWidth: 'calc(100vw - 32px)', maxHeight: '90vh', overflow: 'auto', fontSize: 13, display: 'grid', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Import a programme</h2>

        {unmatched ? (
          <>
            <p style={{ margin: 0 }}>The import is saved. These tasks name an owner who could not be matched — by email, or by a full name only one person on the project has — to anyone who can own solar tasks here, so they went to the project’s default owner. Reassign them from the schedule.</p>
            <table aria-label="Owners not matched" style={{ fontSize: 12, borderCollapse: 'collapse' }}>
              <thead><tr>{['Row', 'Task', 'Owner in the file'].map((hd) => <th key={hd} style={{ textAlign: 'left', padding: 3 }}>{hd}</th>)}</tr></thead>
              <tbody>
                {unmatched.map((u, i) => (
                  <tr key={`${u.row ?? 'x'}-${i}`}>
                    <td style={{ padding: 3 }}>{u.row === null ? '—' : String(u.row)}</td>
                    <td style={{ padding: 3 }}>{u.task}</td>
                    <td style={{ padding: 3 }}>{u.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-primary-amber" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <label>Programme file <input type="file" accept=".csv,.xlsx,.xml" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} /></label>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--c-text-dim)' }}>
              CSV or Excel with a header row (Task, Start, End or Duration, Owner, Predecessors like 3FS+2d …), or a Microsoft Project XML file. Dates like 2026-10-01 or 01/10/2026. Owners are matched by email, then by full name.
            </p>
            {error && <div role="alert" style={{ color: 'var(--c-red)' }}>{error}</div>}

            {parsed?.kind === 'table' && mapping && (
              <fieldset style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
                <legend>Columns</legend>
                {IMPORT_FIELDS.map((f) => (
                  <label key={f} style={{ fontSize: 12 }}>{IMPORT_FIELD_LABELS[f]}{' '}
                    <select aria-label={`${IMPORT_FIELD_LABELS[f]} column`} value={mapping[f] ?? ''}
                      onChange={(e) => { confirm.disarm(); setMapping({ ...mapping, [f]: e.target.value === '' ? null : Number(e.target.value) }) }}>
                      <option value="">—</option>
                      {parsed.rows[0].map((hd, i) => <option key={i} value={i}>{hd || `Column ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </fieldset>
            )}

            {result && (
              <>
                {result.issues.length > 0 ? (
                  <ul role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>
                    {result.issues.slice(0, 20).map((i, k) => <li key={`${k}-${i.message}`}>{i.message}</li>)}
                    {result.issues.length > 20 && <li>{`…and ${result.issues.length - 20} more problems.`}</li>}
                  </ul>
                ) : (
                  <p role="status" style={{ margin: 0 }}>{`${taskNoun(count)} ready to import`}</p>
                )}
                {count > 0 && (
                  <table aria-label="Preview" style={{ fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead><tr>{['Task', 'Category', 'Start', 'End', 'Status', 'Owner'].map((hd) => <th key={hd} style={{ textAlign: 'left', padding: 3 }}>{hd}</th>)}</tr></thead>
                    <tbody>
                      {result.plan.tasks.slice(0, PREVIEW_ROWS).map((t) => (
                        <tr key={t.key}>
                          <td style={{ padding: 3 }}>{t.isMilestone ? `◆ ${t.name}` : t.name}</td>
                          <td style={{ padding: 3 }}>{t.category}</td>
                          <td style={{ padding: 3 }}>{formatCalendarDate(t.start)}</td>
                          <td style={{ padding: 3 }}>{formatCalendarDate(t.end)}</td>
                          <td style={{ padding: 3 }}>{GANTT_STATUS_LABELS[t.status]}</td>
                          <td style={{ padding: 3 }}>{t.ownerHint ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {count > PREVIEW_ROWS && <p style={{ margin: 0, fontSize: 11 }}>{`…and ${count - PREVIEW_ROWS} more.`}</p>}
                <div role="radiogroup" aria-label="Import mode">
                  <label><input type="radio" name="import-mode" checked={mode === 'append'} onChange={() => { setMode('append'); confirm.disarm() }} /> Add to the programme</label>{' '}
                  {existingCount > 0 && <label><input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace the whole programme</label>}
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button type="button" onClick={onClose}>Cancel</button>
              {mode === 'append' || existingCount === 0 ? (
                <button type="button" className="btn-primary-amber" disabled={blocked} onClick={() => void commit()}>{`Import ${taskNoun(count)}`}</button>
              ) : confirm.armed ? (
                <button type="button" className="btn-primary-amber" disabled={blocked} onClick={() => { confirm.disarm(); void commit() }}>Confirm replace</button>
              ) : (
                <button type="button" disabled={blocked} onClick={confirm.arm}>{`Replace: remove ${taskNoun(existingCount)} and import ${count}`}</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
