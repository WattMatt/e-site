'use server'
/**
 * Programme server actions (P2: no page or nav entry yet). All dark behind
 * PROGRAMME_ENABLED.
 *
 * Every write goes to a SECURITY DEFINER function in the `programme` schema
 * (migration 00261), which checks the caller, locks the programme, refuses a
 * stale version and audits in one transaction; it stays the authority. The
 * gates here refuse early with a sentence so a refused person never reaches
 * the database:
 *  - project / contractor programme: effective project role in ORG_WRITE_ROLES;
 *  - module (solar) programme: Solar access level `edit`. (getSolarAccessLevel,
 *    not requireSolarLevel: that one redirects, and these actions answer with
 *    a result object.)
 *  - submit_field_update has no gate here: who may report (an editor, or a
 *    contractor/inspector tagged on the activity's codes) is decided by the
 *    database, and its refusal comes back as its sentence.
 *
 * A save loads the programme as the person, applies the ops in memory
 * (`applyOps`, the twin of save_changes), runs the engine, and sends the ops
 * plus the computed cache in ONE save_changes call. Results are always
 * `{ ok: true, ... } | { ok: false, error }`; nothing is thrown to the client.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { getSolarAccessLevel } from '@/lib/solar/access'
import { programmeEnabled } from '@/lib/programme/flag'
import { loadProgramme, PROGRAMME_GONE, programmeSchema } from '@/lib/programme/load'
import type {
  CreateProgrammeInput, DecideFieldUpdatesResult, FieldUpdateDecision, FieldUpdateInput, ModuleSummary,
  ProgrammeRefusal, SaveProgrammeChangesInput, SaveProgrammeResult,
} from '@/lib/programme/action-types'
import { ORG_ROLES, ORG_WRITE_ROLES, solarLevelAllows } from '@esite/shared'
import {
  applyOps, computedForSave, ProgrammeOpError, rowsToProgrammeInput, scheduleProgramme,
  type ComputedSaveEntry, type ProgrammeOp, type ProgrammeState, type ScheduleIssue,
} from '@esite/shared/programme'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

const OFF = 'The programme module is not switched on yet.'
const SIGNED_OUT = 'You are not signed in.'
const STALE = 'Someone else changed this programme. Reload to see their version.'
const KEYLESS = 'Give each new activity a key so its schedule can be saved.'
const NOT_A_LIST = 'The changes must be sent as a list.'
const PROJECT_REFUSED = 'You do not have permission to edit programmes on this project.'
const MODULE_REFUSED = 'You do not have permission to edit this module programme.'
const NO_PROJECT_ACCESS = 'You do not have access to this project.'
const BASELINE_GONE = 'That baseline no longer exists.'
const SAVE_FAILED = 'The programme could not be saved. Try again.'
const MAX_DECISIONS = 500

/** Every effective project role except client_viewer may read a programme. */
const READ_ROLES = ORG_ROLES.filter((r) => r !== 'client_viewer')

const off = (): ProgrammeRefusal => ({ ok: false, error: OFF })
const refuse = (error: string): ProgrammeRefusal => ({ ok: false, error })

/**
 * A database error as a sentence. 40001 is the reload sentence; the function's
 * own plain sentences (42501 refused, 22023 bad input, P0002 gone, 23505
 * duplicate) pass through; anything else (PostgREST, transport) is generic so
 * no internals reach the person.
 */
function dbSentence(err: { code?: string; message?: string } | null | undefined, fallback = SAVE_FAILED): string {
  if (err?.code === '40001') return STALE
  if (err?.code && ['42501', '22023', 'P0002', '23505'].includes(err.code) && err.message) return err.message
  return fallback
}

async function signedInClient(): Promise<AnyClient | null> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  return user ? supabase : null
}

/** The edit gate for one programme: Solar edit for a module programme, ORG_WRITE_ROLES otherwise. Null = allowed. */
async function editRefusal(supabase: AnyClient, programme: { project_id: string; kind: string }): Promise<string | null> {
  if (programme.kind === 'module') {
    const level = await getSolarAccessLevel(programme.project_id, supabase)
    return solarLevelAllows(level, 'edit') ? null : MODULE_REFUSED
  }
  const gate = await requireEffectiveRole(supabase, programme.project_id, ORG_WRITE_ROLES)
  return gate.ok ? null : PROJECT_REFUSED
}

