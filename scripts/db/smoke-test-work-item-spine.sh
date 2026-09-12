#!/usr/bin/env bash
# Post-apply verification for the work-item spine (Q1 item 2, migrations
# 00195 + 00196; A(f) ordinals 6 and 7).
#
# Read-only, except for two round-trips inside BEGIN ... ROLLBACK. Safe to run
# against production. Exit 0 on full green.
#
# This is deliberately NOT the assertion suite: the assertions run inside a
# rollback with the migration text inline, so they prove the text. This file
# interrogates what is actually there after `db push` — because a green
# "Deploy DB Migrations" is not evidence a migration ran (db push keys on the
# version prefix and silently skips a number already in the ledger).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }
section() { echo ""; echo "── $1 ──"; }
FAILED=0

section "0. Both migrations are in the ledger"
N=$(mgmt_query "SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations
  WHERE version IN ('00195','00196');" | jq -r '.[0].n')
[[ "$N" == "2" ]] && pass "00195 and 00196 recorded" || fail "expected 2 ledger rows, got $N"

section "1. All four tables exist with RLS enabled"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='projects'
  AND tablename IN ('work_items','work_item_types','work_item_events','work_item_watchers') AND rowsecurity;" | jq -r '.[0].n')
[[ "$N" == "4" ]] && pass "4 tables, RLS on all" || fail "expected 4 RLS-enabled tables, got $N"

section "2. A(a)'s named constraints are present"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
  JOIN pg_namespace nsp ON nsp.oid=t.relnamespace WHERE nsp.nspname='projects' AND t.relname='work_items'
  AND c.conname IN ('work_items_one_source','work_items_source_required','work_items_bic_present','work_items_ref_unique');" | jq -r '.[0].n')
[[ "$N" == "4" ]] && pass "4 named constraints on work_items (the 5th is the inline status CHECK)" || fail "expected 4 named constraints, got $N"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
  JOIN pg_namespace nsp ON nsp.oid=t.relnamespace WHERE nsp.nspname='projects' AND t.relname='work_item_types'
  AND c.conname = 'work_item_types_write_roles_govern';" | jq -r '.[0].n')
[[ "$N" == "1" ]] && pass "write_roles always include owner/admin/project_manager" || fail "work_item_types_write_roles_govern missing"

section "3. ball_in_court_id is a STORED generated column"
G=$(mgmt_query "SELECT is_generated AS g FROM information_schema.columns
  WHERE table_schema='projects' AND table_name='work_items' AND column_name='ball_in_court_id';" | jq -r '.[0].g')
[[ "$G" == "ALWAYS" ]] && pass "GENERATED ALWAYS … STORED" || fail "ball_in_court_id is_generated = $G"

section "4. The eight Q1 types are registered, and the metric columns exist"
N=$(mgmt_query "SELECT count(*)::int AS n FROM projects.work_item_types WHERE is_active
  AND key IN ('rfi','snag','qc_defect','inspection','diary_action','form_action','order_followup','task');" | jq -r '.[0].n')
[[ "$N" == "8" ]] && pass "8 active Q1 types" || fail "expected the 8 Q1 keys active, got $N"
N=$(mgmt_query "SELECT count(*)::int AS n FROM information_schema.columns
  WHERE table_schema='projects' AND table_name='work_item_events'
    AND column_name IN ('from_ball_in_court_id','to_ball_in_court_id','actor_role','seq');" | jq -r '.[0].n')
[[ "$N" == "4" ]] && pass "from/to ball-in-court + actor_role (metrics 5 and 2a) + seq (feed order)" || fail "expected 4 metric/order columns, got $N"

section "5. The six triggers are attached"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid
  JOIN pg_namespace nsp ON nsp.oid=c.relnamespace WHERE NOT tg.tgisinternal AND nsp.nspname='projects'
  AND ((c.relname='work_items' AND tg.tgname IN ('work_items_set_due_date_trg','work_items_ensure_ref_trg',
        'work_items_assert_membership_trg','append_work_item_event_trg','work_items_transition_guard_trg'))
    OR (c.relname='project_settings' AND tg.tgname='validate_work_item_defaults_trg'));" | jq -r '.[0].n')
[[ "$N" == "6" ]] && pass "5 on work_items + validate_work_item_defaults_trg on project_settings" || fail "expected 6 triggers, got $N"

section "6. anon holds nothing; authenticated holds no write it should not"
N=$(mgmt_query "SELECT count(*)::int AS n FROM (VALUES
   ('projects.work_items'),('projects.work_item_types'),
   ('projects.work_item_events'),('projects.work_item_watchers')) t(rel)
   WHERE has_table_privilege('anon', t.rel, 'SELECT') OR has_table_privilege('anon', t.rel, 'INSERT')
      OR has_table_privilege('anon', t.rel, 'UPDATE') OR has_table_privilege('anon', t.rel, 'DELETE');" | jq -r '.[0].n')
[[ "$N" == "0" ]] && pass "no anon privilege on any of the 4 tables" || fail "$N table(s) still touchable by anon"
N=$(mgmt_query "SELECT count(*)::int AS n FROM (VALUES
   ('projects.user_can_read_work_item(uuid)'),('projects.user_can_write_work_item(uuid,text)'),
   ('projects.add_working_days(date,int,uuid,text)'),('projects.push_past_builders_shutdown(date,uuid)'),
   ('projects.resolve_work_item_assignee(uuid,text,uuid)'),
   ('projects.work_items_set_due_date()'),('projects.work_items_ensure_ref()'),
   ('projects.work_items_assert_membership()'),('projects.work_items_transition_guard()'),
   ('projects.append_work_item_event()'),('projects.validate_work_item_defaults()'),
   ('projects.resolve_triage_owner(uuid)'),('projects.resolve_project_pm(uuid)'),('projects.org_owner(uuid)')) f(sig)
   WHERE has_function_privilege('anon', f.sig, 'EXECUTE');" | jq -r '.[0].n')
[[ "$N" == "0" ]] && pass "no anon EXECUTE on any of the 14 functions (11 in 00196, 3 in 00195)" || fail "$N function(s) still executable by anon"
N=$(mgmt_query "SELECT count(*)::int AS n FROM (VALUES
   ('projects.work_items','DELETE'),
   ('projects.work_item_events','INSERT'),('projects.work_item_events','UPDATE'),('projects.work_item_events','DELETE'),
   ('projects.work_item_types','INSERT'),('projects.work_item_types','UPDATE'),('projects.work_item_types','DELETE'),
   ('projects.work_item_watchers','UPDATE')) t(rel, priv)
   WHERE has_table_privilege('authenticated', t.rel, t.priv);" | jq -r '.[0].n')
[[ "$N" == "0" ]] && pass "authenticated holds none of the 8 revoked table privileges" || fail "authenticated still holds $N of the 8 revoked privileges"
B=$(mgmt_query "SELECT has_sequence_privilege('authenticated','projects.work_item_events_seq_seq','USAGE') AS b;" | jq -r '.[0].b')
[[ "$B" == "false" ]] && pass "authenticated cannot advance the events sequence" || fail "authenticated still holds USAGE on work_item_events_seq_seq"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_default_acl d JOIN pg_namespace nsp ON nsp.oid=d.defaclnamespace
   WHERE nsp.nspname='projects' AND d.defaclobjtype='r' AND array_to_string(d.defaclacl,',') LIKE '%anon=%';" | jq -r '.[0].n')
[[ "$N" == "0" ]] && pass "the next table in this schema is not born anon-readable" || fail "ALTER DEFAULT PRIVILEGES still grants anon a privilege on future tables"

section "7. Every live project has a triage owner and complete defaults (live measurements, not invariants)"
R=$(mgmt_query "SELECT
  (SELECT count(*) FROM projects.project_settings WHERE triage_owner_id IS NULL)::int AS no_owner,
  (SELECT count(*) FROM projects.project_settings ps
    WHERE (SELECT count(*) FROM jsonb_object_keys(ps.work_item_defaults))
       <> (SELECT count(*) FROM projects.work_item_types WHERE is_active))::int AS bad_defaults,
  (SELECT count(*) FROM projects.project_settings ps
    WHERE ps.work_item_defaults -> 'rfi' ->> 'days_to_respond' IS NOT NULL)::int AS rfi_copies;" )
[[ "$(echo "$R" | jq -r '.[0].no_owner')" == "0" ]] && pass "0 settings rows without a triage owner (an orphaned project legally has NULL — investigate, do not panic)" || fail "$(echo "$R" | jq -r '.[0].no_owner') rows have no triage owner"
[[ "$(echo "$R" | jq -r '.[0].bad_defaults')" == "0" ]] && pass "0 settings rows with incomplete work_item_defaults (a project created after apply carries {} until the settings surface writes keys)" || fail "incomplete defaults on $(echo "$R" | jq -r '.[0].bad_defaults') rows"
[[ "$(echo "$R" | jq -r '.[0].rfi_copies')" == "0" ]] && pass "0 rows hold a COPY of default_rfi_due_days (it is read live)" || fail "$(echo "$R" | jq -r '.[0].rfi_copies') rows copied default_rfi_due_days into the jsonb"

section "8. The calendar is seeded three years out"
R=$(mgmt_query "WITH y AS (SELECT EXTRACT(YEAR FROM (now() AT TIME ZONE 'Africa/Johannesburg'))::int AS t)
  SELECT (SELECT count(*)::int FROM generate_series((SELECT t FROM y),(SELECT t FROM y)+2) g
           WHERE NOT EXISTS (SELECT 1 FROM projects.calendar_years cy WHERE cy.year=g)) AS missing;")
[[ "$(echo "$R" | jq -r '.[0].missing')" == "0" ]] && pass "this year + 2 are seeded — the due-date trigger cannot fail closed" || fail "$(echo "$R" | jq -r '.[0].missing') year(s) unseeded; RAISE the alarm with item 1's owner"

section "9. The never-null rule (§12 §(i)) holds on live data"
N=$(mgmt_query "SELECT count(*)::int AS n FROM projects.work_items
  WHERE status NOT IN ('closed','void') AND (ball_in_court_id IS NULL OR due_date IS NULL);" | jq -r '.[0].n')
[[ "$N" == "0" ]] && pass "0 open items without a ball-in-court or a due date" || fail "$N open item(s) violate the never-null rule"

section "10. structure.node_orders carries no work-item trigger"
N=$(mgmt_query "SELECT count(*)::int AS n FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid
  JOIN pg_namespace nsp ON nsp.oid=c.relnamespace WHERE nsp.nspname='structure' AND c.relname='node_orders'
  AND NOT tg.tgisinternal AND pg_get_triggerdef(tg.oid) ILIKE '%work_item%';" | jq -r '.[0].n')
[[ "$N" == "0" ]] && pass "no projection trigger — order_followup stays explicit-chase-only" || fail "$N work-item trigger(s) on node_orders"

section "11. Round-trip on live data, rolled back"
R=$(mgmt_query "
BEGIN;
CREATE TEMP TABLE _s AS SELECT p.id AS pid, p.organisation_id AS oid,
  projects.resolve_project_pm(p.id) AS pm FROM projects.projects p WHERE p.status='active' ORDER BY p.created_at LIMIT 1;
INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title, assignee_id, gatekeeper_id, created_by)
SELECT oid, pid, 'task', 'manual', '_smoke', pm, pm, pm FROM _s;
SELECT wi.ref AS ref, wi.due_date::text AS due, (wi.ball_in_court_id = wi.assignee_id) AS bic_ok,
       (SELECT count(*)::int FROM projects.work_item_events e WHERE e.work_item_id = wi.id) AS events,
       (SELECT count(*)::int FROM projects.work_item_watchers w WHERE w.work_item_id = wi.id) AS watchers
  FROM projects.work_items wi WHERE wi.title='_smoke';
ROLLBACK;")
[[ "$(echo "$R" | jq -r '.[0].ref')" =~ ^TASK-[0-9]+$ ]] && pass "ref $(echo "$R" | jq -r '.[0].ref')" || fail "bad ref: $(echo "$R" | jq -r '.[0].ref')"
[[ "$(echo "$R" | jq -r '.[0].due')" != "null" ]] && pass "due_date $(echo "$R" | jq -r '.[0].due')" || fail "no due_date computed"
[[ "$(echo "$R" | jq -r '.[0].bic_ok')" == "true" ]] && pass "ball-in-court = assignee at triage" || fail "ball-in-court wrong on a fresh row"
[[ "$(echo "$R" | jq -r '.[0].events')" == "1" ]] && pass "1 created event appended" || fail "expected 1 event, got $(echo "$R" | jq -r '.[0].events')"
[[ "$(echo "$R" | jq -r '.[0].watchers')" == "1" ]] && pass "1 watcher seeded (creator = assignee = gatekeeper, deduped)" || fail "expected 1 watcher, got $(echo "$R" | jq -r '.[0].watchers')"

section "12. A client viewer sees only what they hold, and writes nothing"
R=$(mgmt_query "
BEGIN;
CREATE TEMP TABLE _c AS
  SELECT pm.user_id, pm.project_id, p.organisation_id, projects.resolve_project_pm(pm.project_id) AS pm_id
    FROM projects.project_members pm JOIN projects.projects p ON p.id = pm.project_id
   WHERE pm.is_active AND pm.role='client_viewer' AND p.status='active'
   ORDER BY p.created_at LIMIT 1;
GRANT SELECT ON _c TO authenticated;
INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title, assignee_id, gatekeeper_id, created_by)
SELECT organisation_id, project_id, 'task', 'manual', '_cv_mine',   user_id, pm_id, pm_id FROM _c;
INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title, assignee_id, gatekeeper_id, created_by)
SELECT organisation_id, project_id, 'task', 'manual', '_cv_theirs', pm_id,   pm_id, pm_id FROM _c;
SELECT set_config('request.jwt.claims', json_build_object('sub',(SELECT user_id FROM _c),'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
UPDATE projects.work_items SET status='open' WHERE title='_cv_mine';
SELECT (SELECT count(*)::int FROM projects.work_items WHERE title='_cv_mine')   AS can_see_mine,
       (SELECT count(*)::int FROM projects.work_items WHERE title='_cv_theirs') AS can_see_theirs,
       (SELECT status FROM projects.work_items WHERE title='_cv_mine') AS mine_status;
ROLLBACK;")
[[ "$(echo "$R" | jq -r '.[0].can_see_mine')" == "1" ]] && pass "a client viewer can open the item they hold" || fail "a client viewer cannot see their own item"
[[ "$(echo "$R" | jq -r '.[0].can_see_theirs')" == "0" ]] && pass "a client viewer cannot list the rest of the project" || fail "a client viewer can list every work item — PR #162's gap re-opened"
[[ "$(echo "$R" | jq -r '.[0].mine_status')" == "triage" ]] && pass "a client viewer's write was a silent zero-row (status still triage)" || fail "a client viewer wrote to work_items (status = $(echo "$R" | jq -r '.[0].mine_status'))"

echo ""
[[ "$FAILED" == "0" ]] && echo "ALL GREEN" || { echo "FAILURES ABOVE" >&2; exit 1; }
