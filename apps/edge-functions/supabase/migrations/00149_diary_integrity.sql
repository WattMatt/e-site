-- ---------------------------------------------------------------------------
-- 00149_diary_integrity.sql
-- Diary data-integrity hardening (Phase 5 of the site-diary remediation).
--
-- 1. Bound workers_on_site. The web form validates >= 0 via Zod, but the mobile
--    client historically wrote without the shared schema, and the column had no
--    DB guard at all. Added NOT VALID so it enforces every NEW insert/update
--    without failing this migration on any pre-existing out-of-range rows.
--
-- 2. Add an author-scoped DELETE policy on site_diary_entries. RLS is enabled
--    but there was NO DELETE policy, so RLS-client deletes were silently denied
--    (the in-app delete works only because deleteDiaryEntryAction uses the
--    service-role client behind an author-or-PM gate). A *broad* org-scoped
--    DELETE policy would WEAKEN this (any contractor could delete any entry via
--    a direct PostgREST call), so this is scoped to the author only — owner /
--    admin / PM deletes continue to flow through the gated server action.
-- ---------------------------------------------------------------------------

-- 1. workers_on_site bound (enforced on new/updated rows; legacy rows untouched)
ALTER TABLE projects.site_diary_entries
    DROP CONSTRAINT IF EXISTS site_diary_entries_workers_chk;
ALTER TABLE projects.site_diary_entries
    ADD CONSTRAINT site_diary_entries_workers_chk
    CHECK (workers_on_site IS NULL OR (workers_on_site >= 0 AND workers_on_site <= 100000))
    NOT VALID;

-- 2. Author-only DELETE policy (defense in depth; matches the author half of the
--    in-app author-or-PM gate without opening direct deletes to all members).
DROP POLICY IF EXISTS "Authors can delete their diary entries" ON projects.site_diary_entries;
CREATE POLICY "Authors can delete their diary entries"
    ON projects.site_diary_entries FOR DELETE
    USING (
        created_by = auth.uid()
        AND organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );
