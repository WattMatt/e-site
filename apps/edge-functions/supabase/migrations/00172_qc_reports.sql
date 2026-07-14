-- =============================================================================
-- Migration 00172 — site quality control (QC) reports
-- =============================================================================
-- Spec: docs/superpowers/specs/2026-07-14-site-qc-reports-design.md
--
--   + projects.qc_reports      — report container (per-project report_no via
--     BEFORE INSERT trigger, mirroring field.snag_visits_ensure_no from 00120;
--     status draft → issued → closed)
--   + projects.qc_entries      — ordered photo/markup groups inside a report
--   + projects.qc_entry_photos — photos + flattened drawing markups (vector
--     scene kept in annotation_data for re-edit lineage)
--   + projects.qc_comments     — group-level (photo_id NULL) or per-photo
--   + projects.project_settings.notify_qc_email — per-project email toggle,
--     mirroring 00147 (notify_snag_email / notify_diary_email)
--   + storage buckets qc-report-entries (entry images) + qc-reports (PDFs),
--     org-path Pattern-A policies mirroring 00117, plus RESTRICTIVE
--     client_viewer blocks on ALL verbs — writes mirroring 00162, and
--     (unlike 00162's buckets) SELECT too, because these are the first
--     buckets whose objects carry draft/issued visibility semantics.
--
-- RLS (modern per-verb pattern, 00169 style): SELECT is project-access
-- gated; qc_reports hides drafts from client viewers AT THE DB (issued-only)
-- and child tables re-apply the parent visibility through EXISTS on
-- qc_reports. Writes key off public.user_effective_project_role(project_id)
-- (00107 — SECURITY DEFINER, honours per-project promotions via
-- projects.project_members and cross-org project members per 00160; returns
-- NULL without project access, so writes are inherently bound to the
-- project), mirroring 00171 and matching the app gates
-- (requireEffectiveRole): INSERT/UPDATE need QC_WRITE_ROLES
-- (owner/admin/project_manager/contractor), DELETE needs ORG_WRITE_ROLES
-- (owner/admin/project_manager); same sets on the children via the parent.
--
-- Lifecycle is DB-enforced by two SECURITY DEFINER trigger guards (RLS is
-- row-level, not column-level, so policies alone can't protect `status`):
--   * qc_reports_status_guard — status transitions (draft → issued → closed,
--     and the manager-only closed → issued reopen) require an effective
--     project role of owner/admin/project_manager; service-role paths
--     (auth.uid() IS NULL — e.g. issueQcReportAction's flip) bypass. Without
--     this a contractor could flip a draft to 'issued' and expose it to the
--     client, since status IS the client_viewer visibility gate.
--   * qc_report_children_frozen — entries/photos/comments of a CLOSED report
--     are immutable for end-user roles (service role bypasses), mirroring
--     the 00168 ISSUED-revision snapshot freeze.
--
-- Grants: none needed — 00025 ALTER DEFAULT PRIVILEGES covers new projects
-- tables (verified: 00117 projects.reports shipped without explicit grants).
-- New tables in an existing exposed schema → NOTIFY reload only, no PostgREST
-- db_schema PATCH.
--
-- This migration does NOT apply to any database — applied by
-- deploy-migrations.yml on merge to main.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. projects.qc_reports
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects.qc_reports (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID        NOT NULL REFERENCES projects.projects(id)    ON DELETE CASCADE,
    organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    report_no       INTEGER     NOT NULL DEFAULT 0, -- overridden by qc_reports_ensure_no() trigger (per-project MAX+1)
    title           TEXT        NOT NULL,
    description     TEXT,
    location        TEXT,
    inspection_date DATE,
    status          TEXT        NOT NULL DEFAULT 'draft',
    raised_by       UUID        NOT NULL REFERENCES public.profiles(id),
    issued_at       TIMESTAMPTZ,
    issued_by       UUID        REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent named CHECKs (an inline CHECK wouldn't re-apply under CREATE IF NOT EXISTS).
ALTER TABLE projects.qc_reports DROP CONSTRAINT IF EXISTS qc_reports_status_check;
ALTER TABLE projects.qc_reports ADD  CONSTRAINT qc_reports_status_check
    CHECK (status IN ('draft', 'issued', 'closed'));

ALTER TABLE projects.qc_reports DROP CONSTRAINT IF EXISTS qc_reports_project_no_uniq;
ALTER TABLE projects.qc_reports ADD  CONSTRAINT qc_reports_project_no_uniq UNIQUE (project_id, report_no);

CREATE INDEX IF NOT EXISTS qc_reports_project_idx        ON projects.qc_reports (project_id);
CREATE INDEX IF NOT EXISTS qc_reports_org_idx            ON projects.qc_reports (organisation_id);
CREATE INDEX IF NOT EXISTS qc_reports_project_status_idx ON projects.qc_reports (project_id, status);

DROP TRIGGER IF EXISTS qc_reports_updated_at ON projects.qc_reports;
CREATE TRIGGER qc_reports_updated_at BEFORE UPDATE ON projects.qc_reports
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Per-project report numbering — mirrors field.snag_visits_ensure_no (00120).
CREATE OR REPLACE FUNCTION projects.qc_reports_ensure_no() RETURNS TRIGGER
    SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.report_no IS NULL OR NEW.report_no = 0 THEN
    SELECT COALESCE(MAX(report_no), 0) + 1 INTO NEW.report_no
      FROM projects.qc_reports WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS qc_reports_ensure_no_trg ON projects.qc_reports;
CREATE TRIGGER qc_reports_ensure_no_trg BEFORE INSERT ON projects.qc_reports
    FOR EACH ROW EXECUTE FUNCTION projects.qc_reports_ensure_no();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. projects.qc_entries
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects.qc_entries (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       UUID        NOT NULL REFERENCES projects.qc_reports(id)  ON DELETE CASCADE,
    -- Denormalised for RLS/storage symmetry (org-path buckets key off org id).
    organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    project_id      UUID        NOT NULL REFERENCES projects.projects(id)    ON DELETE CASCADE,
    title           TEXT        NOT NULL,
    description     TEXT,
    sort_order      INTEGER     NOT NULL DEFAULT 0,
    created_by      UUID        NOT NULL REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qc_entries_report_sort_idx ON projects.qc_entries (report_id, sort_order);

DROP TRIGGER IF EXISTS qc_entries_updated_at ON projects.qc_entries;
CREATE TRIGGER qc_entries_updated_at BEFORE UPDATE ON projects.qc_entries
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. projects.qc_entry_photos
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects.qc_entry_photos (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id             UUID        NOT NULL REFERENCES projects.qc_entries(id)   ON DELETE CASCADE,
    organisation_id      UUID        NOT NULL REFERENCES public.organisations(id)  ON DELETE CASCADE,
    project_id           UUID        NOT NULL REFERENCES projects.projects(id)     ON DELETE CASCADE,
    file_path            TEXT        NOT NULL,
    file_name            TEXT,
    mime_type            TEXT,
    file_size_bytes      BIGINT,
    caption              TEXT,
    sort_order           INTEGER     NOT NULL DEFAULT 0,
    kind                 TEXT        NOT NULL DEFAULT 'photo',
    source_floor_plan_id UUID        REFERENCES tenants.floor_plans(id) ON DELETE SET NULL,
    -- Vector scene for markup re-edit lineage; NULL for plain photos.
    annotation_data      JSONB,
    uploaded_by          UUID        NOT NULL REFERENCES public.profiles(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE projects.qc_entry_photos DROP CONSTRAINT IF EXISTS qc_entry_photos_kind_check;
ALTER TABLE projects.qc_entry_photos ADD  CONSTRAINT qc_entry_photos_kind_check
    CHECK (kind IN ('photo', 'markup'));

CREATE INDEX IF NOT EXISTS qc_entry_photos_entry_sort_idx ON projects.qc_entry_photos (entry_id, sort_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. projects.qc_comments
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects.qc_comments (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id  UUID        NOT NULL REFERENCES projects.qc_reports(id)      ON DELETE CASCADE,
    entry_id   UUID        NOT NULL REFERENCES projects.qc_entries(id)      ON DELETE CASCADE,
    -- NULL = comment on the whole entry/group; set = comment on one photo.
    photo_id   UUID        REFERENCES projects.qc_entry_photos(id) ON DELETE CASCADE,
    body       TEXT        NOT NULL,
    created_by UUID        NOT NULL REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qc_comments_entry_created_idx ON projects.qc_comments (entry_id, created_at);

DROP TRIGGER IF EXISTS qc_comments_updated_at ON projects.qc_comments;
CREATE TRIGGER qc_comments_updated_at BEFORE UPDATE ON projects.qc_comments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. project_settings — QC email toggle (mirrors 00147)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE projects.project_settings
    ADD COLUMN IF NOT EXISTS notify_qc_email boolean NOT NULL DEFAULT true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS — qc_reports
--    SELECT: project access; client viewers see ISSUED reports only (drafts
--            hidden at the DB, not just in the UI).
--    Writes key off public.user_effective_project_role(project_id) (00107),
--    the same resolver the app gates use (requireEffectiveRole), so
--    per-project promotions (projects.project_members) and cross-org project
--    members (00160) work, and a write role held in an unrelated org grants
--    nothing here — the function returns NULL without access to THIS project,
--    and NULL IN (...) is not TRUE. Usage mirrors 00171.
--    INSERT/UPDATE: effective role IN QC_WRITE_ROLES
--                   (owner/admin/project_manager/contractor).
--    DELETE: effective role IN ORG_WRITE_ROLES (owner/admin/project_manager).
--    Status transitions are additionally guarded by qc_reports_status_guard
--    below — the UPDATE policy is row-level, so it alone cannot stop a
--    contractor from flipping `status`.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE projects.qc_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qc_reports_select ON projects.qc_reports;
CREATE POLICY qc_reports_select ON projects.qc_reports
    FOR SELECT TO authenticated
    USING (
        public.user_has_project_access(project_id)
        AND (NOT public.user_is_client_viewer(organisation_id) OR status = 'issued')
    );

DROP POLICY IF EXISTS qc_reports_insert ON projects.qc_reports;
CREATE POLICY qc_reports_insert ON projects.qc_reports
    FOR INSERT TO authenticated
    WITH CHECK (
        public.user_effective_project_role(project_id)
            IN ('owner', 'admin', 'project_manager', 'contractor')
    );

DROP POLICY IF EXISTS qc_reports_update ON projects.qc_reports;
CREATE POLICY qc_reports_update ON projects.qc_reports
    FOR UPDATE TO authenticated
    USING (
        public.user_effective_project_role(project_id)
            IN ('owner', 'admin', 'project_manager', 'contractor')
    )
    WITH CHECK (
        public.user_effective_project_role(project_id)
            IN ('owner', 'admin', 'project_manager', 'contractor')
    );

DROP POLICY IF EXISTS qc_reports_delete ON projects.qc_reports;
CREATE POLICY qc_reports_delete ON projects.qc_reports
    FOR DELETE TO authenticated
    USING (
        public.user_effective_project_role(project_id)
            IN ('owner', 'admin', 'project_manager')
    );

-- Status-transition guard. `status` is not just lifecycle bookkeeping — it IS
-- the DB visibility gate for client viewers (issued-only SELECT above), so a
-- direct PostgREST UPDATE by a contractor flipping draft → issued would
-- expose an unvetted report to the client, and closed → draft would undo a
-- manager's close. Transitions are reserved for owner/admin/project_manager
-- (the ORG_WRITE_ROLES set gating issueQcReportAction/closeQcReportAction);
-- service-role and admin paths run with auth.uid() IS NULL and bypass
-- (issueQcReportAction's flip uses the service client). Content-only UPDATEs
-- (status untouched) pass straight through to the row policy above.
CREATE OR REPLACE FUNCTION projects.qc_reports_status_guard() RETURNS TRIGGER
    SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND auth.uid() IS NOT NULL
       AND (public.user_effective_project_role(OLD.project_id, auth.uid())
                IN ('owner', 'admin', 'project_manager')) IS NOT TRUE
    THEN
        RAISE EXCEPTION 'qc_reports: only owner/admin/project_manager can change a QC report''s status (attempted % → %)', OLD.status, NEW.status
            USING ERRCODE = 'raise_exception';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS qc_reports_status_guard_trg ON projects.qc_reports;
CREATE TRIGGER qc_reports_status_guard_trg BEFORE UPDATE ON projects.qc_reports
    FOR EACH ROW EXECUTE FUNCTION projects.qc_reports_status_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. RLS — child tables (qc_entries / qc_entry_photos / qc_comments)
--    SELECT re-applies the parent visibility (incl. the client_viewer
--    issued-only rule) through an EXISTS on qc_reports; writes keep the
--    EXISTS-parent shape but check public.user_effective_project_role on the
--    PARENT's project_id, with the same per-verb role sets as qc_reports
--    (INSERT/UPDATE: QC_WRITE_ROLES; DELETE: ORG_WRITE_ROLES — author
--    deletes go through the gated server actions on the service client).
--    Closed-report immutability is enforced by qc_report_children_frozen
--    at the end of this section.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE projects.qc_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.qc_entry_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.qc_comments     ENABLE ROW LEVEL SECURITY;

-- qc_entries -----------------------------------------------------------------
DROP POLICY IF EXISTS qc_entries_select ON projects.qc_entries;
CREATE POLICY qc_entries_select ON projects.qc_entries
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM projects.qc_reports r
            WHERE r.id = projects.qc_entries.report_id
              AND public.user_has_project_access(r.project_id)
              AND (NOT public.user_is_client_viewer(r.organisation_id) OR r.status = 'issued')
        )
    );

DROP POLICY IF EXISTS qc_entries_insert ON projects.qc_entries;
CREATE POLICY qc_entries_insert ON projects.qc_entries
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects.qc_reports r
            WHERE r.id = projects.qc_entries.report_id
              AND public.user_effective_project_role(r.project_id)
                    IN ('owner', 'admin', 'project_manager', 'contractor')
        )
    );

DROP POLICY IF EXISTS qc_entries_update ON projects.qc_entries;
CREATE POLICY qc_entries_update ON projects.qc_entries
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM projects.qc_reports r
            WHERE r.id = projects.qc_entries.report_id
              AND public.user_effective_project_role(r.project_id)
                    IN ('owner', 'admin', 'project_manager', 'contractor')
        )
    );

DROP POLICY IF EXISTS qc_entries_delete ON projects.qc_entries;
CREATE POLICY qc_entries_delete ON projects.qc_entries
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM projects.qc_reports r
            WHERE r.id = projects.qc_entries.report_id
              AND public.user_effective_project_role(r.project_id)
                    IN ('owner', 'admin', 'project_manager')
        )
    );

-- qc_entry_photos ------------------------------------------------------------
DROP POLICY IF EXISTS qc_entry_photos_select ON projects.qc_entry_photos;
CREATE POLICY qc_entry_photos_select ON projects.qc_entry_photos
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM projects.qc_entries e
            JOIN projects.qc_reports r ON r.id = e.report_id
            WHERE e.id = projects.qc_entry_photos.entry_id
              AND public.user_has_project_access(r.project_id)
              AND (NOT public.user_is_client_viewer(r.organisation_id) OR r.status = 'issued')
        )
    );

DROP POLICY IF EXISTS qc_entry_photos_insert ON projects.qc_entry_photos;
CREATE POLICY qc_entry_photos_insert ON projects.qc_entry_photos
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects.qc_entries e
            JOIN projects.qc_reports r ON r.id = e.report_id
            WHERE e.id = projects.qc_entry_photos.entry_id
              AND public.user_effective_project_role(r.project_id)
                    IN ('owner', 'admin', 'project_manager', 'contractor')
        )
    );

