# `project_members.is_active` — RLS / app-gate divergence

**Date:** 2026-08-12
**Branch:** `fix/project-member-active-rls` (worktree, off `origin/main` = `5533275`)
**Migration:** `00182`
**Status:** design approved, not yet implemented

---

## 1. Problem

`projects.project_members.is_active` has two contradictory meanings in the same
system. Some call sites treat `false` as *revoked*; others ignore it. An
administrator who deactivates a project membership is told access is gone. It
is not — every RLS policy gated on `public.user_has_project_access` keeps
returning rows to that user's existing session token via direct PostgREST.

Two flags express membership, and each is honoured inconsistently:
`projects.project_members.is_active` (this project) and
`public.user_organisations.is_active` (this org). §2 maps which predicate is
missing where; one function, `user_effective_project_role`, honours the first
and omits the second, so it appears on both sides.

### Prod-verified 2026-08-12

Ref `cbskbnvvgcybmfikxgky`, inside `BEGIN; … ROLLBACK;`, zero residue. The
`rbac-test` fixture's `project_members` row on (643) KINGSWALK
(`81fc2329-2462-457d-9d24-9b051673c909`) was deactivated, then queried as that
user with `SET LOCAL role authenticated` + `request.jwt.claims`:

| Check | Result |
|---|---|
| `user_has_project_access` | `true` — RLS still grants |
| `user_effective_project_role` | `null` — app refuses |
| `qc_reports` visible | `1` — still readable |

`requireEffectiveRole` bounces the user out of the UI while the data layer
keeps serving them.

### Scale of the divergent surface

| Predicate | Policies | Tables |
|---|---:|---:|
| `user_has_project_access` | 93 | 63 |
| `user_effective_project_role` | 40 | — |

After migration 00160, `user_has_project_access` covers most per-project SELECT
surfaces: projects, rfis, snags, drawings, diary, cables, `cable_schedule.*`,
`tenants.*`, `qc_*`, inspections, node_orders, gcr.

---

## 2. Full-chain map

Every DB function and policy touching `projects.project_members` was
enumerated on prod (`pg_get_functiondef` over `pg_proc`, `pg_policies`).

### Honour `project_members.is_active` (4)

- `public.user_effective_project_role` — the app gate behind `requireEffectiveRole`
  (but omits `user_organisations.is_active`, so it also appears below)
- `public.project_notification_recipients` — email roster; **fully correct**, checks both flags
- `cable_schedule.revisions :: rev_select_org_and_scoped_clients`
- `tenants.documents :: "Org members + scoped clients view documents"`

The last two check `pm.is_active` in their own subquery, but their 00160 sibling
policy (`user_has_project_access(project_id)`) does not. Permissive policies OR
together, so the check is bypassed there too — they need no edit of their own,
and are fixed by change 1 below.

### Missing an `is_active` predicate (6 functions, the full change set)

| Function | Missing | Consequence |
|---|---|---|
| `public.user_has_project_access` | `pm.is_active` in clause (a) | 93 policies / 63 tables keep granting |
| `public.user_effective_project_role` | `uo.is_active` join in clause 2 | **mirror** — see §3 |
| `inspections.user_has_inspection_read` | `pm.is_active`, `uo.is_active` | deactivated user reads inspections |
| `inspections.user_can_write_responses` | `pm.is_active` | deactivated user **writes** responses |
| `inspections.user_can_verify` | `pm.is_active`, `uo.is_active` | deactivated admin **verifies** inspections |
| `public.custom_jwt_claims` | `pm.is_active` | mobile keeps syncing their projects |

`custom_jwt_claims` (migration 00164) omits the predicate **deliberately** —
its comment reads *"Deliberately does NOT filter pm.is_active (00106 clause (a)
doesn't), keeping mobile == web."* Fixing the SQL helper without this one would
leave mobile granting and make that comment false.

`inspections.user_can_verify` and `inspections.user_has_inspection_read`
additionally omit `uo.is_active` — the exact class migration 00152 fixed in
`user_can_manage_project`. A deactivated org owner/admin/PM can still verify
and read inspections.

### Clause (b) is correct, unchanged

