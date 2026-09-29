# E-Site Solar Phase 5b — Schedule (Gantt) — Part 4 of 5: server (loader, actions, import, exports)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal / Architecture / Tech stack / Ground rules:** see Part 1. **Prerequisite:** Parts 1–3 committed (the migration exists in the repo; it does not need to be applied for any test in this part — all web tests use `fakeSupabase`).

Conventions mirrored from existing code:
- Actions re-check the level themselves: `requireSolarLevel(projectId, 'edit' | 'view', supabase)` (`apps/web/src/lib/solar/access.ts:40-48`) — it redirects a lower level to `/solar/locked`.
- Route handlers under `app/api/*` sit outside `(admin)/layout.tsx`, so they call `getSolarAccessLevel` + `solarLevelAllows` and return 401/403 JSON themselves (`access.ts` header; `app/api/projects/[id]/forms/[formId]/report/route.ts` for the shape).
- Writes go through the caller's session (`createClient()`), never the service client, so RLS and the RPC gates decide. Audit rows use `recordSolarAudit` (service client after the gate, `lib/solar/audit.ts`).
- Test fake: `apps/web/src/test/fake-supabase.ts`; mock pattern from `actions/solar-site.actions.test.ts` (Part 1 of 1c-ii).

---

### Task 12: Let the test fake answer `schema('solar').rpc(...)`

**Files:**
- Modify: `apps/web/src/test/fake-supabase.ts`
- Create: `apps/web/src/test/fake-supabase.test.ts`

The schedule RPCs live in schema `solar`, called as `supabase.schema('solar').rpc(name, args)`. Today the fake's `schema(s)` returns only `from`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/test/fake-supabase.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { fakeSupabase } from './fake-supabase'

