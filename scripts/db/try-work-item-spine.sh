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

# WITH_EXTRA=<file>[:<file>…]: later migrations stacked after 00196 and before
# the assertion file, so this suite can run against item 3's 00199 (and later)
# before they merge. Colon-separated, applied in order.
EXTRA=""
if [[ -n "${WITH_EXTRA:-}" ]]; then
  IFS=':' read -r -a _extra_files <<< "$WITH_EXTRA"
  for f in "${_extra_files[@]}"; do
    [[ -f "$f" ]] || { echo "ERROR: WITH_EXTRA file not found: $f" >&2; exit 1; }
    EXTRA+=$'\n'"$(cat "$f")"
  done
fi

# RFI-number sequence guard — the same one scripts/db/rehearse-sql.ts carries,
# for the same reason. projects.rfis.rfi_number is GENERATED ALWAYS AS IDENTITY
# (00002:83) and sequences are NOT transactional, so every fixture RFI an
# assertion file raises permanently consumes a number the ROLLBACK does not
# return (measured drift from these two suites: last_value 736 against
# max(rfi_number) 16 on 2026-09-15). Five of these files now create their own
# source rows — Task 15 Step 6b, because after item 3's backfill they can no
# longer share a live RFI — so this harness consumes them too.
#   * the capture reads BOTH operands right after BEGIN, before any migration or
#     assertion has run: reading max(rfi_number) at restore time instead would
#     read this transaction's own uncommitted fixture rows;
#   * the restore is a setval, which is non-transactional and therefore survives
#     the ROLLBACK while every fixture row vanishes with it;
#   * RESET ROLE first, because an assertion file may end impersonating and
#     `authenticated` cannot setval the sequence;
#   * a DO block returns no rows, so the "assertion files return nothing" shape
#     this harness relies on is unchanged.
# A file that RAISEs aborts the transaction before the restore and leaks its
# numbers — that is the failing path, and it is reported loudly either way.
SEQ_CAPTURE="CREATE TEMP TABLE _rehearse_seq_guard AS
SELECT s.last_value, s.is_called,
       (SELECT pg_catalog.max(r.rfi_number) FROM projects.rfis r) AS max_rfi_number
  FROM projects.rfis_rfi_number_seq s;"
SEQ_RESTORE="RESET ROLE;
DO \$_rehearse_seq_restore\$
BEGIN
  PERFORM pg_catalog.setval(
    'projects.rfis_rfi_number_seq',
    GREATEST((SELECT g.last_value FROM _rehearse_seq_guard g),
             COALESCE((SELECT g.max_rfi_number FROM _rehearse_seq_guard g), 0)),
    true);
END
\$_rehearse_seq_restore\$;"

SQL=$(printf 'BEGIN;\n%s\n%s\n%s\n%s\n%s\n%s\n%s\nROLLBACK;\n' \
  "$SEQ_CAPTURE" \
  "$PRELUDE" \
  "$(cat "$MIG1")" \
  "$(cat "$MIG2")" \
  "$EXTRA" \
  "$(cat "$ASSERT")" \
  "$SEQ_RESTORE")

rc=0
RESULT="$(mgmt_query "$SQL" 2>&1)" || rc=$?
if [[ $rc -ne 0 ]]; then
  echo "✗ $(basename "$ASSERT") — transaction aborted:" >&2
  printf '%s\n' "$RESULT" >&2
  exit 1
fi
echo "✓ $(basename "$ASSERT") — all assertions passed"
