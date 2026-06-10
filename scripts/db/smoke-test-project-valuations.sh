#!/usr/bin/env bash
# scripts/db/smoke-test-project-valuations.sh — verifies 00127 against the live DB, ROLLBACK-safe.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/mgmt-api.sh"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }
section() { echo ""; echo "── $1 ──"; }

FAILED=0

section "1. tables exist + RLS enabled"
OUT="$(mgmt_query "SELECT relname, relrowsecurity FROM pg_class
  WHERE relnamespace='projects'::regnamespace AND relname IN ('valuations','valuation_lines') ORDER BY 1;" || true)"
echo "$OUT" | grep -q 'valuations'      || { fail "valuations table missing"; }
echo "$OUT" | grep -q 'valuation_lines' || { fail "valuation_lines table missing"; }
RLS_COUNT="$(mgmt_query "SELECT count(*)::int AS n FROM pg_class
  WHERE relnamespace='projects'::regnamespace AND relname IN ('valuations','valuation_lines')
  AND relrowsecurity = true;" || true)"
N="$(echo "$RLS_COUNT" | jq -r '.[0].n')"
[[ "$N" == "2" ]] && pass "RLS enabled on both valuation tables" || fail "expected RLS on 2 tables, got $N"

section "2. RLS policies exist (expect 4)"
OUT="$(mgmt_query "SELECT count(*)::int AS n FROM pg_policies
  WHERE schemaname = 'projects' AND tablename IN ('valuations','valuation_lines');" || true)"
N="$(echo "$OUT" | jq -r '.[0].n')"
[[ "$N" == "4" ]] && pass "4 RLS policies present" || fail "expected 4 policies, got $N"

section "3. triggers exist (expect 3: valuations_set_no + 2 updated_at)"
OUT="$(mgmt_query "SELECT count(*)::int AS n FROM pg_trigger
  WHERE tgname IN ('valuations_set_no','valuations_set_updated_at','valuation_lines_set_updated_at');" || true)"
N="$(echo "$OUT" | jq -r '.[0].n')"
[[ "$N" == "3" ]] && pass "3 triggers present (set_no + 2 updated_at)" || fail "expected 3 triggers, got $N"

section "4. valuation_no auto-numbering + cascade (transactional, rolled back via RAISE)"
OUT="$(mgmt_query "DO \$\$
DECLARE p uuid; o uuid; imp uuid; v1 uuid; v2 uuid; no1 int; no2 int; item uuid;
BEGIN
  SELECT id, organisation_id INTO p, o FROM projects.projects LIMIT 1;
  SELECT id INTO imp FROM projects.boq_imports WHERE project_id = p LIMIT 1;
  IF imp IS NULL THEN
    RAISE EXCEPTION 'SMOKE_SKIP: no boq_import found for project %, cannot seed valuation', p;
  END IF;
  SELECT i.id INTO item FROM projects.boq_items i
    JOIN projects.boq_sections s ON s.id = i.section_id
    WHERE s.import_id = imp LIMIT 1;
  IF item IS NULL THEN
    RAISE EXCEPTION 'SMOKE_SKIP: no boq_item found under import %, cannot seed valuation_line', imp;
  END IF;
  -- first valuation: valuation_no should auto-fill to 1
  INSERT INTO projects.valuations(project_id, organisation_id, boq_import_id, valuation_date, retention_pct)
    VALUES (p, o, imp, current_date, 10.00)
    RETURNING id, valuation_no INTO v1, no1;
  IF no1 <> 1 THEN
    RAISE EXCEPTION 'FAIL: first valuation_no should be 1, got %', no1;
  END IF;
  -- second valuation: valuation_no should auto-fill to 2
  INSERT INTO projects.valuations(project_id, organisation_id, boq_import_id, valuation_date, retention_pct)
    VALUES (p, o, imp, current_date + 1, 10.00)
    RETURNING id, valuation_no INTO v2, no2;
  IF no2 <> 2 THEN
    RAISE EXCEPTION 'FAIL: second valuation_no should be 2, got %', no2;
  END IF;
  -- insert a valuation_line under v1
  INSERT INTO projects.valuation_lines(valuation_id, boq_item_id, input_method, percent_complete, value_to_date)
    VALUES (v1, item, 'percent', 50.000, 500.00);
  RAISE EXCEPTION 'SMOKE_OK_ROLLBACK';
END \$\$;" 2>&1 || true)"
echo "$OUT" | grep -q 'SMOKE_OK_ROLLBACK' && pass "valuation_no auto-fills 1,2 + line inserted + rolled back" || { fail "smoke asserts: $OUT"; }

echo ""
if [[ "$FAILED" == "0" ]]; then
  echo "✓ ALL SMOKE TESTS PASSED"
  exit 0
else
  echo "✗ SMOKE TESTS FAILED"
  exit 1
fi
