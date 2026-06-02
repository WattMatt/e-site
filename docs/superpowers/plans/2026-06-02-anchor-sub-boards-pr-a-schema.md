# Anchor Sub-Boards — PR-A (Schema + Smoke) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the database foundation for anchor tenants whose internal reticulation is a tree of sub-distribution-boards — a self-referential `parent_node_id` containment tree on `structure.nodes`, a `sub_board` node kind, and a `structure.tenant_units` table for multi-unit leases — with a re-runnable smoke test proving every integrity guarantee.

**Architecture:** One additive, idempotent migration (`00116`). Containment is a general tree over all nodes (`parent_node_id`), independent of the electrical feed graph; a node's "owning lease" is its nearest `tenant_db` ancestor. Same-project parents are enforced by a composite FK; cycles by a CHECK (direct) plus a trigger (transitive). No app/TS code changes in this PR — TypeScript types land in PR-B where they are first consumed.

**Tech Stack:** PostgreSQL (Supabase, project ref `cbskbnvvgcybmfikxgky`), SQL migrations under `apps/edge-functions/supabase/migrations/`, Supabase Management API via `scripts/db/mgmt-api.sh`, Bash smoke tests.

---

## Context the implementer needs

- **Spec:** `docs/superpowers/specs/2026-06-02-anchor-tenant-sub-boards-design.md` (§4.2 = this PR; §4.1 = the owning-lease rule that PR-B will implement).
- **Migrations are applied to the REMOTE Supabase DB via the Management API** (`mgmt_apply_sql_file`), not a local stack. The migration is **additive and backward-compatible** — no running code references `parent_node_id`, `sub_board`, or `tenant_units`, so applying it to production changes nothing observable. ⚠ Task 3 touches production; it is safe, but it is a real write.
- **Idempotent on purpose** (mirrors `00090`): every statement is `IF NOT EXISTS` / `DROP … IF EXISTS` guarded, so re-running it — including the `deploy-migrations.yml` workflow re-running it on merge to `main` — is harmless. After applying via the Management API we also record the ledger version so the workflow simply no-ops (see the known gotcha about Management-API ledger drift).
- **Do NOT regenerate `packages/db/src/types.ts` in this PR.** No TS consumes the new schema yet; PR-B regenerates/patches types as its first task. (Avoids the `db:gen-types --local` vs remote question here.)
- **`ON DELETE NO ACTION` is deliberate** on the self-FK — see the migration header comment. Do not "fix" it to `RESTRICT` (breaks the project-delete cascade) or `CASCADE` (silently deletes sub-boards).

## File structure

- **Create** `apps/edge-functions/supabase/migrations/00116_anchor_sub_boards.sql` — the entire schema change (one cohesive, idempotent migration).
- **Create** `scripts/db/smoke-test-anchor-sub-boards.sh` — re-runnable, transactional (ROLLBACK) smoke test; mirrors `scripts/db/smoke-test-project-settings.sh`.

No other files change in PR-A.

---

