-- apps/edge-functions/supabase/migrations/00164_powersync_jwt_project_access.sql
-- Description: Extend the PowerSync JWT hook with a `project_ids` claim so the
-- mobile app can sync projects a user reaches via an explicit cross-org
-- project_members assignment (mirrors public.user_has_project_access clause (a)).
--
-- Why in the hook, not the sync rules: PowerSync classic Sync Rules parameter
-- queries are single-table (no JOINs). Revocation for cross-org contractors runs
-- through project_members JOIN user_organisations ON is_active — removeSubOrgMember
-- flips user_organisations.is_active=false and leaves project_members.is_active
-- untouched. The JWT hook runs real Postgres and can do that join; the sync rule
-- then expands the resulting array via json_each(request.jwt() -> 'project_ids').
--
-- Additive + backward compatible: org_id is unchanged; tokens issued before this
-- migration simply lack project_ids, and json_each(null) yields no rows.
-- Deploy: run migration; the hook is already enabled (Dashboard > Auth > Hooks).

CREATE OR REPLACE FUNCTION public.custom_jwt_claims(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id      UUID;
  _org_id       UUID;
  _project_ids  JSONB;
  _claims       JSONB;
BEGIN
  _user_id := (event ->> 'user_id')::UUID;

  -- Unchanged: the user's first active organisation (drives the org_* buckets).
  SELECT organisation_id INTO _org_id
  FROM public.user_organisations
  WHERE user_id = _user_id
    AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1;

  -- NEW: projects reachable via an ACTIVE explicit membership whose identity org
  -- the user is still ACTIVE in. Exact mirror of public.user_has_project_access
  -- clause (a), including the user_organisations.is_active join the sync rule
  -- cannot express. Deliberately does NOT filter pm.is_active (00106 clause (a)
  -- doesn't), keeping mobile == web.
  SELECT COALESCE(jsonb_agg(DISTINCT pm.project_id), '[]'::jsonb)
  INTO   _project_ids
  FROM   projects.project_members pm
  JOIN   public.user_organisations uo
    ON   uo.user_id = pm.user_id
   AND   uo.organisation_id = pm.organisation_id
  WHERE  pm.user_id = _user_id
    AND  uo.is_active = TRUE;

  _claims := event -> 'claims';

  IF _org_id IS NOT NULL THEN
    _claims := jsonb_set(_claims, '{org_id}', to_jsonb(_org_id::TEXT));
  END IF;

  -- Always set (defaults to '[]') so the sync rule's json_each degrades cleanly.
  _claims := jsonb_set(_claims, '{project_ids}', _project_ids);

  RETURN jsonb_set(event, '{claims}', _claims);
END;
$$;

-- Allow Supabase Auth to call this function (unchanged from 00014).
GRANT EXECUTE ON FUNCTION public.custom_jwt_claims(JSONB) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_jwt_claims(JSONB) FROM PUBLIC;
