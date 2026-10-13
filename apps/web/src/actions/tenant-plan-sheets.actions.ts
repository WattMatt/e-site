'use server'

/**
 * Tenant plan sheets — upload, replace, re-anchor, rename, delete, scale
 * (spec 2026-10-12 §3, §4).
 *
 * Files never pass through a Vercel function on the way in: the server hands
 * the browser a signed upload URL for a path it builds itself, the browser
 * uploads straight to the private tenant-plan-files bucket, and a second
 * action registers what arrived. Registration reads the object back through
 * the caller's session (the bucket's read policy is the gate) and counts PDF
 * pages itself: a page count the client claims is never trusted. Signed upload
 * URLs are minted with the caller's session, so the bucket's INSERT policy
 * (owner / admin / PM of that project) is checked as that person.
 *
 * Same rules as status-plan.actions.ts:
 *  - { ok, error }, never a thrown sentence (production redacts them);
 *  - requireEffectiveRole(…, ORG_WRITE_ROLES) on the plan's own project, `.ok`;
 *  - edits to an existing sheet are conditional on updated_at in the same
 *    statement; zero rows back is a conflict, never a silent success;
 *  - organisation_id, created_by, revision and replaced_* are never sent:
 *    the 00249 triggers derive them.
 *
 * Only async functions are exported ('use server'); types live in
 * lib/status-plans/types.ts.
 */
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES, derivePixelsPerMeter } from '@esite/shared'
import {
  DEFAULT_PLAN_NAME,
  SHEET_LABEL_MAX,
  STATUS_PLAN_PURPOSES,
  TENANT_PLAN_BUCKET,
  TENANT_PLAN_MIMES,
  type StatusPlanPurpose,
  type StatusPlanSheetRow,
  type TenantPlanMime,
} from '@esite/shared/status-plans'
import { statusPlanWriteError } from '@/lib/status-plans/write-errors'
import { SHEET_COLUMNS, toSheetSummary } from '@/lib/status-plans/sheet-row'
import {
  MAX_FILES_PER_UPLOAD,
  MAX_SHEETS_PER_PLAN,
  countPdfPages,
  defaultSheetLabels,
  extFor,
  fileProblem,
  mimeForFile,
  parseSheetPath,
  sheetFilePath,
} from '@/lib/status-plans/sheet-files'
import { tenantScheduleHref } from '@/lib/status-plans/plan-urls'
import type { ActionResult, PreparedUpload, SheetSummary } from '@/lib/status-plans/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const uuid = z.string().uuid()
const updatedAt = z.string().min(1)

const SIGNED_OUT = 'Your session has ended. Sign in again.'
const NOT_ALLOWED = 'Only an owner, admin or project manager can change tenant plans on this project.'
const PLAN_GONE = 'That plan no longer exists, or you cannot see it. Reload the page.'
const SHEET_GONE = 'This sheet has been deleted by someone else — reload the page.'
const SHEET_STALE = 'This sheet was changed by someone else — reload to see it.'
const NOT_THIS_PLAN = 'That upload does not belong to this plan. Upload the file again.'
const FILE_REMOVE_FAILED = 'Could not remove the sheet\'s file, so the sheet was kept. Try again.'
const PREPARE_FAILED = 'Could not prepare the upload. Try again.'

type Fail = { ok: false; error: string; conflict?: boolean }
const fail = (error: string, conflict?: boolean): Fail => (conflict ? { ok: false, error, conflict } : { ok: false, error })
const invalid = (e: z.ZodError): Fail => fail(e.issues[0]?.message ?? 'That request was not valid.')

async function signedIn(): Promise<any | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? supabase : null
}

async function mayWrite(supabase: any, projectId: string): Promise<boolean> {
  const gate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  return gate.ok
}

const PLAN_CTX = 'id, project_id, organisation_id, purpose'
type PlanCtx = { id: string; project_id: string; organisation_id: string; purpose: StatusPlanPurpose }

async function planById(supabase: any, planId: string): Promise<PlanCtx | null> {
  const { data } = await supabase.schema('tenants').from('status_plans').select(PLAN_CTX).eq('id', planId).maybeSingle()
  return (data as PlanCtx | null) ?? null
}

async function planFor(supabase: any, projectId: string, purpose: StatusPlanPurpose): Promise<PlanCtx | null> {
  const { data } = await supabase.schema('tenants').from('status_plans').select(PLAN_CTX)
    .eq('project_id', projectId).eq('purpose', purpose).maybeSingle()
  return (data as PlanCtx | null) ?? null
}