describe('fakeSupabase schema rpc', () => {
  it('resolves schema-qualified rpc results and records the call', async () => {
    const { client, rpcCalls } = fakeSupabase({
      rpc: { 'solar.schedule_delete_tasks': ({ p_task_ids }) => ({ data: (p_task_ids as string[]).length, error: null }) },
    })
    const res = await client.schema('solar').rpc('schedule_delete_tasks', { p_project_id: 'p', p_task_ids: ['a', 'b'] })
    expect(res).toEqual({ data: 2, error: null })
    expect(rpcCalls).toEqual([{ name: 'solar.schedule_delete_tasks', args: { p_project_id: 'p', p_task_ids: ['a', 'b'] } }])
  })
  it('an unconfigured schema rpc returns null data', async () => {
    const { client } = fakeSupabase()
    await expect(client.schema('solar').rpc('nope', {})).resolves.toEqual({ data: null, error: null })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter web exec vitest run src/test/fake-supabase.test.ts`
Expected: FAIL — `client.schema(...).rpc is not a function`.

- [ ] **Step 3: Implement**

In `apps/web/src/test/fake-supabase.ts`, inside `fakeSupabase`, add after `const calls: FakeCall[] = []`:
```ts
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
```
Replace the `schema:` member of `client` with:
```ts
    schema: (s: string) => ({
      from: (t: string) => builder(`${s}.${t}`),
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        const key = `${s}.${name}`
        rpcCalls.push({ name: key, args })
        const r = opts.rpc?.[key]
        if (!r) return { data: null, error: null }
        return typeof r === 'function' ? r(args) : r
      }),
    }),
```
Change the return to `return { client, calls, rpcCalls }`, and in the header comment add the line ` *     rpc: { 'solar.schedule_create_tasks': { data: { a: 't1' }, error: null } },   // schema-qualified`.

- [ ] **Step 4: Run — expect PASS, and the existing users of the fake still pass**

Run: `pnpm --filter web exec vitest run src/test/fake-supabase.test.ts src/actions src/lib/solar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/test/fake-supabase.ts apps/web/src/test/fake-supabase.test.ts
git commit -m "test(web): fake supabase answers schema-qualified rpc calls

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Error sentences, audit sentences, activity link

**Files:**
- Create: `apps/web/src/lib/solar/schedule/errors.ts`, `errors.test.ts`
- Modify: `packages/shared/src/solar/activity.ts`, `packages/shared/src/solar/activity.test.ts`
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/_components/ActivityList.tsx:9`

The RPCs and the 00196 guard raise human sentences on purpose (`22023`, `P0001` raise_exception, `P0002` no_data_found — 00196 notes "every server action returns error.message straight to the user"). Everything else is mapped; a raw message whose text starts with `solar.` (a bind-trigger diagnostic) never reaches the user.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/solar/schedule/errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { humanScheduleError, NO_EDIT } from './errors'
import { GENERIC_ERROR, STALE_MESSAGE } from '@/lib/solar/errors'

describe('humanScheduleError', () => {
  it.each([
    [{ code: '40001', message: 'x' }, STALE_MESSAGE],
    [{ code: '42501', message: 'new row violates row-level security policy' }, NO_EDIT],
    [{ code: '22007', message: 'invalid input syntax for type date' }, 'One of the dates is not a real calendar date.'],
    [{ code: '23514', message: 'solar.schedule_dependencies: this link would create a loop' }, 'That link would make these tasks depend on each other in a loop.'],
    [{ code: '23514', message: 'solar.schedule_dependencies: a task cannot depend on itself' }, 'A task cannot depend on itself.'],
    [{ code: '23514', message: 'solar.schedule_dependencies: both tasks must be on the same project' }, 'Both tasks must be on this project.'],
    [{ code: '23514', message: 'solar.schedule_segments: a segment must lie inside its task' }, 'A segment must lie inside its task.'],
    [{ code: '23514', message: 'solar.schedule_segments: segments of one task cannot overlap' }, 'Segments of one task cannot overlap.'],
    [{ code: '23514', message: 'new row violates check constraint "schedule_tasks_dates_ordered"' }, 'A task cannot end before it starts.'],
    [{ code: '23505', message: 'duplicate key value violates unique constraint "schedule_dependencies_pair_unique"' }, 'Those two tasks are already linked.'],
    [{ code: '23505', message: '… "schedule_baselines_name_unique"' }, 'A baseline with that name already exists.'],
    [{ code: '23505', message: '… "schedule_filter_presets_name_unique"' }, 'You already have a preset with that name.'],
    [{ code: '22023', message: '"Design" ends before it starts.' }, '"Design" ends before it starts.'],
    [{ code: 'P0001', message: 'Only the person who signs SOLAR-3 off can close it. Take it over first, or ask them to close it.' },
      'Only the person who signs SOLAR-3 off can close it. Take it over first, or ask them to close it.'],
    [{ code: 'P0001', message: 'solar.schedule_tasks: the work item is not a solar task' }, GENERIC_ERROR],
    [{ code: 'XX000', message: 'internal' }, GENERIC_ERROR],
    [null, GENERIC_ERROR],
  ])('%j → sentence', (err, out) => {
    expect(humanScheduleError(err)).toBe(out)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter web exec vitest run src/lib/solar/schedule/errors.test.ts`
Expected: FAIL — cannot resolve `./errors`.

- [ ] **Step 3: Implement**

`apps/web/src/lib/solar/schedule/errors.ts`:
```ts
/**
 * Postgres / PostgREST errors from the schedule RPCs and tables → one sentence.
 * 22023 (our RPCs), P0001 (the 00196 transition guard and membership trigger)
 * and P0002 (calendar not seeded, task gone) are ALREADY sentences written for
 * users and pass through — unless they are a bind-trigger diagnostic ("solar.…").
 */
import { GENERIC_ERROR, STALE_MESSAGE } from '@/lib/solar/errors'

export const NO_EDIT = 'You need Edit access to Solar on this project to change the schedule.'
const PASS_THROUGH = new Set(['22023', 'P0001', 'P0002'])

export function humanScheduleError(err: { code?: string; message?: string } | null | undefined): string {
  if (!err) return GENERIC_ERROR
  const code = err.code ?? ''
  const m = err.message ?? ''
  if (code === '40001') return STALE_MESSAGE
  if (code === '42501') return NO_EDIT
  if (code === '22007' || code === '22008') return 'One of the dates is not a real calendar date.'
  if (code === '23505') {
    if (m.includes('schedule_dependencies_pair_unique')) return 'Those two tasks are already linked.'
    if (m.includes('schedule_baselines_name_unique')) return 'A baseline with that name already exists.'
    if (m.includes('schedule_filter_presets_name_unique')) return 'You already have a preset with that name.'
    return GENERIC_ERROR
  }
  if (code === '23514') {
    if (m.includes('loop')) return 'That link would make these tasks depend on each other in a loop.'
    if (m.includes('itself')) return 'A task cannot depend on itself.'
    if (m.includes('same project')) return 'Both tasks must be on this project.'
    if (m.includes('inside its task')) return 'A segment must lie inside its task.'
    if (m.includes('overlap')) return 'Segments of one task cannot overlap.'
    if (m.includes('schedule_tasks_dates_ordered')) return 'A task cannot end before it starts.'
    return GENERIC_ERROR
  }
  if (PASS_THROUGH.has(code) && m && !m.startsWith('solar.')) return m
  return GENERIC_ERROR
}
```

- [ ] **Step 4: Activity sentences**

In `packages/shared/src/solar/activity.ts`, change the target type and add cases before `default:`:
```ts
export type SolarActivityTarget = 'access' | 'site' | 'schedule' | null
```
```ts
    case 'schedule_tasks_added': {
      const n = Number(ref.count ?? 1)
      return { text: n === 1 ? 'Schedule task added' : `${n} schedule tasks added`, target: 'schedule' }
    }
    case 'schedule_tasks_removed': {
      const n = Number(ref.count ?? 1)
      return { text: n === 1 ? 'Schedule task removed' : `${n} schedule tasks removed`, target: 'schedule' }
    }
    case 'schedule_imported':
      return { text: `Schedule imported (${Number(ref.count ?? 0)} tasks${ref.mode === 'replace' ? ', replaced the programme' : ''})`, target: 'schedule' }
    case 'schedule_template_applied':
      return { text: `Standard programme added (${Number(ref.count ?? 0)} tasks)`, target: 'schedule' }
    case 'schedule_baseline_saved':
      return { text: typeof ref.name === 'string' ? `Baseline “${ref.name}” saved` : 'Baseline saved', target: 'schedule' }
```
In `packages/shared/src/solar/activity.test.ts` add:
```ts
it('describes schedule events and links them to the Schedule tab', () => {
  expect(describeSolarAuditEvent('schedule_tasks_added', { count: 3 })).toEqual({ text: '3 schedule tasks added', target: 'schedule' })
  expect(describeSolarAuditEvent('schedule_tasks_removed', { count: 1 })).toEqual({ text: 'Schedule task removed', target: 'schedule' })
  expect(describeSolarAuditEvent('schedule_imported', { count: 12, mode: 'replace' }))
    .toEqual({ text: 'Schedule imported (12 tasks, replaced the programme)', target: 'schedule' })
  expect(describeSolarAuditEvent('schedule_template_applied', { count: 14 })).toEqual({ text: 'Standard programme added (14 tasks)', target: 'schedule' })
  expect(describeSolarAuditEvent('schedule_baseline_saved', { name: 'Contract' })).toEqual({ text: 'Baseline “Contract” saved', target: 'schedule' })
})
```
(If `describeSolarAuditEvent` is not yet imported in that test file, add it to the existing import from `./activity`.)

In `apps/web/src/app/(admin)/projects/[id]/solar/_components/ActivityList.tsx`, after the line
```ts
    if (target === 'site') return `/projects/${projectId}/solar/site`
```
add
```ts
    if (target === 'schedule') return `/projects/${projectId}/solar/schedule`
```

- [ ] **Step 5: Run — expect PASS**

```bash
pnpm --filter web exec vitest run src/lib/solar/schedule/errors.test.ts "src/app/(admin)/projects/[id]/solar/_components/ActivityList.test.tsx"
pnpm --filter @esite/shared exec vitest run src/solar/activity.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/solar/schedule/errors.ts apps/web/src/lib/solar/schedule/errors.test.ts packages/shared/src/solar/activity.ts packages/shared/src/solar/activity.test.ts "apps/web/src/app/(admin)/projects/[id]/solar/_components/ActivityList.tsx"
git commit -m "feat(solar-schedule): human error sentences and activity sentences for the schedule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Client-safe types and the schedule loader

**Files:**
- Create: `apps/web/src/lib/solar/schedule/types.ts`
- Create: `apps/web/src/lib/solar/schedule/loader.ts`, `loader.test.ts`

One loader feeds the page, every export route and the client's refresh after a mutation (a refresh replaces data; it never re-mounts the Konva stage — the #190 lesson about `router.refresh()` re-rasterising a canvas).

- [ ] **Step 1: Types**

`apps/web/src/lib/solar/schedule/types.ts`:
```ts
/** JSON-only shapes that cross the server → client boundary (no functions, no Dates). */
import type {
  CalendarDate, DurationMode, ScheduleFilters, ScheduleLink, ScheduleTaskView,
} from '@esite/shared'

export interface ScheduleLinkView extends ScheduleLink { id: string }
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
```

- [ ] **Step 2: Write the failing loader test**

`apps/web/src/lib/solar/schedule/loader.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { loadScheduleData } from './loader'
import { fakeSupabase } from '@/test/fake-supabase'

const P = 'p1'
function fake() {
  return fakeSupabase({
    userId: 'u1',
    tables: {
      'projects.projects': [{ id: P, name: 'KINGSWALK' }],
      'solar.schedule_tasks': [
        { id: 't1', project_id: P, work_item_id: 'w1', category: 'Design', zone: '', start_date: '2026-10-01', end_date: '2026-10-05', progress: 20, colour: '#3b82f6', sort_order: 1, is_milestone: false, gantt_status: 'in_progress', description: '', updated_at: 'U1' },
        { id: 't2', project_id: P, work_item_id: 'w2', category: '', zone: '', start_date: '2026-10-06', end_date: '2026-10-06', progress: 0, colour: '#ef4444', sort_order: 2, is_milestone: true, gantt_status: 'not_started', description: 'x', updated_at: 'U2' },
        { id: 't3', project_id: P, work_item_id: 'w3', category: '', zone: '', start_date: '2026-10-07', end_date: '2026-10-09', progress: 0, colour: '#3b82f6', sort_order: 3, is_milestone: false, gantt_status: 'done', description: '', updated_at: 'U3' },
      ],
      'projects.work_items': [
        { id: 'w1', ref: 'SOLAR-1', title: 'Design', status: 'open', assignee_id: 'u1' },
        { id: 'w2', ref: 'SOLAR-2', title: 'SSEG submitted', status: 'closed', assignee_id: 'u9' },
        { id: 'w3', ref: 'SOLAR-3', title: 'Removed', status: 'void', assignee_id: 'u1' },
      ],
      'solar.schedule_segments': [],
      'solar.schedule_dependencies': [{ id: 'd1', project_id: P, predecessor_task_id: 't1', successor_task_id: 't2', link_type: 'FS', lag_days: 1 }],
      'solar.schedule_baselines': [{ id: 'b1', project_id: P, name: 'Contract', description: null, created_at: 'C', duration_mode: 'working' }],
      'solar.schedule_settings': [],
      'solar.schedule_filter_presets': [{ id: 'f1', project_id: P, name: 'Mine', filters: { search: '', statuses: ['done'], ownerIds: [], colours: [] } },
        { id: 'f2', project_id: P, name: 'Broken', filters: { search: 3 } }],
    },
    rpc: { 'solar.schedule_owner_candidates': { data: [{ user_id: 'u1', full_name: 'Ann Smith', email: 'ann@x.co.za' }], error: null } },
  })
}

describe('loadScheduleData', () => {
  it('joins side rows to their work items, maps status, drops void, names owners', async () => {
    const { client } = fake()
    const d = await loadScheduleData(P, client as never, 'edit', '2026-09-28')
    expect(d.projectName).toBe('KINGSWALK')
    expect(d.canEdit).toBe(true)
    expect(d.tasks.map((t) => [t.id, t.ref, t.name, t.status, t.ownerName])).toEqual([
      ['t1', 'SOLAR-1', 'Design', 'in_progress', 'Ann Smith'],
      ['t2', 'SOLAR-2', 'SSEG submitted', 'done', 'Former project member'],
    ])
    expect(d.links).toEqual([{ id: 'd1', predecessorId: 't1', successorId: 't2', type: 'FS', lagDays: 1 }])
    expect(d.settings).toEqual({ durationMode: 'calendar', workloadThreshold: 2, updatedAt: null })
    expect(d.presets).toEqual([{ id: 'f1', name: 'Mine', filters: { search: '', statuses: ['done'], ownerIds: [], colours: [] } }])
    expect(d.baselines).toEqual([{ id: 'b1', name: 'Contract', description: null, createdAt: 'C', durationMode: 'working' }])
    expect(d.today).toBe('2026-09-28')
  })
  it('View level cannot edit', async () => {
    const { client } = fake()
    expect((await loadScheduleData(P, client as never, 'view', '2026-09-28')).canEdit).toBe(false)
  })
})
```

- [ ] **Step 3: Run — expect FAIL**

Run: `pnpm --filter web exec vitest run src/lib/solar/schedule/loader.test.ts`
Expected: FAIL — cannot resolve `./loader`.

- [ ] **Step 4: Implement**

`apps/web/src/lib/solar/schedule/loader.ts`:
```ts
import 'server-only'
/**
 * Everything the Schedule tab needs, read through the CALLER's session so RLS
 * (solar_can_view; presets = own rows only) decides what comes back. The level
 * is passed in by a caller that already checked it.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ganttStatusOf, isGanttStatus, isLinkType, isScheduleFilters, solarLevelAllows,
  type CalendarDate, type DurationMode, type GanttStatus, type ScheduleSegment, type ScheduleTaskView, type SolarAccessLevel,
} from '@esite/shared'
import type { ScheduleData, ScheduleLinkView, ScheduleOwner } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)

export async function loadScheduleData(
  projectId: string,
  supabase: AnyClient,
  level: SolarAccessLevel,
  today: CalendarDate,
): Promise<ScheduleData> {
  const solar = () => supabase.schema('solar')
  const [{ data: { user } }, proj, tasksRes, segRes, depRes, blRes, setRes, presetRes, ownersRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase.schema('projects').from('projects').select('name').eq('id', projectId).maybeSingle(),
    solar().from('schedule_tasks').select('id, work_item_id, category, zone, start_date, end_date, progress, colour, sort_order, is_milestone, gantt_status, description, updated_at')
      .eq('project_id', projectId).order('sort_order'),
    solar().from('schedule_segments').select('id, task_id, start_date, end_date').eq('project_id', projectId).order('start_date'),
    solar().from('schedule_dependencies').select('id, predecessor_task_id, successor_task_id, link_type, lag_days').eq('project_id', projectId),
    solar().from('schedule_baselines').select('id, name, description, created_at, duration_mode').eq('project_id', projectId).order('created_at'),
    solar().from('schedule_settings').select('duration_mode, workload_threshold, updated_at').eq('project_id', projectId).maybeSingle(),
    solar().from('schedule_filter_presets').select('id, name, filters').eq('project_id', projectId).order('name'),
    solar().rpc('schedule_owner_candidates', { p_project_id: projectId }),
  ])

  const taskRows = (tasksRes.data ?? []) as Row[]
  const wiIds = taskRows.map((t) => str(t.work_item_id))
  const { data: wiRows } = wiIds.length
    ? await supabase.schema('projects').from('work_items').select('id, ref, title, status, assignee_id').in('id', wiIds)
    : { data: [] as Row[] }
  const wiById = new Map(((wiRows ?? []) as Row[]).map((w) => [str(w.id), w]))

  const owners: ScheduleOwner[] = ((ownersRes.data ?? []) as Row[]).map((o) => ({
    id: str(o.user_id), name: str(o.full_name) || str(o.email), email: str(o.email),
  }))
  const ownerName = new Map(owners.map((o) => [o.id, o.name]))

  const segs = new Map<string, ScheduleSegment[]>()
  for (const s of (segRes.data ?? []) as Row[]) {
    const k = str(s.task_id)
    if (!segs.has(k)) segs.set(k, [])
    segs.get(k)!.push({ start: str(s.start_date), end: str(s.end_date) })
  }

  const tasks: ScheduleTaskView[] = []
  for (const t of taskRows) {
    const wi = wiById.get(str(t.work_item_id))
    if (!wi) continue
    const stored: GanttStatus = isGanttStatus(t.gantt_status) ? t.gantt_status : 'not_started'
    const st = ganttStatusOf(str(wi.status), stored)
    if (!st) continue
    const ownerId = str(wi.assignee_id)
    tasks.push({
      id: str(t.id), workItemId: str(wi.id), ref: str(wi.ref), name: str(wi.title),
      category: str(t.category), zone: str(t.zone), start: str(t.start_date), end: str(t.end_date),
      isMilestone: t.is_milestone === true, status: st.status, awaitingSignOff: st.awaitingSignOff,
      progress: Number(t.progress ?? 0), colour: str(t.colour, '#3b82f6'),
      ownerId, ownerName: ownerName.get(ownerId) ?? 'Former project member',
      sortOrder: Number(t.sort_order ?? 0), description: str(t.description), updatedAt: str(t.updated_at),
      segments: segs.get(str(t.id)) ?? [],
    })
  }
  const live = new Set(tasks.map((t) => t.id))

  const links: ScheduleLinkView[] = ((depRes.data ?? []) as Row[])
    .filter((d) => isLinkType(d.link_type) && live.has(str(d.predecessor_task_id)) && live.has(str(d.successor_task_id)))
    .map((d) => ({
      id: str(d.id), predecessorId: str(d.predecessor_task_id), successorId: str(d.successor_task_id),
      type: d.link_type as ScheduleLinkView['type'], lagDays: Number(d.lag_days ?? 0),
    }))

  const s = setRes.data as Row | null
  const mode = (m: unknown): DurationMode => (m === 'working' ? 'working' : 'calendar')
  return {
    projectId,
    projectName: str((proj.data as Row | null)?.name),
    canEdit: solarLevelAllows(level, 'edit'),
    currentUserId: user?.id ?? '',
    today,
    tasks,
    links,
    owners,
    baselines: ((blRes.data ?? []) as Row[]).map((b) => ({
      id: str(b.id), name: str(b.name), description: typeof b.description === 'string' ? b.description : null,
      createdAt: str(b.created_at), durationMode: mode(b.duration_mode),
    })),
    presets: ((presetRes.data ?? []) as Row[])
      .filter((p) => isScheduleFilters(p.filters))
      .map((p) => ({ id: str(p.id), name: str(p.name), filters: p.filters as ScheduleData['presets'][number]['filters'] })),
    settings: {
      durationMode: mode(s?.duration_mode),
      workloadThreshold: Number(s?.workload_threshold ?? 2),
      updatedAt: typeof s?.updated_at === 'string' ? s.updated_at : null,
    },
  }
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter web exec vitest run src/lib/solar/schedule/loader.test.ts`
Expected: PASS (2 tests). `solarLevelAllows` is the existing shared helper used by `access.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/solar/schedule/types.ts apps/web/src/lib/solar/schedule/loader.ts apps/web/src/lib/solar/schedule/loader.test.ts
git commit -m "feat(solar-schedule): JSON-only schedule data + loader through the caller's session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Task actions — load, create, update (single and bulk), delete, reorder

**Files:**
- Create: `apps/web/src/actions/solar-schedule.actions.ts`, `solar-schedule.actions.test.ts`

Every mutation returns a small result; the client then calls `loadScheduleAction` to replace its data (one round trip, server truth, no canvas re-mount). Input is validated with zod here AND by the RPC; the action is directly invocable, so it never trusts the client's shapes.

- [ ] **Step 1: Write the failing test**

`apps/web/src/actions/solar-schedule.actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(),
  requireSolarLevel: vi.fn(),
  audit: vi.fn(async () => {}),
  load: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/solar/schedule/loader', () => ({ loadScheduleData: h.load }))

import {
  loadScheduleAction, createScheduleTasksAction, updateScheduleTasksAction, deleteScheduleTasksAction, reorderScheduleTasksAction,
} from './solar-schedule.actions'
import { fakeSupabase, type FakeOptions } from '@/test/fake-supabase'
import { STALE_MESSAGE } from '@/lib/solar/errors'

const P = '11111111-1111-4111-8111-111111111111'
const T = '22222222-2222-4222-8222-222222222222'
const task = { key: 'a', name: 'Design', start: '2026-10-01', end: '2026-10-05' }

function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: 'u1', ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireSolarLevel.mockResolvedValue('edit')
})

describe('loadScheduleAction', () => {
  it('needs View and passes the level to the loader', async () => {
    setup()
    h.load.mockResolvedValue({ projectId: P })
    await expect(loadScheduleAction({ projectId: P })).resolves.toEqual({ ok: true, data: { projectId: P } })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'view', expect.anything())
    expect(h.load).toHaveBeenCalledWith(P, expect.anything(), 'edit', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
  })
})

describe('createScheduleTasksAction', () => {
  it('re-checks Edit itself', async () => {
    setup()
    h.requireSolarLevel.mockRejectedValueOnce(new Error('REDIRECT'))
    await expect(createScheduleTasksAction({ projectId: P, tasks: [task], links: [] })).rejects.toThrow('REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
  })
  it('refuses a malformed task before calling the database', async () => {
    const { rpcCalls } = setup()
    const res = await createScheduleTasksAction({ projectId: P, tasks: [{ ...task, start: '01/10/2026' }], links: [] })
    expect(res).toEqual({ error: 'Check the task: every date must be a real calendar date and every task needs a name.' })
    expect(rpcCalls).toHaveLength(0)
  })
  it('sends snake_case to the RPC, records one audit row, returns the key → id map', async () => {
    const { rpcCalls } = setup({ rpc: { 'solar.schedule_create_tasks': { data: { a: T }, error: null } } })
    const res = await createScheduleTasksAction({
      projectId: P, tasks: [{ ...task, ownerId: 'u2', isMilestone: false, category: 'Design' }],
      links: [{ from: 'a', to: T, type: 'SS', lagDays: 2 }],
    })
    expect(res).toEqual({ ok: true, ids: { a: T } })
    expect(rpcCalls[0]).toEqual({
      name: 'solar.schedule_create_tasks',
      args: {
        p_project_id: P,
        p_tasks: [expect.objectContaining({ key: 'a', name: 'Design', start: '2026-10-01', end: '2026-10-05', owner_id: 'u2', category: 'Design', is_milestone: false })],
        p_links: [{ from: 'a', to: T, type: 'SS', lag: 2 }],
        p_replace: false,
      },
    })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'schedule_tasks_added', objectRef: { count: 1 } })
  })
  it('passes the spine’s sentence through', async () => {
    setup({ rpc: { 'solar.schedule_create_tasks': { data: null, error: { code: '22023', message: 'That person is not an active member of this project, so "Design" cannot be given to them.' } } } })
    await expect(createScheduleTasksAction({ projectId: P, tasks: [task], links: [] }))
      .resolves.toEqual({ error: 'That person is not an active member of this project, so "Design" cannot be given to them.' })
    expect(h.audit).not.toHaveBeenCalled()
  })
})

describe('updateScheduleTasksAction', () => {
  it('sends only the keys that changed, with the concurrency token', async () => {
    const { rpcCalls } = setup({ rpc: { 'solar.schedule_update_tasks': { data: [{ id: T, updated_at: 'U2' }], error: null } } })
    const res = await updateScheduleTasksAction({ projectId: P, patches: [{ id: T, expectedUpdatedAt: 'U1', start: '2026-10-02', end: '2026-10-06' }] })
    expect(res).toEqual({ ok: true, updated: [{ id: T, updatedAt: 'U2' }] })
    expect(rpcCalls[0].args).toEqual({ p_project_id: P, p_patches: [{ id: T, expected_updated_at: 'U1', start: '2026-10-02', end: '2026-10-06' }] })
  })
  it('stale write → the stale sentence', async () => {
    setup({ rpc: { 'solar.schedule_update_tasks': { data: null, error: { code: '40001', message: 'x' } } } })
    await expect(updateScheduleTasksAction({ projectId: P, patches: [{ id: T, expectedUpdatedAt: 'U0', progress: 50 }] }))
      .resolves.toEqual({ error: STALE_MESSAGE })
  })
  it('refuses an empty or oversized batch', async () => {
    setup()
    await expect(updateScheduleTasksAction({ projectId: P, patches: [] })).resolves.toEqual({ error: 'Nothing to change.' })
  })
})

describe('deleteScheduleTasksAction and reorderScheduleTasksAction', () => {
  it('deletes through the RPC and records the count', async () => {
    const { rpcCalls } = setup({ rpc: { 'solar.schedule_delete_tasks': { data: 2, error: null } } })
    await expect(deleteScheduleTasksAction({ projectId: P, taskIds: [T, T.replace('2222', '3333')] })).resolves.toEqual({ ok: true, removed: 2 })
    expect(rpcCalls[0].name).toBe('solar.schedule_delete_tasks')
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'schedule_tasks_removed', objectRef: { count: 2 } })
  })
  it('reorders the full id list', async () => {
    const { rpcCalls } = setup({ rpc: { 'solar.schedule_reorder': { data: 1, error: null } } })
    await expect(reorderScheduleTasksAction({ projectId: P, orderedIds: [T] })).resolves.toEqual({ ok: true })
    expect(rpcCalls[0].args).toEqual({ p_project_id: P, p_ids: [T] })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter web exec vitest run src/actions/solar-schedule.actions.test.ts`
Expected: FAIL — cannot resolve `./solar-schedule.actions`.

- [ ] **Step 3: Implement the input schemas (a plain module — a `'use server'` file may export only async functions)**

`apps/web/src/lib/solar/schedule/inputs.ts`:
```ts
/** Zod shapes for the schedule actions + camelCase → RPC snake_case. Shared by actions and the client. */
import { z } from 'zod'
import { GANTT_STATUSES, LINK_TYPES, isCalendarDate } from '@esite/shared'

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
```

- [ ] **Step 4: Implement the actions**

`apps/web/src/actions/solar-schedule.actions.ts`:
```ts
'use server'
/**
 * Schedule task actions (spec §14). Each re-checks the Solar level itself;
 * writes go through the caller's session to the 00213 RPCs, which re-check
 * solar_can_edit and run the work-item spine's triggers. Nothing here trusts
 * the page gate or the client's shapes.
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { loadScheduleData } from '@/lib/solar/schedule/loader'
import { humanScheduleError } from '@/lib/solar/schedule/errors'
import {
  BAD_TASK, LinkInputSchema, TaskInputSchema, TaskPatchSchema, toRpcPatch, toRpcTask,
  type LinkInput, type TaskInput, type TaskPatch,
} from '@/lib/solar/schedule/inputs'
import type { ScheduleData } from '@/lib/solar/schedule/types'
import { sastToday } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Fail = { error: string }

async function session(projectId: string, need: 'view' | 'edit') {
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(projectId, need, supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, level, userId: user?.id ?? null }
}

export async function loadScheduleAction(input: { projectId: string }): Promise<{ ok: true; data: ScheduleData } | Fail> {
  const { supabase, level } = await session(input.projectId, 'view')
  return { ok: true, data: await loadScheduleData(input.projectId, supabase, level, sastToday()) }
}

export async function createScheduleTasksAction(input: {
  projectId: string
  tasks: TaskInput[]
  links: LinkInput[]
  replace?: boolean
  auditVerb?: 'schedule_tasks_added' | 'schedule_imported' | 'schedule_template_applied'
}): Promise<{ ok: true; ids: Record<string, string> } | Fail> {
  const { supabase, userId } = await session(input.projectId, 'edit')
  if (!userId) return { error: 'You are not signed in.' }
  const tasks = z.array(TaskInputSchema).min(1).max(2000).safeParse(input.tasks)
  const links = z.array(LinkInputSchema).max(10000).safeParse(input.links)
  if (!tasks.success || !links.success) return { error: BAD_TASK }
  const { data, error } = await supabase.schema('solar').rpc('schedule_create_tasks', {
    p_project_id: input.projectId,
    p_tasks: tasks.data.map(toRpcTask),
    p_links: links.data.map((l) => ({ from: l.from, to: l.to, type: l.type, lag: l.lagDays })),
    p_replace: input.replace === true,
  })
  if (error) return { error: humanScheduleError(error) }
  const verb = input.auditVerb ?? 'schedule_tasks_added'
  await recordSolarAudit({
    projectId: input.projectId, actorId: userId, verb,
    objectRef: verb === 'schedule_imported' ? { count: tasks.data.length, mode: input.replace ? 'replace' : 'append' } : { count: tasks.data.length },
  })
  return { ok: true, ids: (data ?? {}) as Record<string, string> }
}

export async function updateScheduleTasksAction(input: {
  projectId: string
  patches: TaskPatch[]
}): Promise<{ ok: true; updated: Array<{ id: string; updatedAt: string }> } | Fail> {
  const { supabase } = await session(input.projectId, 'edit')
  if (!Array.isArray(input.patches) || input.patches.length === 0) return { error: 'Nothing to change.' }
  const patches = z.array(TaskPatchSchema).max(2000).safeParse(input.patches)
  if (!patches.success) return { error: BAD_TASK }
  const { data, error } = await supabase.schema('solar').rpc('schedule_update_tasks', {
    p_project_id: input.projectId,
    p_patches: patches.data.map(toRpcPatch),
  })
  if (error) return { error: humanScheduleError(error) }
  const rows = (Array.isArray(data) ? data : []) as Array<{ id: string; updated_at: string }>
  return { ok: true, updated: rows.map((r) => ({ id: r.id, updatedAt: r.updated_at })) }
}

export async function deleteScheduleTasksAction(input: {
  projectId: string
  taskIds: string[]
}): Promise<{ ok: true; removed: number } | Fail> {
  const { supabase, userId } = await session(input.projectId, 'edit')
  if (!userId) return { error: 'You are not signed in.' }
  const ids = z.array(z.string().uuid()).min(1).max(2000).safeParse(input.taskIds)
  if (!ids.success) return { error: 'Choose at least one task.' }
  const { data, error } = await supabase.schema('solar').rpc('schedule_delete_tasks', {
    p_project_id: input.projectId, p_task_ids: ids.data,
  })
  if (error) return { error: humanScheduleError(error) }
  const removed = Number(data ?? 0)
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'schedule_tasks_removed', objectRef: { count: removed } })
  return { ok: true, removed }
}

export async function reorderScheduleTasksAction(input: { projectId: string; orderedIds: string[] }): Promise<{ ok: true } | Fail> {
  const { supabase } = await session(input.projectId, 'edit')
  const ids = z.array(z.string().uuid()).min(1).max(5000).safeParse(input.orderedIds)
  if (!ids.success) return { error: 'Nothing to reorder.' }
  const { error } = await supabase.schema('solar').rpc('schedule_reorder', { p_project_id: input.projectId, p_ids: ids.data })
  if (error) return { error: humanScheduleError(error) }
  return { ok: true }
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter web exec vitest run src/actions/solar-schedule.actions.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/actions/solar-schedule.actions.ts apps/web/src/actions/solar-schedule.actions.test.ts apps/web/src/lib/solar/schedule/inputs.ts
git commit -m "feat(solar-schedule): task actions over the gated RPCs (create, update, delete, reorder, load)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Links, baselines, presets, schedule settings

**Files:**
- Create: `apps/web/src/actions/solar-schedule-meta.actions.ts`, `solar-schedule-meta.actions.test.ts`

These write straight to the 00213 tables through the caller's session: RLS (Edit for links/baselines/settings, View for one's own presets) and the bind triggers (loop refusal, user binding) decide. Presets are a **View-level** action (filtering is reading).

- [ ] **Step 1: Write the failing test**

`apps/web/src/actions/solar-schedule-meta.actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))

import {
  addScheduleLinkAction, updateScheduleLinkAction, removeScheduleLinkAction, saveBaselineAction, deleteBaselineAction,
  loadBaselineTasksAction, saveFilterPresetAction, deleteFilterPresetAction, saveScheduleSettingsAction,
} from './solar-schedule-meta.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import { EMPTY_SCHEDULE_FILTERS } from '@esite/shared'

const P = '11111111-1111-4111-8111-111111111111'
const A = '22222222-2222-4222-8222-222222222222'
const B = '33333333-3333-4333-8333-333333333333'

function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: 'u1', ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
beforeEach(() => {
  vi.clearAllMocks()
  h.requireSolarLevel.mockResolvedValue('edit')
})

describe('links', () => {
  it('adds a link at Edit level and returns its id', async () => {
    const { calls } = setup({ writes: { 'solar.schedule_dependencies:insert': { data: [{ id: 'd1' }] } } })
    await expect(addScheduleLinkAction({ projectId: P, predecessorId: A, successorId: B, type: 'FF', lagDays: -1 }))
      .resolves.toEqual({ ok: true, id: 'd1' })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit', expect.anything())
    expect(callsTo(calls, 'solar.schedule_dependencies', 'insert')[0].payload)
      .toEqual({ project_id: P, predecessor_task_id: A, successor_task_id: B, link_type: 'FF', lag_days: -1 })
  })
  it('a loop comes back as a sentence', async () => {
    setup({ writes: { 'solar.schedule_dependencies:insert': { error: { code: '23514', message: 'solar.schedule_dependencies: this link would create a loop' } } } })
    await expect(addScheduleLinkAction({ projectId: P, predecessorId: A, successorId: B, type: 'FS', lagDays: 0 }))
      .resolves.toEqual({ error: 'That link would make these tasks depend on each other in a loop.' })
  })
  it('refuses a self link without calling the database', async () => {
    const { calls } = setup()
    await expect(addScheduleLinkAction({ projectId: P, predecessorId: A, successorId: A, type: 'FS', lagDays: 0 }))
      .resolves.toEqual({ error: 'A task cannot depend on itself.' })
    expect(calls).toHaveLength(0)
  })
  it('editing a link that is gone says so', async () => {
    setup({ writes: { 'solar.schedule_dependencies:update': { data: [] } } })
    await expect(updateScheduleLinkAction({ projectId: P, linkId: A, type: 'SS', lagDays: 2 }))
      .resolves.toEqual({ error: 'That link is no longer on this schedule. Reload to see the current programme.' })
  })
  it('removes a link scoped to the project', async () => {
    const { calls } = setup()
    await expect(removeScheduleLinkAction({ projectId: P, linkId: A })).resolves.toEqual({ ok: true })
    expect(callsTo(calls, 'solar.schedule_dependencies', 'delete')[0].filters).toEqual([['eq', 'id', A], ['eq', 'project_id', P]])
  })
})

describe('baselines', () => {
  it('saves through the RPC and records the name', async () => {
    const { rpcCalls } = setup({ rpc: { 'solar.schedule_save_baseline': { data: 'b1', error: null } } })
    await expect(saveBaselineAction({ projectId: P, name: '  Contract  ', description: '' })).resolves.toEqual({ ok: true, id: 'b1' })
    expect(rpcCalls[0].args).toEqual({ p_project_id: P, p_name: 'Contract', p_description: '' })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'schedule_baseline_saved', objectRef: { name: 'Contract' } })
  })
  it('a blank name never reaches the database', async () => {
    const { rpcCalls } = setup()
    await expect(saveBaselineAction({ projectId: P, name: ' ', description: '' })).resolves.toEqual({ error: 'Give the baseline a name.' })
    expect(rpcCalls).toHaveLength(0)
  })
  it('deletes and loads at the right levels', async () => {
    setup({ tables: { 'solar.schedule_baseline_tasks': [
      { baseline_id: 'b1', project_id: P, task_id: null, work_item_ref: 'SOLAR-1', name: 'Design', start_date: '2026-10-01', end_date: '2026-10-05', is_milestone: false, sort_order: 1 },
    ] } })
    await expect(deleteBaselineAction({ projectId: P, baselineId: A })).resolves.toEqual({ ok: true })
    h.requireSolarLevel.mockResolvedValue('view')
    await expect(loadBaselineTasksAction({ projectId: P, baselineId: 'b1' })).resolves.toEqual({
      ok: true, tasks: [{ taskId: null, ref: 'SOLAR-1', name: 'Design', start: '2026-10-01', end: '2026-10-05', isMilestone: false }],
    })
    expect(h.requireSolarLevel).toHaveBeenLastCalledWith(P, 'view', expect.anything())
  })
})

describe('presets (View level)', () => {
  it('saves a well-formed filter set for the caller', async () => {
    h.requireSolarLevel.mockResolvedValue('view')
    const { calls } = setup({ writes: { 'solar.schedule_filter_presets:insert': { data: [{ id: 'f1' }] } } })
    await expect(saveFilterPresetAction({ projectId: P, name: 'Late', filters: { ...EMPTY_SCHEDULE_FILTERS, statuses: ['in_progress'] } }))
      .resolves.toEqual({ ok: true, id: 'f1' })
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'view', expect.anything())
    expect(callsTo(calls, 'solar.schedule_filter_presets', 'insert')[0].payload)
      .toEqual({ project_id: P, user_id: 'u1', name: 'Late', filters: { ...EMPTY_SCHEDULE_FILTERS, statuses: ['in_progress'] } })
  })
  it('refuses a malformed filter object and a duplicate name', async () => {
    setup({ writes: { 'solar.schedule_filter_presets:insert': { error: { code: '23505', message: 'schedule_filter_presets_name_unique' } } } })
    await expect(saveFilterPresetAction({ projectId: P, name: 'X', filters: { search: 1 } as never })).resolves.toEqual({ error: 'That filter could not be saved.' })
    await expect(saveFilterPresetAction({ projectId: P, name: 'X', filters: EMPTY_SCHEDULE_FILTERS })).resolves.toEqual({ error: 'You already have a preset with that name.' })
  })
  it('deletes only the caller’s preset', async () => {
    const { calls } = setup()
    await deleteFilterPresetAction({ projectId: P, presetId: A })
    expect(callsTo(calls, 'solar.schedule_filter_presets', 'delete')[0].filters)
      .toEqual([['eq', 'id', A], ['eq', 'project_id', P], ['eq', 'user_id', 'u1']])
  })
})

describe('saveScheduleSettingsAction', () => {
  it('first save inserts; later saves are stale-guarded', async () => {
    const { calls } = setup({ writes: { 'solar.schedule_settings:insert': { data: [{ updated_at: 'S1' }] }, 'solar.schedule_settings:update': { data: [] } } })
    await expect(saveScheduleSettingsAction({ projectId: P, durationMode: 'working', workloadThreshold: 3, expectedUpdatedAt: null }))
      .resolves.toEqual({ ok: true, updatedAt: 'S1' })
    expect(callsTo(calls, 'solar.schedule_settings', 'insert')[0].payload).toEqual({ project_id: P, duration_mode: 'working', workload_threshold: 3 })
    await expect(saveScheduleSettingsAction({ projectId: P, durationMode: 'calendar', workloadThreshold: 3, expectedUpdatedAt: 'S0' }))
      .resolves.toEqual({ error: STALE_MESSAGE })
  })
  it('refuses a threshold outside 1–50', async () => {
    setup()
    await expect(saveScheduleSettingsAction({ projectId: P, durationMode: 'working', workloadThreshold: 0, expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'The workload limit must be a whole number from 1 to 50.' })
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter web exec vitest run src/actions/solar-schedule-meta.actions.test.ts`
Expected: FAIL — cannot resolve `./solar-schedule-meta.actions`.

- [ ] **Step 3: Implement**

`apps/web/src/actions/solar-schedule-meta.actions.ts`:
```ts
'use server'
/**
 * Links, baselines, per-user filter presets and schedule settings (spec §14.1–14.2).
 * Direct table writes through the caller's session: 00213's RLS and bind
 * triggers (loop refusal, user binding, org binding) are the authority.
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { humanScheduleError } from '@/lib/solar/schedule/errors'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import type { BaselineTaskView } from '@/lib/solar/schedule/types'
import { LINK_TYPES, isScheduleFilters, type DurationMode, type LinkType, type ScheduleFilters } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Fail = { error: string }
type Row = Record<string, unknown>

const LINK_GONE = 'That link is no longer on this schedule. Reload to see the current programme.'
const uuid = z.string().uuid()

async function session(projectId: string, need: 'view' | 'edit') {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, need, supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null, solar: () => supabase.schema('solar') }
}

const validLink = (type: unknown, lag: unknown) =>
  (LINK_TYPES as readonly unknown[]).includes(type) && Number.isInteger(lag) && Math.abs(lag as number) <= 365

export async function addScheduleLinkAction(input: {
  projectId: string; predecessorId: string; successorId: string; type: LinkType; lagDays: number
}): Promise<{ ok: true; id: string } | Fail> {
  const { solar } = await session(input.projectId, 'edit')
  if (!uuid.safeParse(input.predecessorId).success || !uuid.safeParse(input.successorId).success || !validLink(input.type, input.lagDays)) {
    return { error: 'Choose two tasks, a link type and a lag of at most 365 days.' }
  }
  if (input.predecessorId === input.successorId) return { error: 'A task cannot depend on itself.' }
  const { data, error } = await solar().from('schedule_dependencies').insert({
    project_id: input.projectId, predecessor_task_id: input.predecessorId, successor_task_id: input.successorId,
    link_type: input.type, lag_days: input.lagDays,
  }).select('id')
  if (error) return { error: humanScheduleError(error) }
  return { ok: true, id: String((data as Row[])[0]?.id ?? '') }
}

export async function updateScheduleLinkAction(input: {
  projectId: string; linkId: string; type: LinkType; lagDays: number
}): Promise<{ ok: true } | Fail> {
  const { solar } = await session(input.projectId, 'edit')
  if (!uuid.safeParse(input.linkId).success || !validLink(input.type, input.lagDays)) {
    return { error: 'Choose a link type and a lag of at most 365 days.' }
  }
  const { data, error } = await solar().from('schedule_dependencies')
    .update({ link_type: input.type, lag_days: input.lagDays })
    .eq('id', input.linkId).eq('project_id', input.projectId).select('id')
  if (error) return { error: humanScheduleError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: LINK_GONE }
  return { ok: true }
}

export async function removeScheduleLinkAction(input: { projectId: string; linkId: string }): Promise<{ ok: true } | Fail> {
  const { solar } = await session(input.projectId, 'edit')
  if (!uuid.safeParse(input.linkId).success) return { error: LINK_GONE }
  const { error } = await solar().from('schedule_dependencies').delete().eq('id', input.linkId).eq('project_id', input.projectId)
  if (error) return { error: humanScheduleError(error) }
  return { ok: true }
}

export async function saveBaselineAction(input: { projectId: string; name: string; description: string }): Promise<{ ok: true; id: string } | Fail> {
  const { supabase, userId } = await session(input.projectId, 'edit')
  if (!userId) return { error: 'You are not signed in.' }
  const name = (input.name ?? '').trim()
  if (!name) return { error: 'Give the baseline a name.' }
  if (name.length > 120 || (input.description ?? '').length > 1000) return { error: 'That name or description is too long.' }
  const { data, error } = await supabase.schema('solar').rpc('schedule_save_baseline', {
    p_project_id: input.projectId, p_name: name, p_description: input.description ?? '',
  })
  if (error) return { error: humanScheduleError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'schedule_baseline_saved', objectRef: { name } })
  return { ok: true, id: String(data ?? '') }
}

export async function deleteBaselineAction(input: { projectId: string; baselineId: string }): Promise<{ ok: true } | Fail> {
  const { solar } = await session(input.projectId, 'edit')
  if (!uuid.safeParse(input.baselineId).success) return { error: 'That baseline is no longer there.' }
  const { error } = await solar().from('schedule_baselines').delete().eq('id', input.baselineId).eq('project_id', input.projectId)
  if (error) return { error: humanScheduleError(error) }
  return { ok: true }
}

export async function loadBaselineTasksAction(input: { projectId: string; baselineId: string }): Promise<{ ok: true; tasks: BaselineTaskView[] } | Fail> {
  const { solar } = await session(input.projectId, 'view')
  const { data, error } = await solar().from('schedule_baseline_tasks')
    .select('task_id, work_item_ref, name, start_date, end_date, is_milestone, sort_order')
    .eq('baseline_id', input.baselineId).eq('project_id', input.projectId).order('sort_order')
  if (error) return { error: humanScheduleError(error) }
  return {
    ok: true,
    tasks: ((data ?? []) as Row[]).map((r) => ({
      taskId: typeof r.task_id === 'string' ? r.task_id : null, ref: String(r.work_item_ref ?? ''), name: String(r.name ?? ''),
      start: String(r.start_date), end: String(r.end_date), isMilestone: r.is_milestone === true,
    })),
  }
}

export async function saveFilterPresetAction(input: { projectId: string; name: string; filters: ScheduleFilters }): Promise<{ ok: true; id: string } | Fail> {
  const { solar, userId } = await session(input.projectId, 'view')
  if (!userId) return { error: 'You are not signed in.' }
  const name = (input.name ?? '').trim()
  if (!name || name.length > 80) return { error: 'Give the preset a name of up to 80 characters.' }
  if (!isScheduleFilters(input.filters)) return { error: 'That filter could not be saved.' }
  const filters: ScheduleFilters = {
    search: input.filters.search, statuses: input.filters.statuses, ownerIds: input.filters.ownerIds, colours: input.filters.colours,
  }
  const { data, error } = await solar().from('schedule_filter_presets')
    .insert({ project_id: input.projectId, user_id: userId, name, filters }).select('id')
  if (error) return { error: humanScheduleError(error) }
  return { ok: true, id: String((data as Row[])[0]?.id ?? '') }
}

export async function deleteFilterPresetAction(input: { projectId: string; presetId: string }): Promise<{ ok: true } | Fail> {
  const { solar, userId } = await session(input.projectId, 'view')
  if (!userId) return { error: 'You are not signed in.' }
  const { error } = await solar().from('schedule_filter_presets').delete()
    .eq('id', input.presetId).eq('project_id', input.projectId).eq('user_id', userId)
  if (error) return { error: humanScheduleError(error) }
  return { ok: true }
}

export async function saveScheduleSettingsAction(input: {
  projectId: string; durationMode: DurationMode; workloadThreshold: number; expectedUpdatedAt: string | null
}): Promise<{ ok: true; updatedAt: string } | Fail> {
  const { solar } = await session(input.projectId, 'edit')
  if (input.durationMode !== 'calendar' && input.durationMode !== 'working') return { error: 'Choose calendar days or working days.' }
  if (!Number.isInteger(input.workloadThreshold) || input.workloadThreshold < 1 || input.workloadThreshold > 50) {
    return { error: 'The workload limit must be a whole number from 1 to 50.' }
  }
  const values = { duration_mode: input.durationMode, workload_threshold: input.workloadThreshold }
  if (input.expectedUpdatedAt === null) {
    const { data, error } = await solar().from('schedule_settings').insert({ project_id: input.projectId, ...values }).select('updated_at')
    if (error) return { error: error.code === '23505' ? STALE_MESSAGE : humanScheduleError(error) }
    return { ok: true, updatedAt: String((data as Row[])[0]?.updated_at ?? '') }
  }
  const { data, error } = await solar().from('schedule_settings').update(values)
    .eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: humanScheduleError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  return { ok: true, updatedAt: String((data as Row[])[0]?.updated_at ?? '') }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter web exec vitest run src/actions/solar-schedule-meta.actions.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/solar-schedule-meta.actions.ts apps/web/src/actions/solar-schedule-meta.actions.test.ts
git commit -m "feat(solar-schedule): links (all four types + lag), baselines, per-user presets, settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Template — apply to a project, edit the org's template in `/settings/solar`

**Files:**
- Modify: `apps/web/src/lib/solar/schedule/inputs.ts` (add `planToInputs`, `resolveOwnerHints`)
- Create: `apps/web/src/lib/solar/schedule/template-editor.ts`, `template-editor.test.ts`
- Create: `apps/web/src/actions/solar-schedule-template.actions.ts`, `solar-schedule-template.actions.test.ts`
- Create: `apps/web/src/app/(admin)/settings/solar/ScheduleTemplateEditor.tsx`, `ScheduleTemplateEditor.test.tsx`
- Modify: `apps/web/src/app/(admin)/settings/solar/page.tsx`

The template editor is a table of rows whose "Follows" column uses the same `3FS+2d, 5SS` notation as import (by row number), so there is one notation for people to learn.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/solar/schedule/template-editor.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { templateToRows, rowsToTemplate } from './template-editor'
import { planToInputs, resolveOwnerHints } from './inputs'
import { DEFAULT_SOLAR_SCHEDULE_TEMPLATE, instantiateScheduleTemplate, makeWorkCalendar } from '@esite/shared'

describe('template editor rows', () => {
  it('round-trips the default template', () => {
    const rows = templateToRows(DEFAULT_SOLAR_SCHEDULE_TEMPLATE)
    expect(rows[9].follows).toBe('9FF') // inverters follow modules (row 9) finish-to-finish
    const back = rowsToTemplate(rows)
    expect(back.errors).toEqual([])
    expect(back.items.map((i) => [i.name, i.durationDays, i.after.length])).toEqual(
      DEFAULT_SOLAR_SCHEDULE_TEMPLATE.map((i) => [i.name, i.durationDays, i.after.length]))
  })
  it('reports a bad follows cell by row', () => {
    const rows = templateToRows(DEFAULT_SOLAR_SCHEDULE_TEMPLATE.slice(0, 2))
    rows[1].follows = 'after survey'
    expect(rowsToTemplate(rows).errors).toEqual(['Row 2: "after survey" should look like 1FS+2d, 3SS.'])
    rows[1].follows = '7'
    expect(rowsToTemplate(rows).errors).toEqual(['Row 2: row 7 does not exist.'])
  })
})

describe('plan → action inputs', () => {
  it('maps an instantiated template to task and link inputs', () => {
    const plan = instantiateScheduleTemplate(DEFAULT_SOLAR_SCHEDULE_TEMPLATE, '2026-10-01', makeWorkCalendar('calendar'))
    const { tasks, links } = planToInputs(plan, () => null)
    expect(tasks[0]).toMatchObject({ key: 'survey', name: 'Site survey and design brief', start: '2026-10-01', ownerId: null })
    expect(links[0]).toEqual({ from: 'survey', to: 'design', type: 'FS', lagDays: 0 })
  })
  it('matches owners by email, then by unique full name; reports the rest', () => {
    const owners = [
      { id: 'u1', name: 'Ann Smith', email: 'ann@x.co.za' },
      { id: 'u2', name: 'Bob Dube', email: 'bob@x.co.za' },
      { id: 'u3', name: 'Bob Dube', email: 'bob2@x.co.za' },
    ]
    const r = resolveOwnerHints(['ANN@x.co.za', 'ann smith', 'Bob Dube', 'Zed', null], owners)
    expect(r.ids).toEqual(['u1', 'u1', null, null, null])
    expect(r.unmatched).toEqual(['Bob Dube', 'Zed'])
  })
})
```

`apps/web/src/actions/solar-schedule-template.actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}),
  getOrgContext: vi.fn(), requireRole: vi.fn(), revalidate: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: h.getOrgContext }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: h.requireRole }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))

import { applyScheduleTemplateAction, saveOrgScheduleTemplateAction } from './solar-schedule-template.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'
import { DEFAULT_SOLAR_SCHEDULE_TEMPLATE } from '@esite/shared'

const P = '11111111-1111-4111-8111-111111111111'
function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({ userId: 'u1', ...extra })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
beforeEach(() => {
  vi.clearAllMocks()
  h.requireSolarLevel.mockResolvedValue('edit')
  h.getOrgContext.mockResolvedValue({ organisationId: 'o1', userId: 'u1' })
  h.requireRole.mockResolvedValue({ ok: true })
})

describe('applyScheduleTemplateAction', () => {
  it('uses the built-in programme when the org has none, in the project’s duration mode', async () => {
    const { rpcCalls } = setup({
      rpc: { 'solar.schedule_org_template': { data: null, error: null }, 'solar.schedule_create_tasks': { data: { survey: 't1' }, error: null } },
      tables: { 'solar.schedule_settings': [{ project_id: P, duration_mode: 'working', workload_threshold: 2, updated_at: 'S' }] },
    })
    await expect(applyScheduleTemplateAction({ projectId: P, start: '2026-10-03' })).resolves.toEqual({ ok: true, count: DEFAULT_SOLAR_SCHEDULE_TEMPLATE.length })
    const create = rpcCalls.find((c) => c.name === 'solar.schedule_create_tasks')!
    const tasks = create.args.p_tasks as Array<{ start: string }>
    expect(tasks[0].start).toBe('2026-10-05') // Saturday start moves to Monday in working mode
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'schedule_template_applied', objectRef: { count: DEFAULT_SOLAR_SCHEDULE_TEMPLATE.length } }))
  })
  it('uses the org’s template when it has a valid one', async () => {
    const items = [{ key: 'x', name: 'Only item', category: 'Design', zone: '', offsetDays: 0, durationDays: 2, isMilestone: false, after: [] }]
    const { rpcCalls } = setup({ rpc: {
      'solar.schedule_org_template': { data: { version: 1, items }, error: null },
      'solar.schedule_create_tasks': { data: { x: 't1' }, error: null },
    } })
    await expect(applyScheduleTemplateAction({ projectId: P, start: '2026-10-01' })).resolves.toEqual({ ok: true, count: 1 })
    expect((rpcCalls[1].args.p_tasks as unknown[]).length).toBe(1)
  })
  it('refuses a start that is not a date', async () => {
    setup()
    await expect(applyScheduleTemplateAction({ projectId: P, start: 'monday' })).resolves.toEqual({ error: 'Choose the date the programme starts.' })
  })
})

describe('saveOrgScheduleTemplateAction', () => {
  it('owner/admin only', async () => {
    setup()
    h.requireRole.mockResolvedValue({ ok: false })
    await expect(saveOrgScheduleTemplateAction({ items: DEFAULT_SOLAR_SCHEDULE_TEMPLATE, expectedUpdatedAt: null }))
      .resolves.toEqual({ error: 'Only an organisation owner or admin can change the schedule template.' })
  })
  it('validates, then inserts { version, items }', async () => {
    const { calls } = setup({ writes: { 'solar.schedule_templates:insert': { data: [{ updated_at: 'T1' }] } } })
    await expect(saveOrgScheduleTemplateAction({ items: DEFAULT_SOLAR_SCHEDULE_TEMPLATE, expectedUpdatedAt: null })).resolves.toEqual({ ok: true, updatedAt: 'T1' })
    expect(callsTo(calls, 'solar.schedule_templates', 'insert')[0].payload)
      .toEqual({ organisation_id: 'o1', content: { version: 1, items: DEFAULT_SOLAR_SCHEDULE_TEMPLATE } })
    await expect(saveOrgScheduleTemplateAction({ items: [], expectedUpdatedAt: null })).resolves.toEqual({ error: 'The template needs at least one item.' })
  })
})
```

`apps/web/src/app/(admin)/settings/solar/ScheduleTemplateEditor.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/actions/solar-schedule-template.actions', () => ({ saveOrgScheduleTemplateAction: h.save }))

import { ScheduleTemplateEditor } from './ScheduleTemplateEditor'
import { DEFAULT_SOLAR_SCHEDULE_TEMPLATE } from '@esite/shared'

beforeEach(() => {
  vi.clearAllMocks()
  h.save.mockResolvedValue({ ok: true, updatedAt: 'T2' })
})

describe('ScheduleTemplateEditor', () => {
  it('lists the items and saves them', async () => {
    render(<ScheduleTemplateEditor initialItems={DEFAULT_SOLAR_SCHEDULE_TEMPLATE} updatedAt={null} isDefault />)
    expect(screen.getByDisplayValue('Site survey and design brief')).toBeTruthy()
    expect(screen.getByText('Using the standard programme')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ items: expect.any(Array), expectedUpdatedAt: null }))
    expect(await screen.findByText('Template saved.')).toBeTruthy()
  })
  it('shows row errors and does not save', async () => {
    render(<ScheduleTemplateEditor initialItems={DEFAULT_SOLAR_SCHEDULE_TEMPLATE.slice(0, 2)} updatedAt="T1" isDefault={false} />)
    fireEvent.change(screen.getAllByLabelText('Follows')[1], { target: { value: 'soon' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByText('Row 2: "soon" should look like 1FS+2d, 3SS.')).toBeTruthy()
    expect(h.save).not.toHaveBeenCalled()
  })
  it('adds and removes rows', () => {
    render(<ScheduleTemplateEditor initialItems={DEFAULT_SOLAR_SCHEDULE_TEMPLATE.slice(0, 1)} updatedAt={null} isDefault />)
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(screen.getAllByLabelText('Item name')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove item' })[1])
    expect(screen.getAllByLabelText('Item name')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter web exec vitest run src/lib/solar/schedule/template-editor.test.ts src/actions/solar-schedule-template.actions.test.ts "src/app/(admin)/settings/solar/ScheduleTemplateEditor.test.tsx"
```
Expected: FAIL — unresolved modules.

- [ ] **Step 3: Implement `inputs.ts` additions**

Append to `apps/web/src/lib/solar/schedule/inputs.ts`:
```ts
import type { ImportPlan } from '@esite/shared'

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

/** Owner as written in a file → member id: email (case-insensitive) first, then a UNIQUE full name. */
export function resolveOwnerHints(
  hints: ReadonlyArray<string | null>,
  owners: ReadonlyArray<{ id: string; name: string; email: string }>,
): { ids: Array<string | null>; unmatched: string[] } {
  const byEmail = new Map(owners.map((o) => [o.email.trim().toLowerCase(), o.id]))
  const byName = new Map<string, string[]>()
  for (const o of owners) {
    const k = o.name.trim().toLowerCase()
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
```
(Move the `import type { ImportPlan }` line to the top of the file with the other imports.)

- [ ] **Step 4: Implement `template-editor.ts`**

`apps/web/src/lib/solar/schedule/template-editor.ts`:
```ts
/** Template items ⇄ editable rows. "Follows" uses the import notation by ROW number: 1FS+2d, 3SS. */
import { parsePredecessors, validateScheduleTemplate, type ScheduleTemplateItem } from '@esite/shared'

export interface TemplateRow {
  name: string
  category: string
  zone: string
  offsetDays: string
  durationDays: string
  isMilestone: boolean
  follows: string
}

export function templateToRows(items: readonly ScheduleTemplateItem[]): TemplateRow[] {
  const pos = new Map(items.map((it, i) => [it.key, i + 1]))
  return items.map((it) => ({
    name: it.name, category: it.category, zone: it.zone,
    offsetDays: String(it.offsetDays), durationDays: String(it.durationDays), isMilestone: it.isMilestone,
    follows: it.after.map((a) => `${pos.get(a.key)}${a.type}${a.lagDays > 0 ? `+${a.lagDays}d` : a.lagDays < 0 ? `${a.lagDays}d` : ''}`).join(', '),
  }))
}

export function rowsToTemplate(rows: readonly TemplateRow[]): { items: ScheduleTemplateItem[]; errors: string[] } {
  const errors: string[] = []
  const items: ScheduleTemplateItem[] = rows.map((r, i) => {
    const parsed = parsePredecessors(r.follows)
    if (parsed === null) errors.push(`Row ${i + 1}: "${r.follows}" should look like 1FS+2d, 3SS.`)
    const after = (parsed ?? []).flatMap((p) => {
      if (p.position < 1 || p.position > rows.length) { errors.push(`Row ${i + 1}: row ${p.position} does not exist.`); return [] }
      return [{ key: `t${p.position}`, type: p.type, lagDays: p.lagDays }]
    })
    const offset = Number(r.offsetDays || '0')
    const duration = r.isMilestone ? 0 : Number(r.durationDays)
    return {
      key: `t${i + 1}`, name: r.name.trim(), category: r.category.trim(), zone: r.zone.trim(),
      offsetDays: Number.isFinite(offset) ? offset : -1, durationDays: Number.isFinite(duration) ? duration : 0,
      isMilestone: r.isMilestone, after,
    }
  })
  if (errors.length) return { items, errors }
  return { items, errors: validateScheduleTemplate(items) }
}
```

Check against the test: `templateToRows(DEFAULT…)[9]` is `inverters` (index 9, the 10th item), whose `after` is `[{ key: 'modules', type: 'FF', lagDays: 0 }]`; `modules` is item 9 → `'9FF'`. ✓

- [ ] **Step 5: Implement the template actions**

`apps/web/src/actions/solar-schedule-template.actions.ts`:
```ts
'use server'
/**
 * "Use template" (spec §14.1) and the org's template in /settings/solar.
 * Apply: Edit level; reads the org template through a definer RPC that
 * re-checks Edit (solar.schedule_org_template), falls back to the built-in
 * programme, instantiates it in the project's duration mode, and creates
 * everything in ONE RPC call. Save: org owner/admin (requireRole → .ok).
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { getOrgContext } from '@/lib/auth-org'
import { requireRole } from '@/lib/auth/require-role'
import { humanScheduleError } from '@/lib/solar/schedule/errors'
import { planToInputs, toRpcTask } from '@/lib/solar/schedule/inputs'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import {
  DEFAULT_SOLAR_SCHEDULE_TEMPLATE, OWNER_ADMIN, SCHEDULE_TEMPLATE_VERSION, instantiateScheduleTemplate, isCalendarDate,
  makeWorkCalendar, readScheduleTemplate, saHolidaySet, validateScheduleTemplate, type ScheduleTemplateItem,
} from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Fail = { error: string }

export async function applyScheduleTemplateAction(input: { projectId: string; start: string }): Promise<{ ok: true; count: number } | Fail> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(input.projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  if (!isCalendarDate(input.start)) return { error: 'Choose the date the programme starts.' }

  const [{ data: stored, error: tplErr }, { data: settings }] = await Promise.all([
    supabase.schema('solar').rpc('schedule_org_template', { p_project_id: input.projectId }),
    supabase.schema('solar').from('schedule_settings').select('duration_mode').eq('project_id', input.projectId).maybeSingle(),
  ])
  if (tplErr) return { error: humanScheduleError(tplErr) }
  const items = readScheduleTemplate(stored) ?? DEFAULT_SOLAR_SCHEDULE_TEMPLATE
  const year = Number(input.start.slice(0, 4))
  const mode = (settings as { duration_mode?: string } | null)?.duration_mode === 'working' ? 'working' : 'calendar'
  const plan = instantiateScheduleTemplate(items, input.start, makeWorkCalendar(mode, saHolidaySet(year, year + 3)))
  const { tasks, links } = planToInputs(plan, () => null)

  const { error } = await supabase.schema('solar').rpc('schedule_create_tasks', {
    p_project_id: input.projectId,
    p_tasks: tasks.map(toRpcTask),
    p_links: links.map((l) => ({ from: l.from, to: l.to, type: l.type, lag: l.lagDays })),
    p_replace: false,
  })
  if (error) return { error: humanScheduleError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: user.id, verb: 'schedule_template_applied', objectRef: { count: tasks.length } })
  return { ok: true, count: tasks.length }
}

const NOT_ADMIN = 'Only an organisation owner or admin can change the schedule template.'

export async function saveOrgScheduleTemplateAction(input: {
  items: ScheduleTemplateItem[]
  expectedUpdatedAt: string | null
}): Promise<{ ok: true; updatedAt: string } | Fail> {
  const ctx = await getOrgContext()
  if (!ctx) return { error: 'You are not signed in.' }
  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await requireRole(supabase as never, ctx.organisationId, OWNER_ADMIN)
  if (!gate.ok) return { error: NOT_ADMIN }
  if (!Array.isArray(input.items) || input.items.length === 0) return { error: 'The template needs at least one item.' }
  if (input.items.length > 200) return { error: 'A template can have at most 200 items.' }
  const errors = validateScheduleTemplate(input.items)
  if (errors.length) return { error: errors[0] }
  const content = { version: SCHEDULE_TEMPLATE_VERSION, items: input.items }
  const table = () => supabase.schema('solar').from('schedule_templates')
  let updatedAt: unknown
  if (input.expectedUpdatedAt === null) {
    const { data, error } = await table().insert({ organisation_id: ctx.organisationId, content }).select('updated_at')
    if (error) return { error: error.code === '23505' ? STALE_MESSAGE : humanScheduleError(error) }
    updatedAt = (data as Array<{ updated_at?: string }>)[0]?.updated_at
  } else {
    const { data, error } = await table().update({ content })
      .eq('organisation_id', ctx.organisationId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
    if (error) return { error: humanScheduleError(error) }
    if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
    updatedAt = (data as Array<{ updated_at?: string }>)[0]?.updated_at
  }
  revalidatePath('/settings/solar')
  return { ok: true, updatedAt: String(updatedAt ?? '') }
}
```

- [ ] **Step 6: Implement the editor**

`apps/web/src/app/(admin)/settings/solar/ScheduleTemplateEditor.tsx`:
```tsx
'use client'
/** Org Solar schedule template (spec §14.1 "editable in org settings"). */
import { useState } from 'react'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DEFAULT_SOLAR_SCHEDULE_TEMPLATE, type ScheduleTemplateItem } from '@esite/shared'
import { rowsToTemplate, templateToRows, type TemplateRow } from '@/lib/solar/schedule/template-editor'
import { saveOrgScheduleTemplateAction } from '@/actions/solar-schedule-template.actions'

const BLANK: TemplateRow = { name: '', category: '', zone: '', offsetDays: '0', durationDays: '5', isMilestone: false, follows: '' }
const cell = { fontSize: 12, padding: '4px 6px', width: '100%' } as const

export function ScheduleTemplateEditor({ initialItems, updatedAt, isDefault }: {
  initialItems: ScheduleTemplateItem[]; updatedAt: string | null; isDefault: boolean
}) {
  const [rows, setRows] = useState<TemplateRow[]>(() => templateToRows(initialItems))
  const [token, setToken] = useState<string | null>(updatedAt)
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (i: number, patch: Partial<TemplateRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))

  async function save() {
    setNotice(null)
    const { items, errors: errs } = rowsToTemplate(rows)
    setErrors(errs)
    if (errs.length) return
    setBusy(true)
    const res = await saveOrgScheduleTemplateAction({ items, expectedUpdatedAt: token })
    setBusy(false)
    if ('error' in res) { setErrors([res.error]); return }
    setToken(res.updatedAt)
    setNotice('Template saved.')
  }

  return (
    <Card>
      <CardHeader><span className="data-panel-title">Schedule template</span></CardHeader>
      <CardBody>
        <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 0 }}>
          <strong>{isDefault ? 'Using the standard programme' : 'Your organisation’s programme'}</strong> — “Use template” on a project’s Schedule tab inserts these,
          dated from the start you choose. Days are counted in the project’s duration mode. “Follows” uses row numbers, e.g. 1FS+2d, 3SS.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>{['#', 'Item', 'Category', 'Zone', 'Offset', 'Days', 'Milestone', 'Follows', ''].map((hd) => <th key={hd} style={{ textAlign: 'left', padding: 4 }}>{hd}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: 4 }}>{i + 1}</td>
                <td><input aria-label="Item name" style={cell} value={r.name} onChange={(e) => set(i, { name: e.target.value })} /></td>
                <td><input aria-label="Category" style={cell} value={r.category} onChange={(e) => set(i, { category: e.target.value })} /></td>
                <td><input aria-label="Zone" style={cell} value={r.zone} onChange={(e) => set(i, { zone: e.target.value })} /></td>
                <td><input aria-label="Offset days" style={cell} inputMode="numeric" value={r.offsetDays} onChange={(e) => set(i, { offsetDays: e.target.value })} /></td>
                <td><input aria-label="Duration days" style={cell} inputMode="numeric" disabled={r.isMilestone} value={r.durationDays} onChange={(e) => set(i, { durationDays: e.target.value })} /></td>
                <td><input aria-label="Milestone" type="checkbox" checked={r.isMilestone} onChange={(e) => set(i, { isMilestone: e.target.checked })} /></td>
                <td><input aria-label="Follows" style={cell} value={r.follows} onChange={(e) => set(i, { follows: e.target.value })} /></td>
                <td><button type="button" aria-label="Remove item" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {errors.length > 0 && <ul role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        {notice && <p role="status" style={{ fontSize: 12, color: 'var(--c-green)' }}>{notice}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => setRows((rs) => [...rs, { ...BLANK }])}>Add item</button>
          <button type="button" onClick={() => setRows(templateToRows(DEFAULT_SOLAR_SCHEDULE_TEMPLATE))}>Reset to the standard programme</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={save}>Save template</button>
        </div>
      </CardBody>
    </Card>
  )
}
```

In `apps/web/src/app/(admin)/settings/solar/page.tsx`:
- add imports `import { DEFAULT_SOLAR_SCHEDULE_TEMPLATE, readScheduleTemplate } from '@esite/shared'` (merge into the existing `@esite/shared` import) and `import { ScheduleTemplateEditor } from './ScheduleTemplateEditor'`;
- after the `org_settings` read add:
```tsx
  const { data: tpl } = await supabase
    .schema('solar').from('schedule_templates').select('content, updated_at')
    .eq('organisation_id', ctx.organisationId).maybeSingle()
  const tplRow = tpl as { content?: unknown; updated_at?: string } | null
  const orgItems = readScheduleTemplate(tplRow?.content ?? null)
```
- directly after `<SolarSettingsForm … />` render:
```tsx
      <div style={{ marginTop: 16 }}>
        <ScheduleTemplateEditor
          initialItems={orgItems ?? DEFAULT_SOLAR_SCHEDULE_TEMPLATE}
          updatedAt={tplRow?.updated_at ?? null}
          isDefault={orgItems === null}
        />
      </div>
```
(An org whose stored template became invalid shows the standard programme with `updatedAt` of the stored row, so saving overwrites it rather than conflicting.)

- [ ] **Step 7: Run — expect PASS**

```bash
pnpm --filter web exec vitest run src/lib/solar/schedule/template-editor.test.ts src/actions/solar-schedule-template.actions.test.ts "src/app/(admin)/settings/solar"
```
Expected: PASS (existing `SolarSettingsForm.test.tsx` included).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/solar/schedule/inputs.ts apps/web/src/lib/solar/schedule/template-editor.ts apps/web/src/lib/solar/schedule/template-editor.test.ts \
  apps/web/src/actions/solar-schedule-template.actions.ts apps/web/src/actions/solar-schedule-template.actions.test.ts \
  "apps/web/src/app/(admin)/settings/solar/ScheduleTemplateEditor.tsx" "apps/web/src/app/(admin)/settings/solar/ScheduleTemplateEditor.test.tsx" \
  "apps/web/src/app/(admin)/settings/solar/page.tsx"
git commit -m "feat(solar-schedule): Use template (org template or the standard programme) + org template editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Import — parse route (CSV / XLSX / MS Project XML) and the commit action

**Files:**
- Create: `apps/web/src/lib/solar/schedule/read-xlsx.ts`, `read-xlsx.test.ts`
- Modify: `apps/web/src/lib/solar/schedule/inputs.ts` (add `ImportPlanSchema`)
- Create: `apps/web/src/app/api/projects/[id]/solar/schedule/import/parse/route.ts`, `route.test.ts`
- Create: `apps/web/src/actions/solar-schedule-import.actions.ts`, `solar-schedule-import.actions.test.ts`

Parsing is server-side (exceljs is ~1 MB and already a server dependency; WM parsed XLSX in the browser with a SheetJS build carrying two CVEs, as-is/06 B.5.1). The route returns either a `table` (CSV/XLSX: raw rows + a guessed mapping the dialog lets the user correct) or a `plan` (MS Project XML). The dialog builds the plan with `mapImportTable` for the preview; the **commit action re-validates** the plan (it is directly invocable) and the RPC re-validates again.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/solar/schedule/read-xlsx.test.ts`:
```ts
// @vitest-environment node
process.env.TZ = 'Africa/Johannesburg'
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { readXlsxTable } from './read-xlsx'

async function book(fill: (ws: ExcelJS.Worksheet) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  fill(wb.addWorksheet('Tasks'))
  return Buffer.from(await wb.xlsx.writeBuffer())
}

describe('readXlsxTable', () => {
  it('reads strings, numbers, real date cells (no SAST drift), rich text, formulas and blanks', async () => {
    const buf = await book((ws) => {
      ws.addRow(['Task', 'Start', 'Progress', 'Notes'])
      ws.addRow(['Design', new Date(Date.UTC(2026, 9, 1)), 0.5, { richText: [{ text: 'Rich ' }, { text: 'text' }] }])
      ws.addRow(['Install', '2026-10-06', { formula: '1+1', result: 2 }, null])
      ws.addRow([])
    })
    expect(await readXlsxTable(buf)).toEqual([
      ['Task', 'Start', 'Progress', 'Notes'],
      ['Design', '2026-10-01', '0.5', 'Rich text'],
      ['Install', '2026-10-06', '2', ''],
    ])
  })
  it('an empty workbook is an empty table', async () => {
    expect(await readXlsxTable(await book(() => {}))).toEqual([])
  })
})
```

`apps/web/src/app/api/projects/[id]/solar/schedule/import/parse/route.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), level: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ getSolarAccessLevel: h.level }))

import { POST } from './route'

const P = '11111111-1111-4111-8111-111111111111'
const req = (file: File | null) => {
  const fd = new FormData()
  if (file) fd.append('file', file)
  return new Request(`http://x/api/projects/${P}/solar/schedule/import/parse`, { method: 'POST', body: fd })
}
const ctx = { params: Promise.resolve({ id: P }) }

beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } })
  h.level.mockResolvedValue('edit')
})

