#!/usr/bin/env bash
# scripts/db/smoke-test-project-boq.sh — verifies 00122 against the live DB, ROLLBACK-safe.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/mgmt-api.sh"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }
section() { echo ""; echo "── $1 ──"; }

FAILED=0

section "1. tables exist + RLS enabled"
OUT="$(mgmt_query "SELECT relname, relrowsecurity FROM pg_class
  WHERE relnamespace='projects'::regnamespace AND relname LIKE 'boq_%' ORDER BY 1;" || true)"
echo "$OUT" | grep -q 'boq_imports'  || { fail "boq_imports missing"; }
echo "$OUT" | grep -q 'boq_items'    || { fail "boq_items missing"; }
echo "$OUT" | grep -q 'boq_sections' || { fail "boq_sections missing"; }
# Verify relrowsecurity is actually true for all three tables
RLS_COUNT="$(mgmt_query "SELECT count(*)::int AS n FROM pg_class
  WHERE relnamespace='projects'::regnamespace AND relname IN ('boq_imports','boq_sections','boq_items')
  AND relrowsecurity = true;" || true)"
N="$(echo "$RLS_COUNT" | jq -r '.[0].n')"
[[ "$N" == "3" ]] && pass "RLS enabled on all 3 boq tables" || fail "expected RLS on 3 tables, got $N"

section "2. table RLS policies exist (expect >= 6)"
OUT="$(mgmt_query "SELECT count(*)::int AS n FROM pg_policies
  WHERE schemaname = 'projects' AND tablename LIKE 'boq_%';" || true)"
N="$(echo "$OUT" | jq -r '.[0].n')"
[[ "$N" -ge 6 ]] && pass "6 table RLS policies present (got $N)" || fail "expected >= 6 table policies, got $N"

section "3. updated_at triggers exist (expect 3)"
OUT="$(mgmt_query "SELECT count(*)::int AS n FROM pg_trigger
  WHERE tgname IN ('boq_imports_set_updated_at','boq_sections_set_updated_at','boq_items_set_updated_at');" || true)"
N="$(echo "$OUT" | jq -r '.[0].n')"
[[ "$N" == "3" ]] && pass "3 updated_at triggers present" || fail "expected 3 triggers, got $N"

section "4. composite FK boq_sections_parent_fk exists"
OUT="$(mgmt_query "SELECT count(*)::int AS n FROM pg_constraint
  WHERE conrelid = 'projects.boq_sections'::regclass AND conname = 'boq_sections_parent_fk';" || true)"
N="$(echo "$OUT" | jq -r '.[0].n')"
[[ "$N" == "1" ]] && pass "boq_sections_parent_fk present" || fail "boq_sections_parent_fk missing (got $N)"

section "5. one-current partial unique + cascade (transactional, rolled back via RAISE)"
OUT="$(mgmt_query "DO \$\$
DECLARE p uuid; o uuid; imp uuid; sec uuid;
BEGIN
  SELECT id, organisation_id INTO p, o FROM projects.projects LIMIT 1;
  INSERT INTO projects.boq_imports(project_id,organisation_id,source_filename)
    VALUES (p,o,'smoke.xlsx') RETURNING id INTO imp;
  INSERT INTO projects.boq_sections(import_id,kind,title) VALUES (imp,'bill','SMOKE BILL') RETURNING id INTO sec;
  INSERT INTO projects.boq_items(section_id,description,amount) VALUES (sec,'smoke item',100.00);
  -- second current import for same project must fail the partial unique
  BEGIN
    INSERT INTO projects.boq_imports(project_id,organisation_id,source_filename)
      VALUES (p,o,'smoke2.xlsx');
    RAISE EXCEPTION 'FAIL: second is_current insert should have been rejected';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  RAISE EXCEPTION 'SMOKE_OK_ROLLBACK';
END \$\$;" || true)"
echo "$OUT" | grep -q 'SMOKE_OK_ROLLBACK' && pass "one-current partial unique enforced + rolled back" || { fail "smoke asserts: $OUT"; }

echo ""
if [[ "$FAILED" == "0" ]]; then
  echo "✓ ALL SMOKE TESTS PASSED"
  exit 0
else
  echo "✗ SMOKE TESTS FAILED"
  exit 1
fi
