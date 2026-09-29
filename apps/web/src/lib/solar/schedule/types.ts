/** JSON-only shapes that cross the server → client boundary (no functions, no Dates). */
import type {
  CalendarDate, DurationMode, ScheduleFilters, ScheduleLink, ScheduleTaskView,
} from '@esite/shared'

export interface ScheduleLinkView extends ScheduleLink { id: string }
/**
 * A person who may OWN a solar task (owner decision Q4): an active project
 * member whose effective role is neither client_viewer nor supplier. Sourced
 * only from solar.schedule_owner_candidates, never from the member list.
 */
export interface ScheduleOwner { id: string; name: string; email: string }
export interface ScheduleBaselineSummary {
  id: string
  name: string
  description: string | null
  createdAt: string
  durationMode: DurationMode
}
export interface SchedulePreset { id: string; name: string; filters: ScheduleFilters }
export interface ScheduleSettingsView { durationMode: DurationMode; workloadThreshold: number; updatedAt: string | null }

export interface ScheduleData {
  projectId: string
  projectName: string
  canEdit: boolean
  currentUserId: string
  today: CalendarDate
  tasks: ScheduleTaskView[]
  links: ScheduleLinkView[]
  /** The owner picker's options — Solar-eligible people only. */
  owners: ScheduleOwner[]
  baselines: ScheduleBaselineSummary[]
  presets: SchedulePreset[]
  settings: ScheduleSettingsView
}

export interface BaselineTaskView {
  taskId: string | null
  ref: string
  name: string
  start: CalendarDate
  end: CalendarDate
  isMilestone: boolean
}
