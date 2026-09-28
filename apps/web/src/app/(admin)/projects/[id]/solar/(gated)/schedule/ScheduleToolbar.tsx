'use client'
/**
 * Schedule header and toolbar (spec §14.1). Controls that need Edit are NOT
 * rendered below Edit (hidden, not disabled). Every callback is a client-side
 * function owned by ScheduleClient; nothing here crosses the server → client
 * boundary. The owner filter lists whoever owns a task (a former owner's tasks
 * stay findable); assigning an owner is eligible-only and lives elsewhere (Q4).
 */
import type { RefObject } from 'react'
import {
  SCHEDULE_GROUP_BYS, SCHEDULE_GROUP_BY_LABELS, SCHEDULE_ZOOMS,
  type DurationMode, type ScheduleFilters, type ScheduleGroupBy, type ScheduleZoom,
} from '@esite/shared'
import type { ScheduleBaselineSummary, SchedulePreset, ScheduleSettingsView } from '@/lib/solar/schedule/types'
import { FilterPopover } from './FilterPopover'
import { BaselineMenu } from './BaselineMenu'
import { SettingsMenu } from './SettingsMenu'
import { ExportMenu } from './ExportMenu'

export interface ScheduleShow { links: boolean; milestones: boolean; split: boolean }

export interface ScheduleToolbarProps {
  canEdit: boolean
  zoom: ScheduleZoom
  onZoom: (z: ScheduleZoom) => void
  search: string
  onSearch: (s: string) => void
  filters: ScheduleFilters
  onFilters: (f: ScheduleFilters) => void
  /** For the owner FILTER: everyone who owns a task on this schedule, eligible or not. */
  owners: Array<{ id: string; name: string }>
  /** Colours in use on the schedule's tasks. */
  colours: string[]
  presets: SchedulePreset[]
  onApplyPreset: (id: string) => void
  onSavePreset: (name: string) => Promise<string | null>
  onDeletePreset: (id: string) => void
  show: ScheduleShow
  onShow: (s: ScheduleShow) => void
  groupBy: ScheduleGroupBy
  onGroupBy: (g: ScheduleGroupBy) => void
  baselines: ScheduleBaselineSummary[]
  compareId: string | null
  onCompare: (id: string | null) => void
  onSaveBaseline: (name: string, description: string) => Promise<string | null>
  onDeleteBaseline: (id: string) => void
  settings: ScheduleSettingsView
  onSaveSettings: (mode: DurationMode, threshold: number) => Promise<string | null>
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onAddTask: () => void
  onAddMilestone: () => void
  onUseTemplate: () => void
  onImport: () => void
  onToday: () => void
  onShiftRange: (dir: -1 | 1) => void
  onHelp: () => void
  exportBase: string
  onExportPng: () => void
  searchRef: RefObject<HTMLInputElement | null>
}

const ZOOM_LABEL: Record<ScheduleZoom, string> = { day: 'Day', week: 'Week', month: 'Month' }
const SHOW_LABEL: Record<keyof ScheduleShow, string> = { links: 'Dependencies', milestones: 'Milestones', split: 'Split bars' }

export function ScheduleToolbar(p: ScheduleToolbarProps) {
  return (
    <div role="toolbar" aria-label="Schedule" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12 }}>
      {p.canEdit && (
        <>
          <button type="button" className="btn-primary-amber" onClick={p.onAddTask}>Add task</button>
          <button type="button" onClick={p.onAddMilestone}>Add milestone</button>
          <button type="button" onClick={p.onUseTemplate}>Use template</button>
          <button type="button" onClick={p.onImport}>Import</button>
          <button type="button" disabled={!p.canUndo} onClick={p.onUndo}>Undo</button>
          <button type="button" disabled={!p.canRedo} onClick={p.onRedo}>Redo</button>
        </>
      )}
      <div role="group" aria-label="Time scale" style={{ display: 'inline-flex' }}>
        {SCHEDULE_ZOOMS.map((z) => (
          <button key={z} type="button" aria-pressed={p.zoom === z} onClick={() => p.onZoom(z)}
            style={p.zoom === z ? { fontWeight: 600, borderBottom: '2px solid var(--c-amber)' } : undefined}>{ZOOM_LABEL[z]}</button>
        ))}
      </div>
      <button type="button" aria-label="Earlier" onClick={() => p.onShiftRange(-1)}>‹</button>
      <button type="button" onClick={p.onToday}>Today</button>
      <button type="button" aria-label="Later" onClick={() => p.onShiftRange(1)}>›</button>
      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
        <input ref={p.searchRef} type="search" aria-label="Search tasks" placeholder="Search tasks…" value={p.search} onChange={(e) => p.onSearch(e.target.value)} />
        {p.search && <button type="button" aria-label="Clear search" onClick={() => p.onSearch('')}>×</button>}
      </span>
      <FilterPopover filters={p.filters} onFilters={p.onFilters} owners={p.owners} colours={p.colours} presets={p.presets}
        onApplyPreset={p.onApplyPreset} onSavePreset={p.onSavePreset} onDeletePreset={p.onDeletePreset} />
      {(['links', 'milestones', 'split'] as const).map((k) => (
        <label key={k}>
          <input type="checkbox" checked={p.show[k]} onChange={() => p.onShow({ ...p.show, [k]: !p.show[k] })} />{' '}
          {SHOW_LABEL[k]}
        </label>
      ))}
      <label>Group by{' '}
        <select aria-label="Group by" value={p.groupBy} onChange={(e) => p.onGroupBy(e.target.value as ScheduleGroupBy)}>
          {SCHEDULE_GROUP_BYS.map((g) => <option key={g} value={g}>{SCHEDULE_GROUP_BY_LABELS[g]}</option>)}
        </select>
      </label>
      <BaselineMenu canEdit={p.canEdit} baselines={p.baselines} compareId={p.compareId} onCompare={p.onCompare}
        onSave={p.onSaveBaseline} onDelete={p.onDeleteBaseline} />
      <ExportMenu exportBase={p.exportBase} onExportPng={p.onExportPng} />
      {p.canEdit && <SettingsMenu settings={p.settings} onSave={p.onSaveSettings} />}
      <button type="button" aria-label="Keyboard shortcuts" onClick={p.onHelp}>?</button>
    </div>
  )
}
