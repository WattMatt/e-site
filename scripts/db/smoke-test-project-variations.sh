#!/usr/bin/env bash
# scripts/db/smoke-test-project-variations.sh — verifies 00135 against the live DB, ROLLBACK-safe.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/mgmt-api.sh"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }
section() { echo ""; echo "── $1 ──"; }

FAILED=0

section "1. tables + RLS + boq_items columns"
OUT="$(mgmt_query "SELECT relname, relrowsecurity FROM pg_class
  WHERE relnamespace='projects'::regnamespace
    AND relname IN ('variation_orders','variation_lines') ORDER BY 1;" || true)"
echo "$OUT" | grep -q 'variation_orders' || { fail "variation_orders table missing"; }
echo "$OUT" | grep -q 'variation_lines'  || { fail "variation_lines table missing"; }

RLS_COUNT="$(mgmt_query "SELECT count(*)::int AS n FROM pg_class
  WHERE relnamespace='projects'::regnamespace
    AND relname IN ('variation_orders','variation_lines')
    AND relrowsecurity = true;" || true)"
N="$(echo "$RLS_COUNT" | jq -r '.[0].n')"
[[ "$N" == "2" ]] \
  && pass "RLS enabled on both variation tables" \
  || fail "expected RLS on 2 tables, got $N"

COL_OUT="$(mgmt_query "SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'projects' AND table_name = 'boq_items'
    AND column_name IN ('origin','variation_line_id')
  ORDER BY 1;" || true)"
echo "$COL_OUT" | grep -q 'origin'            || { fail "boq_items.origin column missing"; }
echo "$COL_OUT" | grep -q 'variation_line_id' || { fail "boq_items.variation_line_id column missing"; }
pass "boq_items.origin + variation_line_id columns present"

section "2. RLS policies exist (expect 4)"
OUT="$(mgmt_query "SELECT count(*)::int AS n FROM pg_policies
  WHERE schemaname = 'projects'
    AND tablename IN ('variation_orders','variation_lines');" || true)"
N="$(echo "$OUT" | jq -r '.[0].n')"
[[ "$N" == "4" ]] \
  && pass "4 RLS policies present" \
  || fail "expected 4 policies, got $N"

section "3. triggers exist (expect 3: variation_orders_set_no + 2 updated_at)"
OUT="$(mgmt_query "SELECT count(*)::int AS n FROM pg_trigger
  WHERE tgname IN ('variation_orders_set_no','variation_orders_set_updated_at','variation_lines_set_updated_at');" || true)"
N="$(echo "$OUT" | jq -r '.[0].n')"
[[ "$N" == "3" ]] \
  && pass "3 triggers present (set_no + 2 updated_at)" \
  || fail "expected 3 triggers, got $N"

section "4. vo_no auto-numbering + lines cascade (transactional, rolled back via RAISE)"
OUT="$(mgmt_query "DO \$\$
DECLARE p uuid; o uuid; imp uuid; vo1 uuid; vo2 uuid; no1 int; no2 int; item uuid; sect uuid;
BEGIN
  -- Pick a project that HAS a current BOQ import (not just the first project).
  SELECT i.project_id, i.organisation_id, i.id INTO p, o, imp
    FROM projects.boq_imports i WHERE i.is_current LIMIT 1;
  IF imp IS NULL THEN
    RAISE EXCEPTION 'SMOKE_SKIP: no current boq_import anywhere, cannot seed variation_order';
  END IF;

  -- Grab a boq_item for the adjust line and a boq_section for the add line.
  SELECT i.id, s.id INTO item, sect
    FROM projects.boq_items i
    JOIN projects.boq_sections s ON s.id = i.section_id
    WHERE s.import_id = imp LIMIT 1;
  IF item IS NULL THEN
    RAISE EXCEPTION 'SMOKE_SKIP: no boq_item found under import %, cannot seed variation_line', imp;
  END IF;

  -- First VO: vo_no auto-fills RELATIVE to whatever already exists (real VOs
  -- may be present) — assert it is a sane positive number, capture it.
  INSERT INTO projects.variation_orders(project_id, organisation_id, boq_import_id, vo_date, title)
    VALUES (p, o, imp, current_date, 'Smoke VO 1')
    RETURNING id, vo_no INTO vo1, no1;
  IF no1 < 1 THEN
    RAISE EXCEPTION 'FAIL: first vo_no should be >= 1, got %', no1;
  END IF;

  -- Second VO: vo_no should auto-fill to no1 + 1.
  INSERT INTO projects.variation_orders(project_id, organisation_id, boq_import_id, vo_date, title)
    VALUES (p, o, imp, current_date + 1, 'Smoke VO 2')
    RETURNING id, vo_no INTO vo2, no2;
  IF no2 <> no1 + 1 THEN
    RAISE EXCEPTION 'FAIL: second vo_no should be % (no1 + 1), got %', no1 + 1, no2;
  END IF;

  -- Insert an 'adjust' line under vo1 (references an existing boq_item).
  INSERT INTO projects.variation_lines(variation_order_id, kind, boq_item_id, qty_delta, value_change)
    VALUES (vo1, 'adjust', item, 5.000, 2500.00);

  -- Insert an 'add' line under vo1 (new item — no boq_item_id required).
  INSERT INTO projects.variation_lines(variation_order_id, kind, section_id, description, quantity, rate, value_change)
    VALUES (vo1, 'add', sect, 'Smoke new item', 10.000, 150.0000, 1500.00);

  RAISE EXCEPTION 'SMOKE_OK_ROLLBACK';
END \$\$;" 2>&1 || true)"
echo "$OUT" | grep -q 'SMOKE_OK_ROLLBACK' \
  && pass "vo_no auto-fills sequentially (no1, no1+1) + adjust + add lines inserted + rolled back" \
  || { fail "smoke DO-block failed — output: $OUT"; }

echo ""
if [[ "$FAILED" -eq 0 ]]; then
  echo "All checks passed."
else
  echo "One or more checks FAILED." >&2
  exit 1
fi