/** The project's plan for this purpose, created on the first upload. */
async function ensurePlan(supabase: any, projectId: string, purpose: StatusPlanPurpose): Promise<PlanCtx | Fail> {
  const existing = await planFor(supabase, projectId, purpose)
  if (existing) return existing
  const { data, error } = await supabase.schema('tenants').from('status_plans')
    .insert({ project_id: projectId, purpose, name: DEFAULT_PLAN_NAME[purpose] })
    .select(PLAN_CTX).maybeSingle()
  if (error?.code === '23505') {
    // Someone else created it a moment ago (unique project + purpose).
    const again = await planFor(supabase, projectId, purpose)
    if (again) return again
  }
  if (error) return fail(statusPlanWriteError(error, 'plan'))
  if (!data) return fail(NOT_ALLOWED)
  return data as PlanCtx
}

type SheetCtx = { sheet: StatusPlanSheetRow; plan: PlanCtx }

async function sheetContext(supabase: any, sheetId: string): Promise<SheetCtx | Fail> {
  const { data: sheet } = await supabase.schema('tenants').from('status_plan_sheets')
    .select(SHEET_COLUMNS).eq('id', sheetId).maybeSingle()
  if (!sheet) return fail(SHEET_GONE, true)
  const plan = await planById(supabase, (sheet as StatusPlanSheetRow).status_plan_id)
  if (!plan) return fail(PLAN_GONE)
  return { sheet: sheet as StatusPlanSheetRow, plan }
}

/** A conditional write answered zero rows: moved on, or deleted? */
async function staleOrGone(supabase: any, sheetId: string): Promise<Fail> {
  const { data } = await supabase.schema('tenants').from('status_plan_sheets').select('id').eq('id', sheetId).maybeSingle()
  return data ? fail(SHEET_STALE, true) : fail(SHEET_GONE, true)
}

/** Read an uploaded object back through the caller's session. */
async function readUpload(supabase: any, path: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from(TENANT_PLAN_BUCKET).download(path)
  if (error || !data) return null
  return new Uint8Array(await (data as Blob).arrayBuffer())
}

async function pagesOf(bytes: Uint8Array, mime: TenantPlanMime): Promise<number | null> {
  return mime === 'application/pdf' ? countPdfPages(bytes) : 1
}

/** Delete a file only when no sheet of this plan still shows it or remembers it. */
async function removeUnreferencedFiles(supabase: any, planId: string, paths: Array<string | null>): Promise<void> {
  for (const path of new Set(paths.filter((p): p is string => !!p))) {
    const [a, b] = await Promise.all([
      supabase.schema('tenants').from('status_plan_sheets').select('id').eq('status_plan_id', planId).eq('file_path', path).limit(1),
      supabase.schema('tenants').from('status_plan_sheets').select('id').eq('status_plan_id', planId).eq('replaced_from_path', path).limit(1),
    ])
    if (a.error || b.error || (a.data ?? []).length > 0 || (b.data ?? []).length > 0) continue
    const { error } = await supabase.storage.from(TENANT_PLAN_BUCKET).remove([path])
    if (error) console.error('[tenant-plans] could not remove an unused sheet file', error.message)
  }
}

/** The paths among these that no OTHER sheet of the plan shows or remembers; null when that could not be read. */
async function filesOnlyThisSheetUses(supabase: any, planId: string, sheetId: string, paths: Array<string | null>): Promise<string[] | null> {
  const out: string[] = []
  for (const path of new Set(paths.filter((p): p is string => !!p))) {
    const [a, b] = await Promise.all([
      supabase.schema('tenants').from('status_plan_sheets').select('id').eq('status_plan_id', planId).neq('id', sheetId).eq('file_path', path).limit(1),
      supabase.schema('tenants').from('status_plan_sheets').select('id').eq('status_plan_id', planId).neq('id', sheetId).eq('replaced_from_path', path).limit(1),
    ])
    if (a.error || b.error) return null
    if ((a.data ?? []).length === 0 && (b.data ?? []).length === 0) out.push(path)
  }
  return out
}

const fileSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  type: z.string().max(100),
})

// ── Upload ─────────────────────────────────────────────────────────────────

const prepareSchema = z.object({
  projectId: uuid,
  purpose: z.enum(STATUS_PLAN_PURPOSES),
  files: z.array(fileSchema)
    .min(1, 'Choose at least one file.')
    .max(MAX_FILES_PER_UPLOAD, `Upload at most ${MAX_FILES_PER_UPLOAD} files at a time.`),
})

