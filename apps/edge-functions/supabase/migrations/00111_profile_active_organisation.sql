-- 00111_profile_active_organisation.sql
--
-- Add public.profiles.active_organisation_id to track which org context the
-- user last switched into. Read by getOrgContext to resolve which org a
-- multi-org user is currently "in" (e.g., Arno in WM vs Bob's Building).
--
-- For single-org users this column stays NULL and getOrgContext falls back
-- to oldest active membership. The org switcher UI (Task 3) writes here via
-- setActiveOrganisation.
--
-- Idempotent. Reversible: ALTER TABLE public.profiles DROP COLUMN active_organisation_id.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_organisation_id UUID NULL
    REFERENCES public.organisations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.profiles.active_organisation_id IS
  'The org context this user currently has active (set by the OrgSwitcher). '
  'NULL means use the default resolution (oldest active user_organisations row). '
  'See migration 00111.';

CREATE INDEX IF NOT EXISTS idx_profiles_active_organisation
  ON public.profiles (active_organisation_id)
  WHERE active_organisation_id IS NOT NULL;