`user_has_project_access` clause (b) is purely org-level — it joins
`user_organisations` on the project's org, checks `uo.is_active` and an
owner/admin/project_manager role, and never consults `project_members`. It
already matches `user_effective_project_role` clause 1. **No change.**

---

## 3. The mirror divergence

`user_effective_project_role` clause 2 selects an active `pm` row with **no
`user_organisations` join at all**, unlike `user_has_project_access` clause (a),
which requires `uo.is_active = TRUE`.

This matters because `removeSubOrgMember`
(`apps/web/src/actions/sub-org-members.actions.ts:352`) is the revocation path
that production actually uses: it flips `user_organisations.is_active = false`
and leaves `project_members` untouched. After it runs:

- `user_has_project_access` → **false** (RLS returns nothing)
- `user_effective_project_role` → **the pm row's role** (app grants a role)

This one fails closed — the user reaches a rendered page with no data rather
than leaking rows — but it is the same two-helpers-one-concept defect on the
live revocation path, so it is fixed in the same migration.

---

## 4. Blast radius: zero, both directions

| Query | Result |
|---|---:|
| `project_members` rows total | 44 (24 users, 14 projects) |
| rows with `is_active = false` | **0** |
| active `pm` + inactive `uo` (mirror) | **0** |
| active `pm` with no `uo` row at all | **0** |

No user loses access. The audit called for before narrowing 93 policies comes
back empty.

**No code path ever sets the flag false.** `removeProjectMember` hard-`DELETE`s
the row; `removeSubOrgMember` touches `user_organisations`. Grepping the
monorepo finds no writer of `project_members.is_active = false`. The column is
`NOT NULL DEFAULT true` and dormant.

So this is a **loaded trap, not a live leak**. The first "deactivate member"
feature — or one admin flipping the flag by hand in Studio — silently opens
read *and* inspection-write access that the UI reports as revoked. Precedent:
migration 00152 closed exactly this class for `user_organisations.is_active`.

---

## 5. Decision

`is_active = false` means **revoked**, everywhere. Both flags
(`project_members.is_active`, `user_organisations.is_active`) revoke app *and*
database access.

Rejected alternatives:

- **Fix `user_has_project_access` only.** Ships a knowingly partial fix in the
  same bug family: a deactivated member could still write inspection responses
  via PostgREST, mobile would still sync, and 00164's comment would be false.
- **Make removal the only revocation** (strip the checks from the four
  honouring sites, drop the column). Converges with less code but discards a
  soft-deactivation affordance and makes the database the permissive one.

---

## 6. Approach: parallel predicates + contract test

The two helpers stay independent; each gains the missing predicate.

**Rejected: delegation** — redefining
`user_has_project_access(_project_id) := user_effective_project_role(_project_id) IS NOT NULL`
would make drift structurally impossible, which is the better property. But it
swaps two cheap `EXISTS` for a CTE + `CASE` that re-evaluates its `org`
subquery, in a predicate evaluated **per row** (the argument is a column, not a
constant) across 63 tables including multi-thousand-row cable tables. Not worth
the regression risk for a trap with zero live rows.

Because parallel encodings persist, **the contract test is the anti-drift
mechanism and is part of the deliverable**, not an afterthought.

### Resulting rule, identical in both helpers