describe('POST import/parse', () => {
  it('needs Edit (route handlers sit outside the gated layout)', async () => {
    h.level.mockResolvedValue('view')
    const res = await POST(req(new File(['Task,Start\nA,2026-10-01'], 'p.csv')) as never, ctx)
    expect(res.status).toBe(403)
  })
  it('401 when signed out', async () => {
    h.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } })
    expect((await POST(req(null) as never, ctx)).status).toBe(401)
  })
  it('CSV → table + guessed mapping', async () => {
    const res = await POST(req(new File(['Task,Start,End\nA,2026-10-01,2026-10-02'], 'p.csv')) as never, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('table')
    expect(body.rows).toEqual([['Task', 'Start', 'End'], ['A', '2026-10-01', '2026-10-02']])
    expect(body.mapping).toMatchObject({ name: 0, start: 1, end: 2 })
  })
  it('MS Project XML → a plan with issues', async () => {
    const xml = '<Project xmlns="http://schemas.microsoft.com/project"><Tasks><Task><UID>1</UID><Name>A</Name><OutlineLevel>1</OutlineLevel><Start>2026-10-01T08:00:00</Start><Finish>2026-10-02T17:00:00</Finish></Task></Tasks></Project>'
    const body = await (await POST(req(new File([xml], 'p.xml')) as never, ctx)).json()
    expect(body.kind).toBe('plan')
    expect(body.plan.tasks[0]).toMatchObject({ key: 'uid:1', name: 'A', start: '2026-10-01', end: '2026-10-02' })
    expect(body.issues).toEqual([])
  })
  it('refuses other formats, empty files and oversize files with sentences', async () => {
    expect((await (await POST(req(new File(['x'], 'p.xls')) as never, ctx)).json()).error)
      .toBe('Use a .csv, .xlsx or Microsoft Project .xml file. Save older .xls files as .xlsx first.')
    expect((await (await POST(req(new File(['Task,Start'], 'p.csv')) as never, ctx)).json()).error).toBe('The file has no tasks under its header row.')
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'p.csv')
    expect((await POST(req(big) as never, ctx)).status).toBe(413)
  })
})
```

`apps/web/src/actions/solar-schedule-import.actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))

