#!/usr/bin/env bash
# Apply BOTH work-item migrations plus one assertion file inside a SINGLE
# transaction against production, then ROLLBACK. Zero residue.
#
# This is the red/green loop for every SQL task in the work-item spine plan.
# It runs against the real schema, the real RLS and the real role grants —
# which is the only place the failures this plan guards against are visible.
#
# ⚠ The Management API returns only the LAST non-empty result set per call
# (see scripts/db/dry-run-migration.sh's header for the measured proof). That
# is why every assertion file here must RAISE EXCEPTION on failure rather than
# return a (check, ok) row: a raise aborts the whole transaction and surfaces
# through mgmt_query's non-zero exit, so it cannot be silently discarded the
# way a trailing SELECT could be. Do not rewrite an assertion file to return
# rows instead — it would still "pass" on read, just unobserved.
#
# Usage:   scripts/db/try-work-item-spine.sh scripts/db/assertions/work-item-ddl.sql
# Env:     WITH_ITEM1=1  also applies item 1's calendar migration first, for
#          development before that migration is live. Item 1 (public_holidays,
#          calendar_years, working_days_between) has been LIVE in production
#          since 2026-09-11 (PR #184, migration 00194), so this flag is
#          normally unnecessary — kept for a future session that runs this
#          harness before item 1 has landed on whatever it is developing against.
# Exit:    0 when every assertion passed; non-zero on the first RAISE.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIG_DIR="$ROOT/apps/edge-functions/supabase/migrations"

ASSERT="${1:?usage: try-work-item-spine.sh <assertions.sql>}"
[[ -f "$ASSERT" ]] || { echo "ERROR: no such assertion file: $ASSERT" >&2; exit 1; }

MIG1="$MIG_DIR/00195_work_item_project_settings.sql"
MIG2="$MIG_DIR/00196_work_item_spine.sql"

# Fail loudly, before any API call, if either migration file is missing —
# this is what a fresh checkout (or a not-yet-written Task 3/4) must hit.
[[ -f "$MIG1" ]] || { echo "ERROR: missing $MIG1" >&2; exit 1; }
[[ -f "$MIG2" ]] || { echo "ERROR: missing $MIG2" >&2; exit 1; }

PRELUDE=""
if [[ "${WITH_ITEM1:-0}" == "1" ]]; then
  ITEM1=$(ls "$MIG_DIR"/*_q1_metrics_presence_calendar.sql 2>/dev/null | head -1 || true)
  [[ -n "$ITEM1" ]] || { echo "ERROR: WITH_ITEM1=1 but no item-1 migration found" >&2; exit 1; }
  PRELUDE=$(cat "$ITEM1")
fi

SQL=$(printf 'BEGIN;\n%s\n%s\n%s\n%s\nROLLBACK;\n' \
  "$PRELUDE" \
  "$(cat "$MIG1")" \
  "$(cat "$MIG2")" \
  "$(cat "$ASSERT")")

rc=0
RESULT="$(mgmt_query "$SQL" 2>&1)" || rc=$?
if [[ $rc -ne 0 ]]; then
  echo "✗ $(basename "$ASSERT") — transaction aborted:" >&2
  printf '%s\n' "$RESULT" >&2
  exit 1
fi
echo "✓ $(basename "$ASSERT") — all assertions passed"