/** Reads one programme row (project + kind) as the person, for the gate. */
async function programmeHeader(supabase: AnyClient, programmeId: string): Promise<{ project_id: string; kind: string } | null> {
  const { data, error } = await programmeSchema(supabase)
    .from('programmes').select('id, project_id, kind').eq('id', programmeId).maybeSingle()
  if (error || !data) return null
  return data as { project_id: string; kind: string }
}

const isKeylessNewActivity = (o: unknown): boolean => {
  if (!o || typeof o !== 'object') return false
  const op = o as Record<string, unknown>
  return op.op === 'upsert_activity' && (op.id === undefined || op.id === null) && typeof op.key !== 'string'
}

type Prepared =
  | { ok: true; computed: { project_finish: string | null; activities: ComputedSaveEntry[] }; issues: ScheduleIssue[] }
  | { ok: false; error: string; issues?: ScheduleIssue[] }

/** applyOps → engine → computed cache. Refuses with the SQL's sentence or the engine's first error; writes nothing. */
function prepareSave(state: ProgrammeState, ops: ProgrammeOp[]): Prepared {
  try {
    const next = applyOps(state, ops)
    const result = scheduleProgramme(rowsToProgrammeInput(next))
    if (!result.ok) {
      const first = result.issues.find((i) => i.severity === 'error')
      return { ok: false, error: first?.message ?? 'The programme could not be scheduled.', issues: result.issues }
    }
    return { ok: true, computed: computedForSave(result, next.dependencies), issues: result.issues }
  } catch (e) {
    if (e instanceof ProgrammeOpError) return { ok: false, error: e.message }
    return { ok: false, error: SAVE_FAILED }
  }
}

async function callSave(
  supabase: AnyClient, programmeId: string, expectedVersion: string, ops: ProgrammeOp[], prepared: Extract<Prepared, { ok: true }>,
): Promise<SaveProgrammeResult> {
  const { data, error } = await programmeSchema(supabase).rpc('save_changes', {
    p_programme_id: programmeId,
    p_expected_version: expectedVersion,
    p_ops: ops,
    p_computed: prepared.computed,
  })
  if (error) return refuse(dbSentence(error))
  const out = (data ?? {}) as { version?: string; ids?: Record<string, string> }
  return { ok: true, version: String(out.version ?? ''), ids: out.ids ?? {}, issues: prepared.issues }
}

export async function createProgrammeAction(input: CreateProgrammeInput): Promise<{ ok: true; programmeId: string } | ProgrammeRefusal> {
  if (!programmeEnabled()) return off()
  if (!['project', 'module', 'contractor'].includes(input?.kind)) return refuse('A programme is a project, module or contractor programme.')
  if (input.kind === 'module' && input.moduleKey !== 'solar') return refuse('Say which module this programme is for.')
  const supabase = await signedInClient()
  if (!supabase) return refuse(SIGNED_OUT)

  const refusal = await editRefusal(supabase, { project_id: input.projectId, kind: input.kind })
  if (refusal) return refuse(refusal)

  const { data, error } = await programmeSchema(supabase).rpc('create_programme', {
    p_project_id: input.projectId,
    p_kind: input.kind,
    p_name: input.name,
    p_project_start: input.projectStart,
    p_module_key: input.moduleKey ?? null,
    p_contractor_label: input.contractorLabel ?? null,
  })
  if (error) return refuse(dbSentence(error, 'The programme could not be created. Try again.'))
  return { ok: true, programmeId: String(data) }
}

export async function saveProgrammeChangesAction(input: SaveProgrammeChangesInput): Promise<SaveProgrammeResult> {
  if (!programmeEnabled()) return off()
  if (!Array.isArray(input?.ops)) return refuse(NOT_A_LIST)
  if (typeof input.expectedVersion !== 'string' || input.expectedVersion === '') return refuse(STALE)
  // computedForSave would refuse this after a full load and engine run; refuse it now.
  if (input.ops.some(isKeylessNewActivity)) return refuse(KEYLESS)
  const supabase = await signedInClient()
  if (!supabase) return refuse(SIGNED_OUT)

  const loaded = await loadProgramme(supabase, input.programmeId)
  if (!loaded.ok) return refuse(loaded.error)
  const refusal = await editRefusal(supabase, loaded.state.programme)
  if (refusal) return refuse(refusal)

  const prepared = prepareSave(loaded.state, input.ops)
  if (!prepared.ok) return prepared
  return callSave(supabase, input.programmeId, input.expectedVersion, input.ops, prepared)
}

