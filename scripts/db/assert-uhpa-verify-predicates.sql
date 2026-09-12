-- assert-uhpa-verify-predicates.sql — the 00197 @verify block, evaluated
-- inside the dry-run transaction so the post-push verifier's predicates are
-- seen green (and, against a no-op migration, seen RED) before the migration
-- is ever applied. Pure catalogue reads; no impersonation.

SELECT * FROM (VALUES
  ('prosrc carries pm.is_active',
     (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.user_has_project_access(uuid)'::regprocedure)
       LIKE '%pm.is_active%'),
  ('prosrc does not invert it (no "NOT pm.is_active")',
     NOT ((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.user_has_project_access(uuid)'::regprocedure)
       ~* 'NOT\s+pm\.is_active')),
  ('prosrc still carries uo.is_active (org flag)',
     (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.user_has_project_access(uuid)'::regprocedure)
       LIKE '%uo.is_active%'),
  ('SECURITY DEFINER + STABLE + row_security=off + search_path=public retained',
     (SELECT p.prosecdef AND p.provolatile = 's'
             AND 'row_security=off' = ANY (p.proconfig)
             AND 'search_path=public' = ANY (p.proconfig)
        FROM pg_proc p WHERE p.oid = 'public.user_has_project_access(uuid)'::regprocedure)),
  ('owner still postgres',
     (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p
       WHERE p.oid = 'public.user_has_project_access(uuid)'::regprocedure) = 'postgres'),
  ('anon cannot EXECUTE (00186 sweep holds through CREATE OR REPLACE)',
     NOT has_function_privilege('anon', 'public.user_has_project_access(uuid)'::regprocedure, 'EXECUTE')),
  ('authenticated can EXECUTE',
     has_function_privilege('authenticated', 'public.user_has_project_access(uuid)'::regprocedure, 'EXECUTE')),
  ('service_role can EXECUTE',
     has_function_privilege('service_role', 'public.user_has_project_access(uuid)'::regprocedure, 'EXECUTE')),
  ('fails closed with no session (auth.uid() NULL -> FALSE, never NULL)',
     public.user_has_project_access('00000000-0000-0000-0000-000000000000'::uuid) IS FALSE)
) AS t("check", ok);