import { commitScheduleImportAction } from './solar-schedule-import.actions'
import { fakeSupabase, type FakeOptions } from '@/test/fake-supabase'
import type { ImportPlan } from '@esite/shared'

const P = '11111111-1111-4111-8111-111111111111'
const plan: ImportPlan = {
  tasks: [
    { key: 'p1', sourceRow: 2, name: 'Design', category: 'Design', zone: '', start: '2026-10-01', end: '2026-10-05', isMilestone: false, progress: 0, status: 'not_started', colour: null, ownerHint: 'ann@x.co.za', description: '', segments: [] },
    { key: 'p2', sourceRow: 3, name: 'Install', category: '', zone: '', start: '2026-10-06', end: '2026-10-08', isMilestone: false, progress: 0, status: 'not_started', colour: null, ownerHint: 'Nobody Known', description: '', segments: [] },
  ],
  links: [{ fromKey: 'p1', toKey: 'p2', type: 'FS', lagDays: 0 }],
}
function setup(extra: Partial<FakeOptions> = {}) {
  const fake = fakeSupabase({
    userId: 'u1',
    rpc: {
      'solar.schedule_owner_candidates': { data: [{ user_id: 'u9', full_name: 'Ann Smith', email: 'ann@x.co.za' }], error: null },
      'solar.schedule_create_tasks': { data: { p1: 't1', p2: 't2' }, error: null },
    },
    ...extra,
  })
  h.createClient.mockResolvedValue(fake.client)
  return fake
}
beforeEach(() => {
  vi.clearAllMocks()
  h.requireSolarLevel.mockResolvedValue('edit')
})

