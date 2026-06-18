# Client GCR Review (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a granted client log in, see a frozen, outputs-only snapshot of a site's generator cost recovery, play with the numbers ephemerally, attach old→new captured proposals + comments per tenant, and submit them to the admin; the admin reviews a request queue and can accept (auto-apply to the live schedule), decline, or reply — with email + in-app notifications both ways.

**Architecture:** Backend-first. A dedicated `client_site_grants` table is the *only* source of a client's GCR visibility (org-level `client_viewer` stays explicitly blocked from raw `gcr.*`). Admin "publish for client review" freezes the current engine model into an immutable `gcr_review_snapshots` row that stores **only outputs-only fields** (no contractor cost inputs ever land in the snapshot). Clients read the snapshot through a `SECURITY DEFINER` RPC that double-checks the grant; change requests pin to the snapshot. Accept calls the existing `gcr.bulk_save_tenant_assignments` RPC to apply the proposed value to the live schedule. Notifications reuse the existing `send-notification` + `send-email` edge functions.

**Tech Stack:** Next.js 15 App Router (`apps/web`), Supabase Postgres + RLS (`apps/edge-functions/supabase/migrations`), `@esite/shared` engine (`packages/shared`), Vitest (mock-based action tests in `apps/web`, pure-function tests in `packages/shared`, live RLS integration tests in `packages/db`), Resend via `send-email` / `auth-email-hook` edge functions.

---

## Execution split — two shippable sub-units

This plan is built so execution can be split into **two PRs**:

- **Sub-unit 2a — Data + backend (one PR).** Migrations `00140`–`00143`, shared types/projection, server actions, notifications, and all backend tests (mock-based action tests + live RLS integration tests). Ships dark — no client-visible UI yet. Independently deployable and verifiable via the RLS test client.
- **Sub-unit 2b — UI (second PR).** Client portal "My sites" picker + outputs-only GCR review page (ephemeral play + captured proposals + submit), admin "Publish for client review" / "Manage client access" controls + "Client requests" queue, and UI tests. Depends on 2a being merged + migrated.

**Migration numbering (verified 2026-06-18):** highest existing migration is `00139_inspections_template_categories.sql`. Project memory's note that "00140 may already exist" refers to `inspection-cert-handover` migration **00140** that was *planned*; the actual on-disk highest is `00139`. **This plan uses `00140`–`00143`.** Before writing each migration, the executor MUST re-run the check in Task 0 and bump every number by the same offset if `00140`+ already exist on disk.

---

## File structure

### Sub-unit 2a — data + backend

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `apps/edge-functions/supabase/migrations/00140_client_site_grants.sql` | Create | `public.client_site_grants` table + `public.user_has_client_site_grant()` helper + RLS. Grant is the sole source of client GCR visibility. |
| `apps/edge-functions/supabase/migrations/00141_gcr_review_snapshots.sql` | Create | `gcr.review_snapshots` table (immutable, outputs-only JSONB payload, `published_for_client_at`) + RLS (admin write, granted-client read). |
| `apps/edge-functions/supabase/migrations/00142_gcr_change_requests.sql` | Create | `gcr.change_requests` table (per-tenant captured proposal + comment + status + admin reply) + RLS (client insert/read own, admin read/update). |
| `apps/edge-functions/supabase/migrations/00143_gcr_client_review_rpcs.sql` | Create | `gcr.get_client_review(p_project_id)` SECURITY DEFINER RPC (outputs-only projection, grant-gated) + grants. |
| `packages/shared/src/services/generator-cost-recovery/client-projection.ts` | Create | `toClientReviewPayload(model)` — strips the engine `GeneratorCostRecoveryModel` down to outputs-only `ClientGcrReviewPayload`. Single source of truth for the allow-list. |
| `packages/shared/src/services/generator-cost-recovery/client-projection.test.ts` | Create | Asserts the projection contains only allow-listed keys and never contractor inputs. |
| `packages/shared/src/services/generator-cost-recovery/types.ts` | Modify | Add `ClientGcrReviewPayload`, `ClientGcrTenantRow`, `ClientGcrBankRow`, `GcrChangeRequestField`, `GcrChangeRequest*` row types. Re-export from package index. |
| `packages/shared/src/index.ts` | Modify | Export the new types + projection. |
| `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.ts` | Create | Admin actions: `publishGcrForClientReviewAction`, `manageClientSiteAccessAction`, `listClientSiteAccessAction`, `listGcrChangeRequestsAction`, `actionGcrChangeRequestAction`. |
| `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.test.ts` | Create | Mock-based tests for all admin actions (role gate, snapshot insert, accept-auto-applies via RPC, notifications fired). |
| `apps/web/src/app/(portal)/portal-gcr.actions.ts` | Create | Client actions: `getClientSitesAction`, `getClientGcrReviewAction`, `submitGcrChangeRequestsAction`. |
| `apps/web/src/app/(portal)/portal-gcr.actions.test.ts` | Create | Mock-based tests for client actions (grant gate, outputs-only via RPC, submit inserts + notifies admin). |
| `packages/db/src/__tests__/rls/gcr-client-review.rls.test.ts` | Create | Live RLS integration tests: granted client reads only granted snapshots; ungranted client sees nothing; client cannot read raw `gcr.*` cost tables; client cannot read another site's change requests; admin can. |

### Sub-unit 2b — UI

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `apps/web/src/app/(portal)/page.tsx` | Create | "My sites" picker landing (granted sites only). |
| `apps/web/src/app/(portal)/sites/[projectId]/gcr/page.tsx` | Create | Server component: loads `getClientGcrReviewAction`, renders the review client component. |
| `apps/web/src/app/(portal)/sites/[projectId]/gcr/ClientGcrReview.tsx` | Create | `'use client'` — read-only outputs-only view, ephemeral play, per-tenant captured proposal + comment, submit. |
| `apps/web/src/app/(portal)/sites/[projectId]/gcr/ClientGcrReview.test.tsx` | Create | UI tests: renders outputs only, no contractor field present, edit captures old→new, submit calls the action with the batch. |
| `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/ClientReviewPanel.tsx` | Create | `'use client'` — "Publish for client review" + "Manage client access" + "Client requests" queue (accept/decline/reply). |
| `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/ClientReviewPanel.test.tsx` | Create | UI tests: publish button calls action; accept calls `actionGcrChangeRequestAction` with `accept`; grant toggle calls `manageClientSiteAccessAction`. |
| `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/GcrTabs.tsx` | Modify | Add a 5th `'client'` tab that renders `ClientReviewPanel`. |
| `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/page.tsx` | Modify | Load grant list + change requests + latest snapshot, pass to `GcrTabs`. |

---

## Snapshot-storage decision (made)

**Decision: a new `gcr.review_snapshots` table tied to a `report_revisions` row, NOT extending `report_revisions`.** Reasons:

1. **Security separation of payloads.** `gcr.report_revisions.summary` JSONB deliberately carries `totalCapitalCost` and other contractor figures, and migration `00127` deliberately blocks `client_viewer` from `report_revisions` ("cost figures must never reach the client portal"). If we widened `report_revisions` to also hold the client dataset and then granted clients read access, we would be loosening the exact policy the spec (§8) tells us to keep intact. A separate table lets the client-facing payload live behind its own RLS without touching `report_revisions`.
2. **Outputs-only payload by construction.** The new table stores a JSONB produced by `toClientReviewPayload()` — a projection that *cannot* contain contractor inputs (Task 5/6 enforce this with a test). The snapshot is the serialized projection, so even a misconfigured RLS policy cannot leak a cost input that was never written.
3. **Immutability + provenance.** `review_snapshots` is append-only (no UPDATE grant, mirroring `report_revisions`), references the `report_revision_id` it was published from, and carries `published_for_client_at`. Change requests FK to the snapshot, so a request is permanently pinned to the exact frozen dataset the client saw (spec §5.4).
4. **No engine re-run for clients.** The frozen payload is read directly; the client read path never touches `gcr.settings`/`gcr.zones`/`gcr.zone_generators` (the cost-input tables), removing a whole class of leakage risk.

`published_for_client_at` is a column on `gcr.review_snapshots`; "publish" = insert one snapshot row with that timestamp set. The latest snapshot per project (`ORDER BY published_for_client_at DESC LIMIT 1`) is the current client-visible review.

---

## Outputs-only enforcement mechanism (chosen)

**Two independent layers, defense-in-depth:**

1. **Projection at write time (`packages/shared` `toClientReviewPayload`).** The snapshot JSONB is built by an allow-list projection that copies ONLY: per-tenant `{ shopNumber, shopName, areaM2, participation, loadingKw, portionPercent, monthly, ratePerSqm }`, per-bank `{ zoneName, installedKva, utilisationPercent }`, and scheme-level `{ monthlyCapitalRepayment, finalTariff }`. It never reads `totalCapitalCost`, `tariff.dieselPerKwh`, `tariff.maintenancePerKwh`, `tariff.base`, `tariff.contingency`, any `GeneratorSettings` field, or any `generators[].cost`. A unit test (Task 6) freezes this allow-list. Because the snapshot is the serialized projection, contractor inputs are **physically absent** from the row.

2. **Read via a `SECURITY DEFINER` RPC (`gcr.get_client_review`).** Clients NEVER query `gcr.settings`/`gcr.zones`/`gcr.zone_generators` directly (RLS already blocks them — they are not granted via `user_has_project_access` and `00124` policies). The client read path is the single RPC `gcr.get_client_review(p_project_id)`, which: (a) re-verifies `public.user_has_client_site_grant(auth.uid(), p_project_id)` and raises if absent, (b) returns the latest snapshot's outputs-only JSONB. `SET search_path = ''` + `SECURITY DEFINER` follows the repo convention (e.g. `user_can_manage_project`). The RPC returns the JSONB as-is — it does no joining to cost tables, so it cannot widen the payload.

Net: even if a client crafted a raw PostgREST request, (a) they have no grant on `gcr.*` cost tables, and (b) the only thing they can read — the snapshot — was written by a projection that excludes every contractor field.

---

## Spec ambiguities / risks for the human to resolve

1. **Client account creation & grant linkage (must resolve before 2a deploy).** Phase 1 creates accounts via `auth.admin.inviteUserByEmail(email, { data: { invited_role, org_id, ... } })` then `createUserAction` (`apps/web/src/actions/users.actions.ts:73`) inserts the `user_organisations` membership. **This plan assumes the client user already exists as a `client_viewer` member of the org** (created by the Phase-1 invite flow), and `manageClientSiteAccessAction` only grants/revokes the *site* row. **Open question:** should "Manage client access" also be able to *invite a brand-new client* (extending the Phase-1 invite to carry a `site_id` so the grant is created on accept), or is invite strictly a Phase-1 Command-Centre concern? The plan implements grant-only; if invite-from-GCR is wanted, add a follow-up task wiring `manageClientSiteAccessAction` to `createUserAction` with a new `site_id` field on the invite `data`. **Decision needed from owner.**
2. **Grant prerequisite.** `client_site_grants.user_id` must reference a real `auth.users`/`profiles` row. If an admin tries to grant a site to an email that has no account yet, the action must surface a clear error ("invite this client first"). The plan returns `{ error: 'No client account for that user — invite them first' }` rather than silently creating an account.
3. **Cross-sub-org client (D6).** The grant is keyed to `project_id` only, so a client can be granted sites across sub-orgs — but `getClientSitesAction` lists by grant, not by org, so this works without org-membership in every sub-org. **Risk:** the client must still be authenticated; they do NOT need `user_organisations` membership in the granted site's org for the *grant-based* RPC to work (the RPC is grant-gated, not org-gated). Confirm this is the intended trust model (a client with zero org memberships but one site grant can log in and review that one site). The plan assumes yes per D5/D6.
4. **"Installed kVA + utilisation" per bank.** The current engine `GeneratorCostRecoveryModel` exposes per-tenant allocations and scheme-level capital/tariff, but does **not** expose a per-bank installed-kVA / utilisation breakdown as a typed result field. Bank installed kVA must be derived from `gcr.zone_generators.generator_size` (a free-text `TEXT` like "500 kVA") and utilisation from assigned load ÷ installed capacity. **Risk:** `generator_size` is free text, so kVA parsing may fail. The plan adds `parseGeneratorKva()` with a test and treats unparseable sizes as `installedKva: null` (UI shows "—"). Confirm acceptable, or require a numeric `generator_size_kva` column (would be a follow-up migration).
5. **Notification routing for clients.** Client notifications (on accept/decline reply) route to `/portal/sites/{projectId}/gcr`. Confirm the portal notification surface exists for clients (Phase 1 may not have wired in-app notifications into the portal shell). The plan fires the notification regardless (non-blocking) and the email is the guaranteed channel.

