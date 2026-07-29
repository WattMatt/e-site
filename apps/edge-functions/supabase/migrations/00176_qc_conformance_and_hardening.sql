-- =============================================================================
-- Migration 00176 — QC reports: conformance model + production hardening
-- =============================================================================
-- Spec: docs/superpowers/specs/2026-07-28-qc-production-hardening.md
--
-- Builds on 00172 (QC reports) + 00173 (notifications type enum). Additive and
-- idempotent throughout; every object is DROP+CREATE / IF (NOT) EXISTS / named
-- CHECK via DROP CONSTRAINT + ADD, so the file is safe to re-run.
--
--   (a) Conformance model — projects.qc_entries gains:
--         conformance TEXT NOT NULL DEFAULT 'na' CHECK (pass|fail|na)
--         severity    TEXT NULL      CHECK (NULL OR minor|major|critical)
--       (default 'na' keeps existing rows valid; the app layer forces an
--       explicit choice on new entries, and enforces "severity present iff
--       conformance='fail'" — the DB only bounds the value domain, not the
--       relationship, so a re-run never trips on legacy rows).
--       + index (report_id, conformance) for the report-level tally/filter.
--
--   (b) Defect S1 — org/project tenancy binding in the write policies. The
--       00172 write policies keyed only off the effective project role; a
--       caller with a write role could INSERT/UPDATE a qc_reports row whose
--       organisation_id, or a child row whose denormalised project_id/
--       organisation_id, pointed at a DIFFERENT tenant. Each WITH CHECK now
--       additionally binds those columns to the truth (the project's real org
--       for qc_reports; the parent report's real project_id + organisation_id
--       for the children). The effective-role checks are unchanged.
--
--   (c) Defect S2 — the denormalised project_id columns on qc_entries /
--       qc_entry_photos had no index (listByProject filters both by
--       project_id). Add them.
--
--   (d) Portal decision 2 — CLOSED QC reports stay client-visible (read-only
--       "Archived"), so the client_viewer SELECT clause on qc_reports (and,
--       to keep the model consistent, the re-derived clause on every child
--       SELECT policy) becomes status IN ('issued','closed'). Drafts stay
--       hidden. The child SELECT policies do NOT chain off the parent policy —
--       each re-derives the visibility rule via its own EXISTS on qc_reports,
--       so all four must be rewritten together.
--
--   (e) Comment notifications — extend notifications_type_check (00173
--       pattern: DROP + re-ADD the full enum) with 'qc_comment'.
--
-- No schema CREATE/DROP and no new PostgREST-exposed objects beyond columns on
-- an already-exposed table → NOTIFY reload only, no db_schema PATCH.
--
-- This migration does NOT apply to any database — applied by
-- deploy-migrations.yml on merge to main.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- (a) Conformance / severity columns + CHECKs + tally index on qc_entries
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE projects.qc_entries
    ADD COLUMN IF NOT EXISTS conformance TEXT NOT NULL DEFAULT 'na';
ALTER TABLE projects.qc_entries
    ADD COLUMN IF NOT EXISTS severity TEXT;

