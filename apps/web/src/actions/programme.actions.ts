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
import { PROGRAMME_STALE } from '@/lib/programme/action-types'
import { ORG_ROLES, ORG_WRITE_ROLES, solarLevelAllows } from '@esite/shared'
import {
  applyOps, computedForSave, ProgrammeOpError, rowsToProgrammeInput, scheduleProgramme,
  type ComputedSaveEntry, type ImportDiff, type ProgrammeOp, type ProgrammeState, type ScheduleIssue,
} from '@esite/shared/programme'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

const OFF = 'The programme module is not switched on yet.'
const SIGNED_OUT = 'You are not signed in.'
const STALE = PROGRAMME_STALE
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
  // A blank key cannot address the row's cache either, so it counts as no key.
  return op.op === 'upsert_activity' && (op.id === undefined || op.id === null)
    && (typeof op.key !== 'string' || op.key.trim() === '')
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

type SaveDecision = { id: string; status: FieldUpdateDecision['status']; note: string | null }

/**
 * ONE save_changes call. Field-update `decisions` are recorded in the same
 * transaction as the ops, under the same version check, so a decision never
 * stands without the actuals it agreed to. `prepared` null = no ops and no
 * engine run: the cache is left as it is.
 */
async function callSave(
  supabase: AnyClient, programmeId: string, expectedVersion: string, ops: ProgrammeOp[],
  prepared: Extract<Prepared, { ok: true }> | null, decisions: SaveDecision[] = [], fallback = SAVE_FAILED,
): Promise<SaveProgrammeResult & { decided?: number }> {
  const { data, error } = await programmeSchema(supabase).rpc('save_changes', {
    p_programme_id: programmeId,
    p_expected_version: expectedVersion,
    p_ops: ops,
    p_computed: prepared ? prepared.computed : null,
    ...(decisions.length > 0 ? { p_decisions: decisions } : {}),
  })
  if (error) return refuse(dbSentence(error, fallback))
  const out = (data ?? {}) as { version?: string; ids?: Record<string, string>; decided?: number }
  return { ok: true, version: String(out.version ?? ''), ids: out.ids ?? {}, issues: prepared?.issues ?? [], decided: Number(out.decided ?? 0) }
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

const NOT_RECORDED = 'The programme was imported, but the revision record was not saved.'
const DIFF_REFUSED = 'The import summary may hold only counts, activity ids and names.'
const DIFF_KEYS = new Set(['added', 'changed', 'removed', 'linksAdded', 'linksRemoved', 'linksChanged', 'calendarChanged', 'dataDate', 'unchanged'])

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * The ImportDiff shape and nothing else, at every level: imports.diff is read
 * by every programme reader (contractors included) and the cost mask does not
 * cover it, so no rand may ride along. record_import refuses the same (22023);
 * this answers first with the same sentence.
 */
function isImportDiff(d: unknown): d is ImportDiff {
  if (!isPlainObject(d)) return false
  const isStr = (v: unknown) => typeof v === 'string'
  const items = (v: unknown, extra: (k: string, x: unknown) => boolean) =>
    Array.isArray(v) && v.every((it) => isPlainObject(it)
      && Object.entries(it).every(([k, x]) => ((k === 'uid' || k === 'name') && isStr(x)) || extra(k, x)))
  return Object.entries(d).every(([k, v]) => {
    if (!DIFF_KEYS.has(k)) return false
    if (k === 'added' || k === 'removed') return items(v, () => false)
    if (k === 'changed') return items(v, (fk, x) => fk === 'fields' && Array.isArray(x) && x.every(isStr))
    if (k === 'calendarChanged') return typeof v === 'boolean'
    if (k === 'dataDate') return v === null || (isPlainObject(v) && Object.entries(v).every(([dk, x]) => (dk === 'from' || dk === 'to') && (x === null || isStr(x))))
    return typeof v === 'number' && Number.isFinite(v)
  })
}

/**
 * Records one MS Project import: the imports row plus an ACTIVE revision
 * baseline (source 'import') snapshotted from the programme as it stands. Run
 * AFTER saveProgrammeChangesAction has saved the import's ops, so every
 * refusal says the import itself stood. It is history only: nothing is undone
 * when it fails.
 */
export async function recordImportAction(input: {
  programmeId: string; fileName: string; revisionLabel?: string | null; diff: ImportDiff
}): Promise<{ ok: true; importId: string; baselineId: string } | ProgrammeRefusal> {
  if (!programmeEnabled()) return off()
  const notRecorded = (reason?: string): ProgrammeRefusal => refuse(reason ? `${NOT_RECORDED} ${reason}` : NOT_RECORDED)
  const fileName = typeof input?.fileName === 'string' ? input.fileName.trim() : ''
  if (fileName === '') return notRecorded('Name the imported file.')
  const label = typeof input.revisionLabel === 'string' ? input.revisionLabel.trim() : ''
  if (!isImportDiff(input.diff)) return notRecorded(DIFF_REFUSED)
  const supabase = await signedInClient()
  if (!supabase) return notRecorded(SIGNED_OUT)
  const header = await programmeHeader(supabase, input.programmeId)
  if (!header) return notRecorded(PROGRAMME_GONE)
  const refusal = await editRefusal(supabase, header)
  if (refusal) return notRecorded(refusal)

  const { data, error } = await programmeSchema(supabase).rpc('record_import', {
    p_programme_id: input.programmeId,
    p_file_name: fileName,
    p_revision_label: label === '' ? null : label,
    p_diff: input.diff,
    p_mapping: null,
  })
  if (error) {
    const sentence = dbSentence(error, '')
    return notRecorded(sentence || undefined)
  }
  const out = (data ?? {}) as { import_id?: string; baseline_id?: string }
  if (!out.import_id || !out.baseline_id) return notRecorded()
  return { ok: true, importId: String(out.import_id), baselineId: String(out.baseline_id) }
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
  id: string; activity_id: string; status: string; created_at: string
  reported_start: string | null; reported_finish: string | null
  reported_percent: number | null; reported_remaining: number | null
}

/** The activity upsert an applied/adjusted decision makes: the agreed actuals, only those that have a value. */
function decisionOp(d: FieldUpdateDecision, row: FieldUpdateRow): ProgrammeOp | null {
  if (d.status === 'rejected') return null
  // A planner value that is left out OR null falls back to the reported one (nothing is cleared).
  const pick = <T>(planner: T | null | undefined, reported: T | null): T | null =>
    d.status === 'adjusted' && planner !== undefined && planner !== null ? planner : reported
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
  // An early refusal only (save_changes re-checks the exact version under its
  // lock): compared as instants, to the millisecond JS can hold; an
  // unparseable version is refused as stale before any read.
  const have = Date.parse(String(loaded.state.programme.updated_at ?? ''))
  const want = Date.parse(input.expectedVersion)
  if (Number.isNaN(have) || Number.isNaN(want) || have !== want) return refuse(STALE)

  const { data: rows, error: readErr } = await programmeSchema(supabase)
    .from('field_updates')
    .select('id, activity_id, status, created_at, reported_start, reported_finish, reported_percent, reported_remaining')
    .eq('programme_id', input.programmeId)
    .in('id', decisions.map((d) => d.id))
  if (readErr) return refuse('The field updates could not be read. Reload and try again.')
  const byId = new Map(((rows ?? []) as FieldUpdateRow[]).map((r) => [r.id, r]))
  // An id that is missing here is left to save_changes, which refuses it with its own sentence.
  // Ops go in the order the reports were MADE (oldest first, then id), so with
  // several reports on one activity the newest one wins whatever the client's order.
  const ops = decisions
    .flatMap((d) => {
      const row = byId.get(d.id)
      return row ? [{ d, row }] : []
    })
    .sort((a, b) => Date.parse(a.row.created_at) - Date.parse(b.row.created_at) || a.row.id.localeCompare(b.row.id))
    .flatMap(({ d, row }) => {
      const op = decisionOp(d, row)
      return op ? [op] : []
    })

  // Check the agreed values before sending: a refusal here writes nothing.
  const prepared = ops.length > 0 ? prepareSave(loaded.state, ops) : null
  if (prepared && !prepared.ok) return prepared

  // ONE save_changes call: the decisions and the agreed actuals commit
  // together under the version check, or neither does (a stale version
  // leaves every report 'reported').
  const saved = await callSave(
    supabase, input.programmeId, input.expectedVersion, ops, prepared,
    decisions.map((d) => ({ id: d.id, status: d.status, note: d.note ?? null })),
    'The field updates could not be decided. Try again.',
  )
  if (!saved.ok) return saved
  return { ok: true, decided: saved.decided ?? 0, version: saved.version, ids: saved.ids, issues: saved.issues }
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

/**
 * The programme's current version (`programmes.updated_at`), for the screen's 30-second
 * poll. Same read gate as the page: every project role except client_viewer, and the
 * row read as the person (RLS), so a programme they cannot see is "gone".
 */
export async function programmeVersionAction(input: { programmeId: string }): Promise<{ ok: true; version: string } | ProgrammeRefusal> {
  if (!programmeEnabled()) return off()
  const supabase = await signedInClient()
  if (!supabase) return refuse(SIGNED_OUT)
  const { data, error } = await programmeSchema(supabase)
    .from('programmes').select('id, project_id, updated_at').eq('id', input.programmeId).maybeSingle()
  if (error) return refuse('The programme could not be read. Try again.')
  if (!data) return refuse(PROGRAMME_GONE)
  const row = data as { project_id: string; updated_at: string | null }
  const gate = await requireEffectiveRole(supabase, row.project_id, READ_ROLES)
  if (!gate.ok) return refuse(NO_PROJECT_ACCESS)
  return { ok: true, version: String(row.updated_at ?? '') }
}
