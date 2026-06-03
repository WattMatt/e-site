-- =============================================================================
-- Migration 00117 — standardized report export + branding foundation (PR-A)
-- =============================================================================
-- Pure-DB foundation for the standardized PDF report engine (backlog #4).
-- Adds:
--   • projects.projects branding columns (client/project logos + accent override)
--   • public.organisations.report_accent_color (org default accent)
--   • projects.reports — unified, versioned, saved-artifact table for every
--     generated report (inspection / snag / handover / …), branding snapshot
--     frozen per issue.
--   • two private Storage buckets: report-logos (raster brand assets) and
--     reports (generated PDFs), org-scoped RLS mirroring 00042/00091.
-- No real report KIND ships here — infrastructure that PR-B…E build on.
--
-- Non-destructive, additive, idempotent (safe to re-run). projects + storage
-- are already PostgREST-exposed, so a trailing NOTIFY is sufficient — no config
-- PATCH. Apply via the controller (mgmt_apply_sql_file), then record the ledger
-- row (00117); or merge to main and let deploy-migrations.yml apply + record it.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Branding columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE projects.projects
  ADD COLUMN IF NOT EXISTS client_logo_url     TEXT,
  ADD COLUMN IF NOT EXISTS project_logo_url    TEXT,
  ADD COLUMN IF NOT EXISTS report_accent_color TEXT;

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS report_accent_color TEXT;

-- Optional hex-colour guards (idempotent named CHECKs; NULL allowed).
ALTER TABLE projects.projects DROP CONSTRAINT IF EXISTS projects_report_accent_hex;
ALTER TABLE projects.projects ADD CONSTRAINT projects_report_accent_hex
  CHECK (report_accent_color IS NULL OR report_accent_color ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE public.organisations DROP CONSTRAINT IF EXISTS organisations_report_accent_hex;
ALTER TABLE public.organisations ADD CONSTRAINT organisations_report_accent_hex
  CHECK (report_accent_color IS NULL OR report_accent_color ~ '^#[0-9A-Fa-f]{6}$');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. projects.reports — saved report artifacts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects.reports (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id   UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    project_id        UUID        NOT NULL REFERENCES projects.projects(id)    ON DELETE CASCADE,
    kind              TEXT        NOT NULL,
    source_table      TEXT,
    source_id         UUID,
    title             TEXT        NOT NULL,
    storage_path      TEXT        NOT NULL,
    mime_type         TEXT        NOT NULL DEFAULT 'application/pdf',
    size_bytes        INTEGER,
    status            TEXT        NOT NULL DEFAULT 'issued',
    version           INTEGER     NOT NULL DEFAULT 1,
    superseded_by     UUID        REFERENCES projects.reports(id) ON DELETE SET NULL,
    branding_snapshot JSONB,
    generated_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent named CHECKs (an inline CHECK wouldn't re-apply under CREATE IF NOT EXISTS).
ALTER TABLE projects.reports DROP CONSTRAINT IF EXISTS reports_status_check;
ALTER TABLE projects.reports ADD CONSTRAINT reports_status_check
  CHECK (status IN ('draft','issued','superseded','revoked'));

ALTER TABLE projects.reports DROP CONSTRAINT IF EXISTS reports_version_positive;
ALTER TABLE projects.reports ADD CONSTRAINT reports_version_positive
  CHECK (version >= 1);

CREATE INDEX IF NOT EXISTS reports_project_idx      ON projects.reports (project_id);
CREATE INDEX IF NOT EXISTS reports_project_kind_idx ON projects.reports (project_id, kind);
CREATE INDEX IF NOT EXISTS reports_source_idx       ON projects.reports (source_table, source_id);

DROP TRIGGER IF EXISTS reports_updated_at ON projects.reports;
CREATE TRIGGER reports_updated_at
    BEFORE UPDATE ON projects.reports
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS — read = any user with project access; defensive owner/admin/PM write.
--    (Generation runs through gated server actions on the service client, which
--    bypasses RLS; the write policy is defence-in-depth, mirroring 00101.)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE projects.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reports_select ON projects.reports;
CREATE POLICY reports_select
    ON projects.reports
    FOR SELECT TO authenticated
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS reports_write ON projects.reports;
CREATE POLICY reports_write
    ON projects.reports
    FOR ALL TO authenticated
    USING (
        organisation_id IN (
            SELECT organisation_id FROM public.user_organisations
            WHERE user_id = auth.uid() AND is_active
              AND role IN ('owner','admin','project_manager')
        )
    )
    WITH CHECK (
        organisation_id IN (
            SELECT organisation_id FROM public.user_organisations
            WHERE user_id = auth.uid() AND is_active
              AND role IN ('owner','admin','project_manager')
        )
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Storage buckets — report-logos (raster brand assets) + reports (PDFs).
--    Org-scoped object policies; path {org_id}/{project_id}/...; private.
--    Role-level write authorization lives at the action layer (repo convention);
--    bucket policies only check org membership.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'report-logos', 'report-logos', false,
    5242880,  -- 5 MiB
    ARRAY['image/png','image/jpeg','image/webp']  -- raster only (react-pdf SVG support is partial)
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'reports', 'reports', false,
    52428800,  -- 50 MiB
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- report-logos policies
DROP POLICY IF EXISTS "Org members read report logos" ON storage.objects;
CREATE POLICY "Org members read report logos" ON storage.objects FOR SELECT
  USING (bucket_id = 'report-logos' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members upload report logos" ON storage.objects;
CREATE POLICY "Org members upload report logos" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'report-logos' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members update report logos" ON storage.objects;
CREATE POLICY "Org members update report logos" ON storage.objects FOR UPDATE
  USING (bucket_id = 'report-logos' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members delete report logos" ON storage.objects;
CREATE POLICY "Org members delete report logos" ON storage.objects FOR DELETE
  USING (bucket_id = 'report-logos' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));

-- reports policies
DROP POLICY IF EXISTS "Org members read reports" ON storage.objects;
CREATE POLICY "Org members read reports" ON storage.objects FOR SELECT
  USING (bucket_id = 'reports' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members upload reports" ON storage.objects;
CREATE POLICY "Org members upload reports" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'reports' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members update reports" ON storage.objects;
CREATE POLICY "Org members update reports" ON storage.objects FOR UPDATE
  USING (bucket_id = 'reports' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members delete reports" ON storage.objects;
CREATE POLICY "Org members delete reports" ON storage.objects FOR DELETE
  USING (bucket_id = 'reports' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PostgREST reload (table + columns + buckets in already-exposed schemas;
--    no schema CREATE/DROP, so no config PATCH — NOTIFY suffices).
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
