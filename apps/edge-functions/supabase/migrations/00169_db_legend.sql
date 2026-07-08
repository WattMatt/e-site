-- =============================================================================
-- Migration 00169 — tenant DB legend cards
-- =============================================================================
-- Spec: docs/superpowers/specs/2026-07-08-tenant-db-legend-cards-design.md
--
--   + structure.node_circuits — one row per way/circuit inside a tenant DB
--     (circuit number, description, phase, breaker rating/poles/curve, cable
--     size, spare flag). Feeds the printable legend card.
--   + structure.tenant_details: db_location, db_fed_from, db_earth_leakage_ma,
--     legend_card_size — the card header block. The main breaker is NOT stored
--     here: structure.nodes already carries breaker_rating_a / pole_config
--     (manual) and incomer_breaker_a / incomer_pole_config (derived).
--
-- RLS mirrors 00083 (structure.node_orders): access derived from the linked
-- node's project/org; client_viewer SELECT-only; owner/admin/project_manager
-- write; DELETE policy included.
--
-- Grants: none needed — 00075 ALTER DEFAULT PRIVILEGES covers new structure
-- tables. New table in an existing exposed schema → NOTIFY reload only, no
-- PostgREST db_schema PATCH.
--
-- This migration does NOT apply to any database — apply via the controller.
-- =============================================================================

CREATE TABLE structure.node_circuits (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    node_id           UUID        NOT NULL
                      REFERENCES structure.nodes(id) ON DELETE CASCADE,

    -- Free text ("1", "3+5+7"); unique per board. Blank forbidden.
    circuit_no        TEXT        NOT NULL CHECK (btrim(circuit_no) <> ''),

    -- "Lights shop 5". NULL/blank allowed (spare ways).
    description       TEXT,

    phase             TEXT        CHECK (phase IN ('L1', 'L2', 'L3', '3P')),
    breaker_rating_a  NUMERIC     CHECK (breaker_rating_a > 0),
    poles             SMALLINT    CHECK (poles IN (1, 2, 3, 4)),
    curve             TEXT        CHECK (curve IN ('B', 'C', 'D')),
    cable_size        TEXT,

    -- Spare ways print as "SPARE" on the card.
    is_spare          BOOLEAN     NOT NULL DEFAULT false,

    -- Display + print order (assigned max+1 by the application layer).
    sort_order        INTEGER     NOT NULL DEFAULT 0,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (node_id, circuit_no)
);

CREATE INDEX idx_node_circuits_node ON structure.node_circuits (node_id);

CREATE TRIGGER node_circuits_updated_at
    BEFORE UPDATE ON structure.node_circuits
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — node_circuits (mirrors 00083 node_orders)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE structure.node_circuits ENABLE ROW LEVEL SECURITY;

CREATE POLICY node_circuits_select_members ON structure.node_circuits
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      WHERE n.id = structure.node_circuits.node_id
        AND public.user_has_project_access(n.project_id)
        AND NOT public.user_is_client_viewer(n.organisation_id)
    )
  );

CREATE POLICY node_circuits_select_client_viewer ON structure.node_circuits
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      WHERE n.id = structure.node_circuits.node_id
        AND public.user_is_client_viewer(n.organisation_id)
        AND public.user_has_project_access(n.project_id)
    )
  );

CREATE POLICY node_circuits_insert ON structure.node_circuits
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.node_circuits.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

CREATE POLICY node_circuits_update ON structure.node_circuits
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.node_circuits.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

CREATE POLICY node_circuits_delete ON structure.node_circuits
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.node_circuits.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- tenant_details — legend-card header fields
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE structure.tenant_details
    ADD COLUMN db_location         TEXT,
    ADD COLUMN db_fed_from         TEXT,
    ADD COLUMN db_earth_leakage_ma NUMERIC CHECK (db_earth_leakage_ma > 0),
    ADD COLUMN legend_card_size    TEXT NOT NULL DEFAULT 'A4'
               CHECK (legend_card_size IN ('A4', 'A5'));