describe('commitScheduleImportAction', () => {
  it('resolves owners, commits in ONE call with the replace flag, reports unmatched owners', async () => {
    const { rpcCalls } = setup()
    await expect(commitScheduleImportAction({ projectId: P, mode: 'replace', plan }))
      .resolves.toEqual({ ok: true, created: 2, unmatchedOwners: ['Nobody Known'] })
    const create = rpcCalls.find((c) => c.name === 'solar.schedule_create_tasks')!
    expect(create.args.p_replace).toBe(true)
    expect((create.args.p_tasks as Array<{ owner_id: string | null }>).map((t) => t.owner_id)).toEqual(['u9', null])
    expect(create.args.p_links).toEqual([{ from: 'p1', to: 'p2', type: 'FS', lag: 0 }])
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'schedule_imported', objectRef: { count: 2, mode: 'replace' } })
  })
  it('re-validates: a loop is refused before anything is written', async () => {
    const { rpcCalls } = setup()
    const loop = { ...plan, links: [...plan.links, { fromKey: 'p2', toKey: 'p1', type: 'FS' as const, lagDays: 0 }] }
    const res = await commitScheduleImportAction({ projectId: P, mode: 'append', plan: loop })
    // Same rule as Part 2's test: the loop is reported in link direction from the node the walk closes on.
    expect(res).toEqual({ error: 'These tasks depend on each other in a loop: Install → Design → Install.' })
    expect(rpcCalls.filter((c) => c.name === 'solar.schedule_create_tasks')).toHaveLength(0)
  })
  it('refuses a malformed plan and an unknown mode', async () => {
    setup()
    await expect(commitScheduleImportAction({ projectId: P, mode: 'append', plan: { tasks: [{}] } as never }))
      .resolves.toEqual({ error: 'The import could not be read. Start the import again.' })
    await expect(commitScheduleImportAction({ projectId: P, mode: 'merge' as never, plan }))
      .resolves.toEqual({ error: 'Choose whether to add to the programme or replace it.' })
  })
})
```

(Derivation of the loop sentence: links `p1→p2` and `p2→p1`; `topoOrder(['p1','p2'])` leaves both, walks back from `p1` to its predecessor `p2`, then to `p1` again: `seen = [p1, p2]`, reversed `[p2, p1]`, closed → "Install → Design → Install".)

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter web exec vitest run src/lib/solar/schedule/read-xlsx.test.ts "src/app/api/projects/[id]/solar/schedule/import/parse/route.test.ts" src/actions/solar-schedule-import.actions.test.ts
```
Expected: FAIL — unresolved modules.