DROP POLICY IF EXISTS qc_entry_photos_update ON projects.qc_entry_photos;
CREATE POLICY qc_entry_photos_update ON projects.qc_entry_photos
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM projects.qc_entries e
            JOIN projects.qc_reports r ON r.id = e.report_id
            WHERE e.id = projects.qc_entry_photos.entry_id
              AND public.user_effective_project_role(r.project_id)
                    IN ('owner', 'admin', 'project_manager', 'contractor')
        )
    );

DROP POLICY IF EXISTS qc_entry_photos_delete ON projects.qc_entry_photos;
CREATE POLICY qc_entry_photos_delete ON projects.qc_entry_photos
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM projects.qc_entries e
            JOIN projects.qc_reports r ON r.id = e.report_id
            WHERE e.id = projects.qc_entry_photos.entry_id
              AND public.user_effective_project_role(r.project_id)
                    IN ('owner', 'admin', 'project_manager')
        )
    );

-- qc_comments ----------------------------------------------------------------
DROP POLICY IF EXISTS qc_comments_select ON projects.qc_comments;
CREATE POLICY qc_comments_select ON projects.qc_comments
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM projects.qc_reports r
            WHERE r.id = projects.qc_comments.report_id
              AND public.user_has_project_access(r.project_id)
              AND (NOT public.user_is_client_viewer(r.organisation_id) OR r.status = 'issued')
        )
    );

