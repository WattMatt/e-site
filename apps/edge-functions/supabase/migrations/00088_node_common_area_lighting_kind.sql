-- =============================================================================
-- Migration 00088 — add 'common_area_lighting' to the structure.nodes kind set
-- =============================================================================
-- The Equipment Schedule gains a "Common Area Lighting" equipment kind — one
-- node per common-area lighting zone (parking lot, mall, ablution, service
-- passage, basement, back-of-house, …), tracked and ordered alongside the
-- existing board / substation / RMU / generator kinds.
--
-- Non-destructive: existing rows are untouched; only new INSERTs may use the
-- new value. Safe to apply before, with, or independently of the application
-- deploy — old code simply never produces the value.
--
-- Idempotent: the existing kind CHECK constraint is located by definition and
-- dropped before the 7-value constraint is (re)created.
-- =============================================================================

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
    AND pg_get_constraintdef(con.oid) ILIKE '%kind%';

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
    'generator'
  ));
