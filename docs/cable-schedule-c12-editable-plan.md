# C12 — Editable Cable Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cable schedule grid fully editable as a live-spreadsheet surface — inline cell edits with autosave, instant volt-drop recompute, structured node management, and add/remove/re-point of cables.

**Architecture:** Extend the existing custom `CableScheduleGrid.tsx` (Approach 1 — no grid library). A new generic `EditableCell` primitive turns static cells into click-to-edit inputs. New server actions (`updateSupplyAction`, `updateCableAction`, `repointSupplyAction`) mirror the existing `cable-length.actions.ts` pattern — load context → assert DRAFT → role check → update → `change_log` per field → revalidate. Hybrid recompute: the grid holds rows in client state and re-runs the shared pure VD math (`computeCumulativeVdMap`, `voltDropPctForSupply`) instantly on edit; SANS-table lookups (Ω/km, derated rating) recompute server-side and return on the autosave round-trip. A migration (`00054`) extends the voltage CHECK and adds structured node types.

**Tech Stack:** Next.js 15 App Router, React Server Components + server actions, Supabase (multi-schema, `cable_schedule.*`), Zod, TypeScript strict. Shared pure math in `@esite/shared` (`cable-calc.service.ts`).

**Spec:** `docs/cable-schedule-c12-editable-design.md`.

**Verification approach:** The cable-schedule module has no unit-test infrastructure (consistent across C1–C9); its established verification pattern is `pnpm --filter web type-check` + apply migration to staging + browser walkthrough. This plan follows that pattern — every task ends with a concrete typecheck/verify step and a commit. Pure new logic, if any, would go in `@esite/shared` (the tested package) — C12 adds none; it reuses existing shared functions.

**Branch:** `feat/powersync` (same as C1–C9; FF to `main` is a separate step, not part of this plan).

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `apps/edge-functions/supabase/migrations/00054_cable_schedule_c12_editable.sql` | Voltage CHECK extension + structured node types + board `kind` backfill | Create |
| `apps/web/src/actions/cable-entities.actions.ts` | Add `updateSupplyAction`, `updateCableAction`, `repointSupplyAction`; add `change_log` to the four delete actions | Modify |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/EditableCell.tsx` | Generic click-to-edit inline cell primitive (number / select / text) with idle→editing→saving→saved/error state | Create |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx` | Hold rows in client state; build rows + recompute VD client-side; wire `EditableCell` into editable columns; row delete / add / re-point affordances | Modify (major) |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/NodesPanel.tsx` | Dedicated node management — list grouped by type, add, rename, delete with blast-radius confirm | Create |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx` | Remove Source/Board/Supply tabs; keep only the streamlined Cable-add flow (picks From/To nodes) | Modify |
| `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx` | Pass raw `supplies` + `cables` + node lists to the grid and `NodesPanel`; mount `NodesPanel` | Modify |

**Capability note:** spec §10 said "add an `editSchedule` cap." `ROLE_CAPS` in `lib/cable-schedule/roles.ts` already has `editDesignFields` (Designer/Verifier/Admin = true, SiteOperator/Viewer = false) — exactly the right semantics. The plan **reuses `editDesignFields`**; no roles.ts change.

---

## Phase 1 — Migration

### Task 1: Write migration `00054`

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00054_cable_schedule_c12_editable.sql`

- [ ] **Step 1: Confirm the live CHECK-constraint names on staging**

The `00051` migration declared the constraints inline, so Postgres auto-named them. Confirm before writing `DROP CONSTRAINT`.

Run (psql against staging, or Supabase SQL editor):
```sql
SELECT conname, conrelid::regclass AS table, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN ('cable_schedule.supplies'::regclass, 'cable_schedule.sources'::regclass)
  AND contype = 'c';
```
Expected: a row for the supplies voltage CHECK (likely `supplies_voltage_v_check`) and the sources type CHECK (likely `sources_type_check`). Note the exact `conname` values — use them in Step 2.

- [ ] **Step 2: Write the migration file**

Use the confirmed constraint names from Step 1 in the `DROP CONSTRAINT` lines (the names below are the expected Postgres auto-names; correct them if Step 1 differs).

```sql
-- 00054_cable_schedule_c12_editable.sql
-- C12: extend the supply voltage range (22kV, 33kV) and introduce
-- structured node types. Transformer becomes a mid-network board kind.

BEGIN;

-- ─── 1. Voltage CHECK — add 22kV + 33kV ──────────────────────────────
ALTER TABLE cable_schedule.supplies
  DROP CONSTRAINT IF EXISTS supplies_voltage_v_check;
ALTER TABLE cable_schedule.supplies
  ADD CONSTRAINT supplies_voltage_v_check
  CHECK (voltage_v IN (230, 400, 525, 1000, 3300, 6600, 11000, 22000, 33000));

-- ─── 2. boards.kind — structured distribution-node types ─────────────
ALTER TABLE cable_schedule.boards
  ADD COLUMN IF NOT EXISTS kind TEXT;

-- backfill existing rows: main board if top-level, else sub board
UPDATE cable_schedule.boards
  SET kind = CASE WHEN parent_board_id IS NULL THEN 'MAIN_BOARD' ELSE 'SUB_BOARD' END
  WHERE kind IS NULL;

ALTER TABLE cable_schedule.boards
  ALTER COLUMN kind SET NOT NULL;
ALTER TABLE cable_schedule.boards
  ADD CONSTRAINT boards_kind_check
  CHECK (kind IN ('CONSUMER_RMU', 'TRANSFORMER', 'MAIN_BOARD', 'SUB_BOARD'));

-- ─── 3. sources.type — reconcile + restrict to origin types ──────────
-- RMU sources are council connection points → COUNCIL_RMU.
UPDATE cable_schedule.sources SET type = 'COUNCIL_RMU' WHERE type = 'RMU';

-- MINISUB sources are transformers → they belong as mid-network boards.
-- Move each MINISUB source to a TRANSFORMER board and re-point its supplies.
DO $$
DECLARE
  src RECORD;
  new_board_id UUID;
BEGIN
  FOR src IN
    SELECT * FROM cable_schedule.sources WHERE type = 'MINISUB'
  LOOP
    INSERT INTO cable_schedule.boards (revision_id, organisation_id, code, kind, notes)
    VALUES (src.revision_id, src.organisation_id, src.code, 'TRANSFORMER', src.notes)
    RETURNING id INTO new_board_id;

    UPDATE cable_schedule.supplies
      SET from_board_id = new_board_id, from_source_id = NULL
      WHERE from_source_id = src.id;

    DELETE FROM cable_schedule.sources WHERE id = src.id;
  END LOOP;
END $$;

ALTER TABLE cable_schedule.sources
  DROP CONSTRAINT IF EXISTS sources_type_check;
ALTER TABLE cable_schedule.sources
  ADD CONSTRAINT sources_type_check
  CHECK (type IN ('COUNCIL_RMU', 'UTILITY', 'PV', 'STANDBY'));

COMMIT;
```

- [ ] **Step 3: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00054_cable_schedule_c12_editable.sql
git commit -m "feat(cable-schedule): C12 migration — voltage range + structured node types"
```

### Task 2: Apply migration to staging and verify

**Files:** none (operational).

- [ ] **Step 1: Apply the migration**

```bash
cd apps/edge-functions && supabase db push
```
Expected: `00054_cable_schedule_c12_editable.sql` applied, no errors.

- [ ] **Step 2: Verify the new constraints**

Run against staging:
```sql
-- voltage CHECK now allows 22kV/33kV
INSERT INTO cable_schedule.supplies (revision_id, organisation_id, from_source_id, to_board_id, voltage_v, design_load_a)
  VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 33000, 100);
-- Expected: fails on the FK (revision/org don't exist) — NOT on the voltage CHECK.
-- If it complained about voltage_v, the CHECK didn't update.

-- boards.kind is populated + constrained
SELECT kind, count(*) FROM cable_schedule.boards GROUP BY kind;
-- Expected: every row has a kind in (CONSUMER_RMU, TRANSFORMER, MAIN_BOARD, SUB_BOARD), none NULL.

-- sources.type is restricted
SELECT type, count(*) FROM cable_schedule.sources GROUP BY type;
-- Expected: only COUNCIL_RMU / UTILITY / PV / STANDBY. No RMU, no MINISUB.
```

- [ ] **Step 3: No commit** (operational task — migration file already committed in Task 1).

---

## Phase 2 — Server actions

### Task 3: `updateSupplyAction`

**Files:**
- Modify: `apps/web/src/actions/cable-entities.actions.ts` (append after `deleteSupplyAction`, ~line 237)

- [ ] **Step 1: Add the imports**

At the top of the file, extend the `@esite/shared` import to keep `lookupCableProperties, lookupDeratingFactors, deratedRating` (already present) and add the roles import:

```ts
import { lookupCableProperties, lookupDeratingFactors, deratedRating } from '@esite/shared'
import { lookupCableRole, ROLE_CAPS } from '@/lib/cable-schedule/roles'
```

- [ ] **Step 2: Add `updateSupplyAction`**

Append to `apps/web/src/actions/cable-entities.actions.ts`:

