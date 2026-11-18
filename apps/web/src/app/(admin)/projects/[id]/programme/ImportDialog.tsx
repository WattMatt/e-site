'use client'

/**
 * Import from MS Project (P4a): a main contractor's programme saved as MSPDI XML
 * (File → Save As → XML Format).
 *
 * 1. Choose the file. Only `.xml` is read; an `.mpp` (or anything else) gets the export sentence.
 * 2. The browser reads it as text, parses it (`parseMspdiText`, DOMParser) and plans it against
 *    the screen's state (`planImport`, matched by MS Project UID). Nothing is applied yet.
 * 3. The preview shows the diff counts (each with its list), warnings grouped by kind, what the
 *    parser skipped, the data date change, and the file's date range against the finish the
 *    E-Site engine works out — `applyOps` + `scheduleProgramme` on a COPY of the state.
 * 4. Import is ONE store gesture (`apply(ops, 'Import <label>')`), so it goes on the undo stack
 *    like any edit. Once the save has settled, `recordImportAction` writes the revision record
 *    (imports row + active revision baseline), then the page refreshes. A refusal is shown as the
 *    sentence; the store has already rolled back. A failed record leaves the import standing, and
 *    the dialog then offers "Record the revision again": it re-sends the KEPT diff and label and
 *    never applies the plan a second time (the activities already hold those UIDs).
 * 5. After any finished or failed import the file input is cleared, so the same file can be
 *    chosen again.
 *
 * Everything from the file reaches the DOM as text, never as HTML.
 */
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  applyOps, parseMspdiText, planImport, ProgrammeOpError, rowsToProgrammeInput, scheduleProgramme,
  type ImportDiff, type ImportPlan, type MspdiProgramme, type ProgrammeState,
} from '@esite/shared/programme'
import { recordImportAction } from '@/actions/programme.actions'
import type { ProgrammeStoreApi } from './use-programme-store'

export const MPP_REFUSED = 'Open the programme in MS Project and use File → Save As → XML Format, then import the .xml file.'
export const LABEL_REQUIRED = 'Give this revision a label.'
const READ_FAILED = 'The file could not be read. Try again.'
const IMPORT_FAILED = 'The import was not applied.'
const RECORD_FAILED = 'The programme was imported, but the revision record was not saved. Record it again.'
const PREVIEW_FAILED = 'The programme could not be worked out with this file.'

export const RECORD_AGAIN = 'Record the revision again'

export type ImportStore = Pick<ProgrammeStoreApi, 'state' | 'apply' | 'newKey' | 'settle' | 'stale'>

const button: CSSProperties = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid var(--c-border)', background: 'var(--c-panel)',
  color: 'var(--c-text)', fontSize: 13, cursor: 'pointer',
}
const dim: CSSProperties = { color: 'var(--c-text-dim)', fontSize: 12 }

/** The kinds warnings are grouped under, matched on the parser's and planner's own sentences. */
const WARNING_KINDS: Array<{ kind: string; test: RegExp }> = [
  { kind: 'Progress', test: /actual (start|finish)|percent complete|remaining duration|finished in E-Site/i },
  { kind: 'Links', test: /\blink\b|\blag\b/i },
  { kind: 'Calendars', test: /calendar|exception|work weeks/i },
  { kind: 'Manually scheduled tasks', test: /manually scheduled/i },
  { kind: 'Removed and restored activities', test: /removed|restored|no longer|returned/i },
  { kind: 'Durations and milestones', test: /duration|milestone/i },
  { kind: 'Constraints', test: /constraint/i },
]
export function groupWarnings(warnings: string[]): Array<{ kind: string; items: string[] }> {
  const groups = new Map<string, string[]>()
  for (const w of warnings) {
    const kind = WARNING_KINDS.find((k) => k.test.test(w))?.kind ?? 'Other'
    const list = groups.get(kind) ?? []
    list.push(w)
    groups.set(kind, list)
  }
  const order = [...WARNING_KINDS.map((k) => k.kind), 'Other']
  return order.filter((k) => groups.has(k)).map((kind) => ({ kind, items: groups.get(kind)! }))
}

/** Has this programme ever taken an import? (Tombstoned imported rows count: planImport matches them too.) */
export const isReimport = (state: ProgrammeState) => state.activities.some((a) => a.external_uid !== null)

const stem = (name: string) => name.replace(/\.xml$/i, '').trim()

function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(r.error)
    r.readAsText(file)
  })
}

/** The file's own date range: the earliest start and the latest finish among its tasks. */
function fileRange(m: MspdiProgramme): { start: string; finish: string | null } {
  let start: string = m.startDate
  let finish: string | null = null
  for (const t of m.tasks) {
    if (t.start && t.start < start) start = t.start
    const f = t.finish ?? t.start
    if (f && (finish === null || f > finish)) finish = f
  }
  return { start, finish }
}

