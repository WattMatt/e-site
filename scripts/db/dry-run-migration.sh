#!/usr/bin/env bash
# Dry-run a migration against PRODUCTION inside a rolled-back transaction.
#
#   scripts/db/dry-run-migration.sh <migration.sql> <assertions.sql> [more-assertions.sql ...]
#
# The LAST statement across all assertion files must return rows shaped
# (check text, ok boolean). Nothing is committed: the transaction is rolled
# back whether the assertions pass or fail, so this is safe to run against
# live data and leaves zero residue.
#
# This is the red/green loop for SQL. Run it BEFORE writing the DDL and watch
# the assertion fail; a check you have never seen fail is decorative.
#
# Two things this harness cannot do, stated so nobody finds out the hard way:
#   • CREATE INDEX CONCURRENTLY cannot run inside a transaction. Use a plain
#     CREATE INDEX (fine on a brand-new empty table) or apply it outside.
#   • NOTIFY pgrst inside the transaction is queued and discarded on rollback.
#     Harmless here; the real apply issues it for real.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"

MIG="${1:?usage: dry-run-migration.sh <migration.sql> <assertions.sql> [...]}"
shift
[[ $# -ge 1 ]] || { echo "ERROR: at least one assertions file is required" >&2; exit 1; }
[[ -f "$MIG" ]] || { echo "ERROR: no such migration: $MIG" >&2; exit 1; }
for a in "$@"; do
  [[ -f "$a" ]] || { echo "ERROR: no such assertions file: $a" >&2; exit 1; }
done

TMP="$(mktemp -t dryrun)"
trap 'rm -f "$TMP"' EXIT
{
  echo "BEGIN;"
  cat "$MIG"
  echo
  for a in "$@"; do cat "$a"; echo; done
  echo "ROLLBACK;"
} > "$TMP"

echo "── dry run: $(basename "$MIG") + $* (rolled back) ──"
RESULT="$(mgmt_apply_sql_file "$TMP")"
echo "$RESULT" | jq -r '.[] | if .ok then "  ✓ \(.check)" else "  ✗ \(.check)" end'

FAILED="$(echo "$RESULT" | jq '[.[] | select(.ok != true)] | length')"
TOTAL="$(echo "$RESULT" | jq 'length')"
if [[ "$TOTAL" == "0" ]]; then
  echo "✗ the assertions produced NO rows — refusing to report green on nothing" >&2
  exit 1
fi
if [[ "$FAILED" != "0" ]]; then
  echo "✗ $FAILED of $TOTAL assertion(s) failed" >&2
  exit 1
fi
echo "✓ $TOTAL assertion(s) green — transaction rolled back, nothing persisted"
