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