```ts
// ─── supply updates (C12) ────────────────────────────────────────────

const updateSupplySchema = z.object({
  supplyId: uuid,
  voltageV: z.number().positive().optional(),
  designLoadA: z.number().positive().optional(),
  section: z.enum(['NORMAL', 'EMERGENCY']).nullable().optional(),
})

export async function updateSupplyAction(
  input: z.infer<typeof updateSupplySchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = updateSupplySchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: sup } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .select(
      'id, revision_id, organisation_id, voltage_v, design_load_a, section, ' +
      'revision:revisions!revision_id(status, project_id)',
    )
    .eq('id', parsed.data.supplyId)
    .single()
  if (!sup) return { error: 'Supply not found' }
  const s = sup as any
  if (s.revision?.status !== 'DRAFT') {
    return { error: 'Revision is ISSUED — start a new revision to make changes.' }
  }

  const role = await lookupCableRole(supabase, user.id, s.organisation_id)
  if (!ROLE_CAPS[role].editDesignFields) {
    return { error: `Your role (${role}) cannot edit the schedule.` }
  }

  const patch: Record<string, unknown> = {}
  const events: Array<Record<string, unknown>> = []
  const log = (field: string, oldV: unknown, newV: unknown) => {
    if (oldV === newV) return
    patch[field] = newV
    events.push({
      revision_id: s.revision_id, organisation_id: s.organisation_id,
      entity_type: 'supply', entity_id: s.id, field_name: field,
      old_value: oldV, new_value: newV, changed_by: user.id,
    })
  }
  if (parsed.data.voltageV !== undefined) log('voltage_v', Number(s.voltage_v), parsed.data.voltageV)
  if (parsed.data.designLoadA !== undefined) log('design_load_a', Number(s.design_load_a), parsed.data.designLoadA)
  if (parsed.data.section !== undefined) log('section', s.section, parsed.data.section)
  if (events.length === 0) return { ok: true }

  const { error } = await (supabase as any)
    .schema('cable_schedule').from('supplies')
    .update(patch).eq('id', s.id)
  if (error) return { error: error.message }

  await (supabase as any).schema('cable_schedule').from('change_log').insert(events)
  revalidatePath(`/projects/${s.revision.project_id}/cables/${s.revision_id}`)
  return { ok: true }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web type-check`
Expected: no new errors in `cable-entities.actions.ts` (pre-existing errors elsewhere are unchanged — see CLAUDE.md).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/actions/cable-entities.actions.ts
git commit -m "feat(cable-schedule): C12 — updateSupplyAction with change_log"
```

### Task 4: `updateCableAction` (with SANS recompute)

**Files:**
- Modify: `apps/web/src/actions/cable-entities.actions.ts` (append after `updateSupplyAction`)

- [ ] **Step 1: Add `updateCableAction`**

Append to `apps/web/src/actions/cable-entities.actions.ts`:

```ts
// ─── cable updates (C12) ─────────────────────────────────────────────