- [ ] **Step 3: Implement `read-xlsx.ts`**

`apps/web/src/lib/solar/schedule/read-xlsx.ts`:
```ts
/**
 * First worksheet of an .xlsx → rows of strings. exceljs gives date cells as
 * UTC-midnight Dates, read with calendarDateFromUtc (never local getters, which
 * would move a date in SAST). Formulas read their cached result.
 */
import ExcelJS from 'exceljs'
import { calendarDateFromUtc } from '@esite/shared'

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return calendarDateFromUtc(v)
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'boolean') return v ? 'yes' : ''
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('').trim()
    if ('formula' in v || 'sharedFormula' in v) return cellText((v as { result?: ExcelJS.CellValue }).result ?? null)
    if ('text' in v && typeof (v as { text?: unknown }).text === 'string') return String((v as { text: string }).text).trim()
    if ('error' in v) return ''
  }
  return String(v)
}

export async function readXlsxTable(buf: Buffer, maxRows = 2002): Promise<string[][]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ArrayBuffer)
  const ws = wb.worksheets[0]
  if (!ws) return []
  const width = ws.columnCount
  const rows: string[][] = []
  for (let r = 1; r <= Math.min(ws.rowCount, maxRows); r++) {
    const row = ws.getRow(r)
    const out: string[] = []
    for (let c = 1; c <= width; c++) out.push(cellText(row.getCell(c).value))
    rows.push(out)
  }
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop()
  return rows
}
```

- [ ] **Step 4: Add `ImportPlanSchema` to `inputs.ts`**

Append to `apps/web/src/lib/solar/schedule/inputs.ts`:
```ts
export const ImportPlanSchema = z.object({
  tasks: z.array(z.object({
    key: z.string().min(1).max(64),
    sourceRow: z.number().int().nullable(),
    name: z.string().max(300),
    category: z.string().max(120),
    zone: z.string().max(120),
    start: z.string(),
    end: z.string(),
    isMilestone: z.boolean(),
    progress: z.number(),
    status: z.enum(GANTT_STATUSES),
    colour: z.string().nullable(),
    ownerHint: z.string().max(200).nullable(),
    description: z.string().max(4000),
    segments: z.array(z.object({ start: z.string(), end: z.string() })).max(50),
  })).max(2000),
  links: z.array(z.object({
    fromKey: z.string().min(1), toKey: z.string().min(1), type: z.enum(LINK_TYPES), lagDays: z.number().int(),
  })).max(10000),
})
```

- [ ] **Step 5: Implement the route**

`apps/web/src/app/api/projects/[id]/solar/schedule/import/parse/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getSolarAccessLevel } from '@/lib/solar/access'
import { readXlsxTable } from '@/lib/solar/schedule/read-xlsx'
import {
  guessImportMapping, isMsProjectXml, parseCsvText, parseMsProjectXml, solarLevelAllows, validateImportPlan,
} from '@esite/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 5 * 1024 * 1024
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/**
 * POST /api/projects/[id]/solar/schedule/import/parse — reads an uploaded
 * programme and returns it for the Import dialog's mapping and preview.
 * Writes nothing. Outside (admin)/layout.tsx, so it gates itself: Edit level.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) return bad('Invalid project')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return bad('Not authenticated', 401)
  const level = await getSolarAccessLevel(id, supabase as never)
  if (!solarLevelAllows(level, 'edit')) return bad('You need Edit access to Solar on this project to import a programme.', 403)

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return bad('Choose a file to import.')
  if (file.size > MAX_BYTES) return bad('That file is larger than 5 MB.', 413)
  const name = file.name.toLowerCase()
  try {
    if (name.endsWith('.xml')) {
      const text = await file.text()
      if (!isMsProjectXml(text)) return bad('That XML file is not a Microsoft Project file. In Project, use Save As → XML.')
      const { plan, issues } = parseMsProjectXml(text)
      return NextResponse.json({ kind: 'plan', plan, issues: [...issues, ...validateImportPlan(plan)] })
    }
    let rows: string[][]
    if (name.endsWith('.csv')) rows = parseCsvText(await file.text())
    else if (name.endsWith('.xlsx')) rows = await readXlsxTable(Buffer.from(await file.arrayBuffer()))
    else return bad('Use a .csv, .xlsx or Microsoft Project .xml file. Save older .xls files as .xlsx first.')
    if (rows.length < 2) return bad('The file has no tasks under its header row.')
    if (rows.length > 2001) return bad('At most 2,000 tasks can be imported at once.')
    return NextResponse.json({ kind: 'table', rows, mapping: guessImportMapping(rows[0]) })
  } catch (err) {
    console.error('[solar-schedule-import] parse failed', { project: id, err: String(err) })
    return bad('That file could not be read. Check it opens in Excel and try again.')
  }
}
```

- [ ] **Step 6: Implement the commit action**

`apps/web/src/actions/solar-schedule-import.actions.ts`:
```ts
'use server'
/**
 * Commit an import (spec §14.1). Re-validates the plan (dates, loops, sizes),
 * resolves owners to active members (email, then unique name), and writes
 * everything — including "replace" — in ONE RPC transaction.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { humanScheduleError } from '@/lib/solar/schedule/errors'
import { ImportPlanSchema, planToInputs, resolveOwnerHints, toRpcTask } from '@/lib/solar/schedule/inputs'
import { validateImportPlan, type ImportPlan } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export async function commitScheduleImportAction(input: {
  projectId: string
  mode: 'append' | 'replace'
  plan: ImportPlan
}): Promise<{ ok: true; created: number; unmatchedOwners: string[] } | { error: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(input.projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  if (input.mode !== 'append' && input.mode !== 'replace') return { error: 'Choose whether to add to the programme or replace it.' }
  const parsed = ImportPlanSchema.safeParse(input.plan)
  if (!parsed.success) return { error: 'The import could not be read. Start the import again.' }
  const plan = parsed.data as ImportPlan
  const issues = validateImportPlan(plan)
  if (issues.length) return { error: issues[0].message }

  const { data: ownerRows, error: ownerErr } = await supabase.schema('solar').rpc('schedule_owner_candidates', { p_project_id: input.projectId })
  if (ownerErr) return { error: humanScheduleError(ownerErr) }
  const owners = ((ownerRows ?? []) as Array<{ user_id: string; full_name: string | null; email: string | null }>)
    .map((o) => ({ id: o.user_id, name: o.full_name ?? '', email: o.email ?? '' }))
  const { ids, unmatched } = resolveOwnerHints(plan.tasks.map((t) => t.ownerHint), owners)
  const { tasks, links } = planToInputs(plan, (i) => ids[i])

  const { error } = await supabase.schema('solar').rpc('schedule_create_tasks', {
    p_project_id: input.projectId,
    p_tasks: tasks.map(toRpcTask),
    p_links: links.map((l) => ({ from: l.from, to: l.to, type: l.type, lag: l.lagDays })),
    p_replace: input.mode === 'replace',
  })
  if (error) return { error: humanScheduleError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: user.id, verb: 'schedule_imported', objectRef: { count: tasks.length, mode: input.mode } })
  return { ok: true, created: tasks.length, unmatchedOwners: unmatched }
}
```

- [ ] **Step 7: Run — expect PASS**

```bash
pnpm --filter web exec vitest run src/lib/solar/schedule/read-xlsx.test.ts "src/app/api/projects/[id]/solar/schedule/import/parse/route.test.ts" src/actions/solar-schedule-import.actions.test.ts
```
Expected: PASS. If the read-xlsx date test yields `2026-09-30`, a local getter slipped in — fix `cellText`, never the test.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/solar/schedule/read-xlsx.ts apps/web/src/lib/solar/schedule/read-xlsx.test.ts apps/web/src/lib/solar/schedule/inputs.ts \
  "apps/web/src/app/api/projects/[id]/solar/schedule/import/parse" apps/web/src/actions/solar-schedule-import.actions.ts apps/web/src/actions/solar-schedule-import.actions.test.ts
git commit -m "feat(solar-schedule): import — server-side CSV/XLSX/MS Project parse, re-validated one-transaction commit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Exports — Excel (round-trippable), calendar (.ics), PDF (A3 landscape, server-rendered)

**Files:**
- Create: `apps/web/src/lib/solar/schedule/work-calendar.ts`, `work-calendar.test.ts`
- Create: `apps/web/src/lib/solar/schedule/export-xlsx.ts`, `export-xlsx.test.ts`
- Create: `apps/web/src/lib/solar/schedule/schedule-pdf.tsx`, `render-schedule-pdf.ts`, `schedule-pdf.test.ts`
- Create: `apps/web/src/app/api/projects/[id]/solar/schedule/export/[format]/route.ts`, `route.test.ts`

PNG is exported in the browser from the Konva stage (Part 5, Task 28). The rest are server-rendered here from the same loader, at View level ("Export — tech-read" in spec §14.1). The XLSX is written with the import's own column names and `#` numbering so **export → import round-trips** (WM's did not, as-is/06 B.5.2). Dates are written as `YYYY-MM-DD` text, not Excel date serials, so no reader can shift them.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/solar/schedule/work-calendar.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { scheduleCalendar } from './work-calendar'

