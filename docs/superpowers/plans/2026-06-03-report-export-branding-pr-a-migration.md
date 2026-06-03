# Report Export + Branding Foundation — PR-A (Migration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship migration `00117` — the pure-DB foundation for the standardized PDF report engine: branding columns, the unified `projects.reports` artifact table, and two Storage buckets, all RLS-secured and smoke-tested.

**Architecture:** One additive, idempotent SQL migration in the already-PostgREST-exposed `projects` schema (so a trailing `NOTIFY pgrst` suffices — no config PATCH). A re-runnable, production-safe transactional smoke test verifies every object. No application code changes; nothing the running app references, so production behaviour is unchanged until PR-D/E.

**Tech Stack:** Supabase Postgres, SQL migrations under `apps/edge-functions/supabase/migrations/`, the Management-API apply path (`scripts/db/mgmt-api.sh`), bash smoke tests under `scripts/db/`.

---

## Phase roadmap (this plan = PR-A only)

This is **PR-A of five stacked PRs**. Each later PR gets its own detailed plan when we reach it (mirroring the anchor sub-boards workflow). Spec: [`docs/superpowers/specs/2026-06-03-standardized-report-export-branding-design.md`](../specs/2026-06-03-standardized-report-export-branding-design.md).

| PR | Goal | Key files |
|----|------|-----------|
| **A — Migration (this plan)** | `projects.reports` + branding columns + 2 buckets + RLS | `00117_*.sql`, `smoke-test-report-export-branding.sh` |
| **B — Engine** | Pure `packages/shared/src/reports/`: branding resolver + primitives + `render-report` + `BrandingPreview` kind; unit-tested; sub-path export `@esite/shared/reports` | `packages/shared/src/reports/**`, `packages/shared/package.json` (exports), add `@react-pdf/renderer` |
| **C — Reports service** | `packages/shared/src/services/reports.service.ts` — upload + insert/supersede + signed-URL + list; mocked-client tests | `reports.service.ts`, `_reports-mappers.ts` |
| **D — Settings & branding** | Org/project/sub-org logo upload + accent; "Branding" field-group in the General sub-page; `previewBrandingAction` (verification surface) | settings General form + actions, org/sub-org settings, `branding.actions.ts` |
| **E — Export entry point** | `exportReportAction(kind, sourceId)` + minimal Reports list | `report.actions.ts`, reports list page |

---

## PR-A overview

**What "done" looks like:** migration `00117` applied to the live DB and recorded in the ledger; `scripts/db/smoke-test-report-export-branding.sh` exits `0` (all green); both files committed on `feat/report-export-branding-foundation`.

**Apply/deploy path (matches `00116`):** this migration is additive, non-destructive, and idempotent. Apply it to the live DB on the branch via `mgmt_apply_sql_file`, **then record the `00117` ledger row** (Management-API applies don't write `supabase_migrations.schema_migrations`, which caused the 00107–00114 drift). On merge to `main`, `deploy-migrations.yml` sees the ledger already at `00117` and no-ops. (Alternative: skip the manual apply and let the workflow apply + record on merge — but then the smoke test can't run pre-merge, so we apply on the branch.)

**Prerequisites:** `jq` installed (`brew install jq`); the "Supabase CLI" PAT in the macOS keychain (already present per repo setup). All `mgmt_*` calls hit the `cbskbnvvgcybmfikxgky` project.

### File Structure

- **Create:** `apps/edge-functions/supabase/migrations/00117_report_export_branding.sql` — the entire migration (branding columns, `projects.reports`, 2 buckets, all RLS).
- **Create:** `scripts/db/smoke-test-report-export-branding.sh` — catalog checks + transactional round-trips, ROLLBACK-safe.

---