export async function prepareTenantPlanUploadAction(
  input: z.input<typeof prepareSchema>,
): Promise<ActionResult<{ planId: string; uploads: PreparedUpload[] }>> {
  const parsed = prepareSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  for (const f of parsed.data.files) {
    const problem = fileProblem(f)
    if (problem) return fail(problem)
  }
  const { projectId, purpose, files } = parsed.data
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  if (!(await mayWrite(supabase, projectId))) return fail(NOT_ALLOWED)

  const plan = await ensurePlan(supabase, projectId, purpose)
  if ('ok' in plan) return plan

  const uploads: PreparedUpload[] = []
  for (const f of files) {
    const mime = mimeForFile(f.name, f.type)!
    const path = sheetFilePath({ orgId: plan.organisation_id, projectId: plan.project_id, planId: plan.id, folderId: randomUUID(), revision: 1, mime })
    const { data, error } = await supabase.storage.from(TENANT_PLAN_BUCKET).createSignedUploadUrl(path, { upsert: false })
    if (error || !data?.token) return fail(PREPARE_FAILED)
    uploads.push({ path, token: data.token as string, mime })
  }
  return { ok: true, data: { planId: plan.id, uploads } }
}

const registerSchema = z.object({
  planId: uuid,
  files: z.array(z.object({
    path: z.string().min(1).max(400),
    fileName: z.string().trim().min(1).max(255),
    mime: z.enum(TENANT_PLAN_MIMES),
  })).min(1).max(MAX_FILES_PER_UPLOAD),
})

export async function registerTenantPlanSheetsAction(
  input: z.input<typeof registerSchema>,
): Promise<ActionResult<{ sheets: SheetSummary[] }>> {
  const parsed = registerSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const plan = await planById(supabase, parsed.data.planId)
  if (!plan) return fail(PLAN_GONE)
  if (!(await mayWrite(supabase, plan.project_id))) return fail(NOT_ALLOWED)

  const files = parsed.data.files
  if (new Set(files.map((f) => f.path)).size !== files.length) return fail(NOT_THIS_PLAN)
  for (const f of files) {
    const parts = parseSheetPath(f.path)
    if (!parts || parts.orgId !== plan.organisation_id || parts.projectId !== plan.project_id || parts.planId !== plan.id
      || parts.revision !== 1 || parts.ext !== extFor(f.mime)) {
      return fail(NOT_THIS_PLAN)
    }
  }

  const { data: existing, error: exErr } = await supabase.schema('tenants').from('status_plan_sheets')
    .select('id, sort_order').eq('status_plan_id', plan.id)
  if (exErr) return fail('The plan could not be read. Reload and try again.')
  const current = (existing ?? []) as Array<{ sort_order: number }>
  let next = current.reduce((m, r) => Math.max(m, Number(r.sort_order) + 1), 0)

  const rows: Array<Record<string, unknown>> = []
  for (const f of files) {
    const bytes = await readUpload(supabase, f.path)
    if (!bytes) return fail(`${f.fileName} did not finish uploading. Try again.`)
    const pages = await pagesOf(bytes, f.mime)
    if (!pages) return fail(`${f.fileName} could not be read as a PDF. Save it again from the drawing program and upload it.`)
    const labels = defaultSheetLabels(f.fileName, pages)
    const folderId = parseSheetPath(f.path)!.folderId
    for (let page = 1; page <= pages; page++) {
      rows.push({
        id: page === 1 ? folderId : randomUUID(),
        status_plan_id: plan.id,
        sort_order: next++,
        label: labels[page - 1],
        file_path: f.path,
        page_index: page,
        file_name: f.fileName,
        mime: f.mime,
      })
    }
  }
  if (current.length + rows.length > MAX_SHEETS_PER_PLAN) {
    return fail(`A plan holds at most ${MAX_SHEETS_PER_PLAN} sheets; this upload would make ${current.length + rows.length}.`)
  }

  const { data, error } = await supabase.schema('tenants').from('status_plan_sheets').insert(rows).select(SHEET_COLUMNS)
  if (error) return fail(statusPlanWriteError(error, 'sheet'))
  const saved = ((data ?? []) as StatusPlanSheetRow[]).map(toSheetSummary).sort((a, b) => a.sortOrder - b.sortOrder)
  if (saved.length !== rows.length) return fail('The sheets may not all have been saved. Reload the page.')
  revalidatePath(tenantScheduleHref(plan.project_id))
  return { ok: true, data: { sheets: saved } }
}

