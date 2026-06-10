#!/usr/bin/env bash
# Smoke-test migration 00124 (generator cost-recovery schema).
#
# The migration has NOT yet been applied to the live DB. Every mgmt_query call
# below wraps the migration DDL (minus the trailing NOTIFY) inside a single
# BEGIN ... ROLLBACK transaction, so the live DB is left completely unchanged.
#
# Usage:  bash scripts/db/smoke-test-generator-cost-recovery.sh
# Exit:   0 on full green, non-zero on any failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATION="$REPO_ROOT/apps/edge-functions/supabase/migrations/00124_generator_cost_recovery_schema.sql"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }
section() { echo ""; echo "── $1 ──"; }

FAILED=0

# ---------------------------------------------------------------------------
# Helper: build a temp SQL file = BEGIN + migration DDL (no NOTIFY) + test SQL
# + ROLLBACK, then apply via mgmt_apply_sql_file (handles $$ cleanly).
# Returns the path; caller must rm it.
# ---------------------------------------------------------------------------
make_txn() {
  local test_sql="$1"
  local tmp
  tmp=$(mktemp /tmp/smoke-gcr-XXXXXX.sql)
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
# Section 1 — Catalog: gcr.* tables exist + structure.nodes has the two
#             new columns (shop_category, generator_participation).
# ---------------------------------------------------------------------------
section "1. gcr.* tables exist"

for tbl in settings zones zone_generators tenant_assignments; do
  TMP=$(make_txn "
SELECT count(*)::int AS n
  FROM information_schema.tables
  WHERE table_schema='gcr' AND table_name='${tbl}';
")
  N=$(mgmt_apply_sql_file "$TMP" | jq -r '.[0].n'); rm -f "$TMP"
  [[ "$N" == "1" ]] && pass "gcr.${tbl} exists" || fail "gcr.${tbl} missing (got $N)"
done

section "2. structure.nodes has shop_category + generator_participation"

TMP=$(make_txn "
SELECT count(*)::int AS n
  FROM information_schema.columns
  WHERE table_schema='structure' AND table_name='nodes'
    AND column_name IN ('shop_category','generator_participation');
")
N=$(mgmt_apply_sql_file "$TMP" | jq -r '.[0].n'); rm -f "$TMP"
[[ "$N" == "2" ]] && pass "shop_category + generator_participation present on structure.nodes" \
                  || fail "expected 2 new columns on structure.nodes, got $N"

# ---------------------------------------------------------------------------
# Section 3 — POSITIVE: insert a gcr.settings row for an existing project.
# The DO block ends with RAISE EXCEPTION 'GCR_SMOKE_OK' so the whole
# transaction aborts cleanly — nothing persists.
# ---------------------------------------------------------------------------
section "3. POSITIVE: gcr.settings insert + sentinel exception"

TMP=$(make_txn "
INSERT INTO gcr.settings (project_id, organisation_id)
  SELECT p.id,
         (SELECT id FROM public.organisations LIMIT 1)
    FROM projects.projects p
   LIMIT 1;

DO \$\$ BEGIN RAISE EXCEPTION 'GCR_SMOKE_OK'; END \$\$;
")
OUT="$(mgmt_apply_sql_file "$TMP" 2>&1 || true)"; rm -f "$TMP"
if echo "$OUT" | grep -q "GCR_SMOKE_OK"; then
  pass "gcr.settings insert succeeded; sentinel GCR_SMOKE_OK raised (transaction rolled back)"
else
  fail "sentinel GCR_SMOKE_OK not found in output — insert may have failed. Output: $OUT"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [[ "$FAILED" == "0" ]]; then
  echo "✓ ALL SMOKE TESTS PASSED"
  exit 0
else
  echo "✗ SMOKE TESTS FAILED ($FAILED failures)"
  exit 1
fi
