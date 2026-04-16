-- ---------------------------------------------------------------------------
-- Migration 00018: Add review_notes to compliance.coc_uploads
-- Fixes SPEC_FEEDBACK.md item — reviewed_at already exists, review_notes missing.
-- ---------------------------------------------------------------------------

ALTER TABLE compliance.coc_uploads
  ADD COLUMN IF NOT EXISTS review_notes TEXT;