DROP POLICY IF EXISTS qc_comments_insert ON projects.qc_comments;
CREATE POLICY qc_comments_insert ON projects.qc_comments
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects.qc_reports r
            WHERE r.id = projects.qc_comments.report_id
              AND public.user_effective_project_role(r.project_id)
                    IN ('owner', 'admin', 'project_manager', 'contractor')
        )
    );

DROP POLICY IF EXISTS qc_comments_update ON projects.qc_comments;
CREATE POLICY qc_comments_update ON projects.qc_comments
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM projects.qc_reports r
            WHERE r.id = projects.qc_comments.report_id
              AND public.user_effective_project_role(r.project_id)
                    IN ('owner', 'admin', 'project_manager', 'contractor')
        )
    );

DROP POLICY IF EXISTS qc_comments_delete ON projects.qc_comments;
CREATE POLICY qc_comments_delete ON projects.qc_comments
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM projects.qc_reports r
            WHERE r.id = projects.qc_comments.report_id
              AND public.user_effective_project_role(r.project_id)
                    IN ('owner', 'admin', 'project_manager')
        )
    );

-- Closed-report freeze — one guard on all three child tables. When the parent
-- QC report is CLOSED, its entries/photos/comments are immutable for end-user
-- sessions (auth.uid() IS NOT NULL); the service role (auth.uid() IS NULL —
-- gated server actions, migrations, admin repair) bypasses. Mirrors the
-- 00168 ISSUED-revision snapshot freeze (enforce_revision_data_frozen),
-- including its two edge rules:
--   * parent row already gone → the change is part of an authorised
--     ON DELETE CASCADE (the report delete itself passed the DELETE policy),
--     so it is allowed;
--   * an UPDATE re-pointing a row at another parent must not target a closed
--     report either.
-- Status changes on qc_reports itself are governed by qc_reports_status_guard
-- (§6), so a manager reopening a closed report (closed → issued) and then
-- editing stays possible.
CREATE OR REPLACE FUNCTION projects.qc_report_children_frozen() RETURNS TRIGGER
    SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
    v_old_report UUID;
    v_new_report UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    IF TG_TABLE_NAME = 'qc_entry_photos' THEN
        -- Photos carry no report_id — resolve via the parent entry.
        IF TG_OP <> 'INSERT' THEN
            SELECT e.report_id INTO v_old_report
            FROM projects.qc_entries e WHERE e.id = OLD.entry_id;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            SELECT e.report_id INTO v_new_report
            FROM projects.qc_entries e WHERE e.id = NEW.entry_id;
        END IF;
    ELSE
        IF TG_OP <> 'INSERT' THEN v_old_report := OLD.report_id; END IF;
        IF TG_OP <> 'DELETE' THEN v_new_report := NEW.report_id; END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM projects.qc_reports r
        WHERE r.id IN (v_old_report, v_new_report)
          AND r.status = 'closed'
    ) THEN
        RAISE EXCEPTION 'projects.%: the QC report is closed — its entries, photos and comments are frozen (reopen the report to make changes)', TG_TABLE_NAME
            USING ERRCODE = 'raise_exception';
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS qc_entries_frozen_guard ON projects.qc_entries;
CREATE TRIGGER qc_entries_frozen_guard
    BEFORE INSERT OR UPDATE OR DELETE ON projects.qc_entries
    FOR EACH ROW EXECUTE FUNCTION projects.qc_report_children_frozen();

