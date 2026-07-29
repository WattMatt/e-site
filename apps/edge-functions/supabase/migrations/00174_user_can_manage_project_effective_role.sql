-- =============================================================================
-- 00174 — user_can_manage_project must honour per-project promotion,
--          unifying it with public.user_effective_project_role (00107)
-- =============================================================================
-- Problem (latent authorization regression)
--   Two authorities answered "can this user manage this project?" and they had
--   diverged:
--     • Web gate    — requireEffectiveRole → public.user_effective_project_role
--                     (00107): org owner/admin/PM win, ELSE the user's active
--                     projects.project_members.role applies (per-project
--                     promotion). This is what shows the upload UI and what the
--                     tenant-documents attach action (guardProjectAccess) checks.
--     • Storage RLS — public.user_can_manage_project (00085, is_active-fixed in
--                     00152): active org owner / admin / project_manager ONLY.
--                     No projects.project_members promotion path.
--
--   Since PR #117 the tenant drawing/scope upload writes DIRECTLY from the
--   browser session to storage (apps/web/src/lib/storage/tenant-documents-upload.ts),
--   and node-order-documents uploads (incl. shop drawings) likewise write with
--   the user session (apps/web/src/app/api/node-order-documents/route.ts). So the
--   storage.objects INSERT/DELETE policies on the tenant-documents and
--   node-order-documents buckets — both gated on user_can_manage_project — are
--   the live upload gate. A user promoted to a write role via project_members
--   (but NOT an active org owner/admin/PM) passes the web gate and sees the
--   upload UI, yet the direct .upload() is denied with "new row violates
--   row-level security policy", surfaced as red "Upload failed…" text. Before
--   PR #117 the bytes transited a service-role route (RLS bypassed), so it
--   worked — hence a regression. Dormant today (every current write-capable
--   project_members user is also an active org owner/admin/PM) but it bites the
--   first genuinely project-promoted contractor.
--
-- Fix
--   Redefine user_can_manage_project as a thin wrapper over the single source of
--   truth, user_effective_project_role, returning TRUE iff the effective role is
--   a write role (owner / admin / project_manager — the ORG_WRITE_ROLES set in
--   the app). The DB storage gate and the web gate become provably identical and
--   the divergence is removed at its root. Every policy referencing the helper
--   inherits the fix with NO policy changes — the same approach 00152 used:
--     • storage.objects "tenant-documents write" / "…​delete"      (00085)
--     • storage.objects "node-order-documents write" / "…​delete"  (00086)
--     • structure.node_order_documents  (INSERT/UPDATE/DELETE)     (00086)
--     • structure.node_order_shop_drawings (INSERT/UPDATE/DELETE)  (00115)
--     • structure.tenant_documents / tenant_document_revisions (ALL) (00118)
--     • gcr.report_revisions (INSERT/DELETE)                        (00127)
--
--   Behaviour is a strict superset of 00152 — it adds ONLY the
--   project-promoted-write case and over-grants nothing:
--     • active org owner/admin/PM                        → TRUE  (unchanged)
--     • deactivated membership, no project_members row   → FALSE (unchanged; 00152)
--     • org contractor, no project_members row           → FALSE (unchanged)
--     • org contractor, active project_members 'project_manager' → TRUE  (the fix)
--     • org contractor, active project_members 'client_viewer'/'contractor' → FALSE
--   (owner/admin never appear in project_members — its CHECK forbids them — so a
--   per-project row can only promote up to project_manager, never to owner/admin.)
--
--   Fail-closed: user_effective_project_role returns NULL for "no access", and
--   COALESCE(NULL IN (...), FALSE) = FALSE.
--
-- Regression test:
--   apps/edge-functions/supabase/tests/tenant_documents_project_member_upload_rls_test.sql
--   (pgTAP; run via `supabase test db`).
--
-- ⚠ Do NOT hand-apply. deploy-migrations.yml runs `supabase db push` on merge to
--   main; hand-applying via the Management API desyncs schema_migrations.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. Reversible by restoring the 00152 body.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.user_can_manage_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- Single source of truth: honour org owner/admin/PM AND per-project promotion
  -- via projects.project_members (see 00107). "Manage" = a write role
  -- (owner/admin/project_manager); narrower effective roles cannot manage.
  SELECT COALESCE(
    public.user_effective_project_role(p_project_id, auth.uid())
      IN ('owner', 'admin', 'project_manager'),
    FALSE
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_can_manage_project(uuid) TO authenticated;
