-- ---------------------------------------------------------------------------
-- Migration 00026: Fix remaining RLS recursion on user_organisations
-- ---------------------------------------------------------------------------
-- The "Org admins can view all memberships" policy introduced in 00024 still
-- triggers Postgres's structural recursion check, because any policy on table
-- T that calls a function querying T is rejected — regardless of SECURITY
-- DEFINER or row_security=off settings.
--
-- Fix: drop all current SELECT policies and replace with the only safe form:
--   user_id = auth.uid()   (no sub-query against user_organisations)
--
-- Server-side pages that need to list all org members must use the
-- service-role client (createAdminClient) which bypasses RLS entirely.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view memberships in their orgs" ON public.user_organisations;
DROP POLICY IF EXISTS "Org admins can view all memberships"      ON public.user_organisations;
DROP POLICY IF EXISTS "Users can see their own membership"       ON public.user_organisations;
DROP POLICY IF EXISTS "Admins can manage org memberships"        ON public.user_organisations;

-- Sole SELECT policy — non-recursive, safe
CREATE POLICY "Users can see their own membership"
    ON public.user_organisations FOR SELECT
    USING (user_id = auth.uid());

-- INSERT: any authenticated user can create their own membership row
-- (org invite flow validates externally; service role used for admin inserts)
CREATE POLICY "Users can insert own membership"
    ON public.user_organisations FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- UPDATE: users can update their own membership row only
CREATE POLICY "Users can update own membership"
    ON public.user_organisations FOR UPDATE
    USING (user_id = auth.uid());