const updateCableSchema = z.object({
  cableId: uuid,
  sizeMm2: z.number().positive().optional(),
  cores: z.enum(['3', '3+E', '4']).optional(),
  conductor: z.enum(['CU', 'AL']).optional(),
  insulation: z.enum(['PVC', 'XLPE', 'PILC']).optional(),
  armour: z.enum(['SWA', 'UNARMOURED']).nullable().optional(),
  installationMethod: z.enum(['DIRECT_IN_GROUND', 'DUCT', 'LADDER', 'TRAY', 'CLIPPED']).nullable().optional(),
  depthMm: z.number().int().positive().nullable().optional(),
  groupedWith: z.number().int().positive().optional(),
  ambientTempC: z.number().optional(),
  measuredLengthM: z.number().nonnegative().nullable().optional(),
  ohmPerKmOverride: z.number().positive().nullable().optional(),
  tagOverride: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

// fields whose change forces a SANS + derating re-lookup
const SANS_FIELDS = [
  'sizeMm2', 'cores', 'conductor', 'insulation',
  'installationMethod', 'depthMm', 'groupedWith', 'ambientTempC',
] as const

export async function updateCableAction(
  input: z.infer<typeof updateCableSchema>,
): Promise<{
  ok?: true
  error?: string
  recomputed?: { ohm_per_km: number | null; derated_current_rating_a: number | null }
}> {
  const parsed = updateCableSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: row } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select(
      'id, revision_id, organisation_id, size_mm2, cores, conductor, insulation, armour, ' +
      'installation_method, depth_mm, grouped_with, ambient_temp_c, thermal_resistivity_kmw, ' +
      'measured_length_m, length_status, ohm_per_km, manual_override, tag_override, notes, ' +
      'revision:revisions!revision_id(status, project_id)',
    )
    .eq('id', parsed.data.cableId)
    .single()
  if (!row) return { error: 'Cable not found' }
  const c = row as any
  if (c.revision?.status !== 'DRAFT') {
    return { error: 'Revision is ISSUED — start a new revision to make changes.' }
  }

  const role = await lookupCableRole(supabase, user.id, c.organisation_id)
  if (!ROLE_CAPS[role].editDesignFields) {
    return { error: `Your role (${role}) cannot edit the schedule.` }
  }

  // Effective new values (input value if provided, else current).
  const next = {
    sizeMm2: parsed.data.sizeMm2 ?? Number(c.size_mm2),
    cores: parsed.data.cores ?? c.cores,
    conductor: parsed.data.conductor ?? c.conductor,
    insulation: parsed.data.insulation ?? c.insulation,
    installationMethod: parsed.data.installationMethod !== undefined
      ? parsed.data.installationMethod : c.installation_method,
    depthMm: parsed.data.depthMm !== undefined ? parsed.data.depthMm : c.depth_mm,
    groupedWith: parsed.data.groupedWith ?? Number(c.grouped_with ?? 1),
    ambientTempC: parsed.data.ambientTempC ?? Number(c.ambient_temp_c ?? 30),
  }

  const sansChanged = SANS_FIELDS.some((f) => parsed.data[f] !== undefined)

  const patch: Record<string, unknown> = {}
  const events: Array<Record<string, unknown>> = []
  const log = (field: string, oldV: unknown, newV: unknown) => {
    if (oldV === newV) return
    patch[field] = newV
    events.push({
      revision_id: c.revision_id, organisation_id: c.organisation_id,
      entity_type: 'cable', entity_id: c.id, field_name: field,
      old_value: oldV, new_value: newV, changed_by: user.id,
    })
  }

  if (parsed.data.sizeMm2 !== undefined) log('size_mm2', Number(c.size_mm2), parsed.data.sizeMm2)
  if (parsed.data.cores !== undefined) log('cores', c.cores, parsed.data.cores)
  if (parsed.data.conductor !== undefined) log('conductor', c.conductor, parsed.data.conductor)
  if (parsed.data.insulation !== undefined) log('insulation', c.insulation, parsed.data.insulation)
  if (parsed.data.armour !== undefined) log('armour', c.armour, parsed.data.armour)
  if (parsed.data.installationMethod !== undefined) log('installation_method', c.installation_method, parsed.data.installationMethod)
  if (parsed.data.depthMm !== undefined) log('depth_mm', c.depth_mm, parsed.data.depthMm)
  if (parsed.data.groupedWith !== undefined) log('grouped_with', Number(c.grouped_with ?? 1), parsed.data.groupedWith)
  if (parsed.data.ambientTempC !== undefined) log('ambient_temp_c', Number(c.ambient_temp_c ?? 30), parsed.data.ambientTempC)
  if (parsed.data.tagOverride !== undefined) log('tag_override', c.tag_override, parsed.data.tagOverride)
  if (parsed.data.notes !== undefined) log('notes', c.notes, parsed.data.notes)
  if (parsed.data.measuredLengthM !== undefined) {
    log('measured_length_m', c.measured_length_m == null ? null : Number(c.measured_length_m), parsed.data.measuredLengthM)
    // keep the status machine honest for the simple inline-cell path
    patch.measured_length_method = parsed.data.measuredLengthM != null ? 'MANUAL' : null
    const newStatus = parsed.data.measuredLengthM != null
      ? (c.length_status === 'UNMEASURED' ? 'MEASURED' : c.length_status)
      : (c.length_status === 'MEASURED' ? 'UNMEASURED' : c.length_status)
    if (newStatus !== c.length_status) log('length_status', c.length_status, newStatus)
  }

  // Manual Ω/km override. A SANS-affecting change always clears the override.
  let recomputed: { ohm_per_km: number | null; derated_current_rating_a: number | null } | undefined
  if (sansChanged) {
    const props = await lookupCableProperties(supabase as any, {
      conductor: next.conductor, insulation: next.insulation,
      cores: next.cores, size_mm2: next.sizeMm2, projectId: c.revision.project_id,
    })
    const ohm = props?.ac_resistance ?? props?.dc_resistance ?? null
    const baseRating =
      next.installationMethod === 'DIRECT_IN_GROUND' ? props?.rating_direct_buried
      : next.installationMethod === 'DUCT' ? props?.rating_in_duct
      : props?.rating_in_air
    const derate = await lookupDeratingFactors(supabase as any, {
      depth_mm: next.depthMm ?? 500,
      thermal_resistivity_kmw: Number(c.thermal_resistivity_kmw ?? 1.0),
      grouped_with: next.groupedWith,
      ambient_c: next.ambientTempC,
      insulation: next.insulation,
    })
    const deratedA = deratedRating(baseRating ?? null, {
      depth: derate.depth, thermal: derate.thermal,
      grouping: derate.grouping, temperature: derate.temperature,
    })
    log('ohm_per_km', c.ohm_per_km == null ? null : Number(c.ohm_per_km), ohm)
    patch.derate_depth = derate.depth
    patch.derate_thermal = derate.thermal
    patch.derate_grouping = derate.grouping
    patch.derate_temp = derate.temperature
    patch.derated_current_rating_a = deratedA
    patch.manual_override = false
    if (c.manual_override) log('manual_override', true, false)
    recomputed = { ohm_per_km: ohm, derated_current_rating_a: deratedA }
  } else if (parsed.data.ohmPerKmOverride !== undefined) {
    const ov = parsed.data.ohmPerKmOverride
    log('ohm_per_km', c.ohm_per_km == null ? null : Number(c.ohm_per_km), ov)
    patch.manual_override = ov != null
    if (!!c.manual_override !== (ov != null)) log('manual_override', !!c.manual_override, ov != null)
    recomputed = { ohm_per_km: ov, derated_current_rating_a: null }
  }

  if (events.length === 0 && Object.keys(patch).length === 0) return { ok: true }

  const { error } = await (supabase as any)
    .schema('cable_schedule').from('cables')
    .update(patch).eq('id', c.id)
  if (error) return { error: error.message }

  if (events.length > 0) {
    await (supabase as any).schema('cable_schedule').from('change_log').insert(events)
  }
  revalidatePath(`/projects/${c.revision.project_id}/cables/${c.revision_id}`)
  return { ok: true, recomputed }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web type-check`
Expected: no new errors in `cable-entities.actions.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/actions/cable-entities.actions.ts
git commit -m "feat(cable-schedule): C12 — updateCableAction with SANS recompute + change_log"
```

### Task 5: `repointSupplyAction`

**Files:**
- Modify: `apps/web/src/actions/cable-entities.actions.ts` (append after `updateCableAction`)

- [ ] **Step 1: Add `repointSupplyAction`**

```ts
// ─── re-pointing a run (C12) ─────────────────────────────────────────

const repointSchema = z.object({
  supplyId: uuid,
  fromSourceId: uuid.nullable().optional(),
  fromBoardId: uuid.nullable().optional(),
  toBoardId: uuid.optional(),
})

export async function repointSupplyAction(
  input: z.infer<typeof repointSchema>,
): Promise<{ ok?: true; error?: string }> {
  const parsed = repointSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: sup } = await (supabase as any)
    .schema('cable_schedule')
    .from('supplies')
    .select(
      'id, revision_id, organisation_id, from_source_id, from_board_id, to_board_id, ' +
      'revision:revisions!revision_id(status, project_id)',
    )
    .eq('id', parsed.data.supplyId)
    .single()
  if (!sup) return { error: 'Supply not found' }
  const s = sup as any
  if (s.revision?.status !== 'DRAFT') {
    return { error: 'Revision is ISSUED — start a new revision to make changes.' }
  }

  const role = await lookupCableRole(supabase, user.id, s.organisation_id)
  if (!ROLE_CAPS[role].editDesignFields) {
    return { error: `Your role (${role}) cannot edit the schedule.` }
  }

  // Effective new origin/destination
  const nextFromSource = parsed.data.fromSourceId !== undefined ? parsed.data.fromSourceId : s.from_source_id
  const nextFromBoard = parsed.data.fromBoardId !== undefined ? parsed.data.fromBoardId : s.from_board_id
  const nextTo = parsed.data.toBoardId ?? s.to_board_id

  // XOR: exactly one origin
  if ((nextFromSource ? 1 : 0) + (nextFromBoard ? 1 : 0) !== 1) {
    return { error: 'Pick exactly one origin: a source OR a board.' }
  }
  if (!nextTo) return { error: 'A destination board is required.' }

  const patch = {
    from_source_id: nextFromSource ?? null,
    from_board_id: nextFromBoard ?? null,
    to_board_id: nextTo,
  }
  const { error } = await (supabase as any)
    .schema('cable_schedule').from('supplies')
    .update(patch).eq('id', s.id)
  if (error) return { error: error.message }

  const events: Array<Record<string, unknown>> = []
  const baseEvent = {
    revision_id: s.revision_id, organisation_id: s.organisation_id,
    entity_type: 'supply', entity_id: s.id, changed_by: user.id,
  }
  if ((s.from_source_id ?? null) !== patch.from_source_id) {
    events.push({ ...baseEvent, field_name: 'from_source_id', old_value: s.from_source_id, new_value: patch.from_source_id })
  }
  if ((s.from_board_id ?? null) !== patch.from_board_id) {
    events.push({ ...baseEvent, field_name: 'from_board_id', old_value: s.from_board_id, new_value: patch.from_board_id })
  }
  if (s.to_board_id !== patch.to_board_id) {
    events.push({ ...baseEvent, field_name: 'to_board_id', old_value: s.to_board_id, new_value: patch.to_board_id })
  }
  if (events.length > 0) {
    await (supabase as any).schema('cable_schedule').from('change_log').insert(events)
  }
  revalidatePath(`/projects/${s.revision.project_id}/cables/${s.revision_id}`)
  return { ok: true }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web type-check`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/actions/cable-entities.actions.ts
git commit -m "feat(cable-schedule): C12 — repointSupplyAction"
```

### Task 6: `change_log` on deletes

**Files:**
- Modify: `apps/web/src/actions/cable-entities.actions.ts` — `deleteSourceAction`, `deleteBoardAction`, `deleteSupplyAction`, `deleteCableAction`

- [ ] **Step 1: Add a shared delete-logging helper**

Append near the `assertDraft` helper at the top of `cable-entities.actions.ts`:

```ts
/** Records a deletion in change_log. Best-effort — never blocks the delete. */
async function logDeletion(
  supabase: any,
  args: {
    revisionId: string
    organisationId: string
    entityType: 'source' | 'board' | 'supply' | 'cable'
    entityId: string
    label: string
    userId: string | null
  },
): Promise<void> {
  await supabase.schema('cable_schedule').from('change_log').insert({
    revision_id: args.revisionId,
    organisation_id: args.organisationId,
    entity_type: args.entityType,
    entity_id: args.entityId,
    field_name: 'deleted',
    old_value: args.label,
    new_value: null,
    changed_by: args.userId,
  })
}
```

- [ ] **Step 2: Wire `logDeletion` into each delete action**

In each of `deleteSourceAction`, `deleteBoardAction`, `deleteSupplyAction`, `deleteCableAction`: after the existing successful `.delete()` call and before `revalidatePath`, call `logDeletion`. The four actions already load the row's `revision_id` for the `assertDraft` guard — extend that select to also pull `organisation_id` and a label field (`code` for source/board; for supply use `from_*`/`to_board_id` ids; `cable_no` for cable), capture `user.id` via `supabase.auth.getUser()`, and pass them through.

Example — `deleteCableAction` (the others follow the identical shape with their own label/select fields):

```ts
export async function deleteCableAction(id: string): Promise<{ ok?: true; error?: string }> {
  if (!uuid.safeParse(id).success) return { error: 'Invalid id' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: c } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select('revision_id, organisation_id, cable_no')
    .eq('id', id)
    .single()
  const cable = c as { revision_id?: string; organisation_id?: string; cable_no?: number } | null
  if (!cable?.revision_id) return { error: 'Cable not found' }
  const guard = await assertDraft(supabase, cable.revision_id)
  if ('error' in guard) return { error: guard.error }
  const { error } = await (supabase as any)
    .schema('cable_schedule').from('cables').delete().eq('id', id)
  if (error) return { error: error.message }
  await logDeletion(supabase, {
    revisionId: cable.revision_id,
    organisationId: cable.organisation_id!,
    entityType: 'cable',
    entityId: id,
    label: `Cable #${cable.cable_no ?? '?'}`,
    userId: user?.id ?? null,
  })
  revalidatePath(`/projects/${guard.projectId}/cables/${cable.revision_id}`)
  return { ok: true }
}
```

Apply the same pattern to `deleteSourceAction` (label = `Source "${code}"`), `deleteBoardAction` (label = `Board "${code}"`), `deleteSupplyAction` (label = `Supply ${id}`). Each already selects `revision_id`; extend the select to add `organisation_id` (+ `code` for source/board).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web type-check`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/actions/cable-entities.actions.ts
git commit -m "feat(cable-schedule): C12 — log entity deletions to change_log"
```

---

## Phase 3 — EditableCell primitive

### Task 7: `EditableCell.tsx`

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/EditableCell.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

type CellType = 'number' | 'text' | 'select'

interface BaseProps {
  /** Current committed value (string|number|null). */
  value: string | number | null
  type: CellType
  /** Fires on commit. Resolves to { error } on failure → cell reverts + shows error. */
  onSave: (next: string | number | null) => Promise<{ error?: string }>
  /** Options for type='select' — value/label pairs. */
  options?: Array<{ value: string; label: string }>
  /** Display formatter for the idle state (e.g. fixed decimals). */
  format?: (v: string | number | null) => string
  align?: 'left' | 'right' | 'center'
  /** Read-only (e.g. revision ISSUED, or role lacks editDesignFields). */
  disabled?: boolean
  /** Optional placeholder shown when value is null in idle state. */
  placeholder?: string
}

type State = 'idle' | 'editing' | 'saving' | 'saved' | 'error'

export function EditableCell({
  value, type, onSave, options, format, align = 'left', disabled, placeholder,
}: BaseProps) {
  const [state, setState] = useState<State>('idle')
  const [draft, setDraft] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)

  // Reset draft whenever we enter editing (or the upstream value changed).
  useEffect(() => {
    if (state === 'editing') {
      setDraft(value == null ? '' : String(value))
      inputRef.current?.focus()
      if (inputRef.current instanceof HTMLInputElement) inputRef.current.select()
    }
  }, [state, value])

  // Briefly show the ✓ then return to idle.
  useEffect(() => {
    if (state !== 'saved') return
    const t = setTimeout(() => setState('idle'), 900)
    return () => clearTimeout(t)
  }, [state])

  const display = format ? format(value) : value == null ? (placeholder ?? '—') : String(value)

  if (disabled) {
    return <span style={{ color: 'var(--c-text)' }}>{display}</span>
  }

  function commit() {
    const raw = draft.trim()
    let nextValue: string | number | null
    if (type === 'number') {
      nextValue = raw === '' ? null : Number(raw)
      if (nextValue != null && !Number.isFinite(nextValue)) {
        setError('Not a number'); setState('error'); return
      }
    } else {
      nextValue = raw === '' ? null : raw
    }
    // No-op if unchanged.
    if (String(nextValue ?? '') === String(value ?? '')) { setState('idle'); return }
    setState('saving')
    onSave(nextValue).then((res) => {
      if (res.error) { setError(res.error); setState('error'); return }
      setError(null); setState('saved')
    })
  }

  if (state === 'editing' || state === 'saving') {
    const common = {
      ref: inputRef as never,
      value: draft,
      disabled: state === 'saving',
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        if (e.key === 'Escape') { e.preventDefault(); setState('idle') }
      },
      className: 'ob-input',
      style: { width: '100%', font: 'inherit', padding: '1px 4px' },
    }
    return type === 'select'
      ? (
        <select {...common}>
          <option value="">—</option>
          {(options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
      : <input {...common} type={type === 'number' ? 'number' : 'text'} step="any" />
  }

  return (
    <button
      type="button"
      onClick={() => setState('editing')}
      title={error ?? 'Click to edit'}
      style={{
        background: 'none',
        border: '1px dashed transparent',
        borderRadius: 3,
        color: state === 'error' ? '#dc2626' : 'inherit',
        font: 'inherit',
        width: '100%',
        textAlign: align,
        padding: '0 4px',
        margin: '-1px 0',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--c-border)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'transparent' }}
    >
      {display}
      {state === 'saved' && <span style={{ color: '#16a34a', marginLeft: 4 }}>✓</span>}
      {state === 'error' && <span style={{ color: '#dc2626', marginLeft: 4 }}>↩</span>}
    </button>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web type-check`
