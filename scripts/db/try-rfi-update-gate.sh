#!/usr/bin/env bash
# Apply 00201 (the RFI write gate) plus its assertion file inside a SINGLE
# transaction against production, then ROLLBACK. Zero residue.
#
# This is the red/green loop for the gate. It runs against the real schema, the
# real RLS, the real role grants and the real rbac-test fixture — the only
# place the failures this migration guards against are visible.
#
#   scripts/db/try-rfi-update-gate.sh [assertions.sql]
#
# ⚠ The Management API returns only the LAST non-empty result set per call
# (see scripts/db/dry-run-migration.sh's header for the measured proof). That
# is why the assertion file RAISEs on failure rather than returning a
# (check, ok) row: a raise aborts the whole transaction and surfaces through
# mgmt_query's non-zero exit, so it cannot be silently discarded the way a
# trailing SELECT could be. Do not rewrite it to return rows instead — it
# would still "pass" on read, just unobserved.
#
# Env: BARE=1 runs the assertions WITHOUT the migration — the red run. Every
#      authorisation assertion must fail there; a check you have never seen
#      fail is decorative. Expect it to abort on assertion 1's SENTINEL,
#      which is today's production behaviour.
#
# Exit: 0 when every assertion passed; non-zero on the first RAISE.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

MIG="$ROOT/apps/edge-functions/supabase/migrations/00201_rfi_write_authority.sql"
ASSERT="${1:-$SCRIPT_DIR/assertions/rfi-update-gate.sql}"

[[ -f "$ASSERT" ]] || { echo "ERROR: no such assertion file: $ASSERT" >&2; exit 1; }

BODY=""
if [[ "${BARE:-0}" != "1" ]]; then
  [[ -f "$MIG" ]] || { echo "ERROR: missing $MIG (set BARE=1 for the red run)" >&2; exit 1; }
  BODY="$(cat "$MIG")"
fi

SQL=$(printf 'BEGIN;\n%s\n%s\nROLLBACK;\n' "$BODY" "$(cat "$ASSERT")")

rc=0
RESULT="$(mgmt_query "$SQL" 2>&1)" || rc=$?
if [[ $rc -ne 0 ]]; then
  echo "✗ $(basename "$ASSERT")${BARE:+ (BARE — no migration)} — transaction aborted:" >&2
  printf '%s\n' "$RESULT" >&2
  exit 1
fi
echo "✓ $(basename "$ASSERT")${BARE:+ (BARE — no migration)} — all assertions passed, transaction rolled back"
