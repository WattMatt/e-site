-- =============================================================================
-- Migration 00083 — node_orders
-- =============================================================================
-- Background:
--   Adds `structure.node_orders` — a lightweight materials-order tracking layer
--   keyed to nodes. Defined in:
--     SPEC DOCS/2026-05-20-materials-integration-design.md §2–§5.
--
--   Each node-order is a single tracked line ("is this thing ordered?").
--   Two kinds of orders exist:
--
--     Tenant orders  — one per (node, scope_item_type); scope_item_type_id is
--                      set. Status mirrors the scope split: Landlord →
--                      `required`; Tenant → `by_tenant`. Created and kept in
--                      sync by the application layer (not by this migration).
--
--     Equipment orders — one per equipment node; scope_item_type_id is NULL;
--                        auto-created `required` when the node is created (D1).
--                        label = the equipment code.
--
--   No quotes, POs or GRN at this layer — that is the existing BOM pipeline;
--   v2 bridge is deferred.
--
-- Schema delta:
--   + structure.node_orders
--   + index on (project_id, status)   — Materials view query
--   + index on (node_id)              — schedule-integration joins
--   + unique partial index — one tenant order per (node, scope_item_type) (§3)
--   + unique partial index — one equipment order per node (§4)
--   + BEFORE UPDATE trigger → public.set_updated_at()
--
-- RLS: mirrors 00080 (structure.tenant_details / tenant_scope_items) —
--      org membership + project access gate via structure.nodes join;
--      client_viewer SELECT-only; owner/admin/project_manager write access;
--      DELETE policy included (a missing DELETE policy silently no-ops —
--      see Session 32 post-mortem).
--
-- Grants: no explicit GRANTs needed. Migration 00075 ran
--   `ALTER DEFAULT PRIVILEGES IN SCHEMA structure` for authenticated,
--   service_role, and anon, so every table created in `structure` after 00075
--   inherits those grants automatically. (RLS still governs row visibility.)
--
-- This migration does NOT apply to any database — apply via the controller.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. structure.node_orders
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE structure.node_orders (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    node_id             UUID        NOT NULL
                        REFERENCES structure.nodes(id) ON DELETE CASCADE,

    project_id          UUID        NOT NULL
                        REFERENCES projects.projects(id) ON DELETE CASCADE,

    organisation_id     UUID        NOT NULL
                        REFERENCES public.organisations(id) ON DELETE CASCADE,

    -- Human-readable line label: "DB", "Lighting", "Power Points", equipment
    -- code, etc. Populated by the application layer on creation.
    label               TEXT        NOT NULL,

    -- Set for tenant orders (references the scope item that drives this line);
    -- NULL for equipment orders (no scope item — equipment is always WM scope).
    scope_item_type_id  UUID
                        REFERENCES structure.scope_item_types(id) ON DELETE SET NULL,

    -- Status lifecycle (design §5):
    --   by_tenant  — scope item is Tenant party; no WM action required
    --   required   → ordered → received
    status              TEXT        NOT NULL DEFAULT 'required'
                        CHECK (status IN ('by_tenant', 'required', 'ordered', 'received')),

    -- Dates (DATE, not TIMESTAMPTZ — day-level granularity per design §2)
    ordered_at          DATE,
    received_at         DATE,

    -- Lightweight free-text: supplier name, reference number, etc.
    notes               TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Materials view filters by project and pivots on status — this is the primary
-- query path for the node-orders view (design §6).
CREATE INDEX idx_node_orders_project_status
    ON structure.node_orders (project_id, status);

-- Schedule-integration joins traverse from node → orders (design §7).
CREATE INDEX idx_node_orders_node
    ON structure.node_orders (node_id);

-- Enforce the design's 1:1 cardinality (§3, §4) at the DB level — this also
-- gives the Task 4.2 derivation service a conflict target for idempotent
-- upserts (re-derivation must never create duplicate order lines).
-- Tenant orders: one per (node, scope_item_type).
CREATE UNIQUE INDEX idx_node_orders_tenant_unique
    ON structure.node_orders (node_id, scope_item_type_id)
    WHERE scope_item_type_id IS NOT NULL;

-- Equipment orders: one per node. scope_item_type_id is NULL, and NULLs are
-- distinct in a plain UNIQUE — so a partial index on node_id alone is required.
CREATE UNIQUE INDEX idx_node_orders_equipment_unique
    ON structure.node_orders (node_id)
    WHERE scope_item_type_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TRIGGER node_orders_updated_at
    BEFORE UPDATE ON structure.node_orders
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS — node_orders
--    Access is derived from the linked node's project/org context (same pattern
--    as structure.tenant_details and structure.tenant_scope_items in 00080).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE structure.node_orders ENABLE ROW LEVEL SECURITY;

-- SELECT: org members with project access (non-client_viewer).
CREATE POLICY node_orders_select_members ON structure.node_orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      WHERE n.id = structure.node_orders.node_id
        AND public.user_has_project_access(n.project_id)
        AND NOT public.user_is_client_viewer(n.organisation_id)
    )
  );

-- SELECT: client_viewer — project-scoped, read-only.
CREATE POLICY node_orders_select_client_viewer ON structure.node_orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      WHERE n.id = structure.node_orders.node_id
        AND public.user_is_client_viewer(n.organisation_id)
        AND public.user_has_project_access(n.project_id)
    )
  );

-- INSERT: owner/admin/project_manager with project access.
CREATE POLICY node_orders_insert ON structure.node_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.node_orders.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

-- UPDATE: owner/admin/project_manager with project access.
CREATE POLICY node_orders_update ON structure.node_orders
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.node_orders.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

-- DELETE: owner/admin/project_manager with project access.
CREATE POLICY node_orders_delete ON structure.node_orders
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM structure.nodes n
      JOIN public.user_organisations uo
        ON uo.user_id = auth.uid()
        AND uo.organisation_id = n.organisation_id
        AND uo.role IN ('owner', 'admin', 'project_manager')
      WHERE n.id = structure.node_orders.node_id
        AND public.user_has_project_access(n.project_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Grants
--    No explicit GRANTs needed here. Migration 00075 ran
--    `ALTER DEFAULT PRIVILEGES IN SCHEMA structure` for authenticated,
--    service_role, and anon, so structure.node_orders inherits those grants
--    automatically. (RLS still governs row visibility; schema grants only open
--    the table to the role.)
-- ─────────────────────────────────────────────────────────────────────────────