Expected: no errors in `EditableCell.tsx`.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/EditableCell.tsx"
git commit -m "feat(cable-schedule): C12 — EditableCell inline-edit primitive"
```

---

## Phase 4 — Grid integration

### Task 8: Lift row-building + VD recompute into the client grid

The grid currently receives pre-built `ScheduleRow[]` from `page.tsx`. For instant client-side VD recompute, the grid must hold the raw `supplies` + `cables` and rebuild rows itself.

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx` (the grid render, ~line 447)
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx` (`ScheduleRow` + `Props` + row building)

- [ ] **Step 1: Extend `ScheduleRow` in `CableScheduleGrid.tsx`**

Add the fields the edit actions need (the `id` is already the cable id):

```ts
export interface ScheduleRow {
  id: string
  supply_id: string            // NEW — needed for updateSupplyAction / repoint
  cable_no: number
  from_label: string
  to_label: string
  from_node_id: string         // NEW — current origin (source or board) id
  to_node_id: string           // NEW — current destination board id
  voltage_v: number | null
  load_a: number | null
  size_mm2: number
  cores: string
  conductor: 'CU' | 'AL'
  insulation: 'PVC' | 'XLPE' | 'PILC'
  armour: string | null        // NEW
  section: string | null       // NEW — supply section
  ohm_per_km: number | null
  measured_length_m: number | null
  confirmed_length_m: number | null
  length_status: 'UNMEASURED' | 'MEASURED' | 'CONFIRMED' | 'DISCREPANCY'
  vd_pct: number
  cumulative_vd_pct: number
  derated_rating_a: number | null
  installation_method: string | null
  depth_mm: number | null
  grouped_with: number
  ambient_temp_c: number       // NEW
  tag_override: string | null
  manual_override: boolean
  notes: string | null
  cloud_kind: 'added' | 'changed' | null
  cloud_letter: string
}
```

- [ ] **Step 2: Change `Props` to pass raw data + node options**

```ts
import {
  computeCumulativeVdMap,
  voltDropPctForSupply,
  type CableForCalc,
  type SupplyForCalc,
} from '@esite/shared'

export interface NodeOption { id: string; code: string; kind: 'source' | 'board' }

interface Props {
  projectId: string
  revisionId: string
  rows: ScheduleRow[]                 // initial rows, built server-side as today
  supplies: SupplyForCalc[]           // raw — for client-side VD recompute
  cables: CableForCalc[]              // raw — for client-side VD recompute
  nodeOptions: NodeOption[]           // for the re-point picker
  locked: boolean
  lengthMode: 'design' | 'as-built' | 'worst'
  canEdit: boolean                    // ROLE_CAPS[role].editDesignFields
}
```

- [ ] **Step 3: Hold rows in client state and add the recompute helper**

Inside `CableScheduleGrid`, replace the `rows` prop usage with local state seeded from props, and add a function that re-derives `vd_pct` + `cumulative_vd_pct` across all rows from the current raw `supplies`/`cables` snapshot:

```ts
const [liveRows, setLiveRows] = useState<ScheduleRow[]>(rows)
const [liveSupplies, setLiveSupplies] = useState<SupplyForCalc[]>(supplies)
const [liveCables, setLiveCables] = useState<CableForCalc[]>(cables)

// Re-seed if the server sends fresh data (after revalidatePath).
useEffect(() => { setLiveRows(rows); setLiveSupplies(supplies); setLiveCables(cables) },
  [rows, supplies, cables])

/** Recompute VD + cumulative VD across all rows from the current raw snapshot. */
function recomputeVd(
  nextSupplies: SupplyForCalc[],
  nextCables: CableForCalc[],
): Map<string, { vd: number; cum: number }> {
  const cumMap = computeCumulativeVdMap(nextSupplies, nextCables, lengthMode)
  const out = new Map<string, { vd: number; cum: number }>()
  for (const s of nextSupplies) {
    out.set(s.id, {
      vd: voltDropPctForSupply(s, nextCables, lengthMode),
      cum: cumMap.get(s.id) ?? 0,
    })
  }
  return out
}
```

Use `liveRows` everywhere the component currently maps `filtered`/`rows`.

- [ ] **Step 4: Update `page.tsx` to pass the new props**

In `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx`, the `<CableScheduleGrid>` render currently passes `rows`, `locked`, `lengthMode`. Extend it:

```tsx
<CableScheduleGrid
  projectId={projectId}
  revisionId={revisionId}
  rows={rows}
  supplies={supplies as SupplyForCalc[]}
  cables={cables as CableForCalc[]}
  nodeOptions={[
    ...sources.map((s) => ({ id: s.id, code: s.code, kind: 'source' as const })),
    ...boards.map((b) => ({ id: b.id, code: b.code, kind: 'board' as const })),
  ]}
  locked={revision.status !== 'DRAFT'}
  lengthMode={lengthMode}
  canEdit={revision.status === 'DRAFT' /* role gate is enforced server-side; see note */}
/>
```

Note: `page.tsx` already computes `sources`, `boards`, `supplies`, `cables`. `canEdit` here is the DRAFT gate; the per-role `editDesignFields` gate is enforced server-side in every action (the cell just surfaces the returned error). If you want the role gate reflected in the UI too, look up the cable role in `page.tsx` (it already imports from `@esite/shared`; add `lookupCableRole` + `ROLE_CAPS` from `@/lib/cable-schedule/roles`) and pass `canEdit={revision.status === 'DRAFT' && ROLE_CAPS[role].editDesignFields}`.

- [ ] **Step 5: Add `supply_id`, `from_node_id`, `to_node_id`, `armour`, `section`, `ambient_temp_c` to the row-building in `page.tsx`**

`page.tsx` builds `rows` in a `.map`. Add the new fields from the already-fetched `supply` + `cable` objects (`supply.id`, `supply.from_source_id ?? supply.from_board_id`, `supply.to_board_id`, `c.armour`, `supply.section`, `c.ambient_temp_c`).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter web type-check`
Expected: no new errors in `page.tsx` / `CableScheduleGrid.tsx`. (The grid won't have editable cells yet — that's Tasks 9–10 — but it must still compile and render read-only.)

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx" "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx"
git commit -m "feat(cable-schedule): C12 — lift row state + VD recompute into the client grid"
```

### Task 9: Wire `EditableCell` into the supply-level columns

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx`

- [ ] **Step 1: Add the supply-edit handler**

Inside `CableScheduleGrid`, add a handler that optimistically patches local state, recomputes VD, fires `updateSupplyAction`, and reconciles on error:

```ts
import { updateSupplyAction, updateCableAction, repointSupplyAction, deleteCableAction } from '@/actions/cable-entities.actions'

const VOLTAGE_OPTIONS = [230, 400, 525, 1000, 3300, 6600, 11000, 22000, 33000]
  .map((v) => ({ value: String(v), label: `${v} V` }))
const SECTION_OPTIONS = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'EMERGENCY', label: 'Emergency' },
]

async function saveSupplyField(
  supplyId: string,
  field: 'voltage_v' | 'design_load_a' | 'section',
  next: string | number | null,
): Promise<{ error?: string }> {
  const prevSupplies = liveSupplies
  const prevRows = liveRows
  // Optimistic: patch raw supplies + every row on that supply.
  const nextSupplies = liveSupplies.map((s) =>
    s.id === supplyId ? { ...s, [field]: next } : s)
  setLiveSupplies(nextSupplies)
  const vd = recomputeVd(nextSupplies, liveCables)
  setLiveRows(liveRows.map((r) => {
    if (r.supply_id !== supplyId) return r
    const v = vd.get(supplyId)
    return {
      ...r,
      voltage_v: field === 'voltage_v' ? (next as number) : r.voltage_v,
      load_a: field === 'design_load_a' ? (next as number) : r.load_a,
      section: field === 'section' ? (next as string | null) : r.section,
      vd_pct: v?.vd ?? r.vd_pct,
      cumulative_vd_pct: v?.cum ?? r.cumulative_vd_pct,
    }
  }))
  // Persist.
  const res = await updateSupplyAction({
    supplyId,
    voltageV: field === 'voltage_v' ? Number(next) : undefined,
    designLoadA: field === 'design_load_a' ? Number(next) : undefined,
    section: field === 'section' ? (next as 'NORMAL' | 'EMERGENCY' | null) : undefined,
  })
  if (res.error) { setLiveSupplies(prevSupplies); setLiveRows(prevRows); return { error: res.error } }
  return {}
}
```

