'use client'

/**
 * The programme toolbar. Two rows, grouped by what they do:
 *
 * - Edit (only with `canEdit`): Undo / Redo, Add task / milestone, Indent / Outdent, Delete (with
 *   its two-step inline confirm), Recalculate, the data date.
 * - View (everyone who can see the programme): programme switcher, zoom, Scroll to today, Fit
 *   programme, Columns, Group by, filters, the baselines list, and the summary chip.
 *
 * The grid's and the timeline's own buttons used to sit in a footer under each pane. They are
 * here now: the panes register commands in refs (`bridge.ts`) and the buttons call them.
 * `GridControls` and `TimelineControls` are exported so those pieces can be driven alone.
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { ZOOMS } from './timeline-geometry'
import type { Zoom } from '@esite/shared/programme'
import { recalculateProgrammeAction } from '@/actions/programme.actions'
import type { BaselineSummary, ProgrammeSummary } from '@/lib/programme/view-types'
import type { ProgrammeStoreApi } from './use-programme-store'
import { GRID_COLUMNS, type ColumnId } from './GanttGrid'
import { filtersActive, GROUP_BY_WBS, NO_FILTERS, summaryOf, type Filters, type GroupBy } from './display-rows'
import { BaselinesMenu } from './BaselinesMenu'
import type { CommandsRef, GridCommands, GridUi, TimelineCommands } from './bridge'

const button: CSSProperties = {
  padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', background: 'var(--c-panel)',
  color: 'var(--c-text)', fontSize: 12, cursor: 'pointer',
}
const dim: CSSProperties = { color: 'var(--c-text-dim)', fontSize: 12 }
const field: CSSProperties = {
  padding: '3px 6px', borderRadius: 6, border: '1px solid var(--c-border)', background: 'var(--c-input-bg)',
  color: 'var(--c-text)', fontSize: 12,
}
const group: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }
const plural = (n: number) => (n === 1 ? '1 activity' : `${n} activities`)
const ZOOM_LABEL: Record<Zoom, string> = { day: 'Days', week: 'Weeks', month: 'Months', quarter: 'Quarters', year: 'Years' }

// ── the grid's buttons ──────────────────────────────────────────────────────

export function GridControls({ canEdit, commandsRef, ui, columns }: {
  canEdit: boolean
  commandsRef: CommandsRef<GridCommands>
  ui: GridUi
  columns: { hidden: ColumnId[]; toggle: (id: ColumnId) => void }
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const cmd = () => commandsRef.current
  const none = ui.selectedCount === 0
  return (
    <div style={group}>
      {canEdit && ui.armedCount === null && (
        <>
          <button type="button" style={button} onClick={() => cmd()?.add('task')}>Add task</button>
          <button type="button" style={button} onClick={() => cmd()?.add('milestone')}>Add milestone</button>
          <button type="button" style={button} onClick={() => cmd()?.structure('indent')} disabled={none}
            title="Indent under the row above (⌥⇧→)">Indent</button>
          <button type="button" style={button} onClick={() => cmd()?.structure('outdent')} disabled={none}
            title="Outdent; the rows below it become its sub-activities (⌥⇧←)">Outdent</button>
          <button type="button" style={button} onClick={() => cmd()?.arm()} disabled={none}>Delete</button>
        </>
      )}
      {canEdit && ui.armedCount !== null && (
        <div data-testid="programme-grid-confirm" role="alert" style={{ ...group, fontSize: 12 }}>
          <span>Delete {plural(ui.armedCount)}?{ui.armedCount > ui.selectedCount ? ' Sub-activities go too.' : ''}</span>
          <button type="button" style={{ ...button, borderColor: 'var(--c-red)', color: 'var(--c-red)' }} onClick={() => cmd()?.confirmDelete()}>Confirm delete</button>
          <button type="button" style={button} onClick={() => cmd()?.cancelDelete()}>Cancel</button>
        </div>
      )}
      {canEdit && ui.notice && <span data-testid="programme-grid-notice" role="status" title={ui.notice} style={{ fontSize: 12, color: 'var(--c-red)' }}>{ui.notice}</span>}
      <span style={{ position: 'relative' }}>
        <button type="button" style={button} aria-expanded={pickerOpen} onClick={() => setPickerOpen((o) => !o)}>Columns</button>
        {pickerOpen && (
          <div role="group" aria-label="Columns shown" style={{
            position: 'absolute', left: 0, top: '100%', marginTop: 4, zIndex: 5, padding: 8, borderRadius: 8,
            border: '1px solid var(--c-border)', background: 'var(--c-elevated)', display: 'grid', gap: 4, fontSize: 12,
          }}>
            {GRID_COLUMNS.filter((c) => c.hideable).map((c) => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={!columns.hidden.includes(c.id)} onChange={() => columns.toggle(c.id)} />
                {c.label}
              </label>
            ))}
          </div>
        )}
      </span>
    </div>
  )
}

// ── the timeline's buttons ──────────────────────────────────────────────────

export function TimelineControls({ commandsRef, zoom, onZoom }: {
  commandsRef: CommandsRef<TimelineCommands>
  zoom: Zoom
  onZoom: (zoom: Zoom) => void
}) {
  return (
    <div style={group}>
      <label style={{ ...group, ...dim }}>
        Zoom
        <select aria-label="Zoom" value={zoom} style={field}
          onChange={(e) => {
            const next = e.target.value as Zoom
            if (commandsRef.current) commandsRef.current.setZoom(next)
            else onZoom(next)
          }}>
          {ZOOMS.map((z) => <option key={z} value={z}>{ZOOM_LABEL[z]}</option>)}
        </select>
      </label>
      <button type="button" style={button} onClick={() => commandsRef.current?.scrollToToday()}>Scroll to today</button>
      <button type="button" style={button} onClick={() => commandsRef.current?.fit()}>Fit programme</button>
    </div>
  )
}

// ── the data date ───────────────────────────────────────────────────────────

/** The data date: edited in a draft, applied on Enter or when the field loses focus; empty clears it. */
function DataDateControl({ store }: { store: ToolbarStore }) {
  const current = store.state.programme.data_date ?? ''
  const [draft, setDraft] = useState(current)
  useEffect(() => { setDraft(current) }, [current])
  const commit = () => {
    if (draft === current) return
    if (draft !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(draft)) { setDraft(current); return }
    if (!store.apply([{ op: 'set_programme', fields: { data_date: draft === '' ? null : draft } }], 'Set data date')) setDraft(current)
  }
  return (
    <label style={{ ...group, ...dim }}>
      Data date
      <input type="date" aria-label="Data date" value={draft} style={field}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} />
    </label>
  )
}