## Task 1: Write the migration SQL

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00117_report_export_branding.sql`

- [ ] **Step 1: Create the migration file with this exact content**

```sql
-- =============================================================================
-- Migration 00117 — standardized report export + branding foundation (PR-A)
-- =============================================================================
-- Pure-DB foundation for the standardized PDF report engine (backlog #4).
-- Adds:
--   • projects.projects branding columns (client/project logos + accent override)
--   • public.organisations.report_accent_color (org default accent)
--   • projects.reports — unified, versioned, saved-artifact table for every
--     generated report (inspection / snag / handover / …), branding snapshot
--     frozen per issue.
--   • two private Storage buckets: report-logos (raster brand assets) and
--     reports (generated PDFs), org-scoped RLS mirroring 00042/00091.
-- No real report KIND ships here — infrastructure that PR-B…E build on.
--
-- Non-destructive, additive, idempotent (safe to re-run). projects + storage
-- are already PostgREST-exposed, so a trailing NOTIFY is sufficient — no config
-- PATCH. Apply via the controller (mgmt_apply_sql_file), then record the ledger
-- row (00117); or merge to main and let deploy-migrations.yml apply + record it.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Branding columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE projects.projects
  ADD COLUMN IF NOT EXISTS client_logo_url     TEXT,
  ADD COLUMN IF NOT EXISTS project_logo_url    TEXT,
  ADD COLUMN IF NOT EXISTS report_accent_color TEXT;

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS report_accent_color TEXT;

-- Optional hex-colour guards (idempotent named CHECKs; NULL allowed).
ALTER TABLE projects.projects DROP CONSTRAINT IF EXISTS projects_report_accent_hex;
ALTER TABLE projects.projects ADD CONSTRAINT projects_report_accent_hex
  CHECK (report_accent_color IS NULL OR report_accent_color ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE public.organisations DROP CONSTRAINT IF EXISTS organisations_report_accent_hex;
ALTER TABLE public.organisations ADD CONSTRAINT organisations_report_accent_hex
  CHECK (report_accent_color IS NULL OR report_accent_color ~ '^#[0-9A-Fa-f]{6}$');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. projects.reports — saved report artifacts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects.reports (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id   UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    project_id        UUID        NOT NULL REFERENCES projects.projects(id)    ON DELETE CASCADE,
    kind              TEXT        NOT NULL,
    source_table      TEXT,
    source_id         UUID,
    title             TEXT        NOT NULL,
    storage_path      TEXT        NOT NULL,
    mime_type         TEXT        NOT NULL DEFAULT 'application/pdf',
    size_bytes        INTEGER,
    status            TEXT        NOT NULL DEFAULT 'issued',
    version           INTEGER     NOT NULL DEFAULT 1,
    superseded_by     UUID        REFERENCES projects.reports(id) ON DELETE SET NULL,
    branding_snapshot JSONB,
    generated_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
    generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent named CHECKs (an inline CHECK wouldn't re-apply under CREATE IF NOT EXISTS).
ALTER TABLE projects.reports DROP CONSTRAINT IF EXISTS reports_status_check;
ALTER TABLE projects.reports ADD CONSTRAINT reports_status_check
  CHECK (status IN ('draft','issued','superseded','revoked'));

ALTER TABLE projects.reports DROP CONSTRAINT IF EXISTS reports_version_positive;
ALTER TABLE projects.reports ADD CONSTRAINT reports_version_positive
  CHECK (version >= 1);

CREATE INDEX IF NOT EXISTS reports_project_idx      ON projects.reports (project_id);
CREATE INDEX IF NOT EXISTS reports_project_kind_idx ON projects.reports (project_id, kind);
CREATE INDEX IF NOT EXISTS reports_source_idx       ON projects.reports (source_table, source_id);

DROP TRIGGER IF EXISTS reports_updated_at ON projects.reports;
CREATE TRIGGER reports_updated_at
    BEFORE UPDATE ON projects.reports
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS — read = any user with project access; defensive owner/admin/PM write.
--    (Generation runs through gated server actions on the service client, which
--    bypasses RLS; the write policy is defence-in-depth, mirroring 00101.)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE projects.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reports_select ON projects.reports;
CREATE POLICY reports_select
    ON projects.reports
    FOR SELECT TO authenticated
    USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS reports_write ON projects.reports;
CREATE POLICY reports_write
    ON projects.reports
    FOR ALL TO authenticated
    USING (
        organisation_id IN (
            SELECT organisation_id FROM public.user_organisations
            WHERE user_id = auth.uid() AND is_active
              AND role IN ('owner','admin','project_manager')
        )
    )
    WITH CHECK (
        organisation_id IN (
            SELECT organisation_id FROM public.user_organisations
            WHERE user_id = auth.uid() AND is_active
              AND role IN ('owner','admin','project_manager')
        )
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Storage buckets — report-logos (raster brand assets) + reports (PDFs).
--    Org-scoped object policies; path {org_id}/{project_id}/...; private.
--    Role-level write authorization lives at the action layer (repo convention);
--    bucket policies only check org membership.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'report-logos', 'report-logos', false,
    5242880,  -- 5 MiB
    ARRAY['image/png','image/jpeg','image/webp']  -- raster only (react-pdf SVG support is partial)
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'reports', 'reports', false,
    52428800,  -- 50 MiB
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- report-logos policies
DROP POLICY IF EXISTS "Org members read report logos" ON storage.objects;
CREATE POLICY "Org members read report logos" ON storage.objects FOR SELECT
  USING (bucket_id = 'report-logos' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members upload report logos" ON storage.objects;
CREATE POLICY "Org members upload report logos" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'report-logos' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members update report logos" ON storage.objects;
CREATE POLICY "Org members update report logos" ON storage.objects FOR UPDATE
  USING (bucket_id = 'report-logos' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members delete report logos" ON storage.objects;
CREATE POLICY "Org members delete report logos" ON storage.objects FOR DELETE
  USING (bucket_id = 'report-logos' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));

-- reports policies
DROP POLICY IF EXISTS "Org members read reports" ON storage.objects;
CREATE POLICY "Org members read reports" ON storage.objects FOR SELECT
  USING (bucket_id = 'reports' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members upload reports" ON storage.objects;
CREATE POLICY "Org members upload reports" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'reports' AND auth.uid() IS NOT NULL AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members update reports" ON storage.objects;
CREATE POLICY "Org members update reports" ON storage.objects FOR UPDATE
  USING (bucket_id = 'reports' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));
DROP POLICY IF EXISTS "Org members delete reports" ON storage.objects;
CREATE POLICY "Org members delete reports" ON storage.objects FOR DELETE
  USING (bucket_id = 'reports' AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PostgREST reload (table + columns + buckets in already-exposed schemas;
--    no schema CREATE/DROP, so no config PATCH — NOTIFY suffices).
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Sanity-check the FK target for `generated_by`**

Run: `git -C /Users/spud/Developer/ESITE.V1/esite grep -n "created_by" apps/edge-functions/supabase/migrations/00002_projects_schema.sql`
Expected: confirms `projects.projects.created_by` references `public.profiles(id)`. If it references `auth.users(id)` instead, change the `generated_by` FK in the migration to match. (Either is acceptable since `profiles.id = auth.users.id`; we match the house convention.)

---

## Task 2: Write the smoke test

**Files:**
- Create: `scripts/db/smoke-test-report-export-branding.sh`

- [ ] **Step 1: Create the smoke-test file with this exact content**

```bash
#!/usr/bin/env bash
# Smoke-test migration 00117 (report export + branding foundation).
# Read-only catalog checks + transactional INSERT/UPDATE round-trips that
# ROLLBACK at the end. Safe to run against production (nothing persists).
#
# Usage:  scripts/db/smoke-test-report-export-branding.sh
# Exit:   0 on full green, non-zero on any failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }
section() { echo ""; echo "── $1 ──"; }

FAILED=0

ORG="(SELECT id FROM public.organisations LIMIT 1)"
WHO="(SELECT id FROM public.profiles LIMIT 1)"

# ── 1. Branding columns ──
section "1. projects.projects branding columns"
N=$(mgmt_query "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='projects' AND table_name='projects' AND column_name IN ('client_logo_url','project_logo_url','report_accent_color');" | jq -r '.[0].n')
[[ "$N" == "3" ]] && pass "3 branding columns present" || fail "expected 3, got $N"

section "2. organisations.report_accent_color"
N=$(mgmt_query "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='organisations' AND column_name='report_accent_color';" | jq -r '.[0].n')
[[ "$N" == "1" ]] && pass "report_accent_color present" || fail "missing (got $N)"

# ── 3. reports table + RLS + policies ──
section "3. projects.reports table with RLS"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='projects' AND tablename='reports' AND rowsecurity;" | jq -r '.[0].n')
[[ "$N" == "1" ]] && pass "reports exists with RLS enabled" || fail "missing or RLS off (got $N)"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='projects' AND tablename='reports';" | jq -r '.[0].n')
[[ "$N" == "2" ]] && pass "2 RLS policies present" || fail "expected 2 policies, got $N"

# ── 4. Buckets ──
section "4. storage buckets"
N=$(mgmt_query "SELECT count(*)::int AS n FROM storage.buckets WHERE id IN ('report-logos','reports');" | jq -r '.[0].n')
[[ "$N" == "2" ]] && pass "both buckets present" || fail "expected 2 buckets, got $N"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname IN ('Org members read report logos','Org members upload report logos','Org members update report logos','Org members delete report logos','Org members read reports','Org members upload reports','Org members update reports','Org members delete reports');" | jq -r '.[0].n')
[[ "$N" == "8" ]] && pass "8 storage policies present" || fail "expected 8 storage policies, got $N"

# ── 5. POSITIVE: reports insert round-trip ──
section "5. POSITIVE: reports insert + read-back"
N=$(mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-RPT-DNC', $ORG, $WHO;
INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path, status, version, generated_by, branding_snapshot)
  SELECT p.organisation_id, p.id, 'inspection', 'Smoke Report', 'org/proj/smoke.pdf', 'issued', 1, $WHO, '{\"accent\":\"#E69500\"}'::jsonb
  FROM projects.projects p WHERE p.name='SMOKE-RPT-DNC';
SELECT count(*)::int AS n FROM projects.reports r
  JOIN projects.projects p ON p.id=r.project_id WHERE p.name='SMOKE-RPT-DNC';
ROLLBACK;
" | jq -r '.[0].n')
[[ "$N" == "1" ]] && pass "report row inserted + readable" || fail "expected 1 report row, got $N"

# ── 6. NEGATIVE: invalid status rejected ──
section "6. NEGATIVE: bad status is rejected by reports_status_check"
if ! mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-BADSTATUS-DNC', $ORG, $WHO;
INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path, status)
  SELECT p.organisation_id, p.id, 'inspection', 'x', 'p.pdf', 'bogus'
  FROM projects.projects p WHERE p.name='SMOKE-BADSTATUS-DNC';
ROLLBACK;
" >/dev/null 2>&1; then pass "bad status rejected"; else fail "bad status was NOT rejected"; fi

# ── 7. NEGATIVE: version < 1 rejected ──
section "7. NEGATIVE: version 0 is rejected by reports_version_positive"
if ! mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-BADVER-DNC', $ORG, $WHO;
INSERT INTO projects.reports (organisation_id, project_id, kind, title, storage_path, version)
  SELECT p.organisation_id, p.id, 'inspection', 'x', 'p.pdf', 0
  FROM projects.projects p WHERE p.name='SMOKE-BADVER-DNC';
ROLLBACK;
" >/dev/null 2>&1; then pass "version 0 rejected"; else fail "version 0 was NOT rejected"; fi

# ── 8. NEGATIVE: non-hex accent rejected ──
section "8. NEGATIVE: invalid accent colour is rejected by the hex CHECK"
if ! mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by, report_accent_color)
  SELECT 'SMOKE-BADHEX-DNC', $ORG, $WHO, 'red';
ROLLBACK;
" >/dev/null 2>&1; then pass "non-hex accent rejected"; else fail "non-hex accent was NOT rejected"; fi

echo ""
if [[ "$FAILED" == "0" ]]; then
  echo "✓ ALL SMOKE TESTS PASSED"; exit 0
else
  echo "✗ SMOKE TESTS FAILED"; exit 1
fi
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x /Users/spud/Developer/ESITE.V1/esite/scripts/db/smoke-test-report-export-branding.sh`
Expected: no output, exit 0.

---

## Task 3: Red — run the smoke test BEFORE applying

- [ ] **Step 1: Run the smoke test against the un-migrated DB**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && bash scripts/db/smoke-test-report-export-branding.sh; echo "exit=$?"`
Expected: **FAIL** — sections 1–4 report `✗` (columns/table/buckets absent) and/or the script errors on the missing `projects.reports` table; final line `✗ SMOKE TESTS FAILED` with `exit=1`. This confirms the migration is genuinely needed (TDD red).

---

## Task 4: Apply the migration and record the ledger

- [ ] **Step 1: Apply `00117` to the live DB via the Management API**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && bash -c '. scripts/db/mgmt-api.sh && mgmt_apply_sql_file apps/edge-functions/supabase/migrations/00117_report_export_branding.sql'`
Expected: a JSON array response with no `"message"` error key (the helper exits non-zero on any API error). The apply is idempotent, so re-running is safe.

- [ ] **Step 2: Record the `00117` ledger row** (Management-API applies don't write it)

Run:
```bash
cd /Users/spud/Developer/ESITE.V1/esite && bash -c '. scripts/db/mgmt-api.sh && mgmt_query "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('"'"'00117'"'"', '"'"'report_export_branding'"'"') ON CONFLICT (version) DO NOTHING;"'
```
Expected: success (no error object). Verify: `mgmt_query "SELECT version FROM supabase_migrations.schema_migrations WHERE version='00117';"` returns one row.
(If the `schema_migrations` table has only a `version` column in this project, drop the `, name` / `, '...'` pair. Confirm columns first: `mgmt_query "SELECT column_name FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations';"`)

---

## Task 5: Green — run the smoke test AFTER applying

- [ ] **Step 1: Run the smoke test against the migrated DB**

Run: `cd /Users/spud/Developer/ESITE.V1/esite && bash scripts/db/smoke-test-report-export-branding.sh; echo "exit=$?"`
Expected: every section `✓`, final line `✓ ALL SMOKE TESTS PASSED`, `exit=0`.

- [ ] **Step 2: If any section fails**, read the `✗` line, fix the migration SQL in `00117_report_export_branding.sql`, re-apply (Task 4 Step 1 — idempotent), and re-run. Do not proceed until green.

---

## Task 6: Commit

- [ ] **Step 1: Stage and commit the two files**

```bash
cd /Users/spud/Developer/ESITE.V1/esite
git add apps/edge-functions/supabase/migrations/00117_report_export_branding.sql scripts/db/smoke-test-report-export-branding.sh
git commit -m "feat(db): migration 00117 — report export + branding foundation (PR-A)" -m "projects.reports artifact table + projects/org branding columns + report-logos & reports buckets, all RLS-secured. Additive, idempotent; smoke-tested green. No app code references it yet (PR-B+ consume it)." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Expected: one commit, 2 files changed.

---

## Notes / gotchas baked into this plan

- **No PostgREST config PATCH** — `projects` and `storage` are already exposed; the trailing `NOTIFY pgrst, 'reload schema';` covers the new table, columns, and buckets.
- **Ledger row is mandatory** after a Management-API apply, or `db push`/the deploy workflow will treat `00117` as pending forever (the 00107–00114 drift lesson).
- **Storage RLS is org-scoped only** (house convention); per-project + role write-gating is enforced later at the action layer (PR-D/E) via `requireEffectiveRole`, not in bucket policies.
- **DB types regen is deferred** — `projects.reports` will be read in PR-B+ via the established `(client as AnyClient).schema('projects')` cast, exactly as `project_settings` and the `structure` tables are today.
- **`set -euo pipefail` + negative tests:** each negative block discards stderr and must contain exactly one statement that can fail (the one under test), mirroring the anchor smoke test's invariant.
