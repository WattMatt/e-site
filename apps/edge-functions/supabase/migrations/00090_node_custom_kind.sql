-- =============================================================================
-- Migration 00090 — custom equipment kind
-- =============================================================================
-- Equipment types are no longer a closed list. A new node kind, 'custom',
-- lets users define project-specific equipment types (UPS, power-quality
-- meter, lighting-control system, ...) that the Equipment Schedule and the
-- Material Order Tracker treat exactly like the built-in kinds.
--
-- The user-supplied type name lives in custom_kind_label; grouping/labelling
-- keys off that for custom nodes (and off `kind` for built-in nodes).
--
-- Non-destructive. Idempotent.
-- =============================================================================

ALTER TABLE structure.nodes ADD COLUMN IF NOT EXISTS custom_kind_label TEXT;

-- ── Extend the kind CHECK to include 'custom' ────────────────────────────────
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT con.conname
    INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class       rel ON rel.oid = con.conrelid
  JOIN pg_namespace   nsp ON nsp.oid = rel.relnamespace
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
    'custom'
  ));

-- ── custom_kind_label present (non-empty) iff kind = 'custom' ─────────────────
ALTER TABLE structure.nodes DROP CONSTRAINT IF EXISTS nodes_custom_kind_label_check;
ALTER TABLE structure.nodes
  ADD CONSTRAINT nodes_custom_kind_label_check
  CHECK ( (kind = 'custom') = (NULLIF(TRIM(custom_kind_label), '') IS NOT NULL) );

-- PostgREST picks up the new column.
NOTIFY pgrst, 'reload schema';
