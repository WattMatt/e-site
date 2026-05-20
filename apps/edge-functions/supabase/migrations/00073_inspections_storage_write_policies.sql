-- 00073_inspections_storage_write_policies.sql
--
-- Adds INSERT/DELETE policies on storage.objects for the 4 inspection-* buckets.
-- Migration 00066 seeded only SELECT (read) policies on these buckets, so any
-- authenticated user trying to upload (= INSERT into storage.objects) hits the
-- default RLS deny and gets "new row violates row-level security policy".
--
-- This was an undetected gap until 2026-05-19 when arno first attempted a photo
-- upload on Line Shop Handover. The fix uses the same user_can_write_responses
-- helper that gates inspections.responses + inspections.photos writes, so any
-- user who can fill out the inspection can also upload photos/signatures/files
-- to its buckets.
--
-- File-path convention (route handlers): {project_id}/{inspection_id}/...
-- so storage.foldername(name)[2] = inspection_id.

-- ----- inspection-photos -----
CREATE POLICY "inspection-photos write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'inspection-photos'
    AND inspections.user_can_write_responses(((storage.foldername(name))[2])::uuid)
  );

CREATE POLICY "inspection-photos delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'inspection-photos'
    AND inspections.user_can_write_responses(((storage.foldername(name))[2])::uuid)
  );

-- ----- inspection-signatures -----
-- Signatures permit awaiting_verification too (verifier sign-off path) so we use
-- a broader writability check inline. user_can_write_responses returns false for
-- awaiting_verification; we OR in the verifier-only path.
CREATE POLICY "inspection-signatures write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'inspection-signatures'
    AND (
      inspections.user_can_write_responses(((storage.foldername(name))[2])::uuid)
      OR inspections.is_inspection_verifier(((storage.foldername(name))[2])::uuid)
    )
  );

CREATE POLICY "inspection-signatures delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'inspection-signatures'
    AND (
      inspections.user_can_write_responses(((storage.foldername(name))[2])::uuid)
      OR inspections.is_inspection_verifier(((storage.foldername(name))[2])::uuid)
    )
  );

-- ----- inspection-attachments (re-uses user_can_write_responses) -----
CREATE POLICY "inspection-attachments write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'inspection-attachments'
    AND inspections.user_can_write_responses(((storage.foldername(name))[2])::uuid)
  );

CREATE POLICY "inspection-attachments delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'inspection-attachments'
    AND inspections.user_can_write_responses(((storage.foldername(name))[2])::uuid)
  );

-- ----- inspection-certificates -----
-- Only the PDF renderer edge function writes certificate PDFs. It uses service
-- role, which bypasses RLS, so we don't need an authenticated INSERT policy.
-- Adding a permissive read-only attitude here (no INSERT policy added on purpose).
-- If certificate uploads ever need to happen from an authenticated path, add a
-- policy gated by inspections.is_inspection_verifier here.
