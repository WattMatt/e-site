-- 00114_project_members_delete_policy.sql
--
-- Add the missing DELETE RLS policy on projects.project_members.
--
-- The table shipped with INSERT / SELECT / UPDATE policies but no DELETE policy.
-- With RLS enabled, a DELETE through the authenticated (cookie) client therefore
-- matched zero rows and returned no error — so removeProjectMember() reported
-- success while deleting nothing, and the Members "Remove" button silently did
-- nothing, for every member.
--
-- Mirror the UPDATE policy exactly: any active org member may DELETE rows in
-- their org at the RLS layer; the real authorisation gate is in app code
-- (removeProjectMember → requireRole(ORG_WRITE_ROLES)).
--
-- Idempotent (DROP IF EXISTS) so re-running via `supabase db push` is safe — this
-- policy was first applied to prod directly via the management API because the
-- deploy-migrations workflow is manual and its secrets are currently unbound.

drop policy if exists "Org members can delete project members"
  on projects.project_members;

create policy "Org members can delete project members"
  on projects.project_members
  for delete
  using (organisation_id = any (public.get_user_org_ids()));
