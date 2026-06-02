#!/usr/bin/env bash
# Smoke-test the anchor sub-boards schema (migration 00116).
# Read-only catalog checks + transactional INSERT/UPDATE/DELETE round-trips
# that ROLLBACK at the end. Safe to run against production.
#
# Usage:  scripts/db/smoke-test-anchor-sub-boards.sh
# Exit:   0 on full green, non-zero on any failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }
section() { echo ""; echo "── $1 ──"; }

FAILED=0

# Reusable SQL fragment: pick any org + profile for fixture inserts.
ORG="(SELECT id FROM public.organisations LIMIT 1)"
WHO="(SELECT id FROM public.profiles LIMIT 1)"

section "1. parent_node_id column exists on structure.nodes"
N=$(mgmt_query "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='structure' AND table_name='nodes' AND column_name='parent_node_id';" | jq -r '.[0].n')
[[ "$N" == "1" ]] && pass "parent_node_id present" || fail "parent_node_id missing (got $N)"

section "2. constraints / index / trigger exist"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid='structure.nodes'::regclass AND conname IN ('nodes_parent_fk','nodes_project_id_key','nodes_no_self_parent');" | jq -r '.[0].n')
[[ "$N" == "3" ]] && pass "parent FK + unique + self-parent CHECK present" || fail "expected 3 constraints, got $N"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid='structure.nodes'::regclass AND tgname='structure_nodes_prevent_cycle';" | jq -r '.[0].n')
[[ "$N" == "1" ]] && pass "cycle trigger present" || fail "cycle trigger missing (got $N)"

section "3. kind CHECK now includes sub_board"
OK=$(mgmt_query "SELECT (pg_get_constraintdef(oid) ILIKE '%sub_board%') AS ok FROM pg_constraint WHERE conrelid='structure.nodes'::regclass AND conname='nodes_kind_check';" | jq -r '.[0].ok')
[[ "$OK" == "true" ]] && pass "sub_board accepted by kind CHECK" || fail "kind CHECK missing sub_board"

section "4. tenant_units table + RLS + 5 policies"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='structure' AND tablename='tenant_units' AND rowsecurity;" | jq -r '.[0].n')
[[ "$N" == "1" ]] && pass "tenant_units exists with RLS enabled" || fail "tenant_units missing or RLS off (got $N)"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='structure' AND tablename='tenant_units';" | jq -r '.[0].n')
[[ "$N" == "5" ]] && pass "5 RLS policies present" || fail "expected 5 policies, got $N"

section "5. POSITIVE: sub_board child links to its tenant_db parent (same project)"
RESULT=$(mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-ANCHOR-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'SMOKE-ANCHOR', 'Smoke Anchor'
  FROM projects.projects p WHERE p.name='SMOKE-ANCHOR-DNC';
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name, parent_node_id)
  SELECT p.id, p.organisation_id, 'sub_board', 'SMOKE-SUB', 'Smoke Sub',
         (SELECT n.id FROM structure.nodes n WHERE n.project_id=p.id AND n.code='SMOKE-ANCHOR')
  FROM projects.projects p WHERE p.name='SMOKE-ANCHOR-DNC';
SELECT (child.parent_node_id = parent.id) AS link_ok, child.kind AS sub_kind
  FROM structure.nodes child
  JOIN projects.projects p ON p.id=child.project_id AND p.name='SMOKE-ANCHOR-DNC'
  JOIN structure.nodes parent ON parent.project_id=p.id AND parent.code='SMOKE-ANCHOR'
  WHERE child.code='SMOKE-SUB';
ROLLBACK;
")
LINK=$(echo "$RESULT" | jq -r '.[0].link_ok')
KIND=$(echo "$RESULT" | jq -r '.[0].sub_kind')
[[ "$LINK" == "true" ]] && pass "child.parent_node_id = parent.id" || fail "parent link wrong ($LINK)"
[[ "$KIND" == "sub_board" ]] && pass "sub_board row inserted" || fail "sub_board kind rejected ($KIND)"

# NOTE on the NEGATIVE sections (6–9, 12): mgmt_query exits non-zero on ANY API
# error and these blocks discard stderr, so they assert "rejected" on non-zero
# exit. Each block's fixtures are otherwise valid, so the ONLY statement that can
# fail is the one under test. Preserve that invariant if you edit a fixture here.
section "6. NEGATIVE: self-parent is rejected"
if ! mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-SELF-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'SELF', 'Self' FROM projects.projects p WHERE p.name='SMOKE-SELF-DNC';
UPDATE structure.nodes n SET parent_node_id = n.id
  WHERE n.code='SELF' AND n.project_id=(SELECT id FROM projects.projects WHERE name='SMOKE-SELF-DNC');
ROLLBACK;
" >/dev/null 2>&1; then pass "self-parent rejected"; else fail "self-parent was NOT rejected"; fi

section "7. NEGATIVE: cross-project parent is rejected"
if ! mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-P1-DNC', $ORG, $WHO;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-P2-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'N1', 'N1' FROM projects.projects p WHERE p.name='SMOKE-P1-DNC';
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'N2', 'N2' FROM projects.projects p WHERE p.name='SMOKE-P2-DNC';
UPDATE structure.nodes n
  SET parent_node_id = (SELECT n2.id FROM structure.nodes n2 JOIN projects.projects p2 ON p2.id=n2.project_id
                        WHERE p2.name='SMOKE-P2-DNC' AND n2.code='N2')
  WHERE n.code='N1' AND n.project_id=(SELECT id FROM projects.projects WHERE name='SMOKE-P1-DNC');