// ── Replace and re-anchor ──────────────────────────────────────────────────

export async function prepareTenantPlanSheetReplaceAction(
  input: { sheetId: string; file: z.input<typeof fileSchema> },
): Promise<ActionResult<PreparedUpload>> {
  const parsed = z.object({ sheetId: uuid, file: fileSchema }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const problem = fileProblem(parsed.data.file)
  if (problem) return fail(problem)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const ctx = await sheetContext(supabase, parsed.data.sheetId)
  if ('ok' in ctx) return ctx
  if (!(await mayWrite(supabase, ctx.plan.project_id))) return fail(NOT_ALLOWED)

  const mime = mimeForFile(parsed.data.file.name, parsed.data.file.type)!
  const path = sheetFilePath({
    orgId: ctx.plan.organisation_id, projectId: ctx.plan.project_id, planId: ctx.plan.id,
    folderId: ctx.sheet.id, revision: Number(ctx.sheet.revision) + 1, mime,
  })
  // A replacement abandoned half-way leaves its object here; no sheet can show
  // a revision it has not reached, so clearing it is safe.
  await supabase.storage.from(TENANT_PLAN_BUCKET).remove([path])
  const { data, error } = await supabase.storage.from(TENANT_PLAN_BUCKET).createSignedUploadUrl(path, { upsert: false })
  if (error || !data?.token) return fail(PREPARE_FAILED)
  return { ok: true, data: { path, token: data.token as string, mime } }
}

const replaceSchema = z.object({
  sheetId: uuid,
  expectedUpdatedAt: updatedAt,
  path: z.string().min(1).max(400),
  fileName: z.string().trim().min(1).max(255),
  mime: z.enum(TENANT_PLAN_MIMES),
  pageIndex: z.number().int().min(1, 'Pages are numbered from 1.').max(100000),
})

export async function replaceTenantPlanSheetAction(input: z.input<typeof replaceSchema>): Promise<ActionResult<SheetSummary>> {
  const parsed = replaceSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { sheetId, expectedUpdatedAt, path, fileName, mime, pageIndex } = parsed.data
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const ctx = await sheetContext(supabase, sheetId)
  if ('ok' in ctx) return ctx
  if (!(await mayWrite(supabase, ctx.plan.project_id))) return fail(NOT_ALLOWED)

  const parts = parseSheetPath(path)
  const mine = parts && parts.orgId === ctx.plan.organisation_id && parts.projectId === ctx.plan.project_id
    && parts.planId === ctx.plan.id && parts.folderId === ctx.sheet.id && parts.ext === extFor(mime)
  if (!mine) return fail(NOT_THIS_PLAN)
  if (parts!.revision !== Number(ctx.sheet.revision) + 1) return fail(SHEET_STALE, true)

  if (mime !== 'application/pdf' && pageIndex !== 1) return fail('An image has one page.')
  const bytes = await readUpload(supabase, path)
  if (!bytes) return fail(`${fileName} did not finish uploading. Try again.`)
  const pages = await pagesOf(bytes, mime)
  if (!pages) return fail(`${fileName} could not be read as a PDF. Save it again from the drawing program and upload it.`)
  if (pageIndex > pages) return fail(`${fileName} has ${pages} page${pages === 1 ? '' : 's'}; pick a page from 1 to ${pages}.`)

  const { data, error } = await supabase.schema('tenants').from('status_plan_sheets')
    .update({ file_path: path, page_index: pageIndex, file_name: fileName, mime })
    .eq('id', sheetId)
    .eq('updated_at', expectedUpdatedAt)
    .select(SHEET_COLUMNS)
    .maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'sheet'))
  if (!data) return staleOrGone(supabase, sheetId)
  revalidatePath(tenantScheduleHref(ctx.plan.project_id))
  return { ok: true, data: toSheetSummary(data as StatusPlanSheetRow) }
}

/** "The file changed; I have checked the shapes": clear the replaced flag. Masks and scale stay. */
export async function reanchorTenantPlanSheetAction(input: { sheetId: string; expectedUpdatedAt: string }): Promise<ActionResult<SheetSummary>> {
  return patchSheet(input, { replaced_at: null })
}

