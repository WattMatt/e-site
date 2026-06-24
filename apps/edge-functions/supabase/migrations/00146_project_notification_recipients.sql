-- ---------------------------------------------------------------------------
-- 00146_project_notification_recipients.sql
--
-- Single source of truth for "who should be notified about activity on a
-- project" — i.e. everyone with access to the site, resolved LIVE at call time
-- (no snapshot). Reuses the EXACT access predicates from
-- 00106_relax_user_has_project_access so notify-logic can never drift from
-- access-logic:
--   (A) active explicit projects.project_members (active org membership), AND
--   (B) implicit org-level owner / admin / project_manager for the project's org.
--
-- Returns one row per distinct user with a profile, optionally excluding the
-- actor. The web layer dedupes by lowercased email + filters invalid addresses.
--
-- SECURITY DEFINER + row_security off so it reads project_members /
-- user_organisations / projects / profiles without recursive RLS (same pattern
-- as 00106/00107). search_path locked to 'public'.
--
-- Reversible: DROP FUNCTION public.project_notification_recipients(uuid, uuid).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.project_notification_recipients(
  p_project_id   UUID,
  p_exclude_user UUID DEFAULT NULL
)
RETURNS TABLE (user_id UUID, email TEXT, full_name TEXT)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  WITH ids AS (
    -- (A) explicit active project members (with active org membership)
    SELECT pm.user_id
    FROM projects.project_members pm
    JOIN public.user_organisations uo
      ON uo.user_id = pm.user_id
     AND uo.organisation_id = pm.organisation_id
    WHERE pm.project_id = p_project_id
      AND pm.is_active = TRUE
      AND uo.is_active = TRUE
    UNION
    -- (B) implicit org-level owner / admin / project_manager
    SELECT uo.user_id
    FROM projects.projects p
    JOIN public.user_organisations uo
      ON uo.organisation_id = p.organisation_id
    WHERE p.id = p_project_id
      AND uo.is_active = TRUE
      AND uo.role IN ('owner', 'admin', 'project_manager')
  )
  SELECT pr.id, pr.email, pr.full_name
  FROM ids
  JOIN public.profiles pr ON pr.id = ids.user_id
  WHERE p_exclude_user IS NULL OR ids.user_id <> p_exclude_user
$function$;

COMMENT ON FUNCTION public.project_notification_recipients(uuid, uuid) IS
  'Live recipient list for project notifications: active explicit project_members UNION implicit org owners/admins/PMs (matches user_has_project_access). Excludes p_exclude_user. SECURITY DEFINER, row_security off.';

GRANT EXECUTE ON FUNCTION public.project_notification_recipients(uuid, uuid) TO authenticated, service_role;