## Task 1: Write migration `00116`

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00116_anchor_sub_boards.sql`

- [ ] **Step 1: Create the migration file** with exactly this content:

```sql
-- =============================================================================
-- Migration 00116 — anchor sub-boards: node containment tree + multi-unit
-- =============================================================================
-- Adds the schema foundation for modelling anchor tenants whose internal
-- reticulation is a tree of sub-distribution-boards:
--
--   + structure.nodes.parent_node_id  — general self-referential containment
--       tree over ALL nodes. Same-project parent enforced by a composite FK;
--       cycles blocked by a CHECK (direct) + trigger (transitive).
--   + new node kind 'sub_board'
--   + structure.tenant_units          — ADDITIONAL units for a multi-unit lease
--
-- Containment is independent of the electrical FEED graph (cable_schedule
-- supplies). A node's "owning lease" is its nearest tenant_db ancestor.
--
-- ON DELETE policy for the self-FK is NO ACTION (NOT restrict): NO ACTION is
-- checked at end-of-statement, so it (a) blocks deleting a single board that
-- still has children, yet (b) still lets a projects.projects cascade delete
-- tear the whole node tree down in one statement. RESTRICT is immediate and
-- would break the project cascade; CASCADE would silently delete sub-boards.
--
-- Non-destructive. Idempotent (safe to re-run; mirrors 00090's style).
-- Apply via the controller (mgmt_apply_sql_file), then record the ledger row.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Containment link: parent_node_id + same-project composite FK + index
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE structure.nodes ADD COLUMN IF NOT EXISTS parent_node_id UUID;

-- Recreate the unique + FK idempotently (drop FK before its target unique).
ALTER TABLE structure.nodes DROP CONSTRAINT IF EXISTS nodes_parent_fk;
ALTER TABLE structure.nodes DROP CONSTRAINT IF EXISTS nodes_project_id_key;

-- (project_id, id) unique backs the composite FK below. id is already PK so
-- this is trivially satisfied; it exists only to be a valid FK target.
ALTER TABLE structure.nodes ADD CONSTRAINT nodes_project_id_key UNIQUE (project_id, id);

-- Parent must live in the SAME project. MATCH SIMPLE: when parent_node_id IS
-- NULL the FK is not checked (root nodes), so this only constrains children.
ALTER TABLE structure.nodes ADD CONSTRAINT nodes_parent_fk
  FOREIGN KEY (project_id, parent_node_id)
  REFERENCES structure.nodes (project_id, id)
  ON DELETE NO ACTION;

CREATE INDEX IF NOT EXISTS idx_structure_nodes_parent
  ON structure.nodes (parent_node_id)
  WHERE parent_node_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Cycle guards: direct (CHECK) + transitive (trigger)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE structure.nodes DROP CONSTRAINT IF EXISTS nodes_no_self_parent;
ALTER TABLE structure.nodes ADD CONSTRAINT nodes_no_self_parent
  CHECK (parent_node_id IS NULL OR parent_node_id <> id);

CREATE OR REPLACE FUNCTION structure.nodes_prevent_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  cur  UUID := NEW.parent_node_id;
  hops INT  := 0;
BEGIN
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION
        'structure.nodes: parent_node_id % would create a cycle for node %',
        NEW.parent_node_id, NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    hops := hops + 1;
    IF hops > 100 THEN
      RAISE EXCEPTION
        'structure.nodes: ancestor chain too deep (possible cycle) at node %',
        NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT parent_node_id INTO cur FROM structure.nodes WHERE id = cur;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS structure_nodes_prevent_cycle ON structure.nodes;
CREATE TRIGGER structure_nodes_prevent_cycle
  BEFORE INSERT OR UPDATE OF parent_node_id ON structure.nodes
  FOR EACH ROW
  WHEN (NEW.parent_node_id IS NOT NULL)
  EXECUTE FUNCTION structure.nodes_prevent_cycle();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Extend the node kind set with 'sub_board' (mirrors 00090's drop/re-add)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class     rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'structure'
    AND rel.relname = 'nodes'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%kind%'
    AND pg_get_constraintdef(con.oid) ILIKE '%tenant_db%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE structure.nodes DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE structure.nodes
  ADD CONSTRAINT nodes_kind_check CHECK (kind IN (
    'tenant_db',
    'main_board',
    'common_area_board',
    'common_area_lighting',
    'rmu',
    'mini_sub',
    'generator',
    'custom',
    'sub_board'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. structure.tenant_units — ADDITIONAL units for a multi-unit lease.
--    The node's own shop_number/shop_area_m2 remain the PRIMARY unit; this
--    table holds additional units only. RLS mirrors tenant_scope_items (00080):
--    read = project member (+ client_viewer read-only); write = owner/admin/PM.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS structure.tenant_units (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id     UUID        NOT NULL REFERENCES structure.nodes(id) ON DELETE CASCADE,
    shop_number TEXT,
    area_m2     NUMERIC,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_units_node
    ON structure.tenant_units (node_id);

DROP TRIGGER IF EXISTS tenant_units_updated_at ON structure.tenant_units;
CREATE TRIGGER tenant_units_updated_at
    BEFORE UPDATE ON structure.tenant_units
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE structure.tenant_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_units_select_members ON structure.tenant_units;
CREATE POLICY tenant_units_select_members ON structure.tenant_units
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      WHERE n.id = structure.tenant_units.node_id
        AND public.user_has_project_access(n.project_id)
        AND NOT public.user_is_client_viewer(n.organisation_id)
    )
  );

DROP POLICY IF EXISTS tenant_units_select_client_viewer ON structure.tenant_units;
CREATE POLICY tenant_units_select_client_viewer ON structure.tenant_units
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      WHERE n.id = structure.tenant_units.node_id
        AND public.user_is_client_viewer(n.organisation_id)
        AND public.user_has_project_access(n.project_id)
    )
  );

DROP POLICY IF EXISTS tenant_units_insert ON structure.tenant_units;
CREATE POLICY tenant_units_insert ON structure.tenant_units
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.tenant_units.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

DROP POLICY IF EXISTS tenant_units_update ON structure.tenant_units;
CREATE POLICY tenant_units_update ON structure.tenant_units
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.tenant_units.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

DROP POLICY IF EXISTS tenant_units_delete ON structure.tenant_units;
CREATE POLICY tenant_units_delete ON structure.tenant_units
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.tenant_units.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PostgREST schema reload (column + table add; no schema CREATE/DROP, so a
--    NOTIFY is enough — a full PostgREST config PATCH is not required here).
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Dry-run the whole migration in a rolled-back transaction** (validates syntax + checks it against real production data without persisting):

Run:
```bash
cd /Users/spud/Developer/ESITE.V1/esite
. scripts/db/mgmt-api.sh
MIG="$(cat apps/edge-functions/supabase/migrations/00116_anchor_sub_boards.sql)"
mgmt_query "BEGIN; ${MIG} ROLLBACK;" >/dev/null && echo "DRY-RUN OK"
```
Expected: prints `DRY-RUN OK` and exits 0. A non-zero exit prints `Supabase API error: …` — read it, fix the SQL in the migration file, and re-run. (The `$$`-quoted function body survives because `${MIG}` is expanded once, not re-scanned.)

- [ ] **Step 3: Commit the migration file**

```bash
cd /Users/spud/Developer/ESITE.V1/esite
git add apps/edge-functions/supabase/migrations/00116_anchor_sub_boards.sql
git commit -m "feat(structure): migration 00116 — node containment tree + sub_board kind + tenant_units

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Write the smoke test (and watch it fail RED)

**Files:**
- Create: `scripts/db/smoke-test-anchor-sub-boards.sh`

- [ ] **Step 1: Create the smoke-test script** with exactly this content:

```bash
#!/usr/bin/env bash
# Smoke-test the anchor sub-boards schema (migration 00116).
# Read-only catalog checks + transactional INSERT/UPDATE/DELETE round-trips
# that ROLLBACK at the end. Safe to run against production.
#
# Usage:  scripts/db/smoke-test-anchor-sub-boards.sh
# Exit:   0 on full green, non-zero on any failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }
section() { echo ""; echo "── $1 ──"; }

FAILED=0

# Reusable SQL fragment: pick any org + profile for fixture inserts.
ORG="(SELECT id FROM public.organisations LIMIT 1)"
WHO="(SELECT id FROM public.profiles LIMIT 1)"

section "1. parent_node_id column exists on structure.nodes"
N=$(mgmt_query "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='structure' AND table_name='nodes' AND column_name='parent_node_id';" | jq -r '.[0].n')
[[ "$N" == "1" ]] && pass "parent_node_id present" || fail "parent_node_id missing (got $N)"

section "2. constraints / index / trigger exist"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='structure.nodes'::regclass AND conname IN ('nodes_parent_fk','nodes_project_id_key','nodes_no_self_parent');" | jq -r '.[0].n')
[[ "$N" == "3" ]] && pass "parent FK + unique + self-parent CHECK present" || fail "expected 3 constraints, got $N"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid='structure.nodes'::regclass AND tgname='structure_nodes_prevent_cycle';" | jq -r '.[0].n')
[[ "$N" == "1" ]] && pass "cycle trigger present" || fail "cycle trigger missing (got $N)"

section "3. kind CHECK now includes sub_board"
OK=$(mgmt_query "SELECT (pg_get_constraintdef(oid) ILIKE '%sub_board%') AS ok FROM pg_constraint WHERE conrelid='structure.nodes'::regclass AND conname='nodes_kind_check';" | jq -r '.[0].ok')
[[ "$OK" == "true" ]] && pass "sub_board accepted by kind CHECK" || fail "kind CHECK missing sub_board"

section "4. tenant_units table + RLS + 5 policies"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='structure' AND tablename='tenant_units' AND rowsecurity;" | jq -r '.[0].n')
[[ "$N" == "1" ]] && pass "tenant_units exists with RLS enabled" || fail "tenant_units missing or RLS off (got $N)"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='structure' AND tablename='tenant_units';" | jq -r '.[0].n')
[[ "$N" == "5" ]] && pass "5 RLS policies present" || fail "expected 5 policies, got $N"

section "5. POSITIVE: sub_board child links to its tenant_db parent (same project)"
RESULT=$(mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-ANCHOR-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'SMOKE-ANCHOR', 'Smoke Anchor'
  FROM projects.projects p WHERE p.name='SMOKE-ANCHOR-DNC';
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name, parent_node_id)
  SELECT p.id, p.organisation_id, 'sub_board', 'SMOKE-SUB', 'Smoke Sub',
         (SELECT n.id FROM structure.nodes n WHERE n.project_id=p.id AND n.code='SMOKE-ANCHOR')
  FROM projects.projects p WHERE p.name='SMOKE-ANCHOR-DNC';
SELECT (child.parent_node_id = parent.id) AS link_ok, child.kind AS sub_kind
  FROM structure.nodes child
  JOIN projects.projects p ON p.id=child.project_id AND p.name='SMOKE-ANCHOR-DNC'
  JOIN structure.nodes parent ON parent.project_id=p.id AND parent.code='SMOKE-ANCHOR'
  WHERE child.code='SMOKE-SUB';
ROLLBACK;
")
LINK=$(echo "$RESULT" | jq -r '.[0].link_ok')
KIND=$(echo "$RESULT" | jq -r '.[0].sub_kind')
[[ "$LINK" == "true" ]] && pass "child.parent_node_id = parent.id" || fail "parent link wrong ($LINK)"
[[ "$KIND" == "sub_board" ]] && pass "sub_board row inserted" || fail "sub_board kind rejected ($KIND)"

section "6. NEGATIVE: self-parent is rejected"
if ! mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-SELF-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'SELF', 'Self' FROM projects.projects p WHERE p.name='SMOKE-SELF-DNC';
UPDATE structure.nodes n SET parent_node_id = n.id
  WHERE n.code='SELF' AND n.project_id=(SELECT id FROM projects.projects WHERE name='SMOKE-SELF-DNC');
ROLLBACK;
" >/dev/null 2>&1; then pass "self-parent rejected"; else fail "self-parent was NOT rejected"; fi

section "7. NEGATIVE: cross-project parent is rejected"
if ! mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-P1-DNC', $ORG, $WHO;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-P2-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'N1', 'N1' FROM projects.projects p WHERE p.name='SMOKE-P1-DNC';
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'N2', 'N2' FROM projects.projects p WHERE p.name='SMOKE-P2-DNC';
UPDATE structure.nodes n
  SET parent_node_id = (SELECT n2.id FROM structure.nodes n2 JOIN projects.projects p2 ON p2.id=n2.project_id
                        WHERE p2.name='SMOKE-P2-DNC' AND n2.code='N2')
  WHERE n.code='N1' AND n.project_id=(SELECT id FROM projects.projects WHERE name='SMOKE-P1-DNC');
ROLLBACK;
" >/dev/null 2>&1; then pass "cross-project parent rejected"; else fail "cross-project parent was NOT rejected"; fi

section "8. NEGATIVE: a transitive cycle is rejected"
if ! mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-CYC-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'A', 'A' FROM projects.projects p WHERE p.name='SMOKE-CYC-DNC';
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name, parent_node_id)
  SELECT p.id, p.organisation_id, 'sub_board', 'B', 'B',
         (SELECT n.id FROM structure.nodes n WHERE n.project_id=p.id AND n.code='A')
  FROM projects.projects p WHERE p.name='SMOKE-CYC-DNC';