describe('scheduleCalendar', () => {
  it('uses the settings mode and covers the years the schedule spans, plus one each side', () => {
    const cal = scheduleCalendar('working', ['2026-12-20', '2027-01-10'], '2026-09-28')
    expect(cal.mode).toBe('working')
    expect(cal.holidays.has('2025-12-25')).toBe(true)
    expect(cal.holidays.has('2028-01-01')).toBe(true)
  })
})
```

`apps/web/src/lib/solar/schedule/export-xlsx.test.ts`:
```ts
// @vitest-environment node
process.env.TZ = 'Africa/Johannesburg'
import { describe, it, expect } from 'vitest'
import { exportScheduleXlsx } from './export-xlsx'
import { readXlsxTable } from './read-xlsx'
import { guessImportMapping, mapImportTable, makeWorkCalendar, type ScheduleTaskView } from '@esite/shared'
import type { ScheduleData } from './types'

const t = (id: string, over: Partial<ScheduleTaskView>): ScheduleTaskView => ({
  id, workItemId: `w${id}`, ref: `SOLAR-${id}`, name: `Task ${id}`, category: 'Design', zone: '', start: '2026-10-01', end: '2026-10-02',
  isMilestone: false, status: 'not_started', awaitingSignOff: false, progress: 0, colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann Smith',
  sortOrder: Number(id), description: '', updatedAt: 'U', segments: [], ...over,
})
const data: ScheduleData = {
  projectId: 'p', projectName: 'KINGSWALK', canEdit: true, currentUserId: 'u1', today: '2026-09-28',
  tasks: [
    t('1', { name: 'Design, roof A', start: '2026-10-01', end: '2026-10-05', status: 'done', progress: 100 }),
    t('2', { name: 'Install', category: 'Installation', zone: 'Roof A', start: '2026-10-06', end: '2026-10-08', status: 'in_progress', progress: 40 }),
    t('3', { name: 'Go live', category: 'Handover', start: '2026-10-12', end: '2026-10-12', isMilestone: true }),
  ],
  links: [{ id: 'd1', predecessorId: '1', successorId: '2', type: 'FS', lagDays: 0 }, { id: 'd2', predecessorId: '2', successorId: '3', type: 'SS', lagDays: 2 }],
  owners: [], baselines: [], presets: [], settings: { durationMode: 'calendar', workloadThreshold: 2, updatedAt: null },
}

describe('exportScheduleXlsx', () => {
  it('round-trips through the importer: names, dates, status, milestones and links survive', async () => {
    const cal = makeWorkCalendar('calendar')
    const rows = await readXlsxTable(await exportScheduleXlsx(data, cal))
    expect(rows[0].slice(0, 14)).toEqual(['#', 'Task', 'Category', 'Zone', 'Start', 'End', 'Duration', 'Owner', 'Progress', 'Status', 'Milestone', 'Predecessors', 'Notes', 'Colour'])
    const { plan, issues } = mapImportTable(rows, guessImportMapping(rows[0]), cal)
    expect(issues).toEqual([])
    expect(plan.tasks.map((x) => [x.name, x.start, x.end, x.status, x.isMilestone, x.category, x.zone])).toEqual(
      data.tasks.map((x) => [x.name, x.start, x.end, x.status, x.isMilestone, x.category, x.zone]))
    expect(plan.links).toEqual([
      { fromKey: 'p1', toKey: 'p2', type: 'FS', lagDays: 0 },
      { fromKey: 'p2', toKey: 'p3', type: 'SS', lagDays: 2 },
    ])
  })
  it('marks the critical path and the float', async () => {
    const rows = await readXlsxTable(await exportScheduleXlsx(data, makeWorkCalendar('calendar')))
    const critical = rows[0].indexOf('Critical')
    const float = rows[0].indexOf('Float (days)')
    // SS+2 from Install lets Go live start 10-08 at the earliest; it is planned 10-12 and ends the
    // programme, so Go live is critical and Design/Install carry 3 days of float (units: F1=5, F2=8, S3=11).
    expect(rows.slice(1).map((r) => r[critical])).toEqual(['', '', 'Yes'])
    expect(rows.slice(1).map((r) => r[float])).toEqual(['3', '3', '0'])
  })
})
```

`apps/web/src/lib/solar/schedule/schedule-pdf.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildSchedulePdfModel, PDF_ROWS_PER_PAGE, PDF_TIMELINE_WIDTH } from './schedule-pdf'
import { renderSchedulePdf } from './render-schedule-pdf'
import { isWinAnsiSafe } from '@/lib/pdf/winansi'
import { makeWorkCalendar, type ScheduleTaskView } from '@esite/shared'
import type { ScheduleData } from './types'

const task = (i: number, over: Partial<ScheduleTaskView> = {}): ScheduleTaskView => ({
  id: `t${i}`, workItemId: `w${i}`, ref: `SOLAR-${i}`, name: `Task ${i}`, category: i % 2 ? 'Design' : 'Installation', zone: '',
  start: '2026-10-01', end: '2026-10-03', isMilestone: false, status: 'not_started', awaitingSignOff: false, progress: 0,
  colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann', sortOrder: i, description: '', updatedAt: 'U', segments: [], ...over,
})
const data = (tasks: ScheduleTaskView[]): ScheduleData => ({
  projectId: 'p', projectName: 'KINGSWALK ✓ Ω', canEdit: true, currentUserId: 'u1', today: '2026-09-28', tasks, links: [],
  owners: [], baselines: [], presets: [], settings: { durationMode: 'calendar', workloadThreshold: 2, updatedAt: null },
})

describe('buildSchedulePdfModel', () => {
  it('paginates, sanitises every string for WinAnsi, and keeps bars inside the timeline', () => {
    const tasks = Array.from({ length: 100 }, (_, i) => task(i + 1, { name: `Ω test ≤ ${i}`, end: `2026-10-${String((i % 20) + 3).padStart(2, '0')}` }))
    const m = buildSchedulePdfModel(data(tasks), makeWorkCalendar('calendar'), '2026-09-28')
    const rowCount = m.pages.reduce((n, p) => n + p.rows.length, 0)
    expect(rowCount).toBe(102) // 100 tasks + 2 category headers
    expect(m.pages).toHaveLength(Math.ceil(102 / PDF_ROWS_PER_PAGE))
    const strings = [m.title, m.subtitle, ...m.pages.flatMap((p) => [...p.ticks.map((x) => x.label), ...p.rows.flatMap((r) => [r.label, r.ref, r.owner, r.start, r.end, r.days])])]
    for (const s of strings) expect(isWinAnsiSafe(s), s).toBe(true)
    for (const r of m.pages.flatMap((p) => p.rows)) {
      expect(r.barX).toBeGreaterThanOrEqual(0)
      expect(r.barX + r.barW).toBeLessThanOrEqual(PDF_TIMELINE_WIDTH + 0.001)
    }
  })
})

describe('renderSchedulePdf', () => {
  it('renders A3 landscape pages', async () => {
    const d = data(Array.from({ length: 45 }, (_, i) => task(i + 1)))
    const buf = await renderSchedulePdf(d, makeWorkCalendar('calendar'), '2026-09-28')
    const pdf = await PDFDocument.load(buf)
    expect(pdf.getPageCount()).toBe(2)
    const { width, height } = pdf.getPage(0).getSize()
    expect(Math.round(width)).toBe(1191)
    expect(Math.round(height)).toBe(842)
  }, 30_000)
})
```

`apps/web/src/app/api/projects/[id]/solar/schedule/export/[format]/route.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ createClient: vi.fn(), level: vi.fn(), load: vi.fn(), pdf: vi.fn(), docx: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ getSolarAccessLevel: h.level }))
vi.mock('@/lib/solar/schedule/loader', () => ({ loadScheduleData: h.load }))
vi.mock('@/lib/solar/schedule/render-schedule-pdf', () => ({ renderSchedulePdf: h.pdf }))
vi.mock('@/lib/solar/schedule/export-docx', () => ({ exportScheduleDocx: h.docx }))

import { GET } from './route'

const P = '11111111-1111-4111-8111-111111111111'
const call = (format: string) => GET(new Request('http://x') as never, { params: Promise.resolve({ id: P, format }) })
const data = {
  projectId: P, projectName: 'Kings Walk / Phase 2', canEdit: false, currentUserId: 'u1', today: '2026-09-28',
  tasks: [], links: [], owners: [], baselines: [], presets: [], settings: { durationMode: 'calendar', workloadThreshold: 2, updatedAt: null },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } })
  h.level.mockResolvedValue('view')
  h.load.mockResolvedValue(data)
  h.pdf.mockResolvedValue(Buffer.from('%PDF-1.7'))
  h.docx.mockResolvedValue(Buffer.from('PK'))
})

