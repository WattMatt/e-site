# Site-scoped access — design

**Date:** 2026-10-01, re-checked 2026-10-05 · **Status:** approved in conversation, pending spec review
**Owner decision:** owners + admins see every site in their organisation; every other role sees only the projects they are a member of.

## 1. Problem (evidenced on production, 2026-10-01)

Only `client_viewer` is limited to its sites. Every other active org member reads every project in the org.

- About 25 tables carry the shape `organisation_id = ANY(get_user_org_ids()) AND (NOT user_is_client_viewer(org) OR project_id IN (my memberships))`: `projects.projects`, `rfis`, `drawings`, `contacts`, `handover_checklist`, `site_diary_entries`, `field.snags`, `cables`, `inspection_*`, `tenants.documents`, `floor_plan_versions`, `handover_folders`, and the whole `cable_schedule` set. Several grant WRITE org-wide too (`tenants.floor_plans` "Org members can manage", `gcr.*_write`, `cable_schedule.*_write`).
- **Every non-owner/admin member of WM-Consulting is an outside company.** 13 contractors (aeec, siyayapower, qualelect, struction, matlaqs) and 4 client viewers (matlapm, gmigroup). Each contractor belongs to 1–3 projects, yet can read all 13 WM projects, including other clients' sites. This is a live cross-client leak, not a tidy-up.
- `user_has_project_access()` clause (b) passes org-level `owner | admin | project_manager`. No org-level `project_manager` exists today (2 owners, 12 admins, 13 contractors, 4 client viewers).
- Paths that bypass table RLS:
  - 9 storage buckets authorise reads by org folder only: `drawings`, `project-documents`, `rfi-attachments`, `diary-attachments`, `snag-photos`, `coc-documents`, `qc-report-entries`, `report-logos`, `jbcc-letters`, plus `cable-schedule-evidence`.
  - PowerSync `org_*` buckets would sync every org row to mobile, keyed only on `org_id` (dormant: no PowerSync instance runs in production, see §4).
  - 142 web files use the service client, 19 of them under `app/api`.

**Re-checked 2026-10-05 against `main` `998bb75f` (ledger head `00231`), in a local browser signed in as the `rbac-test` contractor (member of KINGSWALK only):**
- `/projects` lists all **13** projects and offers "+ New Project".
- HERITAGE HILL's overview opens and shows its client and contact.
- ITONKA's Floor Plans lists **130** drawings, plus the Dropbox folder path and the connecting account's email.
- The admin pages `/settings/whatsapp` and `/settings/billing` correctly bounce to `/dashboard`.

**Five project tables were added since 2026-10-01.**
- `projects.load_profiles`, `load_profile_sources` and `projects.tenders` gate on `user_effective_project_role()`. That function returns NULL for a contractor who is not a member, so these tables are already site-scoped. (Clause 1 of that function still passes an org-level `project_manager`; see §3.1.)
- `public.rate_sources` and `rate_observations` are the org-level rate library, behind `rate_library_can_access`. They are exempt by design.

**Design check:** the rule itself is wrong. A project membership is recorded for everyone, but it only constrains client viewers. That is design, not a bug.

## 2. The rule

> A user may read or write a project's data iff `public.user_has_project_access(project_id)`: an active `project_members` row (clause a), or an active org membership as **owner or admin** of the project's org (clause b).

- `project_manager` leaves clause (b). An org PM becomes site-only like everyone else.
- A project-level role (`project_members.role`) is unchanged and still decides what a member may DO on that site, through the existing `user_effective_project_role()` gates.
- Org-level configuration stays org-wide. It is not site data, and is declared exempt with a reason:
  - `cable_schedule.rate_library`, `structure.scope_item_types`, `field.form_templates`, `inspections.templates`;
  - billing tables, `org_storage_connections`, `organisations`, `profiles`;
  - the number-sequence tables.

## 3. Database (one migration, claimed at apply time)

1. **`user_has_project_access`**: drop `project_manager` from clause (b). `CREATE OR REPLACE`; keep the attributes and ACL (assert them).
   - **`user_effective_project_role` clause 1 changes the same way.** An org `project_manager` without a membership row gets NULL, and with one gets the membership role.
   - Otherwise an org PM keeps every site through the tables gated on the effective role: load profiles, tenders, jbcc, reports-by-kind and the work-item gates.
   - Org-level features gated on the org role itself (rate library, `requirePmOrAbove`) are not site data and are unchanged.