DROP TRIGGER IF EXISTS qc_entry_photos_frozen_guard ON projects.qc_entry_photos;
CREATE TRIGGER qc_entry_photos_frozen_guard
    BEFORE INSERT OR UPDATE OR DELETE ON projects.qc_entry_photos
    FOR EACH ROW EXECUTE FUNCTION projects.qc_report_children_frozen();

DROP TRIGGER IF EXISTS qc_comments_frozen_guard ON projects.qc_comments;
CREATE TRIGGER qc_comments_frozen_guard
    BEFORE INSERT OR UPDATE OR DELETE ON projects.qc_comments
    FOR EACH ROW EXECUTE FUNCTION projects.qc_report_children_frozen();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Storage buckets — qc-report-entries (entry photos + flattened markup
--    PNGs; path {org_id}/{project_id}/{report_id}/{entry_id}/...) and
--    qc-reports (generated PDFs; path {org_id}/{project_id}/...).
--    Org-scoped Pattern-A object policies mirroring 00117; private.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'qc-report-entries', 'qc-report-entries', false,
    20971520,  -- 20 MiB
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'qc-reports', 'qc-reports', false,
    52428800,  -- 50 MiB
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- qc-report-entries policies
DROP POLICY IF EXISTS "Org members read qc report entries" ON storage.objects;
CREATE POLICY "Org members read qc report entries" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'qc-report-entries' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members upload qc report entries" ON storage.objects;
CREATE POLICY "Org members upload qc report entries" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'qc-report-entries' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members update qc report entries" ON storage.objects;
CREATE POLICY "Org members update qc report entries" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'qc-report-entries' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members delete qc report entries" ON storage.objects;
CREATE POLICY "Org members delete qc report entries" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'qc-report-entries' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));

