#!/usr/bin/env bash
# Smoke test for migration 00121 — the equipment-order trigger.
# Transactional + self-rolling-back: a sentinel RAISE aborts the DO block so the
# test nodes/orders never persist. Run AFTER the migration is applied.
#   bash scripts/db/smoke-test-equipment-order-trigger.sh
set -euo pipefail
. "$(dirname "$0")/mgmt-api.sh"

SQL=$(cat <<'EOSQL'
DO $$
DECLARE v_node uuid; v_orders int; v_pid uuid; v_org uuid;
BEGIN
  SELECT id, organisation_id INTO v_pid, v_org FROM projects.projects WHERE code = '636' LIMIT 1;
  IF v_pid IS NULL THEN RAISE EXCEPTION 'FAIL: Kings Walk project not found'; END IF;

  -- equipment node → trigger must create exactly one equipment order
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, status)
    VALUES (v_pid, v_org, 'main_board', 'SMOKE-TRG-MB', 'active') RETURNING id INTO v_node;
  SELECT count(*) INTO v_orders FROM structure.node_orders
    WHERE node_id = v_node AND scope_item_type_id IS NULL;
  IF v_orders <> 1 THEN RAISE EXCEPTION 'FAIL: equipment node got % equipment orders (want 1)', v_orders; END IF;

  -- tenant node → trigger must create NO equipment order
  INSERT INTO structure.nodes (project_id, organisation_id, kind, code, status)
    VALUES (v_pid, v_org, 'tenant_db', 'SMOKE-TRG-TN', 'active') RETURNING id INTO v_node;
  SELECT count(*) INTO v_orders FROM structure.node_orders
    WHERE node_id = v_node AND scope_item_type_id IS NULL;
  IF v_orders <> 0 THEN RAISE EXCEPTION 'FAIL: tenant node got % equipment orders (want 0)', v_orders; END IF;

  -- sentinel: abort so nothing persists
  RAISE EXCEPTION 'SMOKE_OK_ROLLBACK';
END $$;
EOSQL
)

# The DO block ends in `RAISE EXCEPTION 'SMOKE_OK_ROLLBACK'` to force a rollback,
# so the Management API returns an error object and mgmt_query exits non-zero.
# Capture the output (|| true, else `set -e` aborts) and grep the captured string
# — piping mgmt_query straight into grep would let `set -o pipefail` surface the
# non-zero mgmt_query exit and mask a matching grep (false FAIL on success).
OUT="$(mgmt_query "$SQL" 2>&1 || true)"
if printf '%s' "$OUT" | grep -q 'SMOKE_OK_ROLLBACK'; then
  echo "PASS: equipment-order trigger creates 1 order for equipment, 0 for tenant (rolled back)"
else
  echo "FAIL:"; printf '%s\n' "$OUT" | tail -5; exit 1
fi