UPDATE structure.nodes a
  SET parent_node_id = (SELECT b.id FROM structure.nodes b JOIN projects.projects p ON p.id=b.project_id
                        WHERE p.name='SMOKE-CYC-DNC' AND b.code='B')
  WHERE a.code='A' AND a.project_id=(SELECT id FROM projects.projects WHERE name='SMOKE-CYC-DNC');
ROLLBACK;
" >/dev/null 2>&1; then pass "cycle rejected"; else fail "cycle was NOT rejected"; fi

section "9. NEGATIVE: deleting a parent that still has children is blocked"
if ! mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-DEL-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'PARENT', 'Parent' FROM projects.projects p WHERE p.name='SMOKE-DEL-DNC';
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name, parent_node_id)
  SELECT p.id, p.organisation_id, 'sub_board', 'CHILD', 'Child',
         (SELECT n.id FROM structure.nodes n WHERE n.project_id=p.id AND n.code='PARENT')
  FROM projects.projects p WHERE p.name='SMOKE-DEL-DNC';
DELETE FROM structure.nodes
  WHERE code='PARENT' AND project_id=(SELECT id FROM projects.projects WHERE name='SMOKE-DEL-DNC');
ROLLBACK;
" >/dev/null 2>&1; then pass "delete-with-children blocked (NO ACTION)"; else fail "delete-with-children was NOT blocked"; fi

