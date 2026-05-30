# Membership System — Design Spec

**Date:** 2026-05-29
**Author:** Arno (WM Consulting) + Claude (brainstorming session)
**Status:** Shipped in 4 PRs (PR-A through PR-D) on 2026-05-29. See git log for commits.

## 1. Purpose & Goals

Replace the current half-built contractor-company grouping with a proper **multi-tenant sub-organization model**.

WM Consulting (the org) works with multiple external contracting parties (e.g., Bob's Building, Smith Construction). Each contracting party has:

- Its own contact / legal details (address, signatory, registration number, VAT number).
- A roster of people (site agents) who need to log in to ESITE.
- Participation across one or more WM projects.
- A potential future as an independent paid-account org if its owner ever signs up.

The current code (after PRs `4de5562`, `30c1896`, `343505b`) treats contractor companies as a flat label on `user_organisations.contractor_company_id`. This is **insufficient** because:

- Contact details have nowhere to live.
- The roster isn't a first-class concept — it's an emergent filter on tagged users.
- People belong to WM's auth boundary, which conflicts with eventually letting Bob own his own org.
- The empty-state UX is broken (the "Internal-only" dropdown that triggered the redesign).

### Locked architectural decisions (from this session)

1. **Multi-org auth.** One `auth.users` row per person; multiple `user_organisations` rows for multi-org users; org switcher dropdown for users with >1 active membership.
2. **Shadow sub-orgs from day 1.** Sub-orgs are real rows in `public.organisations` from the moment WM creates them, marked `is_shadow=TRUE` with `parent_organisation_id=WM`. No migration when the sub-org's owner eventually buys their own account.
3. **Central pool + inline creation.** A `/settings/sub-organizations` page lists all sub-orgs WM has created. Inside a project, "Add from sub-org" can either pick from the pool or create a new one inline.
4. **Separate from `projects.jbcc_parties`.** JBCC parties stays untouched; sub-orgs is a parallel concept. Some data duplication is acceptable.
5. **Phased delivery — 4 PRs.** PR-A schema + central pool, PR-B roster + invite, PR-C cross-org project membership + switcher, PR-D polish + deprecate.

## 2. Data Model

### 2.1 `public.organisations` — modified

Add columns (no breaking changes; existing rows get defaults):

| Column | Type | Default | Purpose |
|---|---|---|---|
| `is_shadow` | BOOLEAN NOT NULL | FALSE | TRUE while the sub-org is managed by its parent and has no paid account |
| `parent_organisation_id` | UUID NULL | NULL | For shadow orgs, the creating org (e.g., WM Consulting) |
| `address` | TEXT NULL | NULL | Postal address |
| `phone` | TEXT NULL | NULL | Main contact number |
| `registration_number` | TEXT NULL | NULL | Company registration |
| `vat_number` | TEXT NULL | NULL | VAT registration |
| `signatory_name` | TEXT NULL | NULL | Authorised signatory's name |
| `signatory_title` | TEXT NULL | NULL | Authorised signatory's title |

Index: `(parent_organisation_id, is_shadow)` for listing a parent's shadow children.

### 2.2 `public.user_organisations` — mostly unchanged

When WM invites Mike to Bob's Building's shadow org:
- Mike's `user_organisations` row: `(user_id=Mike, organisation_id=BobsBuilding, role='contractor', is_active=TRUE)`.
- He does **NOT** get a row for WM. He's Bob's Building's user, granted access to specific WM projects via `project_members`.

`role` enum unchanged. For shadow-org members WM invites, default role is `'contractor'`.

### 2.3 `projects.project_members` — schema unchanged, convention changes

The existing `organisation_id` column already references `public.organisations(id)` without a check that it matches the project's owning org.

**New convention:** `organisation_id` on a `project_members` row holds the user's **identity org** (the org via which they have an authenticated identity), NOT the project's owning org.

Examples:
- Arno (WM owner) on KINGSWALK: `(project=KINGSWALK, user=Arno, organisation_id=WM, role='owner')`. *Or absent entirely — WM owners auto-pass via `user_has_project_access` clause 2.*
- Dawie (WM PM) on KINGSWALK: usually absent — he auto-passes too.
- Mike (Bob's Building) on KINGSWALK: `(project=KINGSWALK, user=Mike, organisation_id=BobsBuilding, role='contractor')`.

### 2.4 Functions — no changes required

- `user_has_project_access(_project_id)`: its JOIN on `user_organisations.organisation_id = project_members.organisation_id` now finds Mike's Bob's Building membership. Works as-is.
- `user_effective_project_role(p_project_id, p_user_id)`: for Mike, the org clause finds nothing (he's not in WM), so it falls through to the project_members clause and returns 'contractor'. Works as-is.

### 2.5 Permissions / RLS

**New rule on `public.organisations`:** owner / admin / project_manager of `parent_organisation_id` can SELECT and UPDATE shadow orgs where they're the parent. Lets WM admins manage Bob's Building's contact details and roster without anyone being a literal member of the shadow org.

When the shadow flag is cleared (Bob upgrades), the parent linkage is also cleared (`parent_organisation_id = NULL`), so WM automatically loses management rights — no manual revocation needed.

### 2.6 Dropped from previous PR (343505b)

- `projects.contractor_companies` table — dropped in PR-A.
- `public.user_organisations.contractor_company_id` column — dropped in PR-A.
- `ContractorCompaniesPanel`, `UserCompanyDropdown`, related actions, company dropdown on AddUserForm — deleted in PR-A.

The bulk-add modal I shipped is **kept** and re-pointed at sub-orgs in PR-B/C.

## 3. Auth Flow + Org Switcher

### 3.1 Sign-in behavior

- Supabase auth verifies the password.
- App calls `getOrgContext` to resolve which org to land the user in.
- **Single-org users** → straight to dashboard, no picker.
- **Multi-org users on first login** → shown a one-time org-picker screen, then onward.
- Subsequent visits → straight to last-used org.

### 3.2 Active-org tracking

Add `public.profiles.active_organisation_id` UUID NULL.

`getOrgContext` resolution order:
1. `profiles.active_organisation_id` if it points at an active membership.
2. Oldest active membership as fallback.

Updated whenever the user changes orgs via the switcher.

### 3.3 Org switcher UI

Top-nav component, replaces the current static org label.

- Single-org users → static label, no click affordance.
- Multi-org users → clickable button; dropdown lists each membership with org name + role + "current" marker.
- Click switches: calls `setActiveOrganisation(orgId)` server action → updates `profiles.active_organisation_id` → `router.refresh()`.

### 3.4 Existing role helpers

- `requireRole(supabase, orgId, allowedRoles)` — unchanged. Existing call sites pass explicit `orgId`.
- `requireRoleAPI` / `requireRolePage` — updated to read `active_organisation_id` first.
- `requireEffectiveRole(supabase, projectId, allowedRoles)` — unchanged.

## 4. UI Surfaces

### 4.1 Top-nav org switcher

Component: `OrgSwitcher` in `apps/web/src/components/layout/`. Used in the admin shell layout.

### 4.2 `/settings/sub-organizations` — central pool

Owner/admin/PM (`ORG_WRITE_ROLES`) only.

- Table: name | # roster | # attached projects | status badge (Shadow / Claimed) | actions.
- `+ Add sub-organization` button → modal form: name, address, phone, registration #, VAT #, signatory name, signatory title.
- Click row → `/settings/sub-organizations/[id]`.

### 4.3 `/settings/sub-organizations/[id]` — sub-org detail

- Header: name, status badge.
- Panel 1 — Contact details (editable inline).
- Panel 2 — Roster: list of people in this sub-org, role-in-sub-org, last-seen, remove action. `+ Add person` button. `+ Bulk invite` button (reuses the existing bulk-add modal, retargeted at the sub-org).
- Panel 3 — Attached projects: list of WM projects this sub-org has at least one person on, with person counts. Click-through to project's members page.
- Footer — `Transfer ownership` button: placeholder banner in V1 ("Transfer when the owner signs up — coming in a future release").

### 4.4 `/projects/[id]/settings/members` — additions

Existing functionality kept:
- `+ Add member` (single org-internal user).
- `+ Add many` (bulk; the modal I shipped in 343505b stays).

New:
- `+ Add from sub-organization` button → modal:
  1. Pick a sub-org from the pool. *(If the pool is empty OR you want to add a new one, a "Create new sub-organization" link inside the modal opens the same contact-detail form used in `/settings/sub-organizations`. After creation, the new sub-org is auto-selected and you proceed.)*
  2. Multi-select people from that sub-org's roster, with email shown.
  3. Pick a single project role to assign to all selected (`project_manager` / `contractor` / `inspector` / `supplier` / `client_viewer`).
  4. Submit → creates `project_members` rows with `organisation_id = sub_org_id` and the chosen role. Same per-row summary screen (added / skipped-already-on-project / failed) as the existing bulk-add modal.

### 4.5 Empty states

- Sub-org pool empty → CTA card: "Create your first sub-organization to attach contracting parties to projects."
- Sub-org roster empty → CTA: "Add the first person from this sub-organization."
- Project's "Add from sub-org" with no sub-orgs in the pool → modal shows the create-sub-org form directly, no two-step.

### 4.6 Removed surfaces

- `ContractorCompaniesPanel` on `/settings/users`.
- `UserCompanyDropdown` per-row select on `/settings/users`.
- Company dropdown on `AddUserForm`.
- Server actions in `apps/web/src/actions/contractor-companies.actions.ts` — deleted.

## 5. PR Phasing

Each PR ends with a specific on-prod verification before the next PR starts. Strict serialization.

### 5.1 PR-A — Sub-org schema + central pool

- Migration: add `is_shadow`, `parent_organisation_id`, contact-detail columns to `public.organisations`. RLS rule for parent-managed shadow orgs. DROP `projects.contractor_companies` + DROP COLUMN `user_organisations.contractor_company_id`.
- Server actions: `sub-organisations.actions.ts` (list, create, update, deactivate).
- UI: `/settings/sub-organizations` list page + `/settings/sub-organizations/[id]` detail page (contact panel only; roster + projects are empty placeholders).
- Remove `ContractorCompaniesPanel`, `UserCompanyDropdown`, AddUserForm company select, contractor-companies action file.
- **Verify on prod:** create "Bob's Building" with full contact details; appears in pool; contractor_companies is gone; typecheck + tests pass; no UI regressions on `/settings/users`.

### 5.2 PR-B — Roster + invite

- Server actions: `sub-org-members.actions.ts` — list roster, add single, remove, bulk-add-or-invite (the bulk action from 343505b refactored to write `user_organisations` rows on the sub-org).
- UI: roster panel on sub-org detail becomes interactive. `+ Add person` opens an inline form for a single email + name. `+ Bulk invite` opens the existing modal from 343505b, refactored so its `contractorCompanyId` param becomes `subOrganisationId` and the action writes `user_organisations` rows on that sub-org instead of the WM org.
- **Verify on prod:** invite Mike to Bob's Building. He receives the set-password email. Signs in. Sees Bob's Building as his only org (no switcher), empty projects list, no errors.

### 5.3 PR-C — Cross-org project membership + switcher

- Migration: add `public.profiles.active_organisation_id` UUID NULL.
- `getOrgContext` updated to read `active_organisation_id` first.
- New `setActiveOrganisation` server action.
- New `OrgSwitcher` component in the top-nav.
- New `+ Add from sub-organization` flow on `/projects/[id]/settings/members`.
- **Verify on prod:** Arno adds Mike (Bob's Building) to KINGSWALK as 'contractor'. Mike refreshes. KINGSWALK appears in his projects list. He opens it. Cost is hidden for him. Switcher behavior matches design (static for single-org, dropdown for any user with multiple memberships).

### 5.4 PR-D — Polish, edge cases, deprecate

- Tests for cross-org `requireEffectiveRole` scenarios.
- Edge case handlers: remove-from-roster cascade, sub-org deactivation behavior, email collision when invitee already has an `auth.users` row.
- Memory + spec doc updates.
- Placeholder UI for "Transfer ownership" on sub-org detail.
- **Verify on prod:** full end-to-end smoke test for new flows; existing cost-view and effective-role behavior unchanged.

## 6. Migration + Edge Cases

### 6.1 Existing data migration

Trivial — no data to migrate:
- `projects.contractor_companies` is empty on prod (verified during this session).
- `user_organisations.contractor_company_id` is all NULLs.

Safe to drop both with no backfill in PR-A.

### 6.2 Sub-org deactivation

- Deactivating a sub-org doesn't auto-remove its people from project_members. Roster page shows an "inactive" banner; sub-org is dimmed in the central pool.
- People can still log in; their assigned projects remain visible.
- WM explicitly removes them from `project_members` if/when they're no longer needed.
- Reactivation just clears the inactive flag.

### 6.3 Removing a person from a sub-org

- Sets the person's `user_organisations` row for that sub-org to `is_active=FALSE`.
- They LOSE access to all WM projects they were on via that sub-org (RLS gates require active membership).
- The remove confirmation lists projects affected: *"Mike is on 3 projects. Removing him will revoke his access to all of them. Continue?"*

### 6.4 Transfer of ownership (placeholder in V1)

When Bob signs up via the normal signup flow with an email that matches a shadow-org member:
- The signup callback notices: "this email is already a member of one shadow org you could claim."
- A claim screen offers: *"It looks like you're already a member of Bob's Building (managed by WM Consulting). Claim this organization?"*
- Claim flow: `is_shadow = FALSE`, `parent_organisation_id = NULL`, Bob's `user_organisations.role` becomes `'owner'`. WM admins lose management rights automatically (parent-based RLS no longer matches).
- Mike + existing roster + project memberships unchanged.

**V1 ships only the placeholder banner.** Full claim flow is a follow-up spec.

### 6.5 Email collision

WM invites mike@email.com to Bob's Building, but Mike already has an `auth.users` row from some other context:
- The provision step (`auth.admin.createUser`) errors with "already exists".
- The action catches this and looks up the existing `auth.users.id` by email.
- Adds a `user_organisations` row for Bob's Building against that user.
- Sends the set-password email anyway (no-op if they already have a password; otherwise standard recovery).
- Mike now has 2+ memberships → org switcher kicks in.

### 6.6 Other edge cases

- Sub-org name collision: allowed (names not unique across `public.organisations`).
- Project deleted while sub-org people are on it: cascade per existing FK — `project_members` rows go too.
- User removed from a single project while still in the sub-org: only that project access goes.
- Sub-org's only person is removed: roster empty, sub-org keeps existing (still picked for future people).

## 7. Testing Strategy

### 7.1 Per-PR unit tests

- PR-A: server actions for sub-org CRUD; RLS for parent-managed shadow orgs; migration tested in dev DB before prod apply.
- PR-B: roster server actions; bulk-add retargeted to sub-org; conflict on duplicate invite.
- PR-C: cross-org `project_members` insert; org switcher render logic; `getOrgContext` resolution order.
- PR-D: integration tests for cross-org `requireEffectiveRole`; cascade behavior on removals.

### 7.2 Per-PR on-prod verification

Each PR's "Verify on prod" criterion (in §5) is a manual smoke test the user runs after deploy. Failure returns to design — do not patch the patch (per the investigation protocol in CLAUDE.md).

### 7.3 Regression surface

The existing cost-view, effective-role, JBCC parties, and contacts behavior must remain unchanged after each PR. Existing test suite must pass at every PR boundary.

## 8. Open Items / Deferred to Future Specs

- **Full transfer-ownership flow** when a shadow-org owner signs up (placeholder UI in PR-D; mechanics deferred).
- **Sub-org-to-sub-org cross-references** (e.g., "Smith Construction is a sub-contractor of Bob's Building on KINGSWALK"). Not in scope here.
- **Billing implications** of shadow orgs (who pays for what when Mike consumes resources). Out of scope.
- **Sub-org-attached projects metadata** (e.g., contract start/end date per sub-org per project, beyond just membership). Out of scope here — could be a future enrichment.

## 9. References

- Prior PRs setting context: `4de5562` (cost-view fix), `30c1896` (effective-role mechanic), `343505b` (contractor companies + bulk-add — partially superseded by this spec).
- Migrations: `00106_relax_user_has_project_access.sql`, `00107_user_effective_project_role.sql`, `00108_contractor_companies.sql` (the table 00108 created is **dropped** by PR-A of this spec).
- Memory: [esite-rbac-model](../../.claude/projects/-Users-spud-Documents-DEVELOPER/memory/esite-rbac-model.md), [esite-project-context](../../.claude/projects/-Users-spud-Documents-DEVELOPER/memory/esite-project-context.md).

## 10. Post-ship follow-ups (PR-E + PR-F, 2026-05-29 → 05-30)

After the 4 design PRs shipped, a senior-engineer audit of the live code surfaced 6 issues, fixed in **PR-E** (`b28586a`…`946cc03`):

1. **Security — RBAC helper grants.** `user_effective_project_role`, `user_has_project_access`, `user_is_client_viewer`, `get_user_org_ids` were `EXECUTE`-able by `PUBLIC` + `anon` (Postgres default). `user_effective_project_role(project, user)` let unauthenticated callers enumerate roles. **Migration 00113** REVOKEs `PUBLIC` + `anon`; `authenticated` + `service_role` retained.
2. **React hooks-rule violation in `OrgSwitcher`** — `useEffect` after an early return (the eslint-disable masked it). Refactored so all hooks run unconditionally.
3. **`listProjectMembers` cross-org `org_role`** — looked up by the project's org, returning `null` for sub-org members. Now keyed per-row by each member's `organisation_id`.
4. **`resolveSubOrg` filtered `is_shadow=true`** — would silently break the roster UI once a sub-org is claimed. Filter dropped; the `requireRole(parent_organisation_id, …)` gate is the access boundary.
5. **`addProjectMembersFromSubOrg`** now rejects deactivated (`is_active=false`) and claimed (`is_shadow=false`) sub-orgs.
6. **`AddFromSubOrgModal`** picker filters out deactivated / claimed sub-orgs.

**PR-F** (`b1bfb1c`…`b99f96f`) added 24 tests (152 web tests total) covering the previously-untested surfaces: `active-organisation.actions`, `OrgSwitcher` render branches + interactions, `addProjectMembersFromSubOrg` gates, `setSubOrgActive`, and the `addSubOrgMember` email-collision path.

Migrations after this spec's original 00109–00112: **00113** (grant lockdown). Latest prod commit: `b99f96f`.

**Still genuinely deferred** (unchanged from §8): the full transfer-ownership claim flow when a shadow-org owner signs up. Placeholder UI is live; the claim mechanics need their own spec.
