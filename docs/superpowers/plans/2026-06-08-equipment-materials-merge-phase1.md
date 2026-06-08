# Equipment & Materials merge — Phase 1 (structural lock) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee that every equipment board always has exactly one equipment `node_orders` row, enforced by a database trigger on `structure.nodes` insert — so a board can never again be silently missing from the buy-list (Part A #2 root cause / spec D5 + D9).

**Architecture:** A `SECURITY DEFINER` `AFTER INSERT` trigger on `structure.nodes` creates the equipment order for any equipment-kind node, from any insert path (UI action, bulk import, manual SQL). The existing app-level insert in `createEquipmentNodeAction` is made **conflict-tolerant** in the same change so it becomes a harmless no-op once the trigger owns creation — this avoids any deploy-order window. Full removal of the now-redundant app insert is a trivial follow-up after prod confirmation.

**Tech Stack:** Postgres (Supabase, `structure` schema), the Management API helper (`scripts/db/mgmt-api.sh`), Next.js server action (`equipment.actions.ts`), vitest.

**Branch:** `feat/equipment-order-trigger`, off `main`. Independent of PR #42 (touches a different file, `equipment.actions.ts`, plus a new migration).

**Scope note:** This is Phase 1 of the spec `docs/superpowers/specs/2026-06-08-equipment-materials-merge-design.md`. Phase 2 (unified route + master-detail UI) and Phase 3 (cutover/redirects) are large enough to warrant their own plans, written after Phase 1 lands. See "Subsequent phases" at the end.

---

### Task 1: Migration 00121 — equipment-order trigger

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00121_equipment_order_trigger.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration 00121 — equipment node_order auto-create trigger (spec D9)
-- =============================================================================
-- Every equipment node (kind <> 'tenant_db'/'sub_board') must have exactly one
-- equipment node_order (scope_item_type_id IS NULL, status 'required') so it
-- always surfaces in the Material Order Tracker. createEquipmentNodeAction
-- created this for UI-added equipment, but nodes added by any OTHER path (bulk
-- import, manual SQL) skipped it — which is how 6 Kings Walk common-area boards
-- ended up absent from Materials despite the one-time backfill 00089.
--
-- This trigger enforces the invariant at the source: an equipment order is
-- created in the same statement as the node, on every insert path. Idempotent —
-- the partial unique index idx_node_orders_equipment_unique plus the NOT EXISTS
-- guard make a duplicate impossible and re-runs a no-op.
-- =============================================================================

CREATE OR REPLACE FUNCTION structure.create_equipment_node_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = structure, public
AS $$
BEGIN
  -- Equipment kinds = the EQUIPMENT_KINDS set in @esite/shared
  -- (everything except 'tenant_db' and 'sub_board').
  IF NEW.kind IN (
    'rmu', 'mini_sub', 'generator', 'main_board',
    'common_area_board', 'common_area_lighting', 'custom'
  ) THEN
    INSERT INTO structure.node_orders
      (node_id, project_id, organisation_id, label, scope_item_type_id, status)
    SELECT NEW.id, NEW.project_id, NEW.organisation_id, NEW.code, NULL, 'required'
    WHERE NOT EXISTS (
      SELECT 1 FROM structure.node_orders o
      WHERE o.node_id = NEW.id AND o.scope_item_type_id IS NULL
    );
  END IF;
  RETURN NEW;
END;
$$;

-- SECURITY DEFINER functions must not be PUBLIC-executable (project convention).
REVOKE EXECUTE ON FUNCTION structure.create_equipment_node_order() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_create_equipment_node_order ON structure.nodes;
CREATE TRIGGER trg_create_equipment_node_order
  AFTER INSERT ON structure.nodes
  FOR EACH ROW
  EXECUTE FUNCTION structure.create_equipment_node_order();

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Commit the migration file**

```bash
git add apps/edge-functions/supabase/migrations/00121_equipment_order_trigger.sql
git commit -m "feat(db): 00121 equipment-order trigger on node insert (D9)"
```

---

### Task 2: Transactional smoke test for the trigger

**Files:**
- Create: `scripts/db/smoke-test-equipment-order-trigger.sh`

- [ ] **Step 1: Write the smoke test**

