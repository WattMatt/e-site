-- ============================================================================
-- 00159 — inspections capture + validation hardening
-- ============================================================================
-- Four related fixes surfaced by the inspections end-to-end audit:
--
-- 1. coc_validations.certificate_id → nullable.
--    The certify pipeline files branded certificate PDFs into projects.reports
--    (Node renderer — see file-inspection-report.ts) and no longer creates
--    inspections.certificates rows, so requiring certificate_id silently
--    killed the validation audit: certifyInspectionAction found no certificate
--    row and never invoked validate-inspection. Batches are now keyed on
--    inspection_id; certificate_id stays as a nullable legacy column for rows
--    written by the retired render-inspection-pdf flow.
--
-- 2. photos.file_size_bytes was never added.
--    The mobile upload-worker inserts it (and 00071's column comments already
--    describe it as existing) — every mobile photo metadata insert fails with
--    PGRST204 "column not found", so field photos land in storage but never
--    appear in the app or in reports.
--
-- 3. Attribution defaults.
--    photos.uploaded_by / signatures.signed_by are NOT NULL with no default,
--    and the mobile upload-worker omits both — NOT NULL violations on every
--    mobile insert. DEFAULT auth.uid() fixes all existing app binaries
--    without an app-store release.
--
-- 4. Attribution pinning.
--    With web capture inserts moving client-side (direct-to-storage upload
--    path), uploaded_by / signed_by become client-supplied values on a
--    compliance audit trail — and photos_delete's "uploader" branch keys off
--    uploaded_by. Pin both to auth.uid() in the INSERT policies so a
--    contributor cannot forge attribution. Service-role writers bypass RLS
--    and are unaffected. signatures_insert also gains the is_active guard
--    applied to the helper functions in 00152/00153.
-- ============================================================================

BEGIN;

-- ── 1. Validation batches keyed by inspection ───────────────────────────────
ALTER TABLE inspections.coc_validations
  ALTER COLUMN certificate_id DROP NOT NULL;

COMMENT ON COLUMN inspections.coc_validations.certificate_id IS
  'Legacy link to inspections.certificates (retired render-inspection-pdf flow). NULL for batches written since the projects.reports pipeline; inspection_id is the operative key.';

-- ── 2. Column the mobile upload-worker has been inserting all along ─────────
ALTER TABLE inspections.photos
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;

COMMENT ON COLUMN inspections.photos.file_size_bytes IS
  'Byte size of the storage_path variant (800px thumbnail on the mobile dual-upload path; the single compressed upload on web).';

-- ── 3. Attribution defaults (fixes mobile inserts without an app release) ───
ALTER TABLE inspections.photos
  ALTER COLUMN uploaded_by SET DEFAULT auth.uid();
ALTER TABLE inspections.signatures
  ALTER COLUMN signed_by SET DEFAULT auth.uid();

-- ── 4. Pin attribution to the caller ────────────────────────────────────────
DROP POLICY IF EXISTS photos_insert ON inspections.photos;
CREATE POLICY photos_insert ON inspections.photos FOR INSERT TO authenticated
  WITH CHECK (
    inspections.user_can_write_responses(inspection_id)
    AND uploaded_by = auth.uid()
  );

DROP POLICY IF EXISTS signatures_insert ON inspections.signatures;
CREATE POLICY signatures_insert ON inspections.signatures FOR INSERT TO authenticated
  WITH CHECK (
    signed_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM inspections.inspections i
      JOIN public.user_organisations uo
        ON uo.organisation_id = i.organisation_id AND uo.user_id = auth.uid()
      WHERE i.id = inspection_id
        AND uo.role <> 'client_viewer'
        AND uo.is_active = TRUE
        AND i.status NOT IN ('certified','abandoned')
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
