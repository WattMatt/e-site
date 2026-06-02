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

-- area_m2 is an optional POSITIVE magnitude. Idempotent named CHECK (a plain
-- inline CHECK would not re-apply under CREATE TABLE IF NOT EXISTS).
ALTER TABLE structure.tenant_units DROP CONSTRAINT IF EXISTS tenant_units_area_positive;
ALTER TABLE structure.tenant_units ADD CONSTRAINT tenant_units_area_positive
  CHECK (area_m2 IS NULL OR area_m2 > 0);

-- NOTE: tenant_units intentionally has NO UNIQUE constraint (unlike its 00080
-- siblings) — a lease may have MANY additional units with no natural unique key.

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