```bash
#!/usr/bin/env bash
# Smoke test for migration 00121 — the equipment-order trigger.
# Transactional + self-rolling-back: a sentinel RAISE aborts the DO block so the
# test nodes/orders never persist. Run AFTER the migration is applied.
#   bash scripts/db/smoke-test-equipment-order-trigger.sh
set -euo pipefail
. "$(dirname "$0")/mgmt-api.sh"

SQL=$(cat <<'EOSQL'
DO $$
DECLARE v_node uuid; v_orders int; v_pid uuid; v_org uuid;
BEGIN
  SELECT id, organisation_id INTO v_pid, v_org FROM projects.projects WHERE code = '636' LIMIT 1;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'FAIL: Kings Walk project not found'; END IF;

  -- equipment node → trigger must create exactly one equipment order
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, status)
    VALUES (v_pid, v_org, 'main_board', 'SMOKE-TRG-MB', 'active') RETURNING id INTO v_node;
  SELECT count(*) INTO v_orders FROM structure.node_orders
    WHERE node_id = v_node AND scope_item_type_id IS NULL;
  IF v_orders <> 1 THEN RAISE EXCEPTION 'FAIL: equipment node got % equipment orders (want 1)', v_orders; END IF;

  -- tenant node → trigger must create NO equipment order
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, status)
    VALUES (v_pid, v_org, 'tenant_db', 'SMOKE-TRG-TN', 'active') RETURNING id INTO v_node;
  SELECT count(*) INTO v_orders FROM structure.node_orders
    WHERE node_id = v_node AND scope_item_type_id IS NULL;
  IF v_orders <> 0 THEN RAISE EXCEPTION 'FAIL: tenant node got % equipment orders (want 0)', v_orders; END IF;

  -- sentinel: abort so nothing persists
  RAISE EXCEPTION 'SMOKE_OK_ROLLBACK';
END $$;
EOSQL
)

if mgmt_query "$SQL" 2>&1 | grep -q 'SMOKE_OK_ROLLBACK'; then
  echo "PASS: equipment-order trigger creates 1 order for equipment, 0 for tenant (rolled back)"
else
  echo "FAIL: see error above"; exit 1
fi
```

- [ ] **Step 2: Commit (smoke test runs in Task 3, after the migration is applied)**

```bash
git add scripts/db/smoke-test-equipment-order-trigger.sh
git commit -m "test(db): smoke test for the 00121 equipment-order trigger"
```

---

### Task 3: Apply migration 00121 to prod + verify + record ledger

> CHECKPOINT — this writes to the production database. Confirm before running. The change is additive (a trigger) and reversible (`DROP TRIGGER trg_create_equipment_node_order ON structure.nodes;`).

- [ ] **Step 1: Apply the migration**

```bash
cd /Users/spud/Developer/ESITE.V1/esite
. scripts/db/mgmt-api.sh
mgmt_apply_sql_file apps/edge-functions/supabase/migrations/00121_equipment_order_trigger.sql
```
Expected: JSON array (no `{"message": ...}` error).

- [ ] **Step 2: Run the smoke test**

```bash
bash scripts/db/smoke-test-equipment-order-trigger.sh
```
Expected: `PASS: equipment-order trigger creates 1 order for equipment, 0 for tenant (rolled back)`