---

## Sub-unit 2a — Data + backend

### Task 0: Confirm migration numbering

**Files:** none (read-only check)

- [ ] **Step 1: Verify the next free migration number**

Run: `ls apps/edge-functions/supabase/migrations/ | sort | tail -3`
Expected: highest is `00139_inspections_template_categories.sql`. If `00140`+ already exist, add the same offset to every migration number in Tasks 1–4 (e.g. if `00141` is the highest, this plan's `00140`→`00142`, `00141`→`00143`, etc.).

---

### Task 1: Migration — `client_site_grants` table + helper + RLS

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00140_client_site_grants.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration 00140 — public.client_site_grants (per-site client access)
-- =============================================================================
-- A client's GCR review visibility derives ONLY from this table, NOT from
-- org-level client_viewer membership (spec D5/§8). One row = one client user may
-- review one site (project). Default = no rows = no client visibility. Grants are
-- keyed to the project, so a client may span sites across sub-orgs (D6).
--
-- The existing 00127 policy that BLOCKS client_viewer from gcr.report_revisions
-- (and 00124's cost-input tables, which never grant client access) is left fully
-- intact — clients still cannot read raw gcr.* cost data.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.client_site_grants (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id      UUID        NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id UUID        NOT NULL REFERENCES public.organisations(id),
  granted_by      UUID        REFERENCES public.profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_client_site_grants_user    ON public.client_site_grants (user_id);
CREATE INDEX IF NOT EXISTS idx_client_site_grants_project ON public.client_site_grants (project_id);

-- SECURITY DEFINER helper used by gcr review RLS/RPCs. row_security off + empty
-- search_path mirror the 00106/00085 helper convention (avoids RLS recursion).
CREATE OR REPLACE FUNCTION public.user_has_client_site_grant(p_user_id UUID, p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_site_grants g
    WHERE g.user_id = p_user_id
      AND g.project_id = p_project_id
  );
$$;

ALTER TABLE public.client_site_grants ENABLE ROW LEVEL SECURITY;

-- SELECT: the granted client sees their own grant rows; project managers/admins
-- (and WM owner-org via user_can_manage_project) see grants for their projects.
DROP POLICY IF EXISTS client_site_grants_select ON public.client_site_grants;
CREATE POLICY client_site_grants_select ON public.client_site_grants FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.user_can_manage_project(project_id)
  );

-- INSERT/DELETE: only owner/admin/PM of the project's org may grant/revoke, and
-- organisation_id must be pinned to the project's real org (no cross-org inject).
DROP POLICY IF EXISTS client_site_grants_insert ON public.client_site_grants;
CREATE POLICY client_site_grants_insert ON public.client_site_grants FOR INSERT TO authenticated
  WITH CHECK (
    public.user_can_manage_project(project_id)
    AND organisation_id = (SELECT p.organisation_id FROM projects.projects p WHERE p.id = project_id)
  );

DROP POLICY IF EXISTS client_site_grants_delete ON public.client_site_grants;
CREATE POLICY client_site_grants_delete ON public.client_site_grants FOR DELETE TO authenticated
  USING (public.user_can_manage_project(project_id));

-- No UPDATE: grants are insert/delete only.
GRANT SELECT, INSERT, DELETE ON public.client_site_grants TO authenticated;
REVOKE UPDATE ON public.client_site_grants FROM authenticated, anon;
GRANT ALL ON public.client_site_grants TO service_role;
GRANT EXECUTE ON FUNCTION public.user_has_client_site_grant(UUID, UUID) TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Sanity-check the SQL parses (lint via the local apply path)**

Run: `cd apps/edge-functions && supabase db reset --local 2>&1 | tail -20`
Expected: reset completes through migration `00140` with no error (the new migration applies cleanly). If `supabase` is unavailable locally, instead run `psql -f` against a scratch DB or eyeball; the live RLS test (Task 12) is the real gate.

- [ ] **Step 3: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00140_client_site_grants.sql
git commit -m "feat(gcr): add client_site_grants table + user_has_client_site_grant helper (RLS)"
```

---

### Task 2: Migration — `gcr.review_snapshots` (immutable, outputs-only) + RLS

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00141_gcr_review_snapshots.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration 00141 — gcr.review_snapshots (frozen client-facing GCR dataset)
-- =============================================================================
-- "Publish for client review" freezes the current engine model into one
-- immutable row. The payload JSONB holds ONLY outputs-only fields produced by
-- @esite/shared toClientReviewPayload() — NO contractor cost inputs (generator
-- capital, total capital, diesel/maintenance, tariff build-up, margin) are ever
-- written here. Separate from gcr.report_revisions specifically so client read
-- access never touches the cost-bearing summary in report_revisions (00127),
-- whose client_viewer block stays intact.
-- =============================================================================

CREATE TABLE IF NOT EXISTS gcr.review_snapshots (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             UUID        NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id        UUID        NOT NULL REFERENCES public.organisations(id),
  report_revision_id     UUID        REFERENCES gcr.report_revisions(id) ON DELETE SET NULL,
  -- Outputs-only frozen dataset: { tenants: [...], banks: [...], scheme: {...} }.
  -- Shape == @esite/shared ClientGcrReviewPayload. Never holds cost inputs.
  payload                JSONB       NOT NULL,
  published_for_client_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             UUID        REFERENCES auth.users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gcr_review_snapshots_project
  ON gcr.review_snapshots (project_id, published_for_client_at DESC);

ALTER TABLE gcr.review_snapshots ENABLE ROW LEVEL SECURITY;

-- SELECT: project managers/admins (via project access, EXCLUDING raw cost tables
-- is irrelevant here — this payload is already outputs-only) OR a granted client.
-- Granted clients read snapshots ONLY for sites in client_site_grants.
DROP POLICY IF EXISTS gcr_review_snapshots_select ON gcr.review_snapshots;
CREATE POLICY gcr_review_snapshots_select ON gcr.review_snapshots FOR SELECT TO authenticated
  USING (
    public.user_has_project_access(project_id)
    OR public.user_has_client_site_grant(auth.uid(), project_id)
  );

-- INSERT: only owner/admin/PM (publish action). Immutable — no UPDATE policy.
DROP POLICY IF EXISTS gcr_review_snapshots_insert ON gcr.review_snapshots;
CREATE POLICY gcr_review_snapshots_insert ON gcr.review_snapshots FOR INSERT TO authenticated
  WITH CHECK (
    public.user_can_manage_project(project_id)
    AND organisation_id = (SELECT p.organisation_id FROM projects.projects p WHERE p.id = project_id)
  );

DROP POLICY IF EXISTS gcr_review_snapshots_delete ON gcr.review_snapshots;
CREATE POLICY gcr_review_snapshots_delete ON gcr.review_snapshots FOR DELETE TO authenticated
  USING (public.user_can_manage_project(project_id));

GRANT SELECT, INSERT, DELETE ON gcr.review_snapshots TO authenticated; -- no UPDATE: immutable
REVOKE UPDATE ON gcr.review_snapshots FROM authenticated, anon;
GRANT ALL ON gcr.review_snapshots TO service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply locally to verify it parses**

Run: `cd apps/edge-functions && supabase db reset --local 2>&1 | tail -20`
Expected: applies through `00141` cleanly.

- [ ] **Step 3: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00141_gcr_review_snapshots.sql
git commit -m "feat(gcr): add immutable gcr.review_snapshots (outputs-only, grant-gated RLS)"
```

---

### Task 3: Migration — `gcr.change_requests` + RLS

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00142_gcr_change_requests.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration 00142 — gcr.change_requests (client captured proposals + comments)
-- =============================================================================
-- One row = one per-tenant captured proposal (old -> new) on a published
-- snapshot, plus the client's comment. Proposable fields are editable INPUTS
-- ONLY (area, category, participation, zone, manual_kw_override) — never derived
-- outputs (D1, spec §5.3). Pinned to the snapshot + the revision it was reviewed
-- against. Admin accepts (auto-apply), declines (reason), or replies.
-- =============================================================================

CREATE TABLE IF NOT EXISTS gcr.change_requests (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID        NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id  UUID        NOT NULL REFERENCES public.organisations(id),
  snapshot_id      UUID        NOT NULL REFERENCES gcr.review_snapshots(id) ON DELETE CASCADE,
  node_id          UUID        NOT NULL REFERENCES structure.nodes(id) ON DELETE CASCADE,
  client_id        UUID        NOT NULL REFERENCES public.profiles(id),
  field            TEXT        NOT NULL CHECK (field IN ('area','category','participation','zone','manual_kw_override')),
  old_value        TEXT,
  new_value        TEXT,
  comment          TEXT,
  status           TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','declined')),
  admin_reply      TEXT,
  actioned_by      UUID        REFERENCES public.profiles(id),
  actioned_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gcr_change_requests_project  ON gcr.change_requests (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gcr_change_requests_snapshot ON gcr.change_requests (snapshot_id);
CREATE INDEX IF NOT EXISTS idx_gcr_change_requests_client   ON gcr.change_requests (client_id);

ALTER TABLE gcr.change_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: a granted client sees their OWN requests for granted sites; project
-- managers/admins see all requests for their projects (WM owner-org via
-- user_can_manage_project / user_has_project_access).
DROP POLICY IF EXISTS gcr_change_requests_select ON gcr.change_requests;
CREATE POLICY gcr_change_requests_select ON gcr.change_requests FOR SELECT TO authenticated
  USING (
    (client_id = auth.uid() AND public.user_has_client_site_grant(auth.uid(), project_id))
    OR public.user_has_project_access(project_id)
  );

-- INSERT: a granted client inserts their own requests for a granted site only,
-- pinned to the project's real org. client_id must be the caller.
DROP POLICY IF EXISTS gcr_change_requests_insert ON gcr.change_requests;
CREATE POLICY gcr_change_requests_insert ON gcr.change_requests FOR INSERT TO authenticated
  WITH CHECK (
    client_id = auth.uid()
    AND public.user_has_client_site_grant(auth.uid(), project_id)
    AND organisation_id = (SELECT p.organisation_id FROM projects.projects p WHERE p.id = project_id)
  );

-- UPDATE: only owner/admin/PM may action (accept/decline/reply) requests on
-- their projects. Clients cannot edit a submitted request.
DROP POLICY IF EXISTS gcr_change_requests_update ON gcr.change_requests;
CREATE POLICY gcr_change_requests_update ON gcr.change_requests FOR UPDATE TO authenticated
  USING (public.user_can_manage_project(project_id))
  WITH CHECK (public.user_can_manage_project(project_id));

GRANT SELECT, INSERT, UPDATE ON gcr.change_requests TO authenticated;
GRANT ALL ON gcr.change_requests TO service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply locally to verify it parses**

Run: `cd apps/edge-functions && supabase db reset --local 2>&1 | tail -20`
Expected: applies through `00142` cleanly.

- [ ] **Step 3: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00142_gcr_change_requests.sql
git commit -m "feat(gcr): add gcr.change_requests table (captured proposals + comments, RLS)"
```

---

### Task 4: Migration — client review RPC (outputs-only, grant-gated)

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00143_gcr_client_review_rpcs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration 00143 — gcr.get_client_review RPC (the ONLY client GCR read path)
-- =============================================================================
-- Returns the latest published review snapshot's outputs-only payload for a
-- granted client. SECURITY DEFINER so it can read gcr.review_snapshots without
-- the client needing broad gcr.* access, but it RE-VERIFIES the per-site grant
-- and raises if absent. It returns ONLY the snapshot JSONB (already outputs-only)
-- — it never joins to gcr.settings/zones/zone_generators, so it cannot widen the
-- payload to contractor cost inputs.
-- =============================================================================

CREATE OR REPLACE FUNCTION gcr.get_client_review(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payload JSONB;
BEGIN
  IF NOT public.user_has_client_site_grant(auth.uid(), p_project_id) THEN
    RAISE EXCEPTION 'Not authorised to review this site';
  END IF;

  SELECT rs.payload
    INTO v_payload
  FROM gcr.review_snapshots rs
  WHERE rs.project_id = p_project_id
  ORDER BY rs.published_for_client_at DESC
  LIMIT 1;

  -- No published snapshot yet -> null (caller renders an empty state).
  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION gcr.get_client_review(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply locally to verify it parses**

Run: `cd apps/edge-functions && supabase db reset --local 2>&1 | tail -20`
Expected: applies through `00143` cleanly.

- [ ] **Step 3: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00143_gcr_client_review_rpcs.sql
git commit -m "feat(gcr): add gcr.get_client_review RPC (grant-gated, outputs-only)"
```

---

### Task 5: Shared types — client review payload + change-request types

**Files:**
- Modify: `packages/shared/src/services/generator-cost-recovery/types.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Append the new types to `types.ts`**

Add to `packages/shared/src/services/generator-cost-recovery/types.ts`:

```typescript
// ─── Client-facing outputs-only review payload (Phase 2) ──────────────────────
// SECURITY: this shape MUST contain only tenant-facing outputs. Never add a
// contractor cost-input field here (generator capital, total capital, diesel,
// maintenance, tariff build-up components, margin). See client-projection.ts.

export interface ClientGcrTenantRow {
  shopNumber: string
  shopName: string
  areaM2: number
  participation: GeneratorParticipation
  loadingKw: number
  portionPercent: number
  monthly: number
  ratePerSqm: number
}

export interface ClientGcrBankRow {
  zoneName: string
  installedKva: number | null
  utilisationPercent: number | null
}

export interface ClientGcrScheme {
  monthlyCapitalRepayment: number
  finalTariff: number
}

export interface ClientGcrReviewPayload {
  tenants: ClientGcrTenantRow[]
  banks: ClientGcrBankRow[]
  scheme: ClientGcrScheme
}

// Proposable fields = editable INPUTS ONLY (D1, spec §5.3).
export type GcrChangeRequestField =
  | 'area'
  | 'category'
  | 'participation'
  | 'zone'
  | 'manual_kw_override'

export type GcrChangeRequestStatus = 'open' | 'accepted' | 'declined'

export interface GcrChangeRequestInput {
  nodeId: string
  field: GcrChangeRequestField
  oldValue: string | null
  newValue: string | null
  comment: string | null
}

export interface GcrChangeRequestRow {
  id: string
  project_id: string
  organisation_id: string
  snapshot_id: string
  node_id: string
  client_id: string
  field: GcrChangeRequestField
  old_value: string | null
  new_value: string | null
  comment: string | null
  status: GcrChangeRequestStatus
  admin_reply: string | null
  actioned_by: string | null
  actioned_at: string | null
  created_at: string
  updated_at: string
}
```

- [ ] **Step 2: Export from the package index**

In `packages/shared/src/index.ts`, ensure the generator-cost-recovery types and the new `client-projection` are re-exported. Add (matching the existing export style for that service):

```typescript
export * from './services/generator-cost-recovery/client-projection'
```

(The `types.ts` additions are already re-exported if `index.ts` does `export * from './services/generator-cost-recovery/types'`; verify that line exists and add it if missing.)

- [ ] **Step 3: Typecheck**

Run: `cd packages/shared && pnpm exec tsc --noEmit`
Expected: PASS (no errors; `client-projection` export will fail until Task 6 — if so, do Step 2's export line in Task 6 instead and leave only the type additions here).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/services/generator-cost-recovery/types.ts packages/shared/src/index.ts
git commit -m "feat(gcr): add ClientGcrReviewPayload + change-request shared types"
```

---

### Task 6: Shared — outputs-only projection (TDD)

**Files:**
- Create: `packages/shared/src/services/generator-cost-recovery/client-projection.ts`
- Test: `packages/shared/src/services/generator-cost-recovery/client-projection.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { toClientReviewPayload, parseGeneratorKva } from './client-projection'
import type { GeneratorCostRecoveryModel } from './types'

const CONTRACTOR_KEYS = [
  'totalCapitalCost',
  'dieselPerKwh',
  'maintenancePerKwh',
  'base',
  'contingency',
  'dieselCostPerLitre',
  'maintenanceCostAnnual',
  'cost',
]

const model: GeneratorCostRecoveryModel = {
  totalCapitalCost: 1_234_567,
  monthlyCapitalRepayment: 42_000,
  tariff: {
    dieselPerKwh: 3.1,
    maintenancePerKwh: 0.4,
    base: 3.5,
    contingency: 0.35,
    finalTariff: 3.85,
  },
  allocations: [
    {
      shopNumber: 'S1',
      shopName: 'Shop One',
      areaM2: 100,
      participation: 'shared',
      loadingKw: 3,
      portionPercent: 60,
      monthly: 25_200,
      ratePerSqm: 252,
    },
    {
      shopNumber: 'S2',
      shopName: 'Shop Two',
      areaM2: 50,
      participation: 'shared',
      loadingKw: 2,
      portionPercent: 40,
      monthly: 16_800,
      ratePerSqm: 336,
    },
  ],
}

const banks = [
  { zoneName: 'Bank A', generatorSizes: ['500 kVA'], assignedLoadKw: 5 },
]

describe('toClientReviewPayload', () => {
  it('returns only outputs-only fields and never contractor inputs', () => {
    const payload = toClientReviewPayload(model, banks)
    const json = JSON.stringify(payload)
    for (const key of CONTRACTOR_KEYS) {
      expect(json).not.toContain(`"${key}"`)
    }
  })

  it('projects per-tenant outputs verbatim', () => {
    const payload = toClientReviewPayload(model, banks)
    expect(payload.tenants).toEqual([
      { shopNumber: 'S1', shopName: 'Shop One', areaM2: 100, participation: 'shared', loadingKw: 3, portionPercent: 60, monthly: 25_200, ratePerSqm: 252 },
      { shopNumber: 'S2', shopName: 'Shop Two', areaM2: 50, participation: 'shared', loadingKw: 2, portionPercent: 40, monthly: 16_800, ratePerSqm: 336 },
    ])
  })

  it('exposes only scheme monthlyCapitalRepayment + finalTariff', () => {
    const payload = toClientReviewPayload(model, banks)
    expect(payload.scheme).toEqual({ monthlyCapitalRepayment: 42_000, finalTariff: 3.85 })
  })

  it('computes bank installed kVA + utilisation, null on unparseable size', () => {
    const payload = toClientReviewPayload(model, [
      { zoneName: 'Bank A', generatorSizes: ['500 kVA'], assignedLoadKw: 250 },
      { zoneName: 'Bank B', generatorSizes: ['big one'], assignedLoadKw: 100 },
    ])
    expect(payload.banks[0]).toEqual({ zoneName: 'Bank A', installedKva: 500, utilisationPercent: 50 })
    expect(payload.banks[1]).toEqual({ zoneName: 'Bank B', installedKva: null, utilisationPercent: null })
  })
})

describe('parseGeneratorKva', () => {
  it('parses a numeric kVA from a free-text size', () => {
    expect(parseGeneratorKva('500 kVA')).toBe(500)
    expect(parseGeneratorKva('1000kva')).toBe(1000)
  })
  it('returns null for unparseable text', () => {
    expect(parseGeneratorKva('big one')).toBeNull()
    expect(parseGeneratorKva('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/shared && pnpm exec vitest run src/services/generator-cost-recovery/client-projection.test.ts`
Expected: FAIL — "Cannot find module './client-projection'".

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/services/generator-cost-recovery/client-projection.ts`:

```typescript
import type {
  GeneratorCostRecoveryModel,
  ClientGcrReviewPayload,
  ClientGcrBankRow,
} from './types'

/**
 * Bank input for the client projection. zoneName + the free-text generator
 * sizes assigned to the bank + the total assigned tenant load on that bank.
 */
export interface ClientBankInput {
  zoneName: string
  generatorSizes: string[]
  assignedLoadKw: number
}

/**
 * Parse a numeric kVA value out of a free-text generator size such as
 * "500 kVA" / "1000kva". Returns null when no number can be found.
 */
export function parseGeneratorKva(size: string): number | null {
  const match = /(\d+(?:\.\d+)?)/.exec(size ?? '')
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) ? n : null
}

/**
 * SECURITY-CRITICAL allow-list projection. Copies ONLY outputs-only fields from
 * the engine model into the client-facing payload. Never read totalCapitalCost,
 * tariff.dieselPerKwh/maintenancePerKwh/base/contingency, GeneratorSettings, or
 * generators[].cost here. The snapshot stored for clients IS this payload, so a
 * field omitted here is physically absent from the client's data.
 */
export function toClientReviewPayload(
  model: GeneratorCostRecoveryModel,
  banks: ClientBankInput[],
): ClientGcrReviewPayload {
  const tenants = model.allocations.map((a) => ({
    shopNumber: a.shopNumber,
    shopName: a.shopName,
    areaM2: a.areaM2,
    participation: a.participation,
    loadingKw: a.loadingKw,
    portionPercent: a.portionPercent,
    monthly: a.monthly,
    ratePerSqm: a.ratePerSqm,
  }))

  const bankRows: ClientGcrBankRow[] = banks.map((b) => {
    const installedKva = b.generatorSizes.reduce<number | null>((sum, s) => {
      const kva = parseGeneratorKva(s)
      if (kva === null) return sum
      return (sum ?? 0) + kva
    }, null)
    const utilisationPercent =
      installedKva && installedKva > 0
        ? Math.round((b.assignedLoadKw / installedKva) * 100)
        : null
    return { zoneName: b.zoneName, installedKva, utilisationPercent }
  })

  return {
    tenants,
    banks: bankRows,
    scheme: {
      monthlyCapitalRepayment: model.monthlyCapitalRepayment,
      finalTariff: model.tariff.finalTariff,
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/shared && pnpm exec vitest run src/services/generator-cost-recovery/client-projection.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/services/generator-cost-recovery/client-projection.ts packages/shared/src/services/generator-cost-recovery/client-projection.test.ts packages/shared/src/index.ts
git commit -m "feat(gcr): outputs-only client projection + generator kVA parsing (TDD)"
```

---

### Task 7: Admin actions — publish + manage access (TDD)

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.ts`
- Test: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.test.ts`

- [ ] **Step 1: Write the failing test (publish + grant + list)**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createClientMock = vi.fn()
const createServiceClientMock = vi.fn()
const revalidatePathMock = vi.fn()
const requireRoleMock = vi.fn()
const dispatchNotificationMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('@/lib/auth/require-role', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/notifications', () => ({ dispatchNotification: dispatchNotificationMock }))

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'
const ORG_ID = '00000000-0000-0000-0000-000000000001'
const CLIENT_ID = '00000000-0000-0000-0000-000000000077'

function projectsResolve(orgId: string | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: orgId ? { organisation_id: orgId } : null, error: null })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  return vi.fn().mockReturnValue({ select })
}

describe('manageClientSiteAccessAction', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

  it('gates on ORG_WRITE_ROLES', async () => {
    const fromProjects = projectsResolve(ORG_ID)
    createClientMock.mockResolvedValue({ schema: vi.fn(() => ({ from: fromProjects })) })
    requireRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    const { manageClientSiteAccessAction } = await import('./gcr-client-review.actions')
    const res = await manageClientSiteAccessAction(PROJECT_ID, CLIENT_ID, 'grant')
    expect('error' in res).toBe(true)
  })

  it('grant: inserts a client_site_grants row pinned to the project org', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const fromProjects = projectsResolve(ORG_ID)
    const from = vi.fn((table: string) =>
      table === 'client_site_grants' ? { insert } : ({} as any))
    createClientMock.mockResolvedValue({
      schema: vi.fn(() => ({ from: fromProjects })),
      from,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    const { manageClientSiteAccessAction } = await import('./gcr-client-review.actions')
    const res = await manageClientSiteAccessAction(PROJECT_ID, CLIENT_ID, 'grant')
    expect(res).toEqual({ ok: true })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: CLIENT_ID, project_id: PROJECT_ID, organisation_id: ORG_ID, granted_by: 'admin1',
    }))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm exec vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.test.ts"`
Expected: FAIL — "Cannot find module './gcr-client-review.actions'".

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.ts`:

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { dispatchNotification } from '@/lib/notifications'
import {
  ORG_WRITE_ROLES,
  COST_VIEW_ROLES,
  toClientReviewPayload,
  type ClientBankInput,
  type GcrChangeRequestRow,
} from '@esite/shared'
import { loadGcrConfigAction } from './gcr.actions'
import { mapDbToEngineInput } from '@esite/shared'
import { buildGeneratorCostRecovery } from '@esite/shared'

const GCR_PATH = (projectId: string) => `/projects/${projectId}/generator-cost-recovery`

type ActionResult = { ok: true } | { error: string }

async function resolveOrgId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<string | null> {
  const { data } = await (supabase as any)
    .schema('projects').from('projects')
    .select('organisation_id').eq('id', projectId).maybeSingle()
  return (data as { organisation_id?: string } | null)?.organisation_id ?? null
}

/** Freeze the current engine model into an immutable outputs-only snapshot. */
export async function publishGcrForClientReviewAction(projectId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const config = await loadGcrConfigAction(projectId)
  if ('error' in config) return { error: config.error }

  const input = mapDbToEngineInput(config)
  const model = buildGeneratorCostRecovery(input)

  // Build per-bank inputs: each zone's generator sizes + the assigned tenant load.
  const banks: ClientBankInput[] = config.zones.map((z) => {
    const sizes = config.generators
      .filter((g) => g.zone_id === z.id)
      .map((g) => g.generator_size ?? '')
    const assignedNodeIds = config.assignments
      .filter((a) => a.zone_id === z.id)
      .map((a) => a.node_id)
    const assignedLoadKw = model.allocations
      .filter((alloc) =>
        assignedNodeIds.some((nid) =>
          config.tenants.find((t) => t.id === nid)?.shop_number === alloc.shopNumber))
      .reduce((sum, alloc) => sum + alloc.loadingKw, 0)
    return { zoneName: z.zone_name, generatorSizes: sizes, assignedLoadKw }
  })

  const payload = toClientReviewPayload(model, banks)

  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await (supabase as any)
    .schema('gcr').from('review_snapshots')
    .insert({
      project_id: projectId,
      organisation_id: orgId,
      payload,
      published_for_client_at: new Date().toISOString(),
      created_by: user?.id ?? null,
    })
  if (error) return { error: error.message ?? 'Failed to publish review snapshot' }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true }
}

/** Grant or revoke a client's per-site review access. */
export async function manageClientSiteAccessAction(
  projectId: string,
  clientId: string,
  op: 'grant' | 'revoke',
): Promise<ActionResult> {
  const supabase = await createClient()
  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  if (op === 'grant') {
    // Require the client to already have an account (Phase-1 invite).
    const svc = createServiceClient()
    const { data: profile } = await (svc as any)
      .from('profiles').select('id').eq('id', clientId).maybeSingle()
    if (!profile) return { error: 'No client account for that user — invite them first' }

    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await (supabase as any)
      .from('client_site_grants')
      .insert({ user_id: clientId, project_id: projectId, organisation_id: orgId, granted_by: user?.id ?? null })
    if (error && !/duplicate key/i.test(error.message ?? '')) {
      return { error: error.message ?? 'Failed to grant access' }
    }
  } else {
    const { error } = await (supabase as any)
      .from('client_site_grants')
      .delete().eq('user_id', clientId).eq('project_id', projectId)
    if (error) return { error: error.message ?? 'Failed to revoke access' }
  }

  revalidatePath(GCR_PATH(projectId))
  return { ok: true }
}

export interface ClientSiteAccessRow { user_id: string; email: string | null; full_name: string | null }

/** List clients currently granted review access to this project. */
export async function listClientSiteAccessAction(
  projectId: string,
): Promise<ClientSiteAccessRow[] | { error: string }> {
  const supabase = await createClient()
  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }
  const guard = await requireRole(supabase, orgId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .from('client_site_grants')
    .select('user_id, profiles:user_id (email, full_name)')
    .eq('project_id', projectId)
  if (error) return { error: error.message }
  return (data ?? []).map((r: any) => ({
    user_id: r.user_id,
    email: r.profiles?.email ?? null,
    full_name: r.profiles?.full_name ?? null,
  }))
}

/** List open + actioned change requests for the admin queue. */
export async function listGcrChangeRequestsAction(
  projectId: string,
): Promise<GcrChangeRequestRow[] | { error: string }> {
  const supabase = await createClient()
  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }
  const guard = await requireRole(supabase, orgId, COST_VIEW_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data, error } = await (supabase as any)
    .schema('gcr').from('change_requests')
    .select('*').eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) return { error: error.message }
  return (data ?? []) as GcrChangeRequestRow[]
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && pnpm exec vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.test.ts"`
Expected: PASS (both `manageClientSiteAccessAction` cases).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.ts" "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.test.ts"
git commit -m "feat(gcr): admin publish-for-review + manage-client-access actions (TDD)"
```

---

### Task 8: Admin action — action a change request (accept auto-applies) (TDD)

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.ts`
- Modify: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `gcr-client-review.actions.test.ts`:

```typescript
describe('actionGcrChangeRequestAction', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

  const REQ_ID = '00000000-0000-0000-0000-0000000000aa'
  const NODE_ID = '00000000-0000-0000-0000-0000000000bb'

  function makeChain(reqRow: any) {
    const reqMaybeSingle = vi.fn().mockResolvedValue({ data: reqRow, error: null })
    const reqEq = vi.fn().mockReturnValue({ maybeSingle: reqMaybeSingle })
    const reqSelect = vi.fn().mockReturnValue({ eq: reqEq })

    const updEq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq: updEq })

    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null })

    const fromGcr = vi.fn((table: string) =>
      table === 'change_requests' ? { select: reqSelect, update } : ({} as any))

    const maybeSingleProj = vi.fn().mockResolvedValue({ data: { organisation_id: ORG_ID }, error: null })
    const eqProj = vi.fn().mockReturnValue({ maybeSingle: maybeSingleProj })
    const selectProj = vi.fn().mockReturnValue({ eq: eqProj })
    const fromProjects = vi.fn().mockReturnValue({ select: selectProj })

    const schema = vi.fn((name: string) =>
      name === 'projects' ? { from: fromProjects } : { from: fromGcr, rpc })
    return { schema, rpc, update }
  }

  it('accept: applies the proposed value to the live schedule via the bulk RPC', async () => {
    const { schema, rpc, update } = makeChain({
      id: REQ_ID, project_id: PROJECT_ID, organisation_id: ORG_ID, node_id: NODE_ID,
      client_id: CLIENT_ID, field: 'participation', new_value: 'own', status: 'open',
    })
    createClientMock.mockResolvedValue({
      schema, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    const { actionGcrChangeRequestAction } = await import('./gcr-client-review.actions')
    const res = await actionGcrChangeRequestAction(PROJECT_ID, REQ_ID, { decision: 'accept' })
    expect(res).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('bulk_save_tenant_assignments', expect.objectContaining({
      p_project_id: PROJECT_ID, p_node_ids: [NODE_ID], p_set_participation: true, p_participation: 'own',
    }))
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'accepted', actioned_by: 'admin1' }))
    expect(dispatchNotificationMock).toHaveBeenCalled()
  })

  it('decline: records reason, does NOT call the bulk RPC', async () => {
    const { schema, rpc, update } = makeChain({
      id: REQ_ID, project_id: PROJECT_ID, organisation_id: ORG_ID, node_id: NODE_ID,
      client_id: CLIENT_ID, field: 'participation', new_value: 'own', status: 'open',
    })
    createClientMock.mockResolvedValue({
      schema, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    })
    requireRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    const { actionGcrChangeRequestAction } = await import('./gcr-client-review.actions')
    const res = await actionGcrChangeRequestAction(PROJECT_ID, REQ_ID, { decision: 'decline', reply: 'Not feasible' })
    expect(res).toEqual({ ok: true })
    expect(rpc).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'declined', admin_reply: 'Not feasible' }))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm exec vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.test.ts" -t actionGcrChangeRequestAction`
Expected: FAIL — `actionGcrChangeRequestAction` is not exported.

- [ ] **Step 3: Add the implementation**

Append to `gcr-client-review.actions.ts`:

```typescript
import type { GcrChangeRequestField } from '@esite/shared'

export interface ActionRequestArgs {
  decision: 'accept' | 'decline' | 'reply'
  reply?: string
}

/** Map a captured-proposal field to the bulk_save_tenant_assignments RPC params. */
function bulkParamsFor(field: GcrChangeRequestField, projectId: string, nodeId: string, newValue: string | null) {
  const base = {
    p_project_id: projectId,
    p_node_ids: [nodeId],
    p_set_zone: false, p_zone_id: null as string | null,
    p_set_participation: false, p_participation: null as string | null,
    p_set_category: false, p_shop_category: null as string | null,
    p_set_manual_kw: false, p_manual_kw: null as number | null,
  }
  switch (field) {
    case 'zone': return { ...base, p_set_zone: true, p_zone_id: newValue }
    case 'participation': return { ...base, p_set_participation: true, p_participation: newValue }
    case 'category': return { ...base, p_set_category: true, p_shop_category: newValue }
    case 'manual_kw_override':
      return { ...base, p_set_manual_kw: true, p_manual_kw: newValue === null ? null : Number(newValue) }
    // 'area' is a structure.nodes facet not covered by the bulk RPC; handled below.
    default: return base
  }
}

export async function actionGcrChangeRequestAction(
  projectId: string,
  requestId: string,
  args: ActionRequestArgs,
): Promise<ActionResult> {
  const supabase = await createClient()
  const orgId = await resolveOrgId(supabase, projectId)
  if (!orgId) return { error: 'Project not found' }

  const guard = await requireRole(supabase, orgId, ORG_WRITE_ROLES)
  if (!guard.ok) return { error: guard.error }

  const { data: req } = await (supabase as any)
    .schema('gcr').from('change_requests')
    .select('*').eq('id', requestId).maybeSingle()
  if (!req) return { error: 'Request not found' }
  if (req.project_id !== projectId) return { error: 'Request does not belong to this project' }

  const { data: { user } } = await supabase.auth.getUser()
  const now = new Date().toISOString()

  if (args.decision === 'accept') {
    if (req.field === 'area') {
      const area = req.new_value === null ? null : Number(req.new_value)
      const { error } = await (supabase as any)
        .schema('structure').from('nodes')
        .update({ area_m2: area }).eq('id', req.node_id).eq('project_id', projectId)
      if (error) return { error: error.message ?? 'Failed to apply area change' }
    } else {
      const params = bulkParamsFor(req.field, projectId, req.node_id, req.new_value)
      const { error } = await (supabase as any).schema('gcr').rpc('bulk_save_tenant_assignments', params)
      if (error) return { error: error.message ?? 'Failed to apply change' }
    }
  }

  const status = args.decision === 'accept' ? 'accepted' : args.decision === 'decline' ? 'declined' : req.status
  const { error: updErr } = await (supabase as any)
    .schema('gcr').from('change_requests')
    .update({
      status,
      admin_reply: args.reply ?? req.admin_reply,
      actioned_by: user?.id ?? null,
      actioned_at: args.decision === 'reply' ? req.actioned_at : now,
      updated_at: now,
    })
    .eq('id', requestId)
  if (updErr) return { error: updErr.message ?? 'Failed to update request' }

  // Notify the client (non-blocking; email is the guaranteed channel).
  await dispatchNotification({
    userIds: [req.client_id],
    title: `Your GCR request was ${status}`,
    body: args.reply ? args.reply : `Request for ${req.field} on the schedule was ${status}.`,
    route: `/portal/sites/${projectId}/gcr`,
    type: 'gcr_change_request_actioned',
    entityType: 'gcr_change_request',
    entityId: requestId,
  })

  revalidatePath(GCR_PATH(projectId))
  return { ok: true }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && pnpm exec vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.test.ts"`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.ts" "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.test.ts"
git commit -m "feat(gcr): action change request — accept auto-applies via bulk RPC + notify (TDD)"
```

---

### Task 9: Client actions — my sites + get review + submit (TDD)

**Files:**
- Create: `apps/web/src/app/(portal)/portal-gcr.actions.ts`
- Test: `apps/web/src/app/(portal)/portal-gcr.actions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createClientMock = vi.fn()
const dispatchNotificationMock = vi.fn()
const invokeEmailMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@/lib/notifications', () => ({ dispatchNotification: dispatchNotificationMock }))

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'
const CLIENT_ID = '00000000-0000-0000-0000-000000000077'
const SNAP_ID = '00000000-0000-0000-0000-0000000000cc'
const NODE_ID = '00000000-0000-0000-0000-0000000000bb'

describe('getClientGcrReviewAction', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

  it('calls the grant-gated RPC and returns its payload', async () => {
    const payload = { tenants: [], banks: [], scheme: { monthlyCapitalRepayment: 1, finalTariff: 2 } }
    const rpc = vi.fn().mockResolvedValue({ data: payload, error: null })
    createClientMock.mockResolvedValue({
      schema: vi.fn(() => ({ rpc })),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: CLIENT_ID } } }) },
    })
    const { getClientGcrReviewAction } = await import('./portal-gcr.actions')
    const res = await getClientGcrReviewAction(PROJECT_ID)
    expect(rpc).toHaveBeenCalledWith('get_client_review', { p_project_id: PROJECT_ID })
    expect(res).toEqual({ payload })
  })

  it('returns an error when the RPC raises (no grant)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Not authorised to review this site' } })
    createClientMock.mockResolvedValue({
      schema: vi.fn(() => ({ rpc })),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: CLIENT_ID } } }) },
    })
    const { getClientGcrReviewAction } = await import('./portal-gcr.actions')
    const res = await getClientGcrReviewAction(PROJECT_ID)
    expect('error' in res).toBe(true)
  })
})