2. **A site gate on every site table.** One RESTRICTIVE policy per table, `FOR ALL`, `USING` and `WITH CHECK` both `user_has_project_access(<project>)`.
   - A RESTRICTIVE policy can only narrow access, and here narrowing reads is the intent (see `postgres-restrictive-for-all-narrows-reads`).
   - For a table with `project_id`: `user_has_project_access(project_id)`.
   - For a child table without one (`rfi_responses`, `snag_photos`, `site_diary_attachments`, `work_item_notes/attachments/events`, `cable_schedule.*` children, `jbcc_letter_*`, `node_orders`, …): a STABLE SECURITY DEFINER resolver `<schema>.<table>_project_id(id)`, or an `EXISTS` through the parent. The parent's own gate does not apply inside a policy subquery evaluated as definer, so the child must gate explicitly.
   - `service_role` is unaffected: it bypasses RLS. The FORCE-RLS tables already have their service-role path proven (#198).
   - Name: `site_scope` on every table, so the guard and the `@verify` block can find it.
   - **A table whose every permissive policy already requires `user_has_project_access` or `user_effective_project_role` IS NOT NULL is already site-scoped.** It still gets `site_scope`: one uniform gate is what the guard checks, and it costs nothing. Examples are `structure.nodes`, `projects.qc_*`, `load_profiles` and `tenders`.
   - **Tender bidder accounts** reach tender rows only through definer functions (E5), not through table SELECT. So `site_scope` on `projects.tenders` and its children cannot lock bidders out. The E5 assertion suite (`assert-tender-sealed-bids.sql`) must stay green with the gate applied.
3. **`projects.projects` itself** gets the same gate on `id`, so the project list narrows.
4. **`projects.project_members` and `public.profiles`.** A site-only user sees members and profiles only for people on their own sites, not the whole org directory. Membership SELECT becomes `user_has_project_access(project_id)`. The profiles policy becomes "shares a project with me, or I am owner/admin of their org".
5. **Solar (`solar.*`)** already runs its own per-project model (`solar.project_access` plus its own gates). Each solar table is declared exempt in the guard with "own gate: solar.*". This spec does not change Solar.
6. **Storage.** Each org-folder bucket's SELECT (and its write policies) gains the project check from the path:
   - where the path is `{org}/{project}/…`: `user_has_project_access(((storage.foldername(name))[2])::uuid)`, guarded by a UUID regex so a malformed path is refused rather than raising;
   - where the path does not carry the project: resolve through the owning row (e.g. `rfi-attachments` → `public.attachments`).
   - The path convention per bucket is confirmed in the plan by reading the upload code AND sampling `storage.objects` names. Prod is the evidence, not the code comment.
   - `report-logos` stays org-wide (org branding, not site data).
7. **`@verify`**: one `policy: <schema>.<table> site_scope RESTRICTIVE` per gated table, plus `sql:` predicates proving clause (b) no longer contains `project_manager`.

## 4. Mobile (PowerSync)

**There is no live exposure today.** No PowerSync instance runs in production, and the native app reads Supabase directly through RLS (PR #251 outbox), so §3 covers it. The steps below keep the sync rules right for the day PowerSync ships:

- `custom_jwt_claims` adds `all_sites: true|false` (owner/admin of the first active org).
- Every `org_*` bucket's parameter query becomes conditional on `token_parameters.all_sites = true`. Site-only users get the per-project buckets keyed on the existing `project_ids` claim, with the same data queries filtered by `project_id`.
- Revocation stays eventually-consistent: an outstanding token keeps its old claims until it is re-minted (~1 h). This is already documented for 00204.

## 5. Web app

1. **Service-client routes.** Every server file that uses `createServiceClient()` and reads or writes a project-scoped table must call one helper, `requireProjectAccess(projectId)` (session client → `user_has_project_access` RPC → 404, so another client's site is not even confirmed to exist), before touching data.
   - Guarded by a contract test: it scans `app/` + `actions/` + `lib/` for service-client use, and demands the helper call or an entry in `DECLARED_EXEMPT` with a reason (cron/webhook paths, platform admin).
   - The 2026-08-12 "report routes under `app/api/*`" finding (`qc-report-data.ts`, `snag-visit-report-data.ts`) is closed by this.
2. **Lists.** The dashboard, project switcher, search, notifications and "My work" read through the session client and so narrow automatically. Each is checked once as a site-only user.
3. **Settings → Users** shows each person's sites and an **Add to project** action (owner/admin only). Demoting any of the 12 admins is left to the owner, person by person; this work changes nobody's role.
4. `docs/rbac-matrix.md` gains the rule at the top and a "site-only" column note.

## 6. WhatsApp

Every `whatsapp.wa_*` function runs as the user under real RLS (`whatsapp.act_as`), so menus, item lists, cards and posts narrow with no WhatsApp change. A test asserts `wa_my_projects` for a site-only user returns only their projects.

## 7. Proof (written before the migration; must go red first)

`scripts/db/assert-site-scope.sql` impersonates real production users in rolled-back transactions:

- **A real aeec contractor on one project:**
  - every gated table returns rows for their own site;
  - every gated table returns **0** rows for a WM project they are not on;
  - an INSERT naming a foreign project is refused;
  - a storage `SELECT` on a foreign project's drawing path returns 0.
- **An admin** sees all 13 projects. **A client viewer** is unchanged.
- **The guard derives the table list from the schema:** every base table with a `project_id` column, and every table whose FK parent has one, must carry `site_scope` or be named exempt. A hand-written list could only confirm its author's belief.
- **Red first:** run against a no-op migration and the aeec contractor reads foreign rows (red). Then run against the real migration (green). Then run against a mutation dropping one table's gate, which must turn exactly that table red.
- Run all three suites, `web`, `@esite/shared` and `@esite/db`, plus the `@verify` verifier against a database.

## 8. Rollout and risk

- **Nobody loses their own sites:** every non-admin member already has ≥ 1 membership on the sites they work on (checked 2026-10-01). What disappears is other clients' sites.
- **Risk:** a page that silently relied on org-wide reads (e.g. a cross-project summary shown to a contractor) renders empty. Mitigation: the site-only walk in §5.2, done as the rbac-test contractor, before and after.
- **Deploy order:**
  1. migration (dry-run 100% green on prod first);
  2. web (service-client helper);
  3. PowerSync sync rules + JWT hook (same migration for the hook; the rules are deployed through the PowerSync dashboard);
  4. read back: ledger, the `@verify` block, and the assertion suite against live.
- **Deploy cost:** one migration, one web deploy, one PowerSync rules push. What it verifies: §7 against the live state.

## 9. Out of scope

- Changing anyone's role.
- Module-level restrictions within a site (existing role gates already do this).
- Solar's own access model.
- Cross-org sharing beyond `project_members`.
