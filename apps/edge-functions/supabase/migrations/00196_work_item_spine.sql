-- =============================================================================
-- Migration: 00196_work_item_spine.sql
-- Programme: V2 platform roadmap — Q1, A(f) ordinal 7 — THE SPINE
-- Spec: docs/superpowers/specs/2026-09-09-v2-platform-roadmap/
--         16-appendix-registries.md A(a) (DDL + index set + write path),
--         A(b) (the eight Q1 types), A(h) (the two calendars)
--         03-work-items.md §1.2-§1.9 · 12-data-model-and-migrations.md §(b)
--         15-metrics-risks-open-questions.md §(b) (event columns) + metric 5
--
-- Depends on A(f) ordinal 1 (projects.public_holidays, projects.calendar_years)
-- and ordinal 6 (project_settings.work_item_defaults / triage_owner_id / the
-- shutdown window). due_date is NOT NULL and its BEFORE INSERT trigger computes
-- working days, which raises no_data_found on an unseeded year — A(h) forbids a
-- calendar-day fallback, because a silent one-day drift changes whether an item
-- escalates. Section 0 therefore refuses to apply against an under-seeded
-- calendar, so the failure lands on the deployer and not on a foreman who
-- cannot log a snag.
--
-- SECTION ORDER IS A DEPENDENCY ORDER. CREATE POLICY resolves function
-- references at creation time, so the helpers (§8) precede every policy (§9),
-- and both precede the triggers whose assertion files act as real authenticated
-- users (§11, §12) — an UPDATE as `authenticated` against a table with RLS on
-- and no policy affects zero rows and does NOT raise, which makes a guard
-- assertion written against it record a false result in both directions.
--
-- NOT in this migration, by ruling:
--   * work_items.instruction_recipient_id — Q2 (A(f)); it references
--     projects.instruction_recipients, which does not exist yet. Q2 re-declares
--     BOTH source CHECKs wholesale when it lands, because DROP CONSTRAINT
--     discards the other one silently.
--   * The six projection triggers and the backfill — item 3, A(f) ordinal 9.
--   * Any public.notifications write — item 4. append_work_item_event() writes
--     events and watchers only; item 4 adds the emit branch with CREATE OR REPLACE.
--   * project_module_enabled() on the INSERT policy — item 8 adds that arm.
--
-- Restore:
--   DROP TABLE projects.work_item_events, projects.work_item_watchers,
--              projects.work_items, projects.work_item_types CASCADE;
--   -- validate_work_item_defaults_trg lives on project_settings, a table the
--   -- CASCADE above never touches, so it must be dropped by name first:
--   DROP TRIGGER IF EXISTS validate_work_item_defaults_trg ON projects.project_settings;
--   DROP FUNCTION projects.add_working_days(date,int,uuid,text),
--     projects.push_past_builders_shutdown(date,uuid),
--     projects.resolve_work_item_assignee(uuid,text,uuid),
--     projects.user_can_read_work_item(uuid),
--     projects.user_can_write_work_item(uuid,text),
--     projects.work_items_set_due_date(), projects.work_items_ensure_ref(),
--     projects.work_items_assert_membership(), projects.work_items_transition_guard(),
--     projects.append_work_item_event(), projects.validate_work_item_defaults();
--   ALTER DEFAULT PRIVILEGES IN SCHEMA projects GRANT SELECT ON TABLES TO anon;
-- =============================================================================

