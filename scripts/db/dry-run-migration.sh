#!/usr/bin/env bash
# Dry-run a migration against PRODUCTION inside rolled-back transactions.
#
#   scripts/db/dry-run-migration.sh <migration.sql> <assertions.sql> [more-assertions.sql ...]
#
# Each assertions file's LAST statement must return rows shaped
# (check text, ok boolean). Nothing is committed: every transaction is rolled
# back whether the assertions pass or fail, so this is safe to run against
# live data and leaves zero residue.
#
# ⚠ ONE Management-API call PER ASSERTIONS FILE, each wrapped as
#     BEGIN; <migration>; <that one file>; ROLLBACK;
# The API returns only the LAST NON-EMPTY result set of a multi-statement
# query (measured: `SELECT 1 AS a; SELECT 2 AS b;` → [{"b":2}], and a trailing
# empty SELECT or the ROLLBACK is skipped). Concatenating every file into one
# call therefore reported ONLY the last file's chain and silently discarded the
# rest — the seeded role-stamp assertion for 00194 was never evaluated-and-
# reported while the run printed green. The migration is applied-and-rolled-
# back once per file. Cost: seconds. Benefit: no assertion is ever discarded.
#
# A file that ABORTS (the migration or its assertions raise) or that produces
# NO rows is reported as one failed assertion and the remaining files still
# run, so the operator sees everything in one pass.
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

TOTAL=0
FAILED=0
FILES=0

echo "── dry run: $(basename "$MIG") + $* (each file in its own rolled-back transaction) ──"
for a in "$@"; do
  FILES=$((FILES + 1))
  NAME="$(basename "$a")"
  {
    echo "BEGIN;"
    cat "$MIG"
    echo
    cat "$a"
    echo
    echo "ROLLBACK;"
  } > "$TMP"

  echo "── $NAME ──"

  # Capture stderr too: mgmt_apply_sql_file surfaces an API error through
  # `jq -e error(...)`, which prints to stderr and exits non-zero. `|| rc=$?`
  # keeps errexit from killing the script before the summary.
  rc=0
  RESULT="$(mgmt_apply_sql_file "$TMP" 2>&1)" || rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "  ✗ $NAME aborted (API error, transaction rolled back):"
    printf '%s\n' "$RESULT" | sed 's/^/      /'
    FAILED=$((FAILED + 1))
    TOTAL=$((TOTAL + 1))
    continue
  fi

  ROWS=""
  ROWS="$(printf '%s' "$RESULT" | jq -e 'if type == "array" then length else error("unexpected response shape") end' 2>&1)" || {
    echo "  ✗ $NAME returned an unreadable response:"
    printf '%s\n' "$ROWS" | sed 's/^/      /'
    FAILED=$((FAILED + 1))
    TOTAL=$((TOTAL + 1))
    continue
  }
  if [[ "$ROWS" == "0" ]]; then
    echo "  ✗ $NAME produced NO rows — refusing to report green on nothing"
    FAILED=$((FAILED + 1))
    TOTAL=$((TOTAL + 1))
    continue
  fi

  printf '%s' "$RESULT" | jq -r '.[] | if .ok then "  ✓ \(.check)" else "  ✗ \(.check)" end'
  FILE_FAILED="$(printf '%s' "$RESULT" | jq '[.[] | select(.ok != true)] | length')"
  FAILED=$((FAILED + FILE_FAILED))
  TOTAL=$((TOTAL + ROWS))
done

if [[ "$FAILED" != "0" ]]; then
  echo "✗ $FAILED of $TOTAL assertion(s) failed across $FILES file(s)" >&2
  exit 1
fi
echo "✓ $TOTAL assertion(s) green across $FILES file(s) — transactions rolled back, nothing persisted"
