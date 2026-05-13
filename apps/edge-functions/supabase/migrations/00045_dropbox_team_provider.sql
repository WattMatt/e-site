-- =============================================================================
-- Migration: 00045_dropbox_team_provider.sql
-- Description: Architecture B (team-scoped Dropbox app). Adds 'dropbox_team'
--              as a new provider name alongside the existing per-user
--              'dropbox', and adds team-metadata columns that are populated
--              only for team-installed rows.
--
--              Why a separate provider name rather than an install_mode
--              column: it lets the existing Architecture A flow keep working
--              untouched (per-user OAuth) while team installs go through a
--              fresh code path. The DropboxProvider and DropboxTeamProvider
--              classes are independent. Cleanup of the user-scoped flow is
--              a separate later commit once team install is verified live.
--
--              org_storage_connections.provider now accepts:
--                'dropbox'        -- legacy, per-user (Architecture A)
--                'dropbox_team'   -- admin-installed for the whole org
--                'google_drive'   -- unchanged
--                'onedrive'       -- unchanged
--
--              Existing rows are unaffected. New columns default NULL so any
--              user-scoped row inserted before this migration stays valid.
-- =============================================================================

BEGIN;

-- 1. Extend the provider CHECK to allow the new name.
ALTER TABLE public.org_storage_connections
  DROP CONSTRAINT IF EXISTS org_storage_connections_provider_check;
ALTER TABLE public.org_storage_connections
  ADD CONSTRAINT org_storage_connections_provider_check
    CHECK (provider IN ('dropbox', 'google_drive', 'onedrive', 'dropbox_team'));

-- 2. Add team-metadata columns. NULLable — only populated for dropbox_team rows.
--    team_id        : Dropbox team identifier (format "dbtid:...")
--    team_name      : human-readable team name (e.g. "WATSON MATTHEUS"), shown
--                     to org members on /settings/integrations
--    team_member_id : the installing admin's team_member_id ("dbmid:..."),
--                     used as the Dropbox-API-Select-User header on every
--                     /files/* call so the team-token "acts as" that admin
--                     when listing/downloading. Without it, team apps default
--                     to acting in admin context which can hit different
--                     authorisation paths (per Dropbox docs).
ALTER TABLE public.org_storage_connections
  ADD COLUMN IF NOT EXISTS team_id        TEXT,
  ADD COLUMN IF NOT EXISTS team_name      TEXT,
  ADD COLUMN IF NOT EXISTS team_member_id TEXT;

COMMENT ON COLUMN public.org_storage_connections.team_id IS
  'Dropbox team ID (dbtid:...) for provider=dropbox_team rows. NULL otherwise.';
COMMENT ON COLUMN public.org_storage_connections.team_name IS
  'Display label for the team (e.g. "WATSON MATTHEUS") for dropbox_team rows.';
COMMENT ON COLUMN public.org_storage_connections.team_member_id IS
  'Dropbox member ID (dbmid:...) of the installing admin. Sent as Dropbox-API-Select-User header on team-app /files/* calls.';

NOTIFY pgrst, 'reload schema';

COMMIT;
