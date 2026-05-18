-- 00071_inspections_photos_original_path.sql
--
-- Adds two columns to inspections.photos to support dual-resolution uploads:
--   file_path / storage_path  → 800px / q=0.7 thumbnail (~100KB) — UI grids, lightbox preview
--   original_path             → 4096px / q=0.92 original — PDF render, audit evidence
--
-- PDF renderer prefers original_path when present, falls back to storage_path.
-- Mobile upload-worker writes both variants in a single pass.

ALTER TABLE inspections.photos ADD COLUMN IF NOT EXISTS original_path TEXT;
ALTER TABLE inspections.photos ADD COLUMN IF NOT EXISTS original_size_bytes BIGINT;

COMMENT ON COLUMN inspections.photos.original_path IS
  'Bucket path to the 4096px / q=0.92 original (court-grade evidence). '
  'storage_path remains the 800px / q=0.7 thumbnail (~100KB) for UI grids/lightbox preview. '
  'PDF render fetches original_path when present, falls back to storage_path. '
  'Set by mobile upload-worker dual-upload path.';

COMMENT ON COLUMN inspections.photos.original_size_bytes IS
  'Byte size of the original (4096px) variant. '
  'file_size_bytes continues to describe the 800px thumbnail.';