-- @verify:begin
-- table: projects.work_item_types
-- table: projects.work_items
-- table: projects.work_item_events
-- table: projects.work_item_watchers
-- column: projects.work_item_events.from_ball_in_court_id
-- column: projects.work_item_events.to_ball_in_court_id
-- column: projects.work_item_events.actor_role
-- function: projects.add_working_days(date,int,uuid,text)
-- function: projects.push_past_builders_shutdown(date,uuid)
-- function: projects.resolve_work_item_assignee(uuid,text,uuid)
-- function: projects.user_can_read_work_item(uuid)
-- function: projects.user_can_write_work_item(uuid,text)
-- function: projects.work_items_set_due_date()
-- function: projects.work_items_ensure_ref()
-- function: projects.work_items_assert_membership()
-- function: projects.work_items_transition_guard()
-- function: projects.append_work_item_event()
-- function: projects.validate_work_item_defaults()
-- constraint: work_items_one_source ON projects.work_items
-- constraint: work_items_source_required ON projects.work_items
-- constraint: work_items_bic_present ON projects.work_items
-- constraint: work_items_ref_unique ON projects.work_items
-- index: work_items_my_work_idx ON projects.work_items
-- index: work_items_inbox_idx ON projects.work_items
-- index: work_items_project_module_idx ON projects.work_items
-- index: work_items_org_idx ON projects.work_items
-- index: work_items_src_rfi_uidx ON projects.work_items
-- index: work_items_src_snag_uidx ON projects.work_items
-- index: work_items_src_qc_uidx ON projects.work_items
-- index: work_items_src_diary_uidx ON projects.work_items
-- index: work_items_src_form_uidx ON projects.work_items
-- index: work_items_src_order_uidx ON projects.work_items
-- index: work_items_src_inspection_uidx ON projects.work_items
-- index: work_item_events_item_idx ON projects.work_item_events
-- trigger: work_items_set_due_date_trg ON projects.work_items
-- trigger: work_items_ensure_ref_trg ON projects.work_items
-- trigger: work_items_assert_membership_trg ON projects.work_items
-- trigger: append_work_item_event_trg ON projects.work_items
-- trigger: work_items_transition_guard_trg ON projects.work_items
-- trigger: validate_work_item_defaults_trg ON projects.project_settings
-- policy: work_item_types_select ON projects.work_item_types PERMISSIVE
-- policy: work_items_select ON projects.work_items PERMISSIVE
-- policy: work_items_insert ON projects.work_items PERMISSIVE
-- policy: work_items_insert_gate ON projects.work_items RESTRICTIVE
-- policy: work_items_update ON projects.work_items PERMISSIVE
-- policy: work_items_update_gate ON projects.work_items RESTRICTIVE
-- policy: work_item_events_select ON projects.work_item_events PERMISSIVE
-- policy: work_item_watchers_select ON projects.work_item_watchers PERMISSIVE
-- policy: work_item_watchers_insert ON projects.work_item_watchers PERMISSIVE
-- policy: work_item_watchers_delete ON projects.work_item_watchers PERMISSIVE
-- grant_absent: anon SELECT ON projects.work_items
-- grant_absent: anon SELECT ON projects.work_item_types
-- grant_absent: anon SELECT ON projects.work_item_events
-- grant_absent: anon SELECT ON projects.work_item_watchers
-- grant_absent: anon EXECUTE ON projects.user_can_read_work_item(uuid)
-- grant_absent: anon EXECUTE ON projects.user_can_write_work_item(uuid,text)
-- grant_absent: anon EXECUTE ON projects.add_working_days(date,int,uuid,text)
-- grant_absent: anon EXECUTE ON projects.push_past_builders_shutdown(date,uuid)
-- grant_absent: anon EXECUTE ON projects.resolve_work_item_assignee(uuid,text,uuid)
-- grant_absent: anon EXECUTE ON projects.work_items_set_due_date()
-- grant_absent: anon EXECUTE ON projects.work_items_ensure_ref()
-- grant_absent: anon EXECUTE ON projects.work_items_assert_membership()
-- grant_absent: anon EXECUTE ON projects.work_items_transition_guard()
-- grant_absent: anon EXECUTE ON projects.append_work_item_event()
-- grant_absent: anon EXECUTE ON projects.validate_work_item_defaults()
-- sql: SELECT bool_and(EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = k.key AND t.is_active)) FROM (VALUES ('rfi'),('snag'),('qc_defect'),('inspection'),('diary_action'),('form_action'),('order_followup'),('task')) AS k(key)
-- @verify:end
--
-- ⚠ ON THE `sql:` DIRECTIVE. It asserts that the eight Q1 keys exist and are
-- active — an invariant, not a row count. `count(*) = 8` was rejected: every
-- directive is re-evaluated against production on EVERY future deploy, and the
-- day Q3 registers `approval` (§03 §1.7: a sourceless type costs one row) a
-- count would go red and block every later migration for a reason unrelated
-- to this file. The other edge of the same blade: the invariant pins all eight
-- Q1 keys `is_active`, so RETIRING a Q1 type (is_active = false, or a DELETE)
-- must edit this directive in the SAME migration that retires it — otherwise
-- that migration's own post-push verify goes red on this file's line.

