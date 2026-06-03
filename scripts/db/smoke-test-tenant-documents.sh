#!/usr/bin/env bash
# =============================================================================
# Smoke-test migration 00118 — tenant_documents + tenant_document_revisions.
#
# Runs the full migration DDL inside a transaction, exercises the status-derive
# triggers, tests the backfill logic, then ROLLBACKs — leaving the DB untouched.
#
# Usage:  scripts/db/smoke-test-tenant-documents.sh
# Exit:   0 on full green, non-zero on any failure.
#
# NOTE: multi-statement transactions (semicolon-separated) are used throughout
# so that trigger writes are visible to subsequent SELECTs in the same
# transaction. Data-modifying CTEs share a snapshot and would hide trigger
# writes from sibling SELECTs.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"

MIGRATION="$(cd "$SCRIPT_DIR/../.." && pwd)/apps/edge-functions/supabase/migrations/00118_tenant_documents.sql"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }
section() { echo ""; echo "── $1 ──"; }

FAILED=0

# Reusable fixtures: pick any real org + profile for seeding test rows.
ORG="(SELECT id FROM public.organisations LIMIT 1)"
WHO="(SELECT id FROM public.profiles LIMIT 1)"

# ---------------------------------------------------------------------------
# 1. Apply migration DDL + run all tests inside one transaction.
#    The ROLLBACK at the end leaves no data.
# ---------------------------------------------------------------------------

# Read migration SQL once — we inline it into the transaction below.
MIGRATION_SQL="$(cat "$MIGRATION")"

