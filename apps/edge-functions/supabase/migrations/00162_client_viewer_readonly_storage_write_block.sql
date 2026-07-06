-- ---------------------------------------------------------------------------
-- 00162_client_viewer_readonly_storage_write_block.sql
--
-- SECURITY companion to 00161 — extend client_viewer read-only enforcement to
-- the storage.objects WRITE surface.
--
-- Same root cause and rationale as 00161: the existing permissive storage
-- write policies authorise by org membership alone —
--   (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
-- — so a client_viewer (an org member) can upload/modify/delete objects via the
-- Storage API. PostgreSQL OR-combines permissive policies, so we block with a
-- RESTRICTIVE policy instead (AND-combined, future-proof).
--
-- Scope: the org-path buckets whose FIRST folder segment IS the org id. For any
-- object in these buckets the existing permissive policy already guarantees
-- folder[1] ∈ the caller's org ids (all UUIDs), so the ::uuid cast below is
-- safe. Non-listed buckets fall through the CASE to TRUE and are unaffected —
-- notably `boq-imports`, which uses a PROJECT-path layout + user_has_project_
-- access and is tracked separately.
--
-- Read (SELECT / download) is deliberately untouched — restrictions apply only
-- to INSERT / UPDATE / DELETE. NOT user_is_client_viewer(...) is TRUE for every
-- non-viewer, so no non-viewer upload flow changes.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "client_viewer_no_bucket_insert" ON storage.objects;
DROP POLICY IF EXISTS "client_viewer_no_bucket_update" ON storage.objects;
DROP POLICY IF EXISTS "client_viewer_no_bucket_delete" ON storage.objects;

CREATE POLICY "client_viewer_no_bucket_insert" ON storage.objects
    AS RESTRICTIVE FOR INSERT TO authenticated
    WITH CHECK (
        CASE WHEN bucket_id = ANY (ARRAY[
                'rfi-attachments','diary-attachments','project-documents',
                'snag-photos','report-logos','reports','jbcc-letters',
                'drawings','coc-documents'])
             THEN NOT public.user_is_client_viewer(((storage.foldername(name))[1])::uuid)
             ELSE TRUE
        END
    );

CREATE POLICY "client_viewer_no_bucket_update" ON storage.objects
    AS RESTRICTIVE FOR UPDATE TO authenticated
    USING (
        CASE WHEN bucket_id = ANY (ARRAY[
                'rfi-attachments','diary-attachments','project-documents',
                'snag-photos','report-logos','reports','jbcc-letters',
                'drawings','coc-documents'])
             THEN NOT public.user_is_client_viewer(((storage.foldername(name))[1])::uuid)
             ELSE TRUE
        END
    )
    WITH CHECK (
        CASE WHEN bucket_id = ANY (ARRAY[
                'rfi-attachments','diary-attachments','project-documents',
                'snag-photos','report-logos','reports','jbcc-letters',
                'drawings','coc-documents'])
             THEN NOT public.user_is_client_viewer(((storage.foldername(name))[1])::uuid)
             ELSE TRUE
        END
    );

CREATE POLICY "client_viewer_no_bucket_delete" ON storage.objects
    AS RESTRICTIVE FOR DELETE TO authenticated
    USING (
        CASE WHEN bucket_id = ANY (ARRAY[
                'rfi-attachments','diary-attachments','project-documents',
                'snag-photos','report-logos','reports','jbcc-letters',
                'drawings','coc-documents'])
             THEN NOT public.user_is_client_viewer(((storage.foldername(name))[1])::uuid)
             ELSE TRUE
        END
    );
