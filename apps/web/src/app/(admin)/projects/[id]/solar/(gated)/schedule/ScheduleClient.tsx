'use client'
/**
 * The Schedule tab (spec §14). One source of truth (ScheduleData from the
 * server), pure derivations, and ONE executor for every mutation, so undo and
 * redo run exactly the same server actions as the original gesture.
 *
 * - After a mutation the data is re-read with loadScheduleAction — never
 *   router.refresh(), which would re-mount the Konva stage (#190/#201).
 * - Every edit on the page is undoable (owner decision Q8): drag, resize,
 *   segments, dialog, bulk, delete, links, reorder. "Use template" and
 *   "Import" are one-transaction bulk inserts and are not; the message says so.
 *   Undoing a delete re-creates a NEW work item; the history is remapped to
 *   the new ids.
 * - History entries carry no concurrency token: the executor stamps each patch
 *   with the task's LIVE updatedAt, and refuses (in words) when the task has
 *   gone — updateScheduleTasksAction refuses a patch without one.
 * - Link ops name (predecessor, successor); the executor resolves the link id
 *   from the CURRENT links, so they survive a re-create.
 * - GanttCanvas is Konva: loaded with next/dynamic { ssr: false }.
 */
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EMPTY_SCHEDULE_FILTERS, SCHEDULE_ZOOMS, applyBarDrag, applyScheduleFilters, baselineVariance, buildScheduleRows, criticalPath,
  fitSegments, formatCalendarDate, layoutGantt, linkKey, linkWouldCycle, moveSegment, ownerWorkload, reorderTaskIds, scheduleStats,
  type CalendarDate, type DurationMode, type GanttStatus, type LinkType, type ScheduleFilters, type ScheduleGroupBy, type ScheduleZoom,
} from '@esite/shared'
import {
  createScheduleTasksAction, deleteScheduleTasksAction, loadScheduleAction, reorderScheduleTasksAction, updateScheduleTasksAction,
} from '@/actions/solar-schedule.actions'
import {
  addScheduleLinkAction, deleteBaselineAction, deleteFilterPresetAction, loadBaselineTasksAction, removeScheduleLinkAction,
  saveBaselineAction, saveFilterPresetAction, saveScheduleSettingsAction, updateScheduleLinkAction,
} from '@/actions/solar-schedule-meta.actions'
import { applyScheduleTemplateAction, scheduleTemplateCountAction } from '@/actions/solar-schedule-template.actions'
import {
  EMPTY_HISTORY, entryForCreate, entryForDelete, entryForLinkAdd, entryForLinkRemove, entryForLinkUpdate, entryForReorder, entryForUpdate,
  recordEntry, remapHistoryIds, takeRedo, takeUndo, type History, type HistoryEntry, type ScheduleOp,
} from '@/lib/solar/schedule/history'
import { matchShortcut, type KeyLike } from '@/lib/solar/schedule/shortcuts'
import { scheduleCalendar } from '@/lib/solar/schedule/work-calendar'
import type { LinkInput, TaskInput, TaskPatch } from '@/lib/solar/schedule/inputs'
import type { BaselineTaskView, ScheduleData } from '@/lib/solar/schedule/types'
import { useArmedConfirm } from '../../_components/useArmedConfirm'
import { ScheduleToolbar, type ScheduleShow } from './ScheduleToolbar'
import { ScheduleRowList } from './ScheduleRowList'
import type { BarDragKind, GanttCanvasHandle } from './GanttCanvas'
import { TaskDialog, type TaskDialogResult } from './TaskDialog'
import { LinkDialog } from './LinkDialog'
import { BulkBar } from './BulkBar'
import { StatsPanel } from './StatsPanel'
import { WorkloadView } from './WorkloadView'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { TemplateStart } from './TemplateStart'
import { TemplateDialog } from './TemplateDialog'
import { ImportDialog } from './ImportDialog'

const GanttCanvas = dynamic(() => import('./GanttCanvas').then((m) => m.GanttCanvas), {
  ssr: false,
  loading: () => <div style={{ flex: 1, minHeight: 120, display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--c-text-dim)' }}>Loading the timeline…</div>,
})

type Dialog =
  | { kind: 'task' | 'milestone'; taskId: string | null }
  | { kind: 'link'; pred: string; succ: string; existing: boolean }
  | { kind: 'import' }
  | { kind: 'help' }
  | { kind: 'template' }
  | null

const LOOP = 'That link would make these tasks depend on each other in a loop.'
const TASK_GONE = 'That task is no longer on this schedule. Reload to see the current programme.'
const LINK_GONE = 'That link is no longer on this schedule. Reload to see the current programme.'
const taskNoun = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`

export function ScheduleClient({ initial }: { initial: ScheduleData }) {
  const [data, setData] = useState(initial)
  const dataRef = useRef(initial)
  const [history, setHistory] = useState<History>(EMPTY_HISTORY)
  const [zoom, setZoom] = useState<ScheduleZoom>('week')
  const [filters, setFilters] = useState<ScheduleFilters>(EMPTY_SCHEDULE_FILTERS)
  const [show, setShow] = useState<ScheduleShow>({ links: true, milestones: true, split: true })
  const [groupBy, setGroupBy] = useState<ScheduleGroupBy>('none')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [compareId, setCompareId] = useState<string | null>(null)
  const [baselineTasks, setBaselineTasks] = useState<BaselineTaskView[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [templateCount, setTemplateCount] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusyState] = useState(false)
  const busyRef = useRef(false)
  const [showWorkload, setShowWorkload] = useState(false)
  const del = useArmedConfirm(5000)
  const canvasRef = useRef<GanttCanvasHandle>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const P = data.projectId

  const setBusy = (b: boolean) => { busyRef.current = b; setBusyState(b) }

  const refresh = useCallback(async () => {
    const r = await loadScheduleAction({ projectId: P })
    if ('data' in r) {
      dataRef.current = r.data
      setData(r.data)
      const live = new Set(r.data.tasks.map((t) => t.id))
      setSelected((s) => (([...s].every((id) => live.has(id))) ? s : new Set([...s].filter((id) => live.has(id)))))
    } else {
      setMessage(r.error)
    }
  }, [P])

  // ── derivations ──────────────────────────────────────────────────────────
  const cal = useMemo(() => scheduleCalendar(data.settings.durationMode, data.tasks.flatMap((t) => [t.start, t.end]), data.today),
    [data.settings.durationMode, data.tasks, data.today])
  const cpm = useMemo(() => criticalPath(data.tasks, data.links, cal), [data.tasks, data.links, cal])
  const visible = useMemo(() => applyScheduleFilters(data.tasks, filters, show.milestones), [data.tasks, filters, show.milestones])
  const rows = useMemo(() => buildScheduleRows(visible, groupBy, collapsed), [visible, groupBy, collapsed])
  const baselineMap = useMemo(() => (compareId
    ? new Map(baselineTasks.filter((b) => b.taskId).map((b) => [b.taskId as string, { start: b.start, end: b.end }]))
    : null), [compareId, baselineTasks])
  const layout = useMemo(() => layoutGantt({
    rows, zoom, cal, today: data.today, splitBars: show.split, links: data.links, showLinks: show.links,
    critical: cpm.ok ? cpm.critical : new Set(), criticalLinks: cpm.ok ? cpm.criticalLinks : new Set(), baseline: baselineMap,
  }), [rows, zoom, cal, data.today, show.split, show.links, data.links, cpm, baselineMap])
  const stats = useMemo(() => scheduleStats(data.tasks, cal, cpm), [data.tasks, cal, cpm])
  const workload = useMemo(() => ownerWorkload(data.tasks, data.settings.workloadThreshold, cal), [data.tasks, data.settings.workloadThreshold, cal])
  const variance = useMemo(() => (compareId ? baselineVariance(data.tasks, baselineTasks, cal) : null), [compareId, data.tasks, baselineTasks, cal])
  const colours = useMemo(() => [...new Set(data.tasks.map((t) => t.colour))], [data.tasks])
  // Names for every current owner, eligible or not (a Map built here, never passed from the server).
  const ownerNames = useMemo(() => new Map([
    ...data.tasks.map((t) => [t.ownerId, t.ownerName] as [string, string]),
    ...data.owners.map((o) => [o.id, o.name] as [string, string]),
  ]), [data.tasks, data.owners])
  const taskById = (id: string) => dataRef.current.tasks.find((t) => t.id === id)

  // ── the executor: every op goes through the same actions as the original gesture ─
  async function execOps(ops: ScheduleOp[]): Promise<{ error: string | null; idMap: Record<string, string> }> {
    const idMap: Record<string, string> = {}
    for (const op of ops) {
      const cur = dataRef.current
      let r: { error: string } | { ok: true }
      if (op.kind === 'update') {
        const patches: TaskPatch[] = []
        for (const p of op.patches) {
          const live = cur.tasks.find((t) => t.id === p.id)
          if (!live) return { error: TASK_GONE, idMap }
          patches.push({ ...p, expectedUpdatedAt: live.updatedAt })
        }
        r = await updateScheduleTasksAction({ projectId: P, patches })
      } else if (op.kind === 'create') {
        const c = await createScheduleTasksAction({ projectId: P, tasks: op.tasks, links: op.links })
        if ('ids' in c) Object.assign(idMap, c.ids)
        r = c
      } else if (op.kind === 'delete') {
        if (op.taskIds.some((id) => !cur.tasks.some((t) => t.id === id))) return { error: TASK_GONE, idMap }
        r = await deleteScheduleTasksAction({ projectId: P, taskIds: op.taskIds })
      } else if (op.kind === 'addLink') {
        r = await addScheduleLinkAction({ projectId: P, predecessorId: op.predecessorId, successorId: op.successorId, type: op.type, lagDays: op.lagDays })
      } else if (op.kind === 'removeLink' || op.kind === 'updateLink') {
        const l = cur.links.find((x) => x.predecessorId === op.predecessorId && x.successorId === op.successorId)
        if (!l) return { error: LINK_GONE, idMap }
        r = op.kind === 'removeLink'
          ? await removeScheduleLinkAction({ projectId: P, linkId: l.id })
          : await updateScheduleLinkAction({ projectId: P, linkId: l.id, type: op.type, lagDays: op.lagDays })
      } else {
        r = await reorderScheduleTasksAction({ projectId: P, orderedIds: op.orderedIds })
      }
      if ('error' in r) return { error: r.error, idMap }
      await refresh()
    }
    return { error: null, idMap }
  }

  /**
   * Run an entry forward (unless the gesture already did it) and record it for
   * undo. Returns null on success or the sentence explaining the refusal.
   */
  async function perform(entry: HistoryEntry, opts: { alreadyDone?: boolean; quiet?: boolean } = {}): Promise<string | null> {
    if (busyRef.current) return 'Still saving the last change. Try again in a moment.'
    setMessage(null)
    setBusy(true)
    let error: string | null = null
    if (opts.alreadyDone) await refresh()
    else error = (await execOps(entry.forward)).error
    setBusy(false)
    if (error) {
      if (!opts.quiet) setMessage(error)
      return error
    }
    setHistory((h) => recordEntry(h, entry))
    return null
  }

  async function step(direction: 'undo' | 'redo') {
    if (busyRef.current) return
    const t = direction === 'undo' ? takeUndo(history) : takeRedo(history)
    if (!t) return
    setMessage(null)
    setBusy(true)
    const res = await execOps(direction === 'undo' ? t.entry.backward : t.entry.forward)
    setBusy(false)
    if (res.error) {
      setMessage(`${direction === 'undo' ? 'Undo' : 'Redo'} could not be applied: ${res.error} The undo history was cleared.`)
      setHistory(EMPTY_HISTORY)
      return
    }
    setHistory(Object.keys(res.idMap).length ? remapHistoryIds(t.history, res.idMap) : t.history)
    setMessage(`${direction === 'undo' ? 'Undone' : 'Redone'}: ${t.entry.label}.`)
  }

  // ── gestures ─────────────────────────────────────────────────────────────
  const update = (label: string, patches: TaskPatch[], quiet = false) =>
    perform(entryForUpdate(label, dataRef.current.tasks, patches), { quiet })

  function onBarDrag(taskId: string, kind: BarDragKind, delta: number, segmentIndex: number | null) {
    const t = taskById(taskId)
    if (!t || delta === 0) return
    if (kind === 'segment' && segmentIndex !== null) {
      const segs = moveSegment(t.segments, segmentIndex, delta)
      if (!segs) { setMessage('Segments of one task cannot overlap.'); return }
      void update('Move segment', [{ id: t.id, segments: segs }])
      return
    }
    const span = applyBarDrag(t, kind === 'segment' ? 'move' : kind, delta)
    const patch: TaskPatch = { id: t.id, start: span.start, end: span.end }
    if (t.segments.length >= 2) patch.segments = fitSegments(t.segments, t, span)
    void update(kind === 'start' || kind === 'end' ? 'Resize task' : 'Move task', [patch])
  }

  async function createTasks(label: string, tasks: TaskInput[], links: LinkInput[]): Promise<string | null> {
    if (busyRef.current) return 'Still saving the last change. Try again in a moment.'
    setBusy(true)
    const r = await createScheduleTasksAction({ projectId: P, tasks, links })
    setBusy(false)
    if ('error' in r) return r.error
    return perform(entryForCreate(label, tasks, links, r.ids), { alreadyDone: true })
  }

  async function deleteTasks(ids: string[]) {
    const cur = dataRef.current
    const live = ids.filter((id) => cur.tasks.some((t) => t.id === id))
    if (live.length === 0) return
    const err = await perform(entryForDelete(`Delete ${taskNoun(live.length)}`, cur.tasks, cur.links, live))
    if (!err) {
      setSelected(new Set())
      setDialog(null)
      setMessage(`${live.length === 1 ? 'Task' : `${live.length} tasks`} deleted. Undo brings ${live.length === 1 ? 'it' : 'them'} back as new work items.`)
    }
  }

  function drawLink(pred: string, succ: string) {
    const cur = dataRef.current
    if (pred === succ) { setMessage('A task cannot depend on itself.'); return }
    if (cur.links.some((l) => l.predecessorId === pred && l.successorId === succ)) { setMessage('Those two tasks are already linked.'); return }
    if (linkWouldCycle(cur.tasks.map((t) => t.id), cur.links, { predecessorId: pred, successorId: succ, type: 'FS', lagDays: 0 })) { setMessage(LOOP); return }
    setDialog({ kind: 'link', pred, succ, existing: false })
  }

  function openLink(k: string) {
    const l = dataRef.current.links.find((x) => linkKey(x) === k)
    if (l) setDialog({ kind: 'link', pred: l.predecessorId, succ: l.successorId, existing: true })
  }

  async function onReorder(moved: string[], beforeId: string | null) {
    const before = [...dataRef.current.tasks].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => t.id)
    const after = reorderTaskIds(before, moved, beforeId)
    if (after.join() !== before.join()) await perform(entryForReorder(before, after))
  }

  async function onDialogSubmit(r: TaskDialogResult): Promise<string | null> {
    if ('input' in r) return createTasks(r.input.isMilestone ? 'Add milestone' : 'Add task', [r.input], [])
    return update(r.patch.start || r.patch.end || r.patch.segments ? 'Edit task dates' : 'Edit task', [r.patch], true)
  }

  function bulk(label: string, make: (id: string) => TaskPatch) {
    const ids = [...selected].filter((id) => dataRef.current.tasks.some((t) => t.id === id))
    if (ids.length) void update(label, ids.map(make))
  }

  async function openTemplateDialog() {
    setTemplateCount(null)
    setDialog({ kind: 'template' })
    const r = await scheduleTemplateCountAction({ projectId: P })
    if ('error' in r) { setDialog(null); setMessage(r.error); return }
    setTemplateCount(r.count)
  }

  async function applyTemplate(start: CalendarDate) {
    if (busyRef.current) return
    setMessage(null)
    setBusy(true)
    const r = await applyScheduleTemplateAction({ projectId: P, start })
    setBusy(false)
    if ('error' in r) { setMessage(r.error); return }
    setDialog((d) => (d?.kind === 'template' ? null : d))
    await refresh()
    setMessage(`${r.count} tasks added from the template. Undo does not cover a template — delete tasks to remove them.`)
  }

  async function compare(id: string | null) {
    setCompareId(id)
    if (!id) { setBaselineTasks([]); return }
    const r = await loadBaselineTasksAction({ projectId: P, baselineId: id })
    if ('tasks' in r) setBaselineTasks(r.tasks)
    else setMessage(r.error)
  }

  function exportPng() {
    const url = canvasRef.current?.exportPng()
    if (!url) { setMessage('The chart could not be exported. Try again.'); return }
    const a = document.createElement('a')
    a.href = url
    a.download = `${data.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'solar'}-programme.png`
    a.click()
  }

  const scrollToToday = () => {
    if (layout.todayX !== null) canvasRef.current?.scrollToX(layout.todayX)
    else setMessage('Today is outside the programme’s dates.')
  }

  // ── keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = matchShortcut({
        key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey,
        target: e.target as KeyLike['target'],
      }, data.canEdit)
      if (!action) return
      // With a dialog open only Escape (close) applies — the dialog owns the keyboard.
      if (dialog && action !== 'clearSelection') return
      e.preventDefault()
      switch (action) {
        case 'newTask': setDialog({ kind: 'task', taskId: null }); break
        case 'newMilestone': setDialog({ kind: 'milestone', taskId: null }); break
        case 'deleteSelected': if (selected.size) del.arm(); break
        case 'undo': void step('undo'); break
        case 'redo': void step('redo'); break
        case 'selectAll': if (data.canEdit) setSelected(new Set(visible.map((t) => t.id))); break
        case 'clearSelection': if (dialog) setDialog(null); else { setSelected(new Set()); del.disarm() } break
        case 'zoomIn': setZoom((z) => SCHEDULE_ZOOMS[Math.max(0, SCHEDULE_ZOOMS.indexOf(z) - 1)]); break
        case 'zoomOut': setZoom((z) => SCHEDULE_ZOOMS[Math.min(SCHEDULE_ZOOMS.length - 1, SCHEDULE_ZOOMS.indexOf(z) + 1)]); break
        case 'focusSearch': searchRef.current?.focus(); break
        case 'today': scrollToToday(); break
        case 'help': setDialog({ kind: 'help' }); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── render ───────────────────────────────────────────────────────────────
  const editing = dialog && (dialog.kind === 'task' || dialog.kind === 'milestone') && dialog.taskId ? taskById(dialog.taskId) ?? null : null
  const linkForDialog = dialog?.kind === 'link' && dialog.existing
    ? data.links.find((l) => l.predecessorId === dialog.pred && l.successorId === dialog.succ)
    : undefined
  const nameOf = (id: string) => data.tasks.find((t) => t.id === id)?.name ?? ''
  const selCount = selected.size
  const unit = data.settings.durationMode === 'working' ? 'working days' : 'days'
  const openTask = (id: string) => setDialog({ kind: taskById(id)?.isMilestone ? 'milestone' : 'task', taskId: id })

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <ScheduleToolbar
        canEdit={data.canEdit} zoom={zoom} onZoom={setZoom}
        search={filters.search} onSearch={(s) => setFilters((f) => ({ ...f, search: s }))} filters={filters} onFilters={setFilters}
        owners={data.owners} colours={colours} presets={data.presets}
        onApplyPreset={(id) => { const p = data.presets.find((x) => x.id === id); if (p) setFilters(p.filters) }}
        onSavePreset={async (name) => { const r = await saveFilterPresetAction({ projectId: P, name, filters }); if ('error' in r) return r.error; await refresh(); return null }}
        onDeletePreset={async (id) => { const r = await deleteFilterPresetAction({ projectId: P, presetId: id }); if ('error' in r) setMessage(r.error); else await refresh() }}
        show={show} onShow={setShow} groupBy={groupBy} onGroupBy={setGroupBy}
        baselines={data.baselines} compareId={compareId} onCompare={(id) => void compare(id)}
        onSaveBaseline={async (name, d) => { const r = await saveBaselineAction({ projectId: P, name, description: d }); if ('error' in r) return r.error; await refresh(); return null }}
        onDeleteBaseline={async (id) => {
          const r = await deleteBaselineAction({ projectId: P, baselineId: id })
          if ('error' in r) { setMessage(r.error); return }
          if (compareId === id) void compare(null)
          await refresh()
        }}
        settings={data.settings}
        onSaveSettings={async (mode: DurationMode, threshold: number) => {
          const r = await saveScheduleSettingsAction({ projectId: P, durationMode: mode, workloadThreshold: threshold, expectedUpdatedAt: data.settings.updatedAt })
          if ('error' in r) return r.error
          await refresh()
          return null
        }}
        canUndo={history.past.length > 0 && !busy} canRedo={history.future.length > 0 && !busy}
        onUndo={() => void step('undo')} onRedo={() => void step('redo')}
        onAddTask={() => setDialog({ kind: 'task', taskId: null })} onAddMilestone={() => setDialog({ kind: 'milestone', taskId: null })}
        onUseTemplate={() => void openTemplateDialog()} onImport={() => setDialog({ kind: 'import' })}
        onToday={scrollToToday}
        onShiftRange={(dir) => canvasRef.current?.scrollBy(dir * 7 * layout.dayWidth)}
        onHelp={() => setDialog({ kind: 'help' })}
        exportBase={`/api/projects/${P}/solar/schedule/export`} onExportPng={exportPng} searchRef={searchRef}
      />

      {message && <div role="status" style={{ fontSize: 12, padding: '6px 10px', border: '1px solid var(--c-border)', borderRadius: 6 }}>{message}</div>}
      {layout.clamped && <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>{`The programme is long, so it is shown by ${layout.zoom}.`}</div>}

      {data.canEdit && selCount > 0 && (del.armed ? (
        <div role="alertdialog" aria-label="Delete tasks" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <span>{selCount === 1
            ? 'Delete 1 task? It is removed (voided) from the programme and from My Work, and its links are removed. Undo brings it back as a new work item.'
            : `Delete ${taskNoun(selCount)}? They are removed (voided) from the programme and from My Work, and their links are removed. Undo brings them back as new work items.`}</span>
          <button type="button" onClick={() => { del.disarm(); void deleteTasks([...selected]) }}>{`Confirm: delete ${taskNoun(selCount)}`}</button>
          <button type="button" onClick={del.disarm}>Cancel</button>
        </div>
      ) : (
        <BulkBar count={selCount} owners={data.owners} colours={colours}
          onSetStatus={(s: GanttStatus) => bulk('Set status', (id) => ({ id, status: s }))}
          onSetColour={(c) => bulk('Set colour', (id) => ({ id, colour: c }))}
          onSetProgress={(p) => bulk('Set progress', (id) => ({ id, progress: p }))}
          onSetOwner={(o) => bulk('Reassign', (id) => ({ id, ownerId: o }))}
          onDelete={() => void deleteTasks([...selected])} onClear={() => setSelected(new Set())} />
      ))}

      {data.tasks.length === 0 ? (
        <TemplateStart canEdit={data.canEdit} defaultStart={data.today} busy={busy} onUseTemplate={(s) => void applyTemplate(s)}
          onAddTask={() => setDialog({ kind: 'task', taskId: null })} onImport={() => setDialog({ kind: 'import' })} />
      ) : (
        <div style={{ maxHeight: '70vh', overflowY: 'auto', border: '1px solid var(--c-border)', borderRadius: 6 }}>
          <div style={{ display: 'flex', minWidth: 0 }}>
            <ScheduleRowList rows={rows} canEdit={data.canEdit} selected={selected}
              onToggleSelect={(id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })}
              onToggleGroup={(k) => setCollapsed((c) => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n })}
              onOpenTask={openTask}
              onReorder={(m, b) => void onReorder(m, b)} />
            <GanttCanvas ref={canvasRef} layout={layout} canEdit={data.canEdit} selected={selected}
              onBarDrag={onBarDrag} onLinkDraw={drawLink} onOpenLink={openLink}
              onSelect={(id, additive) => { if (data.canEdit) setSelected((s) => (additive ? new Set([...s, id]) : new Set([id]))) }}
              onOpenTask={openTask} />
          </div>
        </div>
      )}

      {data.tasks.length > 0 && (
        <>
          <StatsPanel stats={stats} mode={data.settings.durationMode} violations={cpm.ok ? cpm.violations.length : 0} cycle={cpm.ok ? null : cpm.cycle} />
          {variance && (
            <section aria-label="Baseline variance" style={{ fontSize: 12 }}>
              <h3 style={{ fontSize: 13 }}>{`Against “${data.baselines.find((b) => b.id === compareId)?.name ?? 'the baseline'}”`}</h3>
              <ul>
                {[...variance.rows.values()].filter((v) => v.startDays !== 0 || v.finishDays !== 0).map((v) => (
                  <li key={v.taskId}>{`${taskById(v.taskId)?.ref ?? ''} ${nameOf(v.taskId)}: starts ${v.startDays >= 0 ? `${v.startDays} ${unit} later` : `${-v.startDays} ${unit} earlier`}, finishes ${v.finishDays >= 0 ? `${v.finishDays} ${unit} later` : `${-v.finishDays} ${unit} earlier`}`}</li>
                ))}
                {variance.added.map((id) => <li key={`a${id}`}>{`${taskById(id)?.ref ?? ''} ${nameOf(id)}: added since the baseline`}</li>)}
                {variance.removed.map((b, i) => <li key={`r${i}`}>{`${b.name}: in the baseline (${formatCalendarDate(b.start)} – ${formatCalendarDate(b.end)}), since removed`}</li>)}
              </ul>
            </section>
          )}
          <div>
            <button type="button" aria-expanded={showWorkload} onClick={() => setShowWorkload((v) => !v)}>Resource workload</button>
            {showWorkload && <WorkloadView workload={workload} ownerNames={ownerNames} threshold={data.settings.workloadThreshold} />}
          </div>
        </>
      )}

      {(dialog?.kind === 'task' || dialog?.kind === 'milestone') && (
        <TaskDialog key={`${dialog.kind}:${dialog.taskId ?? 'new'}`} mode={dialog.kind} initial={editing} owners={data.owners} cal={cal}
          canEdit={data.canEdit} defaultStart={data.today}
          onSubmit={onDialogSubmit} onDelete={(id) => void deleteTasks([id])} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'link' && (
        <LinkDialog key={`${dialog.pred}>${dialog.succ}`} title={`${nameOf(dialog.pred)} → ${nameOf(dialog.succ)}`}
          initialType={linkForDialog?.type ?? 'FS'} initialLag={linkForDialog?.lagDays ?? 0}
          canEdit={data.canEdit} isNew={!dialog.existing} onClose={() => setDialog(null)}
          onRemove={() => { if (linkForDialog) void perform(entryForLinkRemove(linkForDialog)).then((err) => { if (!err) setDialog(null) }) }}
          onSave={(type: LinkType, lagDays: number) => {
            const entry = linkForDialog
              ? entryForLinkUpdate(linkForDialog, type, lagDays)
              : entryForLinkAdd({ predecessorId: dialog.pred, successorId: dialog.succ, type, lagDays })
            void perform(entry).then((err) => { if (!err) setDialog(null) })
          }} />
      )}
      {dialog?.kind === 'import' && (
        <ImportDialog projectId={P} cal={cal} existingCount={data.tasks.length} onClose={() => setDialog(null)}
          onImported={(msg) => { void refresh(); setMessage(`${msg} Undo does not cover an import — delete tasks to remove them.`) }} />
      )}
      {dialog?.kind === 'template' && (
        <TemplateDialog defaultStart={data.today} existingCount={data.tasks.length} templateCount={templateCount} busy={busy}
          onApply={(s) => void applyTemplate(s)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'help' && <ShortcutsOverlay canEdit={data.canEdit} onClose={() => setDialog(null)} />}
      {busy && <div aria-live="polite" style={{ position: 'fixed', bottom: 12, right: 12, fontSize: 11 }}>Saving…</div>}
    </div>
  )
}