- [ ] **Step 2: Replace the V / A / section cells**

In the row `.map`, replace the static V and A `<Td>`s (currently `<Td align="right">{fmt(r.voltage_v)}</Td>` and `<Td align="right">{fmt(r.load_a)}</Td>`) with:

```tsx
<Td align="right">
  <EditableCell
    type="select" align="right" disabled={locked || !canEdit}
    value={r.voltage_v} options={VOLTAGE_OPTIONS}
    format={(v) => v == null ? '—' : `${v}`}
    onSave={(next) => saveSupplyField(r.supply_id, 'voltage_v', next)}
  />
</Td>
<Td align="right">
  <EditableCell
    type="number" align="right" disabled={locked || !canEdit}
    value={r.load_a} format={(v) => fmt(typeof v === 'number' ? v : null)}
    onSave={(next) => saveSupplyField(r.supply_id, 'design_load_a', next)}
  />
</Td>
```

There is no standalone "section" column today; section is carried per supply. Leave section editing to the NodesPanel/AddEntityPanel flow unless a section column is added later — the `saveSupplyField` handler already supports it if a column is introduced.

- [ ] **Step 3: Import `EditableCell`**

At the top of `CableScheduleGrid.tsx`:
```ts
import { EditableCell } from './EditableCell'
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web type-check`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx"
git commit -m "feat(cable-schedule): C12 — editable voltage + load cells with instant VD recompute"
```

### Task 10: Wire `EditableCell` into the cable-level columns

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx`

- [ ] **Step 1: Add the cable-edit handler**

```ts
const SIZE_OPTIONS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400]
  .map((s) => ({ value: String(s), label: String(s) }))
const CORES_OPTIONS = ['3', '3+E', '4'].map((c) => ({ value: c, label: c }))
const CONDUCTOR_OPTIONS = [{ value: 'CU', label: 'Cu' }, { value: 'AL', label: 'Al' }]
const INSULATION_OPTIONS = ['XLPE', 'PVC', 'PILC'].map((i) => ({ value: i, label: i }))
const ARMOUR_OPTIONS = [{ value: 'SWA', label: 'SWA' }, { value: 'UNARMOURED', label: 'Unarmoured' }]
const INSTALL_OPTIONS = [
  { value: 'DIRECT_IN_GROUND', label: 'Direct in ground' },
  { value: 'DUCT', label: 'Duct' },
  { value: 'LADDER', label: 'Ladder' },
  { value: 'TRAY', label: 'Tray' },
  { value: 'CLIPPED', label: 'Clipped' },
]

// Maps a ScheduleRow column → updateCableAction input key.
type CableField =
  | 'size_mm2' | 'cores' | 'conductor' | 'insulation' | 'armour'
  | 'installation_method' | 'depth_mm' | 'grouped_with' | 'ambient_temp_c'
  | 'measured_length_m' | 'ohm_per_km_override' | 'tag_override' | 'notes'

async function saveCableField(
  cableId: string, supplyId: string, field: CableField, next: string | number | null,
): Promise<{ error?: string }> {
  const prevRows = liveRows
  const prevCables = liveCables

  // Optimistic local patch on the raw cable + the row.
  const rowKey: Partial<ScheduleRow> = {}
  const cableKey: Record<string, unknown> = {}
  switch (field) {
    case 'size_mm2': rowKey.size_mm2 = Number(next); cableKey.size_mm2 = Number(next); break
    case 'cores': rowKey.cores = next as string; cableKey.cores = next; break
    case 'conductor': rowKey.conductor = next as 'CU' | 'AL'; cableKey.conductor = next; break
    case 'insulation': rowKey.insulation = next as ScheduleRow['insulation']; cableKey.insulation = next; break
    case 'armour': rowKey.armour = next as string | null; break
    case 'installation_method': rowKey.installation_method = next as string | null; break
    case 'depth_mm': rowKey.depth_mm = next == null ? null : Number(next); break
    case 'grouped_with': rowKey.grouped_with = Number(next); break
    case 'ambient_temp_c': rowKey.ambient_temp_c = Number(next); break
    case 'measured_length_m':
      rowKey.measured_length_m = next == null ? null : Number(next)
      cableKey.measured_length_m = next == null ? null : Number(next)
      break
    case 'ohm_per_km_override':
      rowKey.ohm_per_km = next == null ? null : Number(next)
      rowKey.manual_override = next != null
      cableKey.ohm_per_km = next == null ? null : Number(next)
      break
    case 'tag_override': rowKey.tag_override = next as string | null; break
    case 'notes': rowKey.notes = next as string | null; break
  }
  const nextCables = liveCables.map((c) =>
    c.id === cableId ? { ...c, ...cableKey } : c)
  setLiveCables(nextCables)
  const vd = recomputeVd(liveSupplies, nextCables)
  setLiveRows(liveRows.map((r) => {
    if (r.id !== cableId) {
      // other parallel cables share the supply's VD — refresh those too
      if (r.supply_id === supplyId) {
        const v = vd.get(supplyId)
        return { ...r, vd_pct: v?.vd ?? r.vd_pct, cumulative_vd_pct: v?.cum ?? r.cumulative_vd_pct }
      }
      return r
    }
    const v = vd.get(supplyId)
    return { ...r, ...rowKey, vd_pct: v?.vd ?? r.vd_pct, cumulative_vd_pct: v?.cum ?? r.cumulative_vd_pct }
  }))

  // Persist.
  const res = await updateCableAction({
    cableId,
    sizeMm2: field === 'size_mm2' ? Number(next) : undefined,
    cores: field === 'cores' ? (next as '3' | '3+E' | '4') : undefined,
    conductor: field === 'conductor' ? (next as 'CU' | 'AL') : undefined,
    insulation: field === 'insulation' ? (next as 'PVC' | 'XLPE' | 'PILC') : undefined,
    armour: field === 'armour' ? (next as 'SWA' | 'UNARMOURED' | null) : undefined,
    installationMethod: field === 'installation_method'
      ? (next as 'DIRECT_IN_GROUND' | 'DUCT' | 'LADDER' | 'TRAY' | 'CLIPPED' | null) : undefined,
    depthMm: field === 'depth_mm' ? (next == null ? null : Number(next)) : undefined,
    groupedWith: field === 'grouped_with' ? Number(next) : undefined,
    ambientTempC: field === 'ambient_temp_c' ? Number(next) : undefined,
    measuredLengthM: field === 'measured_length_m' ? (next == null ? null : Number(next)) : undefined,
    ohmPerKmOverride: field === 'ohm_per_km_override' ? (next == null ? null : Number(next)) : undefined,
    tagOverride: field === 'tag_override' ? (next as string | null) : undefined,
    notes: field === 'notes' ? (next as string | null) : undefined,
  })
  if (res.error) { setLiveRows(prevRows); setLiveCables(prevCables); return { error: res.error } }
  // Reconcile SANS-derived fields from the server.
  if (res.recomputed) {
    setLiveRows((cur) => cur.map((r) => r.id === cableId
      ? {
          ...r,
          ohm_per_km: res.recomputed!.ohm_per_km,
          derated_rating_a: res.recomputed!.derated_current_rating_a ?? r.derated_rating_a,
          manual_override: field === 'ohm_per_km_override' ? r.manual_override : false,
        }
      : r))
  }
  return {}
}
```

- [ ] **Step 2: Replace the cable-level static cells with `EditableCell`**

In the row `.map`, replace each static `<Td>` for these columns. Each is a uniform application of `EditableCell` — all shown:

```tsx
{/* mm² */}
<Td align="right">
  <EditableCell type="select" align="right" disabled={locked || !canEdit}
    value={r.size_mm2} options={SIZE_OPTIONS}
    onSave={(n) => saveCableField(r.id, r.supply_id, 'size_mm2', n)} />
</Td>
{/* Cores */}
<Td align="center">
  <EditableCell type="select" align="center" disabled={locked || !canEdit}
    value={r.cores} options={CORES_OPTIONS}
    onSave={(n) => saveCableField(r.id, r.supply_id, 'cores', n)} />
</Td>
{/* Cond */}
<Td align="center">
  <EditableCell type="select" align="center" disabled={locked || !canEdit}
    value={r.conductor} options={CONDUCTOR_OPTIONS}
    onSave={(n) => saveCableField(r.id, r.supply_id, 'conductor', n)} />
</Td>
{/* Insul */}
<Td align="center">
  <EditableCell type="select" align="center" disabled={locked || !canEdit}
    value={r.insulation} options={INSULATION_OPTIONS}
    onSave={(n) => saveCableField(r.id, r.supply_id, 'insulation', n)} />
</Td>
{/* Ω/km — editable as the manual override; format keeps 4dp */}
<Td align="right">
  <EditableCell type="number" align="right" disabled={locked || !canEdit}
    value={r.ohm_per_km}
    format={(v) => fmt(typeof v === 'number' ? v : null, 4)}
    placeholder="(auto)"
    onSave={(n) => saveCableField(r.id, r.supply_id, 'ohm_per_km_override', n)} />
</Td>
{/* Meas (m) — replaces the existing setEditMeasured button */}
<Td align="right">
  <EditableCell type="number" align="right" disabled={locked || !canEdit}
    value={r.measured_length_m}
    format={(v) => fmt(typeof v === 'number' ? v : null, 1)}
    onSave={(n) => saveCableField(r.id, r.supply_id, 'measured_length_m', n)} />
</Td>
{/* Install */}
<Td>
  <EditableCell type="select" disabled={locked || !canEdit}
    value={r.installation_method} options={INSTALL_OPTIONS}
    onSave={(n) => saveCableField(r.id, r.supply_id, 'installation_method', n)} />
</Td>
{/* Depth */}
<Td align="right">
  <EditableCell type="number" align="right" disabled={locked || !canEdit}
    value={r.depth_mm}
    onSave={(n) => saveCableField(r.id, r.supply_id, 'depth_mm', n)} />
</Td>
{/* Grp */}
<Td align="right">
  <EditableCell type="number" align="right" disabled={locked || !canEdit}
    value={r.grouped_with}
    onSave={(n) => saveCableField(r.id, r.supply_id, 'grouped_with', n)} />
</Td>
{/* Notes */}
<Td style={{ fontFamily: 'inherit', maxWidth: 240 }}>
  <EditableCell type="text" disabled={locked || !canEdit}
    value={r.notes} placeholder=""
    onSave={(n) => saveCableField(r.id, r.supply_id, 'notes', n)} />
</Td>
```

