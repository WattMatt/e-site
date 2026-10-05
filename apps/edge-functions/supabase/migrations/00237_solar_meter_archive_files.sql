-- ---------------------------------------------------------------------------
-- Migration 00237: org meter-archive files need no project
-- ---------------------------------------------------------------------------
-- Number claimed at MERGE time: re-check the ledger, origin/main and every open
-- PR's migration filenames immediately before merging.
--
-- WHY (owner, 2026-10-05): the 40-site meter archive (006. METER CSV) is loaded
-- into the Solar ORG meter library, and its sites "cannot be and aren't new or
-- additional projects". solar.meter_files.project_id was NOT NULL, so the first
-- load had to create one planning project per site. This lets an archive file
-- belong to the organisation's library alone (project_id NULL; raw bytes at
-- <org>/archive/<sha256>.<ext>), so those projects can be retired.
--
-- WHAT
--   * meter_files.project_id DROP NOT NULL (the FK and its ON DELETE CASCADE stay
--     for project files).
--   * Signed-in users still cannot create a project-less file: the RESTRICTIVE
--     meter_files_insert_authz needs solar_can_edit(project_id), false for NULL.
--   * solar.meter_files_bind (00211) is replaced with the same rules for every
--     signed-in user (project, hash, size and path immutable; org from the project)
--     plus two service-role-only paths (auth.uid() IS NULL — the archive import):
--       INSERT with project_id NULL at <org>/archive/<sha256>.<ext>;
--       UPDATE moving a project file into the archive (project -> NULL and the path
--       -> the archive form, nothing else).
--
-- RULES: no transaction control here: the runner wraps the file.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- sql: (SELECT is_nullable = 'YES' FROM information_schema.columns WHERE table_schema = 'solar' AND table_name = 'meter_files' AND column_name = 'project_id')
-- function: solar.meter_files_bind()
-- sql: (SELECT strpos(pg_get_functiondef('solar.meter_files_bind'::regproc), '/archive/') > 0)
-- behaviour: scripts/db/assert-solar-meter-archive-files.sql, every row ok
-- @verify:end

ALTER TABLE solar.meter_files ALTER COLUMN project_id DROP NOT NULL;

COMMENT ON COLUMN solar.meter_files.project_id IS
'The project the file was imported for. NULL: an org meter-archive file (owner decision 2026-10-05), stored at <org>/archive/<sha256>.<ext>.';

CREATE OR REPLACE FUNCTION solar.meter_files_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_service BOOLEAN := auth.uid() IS NULL;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF v_service AND OLD.project_id IS NOT NULL AND NEW.project_id IS NULL THEN
            -- The archive import retiring a project: the file moves to the org archive and nothing else changes.
            IF NEW.storage_path <> (OLD.organisation_id::text || '/archive/' || OLD.sha256 || substring(OLD.storage_path FROM '\.[a-z]+$'))
               OR NEW.sha256 <> OLD.sha256 OR NEW.organisation_id <> OLD.organisation_id OR NEW.size_bytes <> OLD.size_bytes THEN
                RAISE EXCEPTION 'solar.meter_files: moving a file to the archive changes only its project and path' USING ERRCODE = '42501';
            END IF;
        ELSIF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.sha256 <> OLD.sha256 OR NEW.storage_path <> OLD.storage_path
           OR NEW.organisation_id <> OLD.organisation_id OR NEW.size_bytes <> OLD.size_bytes THEN
            RAISE EXCEPTION 'solar.meter_files: project, hash, size and path are immutable' USING ERRCODE = '42501';
        END IF;
        NEW.uploaded_by := OLD.uploaded_by;
        NEW.created_at := OLD.created_at;
    ELSIF NEW.project_id IS NULL THEN
        -- An org meter-archive file: the service role only, org as given (and real), archive path.
        IF NOT v_service THEN
            RAISE EXCEPTION 'solar.meter_files: a file needs a project' USING ERRCODE = '42501';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = NEW.organisation_id) THEN
            RAISE EXCEPTION 'solar.meter_files: organisation % not found', NEW.organisation_id USING ERRCODE = '23503';
        END IF;
        IF NEW.storage_path !~ ('^' || NEW.organisation_id::text || '/archive/' || NEW.sha256 || '\.(csv|txt|xlsx|xls)$') THEN
            RAISE EXCEPTION 'solar.meter_files: an archive file''s storage_path must be <org>/archive/<sha256>.<ext>' USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT organisation_id INTO NEW.organisation_id FROM projects.projects WHERE id = NEW.project_id;
        IF NEW.organisation_id IS NULL THEN
            RAISE EXCEPTION 'solar.meter_files: project % not found', NEW.project_id USING ERRCODE = '23503';
        END IF;
        IF NEW.storage_path !~ ('^' || NEW.organisation_id::text || '/' || NEW.project_id::text || '/' || NEW.sha256 || '\.(csv|txt|xlsx|xls)$') THEN
            RAISE EXCEPTION 'solar.meter_files: storage_path must be <org>/<project>/<sha256>.<ext>' USING ERRCODE = '23514';
        END IF;
        IF NOT v_service THEN
            NEW.uploaded_by := auth.uid();
            NEW.created_at := NOW();
        END IF;
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
