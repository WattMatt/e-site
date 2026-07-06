# Mobile Cross-Org Site Visibility (PowerSync) — Investigation & Design

**Date:** 2026-07-06
**Author:** Arno + Claude
**Trigger:** Documented follow-up from
`2026-07-06-invite-and-site-assignment-clarity.md` §3 —
"**Mobile** cross-org visibility … A cross-org shared project never reaches the
device. Fixing this needs sync-rule + JWT changes and is a separate,
PowerSync-verified change."
**Branch:** based on `feat/invite-and-site-clarity` (PR #119), so migration
`00155_cross_org_project_visibility.sql` (web RLS) is present. Merges **after**
PR #119.

## 0. Success criteria

- **A.** A cross-org sub-org contractor (e.g. Mike @ Bob's Building) assigned to
  another org's project via `project_members` sees that project in the mobile
  app — parity with the web behaviour that 00155 restored.
- **B.** The extra visibility can **never** exceed a real project membership, and
  is **revoked** when the sub-org membership is deactivated (bounded by token TTL).
- **C.** The shared site is **usable offline**: its snags, snag photos, floor
  plans, documents, and in-flight inspections/responses/photos sync too — not
  just the bare project card.
- **D.** Additive and backward-compatible: existing single-org users are
  unaffected; old access tokens degrade gracefully until refresh.

## 1. Full-system map (verified against source)

The mobile app is PowerSync-first: `useDb()` returns a **local** SQLite handle
once PowerSync has hydrated, else falls back to the **remote** Supabase client.
Two independent gates stop a cross-org project from ever appearing:

| # | Gate | File | Predicate |
|---|------|------|-----------|
| 1 | **Sync bucket** — what reaches the device | `supabase/powersync/sync-rules.yaml:8-15` (`org_projects`) | `WHERE organisation_id = bucket.org_id` |
| 2 | **JWT claim** — the value of `bucket.org_id` | `apps/edge-functions/supabase/migrations/00014_powersync_jwt_hook.sql:19-24` | `org_id` = the user's **first active** `user_organisations` row |
| 3 | **UI query** — what the hook selects | `apps/mobile/src/hooks/useProjects.ts:25,34,42` | `WHERE organisation_id = <first org>` (local & remote) |

The shared project's `organisation_id` is the **owning** org (WM); the
assignment lives in `project_members.organisation_id = subOrgId`
(`apps/web/src/actions/project-members-from-sub-org.actions.ts:127`). The
contractor is an active member only of the sub-org, so `bucket.org_id` (their
first org) never equals the owning org → gate 1 filters the row out before it
ever leaves the server; gate 3 would filter it again even if it arrived.

Credential path (confirmed): `apps/mobile/src/lib/powersync/connector.ts:12-29`
`fetchCredentials()` hands PowerSync the Supabase `session.access_token`, which
already carries the `org_id` claim from the `custom_jwt_claims` hook.
`request.user_id()` in sync rules therefore equals the Supabase `sub` /
`auth.uid()`.

## 2. Root cause

**Statement:** A cross-org contractor's assigned site never reaches the device
because **both** the PowerSync `org_projects` bucket and `useProjects` key on a
single owning-org id the contractor is not a member of, while the assignment
lives on `project_members.organisation_id = subOrgId`. Neither gate consults
`project_members`, so the row is filtered server-side (gate 1) and again
client-side (gate 3).

**Evidence (Z):** (Z1) `sync-rules.yaml:15` — `WHERE organisation_id =
bucket.org_id`; (Z2) `00014_powersync_jwt_hook.sql:19-24` — `org_id` = first
active org via `ORDER BY created_at ASC LIMIT 1`; (Z3) `useProjects.ts:25,42` —
`organisation_id = <first org>`; (Z4) `project-members-from-sub-org.actions.ts:127`
— sub-org insert writes `organisation_id = subOrgId`.

### Architecture-vs-symptom check

Design mismatch, not a code typo. The web fix (00155) restored parity by
OR-ing `public.user_has_project_access(project_id)` into the per-project SELECT
policies. Mobile has no equivalent path: its access model is expressed as a
single `org_id` bucket parameter, which structurally cannot represent
"projects I reach through a *different* org's membership". The correct fix adds
a second, project-scoped access path that mirrors `user_has_project_access`,
leaving the org path untouched (exactly parallel to 00155 being add-only).

## 3. The binding PowerSync constraint (verified against docs)

`user_has_project_access` (`00106_relax_user_has_project_access.sql`) grants
access iff:

- **(a)** an **active** `project_members` row for the user whose identity org
  the user is **actively** a member of
  (`project_members pm ⋈ user_organisations uo ON user_id, organisation_id`,
  `uo.is_active = TRUE`), **OR**
- **(b)** the user is an active `owner` / `admin` / `project_manager` in the
  project's **owning** org.

Revocation for cross-org contractors runs through clause (a)'s join:
`removeSubOrgMember` (`apps/web/src/actions/sub-org-members.actions.ts:332-335`)
**soft-deactivates `user_organisations.is_active = false`** and leaves
`project_members.is_active = true`. So the join to `user_organisations.is_active`
is what actually revokes access.

PowerSync **classic Sync Rules** (this repo's format — `bucket_definitions` +
`token_parameter`) support **single-table parameter queries only**: per the
docs, "`JOIN` … Supported in Sync Streams only. Not available in Sync Rules."
A live parameter query `SELECT project_id FROM project_members WHERE user_id =
request.user_id()` therefore **cannot** consult `user_organisations.is_active`
and would keep syncing a shared site to a **removed** contractor — a security
regression versus web.

**Conclusion:** the access set must be computed where the join is available —
the JWT hook (SECURITY DEFINER Postgres) — and handed to the sync rule as a
claim. PowerSync classic Sync Rules explicitly support expanding a JWT array
claim: `SELECT value AS project_id FROM json_each(request.jwt() -> 'project_ids')`.

**Trade-off (accepted):** the claim is a snapshot at token-issue time.
Revocation/addition propagates on the **next token refresh** (Supabase
access-token TTL, ~1h; PowerSync re-calls `fetchCredentials` on refresh). During
that window the device keeps already-synced local rows, but server-side RLS
(post-00155) already blocks fresh reads/writes. This is strictly safer than the
live-parameter-query alternative, which could never revoke on an
`is_active` flip.

## 4. Design

Three coordinated changes, each additive.

### 4.1 JWT hook — `00156_powersync_jwt_project_access.sql`

`CREATE OR REPLACE FUNCTION public.custom_jwt_claims` — the existing `org_id`
logic is unchanged; add a `project_ids` claim:

```sql
SELECT COALESCE(jsonb_agg(DISTINCT pm.project_id), '[]'::jsonb)
INTO   _project_ids
FROM   projects.project_members pm
JOIN   public.user_organisations uo
  ON   uo.user_id = pm.user_id
 AND   uo.organisation_id = pm.organisation_id
WHERE  pm.user_id = _user_id
  AND  uo.is_active = TRUE;

_claims := jsonb_set(_claims, '{project_ids}', _project_ids);  -- always set (defaults to [])
```

- Mirrors `user_has_project_access` **clause (a)** exactly — same tables, same
  join, same `uo.is_active` predicate. Deliberately does **not** add
  `pm.is_active` (00106 clause (a) doesn't), so mobile == web.
- Scoped to explicit memberships → the array stays small and bounded (a
  contractor is on a handful of projects). Clause (b) (own-org admin) continues
  to sync via the untouched `org_projects` bucket, so it is intentionally **not**
  duplicated into the claim (avoids JWT bloat for large-org admins).
- Always sets the claim (empty `[]` when the user has no memberships), so the
  sync rule's `json_each` degrades to zero rows rather than erroring.
- Schema-qualified (`projects.project_members`, `public.user_organisations`)
  because the hook runs with `SET search_path = public`.

### 4.2 Sync rules — additive `project_access` bucket

Added to `supabase/powersync/sync-rules.yaml`; all existing `org_*` buckets are
left **exactly** as-is (zero regression). One parameter, `project_id`, used by
every data query (PowerSync requires every bucket parameter be used in every
data query).

```yaml
  project_access:
    parameters: SELECT value AS project_id FROM json_each(request.jwt() -> 'project_ids')
    data:
      - SELECT id, name, status, city, province, organisation_id
          FROM projects WHERE id = bucket.project_id
      - SELECT id, title, description, status, priority,
               project_id, organisation_id, assigned_to, raised_by, created_at
          FROM snags WHERE project_id = bucket.project_id
      - SELECT sp.id, sp.snag_id, sp.file_path, sp.caption, sp.photo_type,
               sp.uploaded_by, sp.created_at
          FROM field.snag_photos sp JOIN snags s ON s.id = sp.snag_id
          WHERE s.project_id = bucket.project_id
      - SELECT id, project_id, organisation_id, name, level, file_path,
               file_size_bytes, width_px, height_px, scale, is_active,
               source_provider, source_file_id, source_revision_id,
               source_path, synced_at, uploaded_by, created_at, updated_at
          FROM tenants.floor_plans WHERE project_id = bucket.project_id
      - SELECT id, project_id, organisation_id, name, category,
               storage_path, mime_type, size_bytes,
               source_provider, source_file_id, source_revision_id,
               source_path, synced_at, uploaded_by, created_at, updated_at
          FROM tenants.documents WHERE project_id = bucket.project_id
      - SELECT *
          FROM inspections.inspections
          WHERE project_id = bucket.project_id
            AND status NOT IN ('certified','abandoned')
      - SELECT r.*
          FROM inspections.responses r
          JOIN inspections.inspections i ON i.id = r.inspection_id
          WHERE i.project_id = bucket.project_id
            AND i.status NOT IN ('certified','abandoned')
      - SELECT p.id, p.inspection_id, p.section_id, p.field_id,
               p.storage_path, p.caption, p.taken_at, p.gps_lat, p.gps_lng,
               p.uploaded_by, p.created_at
          FROM inspections.photos p
          JOIN inspections.inspections i ON i.id = p.inspection_id
          WHERE i.project_id = bucket.project_id
            AND i.status NOT IN ('certified','abandoned')
```

- Column lists and table qualifications are copied verbatim from the matching
  `org_*` buckets; **only the `WHERE` predicate changes** to `project_id`. Same
  single-output-table join shapes that already ship (`org_snag_photos`,
  `org_inspection_responses`, `org_inspection_photos_meta`) — no new PowerSync
  capability is relied upon.
- Rows dedupe by primary key across buckets, so a project that is both own-org
  (via `org_projects`) and explicitly-membered (via `project_access`) syncs once.
- The local client schema (`apps/mobile/src/lib/powersync/schema.ts`) is
  unchanged — the same tables/columns are already declared; this bucket only
  routes more **rows** into them.

**Documented follow-up (out of scope):** `inspections.templates` is org-level
(no `project_id`), so a cross-org contractor cannot reach the owning org's
templates by project scope — *rendering* an inspection form on a shared site
needs connectivity until a future template-by-project-access rule. All other
listed field data works offline.

**Documented follow-up (out of scope):** multi-org **own** membership — a user
active in two orgs still only syncs their *first* org via `org_projects` (JWT
`org_id` = first active org). This predates the bug and is unrelated to the
cross-org `project_members` path; noted for a later pass.

### 4.3 `useProjects.ts` + call sites

- **Hook:** remove the single-org hard filter. Local path →
  `SELECT * FROM projects ORDER BY name ASC` (the device DB is already exactly
  the allowed set: own-org via `org_projects` + shared via `project_access`).
  Remote path → `.select('*')` with **no** `.eq('organisation_id', …)`; RLS
  (post-00155) scopes the result. `orgIdOverride` is retained as an **optional**
  narrowing filter but is no longer required to `enable` the query, and the
  query no longer returns `[]` when it is absent.
- **`apps/mobile/app/(tabs)/projects.tsx`:** call `useProjects()` without forcing
  the first-org id, so shared sites appear in the project list.
- **`apps/mobile/app/(tabs)/snags.tsx`:** same — the snag project-picker now
  includes shared sites.

No change to the pervasive `user_organisations[0]` pattern elsewhere; those
screens key off a *selected* project, which now includes shared ones.

## 5. Verification (cross-org contractor scenario)

### 5.1 Automated — extend `packages/db/src/__tests__/sync/sync-rules.test.ts`

The existing suite uses "query Supabase as the user (RLS)" as the proxy for
"what PowerSync should sync". Add a `describe('cross-org project_members
visibility')` block (env-gated like the rest, skips without live Supabase):

1. **Setup (service role):** ensure an Org A project `P`; insert
   `project_members(project=P, user=contractorB, organisation_id=OrgB,
   is_active=true)`; ensure `user_organisations(contractorB, OrgB,
   is_active=true)`.
2. **Visible to member:** as contractor B, `projects.projects.select('id')`
   includes `P` (validates 00155 present, and equals the set the JWT hook must
   emit for B).
3. **Not visible to non-member:** a second Org B user with no membership on `P`
   does **not** see `P`.
4. **Revocation:** flip `user_organisations(contractorB, OrgB).is_active=false`;
   as contractor B, `P` disappears (matches what the JWT hook would omit on the
   next token issue).
5. **Cleanup:** delete seeded `project_members` / project / restore `is_active`.

### 5.2 Automated — JWT-hook claim

Unit/integration assertion that `public.custom_jwt_claims('{"user_id":
"<contractorB>", "claims": {}}')` returns `project_ids` containing `P`, and
returns `[]` for a user with no active memberships. (Run against the live DB via
the service role, alongside the sync-rules suite, or as a focused pgTAP-style
check — chosen in the plan.)

### 5.3 Manual on-device (gated by user, project protocol §7)

Contractor logs into mobile → shared site appears in the project list and the
snag project-picker → open it, view/create a snag, open a floor plan → remove
them from the sub-org on web → after a token refresh the site drops off the
device.

## 6. Deploy (nothing auto-deployed)

1. **Migration 00156** — additive `CREATE OR REPLACE`; deployed with the normal
   migration workflow. Safe to run before the app update (extra claim is inert
   until a sync rule reads it).
2. **`sync-rules.yaml`** — pasted into the PowerSync dashboard (manual, per the
   file header). Additive bucket; existing buckets unchanged.
3. **Mobile JS** — shipped in the app bundle.

All backward-compatible: tokens issued before 00156 lack `project_ids`;
`request.jwt() -> 'project_ids'` is then `null` and `json_each(null)` yields no
rows, so those users simply get no extra buckets until their token refreshes.

**Merge order:** PR #119 (00155) must land first — the online `useProjects` path
and the RLS-parity test depend on it. The JWT hook, sync rules, and offline
(local) path do not.

## 7. Assumptions

- "Sites" == "projects"; "contractors" arrive via sub-orgs (shadow orgs) — same
  as the parent spec.
- PowerSync classic Sync Rules (not Sync Streams) remain the deployment format;
  the new bucket uses only capabilities the existing rules already rely on
  (single-output-table joins, `json_each`, `request.jwt()`).
- Supabase access-token TTL governs the revocation window; no change to TTL is
  proposed for v1.