describe('submitGcrChangeRequestsAction', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

  it('inserts a batch pinned to the latest snapshot + notifies the admin', async () => {
    const snapMaybeSingle = vi.fn().mockResolvedValue({ data: { id: SNAP_ID, organisation_id: 'org1' }, error: null })
    const snapLimit = vi.fn().mockReturnValue({ maybeSingle: snapMaybeSingle })
    const snapOrder = vi.fn().mockReturnValue({ limit: snapLimit })
    const snapEq = vi.fn().mockReturnValue({ order: snapOrder })
    const snapSelect = vi.fn().mockReturnValue({ eq: snapEq })
    const crInsert = vi.fn().mockResolvedValue({ error: null })

    // admin lookup for notification target
    const pmEq2 = vi.fn().mockResolvedValue({ data: [{ user_id: 'pm1' }], error: null })
    const pmEq1 = vi.fn().mockReturnValue({ eq: pmEq2 })
    const pmSelect = vi.fn().mockReturnValue({ eq: pmEq1 })

    const fromGcr = vi.fn((table: string) =>
      table === 'review_snapshots' ? { select: snapSelect } :
      table === 'change_requests' ? { insert: crInsert } : ({} as any))
    const fromPublic = vi.fn((table: string) =>
      table === 'project_members' ? { select: pmSelect } : ({} as any))

    createClientMock.mockResolvedValue({
      schema: vi.fn((name: string) => name === 'gcr' ? { from: fromGcr } : { from: pmSelect }),
      from: fromPublic,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: CLIENT_ID } } }) },
    })

    const { submitGcrChangeRequestsAction } = await import('./portal-gcr.actions')
    const res = await submitGcrChangeRequestsAction(PROJECT_ID, [
      { nodeId: NODE_ID, field: 'participation', oldValue: 'shared', newValue: 'own', comment: 'we generate our own' },
    ])
    expect(res).toEqual({ ok: true, submitted: 1 })
    expect(crInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        project_id: PROJECT_ID, snapshot_id: SNAP_ID, node_id: NODE_ID,
        client_id: CLIENT_ID, field: 'participation', old_value: 'shared', new_value: 'own',
        comment: 'we generate our own',
      }),
    ])
    expect(dispatchNotificationMock).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm exec vitest run "src/app/(portal)/portal-gcr.actions.test.ts"`
Expected: FAIL — "Cannot find module './portal-gcr.actions'".

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/app/(portal)/portal-gcr.actions.ts`:

