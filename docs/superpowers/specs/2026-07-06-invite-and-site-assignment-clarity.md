# Invite Clarity + Site-Assignment Visibility — Investigation & Design

**Date:** 2026-07-06
**Author:** Arno + Claude
**Trigger task:** "Investigate adding users, and ensuring those users are assigned to a specific site and/or sites."
**Branch:** `feat/invite-and-site-clarity` (off `main`)

## 0. Success criteria (from task)

- **A. Invite is clearly not spam** — for contractors and any other user type.
- **B. Assign-to-site is clear** — invitee knows who assigned them + which site(s); a user only
  has access to that site; cross-org users keep their own sites and shared sites are *added* to
  their project list.
- **C. End-to-end verification** of visibility and applicable security.
- **D. Updates published** to the live app.

## 1. Full-system map (verified against source)

### Live user-creation entry points (all four send a *bare Supabase recovery email*)

| # | Entry point | File | Writes | Email |
|---|---|---|---|---|
| 1 | Add internal org user | `apps/web/src/actions/users.actions.ts:70,103` | `user_organisations(org=WM)` | `resetPasswordForEmail` |
| 2 | Add one contractor to sub-org roster | `apps/web/src/actions/sub-org-members.actions.ts:194,244` | `user_organisations(org=subOrg)` | `resetPasswordForEmail` |
| 3 | Bulk-invite contractors to sub-org | `sub-org-members.actions.ts:452,506` | `user_organisations(org=subOrg)` | `resetPasswordForEmail` |
| 4 | Bulk add/invite to a project by email | `apps/web/src/actions/project-members-bulk.actions.ts:175,210` | `user_organisations(org=WM)` + `project_members(org=WM)` | `resetPasswordForEmail` |

### Site assignment (the "assign to site" step)

- `addProjectMember` (existing member) / `bulkAddOrInviteProjectMembers` (email) — write
  `project_members.organisation_id = owning org (WM)`.
- `addProjectMembersFromSubOrg` (`project-members-from-sub-org.actions.ts:127`) — writes
  `project_members.organisation_id = subOrgId` (the contractor's identity org).

### Orphaned / dead paths (do NOT build on)

- `org_invites` token table (`00012`) is **dropped** by `00079_admin_managed_users.sql`.
- `send-email` `type:'invite'` template (`index.ts:120`) still exists but links to
  `/onboarding/join?token=` — **a web route that does not exist (404)** — and nothing calls it.
- Mobile `app/(auth)/invite/[token].tsx` uses `verifyOtp(type:'invite')` — a *third* mechanism no
  live code produces. Divergent/dead.

## 2. Gaps vs criteria

### A — Anti-spam invite: **WEAK**
- The only email any new user gets is a generic "reset your password" mail. No branding, no
  inviter name, no org/company, no "you were added to <site>", no reason-for-receipt. A contractor
  who never signed up reads this as phishing.
- Corporate mail scanners pre-click recovery links and burn the OTP → first click shows "expired".

### B — Assign-to-site clarity + cross-org additive: **PARTLY BROKEN**
- **b1 Transparency:** invitee never learns which site(s) or who invited them (not in email, not in
  acceptance UX). Weak.
- **b2 Cross-org additive visibility — BROKEN at RLS (root cause below).**
- **b3 Single-site scoping:** correct. Org boundary is hard (`get_user_org_ids()` in every
  org-scoped SELECT); a contractor is scoped to assigned projects; deactivation soft-revokes.

### C — End-to-end verification: **not yet done** (blocked on fixing b2 + adding tests).

### D — Published live: **not yet done.**

## 3. ROOT CAUSE — cross-org shared sites are invisible in the project list

**Statement:** A cross-org contractor (e.g. Mike @ Bob's Building) added to WM's KINGSWALK via the
sub-org path cannot see KINGSWALK in their project list, because the `projects.projects` SELECT RLS
policy gates solely on `organisation_id = ANY(public.get_user_org_ids())`
(`00034_client_viewer_project_scope.sql:57-68`, unchanged in intent since `00009`), while:

- `get_user_org_ids()` (`00027`) returns only the user's **active `user_organisations`** rows →
  for Mike that is `{Bob's Building}` only.
- the shared project's `organisation_id` is the **owning** org (WM).
- the sub-org assignment writes `project_members.organisation_id = subOrgId`
  (`project-members-from-sub-org.actions.ts:127`).

So `WM ∈ {Bob's Building}` is false → the project row is filtered out. The spec (§2.4) **assumed**
`user_has_project_access()` gated project visibility ("Works as-is"), but **no policy on
`projects.projects` ever calls it** — it only gates *deep* child tables (structure/cables/snags/
valuations/variations/reports, migrations `00086`–`00135`). Result: the project card, and the
org-scoped list policies for RFIs / site-diary / drawings / snags (all sharing the `00034` pattern)
are invisible to cross-org members, even though the deep per-project data would return if reached
by direct URL.

**Evidence (Z):** (Z1) exhaustive enumeration — the only `projects.projects FOR SELECT` policies
are `00009:144` and `00034:57`, both org-scoped, neither references `user_has_project_access`;
(Z2) `get_user_org_ids` body (`00027:16`); (Z3) sub-org insert org id (`…from-sub-org.actions.ts:127`).

### Architecture-vs-symptom check
Design bug, not a code typo: the spec's cross-org visibility assumption is wrong against the
implemented RLS. The correct fix aligns the projects (and project-scoped list) SELECT policies with
the intended `user_has_project_access` gate, additively (keep org-scope + client_viewer narrowing,
OR-in the explicit cross-org project-member path).

## 4. Solution (no code yet → then code)

1. **Branded invite email** (Criterion A): one shared helper `sendInviteEmail()` used by all four
   entry points. Sends via existing Resend `send-email` edge fn (new/updated `type:'invite'`
   payload). Contains: inviter name, org/company name, role, the specific **site(s)** if assigned,
   an anti-phishing reason-for-receipt line, and a working set-password CTA (link from
   `admin.generateLink({type:'recovery'})`). Falls back to `resetPasswordForEmail` on failure so a
   bug can never leave a user with no way in. Fix the dead `/onboarding/join` link.
2. **Site-assignment notification** (Criterion B/b1): when a user is added to a project, email them
   "You've been given access to <site> on E-Site by <name>" with scope explanation.
3. **RLS migration** (Criterion B/b2): `00153_cross_org_project_visibility.sql` — rewrite the
   `00034` SELECT policies on `projects.projects`, `projects.project_members`, and the
   project-scoped entity tables to `… OR public.user_has_project_access(<project_id>)`, preserving
   org-scope + client_viewer narrowing.
4. **Acceptance UX + admin clarity** (Criterion B/b1): show who invited / which site(s); admin sees
   a clear "this user now only has access to <site(s)>" confirmation.
5. **Tests** (Criterion C): unit tests for the email helper + actions; RLS reasoning/tests for the
   migration.
6. **Deploy** (Criterion D): edge fn (additive, safe) + web (PR to main). Mandated manual on-prod
   smoke test per project protocol §7.2.

## 5. Assumptions (no questions asked, per task)
- "Sites" == "projects". "Contractors" arrive via sub-orgs (shadow orgs).
- Prod deploy of auth/email + RLS is gated by the user's manual on-prod smoke test (project
  protocol §7.2 is non-negotiable); Claude prepares a one-click-deployable, reviewed, tested PR and
  deploys only the additive, backward-compatible edge-function change autonomously. Real invite
  emails are NOT sent as a "test" (no deploy-as-diagnostic).
