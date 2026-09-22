/**
 * The TypeScript half of the work-item registry.
 *
 * The DATABASE is authoritative — `projects.work_item_types` is the registry
 * and `work_items.ball_in_court_id` is a STORED generated column. This module
 * exists for exactly three jobs:
 *
 *   1. §12 §(h) test 1 asserts set equality in both directions between
 *      Appendix A(b), the DB registry and this union, so an `item_type`
 *      literal that appears in application code and nowhere else fails CI.
 *   2. An optimistic UI must predict the next ball-in-court holder before the
 *      round trip. `ballInCourt()` is a MIRROR, never a second source: a
 *      contract test asserts it agrees with the generated column over all
 *      five statuses.
 *   3. REF_PREFIXES and STATE_LABELS are read by the Inbox, My Work, the PDF
 *      renderers and the 07:00 recap. One copy, here, or four copies later.
 *
 * Pure. Imports nothing outside this package (packages/shared/src/index.ts:33-38
 * — a heavy transitive import from the barrel crashes the admin layout).
 */
import {
  ORG_WRITE_ROLES,
  MARKUP_WRITE_ROLES,
  QC_WRITE_ROLES,
  SNAG_FIELD_ROLES,
  FORMS_FIELD_ROLES,
  type OrgRole,
} from '../types'

/** Appendix A(a) — the five universal states. Source vocabularies are mirrored
 *  into the display-only `source_status`, never into this set. */
export const WORK_ITEM_STATUSES = ['triage', 'open', 'answered', 'closed', 'void'] as const
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number]

/** Appendix A(a) — priority. `qc_defect` maps severity onto this
 *  (minor→low, major→high, critical→critical), never a flat medium. */
export const WORK_ITEM_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number]

/** Appendix A(a) — how the row came to exist. `split` is the deliberate
 *  two-people-one-source case the per-source partial UNIQUE excludes. */
export const WORK_ITEM_ORIGINS = ['mirror', 'split', 'manual'] as const
export type WorkItemOrigin = (typeof WORK_ITEM_ORIGINS)[number]

/** Appendix A(h) — the two named calendars, resolved from
 *  `project_settings.working_days`. `site` = `office` plus Saturday. */
export const WORK_ITEM_CALENDARS = ['office', 'site'] as const
export type WorkItemCalendar = (typeof WORK_ITEM_CALENDARS)[number]

/** How the gatekeeper is resolved for a type. Stored as
 *  `work_item_types.gatekeeper_rule`; read by item 3's mirror triggers. */
export const GATEKEEPER_RULES = ['project_pm', 'verifier_else_pm', 'creator'] as const
export type GatekeeperRule = (typeof GATEKEEPER_RULES)[number]

export interface WorkItemTypeSpec {
  readonly key: string
  readonly label: string
  /** Fully-qualified source table, or null for a sourceless type. */
  readonly sourceTable: string | null
  /** The source's own owner column, read at mirror time as the seed assignee. */
  readonly sourceColumn: string | null
  readonly defaultDays: number
  readonly calendar: WorkItemCalendar
  readonly gatekeeperRule: GatekeeperRule
  readonly writeRoles: readonly OrgRole[]
  readonly sortOrder: number
}

/**
 * Appendix A(b), Q1 rows only. `instruction` (Q2), `approval` (Q3) and
 * `valuation` (Q4) are registered by the migration of the quarter that first
 * creates rows of them — they are NOT listed here as headroom.
 *
 * `rfi`'s 7 is not a new number: it is the platform's existing
 * `project_settings.default_rfi_due_days` default (00101_project_settings.sql:30),
 * and the due-date trigger reads that COLUMN live rather than a copy of it.
 */
export const WORK_ITEM_TYPES = [
  { key: 'rfi',            label: 'RFI',              sourceTable: 'projects.rfis',                sourceColumn: 'assigned_to',     defaultDays: 7,  calendar: 'office', gatekeeperRule: 'creator',          writeRoles: MARKUP_WRITE_ROLES, sortOrder: 1 },
  { key: 'snag',           label: 'Snag',             sourceTable: 'field.snags',                  sourceColumn: 'assigned_to',     defaultDays: 5,  calendar: 'site',   gatekeeperRule: 'project_pm',       writeRoles: SNAG_FIELD_ROLES,   sortOrder: 2 },
  { key: 'qc_defect',      label: 'QC defect',        sourceTable: 'projects.qc_entries',          sourceColumn: null,              defaultDays: 5,  calendar: 'site',   gatekeeperRule: 'project_pm',       writeRoles: QC_WRITE_ROLES,     sortOrder: 3 },
  { key: 'inspection',     label: 'Inspection',       sourceTable: 'inspections.inspections',      sourceColumn: 'assigned_to_id',  defaultDays: 3,  calendar: 'site',   gatekeeperRule: 'verifier_else_pm', writeRoles: ORG_WRITE_ROLES,    sortOrder: 4 },
  { key: 'diary_action',   label: 'Diary action',     sourceTable: 'projects.site_diary_entries',  sourceColumn: null,              defaultDays: 2,  calendar: 'site',   gatekeeperRule: 'project_pm',       writeRoles: MARKUP_WRITE_ROLES, sortOrder: 5 },
  { key: 'form_action',    label: 'Form action',      sourceTable: 'field.site_forms',             sourceColumn: null,              defaultDays: 3,  calendar: 'site',   gatekeeperRule: 'project_pm',       writeRoles: FORMS_FIELD_ROLES,  sortOrder: 6 },
  { key: 'order_followup', label: 'Order follow-up',  sourceTable: 'structure.node_orders',        sourceColumn: null,              defaultDays: 10, calendar: 'office', gatekeeperRule: 'project_pm',       writeRoles: ORG_WRITE_ROLES,    sortOrder: 7 },
  { key: 'task',           label: 'Task',             sourceTable: null,                           sourceColumn: null,              defaultDays: 5,  calendar: 'office', gatekeeperRule: 'creator',          writeRoles: MARKUP_WRITE_ROLES, sortOrder: 8 },
] as const satisfies readonly WorkItemTypeSpec[]