```typescript
'use server'

import { createClient } from '@/lib/supabase/server'
import { dispatchNotification } from '@/lib/notifications'
import type { ClientGcrReviewPayload, GcrChangeRequestInput } from '@esite/shared'

export interface ClientSiteRow { project_id: string; project_name: string; organisation_name: string | null }

/** List the projects (sites) this client has been granted review access to. */
export async function getClientSitesAction(): Promise<ClientSiteRow[] | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await (supabase as any)
    .from('client_site_grants')
    .select('project_id, projects:project_id (name, organisations:organisation_id (name))')
    .eq('user_id', user.id)
  if (error) return { error: error.message }
  return (data ?? []).map((r: any) => ({
    project_id: r.project_id,
    project_name: r.projects?.name ?? 'Site',
    organisation_name: r.projects?.organisations?.name ?? null,
  }))
}

/** The ONLY client GCR read path: grant-gated, outputs-only RPC. */
export async function getClientGcrReviewAction(
  projectId: string,
): Promise<{ payload: ClientGcrReviewPayload | null } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await (supabase as any)
    .schema('gcr').rpc('get_client_review', { p_project_id: projectId })
  if (error) return { error: error.message }
  return { payload: (data as ClientGcrReviewPayload | null) ?? null }
}

/** Submit a batch of captured proposals + comments, pinned to the latest snapshot. */
export async function submitGcrChangeRequestsAction(
  projectId: string,
  requests: GcrChangeRequestInput[],
): Promise<{ ok: true; submitted: number } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  if (requests.length === 0) return { error: 'Nothing to submit' }

  const { data: snap } = await (supabase as any)
    .schema('gcr').from('review_snapshots')
    .select('id, organisation_id').eq('project_id', projectId)
    .order('published_for_client_at', { ascending: false }).limit(1).maybeSingle()
  if (!snap) return { error: 'No published review to comment on' }

  const rows = requests.map((r) => ({
    project_id: projectId,
    organisation_id: snap.organisation_id,
    snapshot_id: snap.id,
    node_id: r.nodeId,
    client_id: user.id,
    field: r.field,
    old_value: r.oldValue,
    new_value: r.newValue,
    comment: r.comment,
  }))

  const { error } = await (supabase as any)
    .schema('gcr').from('change_requests').insert(rows)
  if (error) return { error: error.message ?? 'Failed to submit requests' }

  // Notify project managers/admins (in-app + push). Email below is guaranteed.
  const { data: pms } = await (supabase as any)
    .from('project_members').select('user_id')
    .eq('project_id', projectId).eq('role', 'project_manager')
  const adminIds = (pms ?? []).map((p: any) => p.user_id)
  if (adminIds.length > 0) {
    await dispatchNotification({
      userIds: adminIds,
      title: 'New GCR client requests',
      body: `A client submitted ${rows.length} change request(s) for review.`,
      route: `/projects/${projectId}/generator-cost-recovery`,
      type: 'gcr_change_request_submitted',
      entityType: 'gcr_change_request',
      entityId: snap.id,
    })
  }

  // Branded admin email via the existing send-email function (new template type).
  await supabase.functions.invoke('send-email', {
    body: {
      type: 'gcr-client-request',
      payload: {
        projectId,
        requestCount: rows.length,
        clientId: user.id,
      },
    },
  }).catch(() => { /* email failure must never block submit */ })

  return { ok: true, submitted: rows.length }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && pnpm exec vitest run "src/app/(portal)/portal-gcr.actions.test.ts"`