type RecordInput = Parameters<typeof recordImportAction>[0]

interface Prepared {
  fileName: string
  m: MspdiProgramme
  plan: ImportPlan
  /** The E-Site finish after the import, or the refusal that stops it. */
  finish: { ok: true; value: string | null } | { ok: false; error: string }
}

function prepare(state: ProgrammeState, fileName: string, m: MspdiProgramme, newKey: () => string): Prepared {
  const plan = planImport(state, m, newKey)
  let finish: Prepared['finish']
  try {
    const next = applyOps(state, plan.ops)
    const sched = scheduleProgramme(rowsToProgrammeInput(next))
    const first = sched.issues.find((i) => i.severity === 'error')
    finish = first ? { ok: false, error: first.message } : { ok: true, value: sched.projectFinish }
  } catch (e) {
    finish = { ok: false, error: e instanceof ProgrammeOpError ? e.message : PREVIEW_FAILED }
  }
  return { fileName, m, plan, finish }
}

/** The project start a first import sets, when it moves. */
export function projectStartMove(state: ProgrammeState, plan: ImportPlan): { from: string; to: string } | null {
  for (const op of plan.ops) {
    if (op.op !== 'set_programme') continue
    const to = (op.fields as Record<string, unknown>).project_start
    if (typeof to === 'string' && to !== state.programme.project_start) return { from: state.programme.project_start, to }
  }
  return null
}

/** Live activities made in E-Site (not from a file). */
export const nativeActivityCount = (state: ProgrammeState) =>
  state.activities.filter((a) => a.external_uid === null && !a.is_tombstoned).length

function CountList({ label, count, children }: { label: string; count: number; children?: ReactNode }) {
  if (count === 0 || !children) return <li data-testid={`import-count-${label}`}>{label}: {count}</li>
  return (
    <li data-testid={`import-count-${label}`}>
      <details>
        <summary>{label}: {count}</summary>
        <ul style={{ ...dim, maxHeight: 180, overflow: 'auto', margin: '4px 0' }}>{children}</ul>
      </details>
    </li>
  )
}

function DiffView({ diff }: { diff: ImportDiff }) {
  const item = (a: { uid: string; name: string }, extra?: string) => (
    <li key={a.uid}>{a.name} <span>(UID {a.uid}){extra ? ` — ${extra}` : ''}</span></li>
  )
  return (
    <ul data-testid="import-diff" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 2 }}>
      <CountList label="Added" count={diff.added.length}>{diff.added.map((a) => item(a))}</CountList>
      <CountList label="Changed" count={diff.changed.length}>{diff.changed.map((a) => item(a, a.fields.join(', ')))}</CountList>
      <CountList label="Removed" count={diff.removed.length}>{diff.removed.map((a) => item(a))}</CountList>
      <CountList label="Unchanged" count={diff.unchanged} />
      <CountList label="Links added" count={diff.linksAdded} />
      <CountList label="Links changed" count={diff.linksChanged} />
      <CountList label="Links removed" count={diff.linksRemoved} />
      {diff.calendarChanged && <li>The project calendar changes.</li>}
      {diff.dataDate && <li data-testid="import-data-date">Data date: {diff.dataDate.from ?? 'none'} → {diff.dataDate.to}</li>}
    </ul>
  )
}

