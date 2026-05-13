-- =============================================================================
-- Migration 00046 — Engineer Equipment Schedule + Procurement Quotes
-- =============================================================================
-- Background:
--   Phase 1 of the procurement build-out (SPEC DOCS/procurement-buildout-plan.md).
--   Establishes the engineer-authored bill-of-materials (BOM) and multi-quote
--   upload/compare infrastructure that drives the procurement lifecycle.
--
--   Two new tables + two new FK columns on procurement_items + one storage
--   bucket + the RLS to gate them all.
--
-- Schema delta:
--   + projects.engineer_equipment_schedule  — BOM lines
--   + projects.procurement_quotes           — quote attachments (one item, N quotes)
--   ALTER projects.procurement_items
--     + schedule_item_id  FK → engineer_equipment_schedule (nullable)
--     + selected_quote_id FK → procurement_quotes          (nullable)
--   + storage.buckets 'quotes' — private, 50 MB, PDF + images + XLSX
--
-- Idempotency:
--   IF NOT EXISTS guards on all CREATE TABLE / CREATE INDEX / ADD COLUMN /
--   storage bucket insert. Safe to re-run.
--
-- RLS model:
--   Org members (owner/admin/project_manager/field_worker) — full SELECT,
--   INSERT, UPDATE, DELETE within their org. Client viewers scoped to
--   projects they're a member of (via projects.project_members) for SELECT
--   only; no write privileges (mirrors the tenants.documents pattern from
--   migration 00041).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- projects.engineer_equipment_schedule  (BOM lines)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects.engineer_equipment_schedule (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id              UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id         UUID NOT NULL REFERENCES public.organisations(id),
    -- Engineer's reference / BOM number. Free-text; commonly something like
    -- "EL-DB-01" or "MV-SWB-A". Optional.
    item_code               TEXT,
    description             TEXT NOT NULL,
    -- Make / model / standard the engineer is specifying. Optional.
    specification           TEXT,
    quantity                NUMERIC NOT NULL CHECK (quantity > 0),
    unit                    TEXT,
    estimated_unit_cost     NUMERIC(12,2),
    currency                TEXT NOT NULL DEFAULT 'ZAR',
    -- Procurement-side notes from the engineer ("supplier must be SABS
    -- certified", "match existing make", "delivery direct to site only").
    instructions            TEXT,
    -- When TRUE, downstream procurement_items linked to this schedule line
    -- cannot progress past `approved` until at least one shop drawing is
    -- approved (Phase 2 enforces this gate).
    shop_drawing_required   BOOLEAN NOT NULL DEFAULT FALSE,
    -- Lifecycle independent of procurement_items. Status rollup is driven
    -- by quantity-coverage triggers (Phase 1: maintained by app code, not
    -- a DB trigger — keeps the migration light).
    status                  TEXT NOT NULL DEFAULT 'open'
                            CHECK (status IN (
                                'open',
                                'partially_ordered',
                                'fully_ordered',
                                'fully_delivered',
                                'cancelled'
                            )),
    added_by                UUID REFERENCES public.profiles(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_project
    ON projects.engineer_equipment_schedule(project_id);
CREATE INDEX IF NOT EXISTS idx_schedule_org
    ON projects.engineer_equipment_schedule(organisation_id);
CREATE INDEX IF NOT EXISTS idx_schedule_status
    ON projects.engineer_equipment_schedule(status)
    WHERE status IN ('open', 'partially_ordered');

CREATE TRIGGER engineer_schedule_updated_at
    BEFORE UPDATE ON projects.engineer_equipment_schedule
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE projects.engineer_equipment_schedule ENABLE ROW LEVEL SECURITY;

-- Org members + project-scoped client_viewers SELECT
CREATE POLICY "Org members and project-scoped client viewers can view schedule"
    ON projects.engineer_equipment_schedule FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM projects.project_members pm
                WHERE pm.project_id = engineer_equipment_schedule.project_id
                  AND pm.user_id   = auth.uid()
                  AND pm.is_active = TRUE
            )
        )
    );

CREATE POLICY "Org members can insert schedule items"
    ON projects.engineer_equipment_schedule FOR INSERT
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can update schedule items"
    ON projects.engineer_equipment_schedule FOR UPDATE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can delete schedule items"
    ON projects.engineer_equipment_schedule FOR DELETE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