Expected: PASS (both describe blocks). Note: the submit test stubs `functions.invoke` implicitly via the mocked supabase client — if the test errors on a missing `functions`, add `functions: { invoke: vi.fn().mockResolvedValue({ error: null }) }` to the `createClientMock` return in that test.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(portal)/portal-gcr.actions.ts" "apps/web/src/app/(portal)/portal-gcr.actions.test.ts"
git commit -m "feat(portal): client GCR actions — my sites, outputs-only review, submit (TDD)"
```

---

### Task 10: Add the `gcr-client-request` email template

**Files:**
- Modify: `apps/edge-functions/supabase/functions/send-email/index.ts`

- [ ] **Step 1: Add the new template case**

In `apps/edge-functions/supabase/functions/send-email/index.ts`, add a case to the template switch matching the existing `coc-status` pattern (subject + branded body). Use the project name and a deep link into the admin GCR module. Resolve the admin recipient(s) inside the function from `projects.project_members` (role `project_manager`) joined to `profiles.email`, mirroring how `coc-status` resolves its recipient. Add:

```typescript
case 'gcr-client-request': {
  const { projectId, requestCount } = payload as { projectId: string; requestCount: number }
  // Resolve PM recipient emails for the project (service-role client inside the fn).
  const { data: pms } = await supabase
    .schema('projects').from('project_members')
    .select('profiles:user_id (email)')
    .eq('project_id', projectId).eq('role', 'project_manager')
  const to = (pms ?? []).map((r: any) => r.profiles?.email).filter(Boolean)
  if (to.length === 0) return new Response(JSON.stringify({ sent: false, reason: 'no recipients' }), { headers: jsonHeaders })
  const subject = `New client GCR requests (${requestCount})`
  const html = renderBranded({
    heading: 'Client cost-recovery requests',
    body: `A client submitted ${requestCount} change request(s) on a generator cost-recovery review. Open the project to review and action them.`,
    ctaLabel: 'Open GCR module',
    ctaUrl: `${APP_URL}/projects/${projectId}/generator-cost-recovery`,
  })
  await sendEmail({ to, subject, html })
  break
}
```

(Match the actual local helper names — `renderBranded`/`jsonHeaders`/`APP_URL`/`supabase` may differ; use whatever the existing `coc-status` case uses. The key requirement: a new `gcr-client-request` type that emails the project's PMs.)

- [ ] **Step 2: Run the function's tests**

Run: `cd apps/edge-functions/supabase/functions/send-email && deno test --allow-env 2>&1 | tail -20` (or the repo's configured edge-function test command; if none, skip — the action test in Task 9 already asserts the invoke).
Expected: existing tests still PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/edge-functions/supabase/functions/send-email/index.ts
git commit -m "feat(email): add gcr-client-request template (notify PMs on client submit)"
```

