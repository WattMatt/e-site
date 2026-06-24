-- ---------------------------------------------------------------------------
-- 00147_project_settings_snag_diary_email.sql
-- Per-module email toggles for snag + site-diary notifications, mirroring
-- notify_rfi_email (00101). Default true — like RFI, snags and diary email the
-- full project roster; a project can opt out per module via Integrations.
-- Reversible: DROP COLUMN notify_snag_email, notify_diary_email.
-- ---------------------------------------------------------------------------
ALTER TABLE projects.project_settings
  ADD COLUMN IF NOT EXISTS notify_snag_email  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_diary_email boolean NOT NULL DEFAULT true;