/** Re-runs the engine on the saved programme and stores the fresh cache: a save with no ops. */
export async function recalculateProgrammeAction(input: { programmeId: string; expectedVersion: string }): Promise<SaveProgrammeResult> {
  return saveProgrammeChangesAction({ programmeId: input?.programmeId, expectedVersion: input?.expectedVersion, ops: [] })
}

export async function saveBaselineAction(input: { programmeId: string; name: string; setActive?: boolean }): Promise<{ ok: true; baselineId: string } | ProgrammeRefusal> {
  if (!programmeEnabled()) return off()
  const supabase = await signedInClient()
  if (!supabase) return refuse(SIGNED_OUT)
  const header = await programmeHeader(supabase, input.programmeId)
  if (!header) return refuse(PROGRAMME_GONE)
  const refusal = await editRefusal(supabase, header)
  if (refusal) return refuse(refusal)

  const { data, error } = await programmeSchema(supabase).rpc('save_baseline', {
    p_programme_id: input.programmeId, p_name: input.name, p_set_active: input.setActive ?? false,
  })
  if (error) return refuse(dbSentence(error, 'The baseline could not be saved. Try again.'))
  return { ok: true, baselineId: String(data) }
}

/** set_active_baseline / delete_baseline: gate through the baseline's programme, then one call. */
async function baselineCall(baselineId: string, fn: 'set_active_baseline' | 'delete_baseline'): Promise<{ ok: true } | ProgrammeRefusal> {
  if (!programmeEnabled()) return off()
  const supabase = await signedInClient()
  if (!supabase) return refuse(SIGNED_OUT)
  const { data: baseline, error: readErr } = await programmeSchema(supabase)
    .from('baselines').select('id, programme_id').eq('id', baselineId).maybeSingle()
  if (readErr || !baseline) return refuse(BASELINE_GONE)
  const header = await programmeHeader(supabase, (baseline as { programme_id: string }).programme_id)
  if (!header) return refuse(BASELINE_GONE)
  const refusal = await editRefusal(supabase, header)
  if (refusal) return refuse(refusal)

  const { error } = await programmeSchema(supabase).rpc(fn, { p_baseline_id: baselineId })
  if (error) return refuse(dbSentence(error, 'The baseline could not be changed. Try again.'))
  return { ok: true }
}

export async function setActiveBaselineAction(input: { baselineId: string }): Promise<{ ok: true } | ProgrammeRefusal> {
  return baselineCall(input?.baselineId, 'set_active_baseline')
}

export async function deleteBaselineAction(input: { baselineId: string }): Promise<{ ok: true } | ProgrammeRefusal> {
  return baselineCall(input?.baselineId, 'delete_baseline')
}

export async function submitFieldUpdateAction(input: FieldUpdateInput): Promise<{ ok: true; fieldUpdateId: string } | ProgrammeRefusal> {
  if (!programmeEnabled()) return off()
  const supabase = await signedInClient()
  if (!supabase) return refuse(SIGNED_OUT)
  const { data, error } = await programmeSchema(supabase).rpc('submit_field_update', {
    p_activity_id: input.activityId,
    p_start: input.start ?? null,
    p_finish: input.finish ?? null,
    p_percent: input.percent ?? null,
    p_remaining: input.remaining ?? null,
    p_note: input.note ?? null,
  })
  if (error) return refuse(dbSentence(error, 'The progress could not be recorded. Try again.'))
  return { ok: true, fieldUpdateId: String(data) }
}

interface FieldUpdateRow {
  id: string; activity_id: string; status: string
  reported_start: string | null; reported_finish: string | null
  reported_percent: number | null; reported_remaining: number | null
}

/** The activity upsert an applied/adjusted decision makes: the agreed actuals, only those that have a value. */
function decisionOp(d: FieldUpdateDecision, row: FieldUpdateRow): ProgrammeOp | null {
  if (d.status === 'rejected') return null
  const pick = <T>(planner: T | null | undefined, reported: T | null): T | null =>
    d.status === 'adjusted' && planner !== undefined ? planner : reported
  const values: Record<string, string | number | null> = {
    actual_start: pick(d.start, row.reported_start),
    actual_finish: pick(d.finish, row.reported_finish),
    percent_complete: pick(d.percent, row.reported_percent),
    remaining_duration: pick(d.remaining, row.reported_remaining),
  }
  const fields = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined))
  if (Object.keys(fields).length === 0) return null
  return { op: 'upsert_activity', id: row.activity_id, fields }
}

