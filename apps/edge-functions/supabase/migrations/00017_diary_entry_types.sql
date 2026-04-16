-- ---------------------------------------------------------------------------
-- Migration 00017: Enrich site_diary_entries with entry_type and typed notes
-- Sprint 2, T-033
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'diary_entry_type') THEN
    CREATE TYPE public.diary_entry_type AS ENUM (
      'progress', 'safety', 'quality', 'delay', 'weather', 'workforce', 'general'
    );
  END IF;
END $$;

ALTER TABLE projects.site_diary_entries
  ADD COLUMN IF NOT EXISTS entry_type  public.diary_entry_type NOT NULL DEFAULT 'progress',
  ADD COLUMN IF NOT EXISTS safety_notes TEXT,
  ADD COLUMN IF NOT EXISTS quality_notes TEXT,
  ADD COLUMN IF NOT EXISTS delay_notes TEXT;

-- Index for type-filtered queries
CREATE INDEX IF NOT EXISTS idx_diary_entries_org_date
  ON projects.site_diary_entries (organisation_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_diary_entries_org_type
  ON projects.site_diary_entries (organisation_id, entry_type);