The **Conf (m)** cell keeps its existing `ConfirmedLengthEditor` popover button (decision #8 — confirmed length carries the sign-off workflow). Leave the `editConfirmed` state + button as-is. Remove only the `editMeasured` state and the measured-length button (now an `EditableCell`).

`armour`, `ambient_temp_c`, and `tag_override` have no standalone column in the current grid. They are reachable from the add-cable form / tag schedule; expose them as columns only if requested later. `saveCableField` already supports all three.

- [ ] **Step 3: Remove the now-dead measured-length popover wiring**

Delete the `editMeasured` state, its `setEditMeasured` calls, and the `<MeasuredLengthEditor>` render block. Keep `MeasuredLengthEditor` *imported only if* still referenced elsewhere — otherwise drop it from the import. Keep `ConfirmedLengthEditor` and its wiring intact.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web type-check`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx"
git commit -m "feat(cable-schedule): C12 — editable cable-level cells with hybrid recompute"
```

### Task 11: Row-level delete affordance + blast-radius confirm

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx`

- [ ] **Step 1: Add a delete handler + confirm**

```ts
const [pendingDelete, setPendingDelete] = useState<ScheduleRow | null>(null)

async function confirmDeleteCable() {
  if (!pendingDelete) return
  const target = pendingDelete
  setPendingDelete(null)
  const prev = liveRows
  setLiveRows(liveRows.filter((r) => r.id !== target.id))
  const res = await deleteCableAction(target.id)
  if (res.error) {
    setLiveRows(prev)
    alert(`Could not delete: ${res.error}`)
  }
  // deleteCableAction revalidates; if it was the last cable on the supply,
  // the supply auto-cleanup is handled in Task 12's add/remove server logic
  // OR by the revalidated server render — see note in Step 3.
}
```

- [ ] **Step 2: Add a delete button to the first column of each row**

In the row `.map`, the leading 4px accent `<td>` becomes a tiny action cell when `canEdit && !locked`. Add next to the cloud-marker `Td`:

```tsx
{canEdit && !locked && (
  <Td align="center" style={{ padding: '4px 2px' }}>
    <button type="button" title="Delete cable"
      onClick={() => setPendingDelete(r)}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 12 }}>
      ✕
    </button>
  </Td>
)}
```

Add a matching `<Th w={28} />` to the header row when `canEdit && !locked`.

- [ ] **Step 3: Render the confirm dialog**

After the table, alongside the existing `editConfirmed` popover render:

```tsx
{pendingDelete && (
  <ConfirmDialog
    title="Delete cable"
    body={`Delete cable #${pendingDelete.cable_no} (${pendingDelete.from_label} → ${pendingDelete.to_label})? This also removes its terminations and tags. If it is the last cable on this run, the run is removed too.`}
    confirmLabel="Delete"
    onConfirm={confirmDeleteCable}
    onCancel={() => setPendingDelete(null)}
  />
)}
```

Add a small `ConfirmDialog` primitive at the bottom of the file (mirrors the `Popover` shape in `LengthEditPopover.tsx`):

```tsx
function ConfirmDialog({
  title, body, confirmLabel, onConfirm, onCancel,
}: {
  title: string; body: string; confirmLabel: string
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="data-panel" style={{ padding: 16, minWidth: 320, maxWidth: 440,
        display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--c-panel)' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--c-text)' }}>{title}</h3>
        <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: 0 }}>{body}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button type="button" onClick={onCancel} className="btn-primary-amber"
            style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="btn-primary-amber"
            style={{ background: '#dc2626', borderColor: '#dc2626' }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
```

Note on supply auto-cleanup: when the deleted cable is the last on its supply, the server still has an orphan supply row. Add the cleanup to `deleteCableAction` in `cable-entities.actions.ts` — after the cable delete, `SELECT count(*)` of cables on `supply_id`; if zero, delete the supply and `logDeletion` it. Add this in this step (it is a 6-line addition to the action written in Task 6).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web type-check`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx" apps/web/src/actions/cable-entities.actions.ts
git commit -m "feat(cable-schedule): C12 — row delete with blast-radius confirm + empty-supply cleanup"
```

### Task 12: Add-cable + re-point affordances

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx`

- [ ] **Step 1: Re-point — add From/To picker buttons on the From/To cells**

The From/To columns stay node references (decision #3), but get a small re-point picker when `canEdit && !locked`. Replace the static `<Td>{r.from_label}</Td>` / `<Td>{r.to_label}</Td>` with a button that opens a node-picker popover:

```tsx
const [repointing, setRepointing] = useState<{ row: ScheduleRow; end: 'from' | 'to' } | null>(null)

// in the row map:
<Td>
  {canEdit && !locked ? (
    <button type="button" style={editCellBtn} onClick={() => setRepointing({ row: r, end: 'from' })}>
      {r.from_label}
    </button>
  ) : r.from_label}
</Td>
<Td>
  {canEdit && !locked ? (
    <button type="button" style={editCellBtn} onClick={() => setRepointing({ row: r, end: 'to' })}>
      {r.to_label}
    </button>
  ) : r.to_label}
</Td>
```

- [ ] **Step 2: Render the re-point picker**

After the table:

```tsx
{repointing && (
  <RepointPicker
    end={repointing.end}
    current={repointing.end === 'from' ? repointing.row.from_node_id : repointing.row.to_node_id}
    nodeOptions={repointing.end === 'from' ? nodeOptions : nodeOptions.filter((n) => n.kind === 'board')}
    onCancel={() => setRepointing(null)}
    onPick={async (nodeId, kind) => {
      const { row, end } = repointing
      setRepointing(null)
      const res = await repointSupplyAction({
        supplyId: row.supply_id,
        ...(end === 'from'
          ? { fromSourceId: kind === 'source' ? nodeId : null, fromBoardId: kind === 'board' ? nodeId : null }
          : { toBoardId: nodeId }),
      })
      if (res.error) { alert(`Could not re-route: ${res.error}`) }
      // repointSupplyAction revalidates → fresh rows arrive via the useEffect re-seed.
    }}
  />
)}
```

Add the `RepointPicker` primitive at the bottom of the file — a `ConfirmDialog`-shaped modal containing a `<select>` of `nodeOptions` (label = `code`, grouped: sources first when `end === 'from'`), a Cancel button, and a "Re-route" button that calls `onPick(selectedId, selectedKind)`. `selectedKind` is `'source'` or `'board'` from the chosen `NodeOption`.

- [ ] **Step 3: Add-cable button**

The "Add to schedule" flow lives in `AddEntityPanel` (refactored in Task 14). The grid just needs a header-level "+ Add cable" affordance that opens that panel's cable tab — wire it in Task 15 when `page.tsx` composes the panels. No grid change needed in this step beyond a placeholder comment; the actual button is added in Task 15.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web type-check`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/CableScheduleGrid.tsx"
git commit -m "feat(cable-schedule): C12 — re-point From/To via node picker"
```

---

## Phase 5 — Nodes panel

### Task 13: `NodesPanel.tsx`

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/NodesPanel.tsx`

- [ ] **Step 1: Write the component**

A dedicated panel: lists nodes grouped by type, adds a node (type → short form), renames inline, deletes with a blast-radius confirm. It reuses `addSourceAction`, `addBoardAction`, `deleteSourceAction`, `deleteBoardAction` from `cable-entities.actions.ts`, plus two small new rename actions (Step 2). The blast-radius counts (`supplies` + `cables` touching a node) are passed in as props from `page.tsx` (computed server-side — `page.tsx` already has `supplies` + `cables` in scope).

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  addSourceAction, addBoardAction,
  deleteSourceAction, deleteBoardAction,
  renameSourceAction, renameBoardAction,
} from '@/actions/cable-entities.actions'

export interface PanelNode {
  id: string
  code: string
  category: 'source' | 'board'
  /** source.type or board.kind */
  nodeType: string
  /** count of supplies + cables that would cascade-delete with this node */
  blastSupplies: number
  blastCables: number
}

interface Props {
  revisionId: string
  nodes: PanelNode[]
  canEdit: boolean
}

const SOURCE_TYPES = [
  { value: 'COUNCIL_RMU', label: 'Council RMU' },
  { value: 'UTILITY', label: 'Utility' },
  { value: 'PV', label: 'PV plant' },
  { value: 'STANDBY', label: 'Standby generator' },
]
const BOARD_KINDS = [
  { value: 'CONSUMER_RMU', label: 'Consumer RMU' },
  { value: 'TRANSFORMER', label: 'Transformer / Minisub' },
  { value: 'MAIN_BOARD', label: 'Main board' },
  { value: 'SUB_BOARD', label: 'Sub board' },
]
const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  [...SOURCE_TYPES, ...BOARD_KINDS].map((t) => [t.value, t.label]),
)

