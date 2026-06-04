#!/usr/bin/env bash
# Smoke-test migration 00120 (snag site visits + carry-forward stamps).
#
# The migration has NOT yet been applied to the live DB. Every mgmt_query call
# below wraps the migration DDL (minus the trailing NOTIFY) inside a single
# BEGIN ... ROLLBACK transaction, so the live DB is left completely unchanged.
#
# Usage:  bash scripts/db/smoke-test-snag-site-visits.sh
# Exit:   0 on full green, non-zero on any failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATION="$REPO_ROOT/apps/edge-functions/supabase/migrations/00120_snag_site_visits.sql"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }
section() { echo ""; echo "── $1 ──"; }

FAILED=0

# Reusable SQL fragments: pick any org + profile for fixture inserts.
ORG="(SELECT id FROM public.organisations LIMIT 1)"
WHO="(SELECT id FROM public.profiles LIMIT 1)"

# ---------------------------------------------------------------------------
# Helper: build a temp SQL file = BEGIN + migration DDL (no NOTIFY) + test SQL
# + ROLLBACK, then apply via mgmt_apply_sql_file (handles $$ cleanly).
# Returns the path; caller must rm it.
# ---------------------------------------------------------------------------
make_txn() {
  local test_sql="$1"
  local tmp
  tmp=$(mktemp /tmp/smoke-snag-visits-XXXXXX.sql)
  {
    echo "BEGIN;"
    # Strip the trailing NOTIFY line from the migration before including it.
    grep -v "^NOTIFY pgrst" "$MIGRATION"
    echo ""
    echo "$test_sql"
    echo "ROLLBACK;"
  } > "$tmp"
  echo "$tmp"
}

# ---------------------------------------------------------------------------
# Section 1 — Catalog checks run INSIDE the transaction:
#   field.snag_visits exists, new columns on snags + snag_photos exist.
# ---------------------------------------------------------------------------
section "1. field.snag_visits exists + new columns on snags/snag_photos exist"