describe('GET schedule export', () => {
  it('View level may export; no level → 403', async () => {
    expect((await call('ics')).status).toBe(200)
    h.level.mockResolvedValue(null)
    expect((await call('ics')).status).toBe(403)
  })
  it.each([
    ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'kings-walk-phase-2-programme.xlsx'],
    ['ics', 'text/calendar; charset=utf-8', 'kings-walk-phase-2-programme.ics'],
    ['pdf', 'application/pdf', 'kings-walk-phase-2-programme.pdf'],
    ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'kings-walk-phase-2-programme.docx'],
  ])('%s → content type and a safe filename', async (format, type, file) => {
    const res = await call(format)
    expect(res.headers.get('Content-Type')).toBe(type)
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="${file}"`)
  })
  it('an unknown format is 404', async () => {
    expect((await call('png')).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter web exec vitest run src/lib/solar/schedule/work-calendar.test.ts src/lib/solar/schedule/export-xlsx.test.ts src/lib/solar/schedule/schedule-pdf.test.ts "src/app/api/projects/[id]/solar/schedule/export"
```
Expected: FAIL — unresolved modules.

- [ ] **Step 3: Implement `work-calendar.ts`**

`apps/web/src/lib/solar/schedule/work-calendar.ts`:
```ts
/** The WorkCalendar a schedule is measured in: its mode + SA holidays for every year it touches (±1). Client-safe. */
import { makeWorkCalendar, saHolidaySet, type CalendarDate, type DurationMode, type WorkCalendar } from '@esite/shared'

export function scheduleCalendar(mode: DurationMode, dates: readonly CalendarDate[], today: CalendarDate): WorkCalendar {
  const years = [...dates, today].map((d) => Number(d.slice(0, 4)))
  return makeWorkCalendar(mode, saHolidaySet(Math.min(...years) - 1, Math.max(...years) + 1))
}
```

- [ ] **Step 4: Implement `export-xlsx.ts`**

`apps/web/src/lib/solar/schedule/export-xlsx.ts`:
```ts
/**
 * Schedule → .xlsx using the IMPORT's column names and `#` numbering, so the
 * file can be edited and imported back (WM's export was not round-trippable).
 * Dates are written as YYYY-MM-DD text — no Excel serial, no time zone.
 */
import ExcelJS from 'exceljs'
import { GANTT_STATUS_LABELS, criticalPath, spanDays, type WorkCalendar } from '@esite/shared'
import type { ScheduleData } from './types'

export const XLSX_HEADERS = [
  '#', 'Task', 'Category', 'Zone', 'Start', 'End', 'Duration', 'Owner', 'Progress', 'Status', 'Milestone',
  'Predecessors', 'Notes', 'Colour', 'Ref', 'Critical', 'Float (days)',
] as const

export async function exportScheduleXlsx(data: ScheduleData, cal: WorkCalendar): Promise<Buffer> {
  const tasks = [...data.tasks].sort((a, b) => a.sortOrder - b.sortOrder)
  const pos = new Map(tasks.map((t, i) => [t.id, i + 1]))
  const cpm = criticalPath(tasks, data.links, cal)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'E-Site'
  const ws = wb.addWorksheet('Tasks', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.addRow([...XLSX_HEADERS])
  ws.getRow(1).font = { bold: true }
  for (const t of tasks) {
    const preds = data.links.filter((l) => l.successorId === t.id && pos.has(l.predecessorId))
      .map((l) => `${pos.get(l.predecessorId)}${l.type}${l.lagDays > 0 ? `+${l.lagDays}d` : l.lagDays < 0 ? `${l.lagDays}d` : ''}`)
      .join(', ')
    ws.addRow([
      pos.get(t.id), t.name, t.category, t.zone, t.start, t.end,
      t.isMilestone ? 0 : spanDays(cal, t.start, t.end), t.ownerName, t.progress,
      GANTT_STATUS_LABELS[t.status], t.isMilestone ? 'Yes' : '', preds, t.description, t.colour, t.ref,
      cpm.ok && cpm.critical.has(t.id) ? 'Yes' : '', cpm.ok ? cpm.totalFloat.get(t.id) ?? '' : '',
    ])
  }
  ws.columns.forEach((c, i) => { c.width = [5, 40, 18, 14, 12, 12, 9, 22, 9, 13, 10, 18, 30, 9, 11, 9, 11][i] ?? 12 })
  return Buffer.from(await wb.xlsx.writeBuffer())
}
```

Round-trip check against the importer: `Progress` is written as a number (`40` → `'40'` → 40); `Duration` `0` for a milestone plus `Milestone = Yes`; the importer ignores `Ref`, `Critical`, `Float (days)` and `#` (no synonym). `Owner` is the display name; on import it resolves to a member by unique name (open question 5).

- [ ] **Step 5: Implement the PDF model and document**

`apps/web/src/lib/solar/schedule/schedule-pdf.tsx`:
```tsx
/**
 * A3 landscape programme PDF (spec §14.1 "PDF (A3 landscape, server-rendered)").
 * The MODEL is pure and tested; every string goes through winAnsiSafe because
 * react-pdf's standard fonts silently draw the wrong glyph otherwise (Ω → ©,
 * ≤ → d — CLAUDE.md 2026-08-13). Rows are grouped by category; the timeline is
 * scaled to fit one page width; critical tasks are drawn red.
 */
import React from 'react'
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import {
  GANTT_STATUS_LABELS, addCalendarDays, buildScheduleRows, criticalPath, daysBetween, formatCalendarDate, maxCalendarDate,
  minCalendarDate, spanDays, weekdayOf, type CalendarDate, type WorkCalendar,
} from '@esite/shared'
import { winAnsiSafe } from '@/lib/pdf/winansi'
import type { ScheduleData } from './types'

export const PDF_ROWS_PER_PAGE = 40
export const PDF_TIMELINE_WIDTH = 660

export interface SchedulePdfRow {
  kind: 'task' | 'group'
  label: string
  ref: string
  owner: string
  start: string
  end: string
  days: string
  barX: number
  barW: number
  isMilestone: boolean
  critical: boolean
  colour: string
  progress: number
}
export interface SchedulePdfPage { rows: SchedulePdfRow[]; ticks: Array<{ x: number; label: string }> }
export interface SchedulePdfModel { title: string; subtitle: string; pages: SchedulePdfPage[] }

const safe = (s: string) => winAnsiSafe(s)

export function buildSchedulePdfModel(data: ScheduleData, cal: WorkCalendar, generatedOn: CalendarDate): SchedulePdfModel {
  const rows = buildScheduleRows(data.tasks, 'category', new Set())
  const cpm = criticalPath(data.tasks, data.links, cal)
  const lo = minCalendarDate(data.tasks.map((t) => t.start)) ?? generatedOn
  const hi = maxCalendarDate(data.tasks.map((t) => t.end)) ?? addCalendarDays(generatedOn, 30)
  const days = daysBetween(lo, hi) + 1
  const px = PDF_TIMELINE_WIDTH / days
  const ticks: Array<{ x: number; label: string }> = []
  for (let d = lo; d <= hi; d = addCalendarDays(d, 1)) {
    const monthStart = d.endsWith('-01')
    if (days > 62 ? monthStart : weekdayOf(d) === 1) {
      const [, mon, yr] = formatCalendarDate(d).split(' ')
      ticks.push({ x: daysBetween(lo, d) * px, label: safe(days > 62 ? `${mon} ${yr}` : formatCalendarDate(d).split(' ').slice(0, 2).join(' ')) })
    }
  }
  const out: SchedulePdfRow[] = rows.map((r) => {
    if (r.kind === 'group') {
      return { kind: 'group', label: safe(`${r.label} (${r.count})`), ref: '', owner: '', start: '', end: '', days: '', barX: 0, barW: 0, isMilestone: false, critical: false, colour: '#000000', progress: 0 }
    }
    const t = r.task
    const x = daysBetween(lo, t.start) * px
    return {
      kind: 'task', label: safe(t.name), ref: safe(t.ref), owner: safe(t.ownerName),
      start: safe(formatCalendarDate(t.start)), end: safe(formatCalendarDate(t.end)),
      days: t.isMilestone ? safe('Milestone') : String(spanDays(cal, t.start, t.end)),
      barX: x, barW: t.isMilestone ? 0 : Math.min(PDF_TIMELINE_WIDTH - x, (daysBetween(t.start, t.end) + 1) * px),
      isMilestone: t.isMilestone, critical: cpm.ok && cpm.critical.has(t.id), colour: t.colour,
      progress: t.status === 'done' ? 100 : t.progress,
    }
  })
  const pages: SchedulePdfPage[] = []
  for (let i = 0; i < out.length; i += PDF_ROWS_PER_PAGE) pages.push({ rows: out.slice(i, i + PDF_ROWS_PER_PAGE), ticks })
  if (pages.length === 0) pages.push({ rows: [], ticks })
  const mode = data.settings.durationMode === 'working' ? 'working days (weekends and SA public holidays excluded)' : 'calendar days'
  return {
    title: safe(`${data.projectName} — Solar programme`),
    subtitle: safe(`Generated ${formatCalendarDate(generatedOn)} · durations in ${mode} · critical path in red · ${data.tasks.length} tasks · statuses: ${Object.values(GANTT_STATUS_LABELS).join(', ')}`),
    pages,
  }
}

const s = StyleSheet.create({
  page: { padding: 30, fontSize: 7, fontFamily: 'Helvetica' },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  subtitle: { fontSize: 8, color: '#555555', marginBottom: 8 },
  head: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#999999', paddingBottom: 2, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', height: 16, alignItems: 'center', borderBottomWidth: 0.25, borderColor: '#dddddd' },
  group: { fontFamily: 'Helvetica-Bold', backgroundColor: '#f3f4f6' },
  timeline: { width: PDF_TIMELINE_WIDTH, height: 16, position: 'relative', marginLeft: 10 },
  footer: { position: 'absolute', bottom: 14, left: 30, right: 30, fontSize: 7, color: '#777777', textAlign: 'right' },
})
const COLS = [['Ref', 55], ['Task', 190], ['Owner', 95], ['Start', 55], ['End', 55]] as const

export function SchedulePdfDocument({ model }: { model: SchedulePdfModel }) {
  return (
    <Document title={model.title}>
      {model.pages.map((p, pi) => (
        <Page key={pi} size="A3" orientation="landscape" style={s.page}>
          <Text style={s.title}>{model.title}</Text>
          <Text style={s.subtitle}>{model.subtitle}</Text>
          <View style={s.head}>
            {COLS.map(([h, w]) => <Text key={h} style={{ width: w }}>{h}</Text>)}
            <View style={s.timeline}>
              {p.ticks.map((t) => <Text key={`${t.x}`} style={{ position: 'absolute', left: t.x, top: 4 }}>{t.label}</Text>)}
            </View>
          </View>
          {p.rows.map((r, ri) => (
            <View key={ri} style={r.kind === 'group' ? [s.row, s.group] : s.row}>
              <Text style={{ width: COLS[0][1] }}>{r.ref}</Text>
              <Text style={{ width: COLS[1][1] }}>{r.label}</Text>
              <Text style={{ width: COLS[2][1] }}>{r.owner}</Text>
              <Text style={{ width: COLS[3][1] }}>{r.start}</Text>
              <Text style={{ width: COLS[4][1] }}>{r.end}</Text>
              <View style={s.timeline}>
                {r.kind === 'task' && !r.isMilestone && (
                  <View style={{ position: 'absolute', left: r.barX, top: 4, height: 8, width: Math.max(r.barW, 1.5), backgroundColor: r.critical ? '#dc2626' : r.colour }}>
                    <View style={{ height: 8, width: `${r.progress}%`, backgroundColor: '#00000033' }} />
                  </View>
                )}
                {r.kind === 'task' && r.isMilestone && (
                  <View style={{ position: 'absolute', left: r.barX - 3, top: 4, width: 7, height: 7, transform: 'rotate(45deg)', backgroundColor: r.critical ? '#dc2626' : '#111827' }} />
                )}
              </View>
            </View>
          ))}
          <Text style={s.footer} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} fixed />
        </Page>
      ))}
    </Document>
  )
}
```

`apps/web/src/lib/solar/schedule/render-schedule-pdf.ts`:
```ts
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import type { CalendarDate, WorkCalendar } from '@esite/shared'
import { SchedulePdfDocument, buildSchedulePdfModel } from './schedule-pdf'
import type { ScheduleData } from './types'

/** Node runtime only (renderToBuffer); tests need `// @vitest-environment node`. */
export async function renderSchedulePdf(data: ScheduleData, cal: WorkCalendar, generatedOn: CalendarDate): Promise<Buffer> {
  const element = React.createElement(SchedulePdfDocument, { model: buildSchedulePdfModel(data, cal, generatedOn) }) as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}
```

- [ ] **Step 6: Implement the export route**

`apps/web/src/app/api/projects/[id]/solar/schedule/export/[format]/route.ts`:
```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getSolarAccessLevel } from '@/lib/solar/access'
import { loadScheduleData } from '@/lib/solar/schedule/loader'
import { scheduleCalendar } from '@/lib/solar/schedule/work-calendar'
import { exportScheduleXlsx } from '@/lib/solar/schedule/export-xlsx'
import { renderSchedulePdf } from '@/lib/solar/schedule/render-schedule-pdf'
import { exportScheduleDocx } from '@/lib/solar/schedule/export-docx'
import { buildScheduleIcs, sastToday, solarLevelAllows } from '@esite/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TYPES: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ics: 'text/calendar; charset=utf-8',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'solar'

/**
 * GET /api/projects/[id]/solar/schedule/export/[format] — xlsx | ics | pdf | docx.
 * View level (spec §14.1 "Export — tech-read"). Outside (admin)/layout.tsx, so
 * it gates itself; reads through the caller's session (RLS decides the rows).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; format: string }> }) {
  const { id, format } = await params
  if (!TYPES[format]) return NextResponse.json({ error: 'Unknown export format' }, { status: 404 })
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid project' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const level = await getSolarAccessLevel(id, supabase as never)
  if (!solarLevelAllows(level, 'view') || !level) return NextResponse.json({ error: 'You do not have access to this schedule.' }, { status: 403 })

  const today = sastToday()
  const data = await loadScheduleData(id, supabase as never, level, today)
  const cal = scheduleCalendar(data.settings.durationMode, data.tasks.flatMap((t) => [t.start, t.end]), today)
  let body: Uint8Array | string
  try {
    if (format === 'xlsx') body = new Uint8Array(await exportScheduleXlsx(data, cal))
    else if (format === 'pdf') body = new Uint8Array(await renderSchedulePdf(data, cal, today))
    else if (format === 'docx') body = new Uint8Array(await exportScheduleDocx(data, cal, today))
    else body = buildScheduleIcs({
      calendarName: data.projectName, now: new Date(),
      tasks: data.tasks.map((t) => ({ id: t.id, ref: t.ref, name: t.name, start: t.start, end: t.end, isMilestone: t.isMilestone, description: t.description, status: t.status, ownerName: t.ownerName })),
    })
  } catch (err) {
    console.error('[solar-schedule-export] render failed', { project: id, format, err: String(err) })
    return NextResponse.json({ error: 'The export could not be produced. Try again.' }, { status: 500 })
  }
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': TYPES[format], 'Content-Disposition': `attachment; filename="${slug(data.projectName)}-programme.${format}"` },
  })
}
```

The route imports `export-docx` from Task 20. **If the owner declines DOCX (open question 7), delete the `docx` entry from `TYPES`, the import and its branch, and the `docx` row from the route test.** Otherwise do Task 20 before running this route's test.

- [ ] **Step 7: Run — expect PASS (after Task 20 exists)**

```bash
pnpm --filter web exec vitest run src/lib/solar/schedule/work-calendar.test.ts src/lib/solar/schedule/export-xlsx.test.ts src/lib/solar/schedule/schedule-pdf.test.ts "src/app/api/projects/[id]/solar/schedule/export"
```
Expected: PASS. The PDF render test may take several seconds (react-pdf layout).

- [ ] **Step 8: Commit (together with Task 20)**

---

### Task 20: Word export (`.docx`) — optional, separate on purpose

**Files:**
- Create: `apps/web/src/lib/solar/schedule/export-docx.ts`, `export-docx.test.ts`

**Why separate:** the repo has no free-form DOCX *generator*. `docxtemplater` (+ `pizzip`) is used for JBCC letters and needs a `.docx` template file; `mammoth` only reads. A template for a variable-length table would be a new binary asset to maintain. Instead, this task writes a minimal WordprocessingML package directly with `pizzip` (already a dependency, `packages/shared/src/lib/jbcc/docx-letterhead.ts`): 3 XML parts, landscape A4, one table, every value XML-escaped. That fixes WM's "Word" export, which was unescaped HTML saved as `.doc` (as-is/06 B.5.4). If the owner does not want Word at all (it duplicates the PDF and XLSX), skip this task and apply the note at the end of Task 19 Step 6.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/solar/schedule/export-docx.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import PizZip from 'pizzip'
import { exportScheduleDocx } from './export-docx'
import { makeWorkCalendar, type ScheduleTaskView } from '@esite/shared'
import type { ScheduleData } from './types'

const task: ScheduleTaskView = {
  id: 't1', workItemId: 'w1', ref: 'SOLAR-1', name: '<script>alert(1)</script> & “roof”', category: 'Design', zone: '',
  start: '2026-10-01', end: '2026-10-05', isMilestone: false, status: 'in_progress', awaitingSignOff: false, progress: 40,
  colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann Smith', sortOrder: 1, description: '', updatedAt: 'U', segments: [],
}
const data: ScheduleData = {
  projectId: 'p', projectName: 'KINGSWALK', canEdit: true, currentUserId: 'u1', today: '2026-09-28', tasks: [task], links: [],
  owners: [], baselines: [], presets: [], settings: { durationMode: 'calendar', workloadThreshold: 2, updatedAt: null },
}

describe('exportScheduleDocx', () => {
  it('is a real OOXML package with escaped values in a landscape table', async () => {
    const zip = new PizZip(await exportScheduleDocx(data, makeWorkCalendar('calendar'), '2026-09-28'))
    expect(zip.file('[Content_Types].xml')).toBeTruthy()
    expect(zip.file('_rels/.rels')).toBeTruthy()
    const doc = zip.file('word/document.xml')!.asText()
    expect(doc).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; “roof”')
    expect(doc).not.toContain('<script>')
    expect(doc).toContain('w:orient="landscape"')
    expect(doc).toContain('SOLAR-1')
    expect(doc).toContain('1 Oct 2026')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter web exec vitest run src/lib/solar/schedule/export-docx.test.ts`
Expected: FAIL — cannot resolve `./export-docx`.

- [ ] **Step 3: Implement**

`apps/web/src/lib/solar/schedule/export-docx.ts`:
```ts
/** Minimal WordprocessingML: title, one landscape table of tasks. Every value XML-escaped. */
import PizZip from 'pizzip'
import { GANTT_STATUS_LABELS, criticalPath, formatCalendarDate, spanDays, type CalendarDate, type WorkCalendar } from '@esite/shared'
import type { ScheduleData } from './types'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const run = (text: string, bold = false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
const para = (text: string, bold = false) => `<w:p>${run(text, bold)}</w:p>`
const cell = (text: string, bold = false) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(text, bold)}</w:tc>`
const row = (cells: string[], bold = false) => `<w:tr>${cells.map((c) => cell(c, bold)).join('')}</w:tr>`

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>'
const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>'

export async function exportScheduleDocx(data: ScheduleData, cal: WorkCalendar, generatedOn: CalendarDate): Promise<Buffer> {
  const tasks = [...data.tasks].sort((a, b) => a.sortOrder - b.sortOrder)
  const cpm = criticalPath(tasks, data.links, cal)
  const header = row(['Ref', 'Task', 'Category', 'Owner', 'Start', 'End', 'Days', 'Status', 'Progress', 'Critical'], true)
  const body = tasks.map((t) => row([
    t.ref, t.name, t.category, t.ownerName, formatCalendarDate(t.start), formatCalendarDate(t.end),
    t.isMilestone ? 'Milestone' : String(spanDays(cal, t.start, t.end)),
    `${GANTT_STATUS_LABELS[t.status]}${t.awaitingSignOff ? ' (awaiting sign-off)' : ''}`, `${t.status === 'done' ? 100 : t.progress}%`,
    cpm.ok && cpm.critical.has(t.id) ? 'Yes' : '',
  ])).join('')
  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + para(`${data.projectName} — Solar programme`, true)
    + para(`Generated ${formatCalendarDate(generatedOn)} · durations in ${data.settings.durationMode === 'working' ? 'working days' : 'calendar days'}`)
    + `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>`
    + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('')
    + `</w:tblBorders></w:tblPr>${header}${body}</w:tbl>`
    + '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>'
  const zip = new PizZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', RELS)
  zip.file('word/document.xml', doc)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}
```

- [ ] **Step 4: Run Tasks 19 + 20 — expect PASS**

```bash
pnpm --filter web exec vitest run src/lib/solar/schedule "src/app/api/projects/[id]/solar/schedule/export"
```
Expected: PASS. Then open one generated `.docx` in Word/LibreOffice by hand once (write it to `/tmp/probe.docx` from a scratch script) — the unit test proves the XML, not that Word opens it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/solar/schedule/work-calendar.ts apps/web/src/lib/solar/schedule/work-calendar.test.ts \
  apps/web/src/lib/solar/schedule/export-xlsx.ts apps/web/src/lib/solar/schedule/export-xlsx.test.ts \
  apps/web/src/lib/solar/schedule/schedule-pdf.tsx apps/web/src/lib/solar/schedule/render-schedule-pdf.ts apps/web/src/lib/solar/schedule/schedule-pdf.test.ts \
  apps/web/src/lib/solar/schedule/export-docx.ts apps/web/src/lib/solar/schedule/export-docx.test.ts \
  "apps/web/src/app/api/projects/[id]/solar/schedule/export"
git commit -m "feat(solar-schedule): exports — round-trippable XLSX, RFC 5545 ICS, A3 landscape PDF, OOXML DOCX

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Continue with Part 5 (`2026-09-28-solar-phase-5b-schedule-5-ui.md`).
