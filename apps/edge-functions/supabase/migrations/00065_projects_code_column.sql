-- 00064a_projects_code_column.sql
-- Adds projects.projects.code (TEXT, NOT NULL after backfill, UNIQUE per org).
-- Required by inspections module's allocate_coc_number() function (INS/FAT prefixes).

BEGIN;

-- 1. Add the column (nullable for backfill)
ALTER TABLE projects.projects
  ADD COLUMN IF NOT EXISTS code TEXT NULL;

-- 2. Backfill helper: 3-letter consonants-preferred slug
CREATE OR REPLACE FUNCTION projects.suggest_code(_name TEXT) RETURNS TEXT
  LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  letters TEXT;
  consonants TEXT;
BEGIN
  letters := UPPER(REGEXP_REPLACE(COALESCE(_name, ''), '[^A-Za-z]', '', 'g'));
  IF letters = '' THEN RETURN 'PRJ'; END IF;
  consonants := REGEXP_REPLACE(letters, '[AEIOU]', '', 'g');
  IF length(consonants) >= 3 THEN
    RETURN substr(consonants, 1, 3);
  ELSIF length(letters) >= 3 THEN
    RETURN substr(letters, 1, 3);
  ELSE
    RETURN rpad(letters, 3, 'X');
  END IF;
END $$;

-- 3. Backfill with collision handling within each organisation
DO $$
DECLARE
  proj RECORD;
  base_code TEXT;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR proj IN
    SELECT id, organisation_id, name FROM projects.projects WHERE code IS NULL ORDER BY created_at
  LOOP
    base_code := projects.suggest_code(proj.name);
    candidate := base_code;
    suffix := 2;
    WHILE EXISTS (
      SELECT 1 FROM projects.projects
      WHERE organisation_id = proj.organisation_id AND code = candidate
    ) LOOP
      candidate := base_code || suffix::text;
      suffix := suffix + 1;
    END LOOP;
    UPDATE projects.projects SET code = candidate WHERE id = proj.id;
  END LOOP;
END $$;

-- 4. Enforce NOT NULL + format + per-org uniqueness
ALTER TABLE projects.projects
  ALTER COLUMN code SET NOT NULL,
  ADD CONSTRAINT projects_code_format CHECK (code ~ '^[A-Z][A-Z0-9]{1,11}$');

CREATE UNIQUE INDEX IF NOT EXISTS projects_code_org_unique
  ON projects.projects (organisation_id, code);

-- 5. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