export async function renameTenantPlanSheetAction(
  input: { sheetId: string; expectedUpdatedAt: string; label: string },
): Promise<ActionResult<SheetSummary>> {
  const parsed = z.object({
    label: z.string().trim().min(1, 'Give the sheet a name.').max(SHEET_LABEL_MAX, `Keep the sheet name under ${SHEET_LABEL_MAX} characters.`),
  }).safeParse({ label: input.label })
  if (!parsed.success) return invalid(parsed.error)
  return patchSheet(input, { label: parsed.data.label })
}

const calibrateSchema = z.object({
  sheetId: uuid,
  expectedUpdatedAt: updatedAt,
  points: z.array(z.number().finite()).length(4, 'Pick two points first.'),
  realMetres: z.number().positive('Enter a positive distance in metres.').max(10000, 'That distance is too large.'),
})

/** Set this sheet's scale from two points and the real distance between them. */
export async function calibrateTenantPlanSheetAction(input: z.input<typeof calibrateSchema>): Promise<ActionResult<SheetSummary>> {
  const parsed = calibrateSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  let ppm: number
  try {
    ppm = derivePixelsPerMeter(parsed.data.points, parsed.data.realMetres)
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'The scale could not be worked out. Pick the two points again.')
  }
  return patchSheet(parsed.data, {
    pixels_per_meter: ppm,
    calibration_points: parsed.data.points,
    calibration_metres: parsed.data.realMetres,
  })
}

/** One conditional UPDATE of an existing sheet, gated on the plan's project. */
async function patchSheet(
  input: { sheetId: string; expectedUpdatedAt: string },
  patch: Record<string, unknown>,
): Promise<ActionResult<SheetSummary>> {
  const parsed = z.object({ sheetId: uuid, expectedUpdatedAt: updatedAt }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const ctx = await sheetContext(supabase, parsed.data.sheetId)
  if ('ok' in ctx) return ctx
  if (!(await mayWrite(supabase, ctx.plan.project_id))) return fail(NOT_ALLOWED)

  const { data, error } = await supabase.schema('tenants').from('status_plan_sheets')
    .update(patch)
    .eq('id', parsed.data.sheetId)
    .eq('updated_at', parsed.data.expectedUpdatedAt)
    .select(SHEET_COLUMNS)
    .maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'sheet'))
  if (!data) return staleOrGone(supabase, parsed.data.sheetId)
  return { ok: true, data: toSheetSummary(data as StatusPlanSheetRow) }
}

// ── Delete ─────────────────────────────────────────────────────────────────

/** Delete a sheet and (ON DELETE CASCADE) every shape on it; remove its file once nothing uses it. */
export async function deleteTenantPlanSheetAction(input: { sheetId: string; expectedUpdatedAt: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({ sheetId: uuid, expectedUpdatedAt: updatedAt }).safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const supabase = await signedIn()
  if (!supabase) return fail(SIGNED_OUT)
  const ctx = await sheetContext(supabase, parsed.data.sheetId)
  if ('ok' in ctx) return ctx
  if (!(await mayWrite(supabase, ctx.plan.project_id))) return fail(NOT_ALLOWED)

  // Files go FIRST: if the row went first and the removal then failed, the file would be orphaned
  // with nothing left to find it by. A shared file (page 2 of the same PDF) stays.
  if (ctx.sheet.updated_at !== parsed.data.expectedUpdatedAt) return fail(SHEET_STALE, true)
  const toRemove = await filesOnlyThisSheetUses(supabase, ctx.plan.id, ctx.sheet.id, [ctx.sheet.file_path, ctx.sheet.replaced_from_path])
  if (toRemove === null) return fail(FILE_REMOVE_FAILED)
  if (toRemove.length > 0) {
    const { error: removeError } = await supabase.storage.from(TENANT_PLAN_BUCKET).remove(toRemove)
    if (removeError) {
      console.error('[tenant-plans] could not remove the sheet file', removeError.message)
      return fail(FILE_REMOVE_FAILED)
    }
  }

  const { data, error } = await supabase.schema('tenants').from('status_plan_sheets')
    .delete()
    .eq('id', parsed.data.sheetId)
    .eq('updated_at', parsed.data.expectedUpdatedAt)
    .select('id')
    .maybeSingle()
  if (error) return fail(statusPlanWriteError(error, 'sheet'))
  if (!data) return staleOrGone(supabase, parsed.data.sheetId)
  revalidatePath(tenantScheduleHref(ctx.plan.project_id))
  return { ok: true, data: { id: parsed.data.sheetId } }
}
