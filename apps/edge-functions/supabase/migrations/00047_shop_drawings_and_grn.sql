-- =============================================================================
-- Migration 00047 — Shop Drawings + Approval Chain + Goods Received Notes
-- =============================================================================
-- Background:
--   Phase 2 of the procurement build-out (SPEC DOCS/procurement-buildout-plan.md).
--   Lands the approval-gate workflow that sits between "quote selected"
--   and "PO approved" for items where the engineer flagged
--   shop_drawing_required = TRUE, plus the delivery-confirmation
--   surface that closes the loop on `fulfilled`.
--
-- Schema delta:
--   + projects.shop_drawings           — each upload is a revision row
--   + projects.shop_drawing_approvals  — one decision per row (extensible
--                                        to multi-step chains later)
--   + projects.goods_received_notes    — delivery proof + condition
--   + storage.buckets 'shop-drawings'  — 50 MB, PDF + images
--   + storage.buckets 'grn-photos'     — 20 MB, images + PDF
--
-- RLS:
--   Same pattern as migrations 00041 and 00046 — org members + project-
--   scoped client_viewers (read-only for client_viewers).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- projects.shop_drawings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects.shop_drawings (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id              UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id         UUID NOT NULL REFERENCES public.organisations(id),
    -- Which procurement item this drawing supports. Required — shop drawings
    -- without a procurement context don't exist in the Phase-2 model.
    procurement_item_id     UUID NOT NULL REFERENCES projects.procurement_items(id) ON DELETE CASCADE,
    title                   TEXT NOT NULL,
    -- Increments on each revise-and-resubmit cycle. App code is responsible
    -- for setting this to MAX(revision)+1 when re-uploading after a
    -- 'revise_and_resubmit' decision.
    revision                INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    file_path               TEXT NOT NULL,
    file_size_bytes         BIGINT,
    file_mime               TEXT,
    status                  TEXT NOT NULL DEFAULT 'pending_review'
                            CHECK (status IN (
                                'pending_review',
                                'approved',
                                'revise_and_resubmit',
                                'rejected'
                            )),
    notes                   TEXT,
    submitted_by            UUID REFERENCES public.profiles(id),
    submitted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One pending revision per (procurement_item, revision) so re-uploading
    -- the same revision number raises an integrity error instead of
    -- silently double-counting.
    UNIQUE (procurement_item_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_shop_drawings_project
    ON projects.shop_drawings(project_id);
CREATE INDEX IF NOT EXISTS idx_shop_drawings_item
    ON projects.shop_drawings(procurement_item_id);
CREATE INDEX IF NOT EXISTS idx_shop_drawings_pending
    ON projects.shop_drawings(status)
    WHERE status = 'pending_review';

CREATE TRIGGER shop_drawings_updated_at
    BEFORE UPDATE ON projects.shop_drawings
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE projects.shop_drawings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members and project-scoped client viewers can view shop drawings"
    ON projects.shop_drawings FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM projects.project_members pm
                WHERE pm.project_id = shop_drawings.project_id
                  AND pm.user_id   = auth.uid()
                  AND pm.is_active = TRUE
            )
        )
    );

CREATE POLICY "Org members can insert shop drawings"
    ON projects.shop_drawings FOR INSERT
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can update shop drawings"
    ON projects.shop_drawings FOR UPDATE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can delete shop drawings"
    ON projects.shop_drawings FOR DELETE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

-- ---------------------------------------------------------------------------
-- projects.shop_drawing_approvals
-- ---------------------------------------------------------------------------
-- One decision row per approver. Multi-step chains supported by inserting
-- multiple rows (currently the app uses a single-decision model — engineer
-- or PM approves, no chain — but the schema is forward-compatible).
CREATE TABLE IF NOT EXISTS projects.shop_drawing_approvals (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_drawing_id         UUID NOT NULL REFERENCES projects.shop_drawings(id) ON DELETE CASCADE,
    approver_user_id        UUID NOT NULL REFERENCES public.profiles(id),
    decision                TEXT NOT NULL CHECK (decision IN (
                                'approved',
                                'revise_and_resubmit',
                                'rejected'
                            )),
    comments                TEXT,
    decided_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_drawing_approvals_drawing
    ON projects.shop_drawing_approvals(shop_drawing_id);

ALTER TABLE projects.shop_drawing_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view shop drawing approvals"
    ON projects.shop_drawing_approvals FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM projects.shop_drawings sd
            WHERE sd.id = shop_drawing_approvals.shop_drawing_id
              AND sd.organisation_id = ANY(public.get_user_org_ids())
              AND (
                  NOT public.user_is_client_viewer(sd.organisation_id)
                  OR EXISTS (
                      SELECT 1 FROM projects.project_members pm
                      WHERE pm.project_id = sd.project_id
                        AND pm.user_id   = auth.uid()
                        AND pm.is_active = TRUE
                  )
              )
        )
    );

