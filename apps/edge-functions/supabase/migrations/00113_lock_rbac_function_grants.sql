-- 00113_lock_rbac_function_grants.sql
--
-- The four SECURITY DEFINER RBAC helper functions (introduced in 00027, 00034,
-- 00106, 00107) were created without explicit grants, so Postgres applied the
-- default PUBLIC + anon EXECUTE grants. user_effective_project_role takes a
-- user_id parameter and lets anyone enumerate arbitrary users' roles on any
-- project — confirmed via routine_privileges audit on prod 2026-05-29.
--
-- Lock all four to authenticated + service_role only. The web layer calls
-- them via authenticated PostgREST; nothing else legitimately needs them.
--
-- Idempotent — REVOKE on a non-existent grant is a no-op.

REVOKE EXECUTE ON FUNCTION public.user_effective_project_role(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_effective_project_role(uuid, uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.user_has_project_access(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_has_project_access(uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.user_is_client_viewer(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_is_client_viewer(uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_user_org_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_org_ids() FROM anon;
