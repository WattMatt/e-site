/**
 * Zod shapes for the schedule actions + camelCase → RPC snake_case (00212's
 * solar.schedule_create_tasks / _update_tasks argument shapes). A plain module
 * (a 'use server' file may export only async functions), shared by the
 * actions and the client.
 */
import { z } from 'zod'
import { GANTT_STATUSES, LINK_TYPES, isCalendarDate, type ImportPlan } from '@esite/shared'

const date = z.string().refine(isCalendarDate)
const segment = z.object({ start: date, end: date })
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const TaskInputSchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(300),
  start: date,
  end: date,
  isMilestone: z.boolean().optional(),
  category: z.string().max(120).optional(),
  zone: z.string().max(120).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  status: z.enum(GANTT_STATUSES).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  colour: colour.nullable().optional(),
  description: z.string().max(4000).optional(),
  segments: z.array(segment).max(50).optional(),
})
export type TaskInput = z.infer<typeof TaskInputSchema>

export const LinkInputSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(LINK_TYPES),
  lagDays: z.number().int().min(-365).max(365),
})
export type LinkInput = z.infer<typeof LinkInputSchema>

/**
 * `expectedUpdatedAt` is typed optional/nullable for the client's convenience,
 * but updateScheduleTasksAction REFUSES a patch without it (stale sentence):
 * every update is optimistic-concurrency guarded.
 */
export const TaskPatchSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(300).optional(),
  category: z.string().max(120).optional(),
  zone: z.string().max(120).optional(),
  start: date.optional(),
  end: date.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  colour: colour.optional(),
  description: z.string().max(4000).optional(),
  ownerId: z.string().min(1).optional(),
  status: z.enum(GANTT_STATUSES).optional(),
  isMilestone: z.boolean().optional(),
  segments: z.array(segment).max(50).optional(),
})
export type TaskPatch = z.infer<typeof TaskPatchSchema>

export const BAD_TASK = 'Check the task: every date must be a real calendar date and every task needs a name.'

export function toRpcTask(t: TaskInput): Record<string, unknown> {
  return {
    key: t.key, name: t.name, start: t.start, end: t.end, is_milestone: t.isMilestone ?? false,
    category: t.category ?? '', zone: t.zone ?? '', owner_id: t.ownerId ?? null, status: t.status ?? 'not_started',
    progress: t.progress ?? 0, colour: t.colour ?? null, description: t.description ?? '', segments: t.segments ?? [],
  }
}

const PATCH_KEYS: Array<[keyof TaskPatch, string]> = [
  ['id', 'id'], ['expectedUpdatedAt', 'expected_updated_at'], ['name', 'name'], ['category', 'category'], ['zone', 'zone'],
  ['start', 'start'], ['end', 'end'], ['progress', 'progress'], ['colour', 'colour'], ['description', 'description'],
  ['ownerId', 'owner_id'], ['status', 'status'], ['isMilestone', 'is_milestone'], ['segments', 'segments'],
]
export function toRpcPatch(p: TaskPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, snake] of PATCH_KEYS) if (p[k] !== undefined) out[snake] = p[k]
  return out
}

/** An ImportPlan (template or file) → the create action's inputs; ownerIdFor resolves a task's hint. */
export function planToInputs(plan: ImportPlan, ownerIdFor: (taskIndex: number) => string | null): { tasks: TaskInput[]; links: LinkInput[] } {
  return {
    tasks: plan.tasks.map((t, i) => ({
      key: t.key, name: t.name, start: t.start, end: t.end, isMilestone: t.isMilestone, category: t.category, zone: t.zone,
      ownerId: ownerIdFor(i), status: t.status, progress: t.progress, colour: t.colour, description: t.description, segments: t.segments,
    })),
    links: plan.links.map((l) => ({ from: l.fromKey, to: l.toKey, type: l.type, lagDays: l.lagDays })),
  }
}

/**
 * Owner as written in a file → member id (owner decision Q5): email
 * (case-insensitive) first, then a UNIQUE full name. `owners` must be the
 * Solar-ELIGIBLE list (solar.schedule_owner_candidates), so a client viewer or
 * supplier named in a file is simply unmatched — never sent to the database.
 * An unmatched task gets null, which the create RPC resolves to the project's
 * default owner (falling back to the importer, who holds Solar Edit).
 */
export function resolveOwnerHints(
  hints: ReadonlyArray<string | null>,
  owners: ReadonlyArray<{ id: string; name: string; email: string }>,
): { ids: Array<string | null>; unmatched: string[] } {
  const byEmail = new Map(owners.filter((o) => o.email.trim()).map((o) => [o.email.trim().toLowerCase(), o.id]))
  const byName = new Map<string, string[]>()
  for (const o of owners) {
    const k = o.name.trim().toLowerCase()
    if (!k) continue
    byName.set(k, [...(byName.get(k) ?? []), o.id])
  }
  const unmatched = new Set<string>()
  const ids = hints.map((h) => {
    if (!h || !h.trim()) return null
    const k = h.trim().toLowerCase()
    const e = byEmail.get(k)
    if (e) return e
    const n = byName.get(k)
    if (n && n.length === 1) return n[0]
    unmatched.add(h.trim())
    return null
  })
  return { ids, unmatched: [...unmatched] }
}