-- Named CHECKs (inline CHECKs wouldn't re-apply under ADD COLUMN IF NOT EXISTS).
ALTER TABLE projects.qc_entries DROP CONSTRAINT IF EXISTS qc_entries_conformance_check;
ALTER TABLE projects.qc_entries ADD  CONSTRAINT qc_entries_conformance_check
    CHECK (conformance IN ('pass', 'fail', 'na'));

-- Value-domain only. The "severity present iff conformance='fail'" relationship
-- is enforced at the app layer (qc.schema superRefine) so legacy 'na'/NULL rows
-- stay valid and this migration re-runs cleanly.
ALTER TABLE projects.qc_entries DROP CONSTRAINT IF EXISTS qc_entries_severity_check;
ALTER TABLE projects.qc_entries ADD  CONSTRAINT qc_entries_severity_check
    CHECK (severity IS NULL OR severity IN ('minor', 'major', 'critical'));

CREATE INDEX IF NOT EXISTS qc_entries_report_conformance_idx
    ON projects.qc_entries (report_id, conformance);

-- ─────────────────────────────────────────────────────────────────────────────
-- (c) Defect S2 — indexes on the denormalised project_id columns
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS qc_entries_project_idx       ON projects.qc_entries (project_id);
CREATE INDEX IF NOT EXISTS qc_entry_photos_project_idx  ON projects.qc_entry_photos (project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- (b)+(d) qc_reports policies — org binding on writes; closed-visibility on SELECT
--    SELECT: unchanged access gate; client_viewer now sees issued OR closed.
--    INSERT/UPDATE: effective-role check UNCHANGED, plus organisation_id bound
--                   to the project's real org (a write-role holder can no longer
--                   plant a foreign organisation_id).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS qc_reports_select ON projects.qc_reports;
CREATE POLICY qc_reports_select ON projects.qc_reports
    FOR SELECT TO authenticated
    USING (
        public.user_has_project_access(project_id)
        AND (NOT public.user_is_client_viewer(organisation_id) OR status IN ('issued', 'closed'))
    );

DROP POLICY IF EXISTS qc_reports_insert ON projects.qc_reports;
CREATE POLICY qc_reports_insert ON projects.qc_reports
    FOR INSERT TO authenticated
    WITH CHECK (
        public.user_effective_project_role(project_id)
            IN ('owner', 'admin', 'project_manager', 'contractor')
        AND organisation_id = (
            SELECT p.organisation_id FROM projects.projects p WHERE p.id = project_id
        )
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
        AND organisation_id = (
            SELECT p.organisation_id FROM projects.projects p WHERE p.id = project_id
        )
    );

-- DELETE unchanged from 00172 (kept here so the policy set is self-describing).
DROP POLICY IF EXISTS qc_reports_delete ON projects.qc_reports;
CREATE POLICY qc_reports_delete ON projects.qc_reports
    FOR DELETE TO authenticated
    USING (
        public.user_effective_project_role(project_id)
            IN ('owner', 'admin', 'project_manager')
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- qc_entries policies — SELECT re-derives closed-visibility; INSERT/UPDATE bind
-- the denormalised project_id + organisation_id to the parent report's truth.
-- Effective-role EXISTS shape is identical to 00172.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS qc_entries_select ON projects.qc_entries;
CREATE POLICY qc_entries_select ON projects.qc_entries
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM projects.qc_reports r
            WHERE r.id = projects.qc_entries.report_id
              AND public.user_has_project_access(r.project_id)
              AND (NOT public.user_is_client_viewer(r.organisation_id) OR r.status IN ('issued', 'closed'))
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
              AND projects.qc_entries.project_id      = r.project_id
              AND projects.qc_entries.organisation_id = r.organisation_id
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
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects.qc_reports r
            WHERE r.id = projects.qc_entries.report_id
              AND public.user_effective_project_role(r.project_id)
                    IN ('owner', 'admin', 'project_manager', 'contractor')
              AND projects.qc_entries.project_id      = r.project_id
              AND projects.qc_entries.organisation_id = r.organisation_id
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

-- ─────────────────────────────────────────────────────────────────────────────
-- qc_entry_photos policies — SELECT re-derives closed-visibility; INSERT/UPDATE
-- bind project_id + organisation_id to the parent report (resolved via entry).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS qc_entry_photos_select ON projects.qc_entry_photos;
CREATE POLICY qc_entry_photos_select ON projects.qc_entry_photos
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM projects.qc_entries e
            JOIN projects.qc_reports r ON r.id = e.report_id
            WHERE e.id = projects.qc_entry_photos.entry_id
              AND public.user_has_project_access(r.project_id)
              AND (NOT public.user_is_client_viewer(r.organisation_id) OR r.status IN ('issued', 'closed'))
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
              AND projects.qc_entry_photos.project_id      = r.project_id
              AND projects.qc_entry_photos.organisation_id = r.organisation_id
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
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects.qc_entries e
            JOIN projects.qc_reports r ON r.id = e.report_id
            WHERE e.id = projects.qc_entry_photos.entry_id
              AND public.user_effective_project_role(r.project_id)
                    IN ('owner', 'admin', 'project_manager', 'contractor')
              AND projects.qc_entry_photos.project_id      = r.project_id
              AND projects.qc_entry_photos.organisation_id = r.organisation_id
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

-- ─────────────────────────────────────────────────────────────────────────────
-- qc_comments — SELECT re-derives closed-visibility (writes unchanged from
-- 00172; comments carry no denormalised project_id/organisation_id to bind).
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS qc_comments_select ON projects.qc_comments;
CREATE POLICY qc_comments_select ON projects.qc_comments
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM projects.qc_reports r
            WHERE r.id = projects.qc_comments.report_id
              AND public.user_has_project_access(r.project_id)
              AND (NOT public.user_is_client_viewer(r.organisation_id) OR r.status IN ('issued', 'closed'))
        )
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- (e) notifications_type_check — re-ADD the full 00173 enum + 'qc_comment'
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    -- pre-existing types (from 00066)
    'snag_status_changed',
    'rfi_assigned',
    'rfi_closed',
    'rfi_response',
    'grn_recorded',
    -- inspection lifecycle types (from 00066)
    'inspection_assigned',
    'inspection_awaiting_verification',
    'inspection_certified',
    'inspection_re_inspect_required',
    'inspection_revoked',
    -- abandon event (from 00072)
    'inspection_abandoned',
    -- QC reports + previously-missing "created" bells (from 00173)
    'qc_issued',
    'rfi_created',
    'snag_created',
    'diary_created',
    -- new (00176): QC per-photo/entry comment bell
    'qc_comment'
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PostgREST reload (new columns on an already-exposed table; no schema
-- CREATE/DROP → NOTIFY suffices, no config PATCH).
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
