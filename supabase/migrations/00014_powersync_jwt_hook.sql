-- supabase/migrations/00014_powersync_jwt_hook.sql
-- Description: Custom JWT hook — injects org_id claim for PowerSync bucket partitioning.
-- Deploy: run migration, then enable hook in Supabase Dashboard > Auth > Hooks.

CREATE OR REPLACE FUNCTION public.custom_jwt_claims(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id  UUID;
  _org_id   UUID;
  _claims   JSONB;
BEGIN
  _user_id := (event ->> 'user_id')::UUID;

  -- Get the user's first active organisation
  SELECT organisation_id INTO _org_id
  FROM user_organisations
  WHERE user_id = _user_id
    AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1;

  _claims := event -> 'claims';

  IF _org_id IS NOT NULL THEN
    _claims := jsonb_set(_claims, '{org_id}', to_jsonb(_org_id::TEXT));
  END IF;

  RETURN jsonb_set(event, '{claims}', _claims);
END;
$$;

-- Allow Supabase Auth to call this function
GRANT EXECUTE ON FUNCTION public.custom_jwt_claims(JSONB) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_jwt_claims(JSONB) FROM PUBLIC;
