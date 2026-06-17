#!/usr/bin/env bash
# Verifies migration 00124 applied: origin_kind/origin_id columns + index.
# Read-only (information_schema / pg_indexes) — no row writes, nothing to roll back.
set -euo pipefail
cd "$(dirname "$0")"
source ./mgmt-api.sh

echo "== columns =="
OUT="$(mgmt_query "
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='tenants' AND table_name='documents'
    AND column_name IN ('origin_kind','origin_id')
  ORDER BY column_name;" || true)"
echo "$OUT"
echo "$OUT" | grep -q "origin_id"   || { echo "FAIL: origin_id missing"; exit 1; }
echo "$OUT" | grep -q "origin_kind" || { echo "FAIL: origin_kind missing"; exit 1; }

echo "== index =="
OUT="$(mgmt_query "
  SELECT indexname FROM pg_indexes
  WHERE schemaname='tenants' AND tablename='documents'
    AND indexname='idx_documents_origin';" || true)"
echo "$OUT"
echo "$OUT" | grep -q "idx_documents_origin" || { echo "FAIL: idx_documents_origin missing"; exit 1; }

echo "PASS"