-- qc-reports policies
DROP POLICY IF EXISTS "Org members read qc reports" ON storage.objects;
CREATE POLICY "Org members read qc reports" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'qc-reports' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members upload qc reports" ON storage.objects;
CREATE POLICY "Org members upload qc reports" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'qc-reports' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members update qc reports" ON storage.objects;
CREATE POLICY "Org members update qc reports" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'qc-reports' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members delete qc reports" ON storage.objects;
CREATE POLICY "Org members delete qc reports" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'qc-reports' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RESTRICTIVE client_viewer block on the two QC buckets — companion to
--    00162 (permissive org-path policies OR-combine, so a client_viewer,
--    being an org member, would otherwise pass; block with an AND-combined
--    RESTRICTIVE policy). Unlike 00162's buckets, SELECT is blocked too:
--    these are the first buckets whose objects carry draft/issued visibility
--    semantics, and the permissive org-member SELECT would let a
--    client_viewer list() and download DRAFT-report photos directly over the
--    storage API, voiding the table-RLS issued-only rule. No legitimate
--    client_viewer path reads these buckets with the viewer's own client
--    (verified 2026-07-14):
--      * the admin detail page signs qc-report-entries with the cookie
--        client, but client viewers never reach (admin) routes —
--        (admin)/layout.tsx redirects them to /portal;
--      * the portal PDF flow (portal-qc.actions.ts) gates via RLS table
--        reads and signs from qc-reports with the SERVICE client, as does
--        getProjectReportUrlAction (project-reports.actions.ts); signed URLs
--        are signature-verified, not RLS-evaluated, so they keep working.
--    Both buckets put the org id in folder[1], so the ::uuid cast is safe for
--    any object the permissive policy admits; other buckets fall through to
--    TRUE.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "client_viewer_no_qc_bucket_select" ON storage.objects;
DROP POLICY IF EXISTS "client_viewer_no_qc_bucket_insert" ON storage.objects;
DROP POLICY IF EXISTS "client_viewer_no_qc_bucket_update" ON storage.objects;
DROP POLICY IF EXISTS "client_viewer_no_qc_bucket_delete" ON storage.objects;

