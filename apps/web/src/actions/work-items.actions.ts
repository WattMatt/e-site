'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES, WORK_ITEM_PRIORITIES, WORK_ITEM_TYPES, type OrgRole } from '@esite/shared'

/**
 * Work-item mutations — the five verbs Q1 needs.
 *
 * The RESTRICTIVE policies on projects.work_items are the BACKSTOP, not the
 * gate. A server action is directly invocable and sits outside
 * (admin)/layout.tsx, which is how a role-blind read shipped on every saved
 * report until PR #162 closed it — so each action re-checks the caller's
 * EFFECTIVE role on the project before touching the database.
 *
 * Five verbs, not two: `task` is sourceless, so no module owns its lifecycle.
 * With only create and reassign nothing in the platform could ever close a
 * work item — while §15 metric 7 (activation) is a new user moving one to
 * `closed` — and the transition guard requires a void_reason nothing could
 * supply.
 *
 * WHO MAY DO WHAT, as the database finally enforces it (00196 §9 + §12):
 *
 *   - The TYPE's write set (`work_item_types.write_roles`; MARKUP_WRITE_ROLES
 *     for `task`) creates, hands the ASSIGNEE on while triage/open, moves the
 *     status, voids, and reopens. Resolved here from the same registry the
 *     seed is written from, by the row's `item_type`.
 *   - GOVERNANCE — owner / admin / project manager — is what the guard demands
 *     for the gatekeeper seat, and for an assignee change while `answered`.
 *     The actions do not pre-check that; the guard's sentence is the copy.
 *   - The current BALL-IN-COURT HOLDER, with no write role at all, may move
 *     their own item forward and void it with a reason. They may NOT hand it
 *     off. The order matters: Postgres evaluates an UPDATE's RLS WITH CHECK
 *     AFTER the BEFORE ROW triggers, so the guard runs first and ADMITS the
 *     hand-off (v_is_holder) — and then §9's RESTRICTIVE update gate refuses
 *     the new row with 42501, because the actor is no longer assignee or
 *     gatekeeper on it. reassign therefore gates on the write set only:
 *     admitting the holder would only swap the role sentence for a raw
 *     "new row violates row-level security policy".
 *   - ONLY THE GATEKEEPER CLOSES. Reopening (closed → open) takes a write
 *     role or the gatekeeper who closed.
 *
 * Nothing here supplies ref, ball_in_court_id, origin from the client, or any
 * stamp (opened_at, created_at, closed_at, closed_by, void_reason on create).
 * Payloads are built field by field; spreading `input` is how a hostile client
 * smuggles rfi_id, created_by or a status past the schema.
 *
 * Every database error is returned as `error.message` VERBATIM. The guard's
 * and the triggers' RAISEs are sentences naming the item's ref — they are the
 * user-facing copy, and wrapping them would hide the one line that says what
 * to do next.
 *
 * `work_items` is absent from packages/db/src/types.ts until the next regen,
 * so the `.schema('projects')` hop is cast (`as any`) — the `inspections`
 * precedent in CLAUDE.md. The cast is confined to that hop.
 */

// ─── shared ──────────────────────────────────────────────────────────────────

const uuid = z.string().uuid()

/**
 * The registry's write set for a type. An unknown key answers an EMPTY set —
 * everyone refused — which is the same fail-closed answer
 * projects.user_can_write_work_item() gives for a key it cannot find.
 */
function writeRolesFor(itemType: string): readonly OrgRole[] {
  return WORK_ITEM_TYPES.find((t) => t.key === itemType)?.writeRoles ?? []
}

const TASK_WRITE_ROLES = writeRolesFor('task')

type ItemRow = {
  project_id: string
  item_type: string
  ref: string
  status: string
  gatekeeper_id: string
  ball_in_court_id: string | null
}

/** The `projects` schema, typed as nothing until the types regen. */
function projectsSchema(supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).schema('projects')
}

/** One pre-read, shared by every verb that operates on an existing item. RLS
 *  applies: a caller who cannot read the item gets "not found". */
async function readItem(supabase: SupabaseClient, workItemId: string): Promise<ItemRow | null> {
  const { data, error } = await projectsSchema(supabase).from('work_items')
    .select('project_id, item_type, ref, status, gatekeeper_id, ball_in_court_id')
    .eq('id', workItemId).single()
  return error || !data ? null : (data as ItemRow)
}

const NOTHING_CHANGED =
  'Nothing was changed. The item may have moved on, or you may no longer have access to it — refresh and try again.'

/**
 * The write, conditioned on the state the decision was made from, and the
 * proof it happened.
 *
 * `expectStatus` is the pre-read status: every verb decides something from it
 * (which person column to write, whether the holder arm applies, whether the
 * move is a no-op), and a row that flipped between the read and the write must
 * not receive a decision made for its old state — a governing actor's
 * hand-off of an `open` item would otherwise land on an `answered` one as an
 * assignee change, ball-in-court unchanged, evented and reported ok. The
 * filter makes that a zero-row update instead.
 *
 * PostgREST raises NOTHING when an UPDATE matches zero rows — the E8 failure
 * class, where the page said "You're unsubscribed" 246 sends running. That
 * covers the race above and the one caller who reaches here with a row the
 * gate will refuse: a client_viewer assignee passes the holder arm, and §9's
 * RESTRICTIVE gate excludes client_viewer outright. Either must read as
 * "nothing changed", never as success.
 */