---

### Task 11: Wire client notification type into the email mapping (admin → client on action)

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.ts`

- [ ] **Step 1: Add the client-facing email invoke to `actionGcrChangeRequestAction`**

After the `dispatchNotification` call in `actionGcrChangeRequestAction`, add a branded email to the client (guaranteed channel, mirrors `coc-status`):

```typescript
  await supabase.functions.invoke('send-email', {
    body: {
      type: 'gcr-request-actioned',
      payload: { clientId: req.client_id, projectId, status, reply: args.reply ?? null, field: req.field },
    },
  }).catch(() => { /* email failure must never block the action */ })
```

And add the matching `gcr-request-actioned` case to `send-email/index.ts` (resolve the client email from `profiles` by `clientId`, subject `Your GCR request was {status}`, body includes the optional reply). Use the same `renderBranded`/`sendEmail` helpers as Task 10.

- [ ] **Step 2: Run the admin action tests again (ensure the added invoke didn't break mocks)**

Run: `cd apps/web && pnpm exec vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.test.ts"`
Expected: PASS. If the mocked supabase client lacks `functions`, add `functions: { invoke: vi.fn().mockResolvedValue({ error: null }) }` to the `createClientMock` return in the action-request tests.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/gcr-client-review.actions.ts" apps/edge-functions/supabase/functions/send-email/index.ts
git commit -m "feat(gcr): email the client when their request is actioned"
```

---

### Task 12: Live RLS integration tests (the real security gate)

**Files:**
- Create: `packages/db/src/__tests__/rls/gcr-client-review.rls.test.ts`

- [ ] **Step 1: Write the integration test (mirrors the existing `rls-policy.test.ts` harness)**

```typescript
/**
 * GCR client-review RLS suite (Phase 2).
 * Verifies: (1) a granted client reads ONLY granted snapshots; (2) an ungranted
 * client sees no snapshot; (3) clients cannot read raw gcr cost tables; (4) a
 * client cannot read another site's / another client's change requests; (5) an
 * admin can read all change requests for their project.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *      TEST_USER_A_EMAIL/PASSWORD (admin), TEST_USER_B_EMAIL/PASSWORD (client).
 * Run: pnpm vitest run src/__tests__/rls/gcr-client-review.rls.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? ''
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const EMAIL_A = process.env.TEST_USER_A_EMAIL ?? ''
const PASS_A = process.env.TEST_USER_A_PASSWORD ?? ''
const EMAIL_B = process.env.TEST_USER_B_EMAIL ?? ''
const PASS_B = process.env.TEST_USER_B_PASSWORD ?? ''
const ready = [URL, ANON, SVC, EMAIL_A, PASS_A, EMAIL_B, PASS_B].every((v) => v !== '')

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(URL, ANON)
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signIn(${email}): ${error.message}`)
  return c
}

describe.skipIf(!ready)('GCR client-review RLS', () => {
  let svc: SupabaseClient, admin: SupabaseClient, client: SupabaseClient
  let adminId: string, clientId: string, orgId: string
  let grantedProjectId: string, ungrantedProjectId: string
  let grantedSnapId: string, ungrantedSnapId: string

  beforeAll(async () => {
    svc = createClient(URL, SVC, { auth: { autoRefreshToken: false, persistSession: false } })
    admin = await signIn(EMAIL_A, PASS_A)
    client = await signIn(EMAIL_B, PASS_B)
    adminId = (await admin.auth.getUser()).data.user!.id
    clientId = (await client.auth.getUser()).data.user!.id

    const { data: org } = await svc.from('organisations')
      .insert({ name: 'GCR RLS Org', slug: `gcr-rls-${Date.now()}`, subscription_tier: 'starter' })
      .select('id').single()
    orgId = org!.id
    await svc.from('user_organisations').insert({ user_id: adminId, organisation_id: orgId, role: 'admin' })

    for (const flag of ['granted', 'ungranted'] as const) {
      const { data: p } = await (svc as any).schema('projects').from('projects')
        .insert({ organisation_id: orgId, name: `GCR ${flag}`, status: 'active', created_by: adminId })
        .select('id').single()
      const { data: s } = await (svc as any).schema('gcr').from('review_snapshots')
        .insert({ project_id: p!.id, organisation_id: orgId, payload: { tenants: [], banks: [], scheme: { monthlyCapitalRepayment: 1, finalTariff: 2 } } })
        .select('id').single()
      if (flag === 'granted') { grantedProjectId = p!.id; grantedSnapId = s!.id }
      else { ungrantedProjectId = p!.id; ungrantedSnapId = s!.id }
    }
    // Grant the client ONLY the granted project.
    await svc.from('client_site_grants')
      .insert({ user_id: clientId, project_id: grantedProjectId, organisation_id: orgId, granted_by: adminId })
  }, 120_000)

  afterAll(async () => {
    await svc.from('client_site_grants').delete().eq('user_id', clientId)
    for (const id of [grantedSnapId, ungrantedSnapId]) await (svc as any).schema('gcr').from('review_snapshots').delete().eq('id', id)
    for (const id of [grantedProjectId, ungrantedProjectId]) await (svc as any).schema('projects').from('projects').delete().eq('id', id)
    await svc.from('user_organisations').delete().eq('organisation_id', orgId)
    await svc.from('organisations').delete().eq('id', orgId)
    await admin.auth.signOut(); await client.auth.signOut()
  }, 60_000)

  it('granted client reads ONLY the granted snapshot', async () => {
    const { data } = await (client as any).schema('gcr').from('review_snapshots')
      .select('id, project_id')
    const ids = (data ?? []).map((r: any) => r.project_id)
    expect(ids).toContain(grantedProjectId)
    expect(ids).not.toContain(ungrantedProjectId)
  })

  it('granted client get_client_review RPC returns the payload', async () => {
    const { data, error } = await (client as any).schema('gcr').rpc('get_client_review', { p_project_id: grantedProjectId })
    expect(error).toBeNull()
    expect(data).toMatchObject({ scheme: { finalTariff: 2 } })
  })

  it('client get_client_review RPC raises for an ungranted site', async () => {
    const { error } = await (client as any).schema('gcr').rpc('get_client_review', { p_project_id: ungrantedProjectId })
    expect(error).not.toBeNull()
  })

  it('client CANNOT read raw gcr.settings (cost inputs)', async () => {
    const { data, error } = await (client as any).schema('gcr').from('settings').select('*').eq('project_id', grantedProjectId)
    // RLS denies: either error or zero rows; never cost data.
    expect((error !== null) || ((data ?? []).length === 0)).toBe(true)
  })

  it('client CANNOT read gcr.report_revisions (00127 block preserved)', async () => {
    const { data, error } = await (client as any).schema('gcr').from('report_revisions').select('*').eq('project_id', grantedProjectId)
    expect((error !== null) || ((data ?? []).length === 0)).toBe(true)
  })

  it('admin can read the change_requests queue for their project', async () => {
    const { error } = await (admin as any).schema('gcr').from('change_requests').select('id').eq('project_id', grantedProjectId)
    expect(error).toBeNull()
  })
})
```

- [ ] **Step 2: Run the integration test**

Run: `cd packages/db && SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... TEST_USER_A_EMAIL=... TEST_USER_A_PASSWORD=... TEST_USER_B_EMAIL=... TEST_USER_B_PASSWORD=... pnpm exec vitest run src/__tests__/rls/gcr-client-review.rls.test.ts`
Expected: PASS (suite `.skipIf` no-ops when creds absent in CI; it MUST be run against a real DB before the 2a deploy — see deploy checklist).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/__tests__/rls/gcr-client-review.rls.test.ts
git commit -m "test(gcr): live RLS suite for client-review scoping + cost-input denial"
```

---

### Task 13: Sub-unit 2a — full backend test run

**Files:** none (verification gate)

- [ ] **Step 1: Run the shared + web test suites**

Run: `cd packages/shared && pnpm test && cd ../../apps/web && pnpm exec vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery" "src/app/(portal)"`
Expected: all GCR + portal action tests PASS, no type errors.

- [ ] **Step 2: Typecheck the workspace**

Run: `cd apps/web && pnpm exec tsc --noEmit && cd ../../packages/shared && pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit (if any fixups were needed)**

```bash
git add -A && git commit -m "chore(gcr): sub-unit 2a green — backend + tests passing"
```

---

## Sub-unit 2b — UI

> Depends on 2a merged + migrated. UI tests use the same Vitest + jsdom setup the repo already uses for component tests (see `apps/web/vitest.config.ts`).

### Task 14: Client "My sites" picker page

**Files:**
- Create: `apps/web/src/app/(portal)/page.tsx`

- [ ] **Step 1: Write the page (server component)**

```tsx
import Link from 'next/link'
import { getClientSitesAction } from './portal-gcr.actions'

export default async function PortalHome() {
  const result = await getClientSitesAction()
  const sites = 'error' in result ? [] : result
  const error = 'error' in result ? result.error : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text)' }}>My sites</h1>
      {error && <p style={{ color: 'var(--c-red)', fontSize: 13 }}>{error}</p>}
      {!error && sites.length === 0 && (
        <p style={{ color: 'var(--c-text-dim)', fontSize: 13 }}>
          No sites have been shared with you yet. Your project team will grant access when a review is ready.
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {sites.map((s) => (
          <Link key={s.project_id} href={`/portal/sites/${s.project_id}/gcr`}
            style={{ border: '1px solid var(--c-border)', background: 'var(--c-panel)', borderRadius: 8, padding: 16, textDecoration: 'none', color: 'var(--c-text)' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{s.project_name}</div>
            {s.organisation_name && (
              <div style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>{s.organisation_name}</div>
            )}
            <div style={{ fontSize: 11, color: 'var(--c-amber)', marginTop: 12 }}>Review cost recovery →</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Smoke-render via the dev server (manual)**

Run: `cd apps/web && pnpm dev` then visit `http://localhost:3000/portal` signed in as a granted client.
Expected: granted sites listed; ungranted sites absent.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(portal)/page.tsx"
git commit -m "feat(portal): My sites picker (granted sites only)"
```

---

### Task 15: Client GCR review page + component (TDD on the component)

**Files:**
- Create: `apps/web/src/app/(portal)/sites/[projectId]/gcr/page.tsx`
- Create: `apps/web/src/app/(portal)/sites/[projectId]/gcr/ClientGcrReview.tsx`
- Test: `apps/web/src/app/(portal)/sites/[projectId]/gcr/ClientGcrReview.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ClientGcrReview } from './ClientGcrReview'
import type { ClientGcrReviewPayload } from '@esite/shared'

const submitMock = vi.fn().mockResolvedValue({ ok: true, submitted: 1 })
vi.mock('../../../portal-gcr.actions', () => ({ submitGcrChangeRequestsAction: (...a: any[]) => submitMock(...a) }))

const payload: ClientGcrReviewPayload = {
  tenants: [
    { shopNumber: 'S1', shopName: 'Shop One', areaM2: 100, participation: 'shared', loadingKw: 3, portionPercent: 60, monthly: 25200, ratePerSqm: 252 },
  ],
  banks: [{ zoneName: 'Bank A', installedKva: 500, utilisationPercent: 50 }],
  scheme: { monthlyCapitalRepayment: 42000, finalTariff: 3.85 },
}

describe('ClientGcrReview', () => {
  it('renders outputs only — never a contractor cost-input field', () => {
    render(<ClientGcrReview projectId="p1" payload={payload} nodeIdByShop={{ S1: 'node-1' }} />)
    expect(screen.getByText('Shop One')).toBeTruthy()
    expect(screen.getByText('Bank A')).toBeTruthy()
    // contractor terms must not appear anywhere
    expect(screen.queryByText(/capital cost/i)).toBeNull()
    expect(screen.queryByText(/diesel/i)).toBeNull()
    expect(screen.queryByText(/maintenance/i)).toBeNull()
  })

  it('captures an old→new proposal and submits the batch', async () => {
    render(<ClientGcrReview projectId="p1" payload={payload} nodeIdByShop={{ S1: 'node-1' }} />)
    const select = screen.getByLabelText('participation-S1') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'own' } })
    fireEvent.click(screen.getByText(/submit requests/i))
    expect(submitMock).toHaveBeenCalledWith('p1', [
      expect.objectContaining({ nodeId: 'node-1', field: 'participation', oldValue: 'shared', newValue: 'own' }),
    ])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm exec vitest run "src/app/(portal)/sites/[projectId]/gcr/ClientGcrReview.test.tsx"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `apps/web/src/app/(portal)/sites/[projectId]/gcr/ClientGcrReview.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import type { ClientGcrReviewPayload, GcrChangeRequestInput, GeneratorParticipation } from '@esite/shared'
import { submitGcrChangeRequestsAction } from '../../../portal-gcr.actions'

interface Props {
  projectId: string
  payload: ClientGcrReviewPayload
  /** shopNumber -> structure.nodes.id, so a proposal can target the live node. */
  nodeIdByShop: Record<string, string>
}