-- ─── 1. projects.work_item_types — the registry ──────────────────────────────
-- Columns are Appendix A(b)'s, exactly. A ref_prefix column was rejected: §12
-- §(h) test 1 asserts this column set, and the prefix lives as a CASE inside
-- projects.work_items_ensure_ref() (§6) instead, mirrored by REF_PREFIXES in
-- packages/shared/src/work-items/types.ts.
CREATE TABLE IF NOT EXISTS projects.work_item_types (
  key             text PRIMARY KEY,
  label           text NOT NULL,
  source_table    text,                       -- NULL for a sourceless type
  source_column   text,                       -- the module's own owner column
  default_days    int  NOT NULL CHECK (default_days > 0),
  calendar        text NOT NULL CHECK (calendar IN ('office','site')),
  gatekeeper_rule text NOT NULL CHECK (gatekeeper_rule IN ('project_pm','verifier_else_pm','creator')),
  write_roles     text[] NOT NULL CHECK (cardinality(write_roles) > 0)
                  -- ORG_ROLES (packages/shared/src/types/index.ts:7-15), so a typo in a future
                  -- seed fails at CREATE instead of stranding a type nobody can write.
                  CHECK (write_roles <@ ARRAY['owner','admin','project_manager','contractor','inspector','supplier','client_viewer']),
  sort_order      int  NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE projects.work_item_types IS
  'Appendix A(b). A new SOURCELESS type costs one row here and nothing else — which is why '
  'approval (Q3) needs no ALTER on work_items: work_items_source_required already names it. '
  'A new MIRRORED type costs a row, one nullable FK column, one arm on both source CHECKs, one '
  'mirror trigger, one scoped unique index, one arm in work_items_ensure_ref()''s prefix CASE '
  'and one rbac-matrix row.';

-- Appendix A(b), Q1 rows. write_roles mirrors the role constant each module
-- already uses (packages/shared/src/types/index.ts:36-92), so nothing here is
-- invented:
--   rfi/diary_action/task -> MARKUP_WRITE_ROLES   snag -> SNAG_FIELD_ROLES
--   qc_defect -> QC_WRITE_ROLES                   form_action -> FORMS_FIELD_ROLES
--   inspection/order_followup -> ORG_WRITE_ROLES
-- NO type admits client_viewer in Q1 (§03 §1.9); the Watcher-tier write set
-- lands in Q3.
INSERT INTO projects.work_item_types
  (key, label, source_table, source_column, default_days, calendar, gatekeeper_rule, write_roles, sort_order)
VALUES
  ('rfi',            'RFI',             'projects.rfis',               'assigned_to',    7,  'office', 'project_pm',       ARRAY['owner','admin','project_manager','contractor'],                       1),
  ('snag',           'Snag',            'field.snags',                 'assigned_to',    5,  'site',   'project_pm',       ARRAY['owner','admin','project_manager','contractor','inspector','supplier'], 2),
  ('qc_defect',      'QC defect',       'projects.qc_entries',          NULL,            5,  'site',   'project_pm',       ARRAY['owner','admin','project_manager','contractor'],                       3),
  ('inspection',     'Inspection',      'inspections.inspections',     'assigned_to_id', 3,  'site',   'verifier_else_pm', ARRAY['owner','admin','project_manager'],                                    4),
  ('diary_action',   'Diary action',    'projects.site_diary_entries',  NULL,            2,  'site',   'project_pm',       ARRAY['owner','admin','project_manager','contractor'],                       5),
  ('form_action',    'Form action',     'field.site_forms',             NULL,            3,  'site',   'project_pm',       ARRAY['owner','admin','project_manager','contractor','inspector','supplier'], 6),
  ('order_followup', 'Order follow-up', 'structure.node_orders',        NULL,            10, 'office', 'project_pm',       ARRAY['owner','admin','project_manager'],                                    7),
  ('task',           'Task',             NULL,                          NULL,            5,  'office', 'creator',          ARRAY['owner','admin','project_manager','contractor'],                       8)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE projects.work_item_types ENABLE ROW LEVEL SECURITY;

-- Read-only to every authenticated user: the registry is a vocabulary, not data,
-- and the create forms need it. NO write policy — it is migration-managed, so a
-- row insert can never grant a class of work a write set without a code review.
-- DROP IF EXISTS before every CREATE POLICY in this file (00191–00193 style),
-- so a partial re-apply does not stop on "policy already exists".
DROP POLICY IF EXISTS work_item_types_select ON projects.work_item_types;
CREATE POLICY work_item_types_select ON projects.work_item_types
  FOR SELECT TO authenticated USING (true);
