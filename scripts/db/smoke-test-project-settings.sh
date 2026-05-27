#!/usr/bin/env bash
# Smoke-test the project-settings DB foundation (migrations 00101–00103).
# Runs read-only checks + a transactional INSERT/UPDATE/DELETE round-trip
# that ROLLBACKs at the end. Safe to run against production.
#
# Usage:  scripts/db/smoke-test-project-settings.sh
# Exit:   0 on full green, non-zero on any failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }
section() { echo ""; echo "── $1 ──"; }

FAILED=0

section "1. Tables exist"
EXISTS=$(mgmt_query "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='projects' AND table_name IN ('project_settings','project_settings_history');" | jq -r '.[0].n')
[[ "$EXISTS" == "2" ]] && pass "both tables present" || fail "expected 2 tables in projects schema, got $EXISTS"

section "2. RLS enabled on both tables"
RLS=$(mgmt_query "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='projects' AND tablename IN ('project_settings','project_settings_history') AND rowsecurity;" | jq -r '.[0].n')
[[ "$RLS" == "2" ]] && pass "RLS enabled on both" || fail "expected RLS on 2 tables, got $RLS"

section "3. Expected RLS policies exist"
POLS=$(mgmt_query "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='projects' AND policyname IN ('project_settings_select','project_settings_write','project_settings_history_select');" | jq -r '.[0].n')
[[ "$POLS" == "3" ]] && pass "all 3 named policies present" || fail "expected 3 policies, got $POLS"

section "4. Triggers exist"
TRIGS=$(mgmt_query "SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='projects' AND t.tgname IN ('project_settings_set_updated_at','project_settings_audit_trg','project_ensure_settings');" | jq -r '.[0].n')
[[ "$TRIGS" == "3" ]] && pass "all 3 triggers present" || fail "expected 3 triggers, got $TRIGS"

section "5. Backfill row-count matches projects count"
COUNTS=$(mgmt_query "SELECT (SELECT count(*) FROM projects.projects)::int AS proj, (SELECT count(*) FROM projects.project_settings)::int AS settings;" | jq -r '.[0] | "\(.proj) \(.settings)"')
PROJ=$(echo $COUNTS | awk '{print $1}')
SET=$(echo $COUNTS | awk '{print $2}')
[[ "$PROJ" == "$SET" ]] && pass "$PROJ projects, $SET settings rows" || fail "row-count mismatch: $PROJ projects vs $SET settings"

section "6. UPDATE round-trip writes a history row with snapshot + diff"
# Pick the first project; UPDATE one field; check history; ROLLBACK to leave no trace.
# NOTE: must use multi-statement (not data-modifying CTE) because the CTE's
# trigger writes are NOT visible to a sibling SELECT in the same snapshot.
RESULT=$(mgmt_query "
BEGIN;
CREATE TEMP TABLE _smoke_t AS SELECT project_id FROM projects.project_settings LIMIT 1;
UPDATE projects.project_settings SET retention_pct = 7.5 WHERE project_id IN (SELECT project_id FROM _smoke_t);
SELECT h.operation AS op,
       (h.diff->'retention_pct'->>0)::numeric AS old_pct,
       (h.diff->'retention_pct'->>1)::numeric AS new_pct,
       (h.snapshot->>'project_id')::uuid = (SELECT project_id FROM _smoke_t) AS snap_matches
  FROM projects.project_settings_history h
  WHERE h.project_id IN (SELECT project_id FROM _smoke_t)
    AND h.operation = 'UPDATE'
  ORDER BY h.changed_at DESC LIMIT 1;
ROLLBACK;
")
OP=$(echo "$RESULT" | jq -r '.[0].op')
OLD=$(echo "$RESULT" | jq -r '.[0].old_pct')
NEW=$(echo "$RESULT" | jq -r '.[0].new_pct')
SNAP=$(echo "$RESULT" | jq -r '.[0].snap_matches')

[[ "$OP" == "UPDATE" ]] && pass "history op=UPDATE" || fail "history op was '$OP', expected UPDATE"
[[ "$NEW" == "7.50" || "$NEW" == "7.5" ]] && pass "diff new_val=7.5" || fail "diff new_val was '$NEW', expected 7.5"
[[ "$OLD" == "5.00" || "$OLD" == "5.0" ]] && pass "diff old_val=5.0 (default)" || fail "diff old_val was '$OLD', expected 5.0"
[[ "$SNAP" == "true" ]] && pass "snapshot.project_id matches the target row" || fail "snapshot project_id mismatch"

section "7. Auto-create trigger fires on new project insertion"
# Multi-statement: INSERT first (trigger fires); then SELECT sees the trigger's write.
RESULT=$(mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by)
SELECT 'SMOKE-TEST-DO-NOT-COMMIT',
       (SELECT id FROM public.organisations LIMIT 1),
       (SELECT id FROM public.profiles LIMIT 1);
SELECT EXISTS(
  SELECT 1 FROM projects.project_settings ps
   JOIN projects.projects p ON p.id = ps.project_id
   WHERE p.name = 'SMOKE-TEST-DO-NOT-COMMIT'
) AS settings_created;
ROLLBACK;
")
CREATED=$(echo "$RESULT" | jq -r '.[0].settings_created')
[[ "$CREATED" == "true" ]] && pass "auto-create trigger fired" || fail "auto-create trigger did not fire"

echo ""
if [[ "$FAILED" == "0" ]]; then
  echo "✓ ALL SMOKE TESTS PASSED"
  exit 0
else
  echo "✗ SMOKE TESTS FAILED"
  exit 1
fi