section "10. POSITIVE: deleting the whole project cascades through the tree"
REMAIN=$(mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-CASCADE-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'SMOKE-CASCADE-A', 'A' FROM projects.projects p WHERE p.name='SMOKE-CASCADE-DNC';
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name, parent_node_id)
  SELECT p.id, p.organisation_id, 'sub_board', 'SMOKE-CASCADE-B', 'B',
         (SELECT n.id FROM structure.nodes n WHERE n.project_id=p.id AND n.code='SMOKE-CASCADE-A')
  FROM projects.projects p WHERE p.name='SMOKE-CASCADE-DNC';
DELETE FROM projects.projects WHERE name='SMOKE-CASCADE-DNC';
SELECT count(*)::int AS remaining FROM structure.nodes WHERE code IN ('SMOKE-CASCADE-A','SMOKE-CASCADE-B');
ROLLBACK;
" | jq -r '.[0].remaining')
[[ "$REMAIN" == "0" ]] && pass "project cascade removed all nodes (NO ACTION did not block)" || fail "expected 0 remaining nodes, got $REMAIN"

section "11. POSITIVE: tenant_units insert round-trip"
N=$(mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-TU-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'SMOKE-TU-A', 'A' FROM projects.projects p WHERE p.name='SMOKE-TU-DNC';
INSERT INTO structure.tenant_units (node_id, shop_number, area_m2)
  SELECT n.id, 'UNIT-13', 250
  FROM structure.nodes n JOIN projects.projects p ON p.id=n.project_id
  WHERE p.name='SMOKE-TU-DNC' AND n.code='SMOKE-TU-A';
SELECT count(*)::int AS n FROM structure.tenant_units tu
  JOIN structure.nodes nn ON nn.id=tu.node_id
  JOIN projects.projects pp ON pp.id=nn.project_id
  WHERE pp.name='SMOKE-TU-DNC';
ROLLBACK;
" | jq -r '.[0].n')
[[ "$N" == "1" ]] && pass "tenant_units row inserted + readable" || fail "expected 1 tenant_units row, got $N"

echo ""
if [[ "$FAILED" == "0" ]]; then
  echo "✓ ALL SMOKE TESTS PASSED"
  exit 0
else
  echo "✗ SMOKE TESTS FAILED"
  exit 1
fi
```

- [ ] **Step 2: Make it executable**

```bash
cd /Users/spud/Developer/ESITE.V1/esite
chmod +x scripts/db/smoke-test-anchor-sub-boards.sh
```

- [ ] **Step 3: Run it BEFORE applying the migration — expect RED**

Run:
```bash
cd /Users/spud/Developer/ESITE.V1/esite
scripts/db/smoke-test-anchor-sub-boards.sh; echo "exit=$?"
```
Expected: FAILS (`exit=1`). Section 1 reports `✗ parent_node_id missing` and later sections fail too, because `00116` has not been applied to the remote DB yet. This confirms the test actually exercises the new schema.

---

## Task 3: Apply `00116` to the remote DB and go GREEN  ⚠ touches production

> The migration is additive and backward-compatible — no running code references the new objects — so production behaviour is unchanged. This is the one task that writes to the production database.

**Files:** none (applies the already-written migration).

- [ ] **Step 1: Apply the migration to the remote DB**

Run:
```bash
cd /Users/spud/Developer/ESITE.V1/esite
. scripts/db/mgmt-api.sh
mgmt_apply_sql_file apps/edge-functions/supabase/migrations/00116_anchor_sub_boards.sql >/dev/null && echo "APPLIED 00116"
```
Expected: prints `APPLIED 00116` and exits 0. (On any error it prints `Supabase API error: …` and exits non-zero — investigate before continuing.)

- [ ] **Step 2: Run the smoke test — expect GREEN**

Run:
```bash
cd /Users/spud/Developer/ESITE.V1/esite
scripts/db/smoke-test-anchor-sub-boards.sh; echo "exit=$?"
```
Expected: every section prints `✓`, ends with `✓ ALL SMOKE TESTS PASSED`, `exit=0`. If any section is `✗`, read its message, fix `00116_anchor_sub_boards.sql`, re-apply (Step 1 — it is idempotent), and re-run.

- [ ] **Step 3: Record the migration in the CLI ledger** so `deploy-migrations.yml` no-ops on merge (prevents the Management-API ledger drift documented in the project gotchas)

First confirm the ledger table/format:
```bash
. scripts/db/mgmt-api.sh
mgmt_query "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3;"
```
Expected: a JSON array of the most recent versions, e.g. `[{"version":"00115"}, {"version":"00114"}, ...]` — confirming `00116` is not yet present.

Then insert the version row (version-only, matching `migration repair --status applied`):
```bash
mgmt_query "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('00116') ON CONFLICT (version) DO NOTHING;" >/dev/null && echo "LEDGER RECORDED 00116"
```
Expected: prints `LEDGER RECORDED 00116`. Re-run the SELECT to confirm `00116` is now the top row.

---

## Task 4: Commit the smoke test

**Files:**
- `scripts/db/smoke-test-anchor-sub-boards.sh`

- [ ] **Step 1: Commit**

```bash
cd /Users/spud/Developer/ESITE.V1/esite
git add scripts/db/smoke-test-anchor-sub-boards.sh
git commit -m "test(structure): smoke test for 00116 anchor sub-boards schema

Verifies parent_node_id link, same-project FK, self-parent + cycle rejection,
NO ACTION delete guard, project-cascade teardown, and tenant_units round-trip.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 2: Confirm the branch state**

Run:
```bash
cd /Users/spud/Developer/ESITE.V1/esite
git log --oneline -4 && git status --short
```
Expected: the latest commits are the smoke test + migration on `feat/anchor-tenant-sub-boards`; `git status` shows no uncommitted changes other than the pre-existing untracked `apps/web/src/lib/subscription-status.ts`.

---

## Self-Review

**1. Spec coverage (§4.2 + §6 schema rows):**
- `parent_node_id` + composite same-project FK + index → Task 1 §1; smoke §1,§2,§5,§7. ✓
- Cycle guard (CHECK + trigger) → Task 1 §2; smoke §6,§8. ✓
- `sub_board` kind → Task 1 §3; smoke §3,§5. ✓
- `tenant_units` (+RLS) → Task 1 §4; smoke §4,§11. ✓
- `ON DELETE` guard for parent-with-children + project cascade → smoke §9,§10. ✓
- NOTIFY pgrst (no schema PATCH) → Task 1 §5. ✓
- **Types regen** (spec §7 lists it under PR-A) → **intentionally deferred to PR-B** (first consumer); flagged in "Context" above so it is not silently dropped.

**2. Placeholder scan:** No TBD/TODO; every code step shows complete SQL/Bash; every run step states the exact command + expected output. ✓

**3. Type/name consistency:** Constraint/trigger/policy/table names used in the smoke test (`nodes_parent_fk`, `nodes_project_id_key`, `nodes_no_self_parent`, `structure_nodes_prevent_cycle`, `nodes_kind_check`, `structure.tenant_units`, 5 `tenant_units_*` policies) all match the names defined in the migration. Fixture project names are unique per section (`SMOKE-*-DNC`) and all transactions `ROLLBACK`. ✓

---

## Next PRs (separate plans, written when reached)

- **PR-B** — shared `resolveOwningLease` / `buildAnchorGroups`, `sub_board` in equipment-order derivation, required-by inheritance, **TypeScript types regen/patch**, unit tests.
- **PR-C** — tenant-schedule UI: add-sub-board, add-concession, units editor, containment-tree rendering.
- **PR-D** — Materials page rollup (nested anchor grouping, lease-boundary divider, RAG, required-by).
- **PR-E** — cable-schedule node pickers/labels/short-codes for `sub_board`.
