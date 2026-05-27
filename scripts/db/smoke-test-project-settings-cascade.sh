#!/usr/bin/env bash
# Smoke-test the project-settings audit-trigger cascade fix (migration 00104).
# Proves that DELETE FROM projects.projects cascades cleanly to project_settings
# + project_settings_history without an FK violation.
#
# Runs entirely inside a single transaction that ROLLBACKs at the end.
# Safe to run against production.
#
# Usage:  scripts/db/smoke-test-project-settings-cascade.sh
# Exit:   0 on full green, non-zero on any failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }
section() { echo ""; echo "── $1 ──"; }

FAILED=0

section "1. Trigger function has the early-return on DELETE"
HAS_GUARD=$(mgmt_query "SELECT (prosrc LIKE '%TG_OP = ''DELETE''%RETURN OLD%')::text AS ok FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'projects' AND p.proname = 'project_settings_audit';" | jq -r '.[0].ok')
[[ "$HAS_GUARD" == "true" ]] && pass "trigger skips INSERT on TG_OP = 'DELETE'" || fail "trigger function does not have the DELETE guard — is migration 00104 applied?"

section "2. End-to-end cascade: project DELETE purges settings + history cleanly"
# Single multi-statement transaction:
#   - INSERT test project (auto-create trigger writes settings row)
#   - capture id + history_before into a temp table
#   - UPDATE settings (audit trigger writes another history row)
#   - DELETE project (cascade purges both — this is the line that used to fail)
#   - final SELECT returns before/after counts in one row
#   - ROLLBACK so prod state is unchanged
#
# If the DELETE step hits the old FK violation, the whole transaction errors
# out and we see it in the API response.
RESULT=$(mgmt_query "
BEGIN;

CREATE TEMP TABLE _cascade_t (project_id uuid, history_before int);

WITH new_proj AS (
  INSERT INTO projects.projects (name, organisation_id, created_by)
  VALUES (
    'CASCADE-SMOKE-DO-NOT-COMMIT',
    (SELECT id FROM public.organisations LIMIT 1),
    (SELECT id FROM public.profiles LIMIT 1)
  )
  RETURNING id
)
INSERT INTO _cascade_t (project_id) SELECT id FROM new_proj;

UPDATE projects.project_settings
   SET retention_pct = 9.99
 WHERE project_id = (SELECT project_id FROM _cascade_t);

UPDATE _cascade_t SET history_before = (
  SELECT count(*)::int FROM projects.project_settings_history
   WHERE project_id = _cascade_t.project_id
);

DELETE FROM projects.projects WHERE id = (SELECT project_id FROM _cascade_t);

SELECT
  history_before,
  (SELECT count(*)::int FROM projects.project_settings         WHERE project_id = _cascade_t.project_id) AS settings_after,
  (SELECT count(*)::int FROM projects.project_settings_history WHERE project_id = _cascade_t.project_id) AS history_after
FROM _cascade_t;

ROLLBACK;
")

HISTORY_BEFORE=$(echo "$RESULT" | jq -r '.[0].history_before // empty')
SETTINGS_AFTER=$(echo "$RESULT" | jq -r '.[0].settings_after // empty')
HISTORY_AFTER=$(echo "$RESULT"  | jq -r '.[0].history_after  // empty')

if [[ -z "$SETTINGS_AFTER" || -z "$HISTORY_AFTER" || -z "$HISTORY_BEFORE" ]]; then
  fail "could not parse cascade result — raw response: $RESULT"
else
  # Sanity: the UPDATE must have produced at least one history row, otherwise
  # the trigger isn't actually being exercised and the cascade test is hollow.
  (( HISTORY_BEFORE >= 1 )) && pass "audit trigger fired ($HISTORY_BEFORE history rows before DELETE)" || fail "expected ≥1 history row before DELETE, got $HISTORY_BEFORE — trigger not exercised"
  [[ "$SETTINGS_AFTER" == "0" ]] && pass "settings row cascade-purged" || fail "expected 0 settings rows after DELETE, got $SETTINGS_AFTER"
  [[ "$HISTORY_AFTER"  == "0" ]] && pass "history rows cascade-purged" || fail "expected 0 history rows after DELETE, got $HISTORY_AFTER"
fi

echo ""
if [[ "$FAILED" == "0" ]]; then
  echo "✓ CASCADE SMOKE TEST PASSED"
  exit 0
else
  echo "✗ CASCADE SMOKE TEST FAILED"
  exit 1
fi
