-- ---------------------------------------------------------------------------
-- Migration 00024: Fix infinite recursion in user_organisations RLS policy
-- ---------------------------------------------------------------------------
-- Root cause: "Users can view memberships in their orgs" calls
-- get_user_org_ids() which queries user_organisations from within a policy
-- on user_organisations — Postgres detects the cycle regardless of
-- SECURITY DEFINER on the function.
--
-- Fix:
-- 1. Drop the recursive policy.
-- 2. Create a SECURITY DEFINER + SET row_security = off helper that reads
--    org IDs directly without triggering RLS, used by the admin policy.
-- 3. Keep the safe user_id = auth.uid() policy for self-lookup.
-- ---------------------------------------------------------------------------

-- Drop the recursive policy
DROP POLICY IF EXISTS "Users can view memberships in their orgs"
    ON public.user_organisations;

DROP POLICY IF EXISTS "Org admins can view all memberships"
    ON public.user_organisations;

-- Helper function that reads user_organisations with RLS disabled
-- (SECURITY DEFINER runs as postgres superuser which bypasses RLS;
--  SET LOCAL row_security = off makes it explicit)
CREATE OR REPLACE FUNCTION public.get_user_org_ids_bypass()
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    org_ids UUID[];
BEGIN
    SET LOCAL row_security = off;
    SELECT ARRAY_AGG(organisation_id)
    INTO org_ids
    FROM public.user_organisations
    WHERE user_id = auth.uid() AND is_active = TRUE;
    RETURN COALESCE(org_ids, '{}');
END;
$$;

-- Safe self-lookup policy (non-recursive)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'user_organisations'
          AND policyname = 'Users can see their own membership'
    ) THEN
        CREATE POLICY "Users can see their own membership"
            ON public.user_organisations FOR SELECT
            USING (user_id = auth.uid());
    END IF;
END $$;

-- Admin cross-org view using the bypass helper
CREATE POLICY "Org admins can view all memberships"
    ON public.user_organisations FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids_bypass()));