export function NodesPanel({ revisionId, nodes, canEdit }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState<'source' | 'board' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<PanelNode | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <div style={{ marginBottom: 14 }}>
        <button type="button" className="btn-primary-amber" onClick={() => setOpen(true)}>
          ⚙ Manage nodes ({nodes.length})
        </button>
      </div>
    )
  }

  const grouped = [...SOURCE_TYPES, ...BOARD_KINDS].map((t) => ({
    type: t.value,
    label: t.label,
    items: nodes.filter((n) => n.nodeType === t.value),
  })).filter((g) => g.items.length > 0)

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null)
    startTransition(async () => {
      const r = await fn()
      if (r.error) { setError(r.error); return }
      setAdding(null)
      setConfirmDelete(null)
      router.refresh()
    })
  }

  return (
    <div className="data-panel" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Nodes</h3>
        <button type="button" onClick={() => setOpen(false)}
          style={{ background: 'none', border: 'none', color: 'var(--c-text-dim)', fontSize: 18, cursor: 'pointer' }}
          aria-label="Close nodes panel">×</button>
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: 10, padding: '6px 10px', borderRadius: 6,
          background: 'rgba(220,38,38,0.1)', color: '#dc2626', fontSize: 12 }}>✕ {error}</div>
      )}

      {grouped.map((g) => (
        <div key={g.type} style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 4 }}>{g.label}</div>
          {g.items.map((n) => (
            <NodeRow key={n.id} node={n} canEdit={canEdit} pending={pending}
              onRename={(code) => run(() => n.category === 'source'
                ? renameSourceAction(n.id, code) : renameBoardAction(n.id, code))}
              onDelete={() => setConfirmDelete(n)} />
          ))}
        </div>
      ))}

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn-primary-amber" onClick={() => setAdding('source')}>+ Origin node</button>
          <button type="button" className="btn-primary-amber" onClick={() => setAdding('board')}>+ Distribution node</button>
        </div>
      )}

      {adding && (
        <AddNodeForm category={adding} revisionId={revisionId} pending={pending}
          onCancel={() => setAdding(null)}
          onSubmit={(payload) => run(() => adding === 'source'
            ? addSourceAction(payload as never) : addBoardAction(payload as never))} />
      )}

      {confirmDelete && (
        <div role="dialog" aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="data-panel" style={{ padding: 16, minWidth: 340, maxWidth: 460,
            display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--c-panel)' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Remove node</h3>
            <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: 0 }}>
              Removing <strong>{confirmDelete.code}</strong> ({TYPE_LABEL[confirmDelete.nodeType]}) will also
              delete <strong>{confirmDelete.blastSupplies}</strong> suppl{confirmDelete.blastSupplies === 1 ? 'y' : 'ies'} and{' '}
              <strong>{confirmDelete.blastCables}</strong> cable{confirmDelete.blastCables === 1 ? '' : 's'}.
              {confirmDelete.category === 'board' && ' Child boards re-parent to top-level.'} Continue?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={() => setConfirmDelete(null)} className="btn-primary-amber"
                style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}>
                Cancel
              </button>
              <button type="button" disabled={pending} className="btn-primary-amber"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
                onClick={() => run(() => confirmDelete.category === 'source'
                  ? deleteSourceAction(confirmDelete.id) : deleteBoardAction(confirmDelete.id))}>
                {pending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NodeRow({
  node, canEdit, pending, onRename, onDelete,
}: {
  node: PanelNode; canEdit: boolean; pending: boolean
  onRename: (code: string) => void; onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [code, setCode] = useState(node.code)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      {editing ? (
        <input className="ob-input" value={code} autoFocus style={{ width: 200 }}
          onChange={(e) => setCode(e.target.value)}
          onBlur={() => { setEditing(false); if (code.trim() && code.trim() !== node.code) onRename(code.trim()) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') { setCode(node.code); setEditing(false) } }} />
      ) : (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, minWidth: 200 }}>
          {node.code}
        </span>
      )}
      {canEdit && !editing && (
        <>
          <button type="button" onClick={() => setEditing(true)} disabled={pending}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-dim)', fontSize: 11 }}>
            rename
          </button>
          <button type="button" onClick={onDelete} disabled={pending}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 11 }}>
            remove
          </button>
        </>
      )}
    </div>
  )
}