async function updateItem(
  supabase: SupabaseClient,
  workItemId: string,
  expectStatus: string,
  patch: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await projectsSchema(supabase).from('work_items')
    .update(patch)
    .eq('id', workItemId)
    .eq('status', expectStatus)
    .select('id').maybeSingle()
  if (error) return error.message
  if (!data) return NOTHING_CHANGED
  return null
}

// ─── create ──────────────────────────────────────────────────────────────────

const createTaskSchema = z.object({
  projectId:  uuid,
  title:      z.string().trim().min(1).max(300),
  /** Always named. The unnamed-assignee path (born `triage`) is item 3's. */
  assigneeId: uuid,
  priority:   z.enum(WORK_ITEM_PRIORITIES).optional(),
  /**
   * "Send me the updated single-line by Friday" is the monday.com row §04 §(g)
   * says `task` exists to replace, and its migration is supposed to preserve
   * due dates. Without this field every manual task silently becomes due in
   * five office working days. work_items_set_due_date() respects a supplied
   * date and still applies the builders'-shutdown push.
   */
  dueDate:    z.string().date().optional(),
})
export type CreateWorkItemTaskInput = z.infer<typeof createTaskSchema>

export async function createWorkItemTaskAction(
  input: CreateWorkItemTaskInput,
): Promise<{ id?: string; ref?: string; error?: string }> {
  const parsed = createTaskSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { projectId, title, assigneeId, priority, dueDate } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // `task` is the only client-insertable type in Q1 (§03 §1.2). Its write set
  // is the registry's — read from the same shared constant the seed uses.
  const gate = await requireEffectiveRole(supabase, projectId, TASK_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  const { data: project, error: projErr } = await projectsSchema(supabase).from('projects')
    .select('organisation_id').eq('id', projectId).single()
  if (projErr || !project) return { error: 'Project not found' }

  // Built field by field — never a spread of `input`. The assignee is NOT
  // pre-validated here: the membership trigger is the last word on whether
  // they are on the project, and its sentence is the one the user should see.
  const { data, error } = await projectsSchema(supabase).from('work_items')
    .insert({
      organisation_id: project.organisation_id,
      project_id:      projectId,
      item_type:       'task',
      // §9 (c): the column DEFAULTS to 'mirror'. Said explicitly.
      origin:          'manual',
      // §03 §1.6: an item created WITH an explicit assignee is born `open`. The
      // column default is 'triage' for the sourceless/unnamed path item 3 uses;
      // this action always has a named assignee, so an 'open' literal here is
      // what keeps the Triage queue to genuinely unowned inbound. Never taken
      // from the payload. Only a `created` event follows; the `assigned` verb
      // fires exclusively from item 3's triage path.
      status:          'open',
      title,
      priority:        priority ?? 'medium',
      assignee_id:     assigneeId,
      gatekeeper_id:   user.id,     // A(b): task's gatekeeper is the creator
      created_by:      user.id,
      ...(dueDate ? { due_date: dueDate } : {}),
    })
    .select('id, ref').single()
  if (error) return { error: error.message }

  revalidatePath(`/projects/${projectId}`)
  return { id: data.id, ref: data.ref }
}

// ─── the four verbs that operate on an existing item ─────────────────────────

const reassignSchema = z.object({
  workItemId: uuid,
  userId:     uuid,
})

/**
 * The manual ball-in-court shift (§03 §1.4).
 *
 * ball_in_court_id is generated from whichever of the two person columns the
 * CURRENT status selects, so the shift writes THAT column: assignee_id while
 * triage or open, gatekeeper_id while answered. A PM handing an answered item
 * to a different reviewer changes the gatekeeper; writing assignee_id in that
 * state would regenerate an unchanged ball-in-court and look like a broken
 * control. The write is conditioned on the status the column was chosen from.
 *
 * Gated on the TYPE's write set ONLY — not the current holder, even though
 * §03 §1.4 names them. A bare holder's hand-off passes the BEFORE UPDATE guard
 * (v_is_holder) and is then refused by §9's RESTRICTIVE update gate, whose
 * WITH CHECK runs after the row triggers and requires the actor to remain
 * assignee or gatekeeper on the NEW row (42501). The guard separately requires
 * governance (owner/admin/PM) for the gatekeeper seat and for an assignee
 * change while `answered`. A contractor with the type write role therefore
 * hands the ASSIGNEE on in triage/open and gets the guard's governance
 * sentence, verbatim, if they try the gatekeeper seat.
 */
export async function reassignWorkItemAction(
  input: z.infer<typeof reassignSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = reassignSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { workItemId, userId } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const item = await readItem(supabase, workItemId)
  if (!item) return { error: 'Work item not found' }

  const gate = await requireEffectiveRole(supabase, item.project_id, writeRolesFor(item.item_type))
  if (!gate.ok) return { error: gate.error }

  const column =
    item.status === 'triage' || item.status === 'open' ? 'assignee_id'
    : item.status === 'answered' ? 'gatekeeper_id'
    : null
  if (!column) {
    // The guard's clause (b) sentence, so the copy is the same whichever layer
    // says it. Short-circuited only because there is no column to write.
    return { error: `${item.ref} is ${item.status}. Reopen it before changing who it belongs to.` }
  }

  const failure = await updateItem(supabase, workItemId, item.status, { [column]: userId })
  if (failure) return { error: failure }

  revalidatePath(`/projects/${item.project_id}`)
  return { ok: true }
}

const advanceSchema = z.object({
  workItemId: uuid,
  // `void` is deliberately absent: it needs a reason, so it has its own action.
  status:     z.enum(['open', 'answered', 'closed']),
})

/**
 * Move an item along the status machine.
 *
 * Without this verb nothing in Q1 could close a work item at all — `task` is
 * sourceless, so no module owns its lifecycle — and §15 metric 7 (activation)
 * is defined as a new user moving any work item to `closed` in their first
 * session.
 *
 * Admits the type's write set OR the current ball-in-court holder (an assignee
 * moving their own item open → answered is legal, §03 §1.4), and — for a
 * closed item, which has no holder — the gatekeeper who closed it, because
 * §12 (c2) admits exactly them for a reopen.
 *
 * The database is the real gate and is not pre-empted here: the transition
 * guard rejects an illegal jump, requires a write role or the closing
 * gatekeeper to reopen, and permits `closed` only to the gatekeeper. Its
 * sentence comes back verbatim. A governing actor who is not the gatekeeper
 * takes the seat first (reassign while `answered`) and then closes — there is
 * no "take over" verb in Q1.
 *
 * A move to the status the item already holds is a no-op and never reaches
 * the database: the guard's machine has no same-state arm to consult, and a
 * write would only bump last_activity_at for nothing.
 */
export async function advanceWorkItemStatusAction(
  input: z.infer<typeof advanceSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = advanceSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid status' }
  const { workItemId, status } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const item = await readItem(supabase, workItemId)
  if (!item) return { error: 'Work item not found' }

  const gate = await requireEffectiveRole(supabase, item.project_id, writeRolesFor(item.item_type))
  const isHolder = user.id === item.ball_in_court_id
  const isClosingGatekeeper = item.status === 'closed' && user.id === item.gatekeeper_id
  if (!gate.ok && !isHolder && !isClosingGatekeeper) return { error: gate.error }

  if (status === item.status) return { ok: true }

  const failure = await updateItem(supabase, workItemId, item.status, { status })
  if (failure) return { error: failure }

  revalidatePath(`/projects/${item.project_id}`)
  return { ok: true }
}

const dueDateSchema = z.object({
  workItemId: uuid,
  dueDate:    z.string().date(),
})

/**
 * §13 item 2: the triage owner does exactly three things — reassign, change the
 * due date, or void it with a reason. This is the second, and §04's My Work
 * binds `D` to it.
 *
 * ORG_WRITE_ROLES only, deliberately NARROWER than the database (§12 (a4)
 * admits the type's write set or the gatekeeper): moving a deadline is a
 * management decision, not something the person holding the item does to
 * themselves.
 */
export async function setWorkItemDueDateAction(
  input: z.infer<typeof dueDateSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = dueDateSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid date' }
  const { workItemId, dueDate } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const item = await readItem(supabase, workItemId)
  if (!item) return { error: 'Work item not found' }

  const gate = await requireEffectiveRole(supabase, item.project_id, ORG_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  const failure = await updateItem(supabase, workItemId, item.status, { due_date: dueDate })
  if (failure) return { error: failure }

  revalidatePath(`/projects/${item.project_id}`)
  return { ok: true }
}

const voidSchema = z.object({
  workItemId: uuid,
  // Non-blank, not a minimum length. The sentence is the guard's own, so the
  // user reads the same words whichever layer refuses.
  reason:     z.string().trim().min(1, 'Dropping an item needs a short reason. Say why it is no longer needed.').max(500),
})

/**
 * Drop an item that should never have existed, with a reason.
 *
 * The transition guard REQUIRES a non-blank void_reason — without this action
 * nothing in Q1 could satisfy that requirement, so `void` was an unreachable
 * state guarded by a rule nobody could obey. The schema refuses a blank reason
 * first, so the database is never the first to say so.
 *
 * Mirrors the guard's v_may_manage: the type's write set OR the current holder.
 */
export async function voidWorkItemAction(
  input: z.infer<typeof voidSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = voidSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { workItemId, reason } = parsed.data

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const item = await readItem(supabase, workItemId)
  if (!item) return { error: 'Work item not found' }

  const gate = await requireEffectiveRole(supabase, item.project_id, writeRolesFor(item.item_type))
  if (!gate.ok && user.id !== item.ball_in_court_id) return { error: gate.error }

  const failure = await updateItem(supabase, workItemId, item.status, { status: 'void', void_reason: reason })
  if (failure) return { error: failure }

  revalidatePath(`/projects/${item.project_id}`)
  return { ok: true }
}