section "1. Tables created (tenant_documents + tenant_document_revisions)"
RESULT=$(mgmt_query "
BEGIN;
${MIGRATION_SQL}
SELECT
  (SELECT count(*)::int FROM information_schema.tables
    WHERE table_schema='structure' AND table_name='tenant_documents') AS td_exists,
  (SELECT count(*)::int FROM information_schema.tables
    WHERE table_schema='structure' AND table_name='tenant_document_revisions') AS tdr_exists;
ROLLBACK;
")
TD=$(echo "$RESULT" | jq -r '.[0].td_exists')
TDR=$(echo "$RESULT" | jq -r '.[0].tdr_exists')
[[ "$TD" == "1" ]] && pass "tenant_documents table exists" || fail "tenant_documents missing (got $TD)"
[[ "$TDR" == "1" ]] && pass "tenant_document_revisions table exists" || fail "tenant_document_revisions missing (got $TDR)"

section "2. RLS enabled + 4 policies (2 per table)"
RESULT=$(mgmt_query "
BEGIN;
${MIGRATION_SQL}
SELECT
  (SELECT count(*)::int FROM pg_tables
    WHERE schemaname='structure' AND tablename='tenant_documents' AND rowsecurity) AS td_rls,
  (SELECT count(*)::int FROM pg_tables
    WHERE schemaname='structure' AND tablename='tenant_document_revisions' AND rowsecurity) AS tdr_rls,
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname='structure' AND tablename IN ('tenant_documents','tenant_document_revisions')) AS policy_count;
ROLLBACK;
")
TD_RLS=$(echo "$RESULT" | jq -r '.[0].td_rls')
TDR_RLS=$(echo "$RESULT" | jq -r '.[0].tdr_rls')
POLICIES=$(echo "$RESULT" | jq -r '.[0].policy_count')
[[ "$TD_RLS" == "1" ]] && pass "tenant_documents RLS enabled" || fail "tenant_documents RLS off (got $TD_RLS)"
[[ "$TDR_RLS" == "1" ]] && pass "tenant_document_revisions RLS enabled" || fail "tenant_document_revisions RLS off (got $TDR_RLS)"
[[ "$POLICIES" == "4" ]] && pass "4 RLS policies present" || fail "expected 4 policies, got $POLICIES"

section "3. Triggers exist (2 on revisions, 1 on documents)"
RESULT=$(mgmt_query "
BEGIN;
${MIGRATION_SQL}
SELECT
  (SELECT count(*)::int FROM pg_trigger WHERE tgrelid='structure.tenant_document_revisions'::regclass
    AND tgname='tenant_doc_revision_status') AS rev_trg,
  (SELECT count(*)::int FROM pg_trigger WHERE tgrelid='structure.tenant_documents'::regclass
    AND tgname='tenant_doc_delete_status') AS del_trg,
  (SELECT count(*)::int FROM pg_trigger WHERE tgrelid='structure.tenant_documents'::regclass
    AND tgname='tenant_documents_updated_at') AS upd_trg;
ROLLBACK;
")
REV_TRG=$(echo "$RESULT" | jq -r '.[0].rev_trg')
DEL_TRG=$(echo "$RESULT" | jq -r '.[0].del_trg')
UPD_TRG=$(echo "$RESULT" | jq -r '.[0].upd_trg')
[[ "$REV_TRG" == "1" ]] && pass "tenant_doc_revision_status trigger present" || fail "revision status trigger missing (got $REV_TRG)"
[[ "$DEL_TRG" == "1" ]] && pass "tenant_doc_delete_status trigger present" || fail "delete status trigger missing (got $DEL_TRG)"
[[ "$UPD_TRG" == "1" ]] && pass "tenant_documents_updated_at trigger present" || fail "updated_at trigger missing (got $UPD_TRG)"

section "4. POSITIVE: inserting a revision sets layout_status=issued on tenant_details"
RESULT=$(mgmt_query "
BEGIN;
${MIGRATION_SQL}
INSERT INTO projects.projects (name, organisation_id, created_by)
  SELECT 'SMOKE-TDOC-DNC', ${ORG}, ${WHO};
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'SMOKE-TDN', 'Smoke Tenant'
  FROM projects.projects p WHERE p.name='SMOKE-TDOC-DNC';
INSERT INTO structure.tenant_details (node_id)
  SELECT n.id FROM structure.nodes n
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC-DNC';
INSERT INTO structure.tenant_documents (node_id, kind, title)
  SELECT n.id, 'layout', 'Test Layout'
  FROM structure.nodes n
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC-DNC';
INSERT INTO structure.tenant_document_revisions (tenant_document_id, rev_label, storage_path, file_name)
  SELECT d.id, 'Rev A', 'proj/1234567890-floor-plan.pdf', 'floor-plan.pdf'
  FROM structure.tenant_documents d
  JOIN structure.nodes n ON n.id=d.node_id
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC-DNC';
SELECT td.layout_status, td.layout_issued_at IS NOT NULL AS date_set
  FROM structure.tenant_details td
  JOIN structure.nodes n ON n.id=td.node_id
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC-DNC';
ROLLBACK;
")
STATUS=$(echo "$RESULT" | jq -r '.[0].layout_status')
DATE_SET=$(echo "$RESULT" | jq -r '.[0].date_set')
[[ "$STATUS" == "issued" ]] && pass "layout_status=issued after revision insert" || fail "expected layout_status=issued, got '$STATUS'"
[[ "$DATE_SET" == "true" ]] && pass "layout_issued_at populated" || fail "layout_issued_at was not set"

section "5. POSITIVE: deleting that revision reverts layout_status=not_issued"
RESULT=$(mgmt_query "
BEGIN;
${MIGRATION_SQL}
INSERT INTO projects.projects (name, organisation_id, created_by)
  SELECT 'SMOKE-TDOC2-DNC', ${ORG}, ${WHO};
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'SMOKE-TDN2', 'Smoke Tenant 2'
  FROM projects.projects p WHERE p.name='SMOKE-TDOC2-DNC';
INSERT INTO structure.tenant_details (node_id)
  SELECT n.id FROM structure.nodes n
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC2-DNC';
INSERT INTO structure.tenant_documents (node_id, kind, title)
  SELECT n.id, 'layout', 'Test Layout'
  FROM structure.nodes n
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC2-DNC';
INSERT INTO structure.tenant_document_revisions (tenant_document_id, rev_label, storage_path, file_name)
  SELECT d.id, 'Rev A', 'proj/1234567890-floor-plan.pdf', 'floor-plan.pdf'
  FROM structure.tenant_documents d
  JOIN structure.nodes n ON n.id=d.node_id
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC2-DNC';
DELETE FROM structure.tenant_document_revisions
  WHERE tenant_document_id IN (
    SELECT d.id FROM structure.tenant_documents d
    JOIN structure.nodes n ON n.id=d.node_id
    JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC2-DNC'
  );
SELECT td.layout_status
  FROM structure.tenant_details td
  JOIN structure.nodes n ON n.id=td.node_id
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC2-DNC';
ROLLBACK;
")
STATUS=$(echo "$RESULT" | jq -r '.[0].layout_status')
[[ "$STATUS" == "not_issued" ]] && pass "layout_status=not_issued after revision delete" || fail "expected not_issued, got '$STATUS'"

section "6. POSITIVE: scope revision sets scope_status=received"
RESULT=$(mgmt_query "
BEGIN;
${MIGRATION_SQL}
INSERT INTO projects.projects (name, organisation_id, created_by)
  SELECT 'SMOKE-TDOC3-DNC', ${ORG}, ${WHO};
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'SMOKE-TDN3', 'Smoke Tenant 3'
  FROM projects.projects p WHERE p.name='SMOKE-TDOC3-DNC';
INSERT INTO structure.tenant_details (node_id)
  SELECT n.id FROM structure.nodes n
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC3-DNC';
INSERT INTO structure.tenant_documents (node_id, kind, title)
  SELECT n.id, 'scope', 'Scope of Work'
  FROM structure.nodes n
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC3-DNC';
INSERT INTO structure.tenant_document_revisions (tenant_document_id, rev_label, storage_path, file_name)
  SELECT d.id, 'Rev A', 'proj/1234567890-scope.pdf', 'scope.pdf'
  FROM structure.tenant_documents d
  JOIN structure.nodes n ON n.id=d.node_id
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC3-DNC';
SELECT td.scope_status
  FROM structure.tenant_details td
  JOIN structure.nodes n ON n.id=td.node_id
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC3-DNC';
ROLLBACK;
")
STATUS=$(echo "$RESULT" | jq -r '.[0].scope_status')
[[ "$STATUS" == "received" ]] && pass "scope_status=received after revision insert" || fail "expected received, got '$STATUS'"

section "7. POSITIVE: backfill maps layout_drawing_path to correct file_name (timestamp-prefix stripped)"
RESULT=$(mgmt_query "
BEGIN;
${MIGRATION_SQL}
INSERT INTO projects.projects (name, organisation_id, created_by)
  SELECT 'SMOKE-BACKFILL-DNC', ${ORG}, ${WHO};
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'SMOKE-BF', 'Smoke Backfill'
  FROM projects.projects p WHERE p.name='SMOKE-BACKFILL-DNC';
INSERT INTO structure.tenant_details (node_id, layout_drawing_path, layout_issued_at, layout_status)
  SELECT n.id, 'proj/1699000000-floor-plan.pdf', '2023-11-03', 'issued'
  FROM structure.nodes n
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-BACKFILL-DNC';
INSERT INTO structure.tenant_documents (id, node_id, kind, title, sort_order)
  SELECT gen_random_uuid(), td.node_id, 'layout', 'Layout', 0
  FROM structure.tenant_details td
  JOIN structure.nodes n ON n.id=td.node_id
  JOIN projects.projects p ON p.id=n.project_id
  WHERE p.name='SMOKE-BACKFILL-DNC' AND td.layout_drawing_path IS NOT NULL;
INSERT INTO structure.tenant_document_revisions (tenant_document_id, rev_label, storage_path, file_name, issued_at)
  SELECT d.id, 'Rev A', td.layout_drawing_path,
         regexp_replace(split_part(td.layout_drawing_path, '/', -1), '^[0-9]+-', ''),
         COALESCE(td.layout_issued_at::timestamptz, now())
  FROM structure.tenant_details td
  JOIN structure.tenant_documents d ON d.node_id=td.node_id AND d.kind='layout'
  JOIN structure.nodes n ON n.id=td.node_id
  JOIN projects.projects p ON p.id=n.project_id
  WHERE p.name='SMOKE-BACKFILL-DNC' AND td.layout_drawing_path IS NOT NULL;
SELECT
  (SELECT count(*)::int FROM structure.tenant_documents d2
    JOIN structure.nodes n2 ON n2.id=d2.node_id
    JOIN projects.projects p2 ON p2.id=n2.project_id
    WHERE p2.name='SMOKE-BACKFILL-DNC') AS doc_count,
  (SELECT r.file_name FROM structure.tenant_document_revisions r
    JOIN structure.tenant_documents d3 ON d3.id=r.tenant_document_id
    JOIN structure.nodes n3 ON n3.id=d3.node_id
    JOIN projects.projects p3 ON p3.id=n3.project_id
    WHERE p3.name='SMOKE-BACKFILL-DNC' LIMIT 1) AS file_name,
  (SELECT r.rev_label FROM structure.tenant_document_revisions r
    JOIN structure.tenant_documents d3 ON d3.id=r.tenant_document_id
    JOIN structure.nodes n3 ON n3.id=d3.node_id
    JOIN projects.projects p3 ON p3.id=n3.project_id
    WHERE p3.name='SMOKE-BACKFILL-DNC' LIMIT 1) AS rev_label;
ROLLBACK;
")
DOC_COUNT=$(echo "$RESULT" | jq -r '.[0].doc_count')
FILE_NAME=$(echo "$RESULT" | jq -r '.[0].file_name')
REV_LABEL=$(echo "$RESULT" | jq -r '.[0].rev_label')
[[ "$DOC_COUNT" == "1" ]] && pass "backfill: 1 tenant_document created" || fail "expected 1 document, got $DOC_COUNT"
[[ "$FILE_NAME" == "floor-plan.pdf" ]] && pass "backfill: timestamp prefix stripped from file_name" || fail "expected 'floor-plan.pdf', got '$FILE_NAME'"
[[ "$REV_LABEL" == "Rev A" ]] && pass "backfill: rev_label='Rev A'" || fail "expected 'Rev A', got '$REV_LABEL'"

section "8. CASCADE: deleting a document (with a live revision) reverts layout_status=not_issued"
# Distinct from §5 (which deletes the revision directly) — here the document row is
# deleted, which cascade-deletes its revision, which fires the doc-delete trigger.
# This proves the full cascade chain: DELETE tenant_documents → FK cascade removes
# tenant_document_revisions → trigger on tenant_documents fires → tenant_details updated.
#
# NOTE: the Management API returns only the final SELECT of a transaction, so we
# capture status_before in a temporary table and read both before+after in one
# final SELECT. This keeps the non-CTE multi-statement style (trigger writes visible).
RESULT=$(mgmt_query "
BEGIN;
${MIGRATION_SQL}
INSERT INTO projects.projects (name, organisation_id, created_by)
  SELECT 'SMOKE-TDOC4-DNC', ${ORG}, ${WHO};
INSERT INTO structure.nodes (project_id, organisation_id, kind, code, name)
  SELECT p.id, p.organisation_id, 'tenant_db', 'SMOKE-TDN4', 'Smoke Tenant 4'
  FROM projects.projects p WHERE p.name='SMOKE-TDOC4-DNC';
INSERT INTO structure.tenant_details (node_id)
  SELECT n.id FROM structure.nodes n
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC4-DNC';
INSERT INTO structure.tenant_documents (node_id, kind, title)
  SELECT n.id, 'layout', 'Cascade Test Layout'
  FROM structure.nodes n
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC4-DNC';
INSERT INTO structure.tenant_document_revisions (tenant_document_id, rev_label, storage_path, file_name)
  SELECT d.id, 'Rev A', 'proj/1234567890-cascade-plan.pdf', 'cascade-plan.pdf'
  FROM structure.tenant_documents d
  JOIN structure.nodes n ON n.id=d.node_id
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC4-DNC';
CREATE TEMP TABLE _smoke_tdoc4_before AS
  SELECT td.layout_status AS status_before
  FROM structure.tenant_details td
  JOIN structure.nodes n ON n.id=td.node_id
  JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC4-DNC';
DELETE FROM structure.tenant_documents
  WHERE node_id IN (
    SELECT n.id FROM structure.nodes n
    JOIN projects.projects p ON p.id=n.project_id WHERE p.name='SMOKE-TDOC4-DNC'
  );
SELECT b.status_before, td.layout_status AS status_after
  FROM structure.tenant_details td
  JOIN structure.nodes n ON n.id=td.node_id
  JOIN projects.projects p ON p.id=n.project_id
  CROSS JOIN _smoke_tdoc4_before b
  WHERE p.name='SMOKE-TDOC4-DNC';
ROLLBACK;
")
STATUS_BEFORE=$(echo "$RESULT" | jq -r '.[0].status_before')
STATUS_AFTER=$(echo "$RESULT" | jq -r '.[0].status_after')
[[ "$STATUS_BEFORE" == "issued" ]] && pass "layout_status=issued after revision insert (pre-delete)" || fail "expected issued before doc delete, got '$STATUS_BEFORE'"
[[ "$STATUS_AFTER" == "not_issued" ]] && pass "layout_status=not_issued after document delete (cascade chain verified)" || fail "expected not_issued after doc delete, got '$STATUS_AFTER'"

echo ""
if [[ "$FAILED" == "0" ]]; then
  echo "✓ ALL SMOKE TESTS PASSED"
  exit 0
else
  echo "✗ SMOKE TESTS FAILED"
  exit 1
fi