-- ---------------------------------------------------------------------------
-- projects.procurement_quotes  (multiple quotes per procurement item)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects.procurement_quotes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procurement_item_id     UUID NOT NULL REFERENCES projects.procurement_items(id) ON DELETE CASCADE,
    organisation_id         UUID NOT NULL REFERENCES public.organisations(id),
    -- Either a marketplace/private supplier, OR a free-text fallback for
    -- a supplier the contractor hasn't onboarded into suppliers.suppliers.
    supplier_id             UUID REFERENCES suppliers.suppliers(id),
    supplier_name           TEXT,
    quote_reference         TEXT,
    quoted_price            NUMERIC(12,2) NOT NULL CHECK (quoted_price >= 0),
    currency                TEXT NOT NULL DEFAULT 'ZAR',
    valid_until             DATE,
    lead_time_days          INTEGER CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
    notes                   TEXT,
    -- Object key inside the `quotes` storage bucket.
    file_path               TEXT,
    file_size_bytes         BIGINT,
    file_mime               TEXT,
    received_at             DATE NOT NULL DEFAULT CURRENT_DATE,
    uploaded_by             UUID REFERENCES public.profiles(id),
    -- Exactly one quote per procurement_item carries is_selected = TRUE
    -- (enforced by partial unique index below). The selected quote's
    -- quoted_price is what flows to procurement_items.quoted_price when
    -- the app sets selected_quote_id.
    is_selected             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotes_item
    ON projects.procurement_quotes(procurement_item_id);
CREATE INDEX IF NOT EXISTS idx_quotes_supplier
    ON projects.procurement_quotes(supplier_id)
    WHERE supplier_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_selected_quote_per_item
    ON projects.procurement_quotes(procurement_item_id)
    WHERE is_selected;

ALTER TABLE projects.procurement_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members and project-scoped client viewers can view quotes"
    ON projects.procurement_quotes FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1
                FROM projects.procurement_items pi
                JOIN projects.project_members pm
                  ON pm.project_id = pi.project_id
                WHERE pi.id = procurement_quotes.procurement_item_id
                  AND pm.user_id   = auth.uid()
                  AND pm.is_active = TRUE
            )
        )
    );

CREATE POLICY "Org members can insert quotes"
    ON projects.procurement_quotes FOR INSERT
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can update quotes"
    ON projects.procurement_quotes FOR UPDATE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can delete quotes"
    ON projects.procurement_quotes FOR DELETE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

-- ---------------------------------------------------------------------------
-- projects.procurement_items  — add schedule + selected-quote linkage
-- ---------------------------------------------------------------------------
ALTER TABLE projects.procurement_items
    ADD COLUMN IF NOT EXISTS schedule_item_id UUID
        REFERENCES projects.engineer_equipment_schedule(id) ON DELETE SET NULL;

ALTER TABLE projects.procurement_items
    ADD COLUMN IF NOT EXISTS selected_quote_id UUID
        REFERENCES projects.procurement_quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_procurement_items_schedule
    ON projects.procurement_items(schedule_item_id)
    WHERE schedule_item_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Storage bucket: quotes
-- ---------------------------------------------------------------------------
-- Private (signed-URL gated like drawings + project-documents). 50 MB cap.
-- MIME allowlist covers the common quote formats SA suppliers actually use:
-- PDF, scanned images, and the inevitable Excel spreadsheet.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'quotes',
    'quotes',
    false,
    52428800,  -- 50 MB
    ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
    ]
)
ON CONFLICT (id) DO NOTHING;

-- Bucket RLS: storage paths are prefixed `<org_id>/<procurement_item_id>/<file_id>.<ext>`
-- so the first path segment IS the organisation_id. Gate on that.
CREATE POLICY "Org members can read quote objects"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'quotes'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
    );

CREATE POLICY "Org members can insert quote objects"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'quotes'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

CREATE POLICY "Org members can update quote objects"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'quotes'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

CREATE POLICY "Org members can delete quote objects"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'quotes'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

-- ---------------------------------------------------------------------------
-- PostgREST schema cache reload (matches the 00036 pattern used after past
-- schema additions to projects.*)
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