CREATE POLICY "Org members can insert shop drawing approvals"
    ON projects.shop_drawing_approvals FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM projects.shop_drawings sd
            WHERE sd.id = shop_drawing_approvals.shop_drawing_id
              AND sd.organisation_id = ANY(public.get_user_org_ids())
              AND NOT public.user_is_client_viewer(sd.organisation_id)
        )
    );

-- ---------------------------------------------------------------------------
-- projects.goods_received_notes
-- ---------------------------------------------------------------------------
-- One row per delivery event. A single procurement_item can accumulate
-- multiple GRNs (partial deliveries — common in SA construction).
-- Aggregate received_quantity = SUM of GRN quantity_received; when that
-- meets or exceeds procurement_items.quantity, app code flips the parent
-- to status = 'fulfilled'.
CREATE TABLE IF NOT EXISTS projects.goods_received_notes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procurement_item_id     UUID NOT NULL REFERENCES projects.procurement_items(id) ON DELETE CASCADE,
    project_id              UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id         UUID NOT NULL REFERENCES public.organisations(id),
    delivered_at            DATE NOT NULL DEFAULT CURRENT_DATE,
    quantity_received       NUMERIC NOT NULL CHECK (quantity_received >= 0),
    condition               TEXT NOT NULL DEFAULT 'complete'
                            CHECK (condition IN ('complete', 'partial', 'damaged')),
    notes                   TEXT,
    -- Object keys (bucket: grn-photos) — array so multiple photos per GRN.
    photo_paths             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- Optional signed proof-of-delivery PDF (bucket: grn-photos).
    signed_pod_path         TEXT,
    received_by             UUID REFERENCES public.profiles(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grn_item
    ON projects.goods_received_notes(procurement_item_id);
CREATE INDEX IF NOT EXISTS idx_grn_project
    ON projects.goods_received_notes(project_id);

ALTER TABLE projects.goods_received_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members and project-scoped client viewers can view GRNs"
    ON projects.goods_received_notes FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM projects.project_members pm
                WHERE pm.project_id = goods_received_notes.project_id
                  AND pm.user_id   = auth.uid()
                  AND pm.is_active = TRUE
            )
        )
    );

CREATE POLICY "Org members can insert GRNs"
    ON projects.goods_received_notes FOR INSERT
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can update GRNs"
    ON projects.goods_received_notes FOR UPDATE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can delete GRNs"
    ON projects.goods_received_notes FOR DELETE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

-- ---------------------------------------------------------------------------
-- Storage bucket: shop-drawings
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'shop-drawings',
    'shop-drawings',
    false,
    52428800,  -- 50 MB
    ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/tiff',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Org members can read shop drawing objects"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'shop-drawings'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
    );

CREATE POLICY "Org members can insert shop drawing objects"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'shop-drawings'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

CREATE POLICY "Org members can update shop drawing objects"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'shop-drawings'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

CREATE POLICY "Org members can delete shop drawing objects"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'shop-drawings'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

-- ---------------------------------------------------------------------------
-- Storage bucket: grn-photos
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'grn-photos',
    'grn-photos',
    false,
    20971520,  -- 20 MB per file (typical delivery snap on a phone)
    ARRAY[
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'application/pdf'
    ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Org members can read GRN photo objects"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'grn-photos'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
    );

CREATE POLICY "Org members can insert GRN photo objects"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'grn-photos'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

CREATE POLICY "Org members can update GRN photo objects"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'grn-photos'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

CREATE POLICY "Org members can delete GRN photo objects"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'grn-photos'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

-- ---------------------------------------------------------------------------
-- PostgREST cache reload
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
