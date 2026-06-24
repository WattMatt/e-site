-- ---------------------------------------------------------------------------
-- 00145_diary_write_client_viewer_guard.sql
-- Security fix: stop read-only client_viewers writing site diary data.
--
-- Problem (privilege escalation):
--   00027 added INSERT/UPDATE policies on projects.site_diary_entries that
--   only checked org membership (`organisation_id = ANY(get_user_org_ids())`).
--   00032 re-issued them adding the payment_paused guard but still WITHOUT a
--   role check. 00091 created site_diary_attachments INSERT/UPDATE policies
--   the same way. The SELECT side was later scoped per-role in 00034, but the
--   WRITE side never was — so a `client_viewer` (a read-only third party) can
--   INSERT/UPDATE diary entries and attachments for ANY project in their org
--   via a direct PostgREST call. The UI hides the button, but RLS is the real
--   gate and it was open.
--
-- Fix:
--   Re-issue the diary INSERT/UPDATE policies with
--   `AND NOT public.user_is_client_viewer(organisation_id)` (helper from
--   00034). client_viewers are read-only, so they are denied diary writes
--   entirely; internal roles (owner/admin/project_manager/contractor) keep
--   their existing org-scoped, payment_paused-aware write access unchanged.
-- ---------------------------------------------------------------------------

-- ── projects.site_diary_entries — INSERT ────────────────────────────────────
DROP POLICY IF EXISTS "Org members can create diary entries" ON projects.site_diary_entries;
CREATE POLICY "Org members can create diary entries"
    ON projects.site_diary_entries FOR INSERT
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
        AND NOT EXISTS (
            SELECT 1 FROM projects.projects p
            WHERE p.id = project_id
              AND p.status = 'payment_paused'
        )
    );

-- ── projects.site_diary_entries — UPDATE ────────────────────────────────────
DROP POLICY IF EXISTS "Org members can update diary entries" ON projects.site_diary_entries;
CREATE POLICY "Org members can update diary entries"
    ON projects.site_diary_entries FOR UPDATE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
        AND NOT EXISTS (
            SELECT 1 FROM projects.projects p
            WHERE p.id = project_id
              AND p.status = 'payment_paused'
        )
    );

-- ── projects.site_diary_attachments — INSERT ────────────────────────────────
-- Scoped through the parent entry (mirrors the SELECT policy from 00091),
-- now with the client_viewer exclusion.
DROP POLICY IF EXISTS "Org members can add diary attachments" ON projects.site_diary_attachments;
CREATE POLICY "Org members can add diary attachments"
    ON projects.site_diary_attachments FOR INSERT
    WITH CHECK (
        diary_entry_id IN (
            SELECT id FROM projects.site_diary_entries
            WHERE organisation_id = ANY(public.get_user_org_ids())
              AND NOT public.user_is_client_viewer(organisation_id)
        )
    );

-- ── projects.site_diary_attachments — UPDATE ────────────────────────────────
DROP POLICY IF EXISTS "Org members can update diary attachments" ON projects.site_diary_attachments;
CREATE POLICY "Org members can update diary attachments"
    ON projects.site_diary_attachments FOR UPDATE
    USING (
        diary_entry_id IN (
            SELECT id FROM projects.site_diary_entries
            WHERE organisation_id = ANY(public.get_user_org_ids())
              AND NOT public.user_is_client_viewer(organisation_id)
        )
    );