ROLLBACK;
" >/dev/null 2>&1; then pass "cross-project parent rejected"; else fail "cross-project parent was NOT rejected"; fi

section "8. NEGATIVE: a transitive cycle is rejected"
if ! mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-CYC-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'A', 'A' FROM projects.projects p WHERE p.name='SMOKE-CYC-DNC';
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name, parent_node_id)
  SELECT p.id, p.organisation_id, 'sub_board', 'B', 'B',
         (SELECT n.id FROM structure.nodes n WHERE n.project_id=p.id AND n.code='A')
  FROM projects.projects p WHERE p.name='SMOKE-CYC-DNC';
UPDATE structure.nodes a
  SET parent_node_id = (SELECT b.id FROM structure.nodes b JOIN projects.projects p ON p.id=b.project_id
                        WHERE p.name='SMOKE-CYC-DNC' AND b.code='B')
  WHERE a.code='A' AND a.project_id=(SELECT id FROM projects.projects WHERE name='SMOKE-CYC-DNC');
ROLLBACK;
" >/dev/null 2>&1; then pass "cycle rejected"; else fail "cycle was NOT rejected"; fi

section "9. NEGATIVE: deleting a parent that still has children is blocked"
if ! mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-DEL-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'PARENT', 'Parent' FROM projects.projects p WHERE p.name='SMOKE-DEL-DNC';
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name, parent_node_id)
  SELECT p.id, p.organisation_id, 'sub_board', 'CHILD', 'Child',
         (SELECT n.id FROM structure.nodes n WHERE n.project_id=p.id AND n.code='PARENT')
  FROM projects.projects p WHERE p.name='SMOKE-DEL-DNC';
DELETE FROM structure.nodes
  WHERE code='PARENT' AND project_id=(SELECT id FROM projects.projects WHERE name='SMOKE-DEL-DNC');
ROLLBACK;
" >/dev/null 2>&1; then pass "delete-with-children blocked (NO ACTION)"; else fail "delete-with-children was NOT blocked"; fi

section "10. POSITIVE: deleting the whole project cascades through the tree"
REMAIN=$(mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-CASCADE-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'SMOKE-CASCADE-A', 'A' FROM projects.projects p WHERE p.name='SMOKE-CASCADE-DNC';
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name, parent_node_id)
  SELECT p.id, p.organisation_id, 'sub_board', 'SMOKE-CASCADE-B', 'B',
         (SELECT n.id FROM structure.nodes n WHERE n.project_id=p.id AND n.code='SMOKE-CASCADE-A')
  FROM projects.projects p WHERE p.name='SMOKE-CASCADE-DNC';
DELETE FROM projects.projects WHERE name='SMOKE-CASCADE-DNC';
SELECT count(*)::int AS remaining FROM structure.nodes WHERE code IN ('SMOKE-CASCADE-A','SMOKE-CASCADE-B');
ROLLBACK;
" | jq -r '.[0].remaining')
[[ "$REMAIN" == "0" ]] && pass "project cascade removed all nodes (NO ACTION did not block)" || fail "expected 0 remaining nodes, got $REMAIN"

section "11. POSITIVE: tenant_units insert round-trip"
N=$(mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-TU-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'SMOKE-TU-A', 'A' FROM projects.projects p WHERE p.name='SMOKE-TU-DNC';
INSERT INTO structure.tenant_units (node_id, shop_number, area_m2)
  SELECT n.id, 'UNIT-13', 250
  FROM structure.nodes n JOIN projects.projects p ON p.id=n.project_id
  WHERE p.name='SMOKE-TU-DNC' AND n.code='SMOKE-TU-A';
SELECT count(*)::int AS n FROM structure.tenant_units tu
  JOIN structure.nodes nn ON nn.id=tu.node_id
  JOIN projects.projects pp ON pp.id=nn.project_id
  WHERE pp.name='SMOKE-TU-DNC';
ROLLBACK;
" | jq -r '.[0].n')
[[ "$N" == "1" ]] && pass "tenant_units row inserted + readable" || fail "expected 1 tenant_units row, got $N"

section "12. NEGATIVE: tenant_units.area_m2 must be positive"
if ! mgmt_query "
BEGIN;
INSERT INTO projects.projects (name, organisation_id, created_by) SELECT 'SMOKE-AREA-DNC', $ORG, $WHO;
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'SMOKE-AREA-A', 'A' FROM projects.projects p WHERE p.name='SMOKE-AREA-DNC';
INSERT INTO structure.tenant_units (node_id, shop_number, area_m2)
  SELECT n.id, 'UNIT-BAD', -5
  FROM structure.nodes n JOIN projects.projects p ON p.id=n.project_id
  WHERE p.name='SMOKE-AREA-DNC' AND n.code='SMOKE-AREA-A';
ROLLBACK;
" >/dev/null 2>&1; then pass "negative area_m2 rejected"; else fail "negative area_m2 was NOT rejected"; fi

echo ""
if [[ "$FAILED" == "0" ]]; then
  echo "✓ ALL SMOKE TESTS PASSED"
  exit 0
else
  echo "✗ SMOKE TESTS FAILED"
  exit 1
fi
