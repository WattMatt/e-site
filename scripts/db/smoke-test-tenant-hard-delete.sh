#!/usr/bin/env bash
# Smoke test for the tenant hard-delete cascade premise.
#
# The hard-delete relies on exact FK ON DELETE behaviour: the tenant-side
# dependents must CASCADE when the node is deleted; the cable-supply + child
# (parent_node_id) FKs must be NO ACTION (so the action is forced to clear them
# first); inspections must SET NULL. This reads pg_constraint and asserts each —
# a RUNTIME proof of the whole feature's safety premise. It seeds/deletes NOTHING
# (catalog read only), so it is safe to run against prod any time.
#   bash scripts/db/smoke-test-tenant-hard-delete.sh
set -euo pipefail
. "$(dirname "$0")/mgmt-api.sh"

# confdeltype codes: c = CASCADE, a = NO ACTION, n = SET NULL
SQL=$(cat <<'EOSQL'
DO $$
DECLARE r record; bad text := '';
  expect_cascade text[] := ARRAY[
    'structure.tenant_details','structure.tenant_scope_items','structure.tenant_units',
    'structure.tenant_documents','structure.node_orders',                 -- direct on nodes
    'structure.node_order_documents','structure.node_order_shop_drawings', -- 2nd level (node_orders)
    'structure.tenant_document_revisions'                                  -- 2nd level (tenant_documents)
  ];
BEGIN
  FOR r IN
    SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent, confdeltype
    FROM pg_constraint
    WHERE contype='f'
      AND confrelid IN ('structure.nodes'::regclass,'structure.node_orders'::regclass,'structure.tenant_documents'::regclass)
  LOOP
    IF r.child = ANY(expect_cascade) AND r.confdeltype <> 'c' THEN
      bad := bad || format(' [%s->%s expected CASCADE got %s]', r.child, r.parent, r.confdeltype);
    END IF;
    -- blockers: cable supplies + the self-FK child link must be NO ACTION
    IF r.child='cable_schedule.supplies' AND r.confdeltype <> 'a' THEN
      bad := bad || format(' [supplies expected NO ACTION got %s]', r.confdeltype);
    END IF;
    IF r.child='structure.nodes' AND r.parent='structure.nodes' AND r.confdeltype <> 'a' THEN
      bad := bad || format(' [parent_node_id expected NO ACTION got %s]', r.confdeltype);
    END IF;
    -- inspections target must SET NULL
    IF r.child='inspections.inspections' AND r.confdeltype <> 'n' THEN
      bad := bad || format(' [inspections expected SET NULL got %s]', r.confdeltype);
    END IF;
  END LOOP;

  -- Sanity: the cascade set must actually be present (guards a renamed/dropped FK)
  IF (SELECT count(*) FROM pg_constraint WHERE contype='f'
        AND confrelid='structure.nodes'::regclass AND confdeltype='c') < 5 THEN
    bad := bad || ' [fewer than 5 CASCADE FKs on structure.nodes — a dependent FK may have been dropped]';
  END IF;

  IF bad <> '' THEN RAISE EXCEPTION 'FAIL: FK behaviour changed:%', bad; END IF;
  RAISE EXCEPTION 'SMOKE_OK_HARD_DELETE_FK_BEHAVIOUR';
END $$;
EOSQL
)
# Capture-then-grep (pipefail-safe: the sentinel RAISE makes mgmt_query exit non-zero).
OUT="$(mgmt_query "$SQL" 2>&1 || true)"
if printf '%s' "$OUT" | grep -q 'SMOKE_OK_HARD_DELETE_FK_BEHAVIOUR'; then
  echo "PASS: hard-delete cascade premise verified — tenant-side dependents CASCADE, cable-supply + child FKs NO ACTION, inspections SET NULL."
else
  echo "FAIL:"; printf '%s\n' "$OUT" | tail -6; exit 1
fi