> Access ⟺ (active `project_members` row **and** active `user_organisations`
> row in that pm row's org) **or** (active org owner / admin / project_manager).

---

## 7. Migration `00182`

Six `CREATE OR REPLACE FUNCTION` statements over existing bodies. Every join
keeps its current shape — in particular `uo.organisation_id = pm.organisation_id`,
which resolves the user's **identity** org (per 00164's comment: *"an ACTIVE
explicit membership whose identity org the user is still ACTIVE in"*), so
cross-org project members are unaffected. Nothing changes but the added
predicates.

1. `public.user_has_project_access` — clause (a) `+ AND pm.is_active = TRUE`; clause (b) untouched
2. `public.user_effective_project_role` — clause 2 `pm` CTE `+ JOIN public.user_organisations … AND uo.is_active = TRUE`
3. `inspections.user_has_inspection_read` — `+ pm.is_active`, `+ uo.is_active`
4. `inspections.user_can_write_responses` — `+ pm.is_active`
5. `inspections.user_can_verify` — `+ pm.is_active`, `+ uo.is_active`
6. `public.custom_jwt_claims` — `+ pm.is_active`, and the now-false comment corrected

Existing `SECURITY DEFINER` / `STABLE` / `SET search_path` / `SET row_security`
attributes and all `GRANT`s are preserved verbatim. Idempotent
(`CREATE OR REPLACE`). No policy bodies change — all 93 inherit the fix.

Numbered **00182**, leaving `00181` to the in-flight client-viewer PR (same
convention as the 00174 gap left for PR #151).

**Reversal:** re-apply the prior bodies from 00106 / 00107 / 00164 / 00066-68.

---

## 8. Verification on prod — `BEGIN; … ROLLBACK;`, never committed

Apply 00182 inside the transaction, then assert. Two subjects and a control.

**Subject A — deactivated `pm` row** (`rbac-test` on KINGSWALK), queried as that
user via `SET LOCAL role authenticated` + `request.jwt.claims`. All must flip:

- `user_has_project_access` → `false`
- `user_effective_project_role` → `null`
- `qc_reports` / `snags` / `rfis` visible → `0`
- `inspections.user_has_inspection_read` / `user_can_write_responses` / `user_can_verify` → `false`
- `custom_jwt_claims` → `project_ids` excludes KINGSWALK

**Subject B — mirror** (`pm` active, `uo.is_active = false`):
`user_effective_project_role` → `null`, matching `user_has_project_access`.

**Control — an untouched active member:** every check above unchanged from its
pre-migration value. This is what proves the change narrows only what it should.

Capture a pre-migration baseline for all three in the same transaction, so each
assertion is a diff rather than an absolute. `ROLLBACK`, then re-confirm zero
residue outside the transaction.

---

## 9. Contract test

`apps/web/src/lib/project-member-active.contract.test.ts`, modelled on
`client-viewer-predicate.contract.test.ts` (00181) — it reads the migrations,
resolves the **final** definition of each function (later migrations override
earlier), and asserts the predicate actually in force. A unit test on calling
code cannot catch this: the defect lives entirely in SQL.

Differences from the 00181 test: it resolves **function** bodies, not policy
bodies, so it locates `CREATE OR REPLACE FUNCTION <name>` and slices between the
dollar-quote delimiters (`$function$` / `$$`) rather than to the next `;` —
function bodies contain semicolons. `--` comments are stripped first, so
commentary can neither satisfy nor break an assertion (the 00179 lesson, where
a doc comment tripped the snag-photo contract test).

Assertions, per function in the table of §2:

1. the final definition exists;
2. every `projects.project_members` reference is accompanied by an
   `is_active` predicate on that alias;
3. `user_has_project_access` and `user_effective_project_role` each require
   **both** `pm.is_active` and `uo.is_active` — pinning the §6 rule in both
   directions.

The test is proved by reverting one predicate and confirming it fails naming
the offending function.

---

## 10. Caveats to state in the PR

**Mobile revocation is eventually-consistent.** `custom_jwt_claims` runs at
token mint, so a live mobile session keeps its stale `project_ids` until refresh
(~1 h). The JWT claim *is* the sync gate — PowerSync classic sync rules cannot
express the join and do not re-check RLS. Immediate mobile cutoff needs a
separate session-revocation mechanism; out of scope, and stated rather than
implied away.

**No deactivation UI is added.** This change makes the flag mean what the app
already claims it means. Building the "deactivate member" affordance —
and deciding whether it should supersede `removeProjectMember`'s hard delete —
is separate work.

**`project_notification_recipients` is already correct** and needs no change; it
is listed in §2 only to show the divergence is a split, not a uniform omission.

---

## 11. Docs

`docs/rbac-matrix.md` gains an explicit statement under the role-resolution
section: both `projects.project_members.is_active` and
`public.user_organisations.is_active` revoke application **and** database
access, naming the six functions that enforce it and the mobile-token caveat.