TMP=$(make_txn "
SELECT count(*)::int AS n
  FROM information_schema.tables
  WHERE table_schema='field' AND table_name='snag_visits';
")
N=$(mgmt_apply_sql_file "$TMP" | jq -r '.[0].n'); rm -f "$TMP"
[[ "$N" == "1" ]] && pass "field.snag_visits table exists" || fail "field.snag_visits table missing (got $N)"

TMP=$(make_txn "
SELECT count(*)::int AS n
  FROM information_schema.columns
  WHERE table_schema='field' AND table_name='snags'
    AND column_name IN ('raised_on_visit_id','closed_on_visit_id');
")
N=$(mgmt_apply_sql_file "$TMP" | jq -r '.[0].n'); rm -f "$TMP"
[[ "$N" == "2" ]] && pass "snags.raised_on_visit_id + closed_on_visit_id present" || fail "expected 2 new snags columns, got $N"

TMP=$(make_txn "
SELECT count(*)::int AS n
  FROM information_schema.columns
  WHERE table_schema='field' AND table_name='snag_photos'
    AND column_name='visit_id';
")
N=$(mgmt_apply_sql_file "$TMP" | jq -r '.[0].n'); rm -f "$TMP"
[[ "$N" == "1" ]] && pass "snag_photos.visit_id present" || fail "snag_photos.visit_id missing (got $N)"

# ---------------------------------------------------------------------------
# Section 2 — POSITIVE: visit_no auto-sequences 1 then 2 for non-backlog visits
# ---------------------------------------------------------------------------
section "2. POSITIVE: visit_no auto-sequences 1 then 2 for two non-backlog visits"

# Both inserts are in the same transaction so the trigger's MAX(visit_no)
# sees the first row when computing the second visit's number.
TMP=$(make_txn "
INSERT INTO projects.projects (name, organisation_id, created_by)
  SELECT 'SMOKE-VISITS-DNC', $ORG, $WHO;
INSERT INTO field.snag_visits (organisation_id, project_id, is_backlog, visit_date, conducted_by, title)
  SELECT $ORG, p.id, false, '2026-06-01', $WHO, 'Visit A'
  FROM projects.projects p WHERE p.name='SMOKE-VISITS-DNC';
INSERT INTO field.snag_visits (organisation_id, project_id, is_backlog, visit_date, conducted_by, title)
  SELECT $ORG, p.id, false, '2026-06-08', $WHO, 'Visit B'
  FROM projects.projects p WHERE p.name='SMOKE-VISITS-DNC';
SELECT visit_no, title
  FROM field.snag_visits
  WHERE project_id=(SELECT id FROM projects.projects WHERE name='SMOKE-VISITS-DNC')
  ORDER BY visit_no;
")
RESULT=$(mgmt_apply_sql_file "$TMP"); rm -f "$TMP"
V1=$(echo "$RESULT" | jq -r '.[0].visit_no')
V2=$(echo "$RESULT" | jq -r '.[1].visit_no')
[[ "$V1" == "1" ]] && pass "first non-backlog visit_no = 1" || fail "expected visit_no=1, got $V1"
[[ "$V2" == "2" ]] && pass "second non-backlog visit_no = 2" || fail "expected visit_no=2, got $V2"

# ---------------------------------------------------------------------------
# Section 3 — backlog visit gets visit_no=0; second backlog violates UNIQUE
# ---------------------------------------------------------------------------
section "3a. POSITIVE: backlog visit gets visit_no=0"

TMP=$(make_txn "
INSERT INTO projects.projects (name, organisation_id, created_by)
  SELECT 'SMOKE-BACKLOG-DNC', $ORG, $WHO;
INSERT INTO field.snag_visits (organisation_id, project_id, is_backlog, visit_date, conducted_by, title)
  SELECT $ORG, p.id, true, '2026-01-01', $WHO, 'Initial backlog'
  FROM projects.projects p WHERE p.name='SMOKE-BACKLOG-DNC';
SELECT visit_no FROM field.snag_visits
  WHERE project_id=(SELECT id FROM projects.projects WHERE name='SMOKE-BACKLOG-DNC');
")
V=$(mgmt_apply_sql_file "$TMP" | jq -r '.[0].visit_no'); rm -f "$TMP"
[[ "$V" == "0" ]] && pass "backlog visit_no = 0" || fail "expected visit_no=0, got $V"

section "3b. NEGATIVE: second backlog on same project violates snag_visits_project_no_uniq"
# NOTE on NEGATIVE sections: mgmt_apply_sql_file exits non-zero on any API
# error; these blocks discard stderr. The ONLY statement that can fail is the
# second backlog INSERT (which produces duplicate (project_id, 0)).
TMP=$(make_txn "
INSERT INTO projects.projects (name, organisation_id, created_by)
  SELECT 'SMOKE-BACKLOG2-DNC', $ORG, $WHO;
INSERT INTO field.snag_visits (organisation_id, project_id, is_backlog, visit_date, conducted_by, title)
  SELECT $ORG, p.id, true, '2026-01-01', $WHO, 'Backlog 1'
  FROM projects.projects p WHERE p.name='SMOKE-BACKLOG2-DNC';
INSERT INTO field.snag_visits (organisation_id, project_id, is_backlog, visit_date, conducted_by, title)
  SELECT $ORG, p.id, true, '2026-01-02', $WHO, 'Backlog 2 duplicate'
  FROM projects.projects p WHERE p.name='SMOKE-BACKLOG2-DNC';
")
if ! mgmt_apply_sql_file "$TMP" >/dev/null 2>&1; then
  pass "second backlog rejected by snag_visits_project_no_uniq"
else
  fail "second backlog was NOT rejected"
fi
rm -f "$TMP"

# ---------------------------------------------------------------------------
# Section 4 — NEGATIVE: snag with raised_on_visit_id pointing at another
#             project's visit rejected by composite FK snags_raised_on_visit_fk
# ---------------------------------------------------------------------------
section "4. NEGATIVE: cross-project raised_on_visit_id rejected by composite FK"

TMP=$(make_txn "
INSERT INTO projects.projects (name, organisation_id, created_by)
  SELECT 'SMOKE-XP-A-DNC', $ORG, $WHO;
INSERT INTO projects.projects (name, organisation_id, created_by)
  SELECT 'SMOKE-XP-B-DNC', $ORG, $WHO;
INSERT INTO field.snag_visits (organisation_id, project_id, is_backlog, visit_date, conducted_by, title)
  SELECT $ORG, p.id, true, '2026-01-01', $WHO, 'B backlog'
  FROM projects.projects p WHERE p.name='SMOKE-XP-B-DNC';
INSERT INTO field.snags (organisation_id, project_id, title, raised_by, raised_on_visit_id)
  SELECT $ORG,
         (SELECT id FROM projects.projects WHERE name='SMOKE-XP-A-DNC'),
         'Cross-project snag',
         $WHO,
         (SELECT v.id FROM field.snag_visits v
            JOIN projects.projects p ON p.id=v.project_id
           WHERE p.name='SMOKE-XP-B-DNC' LIMIT 1);
")
if ! mgmt_apply_sql_file "$TMP" >/dev/null 2>&1; then
  pass "cross-project raised_on_visit_id rejected by composite FK"
else
  fail "cross-project visit stamp was NOT rejected"
fi
rm -f "$TMP"

# ---------------------------------------------------------------------------
# Section 5a — NEGATIVE: deleting a visit with a snag raised on it is blocked
# ---------------------------------------------------------------------------
section "5a. NEGATIVE: deleting a visit with a snag raised on it is blocked (NO ACTION)"

TMP=$(make_txn "
INSERT INTO projects.projects (name, organisation_id, created_by)
  SELECT 'SMOKE-NOACT-DNC', $ORG, $WHO;
INSERT INTO field.snag_visits (organisation_id, project_id, is_backlog, visit_date, conducted_by, title)
  SELECT $ORG, p.id, true, '2026-01-01', $WHO, 'Backlog'
  FROM projects.projects p WHERE p.name='SMOKE-NOACT-DNC';
INSERT INTO field.snags (organisation_id, project_id, title, raised_by, raised_on_visit_id)
  SELECT $ORG,
         (SELECT id FROM projects.projects WHERE name='SMOKE-NOACT-DNC'),
         'Snag on visit',
         $WHO,
         (SELECT v.id FROM field.snag_visits v
            JOIN projects.projects p ON p.id=v.project_id
           WHERE p.name='SMOKE-NOACT-DNC' LIMIT 1);
DELETE FROM field.snag_visits
  WHERE project_id=(SELECT id FROM projects.projects WHERE name='SMOKE-NOACT-DNC');
")
if ! mgmt_apply_sql_file "$TMP" >/dev/null 2>&1; then
  pass "visit-with-snag DELETE blocked (NO ACTION)"
else
  fail "visit-with-snag DELETE was NOT blocked"
fi
rm -f "$TMP"

# ---------------------------------------------------------------------------
# Section 5b — POSITIVE: deleting the project cascades visits and snags away
# ---------------------------------------------------------------------------
section "5b. POSITIVE: deleting the project cascades through visits and snags"

TMP=$(make_txn "
INSERT INTO projects.projects (name, organisation_id, created_by)
  SELECT 'SMOKE-CASCADE-V-DNC', $ORG, $WHO;
INSERT INTO field.snag_visits (organisation_id, project_id, is_backlog, visit_date, conducted_by, title)
  SELECT $ORG, p.id, true, '2026-01-01', $WHO, 'Backlog'
  FROM projects.projects p WHERE p.name='SMOKE-CASCADE-V-DNC';
INSERT INTO field.snags (organisation_id, project_id, title, raised_by, raised_on_visit_id)
  SELECT $ORG,
         (SELECT id FROM projects.projects WHERE name='SMOKE-CASCADE-V-DNC'),
         'Snag',
         $WHO,
         (SELECT v.id FROM field.snag_visits v
            JOIN projects.projects p ON p.id=v.project_id
           WHERE p.name='SMOKE-CASCADE-V-DNC' LIMIT 1);
DELETE FROM projects.projects WHERE name='SMOKE-CASCADE-V-DNC';
SELECT
  (SELECT count(*)::int FROM field.snag_visits sv
     WHERE NOT EXISTS (SELECT 1 FROM projects.projects pp WHERE pp.id=sv.project_id)) +
  (SELECT count(*)::int FROM field.snags s
     WHERE NOT EXISTS (SELECT 1 FROM projects.projects pp WHERE pp.id=s.project_id))
  AS orphans;
")
ORPHANS=$(mgmt_apply_sql_file "$TMP" | jq -r '.[0].orphans'); rm -f "$TMP"
[[ "$ORPHANS" == "0" ]] && pass "project cascade removed visits + snags (no orphans)" || fail "expected 0 orphans after cascade, got $ORPHANS"

# ---------------------------------------------------------------------------
# Section 6 — Catalog: RLS enabled + exactly 3 policies on snag_visits
# ---------------------------------------------------------------------------
section "6. RLS enabled on snag_visits; select + insert + update policies exist"

TMP=$(make_txn "
SELECT count(*)::int AS n
  FROM pg_tables
  WHERE schemaname='field' AND tablename='snag_visits' AND rowsecurity;
")
N=$(mgmt_apply_sql_file "$TMP" | jq -r '.[0].n'); rm -f "$TMP"
[[ "$N" == "1" ]] && pass "RLS enabled on field.snag_visits" || fail "RLS not enabled on field.snag_visits (got $N)"

TMP=$(make_txn "
SELECT count(*)::int AS n
  FROM pg_policies
  WHERE schemaname='field' AND tablename='snag_visits';
")
N=$(mgmt_apply_sql_file "$TMP" | jq -r '.[0].n'); rm -f "$TMP"
[[ "$N" == "3" ]] && pass "3 RLS policies present (select + insert + update)" || fail "expected 3 policies on snag_visits, got $N"

for pol in snag_visits_select snag_visits_insert snag_visits_update; do
  TMP=$(make_txn "
SELECT count(*)::int AS n
  FROM pg_policies
  WHERE schemaname='field' AND tablename='snag_visits' AND policyname='$pol';
")
  N=$(mgmt_apply_sql_file "$TMP" | jq -r '.[0].n'); rm -f "$TMP"
  [[ "$N" == "1" ]] && pass "policy '$pol' exists" || fail "policy '$pol' missing (got $N)"
done

echo ""
if [[ "$FAILED" == "0" ]]; then
  echo "✓ ALL SMOKE TESTS PASSED"
  exit 0
else
  echo "✗ SMOKE TESTS FAILED ($FAILED failures)"
  exit 1
fi
