#!/usr/bin/env bash
# Smoke-test migration 00125 (per-seat feature unlocks).
#
# The migration has NOT yet been applied to the live DB. Every mgmt_query call
# below wraps the migration DDL (minus the trailing NOTIFY) inside a single
# BEGIN ... ROLLBACK transaction, so the live DB is left completely unchanged.
#
# Usage:  bash scripts/db/smoke-test-org-feature-seats.sh
# Exit:   0 on full green, non-zero on any failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATION="$REPO_ROOT/apps/edge-functions/supabase/migrations/00125_org_feature_seats.sql"

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
  tmp=$(mktemp /tmp/smoke-seats-XXXXXX.sql)
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
# Section 1 — Catalog: billing.org_feature_seats table exists +
#             has_feature_seat function exists.
# ---------------------------------------------------------------------------
section "1. billing.org_feature_seats table + has_feature_seat fn exist"

TMP=$(make_txn "
SELECT count(*)::int AS n
  FROM information_schema.tables
  WHERE table_schema='billing' AND table_name='org_feature_seats';
")
N=$(mgmt_apply_sql_file "$TMP" | jq -r '.[0].n'); rm -f "$TMP"
[[ "$N" == "1" ]] && pass "billing.org_feature_seats exists" \
                  || fail "billing.org_feature_seats missing (got $N)"

TMP=$(make_txn "
SELECT count(*)::int AS n
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'has_feature_seat';
")
N=$(mgmt_apply_sql_file "$TMP" | jq -r '.[0].n'); rm -f "$TMP"
[[ "$N" == "1" ]] && pass "public.has_feature_seat function exists" \
                  || fail "public.has_feature_seat function missing (got $N)"

# ---------------------------------------------------------------------------
# Section 2 — POSITIVE + NEGATIVE + WM-Consulting bypass: insert a seat
# assigned to a seeded profile, assert has_feature_seat, then assert an
# unrelated user gets FALSE, and the WM-Consulting org is TRUE with no row.
# The DO block ends with RAISE EXCEPTION 'SEATS_SMOKE_OK' so the whole
# transaction aborts cleanly — nothing persists.
# ---------------------------------------------------------------------------
section "2. POSITIVE / NEGATIVE / WM-Consulting bypass + sentinel exception"

TMP=$(make_txn "
DO \$\$
DECLARE
  v_org_id    UUID;
  v_user_id   UUID;
  v_other_id  UUID;
  v_result    BOOLEAN;
BEGIN
  -- Pick a seeded org and two distinct profiles.
  SELECT id INTO v_org_id FROM public.organisations LIMIT 1;
  SELECT id INTO v_user_id FROM public.profiles LIMIT 1;
  SELECT id INTO v_other_id FROM public.profiles WHERE id <> v_user_id LIMIT 1;

  -- Insert a seat for v_user_id.
  INSERT INTO billing.org_feature_seats
    (organisation_id, feature_key, assigned_user_id, amount_paid_kobo)
  VALUES
    (v_org_id, 'generator_cost_recovery', v_user_id, 200000);

  -- POSITIVE: assigned user must have the seat.
  v_result := public.has_feature_seat(v_org_id, v_user_id, 'generator_cost_recovery');
  IF NOT v_result THEN
    RAISE EXCEPTION 'POSITIVE_CHECK_FAILED: assigned user should have seat';
  END IF;

  -- NEGATIVE: unrelated user must NOT have the seat (skip if no second profile).
  IF v_other_id IS NOT NULL THEN
    v_result := public.has_feature_seat(v_org_id, v_other_id, 'generator_cost_recovery');
    IF v_result THEN
      RAISE EXCEPTION 'NEGATIVE_CHECK_FAILED: unrelated user should not have seat';
    END IF;
  END IF;

  -- WM-Consulting bypass: org dddddddd-0000-0000-0000-000000000001 is always TRUE
  -- regardless of whether any seat row exists.
  v_result := public.has_feature_seat(
    'dddddddd-0000-0000-0000-000000000001'::uuid,
    v_other_id,
    'generator_cost_recovery'
  );
  IF NOT v_result THEN
    RAISE EXCEPTION 'BYPASS_CHECK_FAILED: WM-Consulting org should always return TRUE';
  END IF;

  RAISE EXCEPTION 'SEATS_SMOKE_OK';
END \$\$;
")
OUT="$(mgmt_apply_sql_file "$TMP" 2>&1 || true)"; rm -f "$TMP"
if echo "$OUT" | grep -q "SEATS_SMOKE_OK"; then
  pass "seat insert + has_feature_seat checks passed; sentinel SEATS_SMOKE_OK raised (transaction rolled back)"
elif echo "$OUT" | grep -q "POSITIVE_CHECK_FAILED"; then
  fail "POSITIVE check failed: assigned user did not have seat"
elif echo "$OUT" | grep -q "NEGATIVE_CHECK_FAILED"; then
  fail "NEGATIVE check failed: unrelated user incorrectly had seat"
elif echo "$OUT" | grep -q "BYPASS_CHECK_FAILED"; then
  fail "WM-Consulting bypass check failed"
else
  fail "Unexpected output — insert or function may have failed. Output: $OUT"
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
