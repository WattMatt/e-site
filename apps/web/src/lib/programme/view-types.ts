/** JSON-only shapes the programme page hands its client component (no Dates, Maps, Sets or functions). */
import type { ProgrammeState } from '@esite/shared/programme'

export interface ProgrammeSummary {
  id: string
  kind: 'project' | 'module' | 'contractor'
  name: string
  module_key: 'solar' | null
  contractor_label: string | null
}

export interface BaselineSummary { id: string; name: string; is_active: boolean; created_at: string }

export interface ActiveBaselineView {
  id: string
  name: string
  activities: Record<string, { early_start: string | null; early_finish: string | null }>
}

export interface ProgrammeViewData {
  state: ProgrammeState
  /** `programmes.updated_at` as read: the expectedVersion of the next save. */
  version: string
  activeBaseline: ActiveBaselineView | null
  baselines: BaselineSummary[]
}

export type ProgrammeSelector = { programmeId?: string; module?: 'solar' }