CREATE POLICY "client_viewer_no_qc_bucket_select" ON storage.objects
    AS RESTRICTIVE FOR SELECT TO authenticated
    USING (
        CASE WHEN bucket_id = ANY (ARRAY['qc-report-entries', 'qc-reports'])
             THEN NOT public.user_is_client_viewer(((storage.foldername(name))[1])::uuid)
             ELSE TRUE
        END
    );

CREATE POLICY "client_viewer_no_qc_bucket_insert" ON storage.objects
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (
        CASE WHEN bucket_id = ANY (ARRAY['qc-report-entries', 'qc-reports'])
             THEN NOT public.user_is_client_viewer(((storage.foldername(name))[1])::uuid)
             ELSE TRUE
        END
    );

CREATE POLICY "client_viewer_no_qc_bucket_update" ON storage.objects
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (
        CASE WHEN bucket_id = ANY (ARRAY['qc-report-entries', 'qc-reports'])
             THEN NOT public.user_is_client_viewer(((storage.foldername(name))[1])::uuid)
             ELSE TRUE
        END
    )
    WITH CHECK (
        CASE WHEN bucket_id = ANY (ARRAY['qc-report-entries', 'qc-reports'])
             THEN NOT public.user_is_client_viewer(((storage.foldername(name))[1])::uuid)
             ELSE TRUE
        END
    );

CREATE POLICY "client_viewer_no_qc_bucket_delete" ON storage.objects
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (
        CASE WHEN bucket_id = ANY (ARRAY['qc-report-entries', 'qc-reports'])
             THEN NOT public.user_is_client_viewer(((storage.foldername(name))[1])::uuid)
             ELSE TRUE
        END
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. PostgREST reload (new tables + buckets in already-exposed schemas;
--     no schema CREATE/DROP, so no config PATCH — NOTIFY suffices).
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