/** The closed union of registered type keys — narrowed from WORK_ITEM_TYPES via
 *  `as const satisfies`, not hand-written, so adding a row here is the only
 *  way to grow it. */
export type WorkItemTypeKey = (typeof WORK_ITEM_TYPES)[number]['key']
export const WORK_ITEM_TYPE_KEYS: readonly WorkItemTypeKey[] = WORK_ITEM_TYPES.map((t) => t.key)

/** Runtime guard mirroring the `WorkItemTypeKey` compile-time union — the gate
 *  `refPrefix`/`stateLabel` use before indexing, since a DB row's `item_type`
 *  arrives as untyped `string`. */
export const isWorkItemTypeKey = (k: string): k is WorkItemTypeKey =>
  (WORK_ITEM_TYPE_KEYS as readonly string[]).includes(k)

/**
 * The human half of `work_items.ref`.
 *
 * `ref` is IMMUTABLE by design — it is a permanent identifier in emails, PDFs
 * and other people's notes — and §15 §(e) lists work-item ids in client deep
 * links as a one-way door. So the prefix is decided once, here and in the
 * matching CASE inside projects.work_items_ensure_ref(), and the contract test
 * asserts the two agree. `upper(item_type)` would have shipped QC_DEFECT-7 and
 * ORDER_FOLLOWUP-3 to a foreman on WhatsApp, permanently.
 *
 * This is NOT a column on work_item_types: A(b) fixes that table's column set,
 * and §12 §(h) test 1 (work-item-types.contract.test.ts, "the
 * projects.work_item_types column set is exactly A(b)'s") asserts the CREATE
 * TABLE's column names equal A(b)'s list.
 */
export const REF_PREFIXES: Readonly<Record<WorkItemTypeKey, string>> = {
  rfi: 'RFI',
  snag: 'SNAG',
  qc_defect: 'QC',
  inspection: 'INSP',
  diary_action: 'DIARY',
  form_action: 'FORM',
  order_followup: 'ORD',
  task: 'TASK',
}

export function refPrefix(key: string): string {
  return isWorkItemTypeKey(key) ? REF_PREFIXES[key] : key.toUpperCase()
}

/**
 * The reader-facing word for a universal status, per type.
 *
 * The STORED vocabulary stays A(a)'s five values — that is what the schema,
 * the metrics and the policies are written against. But five universal states
 * are right for the schema and wrong for the reader: a foreman marking a snag
 * fixed is hunting for "Done", and a landlord reading "Answered" on an
 * inspection learns nothing. Every field product in the research set narrows
 * the vocabulary by role and context rather than exposing its internal one.
 *
 * Items 5, 6 and 7 and the PDF renderers all read this map, so there is one
 * copy of the wording rather than four.
 */
export const STATE_LABELS: Readonly<
  Record<WorkItemTypeKey, Readonly<Record<WorkItemStatus, string>>>
> = {
  rfi: {            triage: 'Needs an owner', open: 'Open',        answered: 'Answered',                  closed: 'Closed',   void: 'Withdrawn' },
  snag: {           triage: 'Needs an owner', open: 'To fix',      answered: 'Fixed — awaiting sign-off', closed: 'Signed off', void: 'Withdrawn' },
  qc_defect: {      triage: 'Needs an owner', open: 'To fix',      answered: 'Fixed — awaiting re-check', closed: 'Cleared',  void: 'Withdrawn' },
  inspection: {     triage: 'Needs an owner', open: 'To inspect',  answered: 'Awaiting verification',     closed: 'Verified', void: 'Cancelled' },
  diary_action: {   triage: 'Needs an owner', open: 'To action',   answered: 'Done — awaiting review',    closed: 'Closed',   void: 'Withdrawn' },
  form_action: {    triage: 'Needs an owner', open: 'To complete', answered: 'Submitted',                 closed: 'Accepted', void: 'Withdrawn' },
  order_followup: { triage: 'Needs an owner', open: 'Chasing',     answered: 'Supplier replied',          closed: 'Resolved', void: 'Dropped' },
  task: {           triage: 'Needs an owner', open: 'To do',       answered: 'Done — awaiting the creator', closed: 'Done',   void: 'Dropped' },
}

export function stateLabel(key: string, status: WorkItemStatus): string {
  return isWorkItemTypeKey(key) ? STATE_LABELS[key][status] : status
}

/**
 * Mirror of Appendix A(a)'s STORED generated column:
 *
 *   CASE status WHEN 'triage'   THEN assignee_id
 *               WHEN 'open'     THEN assignee_id
 *               WHEN 'answered' THEN gatekeeper_id
 *               ELSE NULL END
 *
 * The database column is authoritative and unwritable by anyone. Use this only
 * to render the next holder before a mutation returns.
 */
// Exhaustiveness is enforced by the `string | null` return type, not by a
// `default`: a sixth status added to WORK_ITEM_STATUSES without a new arm here
// fails to compile with TS2366 (not all code paths return a value) — so do not
// add one.
export function ballInCourt(
  status: WorkItemStatus,
  assigneeId: string,
  gatekeeperId: string,
): string | null {
  switch (status) {
    case 'triage':
    case 'open':
      return assigneeId
    case 'answered':
      return gatekeeperId
    case 'closed':
    case 'void':
      return null
  }
}
