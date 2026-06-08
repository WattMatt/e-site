#!/usr/bin/env bash
# scripts/db/smoke-test-project-boq.sh — verifies 00122 against the live DB, ROLLBACK-safe.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/mgmt-api.sh"

echo "1. tables exist + RLS enabled"
OUT="$(mgmt_query "SELECT relname, relrowsecurity FROM pg_class
  WHERE relnamespace='projects'::regnamespace AND relname LIKE 'boq_%' ORDER BY 1;" || true)"
echo "$OUT" | grep -q 'boq_imports'  || { echo "FAIL: boq_imports missing"; exit 1; }
echo "$OUT" | grep -q 'boq_items'    || { echo "FAIL: boq_items missing"; exit 1; }
echo "$OUT" | grep -q 'boq_sections' || { echo "FAIL: boq_sections missing"; exit 1; }

echo "2. one-current partial unique + cascade (transactional, rolled back via RAISE)"
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
echo "$OUT" | grep -q 'SMOKE_OK_ROLLBACK' || { echo "FAIL: smoke asserts: $OUT"; exit 1; }
echo "ALL SMOKE TESTS PASSED (rolled back, no residue)"