- [ ] **Step 3: Record the migration in the ledger (Management-API applies don't, causing CLI drift)**

```bash
. scripts/db/mgmt-api.sh
mgmt_query "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('00121') ON CONFLICT DO NOTHING;"
```
Expected: success. (The deploy-migrations workflow then no-ops 00121 on the PR merge.)

- [ ] **Step 4: Verify the trigger is registered**

```bash
. scripts/db/mgmt-api.sh
mgmt_query "SELECT tgname FROM pg_trigger WHERE tgname = 'trg_create_equipment_node_order';" | jq -r '.[].tgname'
```
Expected: `trg_create_equipment_node_order`

---

### Task 4: Make `createEquipmentNodeAction`'s order insert conflict-tolerant

**Files:**
- Modify: `apps/web/src/actions/equipment.actions.ts` (the order-insert block, ~lines 216–221)
- Test: `apps/web/src/actions/equipment.actions.test.ts`

- [ ] **Step 1: Write the failing test** — append to the "happy path" describe block in `equipment.actions.test.ts`:

```typescript
  it('treats a duplicate node_orders insert (trigger already created it) as success', async () => {
    createClientMock.mockResolvedValue(mockClient())
    const fetchMock = vi.fn()
      // 1) node insert → representation [{id}]
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([{ id: 'node-9' }]) })
      // 2) node_orders insert → 409 conflict (the 00121 trigger won the race)
      .mockResolvedValueOnce({ ok: false, status: 409, text: () => Promise.resolve('duplicate key value violates unique constraint "idx_node_orders_equipment_unique"') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await createEquipmentNodeAction(UUID, 'main_board', 'MB-1', '', true)
    expect(res).toEqual({ id: 'node-9' })
    expect(revalidatePathMock).toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/actions/equipment.actions.test.ts -t "duplicate node_orders"`
Expected: FAIL — the action currently returns `{ error: "Equipment node created but order derivation failed (HTTP 409): ..." }`, not `{ id: 'node-9' }`.

- [ ] **Step 3: Make the insert conflict-tolerant** — in `equipment.actions.ts`, replace the order-insert error block:

```typescript
    if (!orderRes.ok) {
      const text = await orderRes.text()
      // Node was created; derivation failure is surfaced but does NOT undo the node.
      revalidatePath(`/projects/${projectId}/equipment-schedule`)
      return { error: `Equipment node created but order derivation failed (HTTP ${orderRes.status}): ${text.slice(0, 400)}` }
    }
```

with:

```typescript
    if (!orderRes.ok) {
      const text = await orderRes.text()
      // Migration 00121 adds a trigger that auto-creates this equipment order on
      // node insert. A unique-violation here just means the trigger already
      // created it — treat as success. (The app insert is kept tolerant for
      // deploy safety; it is removed in the Phase-1 follow-up once the trigger
      // is confirmed in prod.)
      const isDuplicate = orderRes.status === 409 || /duplicate|unique|23505/i.test(text)
      if (!isDuplicate) {
        revalidatePath(`/projects/${projectId}/equipment-schedule`)
        return { error: `Equipment node created but order derivation failed (HTTP ${orderRes.status}): ${text.slice(0, 400)}` }
      }
    }
```

- [ ] **Step 4: Run the equipment action tests**

Run: `pnpm --filter web exec vitest run src/actions/equipment.actions.test.ts`
Expected: PASS — all 6 tests (5 existing + the new duplicate-tolerant one). The existing happy-path test still passes because its mocked node_orders POST returns `ok: true`.

- [ ] **Step 5: Type-check**

Run: `pnpm --filter web type-check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/actions/equipment.actions.ts apps/web/src/actions/equipment.actions.test.ts
git commit -m "fix(equipment): tolerate duplicate order insert now the 00121 trigger owns creation"
```

---

### Task 5: Push + open PR

- [ ] **Step 1: Push the branch**

```bash
cd /Users/spud/Developer/ESITE.V1/esite
git push "https://x-access-token:$(gh auth token)@github.com/WattMatt/e-site.git" feat/equipment-order-trigger
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --head feat/equipment-order-trigger \
  --title "feat(db): equipment-order trigger — every equipment board always has an order (D9)" \
  --body "Phase 1 of the Equipment & Materials merge (spec 2026-06-08-equipment-materials-merge-design.md). Migration 00121 adds an AFTER INSERT trigger on structure.nodes that auto-creates the equipment node_order for any equipment-kind node, from any insert path — closing the Part A #2 root cause structurally. createEquipmentNodeAction's order insert is made conflict-tolerant so it is a harmless no-op once the trigger owns creation. Smoke-tested on prod (transactional, rolled back); migration applied + ledger recorded. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: Verify the ledger means the workflow no-ops** — confirm the deploy-migrations run on merge reports 00121 already applied (no re-run).

---

## Self-review (against spec D9 / §7)

- ✅ Trigger fires on every insert path (AFTER INSERT FOR EACH ROW) → spec "from the UI, a bulk import, or a manual insert".
- ✅ Equipment kinds only (`tenant_db`/`sub_board` excluded) → matches EQUIPMENT_KINDS.
- ✅ Idempotent (`NOT EXISTS` + partial unique index) → spec "if one does not already exist".
- ✅ `REVOKE EXECUTE … FROM PUBLIC` → spec "per the project's SECURITY DEFINER convention".
- ✅ INSERT-only (decommission/reactivate/code-rename untouched) → spec §7 note.
- ⚠️ Spec says "remove the redundant app-level insert". This plan makes it **tolerant** in Phase 1 (deploy-safe: no window where a live trigger + old app insert produce a false "order derivation failed") and defers the one-line removal to a follow-up after prod confirmation. Rationale recorded in Task 4 Step 3 and the migration header.

## Subsequent phases (separate plans, written after Phase 1 lands)

- **Phase 2 — unified route + master-detail UI.** New `/projects/[id]/equipment-materials` page reading board-first (nodes ← orders ← docs); collapsible kind groups incl. "Tenant / Shop Boards"; master board rows + expandable procurement detail; reuse Part-A `OrderDocSlot`/`ShopDrawingList`/`naturalCompare`/`file-open`; fold `KindGroup` (board management) + `OrderRow` (procurement) into board-centric rows. Branch off `main` after PR #42 + Phase 1 merge (needs the Part-A helpers).
- **Phase 3 — cutover.** Single sidebar nav entry "Equipment & Materials"; redirect `/equipment-schedule` + `/materials` → the new route; retire the old pages once at parity; update `docs/rbac-matrix.md`.