function AddNodeForm({
  category, revisionId, pending, onCancel, onSubmit,
}: {
  category: 'source' | 'board'
  revisionId: string
  pending: boolean
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const types = category === 'source' ? SOURCE_TYPES : BOARD_KINDS
  const [code, setCode] = useState('')
  const [nodeType, setNodeType] = useState(types[0].value)
  return (
    <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--c-border)', borderRadius: 6,
      display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div>
        <label className="ob-label" style={{ display: 'block', marginBottom: 4 }}>Code *</label>
        <input className="ob-input" value={code} onChange={(e) => setCode(e.target.value)}
          placeholder={category === 'source' ? 'COUNCIL RMU 1' : 'MAIN BOARD 1'} maxLength={80} />
      </div>
      <div>
        <label className="ob-label" style={{ display: 'block', marginBottom: 4 }}>Type *</label>
        <select className="ob-input" value={nodeType} onChange={(e) => setNodeType(e.target.value)}>
          {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <button type="button" onClick={onCancel} className="btn-primary-amber"
        style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', color: 'var(--c-text-mid)' }}>
        Cancel
      </button>
      <button type="button" disabled={pending || code.trim().length < 1} className="btn-primary-amber"
        onClick={() => onSubmit(category === 'source'
          ? { revisionId, code: code.trim(), type: nodeType }
          : { revisionId, code: code.trim(), kind: nodeType })}>
        {pending ? 'Adding…' : 'Add'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Add `renameSourceAction` / `renameBoardAction` + extend `addBoardAction` for `kind`**

In `cable-entities.actions.ts`:
- Extend `boardSchema` to include `kind: z.enum(['CONSUMER_RMU','TRANSFORMER','MAIN_BOARD','SUB_BOARD'])` and write it in `addBoardAction`'s insert.
- Extend `sourceSchema`'s `type` enum to `['COUNCIL_RMU','UTILITY','PV','STANDBY']` (matching the migration).
- Add:

```ts
const renameSchema = z.object({ id: uuid, code: z.string().trim().min(1).max(80) })

export async function renameSourceAction(id: string, code: string): Promise<{ ok?: true; error?: string }> {
  const parsed = renameSchema.safeParse({ id, code })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()
  const { data: src } = await (supabase as any)
    .schema('cable_schedule').from('sources')
    .select('revision_id, organisation_id, code').eq('id', id).single()
  const s = src as { revision_id?: string; organisation_id?: string; code?: string } | null
  if (!s?.revision_id) return { error: 'Source not found' }
  const guard = await assertDraft(supabase, s.revision_id)
  if ('error' in guard) return { error: guard.error }
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await (supabase as any)
    .schema('cable_schedule').from('sources').update({ code: parsed.data.code }).eq('id', id)
  if (error) return { error: error.message }
  await (supabase as any).schema('cable_schedule').from('change_log').insert({
    revision_id: s.revision_id, organisation_id: s.organisation_id,
    entity_type: 'source', entity_id: id, field_name: 'code',
    old_value: s.code, new_value: parsed.data.code, changed_by: user?.id ?? null,
  })
  revalidatePath(`/projects/${guard.projectId}/cables/${s.revision_id}`)
  return { ok: true }
}
```

Add `renameBoardAction` with the identical shape against the `boards` table (`entity_type: 'board'`).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web type-check`
Expected: no errors in `NodesPanel.tsx` or `cable-entities.actions.ts`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/NodesPanel.tsx" apps/web/src/actions/cable-entities.actions.ts
git commit -m "feat(cable-schedule): C12 — NodesPanel + rename actions + board.kind support"
```

### Task 14: Refactor `AddEntityPanel`

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx`

- [ ] **Step 1: Reduce to the cable-add flow only**

Remove the `'source'` and `'board'` tabs (now in `NodesPanel`) and the `'supply'` tab (supplies are now implicit). Keep only the cable flow. The `Tab` type becomes unused; remove the tab strip. The panel now:
- has a single `+ Add cable` trigger button (replaces `+ Add to schedule`)
- renders the existing `CableForm`, but `CableForm` now picks **From node + To node** (from `sources` + `boards` props) instead of picking a pre-existing supply.

- [ ] **Step 2: Change `CableForm` to pick From/To and create the supply implicitly**

`CableForm` currently takes `supplies: SupplyOption[]`. Change it to take `sources` + `boards` (`NodeOption[]`) and add From/To/voltage/load fields. On submit:
1. Resolve whether a supply already exists for the chosen (From, To) pair — pass an existing-supplies lookup as a prop from `page.tsx`, OR call a new `findOrCreateSupplyAction` that returns a `supplyId`.
2. Add the new `findOrCreateSupplyAction` to `cable-entities.actions.ts`:

```ts
const findOrCreateSupplySchema = z.object({
  revisionId: uuid,
  fromSourceId: uuid.nullable().optional(),
  fromBoardId: uuid.nullable().optional(),
  toBoardId: uuid,
  voltageV: z.number().positive(),
  designLoadA: z.number().positive(),
  section: z.enum(['NORMAL', 'EMERGENCY']).nullable().optional(),
})

export async function findOrCreateSupplyAction(
  input: z.infer<typeof findOrCreateSupplySchema>,
): Promise<{ supplyId?: string; error?: string }> {
  const parsed = findOrCreateSupplySchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const supabase = await createClient()
  const guard = await assertDraft(supabase, parsed.data.revisionId)
  if ('error' in guard) return { error: guard.error }

  // Existing supply for this (from, to) pair?
  let q = (supabase as any).schema('cable_schedule').from('supplies')
    .select('id').eq('revision_id', parsed.data.revisionId)
    .eq('to_board_id', parsed.data.toBoardId)
  q = parsed.data.fromSourceId
    ? q.eq('from_source_id', parsed.data.fromSourceId)
    : q.eq('from_board_id', parsed.data.fromBoardId)
  const { data: existing } = await q.maybeSingle()
  if (existing) return { supplyId: (existing as { id: string }).id }

  const { data, error } = await (supabase as any)
    .schema('cable_schedule').from('supplies')
    .insert({
      revision_id: parsed.data.revisionId,
      organisation_id: guard.orgId,
      from_source_id: parsed.data.fromSourceId ?? null,
      from_board_id: parsed.data.fromBoardId ?? null,
      to_board_id: parsed.data.toBoardId,
      voltage_v: parsed.data.voltageV,
      design_load_a: parsed.data.designLoadA,
      section: parsed.data.section ?? null,
    })
    .select('id').single()
  if (error) return { error: error.message }
  return { supplyId: (data as { id: string }).id }
}
```

3. `CableForm` calls `findOrCreateSupplyAction` → then the existing `addCableAction` with the returned `supplyId`. Voltage/load inputs are only required when the (From,To) pair is new; if it resolves to an existing supply, the cable inherits that supply's V/load (the form can fetch-and-disable those inputs, or simply always send them — `findOrCreateSupplyAction` ignores V/load when an existing supply is found).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web type-check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/AddEntityPanel.tsx" apps/web/src/actions/cable-entities.actions.ts
git commit -m "feat(cable-schedule): C12 — AddEntityPanel reduced to implicit-supply cable-add flow"
```

### Task 15: Wire `NodesPanel` into `page.tsx`

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx`

- [ ] **Step 1: Build the `PanelNode[]` with blast-radius counts**

`page.tsx` already has `sources`, `boards`, `supplies`, `cables`. Build the node list:

```tsx
import { NodesPanel, type PanelNode } from './NodesPanel'

// blast radius: supplies touching a node (as from or to), and cables on those supplies
function blastFor(nodeId: string, category: 'source' | 'board') {
  const hit = supplies.filter((s) =>
    category === 'source'
      ? s.from_source_id === nodeId
      : (s.from_board_id === nodeId || s.to_board_id === nodeId))
  const supplyIds = new Set(hit.map((s) => s.id))
  const cableCount = cables.filter((c) => supplyIds.has(c.supply_id)).length
  return { blastSupplies: hit.length, blastCables: cableCount }
}

const panelNodes: PanelNode[] = [
  ...sources.map((s) => ({
    id: s.id, code: s.code, category: 'source' as const, nodeType: s.type,
    ...blastFor(s.id, 'source'),
  })),
  ...boards.map((b) => ({
    id: b.id, code: b.code, category: 'board' as const, nodeType: (b as { kind: string }).kind,
    ...blastFor(b.id, 'board'),
  })),
]
```

Note: `page.tsx`'s `SourceRow` / `BoardRow` interfaces and the `boards` select must include `type` / `kind`. Extend the `boards` select string to add `kind`, and the `BoardRow` interface to add `kind: string`.

- [ ] **Step 2: Render `NodesPanel` above the grid**

Replace the existing `AddEntityPanel` mount (only shown when `revision.status === 'DRAFT'`) with both panels stacked:

```tsx
{revision.status === 'DRAFT' && (
  <>
    <NodesPanel revisionId={revision.id} nodes={panelNodes} canEdit={canEdit} />
    <AddEntityPanel
      revisionId={revision.id}
      sources={sources.map((s) => ({ id: s.id, code: s.code, kind: 'source' as const }))}
      boards={boards.map((b) => ({ id: b.id, code: b.code, kind: 'board' as const }))}
    />
  </>
)}
```

(`AddEntityPanel`'s props change in Task 14 — it no longer needs `supplies`. Match whatever signature Task 14 produced.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web type-check`
Expected: no new errors in `page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/page.tsx"
git commit -m "feat(cable-schedule): C12 — mount NodesPanel with blast-radius counts"
```

---

## Phase 6 — Verification

### Task 16: Full typecheck + staging migration + browser walkthrough

**Files:** none (verification).

- [ ] **Step 1: Full web typecheck**

Run: `pnpm --filter web type-check`
Expected: no errors in any C12 file (`cable-entities.actions.ts`, `EditableCell.tsx`, `CableScheduleGrid.tsx`, `NodesPanel.tsx`, `AddEntityPanel.tsx`, `page.tsx`). Pre-existing unrelated errors (per CLAUDE.md) are unchanged.

- [ ] **Step 2: Confirm the migration is applied to staging**

Migration `00054` was applied in Task 2. Re-verify the three constraints with the Task 2 Step 2 queries.

- [ ] **Step 3: Push the branch so Vercel builds a preview**

```bash
git push origin feat/powersync
```
Expected: Vercel auto-builds the `feat/powersync` preview.

- [ ] **Step 4: Browser walkthrough on the preview (per spec §12)**

On `https://esite-git-feat-powersync-arno-mattheus-projects.vercel.app/projects/.../cables/{revId}`:
- Edit a **voltage** cell → the volt-drop column for that row and its parallel siblings updates instantly; the cell shows ✓.
- Edit a **size** cell → Ω/km and derated-rating columns update within ~¼ s (the round-trip).
- Edit **measured length** → VD updates instantly; length status flips UNMEASURED→MEASURED.
- Open **Manage nodes** → add a Council RMU origin + a Transformer distribution node; rename one; delete one and confirm the blast-radius dialog shows correct supply/cable counts.
- **Add a cable** via the add-cable flow → pick From/To nodes; a new row appears.
- **Delete a cable** → confirm dialog; row disappears; if it was the last on its supply, the supply is gone too.
- **Re-point** a run's From or To → the row's From/To label changes; parallel cables on the same supply move together.
- Create a supply at **33 000 V** → accepted (no CHECK violation).
- Open an **ISSUED** revision → grid is read-only; no edit affordances.
- Open the **Diff viewer (C6)** → the edits show as changes; open **Cost Summary** + **Tags** tabs → they reflect the edits.

- [ ] **Step 5: Final commit if any walkthrough fixes were needed**

If the walkthrough surfaced bugs, fix them in the relevant task's file, re-typecheck, and commit with `fix(cable-schedule): C12 — <what>`. Otherwise no commit — C12 is complete on `feat/powersync`, ready for the FF-to-main decision (a separate step, not part of this plan).

---

## Self-Review

**1. Spec coverage:**
- §2 migration bundle → Tasks 1–2. ✓
- §2 node-management panel → Tasks 13–15. ✓
- §2 live-edit grid → Tasks 7–10. ✓
- §2 re-pointing → Task 12. ✓
- §2 add/remove cables → Tasks 11 (remove), 12+14 (add). ✓
- §2 edit actions + change_log → Tasks 3–6. ✓
- §4.3 migration steps 1–5 → Task 1 Step 2 covers voltage CHECK, boards.kind backfill, sources reconciliation. ✓
- §5 node panel (list/add/rename/delete) → Task 13. ✓
- §6.1 editable cell set → Tasks 9–10 (voltage, load, size, cores, conductor, insulation, install method, depth, grouped-with, measured length, Ω/km override, notes). `armour`, `ambient_temp_c`, `tag_override` are supported by `saveCableField`/`updateCableAction` but have no current grid column — explicitly noted in Task 10 Step 2. ✓ (minor: spec lists them as editable; plan supports them at the action layer and flags the missing columns rather than inventing layout.)
- §6.2 cell behaviour (click-to-edit, blur/Tab/Enter/Escape, state machine) → Task 7 `EditableCell`. ✓
- §6.3 hybrid recompute → Task 8 (client VD) + Task 4 (server SANS lookup) + Task 10 (reconcile from `res.recomputed`). ✓
- §7 add cable / re-point → Tasks 12, 14. ✓
- §8 delete & blast-radius + empty-route cleanup → Tasks 6, 11, 13. ✓
- §9 server actions & change_log → Tasks 3–6. ✓
- §10 concurrency (last-write-wins via revalidate), ISSUED lock (`assertDraft` + `locked`/`canEdit`), role gating (`editDesignFields`) → Tasks 3–5 (server guards), Task 8 (`canEdit` prop). ✓
- §11 file list → matches the File Structure table. ✓
- §12 verification → Task 16. ✓

**2. Placeholder scan:** No "TBD"/"TODO"/"handle edge cases". Task 1 Step 1 defers exact constraint *names* to a lookup query (justified — Postgres auto-names aren't knowable without querying) but the migration body is fully written. Task 12 Step 3 intentionally defers the add-cable *button placement* to Task 15 where `page.tsx` composes the panels — cross-referenced, not a hole.

**3. Type consistency:** `updateSupplyAction` / `updateCableAction` / `repointSupplyAction` / `findOrCreateSupplyAction` input shapes match their call sites in `CableScheduleGrid.tsx` and `AddEntityPanel.tsx`. `ScheduleRow` (Task 8) adds `supply_id`, `from_node_id`, `to_node_id`, `armour`, `section`, `ambient_temp_c` — all consumed in Tasks 9–12. `PanelNode` (Task 13) matches the `panelNodes` builder in Task 15. `NodeOption` is defined in Task 8 and reused in Task 12. `EditableCell` props (Task 7) match every call site in Tasks 9–10. `recomputed` shape returned by `updateCableAction` (Task 4) matches the reconcile block in Task 10 Step 1.

---

## Execution Handoff

Plan complete and saved to `docs/cable-schedule-c12-editable-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with batch checkpoints.

Which approach?
