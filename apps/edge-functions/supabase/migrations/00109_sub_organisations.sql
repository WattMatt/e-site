-- 00109_sub_organisations.sql
--
-- Promote sub-organisations to first-class rows in public.organisations.
-- A "sub-org" is just a `public.organisations` row marked as a shadow whose
-- contact details and people roster are managed by a parent org (e.g., WM
-- Consulting). When/if the sub-org's owner signs up, the shadow flag clears
-- and they take over.
--
-- This migration:
--   1. Adds is_shadow + parent_organisation_id + contact-detail columns to
--      public.organisations (idempotent ADD COLUMN IF NOT EXISTS).
--   2. Grants owner/admin/PM of parent_organisation_id SELECT + UPDATE + INSERT
--      on their shadow children via 3 new RLS policies.
--
-- The deprecation of `projects.contractor_companies` + the
-- `user_organisations.contractor_company_id` column is split into a SEPARATE
-- migration (00110_drop_contractor_companies.sql), applied only after the web
-- code stops referencing them. This keeps prod in a working state during the
-- PR-A rollout.
--
-- Reversible: ALTER TABLE public.organisations DROP COLUMN <each>; DROP POLICY
-- ... ; DROP INDEX idx_organisations_parent_shadow.

-- 1. New columns on public.organisations
ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS is_shadow              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS parent_organisation_id UUID NULL REFERENCES public.organisations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS address                TEXT NULL,
  ADD COLUMN IF NOT EXISTS phone                  TEXT NULL,
  ADD COLUMN IF NOT EXISTS registration_number    TEXT NULL,
  ADD COLUMN IF NOT EXISTS vat_number             TEXT NULL,
  ADD COLUMN IF NOT EXISTS signatory_name         TEXT NULL,
  ADD COLUMN IF NOT EXISTS signatory_title        TEXT NULL;

COMMENT ON COLUMN public.organisations.is_shadow IS
  'TRUE while this org was created by another org as a contracting party and '
  'has not yet been claimed by its own owner. Shadow orgs are managed by '
  'parent_organisation_id''s owner/admin/PM. See migration 00109.';
COMMENT ON COLUMN public.organisations.parent_organisation_id IS
  'For shadow orgs, the creating org. NULL once claimed (or for non-shadow orgs).';

CREATE INDEX IF NOT EXISTS idx_organisations_parent_shadow
  ON public.organisations (parent_organisation_id, is_shadow)
  WHERE is_shadow = TRUE;

-- 2. RLS: parent-managed shadow orgs
-- Existing policy on public.organisations (per current schema) gates by
-- user_organisations membership. We add a parallel policy that lets owners
-- of the parent org SELECT and UPDATE shadow children.

DROP POLICY IF EXISTS "Parent admins can view shadow children" ON public.organisations;
CREATE POLICY "Parent admins can view shadow children"
  ON public.organisations FOR SELECT
  USING (
    is_shadow = TRUE
    AND parent_organisation_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_organisations uo
      WHERE uo.user_id = auth.uid()
        AND uo.organisation_id = public.organisations.parent_organisation_id
        AND uo.is_active = TRUE
        AND uo.role IN ('owner', 'admin', 'project_manager')
    )
  );

DROP POLICY IF EXISTS "Parent admins can update shadow children" ON public.organisations;
CREATE POLICY "Parent admins can update shadow children"
  ON public.organisations FOR UPDATE
  USING (
    is_shadow = TRUE
    AND parent_organisation_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_organisations uo
      WHERE uo.user_id = auth.uid()
        AND uo.organisation_id = public.organisations.parent_organisation_id
        AND uo.is_active = TRUE
        AND uo.role IN ('owner', 'admin', 'project_manager')
    )
  );

DROP POLICY IF EXISTS "Parent admins can insert shadow children" ON public.organisations;
CREATE POLICY "Parent admins can insert shadow children"
  ON public.organisations FOR INSERT
  WITH CHECK (
    is_shadow = TRUE
    AND parent_organisation_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_organisations uo
      WHERE uo.user_id = auth.uid()
        -- Unqualified `parent_organisation_id` here resolves to the NEW row's
        -- value (correct for INSERT WITH CHECK). SELECT/UPDATE policies use
        -- the table-qualified form because they operate on existing rows.
        AND uo.organisation_id = parent_organisation_id
        AND uo.is_active = TRUE
        AND uo.role IN ('owner', 'admin', 'project_manager')
    )
  );
