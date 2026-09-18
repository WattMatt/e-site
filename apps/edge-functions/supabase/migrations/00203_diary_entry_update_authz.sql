-- ---------------------------------------------------------------------------
-- Migration 00203: projects.site_diary_entries — a write-authority gate on
--                  UPDATE, and a binding between the row's organisation and
--                  its project (the 00193 pattern, one table)
-- ---------------------------------------------------------------------------
-- WHY.
--
-- 00145 re-issued the diary UPDATE policy to exclude `client_viewer`, which it
-- does. What it did not do — and what 00149 (author-only DELETE) and 00161
-- (attachments) did not narrow afterwards — is make it an AUTHORISATION test:
--
--     USING (organisation_id = ANY(public.get_user_org_ids())
--            AND NOT public.user_is_client_viewer(organisation_id)
--            AND NOT EXISTS (… p.status = 'payment_paused'))
--
-- That is ORG membership. It names neither the project nor the author, it
-- carries no WITH CHECK of its own (so Postgres reuses the USING expression,
-- which constrains the NEW row no further), and it restricts no column. So
-- ANY active non-client-viewer member of an organisation may rewrite EVERY
-- column of EVERY diary entry in that organisation — including entries on
-- projects they have never been a member of.
--
-- DEMONSTRATED ON PRODUCTION, 2026-09-15, inside rolled-back transactions, as
-- the `rbac-test` fixture (018f2d31-bbe8-4cc1-bbdd-63af0187081e — org role
-- `contractor` on WM-Consulting, project member of (643) KINGSWALK and of
-- nothing else), impersonating exactly as PostgREST does (`SET LOCAL ROLE
-- authenticated` + a `request.jwt.claims` sub). Against (657) MAMAILA PHASE 2,
-- a project on which `public.user_effective_project_role()` returns NULL for
-- them:
--
--   site_diary_entries UPDATE  project_id -> (650) WATERMEYER        1 row
--   site_diary_entries UPDATE  project_id -> a project in ANOTHER
--                              organisation, organisation_id left
--                              on WM-Consulting                      1 row
--   site_diary_entries UPDATE  progress_notes / safety_notes ->
--                              'PWNED', delays -> 'None',
--                              workers_on_site -> 0,
--                              entry_date -> 2000-01-01              1 row
--   site_diary_entries UPDATE  created_by -> self                    1 row
--   site_diary_entries DELETE  the same entry, as its new "author"   1 row
--
-- The last two are one chain and they are the sharp end. 00149 deliberately
-- scoped DELETE to `created_by = auth.uid()` so a contractor could not delete
-- a colleague's entry over PostgREST — "a *broad* org-scoped DELETE policy
-- would WEAKEN this". With an unrestricted UPDATE beside it, that gate costs
-- one extra statement: claim the entry, then delete it as its author. The
-- author-only DELETE policy has been bypassable since the day it shipped.
--
-- Production was unchanged: all 57 entries across 4 projects read back
-- identical afterwards, and every probe file runs in its own transaction that
-- is rolled back whether it passes or fails.
--
-- NOTHING LEGITIMATE DEPENDS ON THE WIDTH.
--
-- No path in the monorepo UPDATEs a diary entry. Web `diary.actions.ts` has
-- create / notify / delete / deleteAttachment; the shared `diary.service.ts`
-- has create / list / listByOrg / getWeeklySummary / listAttachments /
-- getEntryForGate / hardDelete / deleteAttachment; `api/diary/notify`,
-- `lib/diary-email.ts` and `lib/portal/data.ts` only SELECT; the mobile app
-- lists, creates and writes attachments, and its PowerSync connector's
-- `uploadData` is a no-op (`apps/mobile/src/lib/powersync/connector.ts:33`),
-- so the sync path never writes either. The entire UPDATE surface is direct
-- PostgREST, on which `authenticated` holds the UPDATE grant (`anon` does
-- not). Item 3 reaches the same conclusion independently in its D.5 header.
--
-- IT GETS WORSE WHEN THE WORK-ITEM MIRROR LANDS. Item 3's
-- `site_diary_entries_mirror_work_item_upd` fires AFTER UPDATE OF delays,
-- delay_notes, entry_date, project_id, organisation_id, and runs in the
-- source writer's session through the trigger path that is exempt from the
-- work-item guard. The same statement that today only corrupts a diary row
-- will then also void, move or re-title that entry's work item on the spine.
-- Closing the source gate first is the cheaper order.
--
-- THE RULE THIS INSTALLS.
--
--   may UPDATE a diary entry  :=  holds owner / admin / project_manager on the
--                                 entry's project (public.user_effective_
--                                 project_role, so an org-level admin wins
--                                 everywhere and a per-project promotion is
--                                 honoured)
--                             OR  authored it AND still holds SOME effective
--                                 role on its project
--
-- The author arm is not a courtesy. Of the 57 diary entries on production,
-- 43 were authored by someone holding NO write role on the project (measured
-- 2026-09-15: 4 of the 6 authors are `contractor`s). A gate of ORG_WRITE_ROLES
-- alone would take their own contemporaneous record away from three quarters
-- of the people who wrote one, which is not a security improvement — it is a
-- different bug. The `AND still holds some effective role` half is what stops
-- the author arm from becoming a second org-wide hole: measured on the same
-- day, the author of all 57 entries is an active project member with a
-- non-NULL effective role, so it costs nothing today and it is what makes
-- `project_id` un-relocatable onto a project the caller is not on.
--
-- WHY A RESTRICTIVE OVERLAY AND NOT A REWRITE OF 00145's POLICY.
--
-- 00145's policy is left EXACTLY as it is and becomes the membership floor;
-- the new RESTRICTIVE policy is the authority gate, ANDed with it. Three
-- reasons, in order of weight:
--
--   1. The `payment_paused` freeze and the `client_viewer` exclusion keep
--     provably identical semantics, because the expression that carries them
--     is not retyped. Production currently holds ZERO `payment_paused`
--     projects, so a slip in re-stating that arm would not have shown up in
--     any probe — the one place where "unchanged" has to be a property of the
--     diff rather than of a test.
--   2. A future PERMISSIVE UPDATE policy copied onto this table cannot reopen
--     the gate. That is not hypothetical here: the table already carries TWO
--     permissive SELECT policies, the second of them cross-org
--     ("Project members can view diary entries (cross-org)", on
--     `user_has_project_access`), so a cross-org UPDATE sibling is exactly the
--     shape the next change takes.
--   3. It is the established house pattern — 00171, 00177, 00187, 00192,
--     00193 — and 00193 states the same reasoning at length.
--
-- Both layers are therefore in force, and the @verify block asserts the
-- permissive one is still permissive, still UPDATE, still WITH-CHECK-less and
-- still carrying both of its guards.
--
-- THE ORG BINDING.
--
-- `organisation_id` is not immutable and cannot be made so in a policy (RLS
-- sees only the NEW row), but it can be bound: the WITH CHECK requires it to
-- equal the organisation of the project the NEW row names. 00196 does the same
-- for `work_items` with the same bare subquery, and for the same reason it is
-- safe to read `projects.projects` as the caller here: a caller who cannot see
-- the destination project gets NULL, `organisation_id = NULL` is NULL, and a
-- RESTRICTIVE WITH CHECK that is NULL denies. It fails closed.
--
-- Verified first that the binding changes nothing for any row that exists: 0
-- of 57 entries have an `organisation_id` differing from their project's
-- (measured 2026-09-15). ⚠ Treat that as evidence nothing breaks, not as
-- evidence the column was ever trustworthy — production holds exactly one
-- organisation with diary entries.
--
-- NAMED RESIDUALS. Each is asserted in scripts/db/assert-diary-update-*.sql so
-- it is a recorded decision rather than something a later reader discovers.
--
--   * A write-role holder may still relocate an entry between projects OF THE
--     SAME ORGANISATION, and may still re-attribute `created_by`. "unchanged"
--     is not expressible in RLS — there is no OLD row in a WITH CHECK — so
--     pinning either one means a BEFORE UPDATE trigger. That is a bigger
--     change than this one: it would freeze the service-role path too (which
--     bypasses RLS and so is untouched here) and it would make item 3's
--     deliberate `move` arm unreachable. Both are owner/admin/PM-only moves,
--     and all three of those roles can already delete the entry outright
--     through `deleteDiaryEntryAction`. Left for their own change.
--   * INSERT IS NOT TOUCHED, and carries the same decoupling: 00145's INSERT
--     policy checks `organisation_id = ANY(get_user_org_ids())` and says
--     nothing about `project_id`, so an org member can create a diary entry
--     ON A PROJECT IN ANOTHER ORGANISATION by stamping their own org id.
--     Binding it is one identical line — but the INSERT path is the one the
--     product actually uses (`diaryService.create`), and whether a contractor
--     seconded from another firm may write in your diary is a product
--     decision, not a backstop. Recorded in docs/rbac-matrix.md and spun off.
--   * The author arm reads `public.user_effective_project_role` (00107), which
--     DOES check `projects.project_members.is_active`. It deliberately does
--     not read `public.user_has_project_access` (00106), which does not —
--     the leak open PR #185 / migration 00197 closes. This migration neither
--     depends on nor is blocked by that one.
--
-- SELECT, INSERT AND DELETE ARE UNTOUCHED. The new policy is scoped to UPDATE.
-- A RESTRICTIVE `FOR ALL` would also restrict SELECT and would cut off both
-- the project-scoped `client_viewer` read that 00034 allows and the cross-org
-- read that `user_has_project_access` allows.
--
-- `TO authenticated, anon` matches 00177 / 00192 / 00193. `anon` holds no
-- UPDATE grant on this table (re-verified 2026-09-15: false), so naming it is
-- belt-and-braces; it deliberately does NOT name `postgres` or `service_role`,
-- both of which carry rolbypassrls and whose migration and service-client
-- writes must stay unaffected.
--
-- Reversible:
--   DROP POLICY diary_entries_update_authz ON projects.site_diary_entries;
--   DROP FUNCTION projects.user_can_edit_diary_entry(UUID, UUID);
--
-- No new schema and no new table, so a NOTIFY is enough; no Management-API
-- PostgREST db_schema PATCH is required.
--
-- @verify:begin
-- function: projects.user_can_edit_diary_entry(uuid,uuid)
-- policy: diary_entries_update_authz ON projects.site_diary_entries  -- RESTRICTIVE
-- grant_present: authenticated EXECUTE ON projects.user_can_edit_diary_entry(uuid,uuid)
-- grant_present: service_role EXECUTE ON projects.user_can_edit_diary_entry(uuid,uuid)
-- grant_absent: anon EXECUTE ON projects.user_can_edit_diary_entry(uuid,uuid)
--   (via has_function_privilege('anon', oid, 'EXECUTE') = false, never by
--    reading proacl — a NULL proacl looks empty but IS the PUBLIC grant)
-- sql: SELECT cmd = 'UPDATE' AND permissive = 'RESTRICTIVE' AND roles @> ARRAY['authenticated','anon']::name[] FROM pg_policies WHERE schemaname = 'projects' AND tablename = 'site_diary_entries' AND policyname = 'diary_entries_update_authz'
-- sql: SELECT qual LIKE '%user_can_edit_diary_entry%' AND with_check LIKE '%user_can_edit_diary_entry%' AND with_check LIKE '%organisation_id%' AND with_check LIKE '%projects.projects%' FROM pg_policies WHERE schemaname = 'projects' AND tablename = 'site_diary_entries' AND policyname = 'diary_entries_update_authz'
-- sql: SELECT permissive = 'PERMISSIVE' AND cmd = 'UPDATE' AND with_check IS NULL AND qual LIKE '%get_user_org_ids%' AND qual LIKE '%user_is_client_viewer%' AND qual LIKE '%payment_paused%' FROM pg_policies WHERE schemaname = 'projects' AND tablename = 'site_diary_entries' AND policyname = 'Org members can update diary entries'
-- sql: SELECT count(*) = 1 FROM pg_policies WHERE schemaname = 'projects' AND tablename = 'site_diary_entries' AND cmd = 'UPDATE' AND permissive = 'PERMISSIVE'
-- sql: SELECT qual LIKE '%created_by = auth.uid()%' FROM pg_policies WHERE schemaname = 'projects' AND tablename = 'site_diary_entries' AND policyname = 'Authors can delete their diary entries'
-- sql: SELECT count(*) = 2 FROM pg_policies WHERE schemaname = 'projects' AND tablename = 'site_diary_entries' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
-- sql: SELECT prosecdef AND provolatile = 's' AND proconfig @> ARRAY['search_path=""', 'row_security=off'] FROM pg_proc WHERE oid = 'projects.user_can_edit_diary_entry(uuid,uuid)'::regprocedure
-- behaviour: a contractor who is NOT a member of the entry's project -> every UPDATE denied (move, org-decouple, rewrite, re-attribute), and the 00149 DELETE bypass that followed from re-attribution is gone
-- behaviour: a contractor who IS a member but holds no write role -> a colleague's entry denied, their OWN entry still editable and still deletable
-- behaviour: an org owner/admin/PM -> a colleague's entry still editable; an entry pointed at a project in ANOTHER organisation denied
-- behaviour: SELECT unchanged at every role, on both the org policy and the cross-org one
-- behaviour: service_role and postgres writes unaffected (rolbypassrls, and neither role is named by the policy)
-- @verify:end
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. The write-authority predicate
-- ===========================================================================
-- ONE definition of "may edit this diary entry", called from both arms of the
-- policy below so the USING and the WITH CHECK cannot drift apart.
--
-- Reads no table itself — `public.user_effective_project_role` (00107) does
-- all of it, and is already SECURITY DEFINER with `row_security = off`. This
-- wrapper is declared the same way so that stays true if it ever grows a
-- lookup of its own, and `search_path = ''` forces full qualification.
--
-- Returns FALSE, never NULL: `eff_role IN (…)` is NULL for a caller with no
-- role on the project, and a NULL inside a RESTRICTIVE USING reads as "no
-- row" rather than "denied" — the trap 00183 hit. The COALESCE is what makes
-- the empty case a refusal.
CREATE OR REPLACE FUNCTION projects.user_can_edit_diary_entry(
  p_project_id UUID,
  p_created_by UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
SET row_security TO 'off'
AS $function$
  SELECT COALESCE(
           v.eff_role IN ('owner', 'admin', 'project_manager')
           OR (v.eff_role IS NOT NULL AND p_created_by = auth.uid()),
           FALSE)
    FROM (SELECT public.user_effective_project_role(p_project_id, auth.uid()) AS eff_role) v;
$function$;

COMMENT ON FUNCTION projects.user_can_edit_diary_entry(UUID, UUID) IS
'TRUE when the caller may edit a site-diary entry on the given project: they hold owner / admin / project_manager as their EFFECTIVE project role (public.user_effective_project_role — org-level admins win everywhere, per-project promotions are honoured), or they authored the entry AND still hold some effective role on that project. The second conjunct is what stops the author arm becoming a second org-wide hole and what keeps project_id from being relocated onto a project the caller is not on. FALSE, never NULL, for a caller with no role on the project. See migration 00203.';

-- Supabase's bootstrap ALTER DEFAULT PRIVILEGES grants `anon` EXECUTE DIRECTLY
-- at creation in the `public` schema, a SEPARATE grant that
-- `REVOKE … FROM PUBLIC` does not touch (the 00162 finding; 00186 swept the
-- database). `projects` has no function default ACL at all, so only the
-- built-in PUBLIC grant applies here — name `anon` explicitly anyway so the
-- guarantee does not depend on that staying true, and keep 00186's sweep and
-- its contract test green for this schema.
REVOKE ALL ON FUNCTION projects.user_can_edit_diary_entry(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.user_can_edit_diary_entry(UUID, UUID) TO authenticated, service_role;

-- ===========================================================================
-- 2. RESTRICTIVE write gate on UPDATE
-- ===========================================================================
-- USING decides which EXISTING rows may be updated. WITH CHECK decides what
-- the row may become, and carries the org binding: a caller may not leave a
-- row whose organisation_id disagrees with the organisation of the project it
-- names. Calling the predicate on both sides means an entry can neither be
-- taken from someone with authority over it, nor handed to a project the
-- caller has none over.
DROP POLICY IF EXISTS diary_entries_update_authz ON projects.site_diary_entries;

CREATE POLICY diary_entries_update_authz ON projects.site_diary_entries
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING      (projects.user_can_edit_diary_entry(project_id, created_by))
    WITH CHECK (
        projects.user_can_edit_diary_entry(project_id, created_by)
        AND organisation_id = (SELECT p.organisation_id
                                 FROM projects.projects p
                                WHERE p.id = project_id)
    );

-- ===========================================================================
-- 3. Reload PostgREST's schema cache
-- ===========================================================================
NOTIFY pgrst, 'reload schema';