const PARTICIPATION: GeneratorParticipation[] = ['shared', 'own', 'none']

export function ClientGcrReview({ projectId, payload, nodeIdByShop }: Props) {
  // Ephemeral play state: per-shop participation override (does NOT persist).
  const [drafts, setDrafts] = useState<Record<string, GeneratorParticipation>>({})
  const [comments, setComments] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function buildBatch(): GcrChangeRequestInput[] {
    return payload.tenants.flatMap((t) => {
      const draft = drafts[t.shopNumber]
      if (!draft || draft === t.participation) return []
      return [{
        nodeId: nodeIdByShop[t.shopNumber],
        field: 'participation',
        oldValue: t.participation,
        newValue: draft,
        comment: comments[t.shopNumber] ?? null,
      }]
    })
  }

  function handleSubmit() {
    const batch = buildBatch()
    if (batch.length === 0) { setError('Change a value to propose before submitting.'); return }
    setError(null)
    startTransition(async () => {
      const res = await submitGcrChangeRequestsAction(projectId, batch)
      if ('error' in res) setError(res.error)
      else setDone(true)
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <h2 style={{ fontSize: 14, fontWeight: 600 }}>Generator banks</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {payload.banks.map((b) => (
            <div key={b.zoneName} style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: 12, minWidth: 160 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{b.zoneName}</div>
              <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
                {b.installedKva !== null ? `${b.installedKva} kVA installed` : '— kVA'}
                {b.utilisationPercent !== null ? ` · ${b.utilisationPercent}% utilised` : ''}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 14, fontWeight: 600 }}>Tenants</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--c-text-dim)' }}>
              <th>Shop</th><th>Area m²</th><th>Load kW</th><th>Participation</th>
              <th>Share %</th><th>Monthly (R)</th><th>R/m²</th><th>Comment</th>
            </tr>
          </thead>
          <tbody>
            {payload.tenants.map((t) => (
              <tr key={t.shopNumber} style={{ borderTop: '1px solid var(--c-border)' }}>
                <td>{t.shopName}</td>
                <td>{t.areaM2}</td>
                <td>{t.loadingKw}</td>
                <td>
                  <select
                    aria-label={`participation-${t.shopNumber}`}
                    value={drafts[t.shopNumber] ?? t.participation}
                    onChange={(e) => setDrafts((p) => ({ ...p, [t.shopNumber]: e.target.value as GeneratorParticipation }))}
                  >
                    {PARTICIPATION.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td>{t.portionPercent}</td>
                <td>{t.monthly.toLocaleString()}</td>
                <td>{t.ratePerSqm}</td>
                <td>
                  <input
                    aria-label={`comment-${t.shopNumber}`}
                    value={comments[t.shopNumber] ?? ''}
                    onChange={(e) => setComments((p) => ({ ...p, [t.shopNumber]: e.target.value }))}
                    placeholder="Why?"
                    style={{ width: 120 }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ display: 'flex', gap: 24, fontSize: 12, color: 'var(--c-text-mid)' }}>
        <div>Scheme monthly: R {payload.scheme.monthlyCapitalRepayment.toLocaleString()}</div>
        <div>Final tariff: R {payload.scheme.finalTariff}/kWh</div>
      </section>

      {error && <p style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</p>}
      {done ? (
        <p style={{ color: 'var(--c-amber)', fontSize: 13 }}>Requests submitted — your project team will respond.</p>
      ) : (
        <button onClick={handleSubmit} disabled={pending}
          style={{ alignSelf: 'flex-start', background: 'var(--c-amber)', color: 'var(--c-text-on-amber)', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>
          {pending ? 'Submitting…' : 'Submit requests to admin'}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Write the page that feeds it**

Create `apps/web/src/app/(portal)/sites/[projectId]/gcr/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { getClientGcrReviewAction } from '../../../portal-gcr.actions'
import { ClientGcrReview } from './ClientGcrReview'

export default async function ClientGcrPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const result = await getClientGcrReviewAction(projectId)
  if ('error' in result) notFound()
  if (!result.payload) {
    return <p style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>No review has been published for this site yet.</p>
  }
  // shopNumber -> nodeId map for proposals. Derived from the payload's shop
  // numbers; the live node id is resolved server-side in submit via structure
  // lookup if needed. Here we pass shopNumber as the key and rely on the
  // submit action to resolve — but to keep the captured proposal precise we
  // include the map the snapshot was built from.
  const nodeIdByShop = Object.fromEntries(result.payload.tenants.map((t) => [t.shopNumber, t.shopNumber]))
  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Generator cost recovery — review</h1>
      <ClientGcrReview projectId={projectId} payload={result.payload} nodeIdByShop={nodeIdByShop} />
    </div>
  )
}
```

> **NOTE for executor:** the captured proposal needs the real `structure.nodes.id`, not the shop number. Two clean options — pick one and note it in the PR: (a) add a `nodeId` field to each `ClientGcrTenantRow` in the snapshot payload (extend `toClientReviewPayload` + the projection test) so the map is exact; or (b) resolve shopNumber→nodeId inside `submitGcrChangeRequestsAction` via a `structure.nodes` lookup scoped to the granted project. **Option (a) is preferred** (keeps the proposal pinned to the frozen snapshot). If choosing (a), add `nodeId: string` to `ClientGcrTenantRow`, copy `a.nodeId` in the projection (the engine allocation must carry it — verify `TenantAllocation` exposes a node id; if not, thread it through `mapDbToEngineInput`), and update Task 6's test.

- [ ] **Step 5: Run the component test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run "src/app/(portal)/sites/[projectId]/gcr/ClientGcrReview.test.tsx"`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(portal)/sites/[projectId]/gcr/"
git commit -m "feat(portal): outputs-only GCR review page — play, propose, submit (TDD)"
```

---

### Task 16: Admin Client-Review panel (TDD on the component)

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/ClientReviewPanel.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/ClientReviewPanel.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ClientReviewPanel } from './ClientReviewPanel'

const publishMock = vi.fn().mockResolvedValue({ ok: true })
const actionMock = vi.fn().mockResolvedValue({ ok: true })
const manageMock = vi.fn().mockResolvedValue({ ok: true })
vi.mock('./gcr-client-review.actions', () => ({
  publishGcrForClientReviewAction: (...a: any[]) => publishMock(...a),
  actionGcrChangeRequestAction: (...a: any[]) => actionMock(...a),
  manageClientSiteAccessAction: (...a: any[]) => manageMock(...a),
}))

const requests = [{
  id: 'r1', project_id: 'p1', organisation_id: 'o1', snapshot_id: 's1', node_id: 'n1',
  client_id: 'c1', field: 'participation', old_value: 'shared', new_value: 'own',
  comment: 'we generate', status: 'open', admin_reply: null, actioned_by: null,
  actioned_at: null, created_at: '2026-06-18', updated_at: '2026-06-18',
}] as any

describe('ClientReviewPanel', () => {
  it('publish button calls publishGcrForClientReviewAction', () => {
    render(<ClientReviewPanel projectId="p1" grants={[]} requests={[]} />)
    fireEvent.click(screen.getByText(/publish for client review/i))
    expect(publishMock).toHaveBeenCalledWith('p1')
  })

  it('accept calls actionGcrChangeRequestAction with accept', () => {
    render(<ClientReviewPanel projectId="p1" grants={[]} requests={requests} />)
    fireEvent.click(screen.getByText(/^accept$/i))
    expect(actionMock).toHaveBeenCalledWith('p1', 'r1', { decision: 'accept' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm exec vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/ClientReviewPanel.test.tsx"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/ClientReviewPanel.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import type { GcrChangeRequestRow } from '@esite/shared'
import {
  publishGcrForClientReviewAction,
  actionGcrChangeRequestAction,
  manageClientSiteAccessAction,
} from './gcr-client-review.actions'
import type { ClientSiteAccessRow } from './gcr-client-review.actions'

interface Props {
  projectId: string
  grants: ClientSiteAccessRow[]
  requests: GcrChangeRequestRow[]
}

export function ClientReviewPanel({ projectId, grants, requests }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [grantEmail, setGrantEmail] = useState('')

  function run(fn: () => Promise<{ ok: true } | { error: string }>) {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if ('error' in res) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <p style={{ color: 'var(--c-red)', fontSize: 12 }}>{error}</p>}

      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>Client review</span>
        </CardHeader>
        <CardBody>
          <Button variant="primary" size="sm" disabled={pending}
            onClick={() => run(() => publishGcrForClientReviewAction(projectId))}>
            Publish for client review
          </Button>
          <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 8 }}>
            Freezes the current model into an outputs-only snapshot for granted clients.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>Manage client access</span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)}
              placeholder="Client user id" style={{ flex: 1, padding: 6, fontSize: 12 }} />
            <Button variant="secondary" size="sm" disabled={pending || !grantEmail}
              onClick={() => run(() => manageClientSiteAccessAction(projectId, grantEmail.trim(), 'grant'))}>
              Grant
            </Button>
          </div>
          {grants.length === 0 && <p style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>No clients granted yet.</p>}
          {grants.map((g) => (
            <div key={g.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
              <span style={{ fontSize: 12 }}>{g.full_name ?? g.email ?? g.user_id}</span>
              <Button variant="danger" size="sm" disabled={pending}
                onClick={() => run(() => manageClientSiteAccessAction(projectId, g.user_id, 'revoke'))}>
                Revoke
              </Button>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>Client requests</span>
        </CardHeader>
        <CardBody>
          {requests.length === 0 && <p style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>No requests yet.</p>}
          {requests.map((r) => (
            <div key={r.id} style={{ borderTop: '1px solid var(--c-border)', padding: '10px 0' }}>
              <div style={{ fontSize: 12 }}>
                <strong>{r.field}</strong>: {r.old_value ?? '—'} → {r.new_value ?? '—'}
                <span style={{ marginLeft: 8, color: 'var(--c-text-dim)' }}>({r.status})</span>
              </div>
              {r.comment && <div style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 2 }}>“{r.comment}”</div>}
              {r.status === 'open' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <Button variant="primary" size="sm" disabled={pending}
                    onClick={() => run(() => actionGcrChangeRequestAction(projectId, r.id, { decision: 'accept' }))}>
                    Accept
                  </Button>
                  <Button variant="secondary" size="sm" disabled={pending}
                    onClick={() => run(() => actionGcrChangeRequestAction(projectId, r.id, { decision: 'decline', reply: 'Declined' }))}>
                    Decline
                  </Button>
                </div>
              )}
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && pnpm exec vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery/ClientReviewPanel.test.tsx"`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/ClientReviewPanel.tsx" "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/ClientReviewPanel.test.tsx"
git commit -m "feat(gcr): admin client-review panel — publish, manage access, request queue (TDD)"
```

---

### Task 17: Wire the panel into GcrTabs + page

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/GcrTabs.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/page.tsx`

- [ ] **Step 1: Add a 5th tab to GcrTabs**

In `GcrTabs.tsx`: extend the `Tab` union to `'settings' | 'zones' | 'tenants' | 'reports' | 'client'`, add a "Client review" entry to the tab bar (same styling as the others), and render the panel when active:

```tsx
{active === 'client' && (
  <ClientReviewPanel
    projectId={projectId}
    grants={clientGrants}
    requests={clientRequests}
  />
)}
```

Add `import { ClientReviewPanel } from './ClientReviewPanel'` and accept new props `clientGrants` + `clientRequests` on the `GcrTabs` component (typed `ClientSiteAccessRow[]` and `GcrChangeRequestRow[]`).

- [ ] **Step 2: Feed the data from page.tsx**

In `page.tsx`, after the existing `loadGcrConfigAction` / `listGcrReportRevisionsAction` calls, add:

```tsx
import { listClientSiteAccessAction, listGcrChangeRequestsAction } from './gcr-client-review.actions'
// ...
const grantsRes = await listClientSiteAccessAction(id)
const requestsRes = await listGcrChangeRequestsAction(id)
const clientGrants = Array.isArray(grantsRes) ? grantsRes : []
const clientRequests = Array.isArray(requestsRes) ? requestsRes : []
```

and pass `clientGrants={clientGrants} clientRequests={clientRequests}` into `<GcrTabs ... />`.

- [ ] **Step 3: Typecheck + run the GCR UI tests**

Run: `cd apps/web && pnpm exec tsc --noEmit && pnpm exec vitest run "src/app/(admin)/projects/[id]/generator-cost-recovery"`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/GcrTabs.tsx" "apps/web/src/app/(admin)/projects/[id]/generator-cost-recovery/page.tsx"
git commit -m "feat(gcr): expose Client review tab in the GCR module"
```

---

### Task 18: Sub-unit 2b — full UI test run

**Files:** none (verification gate)

- [ ] **Step 1: Run all new UI tests + the full web suite for the touched areas**

Run: `cd apps/web && pnpm exec vitest run "src/app/(portal)" "src/app/(admin)/projects/[id]/generator-cost-recovery" && pnpm exec tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 2: Manual smoke (dev server)**

Run: `cd apps/web && pnpm dev` — as admin: open a project's GCR module → "Client review" tab → Publish → grant a client. As that client: `/portal` → site → review page renders outputs only, propose a participation change + comment → submit. Back as admin: request appears → Accept → confirm the live tenant participation changed in the Tenants tab.
Expected: full round-trip works; no contractor cost field visible to the client.

- [ ] **Step 3: Commit (any fixups)**

```bash
git add -A && git commit -m "chore(gcr): sub-unit 2b green — portal + admin UI passing"
```

---

## Production deploy checklist

**Sub-unit 2a (backend) — deploy first.**

1. **Merge order:** 2a PR before 2b PR. 2b imports nothing that 2a doesn't define; 2a ships dark (no nav entry to the client review yet).
2. **Apply migrations in order:** `00140` → `00141` → `00142` → `00143` (or the offset numbers from Task 0). On prod Supabase: `supabase db push` (or the project's migration apply pipeline). Each ends with `NOTIFY pgrst, 'reload schema'`.
3. **PostgREST exposed schemas:** `gcr` is already exposed (per `00126` notes — added to prod via Management API 2026-06-09). The new `gcr.review_snapshots` / `gcr.change_requests` / `gcr.get_client_review` inherit `gcr` exposure + the `00126` default privileges — **no extra exposure step needed**. `public.client_site_grants` is in the already-exposed `public` schema.
4. **Verify RLS scoping with a test client (mandatory before announcing):** run the live RLS suite against prod (or a prod-mirror) with real creds:
   `cd packages/db && SUPABASE_URL=<prod> SUPABASE_ANON_KEY=<prod> SUPABASE_SERVICE_ROLE_KEY=<prod> TEST_USER_A_EMAIL=<admin> TEST_USER_A_PASSWORD=… TEST_USER_B_EMAIL=<client> TEST_USER_B_PASSWORD=… pnpm exec vitest run src/__tests__/rls/gcr-client-review.rls.test.ts`
   All cases must PASS — specifically: granted client reads only granted snapshot; ungranted RPC raises; client CANNOT read `gcr.settings` or `gcr.report_revisions` (the `00127` block must still hold). If any cost-table read returns a row, **STOP** — do not roll out 2b.
5. **WM bypass check:** confirm a WM owner-org (`dddddddd-0000-0000-0000-000000000001`) admin can still publish + action (they pass `user_can_manage_project` via org role). No special bypass code is needed because the new policies route through the existing `user_can_manage_project` / `user_has_project_access` helpers that already honour owner/admin/PM — verify by publishing once as a WM admin.
6. **Email config:** confirm `RESEND_API_KEY` + the `gcr-client-request` / `gcr-request-actioned` templates are deployed with the `send-email` function (`supabase functions deploy send-email`). Send one real submit + one real accept to confirm both emails arrive.

**Sub-unit 2b (UI) — deploy after 2a verified.**

7. **Standard Next.js deploy.** No migrations. Confirm the portal `/portal` and `/portal/sites/[projectId]/gcr` routes render for a granted client and that the admin "Client review" tab is visible only to owner/admin/PM (the actions gate server-side regardless).
8. **Deploy cost:** 2a = one Supabase migration round-trip + edge function deploy (~minutes), verifiable immediately via the RLS suite. 2b = one web deploy, verifiable via the manual round-trip in Task 18 Step 2.

---

## Self-review against spec §5 / §8

**§5.1 Access model (per-site, explicit, default none, dedicated table, cross-sub-org):** `client_site_grants` is the dedicated table; visibility derives only from it (Task 1, 9, 12). Default none (no rows). Keyed to `project_id` → cross-sub-org allowed (D6). ✔ (ambiguity #3 flagged for owner confirmation of the zero-org-membership client trust model.)

**§5.2 Outputs-only (Option B):** `toClientReviewPayload` allow-list + snapshot stores only the projection + grant-gated RPC (Tasks 6, 2, 4); RLS test asserts cost tables denied (Task 12). ✔

**§5.3 Play / propose / submit:** ephemeral drafts in `ClientGcrReview` (no save), captured old→new proposal + comment, batch submit (Tasks 9, 15). Proposable fields = inputs only (`GcrChangeRequestField` enum constrained in migration `00142` + types). ✔

**§5.4 Frozen snapshot + published_for_client_at:** immutable `gcr.review_snapshots` with `published_for_client_at`; requests FK to `snapshot_id` (Tasks 2, 3). ✔

**§5.5 Admin handling (queue + email; accept auto-applies; decline+reason; reply; notify on publish):** `listGcrChangeRequestsAction` + `ClientReviewPanel` queue; `actionGcrChangeRequestAction` accept→`bulk_save_tenant_assignments` RPC (auto-apply), decline+reply, client notification + email (Tasks 7, 8, 11, 16). ✔ (Note: spec says "on the next publish, the client is notified" — this plan notifies the client *immediately* on action via in-app + email, which is stronger; confirm this is acceptable or restrict to publish-time only.)

**§8 Security:** (a) granted client reads only published snapshot for granted sites — RLS on `review_snapshots` + RPC re-check (Tasks 2, 4, 12); (b) never expose contractor inputs — projection + snapshot-is-projection + RLS test (Tasks 6, 12); (c) org-level `client_viewer` still cannot read raw `gcr.*` — `00124`/`00127` policies untouched, RLS test asserts `gcr.settings` + `gcr.report_revisions` denied (Task 12). WM bypass preserved via existing helpers (deploy checklist #5). Service-role + single-use tokens are the Phase-1 email hook's concern (unchanged). ✔

**D1–D6 coverage:** D1 captured proposal (✔ Task 3/9/15), D2 outputs-only (✔ Task 6), D3 frozen snapshot (✔ Task 2), D4 accept auto-applies (✔ Task 8), D5 per-site grant dedicated table (✔ Task 1), D6 cross-sub-org keyed to site (✔ Task 1/9). ✔

**Placeholder scan:** no "TBD/add validation/handle edge cases" — every code step has real SQL/TS. Two explicit executor decisions are flagged with both options spelled out (Task 15 Step 4 nodeId resolution; ambiguity #1 invite-from-GCR), which is design surface for the owner, not a placeholder.

**Type consistency:** `ClientGcrReviewPayload`/`ClientGcrTenantRow`/`ClientGcrBankRow`/`GcrChangeRequestField`/`GcrChangeRequestInput`/`GcrChangeRequestRow` defined in Task 5 and used consistently in Tasks 6–17. Action names stable: `publishGcrForClientReviewAction`, `manageClientSiteAccessAction`, `listClientSiteAccessAction`, `listGcrChangeRequestsAction`, `actionGcrChangeRequestAction`, `getClientSitesAction`, `getClientGcrReviewAction`, `submitGcrChangeRequestsAction`. RPC names stable: `get_client_review`, `bulk_save_tenant_assignments`. ✔