export function ImportDialog({ store, onClose }: { store: ImportStore; onClose: () => void }) {
  const router = useRouter()
  const reimport = useMemo(() => isReimport(store.state), [store.state])
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Set once the save stood but the revision record failed: what the retry re-sends. */
  const [pendingRecord, setPendingRecord] = useState<RecordInput | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const clearFile = () => { if (fileInput.current) fileInput.current.value = '' }

  async function record(input: RecordInput): Promise<boolean> {
    let r: Awaited<ReturnType<typeof recordImportAction>>
    try {
      r = await recordImportAction(input)
    } catch {
      r = { ok: false, error: RECORD_FAILED }
    }
    if (!r.ok) {
      // The save stood; only the record is owed. Never re-apply the plan.
      setPendingRecord(input)
      setError(r.error)
      router.refresh()
      return false
    }
    setPendingRecord(null)
    router.refresh()
    onClose()
    return true
  }

  async function recordAgain() {
    if (!pendingRecord || busy) return
    setBusy(true)
    setError(null)
    try {
      await record(pendingRecord)
    } catch {
      setError(IMPORT_FAILED)
    } finally {
      setBusy(false)
    }
  }

  async function choose(file: File | undefined) {
    setPrepared(null)
    setError(null)
    if (!file) return
    if (!/\.xml$/i.test(file.name)) { setError(MPP_REFUSED); clearFile(); return }
    let text: string
    try {
      text = await readText(file)
    } catch {
      setError(READ_FAILED)
      clearFile()
      return
    }
    const m = parseMspdiText(text)
    if ('error' in m) { setError(m.error); clearFile(); return }
    setPrepared(prepare(store.state, file.name, m, store.newKey))
    setLabel(stem(file.name))
  }

  async function runImport() {
    if (!prepared || busy) return
    const revision = label.trim()
    if (reimport && revision === '') { setError(LABEL_REQUIRED); return }
    if (!prepared.finish.ok) { setError(prepared.finish.error); return }
    setBusy(true)
    setError(null)
    try {
      const { ops, diff } = prepared.plan
      if (ops.length > 0) {
        const applied = store.apply(ops, `Import ${revision || prepared.fileName}`)
        const settled = await store.settle()
        if (!applied || !settled.ok) { setError(settled.error ?? IMPORT_FAILED); return }
      }
      await record({
        programmeId: store.state.programme.id, fileName: prepared.fileName, revisionLabel: revision === '' ? null : revision, diff,
      })
    } catch {
      setError(IMPORT_FAILED)
    } finally {
      clearFile()
      setBusy(false)
    }
  }

  const range = prepared ? fileRange(prepared.m) : null
  const warnings = prepared ? groupWarnings([...prepared.m.warnings, ...prepared.plan.warnings]) : []
  const skipped = prepared?.m.skipped
  const startMove = prepared ? projectStartMove(store.state, prepared.plan) : null
  const natives = prepared ? nativeActivityCount(store.state) : 0

  return (
    <div role="dialog" aria-modal="true" aria-label="Import from MS Project" data-testid="programme-import"
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,0.45)', padding: 16 }}>
      <div className="card" style={{ width: 'min(640px, 100%)', maxHeight: '90vh', overflow: 'auto', padding: 16, display: 'grid', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Import from MS Project</h2>
        <p style={dim}>In MS Project use File → Save As → XML Format, then choose the .xml file here.
          {reimport ? ' This programme has been imported before: activities are matched by their MS Project UID.' : ''}</p>
        <label className="field">
          <span>MS Project XML file</span>
          <input ref={fileInput} type="file" accept=".xml,application/xml,text/xml" aria-label="MS Project XML file"
            disabled={busy || pendingRecord !== null}
            onChange={(e) => { void choose(e.target.files?.[0]) }} />
        </label>

        {prepared && (
          <div data-testid="import-preview" style={{ display: 'grid', gap: 10, fontSize: 13 }}>
            <div><strong>{prepared.m.name || prepared.fileName}</strong></div>
            <DiffView diff={prepared.plan.diff} />
            {startMove && (
              <div data-testid="import-project-start">Project start: {startMove.from} → {startMove.to}</div>
            )}
            {natives > 0 && !reimport && (
              <div data-testid="import-native" role="note">
                This programme already has {natives} E-Site {natives === 1 ? 'activity' : 'activities'}. They stay, and the
                imported activities are added beside them{startMove ? '; work without a constraint moves with the project start' : ''}.
              </div>
            )}
            {range && (
              <div data-testid="import-dates">
                File: {range.start} to {range.finish ?? '—'}
                {' · '}E-Site finish after import: {prepared.finish.ok ? (prepared.finish.value ?? '—') : '—'}
              </div>
            )}
            {skipped && (skipped.inactive > 0 || skipped.nulls > 0) && (
              <div data-testid="import-skipped" style={dim}>
                Skipped: {skipped.inactive} inactive {skipped.inactive === 1 ? 'task' : 'tasks'}, {skipped.nulls} blank {skipped.nulls === 1 ? 'row' : 'rows'}.
              </div>
            )}
            {warnings.length > 0 && (
              <div data-testid="import-warnings">
                <strong>Warnings</strong>
                {warnings.map((g) => (
                  <details key={g.kind}>
                    <summary>{g.kind} ({g.items.length})</summary>
                    <ul style={{ ...dim, margin: '4px 0' }}>{g.items.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </details>
                ))}
              </div>
            )}
            {prepared.plan.ops.length === 0 && <div style={dim}>Nothing changes: the file matches the programme. Importing records the revision only.</div>}
            <label className="field">
              <span>Revision label{reimport ? '' : ' (optional)'}</span>
              <input className="input" aria-label="Revision label" value={label} maxLength={120} required={reimport}
                disabled={busy || pendingRecord !== null}
                onChange={(e) => setLabel(e.target.value)} />
            </label>
          </div>
        )}

        {error && <p role="alert" data-testid="import-error" style={{ color: 'var(--c-red)', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" style={button} onClick={onClose} disabled={busy}>Cancel</button>
          {pendingRecord ? (
            <button type="button" className="btn btn-primary" onClick={() => void recordAgain()} disabled={busy}>
              {busy ? 'Recording…' : RECORD_AGAIN}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => void runImport()}
              disabled={!prepared || busy || store.stale || (prepared && !prepared.finish.ok)}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
