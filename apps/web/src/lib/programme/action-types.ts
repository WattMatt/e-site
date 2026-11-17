/**
 * Inputs and results of the programme server actions. Kept out of the
 * 'use server' file, which may export only async functions.
 */
import type { ProgrammeOp, ScheduleIssue } from '@esite/shared/programme'

export type ProgrammeRefusal = { ok: false; error: string }

/** The stale-version refusal (40001). The client store recognises a stale save by this exact sentence. */
export const PROGRAMME_STALE = 'Someone else changed this programme. Reload to see their version.'

export interface CreateProgrammeInput {
  projectId: string
  kind: 'project' | 'module' | 'contractor'
  name: string
  /** 'YYYY-MM-DD' */
  projectStart: string
  moduleKey?: 'solar'
  contractorLabel?: string
}

export interface SaveProgrammeChangesInput {
  programmeId: string
  /** `programmes.updated_at` as last read; the database refuses a different one (40001). */
  expectedVersion: string
  ops: ProgrammeOp[]
}

export type SaveProgrammeResult =
  | { ok: true; version: string; ids: Record<string, string>; issues: ScheduleIssue[] }
  | { ok: false; error: string; issues?: ScheduleIssue[] }

export interface FieldUpdateInput {
  activityId: string
  start?: string | null
  finish?: string | null
  percent?: number | null
  remaining?: number | null
  note?: string | null
}

/**
 * One planner decision. `adjusted` takes the planner's values given here; a
 * value left out or null falls back to what was reported (P2 never clears an
 * actual). `applied` uses the reported
 * values only; `rejected` changes nothing on the programme.
 */
export interface FieldUpdateDecision {
  id: string
  status: 'applied' | 'adjusted' | 'rejected'
  note?: string | null
  start?: string | null
  finish?: string | null
  percent?: number | null
  remaining?: number | null
}

export type DecideFieldUpdatesResult =
  | { ok: true; decided: number; version: string; ids: Record<string, string>; issues: ScheduleIssue[] }
  /** A refusal decided nothing and wrote nothing: decisions and actuals are one transaction. */
  | { ok: false; error: string; issues?: ScheduleIssue[] }

export interface ModuleSummary { start: string | null; finish: string | null; percentComplete: number | null }