export async function decideFieldUpdatesAction(input: {
  programmeId: string
  expectedVersion: string
  decisions: FieldUpdateDecision[]
}): Promise<DecideFieldUpdatesResult> {
  if (!programmeEnabled()) return off()
  const decisions = input?.decisions
  if (!Array.isArray(decisions) || decisions.length === 0) return refuse('Choose at least one field update to decide.')
  if (decisions.length > MAX_DECISIONS) return refuse(`Decide at most ${MAX_DECISIONS} field updates at a time.`)
  if (decisions.some((d) => !d || !['applied', 'adjusted', 'rejected'].includes(d.status))) {
    return refuse('A field update is applied, adjusted or rejected.')
  }
  if (typeof input.expectedVersion !== 'string' || input.expectedVersion === '') return refuse(STALE)
  const supabase = await signedInClient()
  if (!supabase) return refuse(SIGNED_OUT)

  const loaded = await loadProgramme(supabase, input.programmeId)
  if (!loaded.ok) return refuse(loaded.error)
  const refusal = await editRefusal(supabase, loaded.state.programme)
  if (refusal) return refuse(refusal)
  // decide_field_updates takes no version, so check it before deciding anything.
  if (loaded.state.programme.updated_at !== input.expectedVersion) return refuse(STALE)

  const { data: rows, error: readErr } = await programmeSchema(supabase)
    .from('field_updates')
    .select('id, activity_id, status, reported_start, reported_finish, reported_percent, reported_remaining')
    .eq('programme_id', input.programmeId)
    .in('id', decisions.map((d) => d.id))
  if (readErr) return refuse('The field updates could not be read. Reload and try again.')
  const byId = new Map(((rows ?? []) as FieldUpdateRow[]).map((r) => [r.id, r]))
  // An id that is missing here is left to decide_field_updates, which refuses it with its own sentence.
  const ops = decisions.flatMap((d) => {
    const row = byId.get(d.id)
    const op = row ? decisionOp(d, row) : null
    return op ? [op] : []
  })

  // Check the agreed values BEFORE deciding: a refusal here leaves every update undecided.
  const prepared = ops.length > 0 ? prepareSave(loaded.state, ops) : null
  if (prepared && !prepared.ok) return prepared

  const { data: decided, error: decideErr } = await programmeSchema(supabase).rpc('decide_field_updates', {
    p_programme_id: input.programmeId,
    p_decisions: decisions.map((d) => ({ id: d.id, status: d.status, note: d.note ?? null })),
  })
  if (decideErr) return refuse(dbSentence(decideErr, 'The field updates could not be decided. Try again.'))
  const n = Number(decided ?? 0)

  if (!prepared) return { ok: true, decided: n, version: input.expectedVersion, ids: {}, issues: [] }

  // The decisions are committed by now. If this save fails (someone saved in
  // between: 40001), they STAND and the activities keep their old actuals;
  // the planner re-runs the update (or edits the activity) after a reload. No
  // compensation is attempted: un-deciding would rewrite the audit trail.
  const saved = await callSave(supabase, input.programmeId, input.expectedVersion, ops, prepared)
  if (!saved.ok) return saved
  return { ok: true, decided: n, version: saved.version, ids: saved.ids, issues: saved.issues }
}

export async function moduleSummaryAction(input: { projectId: string; moduleKey: 'solar' }): Promise<{ ok: true; summary: ModuleSummary | null } | ProgrammeRefusal> {
  if (!programmeEnabled()) return off()
  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await requireEffectiveRole(supabase, input.projectId, READ_ROLES)
  if (!gate.ok) return refuse(NO_PROJECT_ACCESS)

  const { data, error } = await programmeSchema(supabase).rpc('module_summary', {
    p_project_id: input.projectId, p_module_key: input.moduleKey,
  })
  if (error) return refuse(dbSentence(error, 'The module summary could not be read. Try again.'))
  const row = (Array.isArray(data) ? data[0] : data) as { start: string | null; finish: string | null; percent_complete: number | string | null } | undefined
  if (!row || (row.start === null && row.finish === null && row.percent_complete === null)) return { ok: true, summary: null }
  return {
    ok: true,
    summary: {
      start: row.start, finish: row.finish,
      percentComplete: row.percent_complete === null ? null : Number(row.percent_complete),
    },
  }
}