// ── the toolbar ─────────────────────────────────────────────────────────────

export type ToolbarStore = Pick<ProgrammeStoreApi,
  'state' | 'schedule' | 'apply' | 'undo' | 'redo' | 'canUndo' | 'canRedo' | 'undoLabel' | 'redoLabel'
  | 'pending' | 'unsaved' | 'stale' | 'version' | 'reload'>

export interface GanttToolbarProps {
  projectId: string
  store: ToolbarStore
  canEdit: boolean
  programmes: ProgrammeSummary[]
  baselines: BaselineSummary[]
  zoom: Zoom
  onZoom: (zoom: Zoom) => void
  gridCommands: CommandsRef<GridCommands>
  gridUi: GridUi
  timelineCommands: CommandsRef<TimelineCommands>
  columns: { hidden: ColumnId[]; toggle: (id: ColumnId) => void }
  filters: Filters
  onFilters: (f: Filters) => void
  groupBy: GroupBy
  onGroupBy: (g: GroupBy) => void
}

export function GanttToolbar(p: GanttToolbarProps) {
  const { store, canEdit } = p
  const router = useRouter()
  const [recalcBusy, setRecalcBusy] = useState(false)
  const [recalcError, setRecalcError] = useState<string | null>(null)
  const summary = summaryOf(store.state, store.schedule)
  const programmeId = store.state.programme.id
  const blocked = store.pending || store.unsaved || store.stale

  const recalculate = async () => {
    if (recalcBusy || blocked) return
    setRecalcBusy(true)
    setRecalcError(null)
    try {
      const r = await recalculateProgrammeAction({ programmeId, expectedVersion: store.version })
      if (r.ok) store.reload()
      else setRecalcError(r.error)
    } catch {
      setRecalcError('The programme could not be recalculated. Try again.')
    } finally {
      setRecalcBusy(false)
    }
  }

  return (
    <div role="toolbar" aria-label="Programme" style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
      <div style={{ ...group, gap: 12 }}>
        {canEdit && (
          <>
            <div style={group}>
              <button type="button" style={button} onClick={store.undo} disabled={!store.canUndo}
                title={store.undoLabel ? `Undo ${store.undoLabel}` : undefined}>Undo</button>
              <button type="button" style={button} onClick={store.redo} disabled={!store.canRedo}
                title={store.redoLabel ? `Redo ${store.redoLabel}` : undefined}>Redo</button>
            </div>
          </>
        )}
        <GridControls canEdit={canEdit} commandsRef={p.gridCommands} ui={p.gridUi} columns={p.columns} />
        {canEdit && (
          <>
            <DataDateControl store={store} />
            <button type="button" style={button} onClick={() => void recalculate()} disabled={blocked || recalcBusy}
              title="Re-run the schedule on the saved programme and store the result">Recalculate</button>
          </>
        )}
        {store.pending && <span style={dim}>Saving…</span>}
        {!store.pending && store.unsaved && <span style={dim}>Not saved</span>}
        {recalcError && <span role="alert" data-testid="programme-recalc-error" style={{ fontSize: 12, color: 'var(--c-red)' }}>{recalcError}</span>}
      </div>

      <div style={{ ...group, gap: 12 }}>
        {p.programmes.length > 1 && (
          <label style={{ ...group, ...dim }}>
            Programme
            <select aria-label="Programme" value={programmeId} style={field} disabled={store.pending || store.unsaved}
              onChange={(e) => router.push(`/projects/${p.projectId}/programme?programme=${e.target.value}`)}>
              {p.programmes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}
        <TimelineControls commandsRef={p.timelineCommands} zoom={p.zoom} onZoom={p.onZoom} />
        <label style={{ ...group, ...dim }}>
          Group by
          <select aria-label="Group by" value={p.groupBy} style={field} onChange={(e) => p.onGroupBy(e.target.value)}>
            <option value={GROUP_BY_WBS}>WBS</option>
            {store.state.codeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <div role="group" aria-label="Filters" style={group}>
          <input type="search" aria-label="Search activities" placeholder="Search name or code" value={p.filters.search} style={{ ...field, width: 170 }}
            onChange={(e) => p.onFilters({ ...p.filters, search: e.target.value })} />
          <label style={{ ...group, gap: 4 }}>
            <input type="checkbox" checked={p.filters.criticalOnly} onChange={(e) => p.onFilters({ ...p.filters, criticalOnly: e.target.checked })} />
            Critical only
          </label>
          <label style={{ ...group, gap: 4 }}>
            <input type="checkbox" checked={p.filters.lateOrNegative} onChange={(e) => p.onFilters({ ...p.filters, lateOrNegative: e.target.checked })} />
            Late or negative float
          </label>
          <label style={{ ...group, gap: 4 }}>
            <input type="checkbox" checked={p.filters.milestonesOnly} onChange={(e) => p.onFilters({ ...p.filters, milestonesOnly: e.target.checked })} />
            Milestones only
          </label>
          {filtersActive(p.filters) && <button type="button" style={button} onClick={() => p.onFilters(NO_FILTERS)}>Clear filters</button>}
        </div>
        <BaselinesMenu programmeId={programmeId} baselines={p.baselines} canEdit={canEdit} unsaved={store.pending || store.unsaved} onChanged={store.reload} />
        <span data-testid="programme-summary" style={{ ...dim, marginLeft: 'auto' }}>
          Finish: <span data-testid="programme-finish">{summary.finish ?? '—'}</span>
          {' · '}{summary.critical} critical{' · '}{summary.negativeFloat} negative float
        </span>
      </div>
    </div>
  )
}
