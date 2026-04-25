-- ---------------------------------------------------------------------------
-- Migration 00032: payment_paused write-block RLS (T-064 follow-up)
-- ---------------------------------------------------------------------------
-- The PaymentStatusBanner added in Session 5 warns the user; these policies
-- enforce the restriction at the database level — denying INSERT and UPDATE on
-- child records when the parent project is 'payment_paused'.
--
-- Spec: spec-v2.md §18 | tasks.md T-064 code follow-up
--
-- Tables affected:
--   field.snags               — blocked via project_id FK
--   projects.site_diary_entries — blocked via project_id FK
--   compliance.coc_uploads    — blocked via organisation_id (no direct project_id)
-- ---------------------------------------------------------------------------

-- ── field.snags ──────────────────────────────────────────────────────────────

-- Replace the INSERT policy to add the payment_paused guard.
DROP POLICY IF EXISTS "Contractors and above can create snags" ON field.snags;
CREATE POLICY "Contractors and above can create snags"
    ON field.snags FOR INSERT
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT EXISTS (
            SELECT 1 FROM projects.projects p
            WHERE p.id = project_id
              AND p.status = 'payment_paused'
        )
    );

-- Replace the UPDATE policy to block edits on paused-project snags.
DROP POLICY IF EXISTS "Org members can update snags" ON field.snags;
CREATE POLICY "Org members can update snags"
    ON field.snags FOR UPDATE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT EXISTS (
            SELECT 1 FROM projects.projects p
            WHERE p.id = project_id
              AND p.status = 'payment_paused'
        )
    );

-- ── projects.site_diary_entries ──────────────────────────────────────────────
-- Replace the INSERT/UPDATE policies (00027 added them without the guard) with
-- payment_paused-aware versions.

DROP POLICY IF EXISTS "Org members can create diary entries" ON projects.site_diary_entries;
CREATE POLICY "Org members can create diary entries"
    ON projects.site_diary_entries FOR INSERT
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT EXISTS (
            SELECT 1 FROM projects.projects p
            WHERE p.id = project_id
              AND p.status = 'payment_paused'
        )
    );

DROP POLICY IF EXISTS "Org members can update diary entries" ON projects.site_diary_entries;
CREATE POLICY "Org members can update diary entries"
    ON projects.site_diary_entries FOR UPDATE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT EXISTS (
            SELECT 1 FROM projects.projects p
            WHERE p.id = project_id
              AND p.status = 'payment_paused'
        )
    );

-- ── compliance.coc_uploads ───────────────────────────────────────────────────
-- coc_uploads has no direct project_id (chain: upload → subsection → site → project_sites).
-- Block at the org level: deny if any project for this org is payment_paused.

DROP POLICY IF EXISTS "Org members can upload COCs" ON compliance.coc_uploads;
CREATE POLICY "Org members can upload COCs"
    ON compliance.coc_uploads FOR INSERT
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT EXISTS (
            SELECT 1 FROM projects.projects p
            WHERE p.organisation_id = organisation_id
              AND p.status = 'payment_paused'
        )
    );

-- ---------------------------------------------------------------------------
-- Note on service-role bypass: all policies are for `authenticated` role.
-- The payment-recovery-check Edge Function runs under service_role, which
-- bypasses RLS, so it can still set status = 'payment_paused' and later
-- restore status = 'active' without hitting these guards.
-- ---------------------------------------------------------------------------
