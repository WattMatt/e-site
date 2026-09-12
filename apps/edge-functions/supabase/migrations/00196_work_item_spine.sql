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
-- grant_absent: authenticated DELETE ON projects.work_items
-- grant_absent: authenticated INSERT ON projects.work_item_events
-- grant_absent: authenticated UPDATE ON projects.work_item_events
-- grant_absent: authenticated DELETE ON projects.work_item_events
-- grant_absent: authenticated INSERT ON projects.work_item_types
-- grant_absent: authenticated UPDATE ON projects.work_item_types
-- grant_absent: authenticated DELETE ON projects.work_item_types
-- grant_absent: authenticated UPDATE ON projects.work_item_watchers
-- sql: SELECT bool_and(EXISTS (SELECT 1 FROM projects.work_item_types t WHERE t.key = k.key AND t.is_active)) FROM (VALUES ('rfi'),('snag'),('qc_defect'),('inspection'),('diary_action'),('form_action'),('order_followup'),('task')) AS k(key)
-- sql: SELECT NOT EXISTS (SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace WHERE n.nspname = 'projects' AND d.defaclobjtype = 'r' AND array_to_string(d.defaclacl, ',') LIKE '%anon=%')
-- @verify:end
--
-- ⚠ ON THE FIRST `sql:` DIRECTIVE. It asserts that the eight Q1 keys exist and
-- are active — an invariant, not a row count. `count(*) = 8` was rejected:
-- every directive is re-evaluated against production on EVERY future deploy,
-- and the day Q3 registers `approval` (§03 §1.7: a sourceless type costs one
-- row) a count would go red and block every later migration for a reason
-- unrelated to this file. The other edge of the same blade: the invariant pins
-- all eight Q1 keys `is_active`, so RETIRING a Q1 type (is_active = false, or
-- a DELETE) must edit this directive in the SAME migration that retires it —
-- otherwise that migration's own post-push verify goes red on this file's line.
--
-- The SECOND `sql:` directive pins §10's ALTER DEFAULT PRIVILEGES fix: no
-- default ACL for role postgres in schema projects may name anon on tables. A
-- later `ALTER DEFAULT PRIVILEGES … GRANT … TO anon` in this schema would go
-- red here on its own deploy, which is the point.

-- ─── 0. Preconditions ────────────────────────────────────────────────────────
-- This migration REFUSES TO APPLY against an under-seeded calendar, and that is
-- the point of it.
--
-- add_working_days() raises no_data_found on an unseeded year (A(h) [R24], which
-- forbids a calendar-day fallback outright). It runs inside a BEFORE INSERT
-- trigger on the spine, and from item 3 onward every mirrored source writes
-- through that trigger — so a missed October re-seed does not merely break
-- escalation, it makes raising an RFI, logging a snag or submitting a form fail
-- outright, with an error no support person can act on. The re-seed is a manual
-- annual task (§15 §(b2)) and this programme's own history is cloud-sync-poll:
-- specified, merged, never scheduled, found two months later by users.
--
-- ASSERT, never seed as a side effect: the annual seed is item 1's operational
-- task, and a migration that quietly repaired it would hide the miss.
DO $pre$
DECLARE
  y    int := EXTRACT(YEAR FROM (now() AT TIME ZONE 'Africa/Johannesburg'))::int;
  -- Three years out: this year and the next two. ONE binding, read by the
  -- scan, the message and the HINT alike, so the range a deployer is told to
  -- seed is the range that was actually checked.
  y_to int := y + 2;
  missing int;
BEGIN
  IF to_regclass('projects.calendar_years') IS NULL THEN
    RAISE EXCEPTION 'work-item spine: projects.calendar_years does not exist. Apply the Q1 metrics/calendar migration (A(f) ordinal 1) first.'
      USING ERRCODE = 'undefined_table';
  END IF;

  SELECT count(*) INTO missing
    FROM generate_series(y, y_to) AS g(yr)
   WHERE NOT EXISTS (SELECT 1 FROM projects.calendar_years cy WHERE cy.year = g.yr);

  IF missing > 0 THEN
    RAISE EXCEPTION 'work-item spine: % of the calendar years %..% are not seeded in projects.calendar_years', missing, y, y_to
      USING ERRCODE = 'no_data_found',
            HINT = format('Seed them first, then re-apply: INSERT INTO projects.calendar_years (year) SELECT g FROM generate_series(%s, %s) g ON CONFLICT DO NOTHING; and run item 1''s listHolidays() seeder for each of those years into projects.public_holidays.', y, y_to);
  END IF;
END $pre$;

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

-- ─── 2. projects.work_items — Appendix A(a), reproduced ──────────────────────
-- Three properties are load-bearing and every dependent section is written
-- against them (A(a)):
--   1. assignee_id is NOT NULL. An item that belongs to nobody cannot exist, so
--      there is no unassigned arm anywhere in the data model.
--   2. due_date is NOT NULL, computed in working days by the BEFORE INSERT
--      trigger against A(h)'s calendar.
--   3. ball_in_court_id is a STORED GENERATED column, null only for closed and
--      void. It is a CASE over three columns OF THE SAME ROW and calls nothing,
--      which is exactly what Postgres permits. It has NO write path at all.
--
-- status DEFAULTS to 'triage'. §03 §1.6's "an item created WITH an explicit
-- assignee is born open" is enforced by the two writers that know whether the
-- assignee was chosen or resolved — createWorkItemTaskAction and item 3's mirror
-- triggers — because the database cannot tell the difference from the row alone.
--
-- instruction_recipient_id (Q2) is deliberately absent, and both source CHECKs
-- omit its term. Q2 re-declares BOTH wholesale in one statement, because
-- DROP CONSTRAINT discards the other one silently.
CREATE TABLE IF NOT EXISTS projects.work_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id),
  project_id       uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  item_type        text NOT NULL REFERENCES projects.work_item_types(key),
  origin           text NOT NULL DEFAULT 'mirror'
                   CHECK (origin IN ('mirror','split','manual')),
  ref              text NOT NULL,                -- 'RFI-12', per project, per type
  title            text NOT NULL,
  priority         text NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('low','medium','high','critical')),
  status           text NOT NULL DEFAULT 'triage'
                   CHECK (status IN ('triage','open','answered','closed','void')),
  source_status    text,                         -- display-only mirror of the module's vocabulary
  void_reason      text,
  assignee_id      uuid NOT NULL REFERENCES public.profiles(id),
  gatekeeper_id    uuid NOT NULL REFERENCES public.profiles(id),
  ball_in_court_id uuid GENERATED ALWAYS AS (
                     CASE status
                       WHEN 'triage'   THEN assignee_id
                       WHEN 'open'     THEN assignee_id
                       WHEN 'answered' THEN gatekeeper_id
                       ELSE NULL END) STORED,
  due_date         date NOT NULL,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz, closed_by uuid REFERENCES public.profiles(id),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- Q1 sources. Typed nullable FKs, one per source — never a polymorphic
  -- (schema, table, id) triple: a polymorphic key cannot be enforced, and an
  -- orphaned row in a personal inbox is the worst failure this primitive can
  -- have. ON DELETE SET NULL, never CASCADE: deleting a diary entry is a live
  -- gated action, and a cascade would destroy the events behind metric 4.
  --
  -- ⚠ MEASURED DEPENDENCY on item 3. RI's SET NULL is an UPDATE of the
  -- referencing row, and an UPDATE re-checks that row's CHECKs — so deleting a
  -- source that still has a LIVE (non-void) mirrored item fails with
  -- check_violation on work_items_source_required, until item 3's BEFORE DELETE
  -- delete-to-void triggers on the six source tables land and void the item
  -- first. In Q1 that window is empty: 'task' is the only client-insertable
  -- type (Task 13), so no live mirror can exist before item 3 applies. Do NOT
  -- relax the CHECK to close the window — that would legalise a sourceless
  -- mirror, which is exactly the orphan this column set exists to forbid.
  -- Once the item IS void, the same SET NULL is an UPDATE on a 'void' row that
  -- changes only an FK column; it therefore fires work_items_transition_guard()
  -- and append_work_item_event() like any other UPDATE, and Task 11 admits it.
  rfi_id        uuid REFERENCES projects.rfis(id)               ON DELETE SET NULL,
  snag_id       uuid REFERENCES field.snags(id)                 ON DELETE SET NULL,
  qc_entry_id   uuid REFERENCES projects.qc_entries(id)         ON DELETE SET NULL,
  diary_id      uuid REFERENCES projects.site_diary_entries(id) ON DELETE SET NULL,
  site_form_id  uuid REFERENCES field.site_forms(id)            ON DELETE SET NULL,
  node_order_id uuid REFERENCES structure.node_orders(id)       ON DELETE SET NULL,
  inspection_id uuid REFERENCES inspections.inspections(id)     ON DELETE SET NULL,

  CONSTRAINT work_items_one_source CHECK (
    (rfi_id IS NOT NULL)::int + (snag_id IS NOT NULL)::int + (qc_entry_id IS NOT NULL)::int
  + (diary_id IS NOT NULL)::int + (site_form_id IS NOT NULL)::int
  + (node_order_id IS NOT NULL)::int + (inspection_id IS NOT NULL)::int <= 1),

  -- 'approval' is named here in Q1 deliberately (§03 §1.2). Relaxing this later
  -- would mean an ALTER on the hottest table on the platform; Q3 should cost a
  -- registry row, not a constraint rewrite.
  CONSTRAINT work_items_source_required CHECK (
    item_type IN ('task','approval') OR status = 'void'
    OR (rfi_id IS NOT NULL)::int + (snag_id IS NOT NULL)::int + (qc_entry_id IS NOT NULL)::int
     + (diary_id IS NOT NULL)::int + (site_form_id IS NOT NULL)::int
     + (node_order_id IS NOT NULL)::int + (inspection_id IS NOT NULL)::int = 1),

  -- Unviolatable today (assignee_id/gatekeeper_id are NOT NULL and the CASE is
  -- total over the status CHECK); kept as the guard against a future NOT NULL drop.
  CONSTRAINT work_items_bic_present CHECK (
    status IN ('closed','void') OR ball_in_court_id IS NOT NULL),
  CONSTRAINT work_items_ref_unique UNIQUE (project_id, ref)
);

-- Appendix A(a)'s index set, and nothing else. Keyset pagination is
-- ORDER BY due_date ASC, id ASC with a two-part cursor — there is no NULLS
-- ordering because due_date is NOT NULL and there are no nulls to order.
CREATE INDEX IF NOT EXISTS work_items_my_work_idx
  ON projects.work_items (assignee_id, status, due_date) WHERE status <> 'closed';
CREATE INDEX IF NOT EXISTS work_items_inbox_idx
  ON projects.work_items (ball_in_court_id, due_date) WHERE status IN ('triage','open','answered');
CREATE INDEX IF NOT EXISTS work_items_project_module_idx
  ON projects.work_items (project_id, item_type, status);
CREATE INDEX IF NOT EXISTS work_items_org_idx
  ON projects.work_items (organisation_id);

-- One partial UNIQUE per source column, predicated on origin = 'mirror'. This
-- makes the projection idempotent on retry while leaving a deliberate 'split'
-- row legal and untouched by source-status pushback (§03 §1.2, §1.3).
CREATE UNIQUE INDEX IF NOT EXISTS work_items_src_rfi_uidx        ON projects.work_items (rfi_id)        WHERE rfi_id        IS NOT NULL AND origin = 'mirror';
CREATE UNIQUE INDEX IF NOT EXISTS work_items_src_snag_uidx       ON projects.work_items (snag_id)       WHERE snag_id       IS NOT NULL AND origin = 'mirror';
CREATE UNIQUE INDEX IF NOT EXISTS work_items_src_qc_uidx         ON projects.work_items (qc_entry_id)   WHERE qc_entry_id   IS NOT NULL AND origin = 'mirror';
CREATE UNIQUE INDEX IF NOT EXISTS work_items_src_diary_uidx      ON projects.work_items (diary_id)      WHERE diary_id      IS NOT NULL AND origin = 'mirror';
CREATE UNIQUE INDEX IF NOT EXISTS work_items_src_form_uidx       ON projects.work_items (site_form_id)  WHERE site_form_id  IS NOT NULL AND origin = 'mirror';
CREATE UNIQUE INDEX IF NOT EXISTS work_items_src_order_uidx      ON projects.work_items (node_order_id) WHERE node_order_id IS NOT NULL AND origin = 'mirror';
CREATE UNIQUE INDEX IF NOT EXISTS work_items_src_inspection_uidx ON projects.work_items (inspection_id) WHERE inspection_id IS NOT NULL AND origin = 'mirror';

-- ─── 3. projects.work_item_events — append-only ──────────────────────────────
-- Feeds ball-in-court history, the activity feed and three of the eight metrics:
-- metric 4 (first open -> answered transition), the ball-in-court-arrivals half
-- of metric 5's denominator, and metric 7. NEVER purged (§12 §(f)) — it dies
-- only with its project, by cascade.
CREATE TABLE IF NOT EXISTS projects.work_item_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id    uuid NOT NULL REFERENCES projects.work_items(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects.projects(id)   ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id),
  verb            text NOT NULL CHECK (verb IN
                    ('created','assigned','reassigned','status_changed','due_changed','closed','voided')),
  from_status     text, to_status   text,
  from_user_id    uuid REFERENCES public.profiles(id),
  to_user_id      uuid REFERENCES public.profiles(id),
  from_due_date   date, to_due_date date,

  -- Metric 5's denominator is "work items that entered the caller's ball-in-court
  -- that week, counted off projects.work_item_events" (§15 metric 5). Without
  -- these two columns that number can only be reconstructed from the row's
  -- CURRENT gatekeeper_id — which is precisely the error §15 §(b) forbids, and
  -- it is wrong for every item whose gatekeeper was ever corrected.
  from_ball_in_court_id uuid REFERENCES public.profiles(id),
  to_ball_in_court_id   uuid REFERENCES public.profiles(id),

  -- The actor, from auth.uid() inside the definer trigger — NEVER current_user,
  -- which resolves to the function owner. NULL for a service-role path.
  actor_id        uuid REFERENCES public.profiles(id),
  -- §15 §(b): "the effective role stamped AT EVENT TIME, not re-resolved later".
  -- Metric 2a's diagnostic — the share of contractor-held items that moved —
  -- is the only first-party evidence the spine reached the 13 contractor
  -- accounts. Email engagement cannot stand in for it: opens and bounces ARE
  -- recorded per message in public.email_events (00185, the Resend webhook),
  -- but nothing joins them to a work item, so per-item email engagement
  -- remains unmeasurable and actor_role is the first-party signal.
  actor_role      text,

  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_item_events_item_idx
  ON projects.work_item_events (work_item_id, created_at);

-- ─── 4. projects.work_item_watchers — notification-only, never blocking ──────
-- Replaces the roster fan-out: notifyRfiEvent (called from createRfiAction,
-- respondToRfiAction and closeRfiAction in apps/web/src/actions/rfi.actions.ts,
-- implemented in apps/web/src/lib/rfi-email.ts via notifyEntityEvent) bells
-- every project member but the actor and emails the same roster. Together with
-- the diary path those produce the 964 notifications of which 57 have ever been read.
-- Auto-populated by projects.append_work_item_event() (§11) on create and on
-- every reassignment — §03 §1.8's "auto-populated on create, assign and
-- @mention", minus the @mention half, which arrives with threads.
CREATE TABLE IF NOT EXISTS projects.work_item_watchers (
  work_item_id uuid NOT NULL REFERENCES projects.work_items(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id)     ON DELETE CASCADE,
  reason       text NOT NULL CHECK (reason IN ('creator','raiser','assignee','gatekeeper','mention','manual')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_item_id, user_id)
);

ALTER TABLE projects.work_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.work_item_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.work_item_watchers ENABLE ROW LEVEL SECURITY;

-- ─── 5. The working-day arithmetic and the due-date trigger ──────────────────
-- A(h) supplies projects.public_holidays, projects.calendar_years and
-- working_days_between() (item 1's migration). add_working_days is the INVERSE
-- and lives here, because the due-date trigger needs to ADD days, not count them.
--
-- STABLE, never IMMUTABLE: it reads two tables, and marking it immutable would
-- let the planner fold a result across an October calendar refresh (A(h)).
-- working_days is read as ISO day-of-week (Mon=1 .. Sun=7), matching
-- 00101_project_settings.sql:20's ARRAY[1,2,3,4,5] default; `site` adds 6.
--
-- The anon/PUBLIC revokes for the three functions below land in §10 with the
-- rest of the grant block, in the section order the preamble fixes — they are
-- declared as grant_absent: in the @verify block above.
CREATE OR REPLACE FUNCTION projects.add_working_days(
  p_from date, p_days int, p_project uuid, p_calendar text
) RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE
  v_days int[]; v_extra date[]; v_cursor date := p_from; v_left int := p_days;
  v_limit date; v_year int;
BEGIN
  -- IS NULL first (as working_days_between does): `NULL NOT IN (...)` is NULL,
  -- which an IF treats as false, so a NULL calendar would slip past this guard
  -- and then walk as `office` — the silent default A(h) forbids.
  IF p_calendar IS NULL OR p_calendar NOT IN ('office','site') THEN
    RAISE EXCEPTION 'add_working_days: unknown calendar %; A(h) defines exactly office and site', COALESCE(p_calendar, '<null>')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- p_days = 0 is refused rather than defined. "Return p_from unchanged" would
  -- hand back a Sunday or a public holiday with no error; "return the first
  -- working day on or after p_from" is a different function and nothing calls it.
  IF p_days IS NULL OR p_days < 1 THEN
    RAISE EXCEPTION 'add_working_days: p_days must be >= 1, got %', p_days
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT ps.working_days, ps.extra_holidays INTO v_days, v_extra
    FROM projects.project_settings ps WHERE ps.project_id = p_project;
  IF v_days IS NULL THEN                       -- no settings row yet
    v_days := ARRAY[1,2,3,4,5]; v_extra := ARRAY[]::date[];
  END IF;

  -- The empty-array check comes BEFORE the Saturday append. After it, an empty
  -- working_days array would silently become a Saturday-only calendar on the
  -- site path — a wrong answer instead of an error.
  IF cardinality(v_days) = 0 THEN
    RAISE EXCEPTION 'add_working_days: project % has an empty working_days array; no date can ever be reached', p_project
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_calendar = 'site' AND NOT (6 = ANY (v_days)) THEN
    v_days := v_days || 6;                     -- A(h): site = office + Saturday
  END IF;

  -- Loop bound, computed AFTER the Saturday append so it reflects the calendar
  -- actually walked: 14 calendar days per working day divided by the number of
  -- working weekdays (one working weekday needs 7 calendar days per working
  -- day, five need 1.4; the factor of two absorbs holiday runs), plus 45 days
  -- for a year-end shutdown. Integer division. A Saturday-only project asking
  -- for 30 days gets 465, not the 135 a flat "3 per day" gave, which raised
  -- the "no working day found" error on a perfectly reachable date.
  v_limit := p_from + ((p_days * 14) / GREATEST(cardinality(v_days), 1)) + 45;

  -- Every year the walk ENTERS must be seeded: p_from's own year before the
  -- first step, then each year the cursor crosses into, checked ONCE per year
  -- at the top of the loop and BEFORE that day is evaluated. Lazy, not eager
  -- over p_from..v_limit — the bound is deliberately generous, and a walk that
  -- lands in November must not raise for a January it never reaches (the TS
  -- mirror's per-step assertSeeded has the same shape). An unseeded year
  -- RAISES — there is no fallback to calendar days (A(h)), because a silent
  -- one-day drift changes whether an item escalates. The HINT names the
  -- re-seed, because this error surfaces to an operator through a failed
  -- source write.
  v_year := NULL;
  LOOP
    IF v_year IS DISTINCT FROM EXTRACT(YEAR FROM v_cursor)::int THEN
      v_year := EXTRACT(YEAR FROM v_cursor)::int;
      IF NOT EXISTS (SELECT 1 FROM projects.calendar_years cy WHERE cy.year = v_year) THEN
        RAISE EXCEPTION USING ERRCODE = 'no_data_found',
          MESSAGE = format('add_working_days: calendar year %s is not seeded in projects.calendar_years', v_year),
          HINT    = format('Seed it: INSERT INTO projects.calendar_years (year) VALUES (%s) ON CONFLICT DO NOTHING; then load that year''s public holidays from listHolidays(%s). A(h) forbids falling back to calendar days.', v_year, v_year);
      END IF;
    END IF;
    -- p_from itself is never a counted day: the first pass only checks its year.
    IF v_cursor > p_from
       AND EXTRACT(ISODOW FROM v_cursor)::int = ANY (v_days)
       AND NOT EXISTS (SELECT 1 FROM projects.public_holidays h WHERE h.d = v_cursor)
       AND NOT (v_cursor = ANY (COALESCE(v_extra, ARRAY[]::date[])))
    THEN
      v_left := v_left - 1;
    END IF;
    EXIT WHEN v_left = 0;
    v_cursor := v_cursor + 1;
    IF v_cursor > v_limit THEN
      RAISE EXCEPTION 'add_working_days: no working day found within % days of %', v_limit - p_from, p_from
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;
  RETURN v_cursor;
END;
$fn$;

-- A(h): "A due date landing inside the December builders' shutdown is pushed to
-- the first site working day of the new year; the shutdown window is a
-- per-project setting." Gated by the EXISTING builders_holiday boolean
-- (00101:23), so a project that does not shut down is untouched.
CREATE OR REPLACE FUNCTION projects.push_past_builders_shutdown(p_date date, p_project uuid)
RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE v_on boolean; v_start text; v_end text; v_wrap boolean; y int; band_start date; band_end date;
BEGIN
  SELECT ps.builders_holiday, ps.builders_shutdown_start_md, ps.builders_shutdown_end_md
    INTO v_on, v_start, v_end
    FROM projects.project_settings ps WHERE ps.project_id = p_project;
  IF NOT COALESCE(v_on, false) THEN RETURN p_date; END IF;

  -- A window that wraps the year end (12-15..01-15) ends in the NEXT year; a
  -- mid-year or same-December window (12-15..12-31) is a legal setting too and
  -- ends in its own. The text compare is safe because 00195's CHECK forces
  -- zero-padded MM-DD. Always adding a year made 12-15..12-31 a YEAR-LONG band
  -- (probe: 2026-06-10 was pushed to 2027-01-02).
  v_wrap := (v_end < v_start);

  -- Two bands: a January date belongs to the PREVIOUS December's band, a
  -- December date to its own.
  FOR y IN EXTRACT(YEAR FROM p_date)::int - 1 .. EXTRACT(YEAR FROM p_date)::int LOOP
    band_start := to_date(y::text || '-' || v_start, 'YYYY-MM-DD');
    band_end   := to_date((y + CASE WHEN v_wrap THEN 1 ELSE 0 END)::text || '-' || v_end, 'YYYY-MM-DD');
    IF p_date BETWEEN band_start AND band_end THEN
      RETURN projects.add_working_days(band_end, 1, p_project, 'site');
    END IF;
  END LOOP;
  RETURN p_date;
END;
$fn$;

-- BEFORE INSERT due-date trigger.
--
-- SECURITY DEFINER with row_security off, and that is deliberate: it computes a
-- value, it authorises nothing, and it must produce the same date whether the
-- caller is a contractor who cannot read project_settings under their own RLS or
-- the service client. It never reads current_user. Contrast the transition guard
-- (§12), which IS an authorisation decision.
--
-- There is no calendar-day fallback. §03 §1.5's "calendar-day fallback" sentence
-- is about a path that supplies no date getting one computed rather than failing;
-- A(h) [R24] governs the unseeded-year case and forbids the fallback outright.
CREATE OR REPLACE FUNCTION projects.work_items_set_due_date() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE
  v_days int; v_cal text; v_defaults jsonb; v_rfi_default int; v_override int;
  v_msg text; v_hint text;
BEGIN
  -- A client session never dictates the opening moment. WITH CHECK cannot
  -- pin a timestamp, so the trigger stamps both: a backdated opened_at would
  -- pre-age every escalation and a future last_activity_at would hide the
  -- item from every "stale" query (a 400-day backdate was accepted before
  -- this, proven in review). auth.uid() is NULL on the service and backfill
  -- paths — item 3's historical mirrors carry the source row's real
  -- opened_at and keep it. Asserted by work-item-rls.sql 6c; the postgres-run
  -- files (work-item-due-date.sql among them) are unaffected.
  IF auth.uid() IS NOT NULL THEN
    NEW.opened_at        := now();
    NEW.last_activity_at := now();
  END IF;

  SELECT t.default_days, t.calendar INTO v_days, v_cal
    FROM projects.work_item_types t WHERE t.key = NEW.item_type;
  IF v_days IS NULL THEN
    RAISE EXCEPTION 'There is no work-item type called "%". Pick one of the registered types.', NEW.item_type
      USING ERRCODE = 'raise_exception';
  END IF;

  SELECT ps.work_item_defaults, ps.default_rfi_due_days
    INTO v_defaults, v_rfi_default
    FROM projects.project_settings ps WHERE ps.project_id = NEW.project_id;

  v_override := NULLIF(v_defaults -> NEW.item_type ->> 'days_to_respond', '')::int;

  -- The rfi arm reads project_settings.default_rfi_due_days LIVE (00101:30),
  -- never a copy taken at migration time. The settings surface writes that
  -- column and does not touch work_item_defaults, so a copy would be correct
  -- only until the first PM edited it — and §13 requires rfi to read the
  -- existing default, not a snapshot of it. work_item_defaults.rfi is therefore
  -- seeded with a NULL days_to_respond (§13), and a per-project OVERRIDE typed
  -- into that key still wins, which is the whole point of the key existing.
  v_days := COALESCE(
    v_override,
    CASE WHEN NEW.item_type = 'rfi' THEN v_rfi_default END,
    v_days);

  -- Both the computed date and the shutdown push walk the calendar, and the
  -- push does so for a SUPPLIED date too (a 20 Dec date handed in by a PM is
  -- pushed into January, which may be the unseeded year) — so both sit inside
  -- the one handler.
  BEGIN
    IF NEW.due_date IS NULL THEN
      NEW.due_date := projects.add_working_days(
        (now() AT TIME ZONE 'Africa/Johannesburg')::date, v_days, NEW.project_id, v_cal);
    END IF;
    -- Applied to a supplied date as well as a computed one: the point of the
    -- push is that nobody is on site to do the work, which is true however the
    -- date arrived.
    NEW.due_date := projects.push_past_builders_shutdown(NEW.due_date, NEW.project_id);
  EXCEPTION WHEN no_data_found THEN
    -- Re-raise with copy an operator can act on: this error reaches a foreman
    -- trying to log a snag, so the MESSAGE names the consequence. The original
    -- message (which names the year) survives as DETAIL and the original HINT
    -- (the re-seed command) as HINT — `HINT = SQLERRM` would have thrown the
    -- command away.
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
    RAISE EXCEPTION 'The working-day calendar has not been set up far enough ahead, so a due date cannot be worked out. Ask an administrator to load the public holidays for this year and the next two.'
      USING ERRCODE = 'no_data_found', DETAIL = v_msg, HINT = v_hint;
  END;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS work_items_set_due_date_trg ON projects.work_items;
CREATE TRIGGER work_items_set_due_date_trg
  BEFORE INSERT ON projects.work_items
  FOR EACH ROW EXECUTE FUNCTION projects.work_items_set_due_date();

-- ─── 6. The ref allocator ────────────────────────────────────────────────────
-- '<PREFIX>-<n>', n per project per type, allocated at insert, never reused.
-- This is the qc_reports_ensure_no pattern (00172:91-105) with
-- UNIQUE (project_id, ref) above it, plus two things it does not have.
--
-- (1) THE PREFIX IS AN EXPLICIT CASE, not upper(item_type). `ref` is immutable
--     (the transition guard, §12) because it is a permanent identifier in
--     emails, PDFs and other people's notes, and §15 §(e) lists work-item ids in
--     client deep links as a one-way door. upper(item_type) yields QC_DEFECT-7
--     and ORDER_FOLLOWUP-3, permanently, from the first row. This CASE adds no
--     COLUMN, so A(b)'s set-equality test is untouched — which was the only
--     reason a ref_prefix column was rejected. Mirrored by REF_PREFIXES in
--     packages/shared/src/work-items/types.ts, and the contract test asserts
--     the two agree, arm for arm.
--
-- (2) The advisory lock. Item 3's backfill inserts ~50 rows in one statement and
--     future mirrors fire concurrently; without it two concurrent inserts read
--     the same MAX and the second dies on work_items_ref_unique.
--     Transaction-scoped, so it releases on commit or rollback with no cleanup.
--     Two caveats, both fail-safe. (a) The locks are held to COMMIT, so a
--     transaction inserting two or more TYPES on one project in a different
--     order from a concurrent one can deadlock (40P01 — aborted cleanly, no
--     corruption); a single-row insert cannot. (b) MAX-after-lock relies on
--     READ COMMITTED, where each statement in a VOLATILE plpgsql function takes
--     a fresh snapshot and so sees the row the lock's previous holder committed.
--     Under REPEATABLE READ a waiter reads a stale MAX and falls to
--     work_items_ref_unique — a clean 23505, still never a duplicate.
--
-- MAX + 1 is monotonic here because work_items are NEVER DELETED — there is no
-- DELETE policy for authenticated and the DELETE grant is revoked in §10, so a
-- row leaves the inbox by becoming 'void', never by disappearing.
--
-- row_security is OFF, as in §5: the MAX must range over EVERY row on the
-- project, not the caller's visible subset — a contractor who can read only the
-- items they hold would otherwise compute a MAX that misses rows and collide on
-- work_items_ref_unique. It authorises nothing and never reads current_user.
--
-- COALESCE and NULLIF are grammar constructs, not pg_catalog functions:
-- `pg_catalog.coalesce(...)` is a 42883 on PG 17.6 (measured). They resolve
-- without a search_path; max/regexp_replace/upper are schema-qualified because
-- search_path is ''.
--
-- BEFORE ROW triggers fire in NAME order and before referential integrity, so
-- on this table the sequence is work_items_assert_membership_trg (§7) ->
-- work_items_ensure_ref_trg -> work_items_set_due_date_trg. An unregistered
-- item_type therefore reaches this function before the FK to work_item_types
-- fires: it falls through to the ELSE and gets a ref, and the due-date trigger
-- — next in name order — refuses it with a sentence that names the type
-- (asserted by work-item-due-date.sql assertion 12). Nothing here raises for it.
--
-- The anon/PUBLIC revokes for this function land in §10 (Task 9) with the rest
-- of the grant block, in the section order the preamble fixes — declared as
-- grant_absent: in the @verify block above. There are no revokes in this section.
CREATE OR REPLACE FUNCTION projects.work_items_ensure_ref() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
SET row_security TO 'off'
AS $fn$
DECLARE v_n int; v_prefix text;
BEGIN
  IF NEW.ref IS NOT NULL AND NEW.ref <> '' THEN RETURN NEW; END IF;

  v_prefix := CASE NEW.item_type
                WHEN 'rfi'            THEN 'RFI'
                WHEN 'snag'           THEN 'SNAG'
                WHEN 'qc_defect'      THEN 'QC'
                WHEN 'inspection'     THEN 'INSP'
                WHEN 'diary_action'   THEN 'DIARY'
                WHEN 'form_action'    THEN 'FORM'
                WHEN 'order_followup' THEN 'ORD'
                WHEN 'task'           THEN 'TASK'
                -- A type registered in a later quarter without an arm here still
                -- gets a working ref rather than a failed insert. Add the arm in
                -- the same migration that registers the type: the contract test
                -- fails the build until you do.
                ELSE pg_catalog.upper(NEW.item_type)
              END;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.project_id::text || ':' || NEW.item_type, 0));

  -- Count only tails the allocator can parse. An explicit ref with no numeric
  -- tail ('JUNK') or a tail past int4 ('TASK-2147483647') is a legal row — and
  -- a permanent one: ref is immutable from §12 and rows are never deleted, so
  -- there is NO repair path. Casting it would raise 22P02 / 22003 on every
  -- later auto insert of that type on that project, forever (measured, rolled
  -- back). {1,9} keeps MAX + 1 inside int4. The predicate is deliberately NOT
  -- prefix-anchored: the prefix implies the type, so anchoring on it would
  -- silently paper over a lost item_type predicate.
  SELECT COALESCE(
           pg_catalog.max(NULLIF(
             pg_catalog.regexp_replace(wi.ref, '^.*-', ''), '')::int), 0) + 1
    INTO v_n
    FROM projects.work_items wi
   WHERE wi.project_id = NEW.project_id AND wi.item_type = NEW.item_type
     AND wi.ref ~ '-[0-9]{1,9}$';

  NEW.ref := v_prefix || '-' || v_n::text;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS work_items_ensure_ref_trg ON projects.work_items;
CREATE TRIGGER work_items_ensure_ref_trg
  BEFORE INSERT ON projects.work_items
  FOR EACH ROW EXECUTE FUNCTION projects.work_items_ensure_ref();

-- ─── 7. Assignment: the resolution chain and the membership assertion ────────
-- §03 §1.6's chain, in order:
--   explicit assignee
--     -> work_item_defaults.<type>.triage_owner_id
--     -> project_settings.triage_owner_id
--     -> projects.resolve_project_pm()   (00195 §2: project PM -> org PM ->
--        org admin -> org owner -> created_by, every arm membership-validated)
-- Every candidate is validated with public.user_effective_project_role() before
-- it is returned, and one that fails validation is SKIPPED, never raised on.
-- It has to be: work_item_defaults holds ids in jsonb with no foreign key,
-- public.profiles cascades from auth.users (00001:62), and a departed
-- employee's id surviving there would otherwise abort the transaction and make
-- it impossible for anyone to raise an RFI on that project. The same holds for
-- project_settings.triage_owner_id, whose FK is to profiles, not to a
-- membership — a person who has left the project is still a legal value.
--
-- THE CONTRACT (00195 §2, decided 2026-09-12): the chain never raises for a
-- dead or departed id. It raises exactly once, with one actionable sentence,
-- for an ORPHANED project — one on which no PM, org PM, org admin, org owner
-- or creator still holds an effective role — because the only alternative
-- there is to return someone who cannot open the item, and the membership
-- trigger below would then refuse the row with a message that blames the
-- wrong thing ("that person is not on this project"). There is deliberately
-- NO separate org-owner arm: projects.org_owner() is NULL for the demo org
-- (measured 2026-09-12) and has no project context to validate against, while
-- resolve_project_pm() already carries the validated owner AND the validated
-- created_by. The plan's "terminates at the org owner and never raises" is
-- therefore replaced by this contract.
--
-- STABLE SECURITY DEFINER with row_security off, as 00195's resolvers: it
-- reads project_settings, which a contractor's own RLS may hide, and the
-- answer must not depend on who asked. It never reads current_user.
--
-- The anon/PUBLIC revokes for both functions in this section land in §10
-- (Task 9) with the rest of the grant block, in the section order the preamble
-- fixes — declared as grant_absent: in the @verify block above. There are no
-- revokes in this section.
CREATE OR REPLACE FUNCTION projects.resolve_work_item_assignee(
  p_project_id uuid, p_item_type text, p_explicit uuid
) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE v_candidate uuid; v_defaults jsonb; v_settings_owner uuid;
BEGIN
  -- Not an oracle. This is callable by authenticated (the people-picker and
  -- Task 13's create action need it) and it reads with RLS off, so without
  -- this check it answered ANY project id with that project's PM uuid — and
  -- RAISED for an orphaned one, a yes/no about a project the caller cannot
  -- see (proven in review from the KINGSWALK-only contractor against MAMAILA).
  -- NULL for a project the caller is not on; the service, definer-trigger and
  -- backfill paths have auth.uid() NULL and are unaffected, as is
  -- work-item-membership.sql, which runs as postgres. Asserted by
  -- work-item-rls.sql 11f.
  IF auth.uid() IS NOT NULL AND NOT public.user_has_project_access(p_project_id) THEN
    RETURN NULL;
  END IF;

  IF p_explicit IS NOT NULL
     AND public.user_effective_project_role(p_project_id, p_explicit) IS NOT NULL THEN
    RETURN p_explicit;
  END IF;

  SELECT ps.work_item_defaults, ps.triage_owner_id INTO v_defaults, v_settings_owner
    FROM projects.project_settings ps WHERE ps.project_id = p_project_id;

  -- A jsonb null or an absent key both read as SQL NULL here. The ::uuid cast
  -- is safe because validate_work_item_defaults() (§13) guarantees the value's
  -- shape at write time — a uuid string or null — so it is deliberate, not
  -- defensive: a malformed value is §13's error, raised at the settings write,
  -- never here at the source write.
  v_candidate := NULLIF(v_defaults -> p_item_type ->> 'triage_owner_id', '')::uuid;
  IF v_candidate IS NOT NULL
     AND public.user_effective_project_role(p_project_id, v_candidate) IS NOT NULL THEN
    RETURN v_candidate;
  END IF;

  IF v_settings_owner IS NOT NULL
     AND public.user_effective_project_role(p_project_id, v_settings_owner) IS NOT NULL THEN
    RETURN v_settings_owner;
  END IF;

  -- Validated end to end inside 00195; NULL only for an orphaned project.
  v_candidate := projects.resolve_project_pm(p_project_id);
  IF v_candidate IS NOT NULL THEN
    RETURN v_candidate;
  END IF;

  -- The one raise. Written for the PM who will read it in a server action's
  -- error.message; the fix it names is the only fix there is.
  RAISE EXCEPTION 'This project has nobody who can own work — add a project manager to it first.'
    USING ERRCODE = 'raise_exception';
END;
$fn$;

-- An item can never be assigned to someone who cannot open it. assignee_id is an
-- FK to public.profiles with NO membership predicate, so any profile in the
-- database — including one in another organisation — is nominally assignable.
-- The assign UI's people-picker reads the same set (§03 §1.9).
--
-- client_viewer is NOT excluded: in a shopping-centre fit-out the landlord is
-- frequently the ball-in-court, and an item that cannot point at them is a worse
-- bug than one they cannot yet clear. Their write carve-out lands in Q3.
--
-- Fires on UPDATE as well as INSERT, because RLS cannot compare OLD and NEW and
-- reassignment would otherwise be the hole the INSERT check closes. It is
-- declared UPDATE OF project_id too, and the body HONOURS that: the same
-- assignee on a different project is a different membership question, so a
-- project move re-checks both people. §12's work_items_transition_guard_trg
-- also makes project_id immutable; this is the layer beneath it, and it runs
-- FIRST because BEFORE ROW triggers fire in name order ('a' < 't') — Task 11
-- must keep that trigger name for the order to hold.
--
-- A NULL person column, or a NULL project, is passed through untouched: BEFORE
-- ROW triggers run before the column constraints, and
-- user_effective_project_role(project, NULL) is NULL (measured), so checking it
-- would refuse the row as "not on this project" — sending a PM to look for a
-- person who was never named — instead of letting the NOT NULL constraint
-- report the column that is actually missing.
--
-- item_type is never touched here: an unregistered type passes through so the
-- due-date trigger, later in name order (work_items_ensure_ref_trg is next,
-- work_items_set_due_date_trg third), refuses it with a sentence that names
-- it (work-item-due-date.sql assertion 12).
--
-- The message names COALESCE(ref, title), not ref: BEFORE ROW triggers fire in
-- NAME order, so work_items_assert_membership_trg runs before
-- work_items_ensure_ref_trg and NEW.ref is still NULL on INSERT. It is written
-- as a sentence because every server action returns error.message straight to
-- the user — this string is what a PM sees for picking the wrong person from a
-- list.
--
-- SECURITY DEFINER with row_security off is consistency with 00195 and §5/§6,
-- NOT load-bearing: this function reads no table itself — every read happens
-- inside user_effective_project_role(), which is DEFINER with row_security off
-- in its own right — and it authorises nothing by current_user. Kept so a
-- future direct read (a richer message naming the project, say) cannot
-- silently run under the caller's RLS.
CREATE OR REPLACE FUNCTION projects.work_items_assert_membership() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'projects', 'public'
SET row_security TO 'off'
AS $fn$
DECLARE
  v_label text := COALESCE(NEW.ref, NEW.title, 'this item');
  -- On INSERT, and on a move to another project, BOTH people are re-checked
  -- whether or not they changed. PostgreSQL promises no evaluation order for
  -- OR, and none is needed: on PG >= 11 OLD reads as NULL inside an INSERT
  -- trigger, so NEW.project_id IS DISTINCT FROM NULL is simply true there.
  -- work-item-membership.sql assertion 1 exercises exactly that path.
  v_recheck_all boolean := (TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id);
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;   -- the NOT NULL constraint's to report

  IF NEW.assignee_id IS NOT NULL
     AND (v_recheck_all OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id)
     AND public.user_effective_project_role(NEW.project_id, NEW.assignee_id) IS NULL THEN
    RAISE EXCEPTION 'That person is not on this project, so % cannot be given to them. Add them to the project first, or choose someone who is already on it.', v_label
      USING ERRCODE = 'raise_exception';
  END IF;
  IF NEW.gatekeeper_id IS NOT NULL
     AND (v_recheck_all OR NEW.gatekeeper_id IS DISTINCT FROM OLD.gatekeeper_id)
     AND public.user_effective_project_role(NEW.project_id, NEW.gatekeeper_id) IS NULL THEN
    RAISE EXCEPTION 'That person is not on this project, so they cannot sign % off. Add them to the project first, or choose someone who is already on it.', v_label
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS work_items_assert_membership_trg ON projects.work_items;
CREATE TRIGGER work_items_assert_membership_trg
  BEFORE INSERT OR UPDATE OF assignee_id, gatekeeper_id, project_id ON projects.work_items
  FOR EACH ROW EXECUTE FUNCTION projects.work_items_assert_membership();

-- ─── 8. Helpers ──────────────────────────────────────────────────────────────
-- STABLE SECURITY DEFINER, search_path pinned, row_security off (§12 §(b) rule
-- 6). Neither reads current_user, and every role test FAILS CLOSED on NULL.
-- user_effective_project_role() returns NULL for a non-member AND for a
-- DEACTIVATED member, while user_has_project_access() (00106) has no
-- pm.is_active predicate and stays TRUE for the latter. The project-access
-- arm's role test therefore COALESCEs a NULL role to 'client_viewer' — the
-- role it excludes — never to '': that read a deactivated client viewer as
-- "not a client viewer" and admitted them to every item and event on the
-- project (found in review; work-item-rls.sql 22 keeps it closed). Same shape
-- in work_items_select and both halves of work_items_update_gate. The write
-- helper COALESCEs `NULL = ANY (…)` to FALSE for the same reason.
--
-- These come BEFORE §9 because CREATE POLICY resolves function references at
-- creation time: work_item_events_select calls user_can_read_work_item(), and
-- the helper's own body references work_items and work_item_watchers (§2, §4).
--
-- row_security off is also what keeps the policy set from recursing:
-- work_items_select consults work_item_watchers, whose policy calls this
-- helper, which reads work_items again. With RLS applied inside the helper
-- that chain would re-enter work_items_select; with it off the helper reads
-- the row itself and answers the access question once.
CREATE OR REPLACE FUNCTION projects.user_can_read_work_item(p_work_item_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM projects.work_items wi
     WHERE wi.id = p_work_item_id
       AND ( ( public.user_has_project_access(wi.project_id)
               AND COALESCE(public.user_effective_project_role(wi.project_id, auth.uid()), 'client_viewer')
                   <> 'client_viewer' )
             OR wi.assignee_id   = auth.uid()
             OR wi.gatekeeper_id = auth.uid()
             OR EXISTS (SELECT 1 FROM projects.work_item_watchers w
                         WHERE w.work_item_id = wi.id AND w.user_id = auth.uid())));
$fn$;

-- Resolves the type's write_roles from the registry, so widening a type's write
-- set is one UPDATE in one place and never a policy rewrite. An unregistered or
-- inactive type yields no rows, and `x = ANY (<no rows>)` is FALSE; a
-- non-member's NULL role is COALESCEd to FALSE.
CREATE OR REPLACE FUNCTION projects.user_can_write_work_item(p_project_id uuid, p_item_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off'
AS $fn$
  SELECT COALESCE(
    public.user_effective_project_role(p_project_id, auth.uid()) = ANY (
      SELECT unnest(t.write_roles) FROM projects.work_item_types t
       WHERE t.key = p_item_type AND t.is_active),
    FALSE);
$fn$;

-- Every function §5-§8 created, revoked here in one place (the preamble's
-- section order; each is declared as grant_absent: in the @verify block).
REVOKE ALL ON FUNCTION projects.user_can_read_work_item(uuid)              FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.user_can_write_work_item(uuid,text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.add_working_days(date,int,uuid,text)       FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.push_past_builders_shutdown(date,uuid)     FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.resolve_work_item_assignee(uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.work_items_set_due_date()                  FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.work_items_ensure_ref()                    FROM PUBLIC;
REVOKE ALL ON FUNCTION projects.work_items_assert_membership()             FROM PUBLIC;
-- FROM PUBLIC is NOT enough where anon holds a DIRECT grant: Supabase's
-- ALTER DEFAULT PRIVILEGES grants anon EXECUTE at creation in public, a
-- separate grant (00113:15-24). 00179:314-323 is not the precedent — it never
-- names anon. In projects there is no function default ACL (pg_default_acl,
-- measured 2026-09-12: tables and sequences only), so anon's EXECUTE here is
-- the built-in PUBLIC grant and the FROM anon lines are belt-and-braces —
-- kept, because has_function_privilege('anon', …) is the check, never proacl,
-- and a future default ACL on this schema must not silently re-open it.
REVOKE EXECUTE ON FUNCTION projects.user_can_read_work_item(uuid)              FROM anon;
REVOKE EXECUTE ON FUNCTION projects.user_can_write_work_item(uuid,text)        FROM anon;
REVOKE EXECUTE ON FUNCTION projects.add_working_days(date,int,uuid,text)       FROM anon;
REVOKE EXECUTE ON FUNCTION projects.push_past_builders_shutdown(date,uuid)     FROM anon;
REVOKE EXECUTE ON FUNCTION projects.resolve_work_item_assignee(uuid,text,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION projects.work_items_set_due_date()                  FROM anon;
REVOKE EXECUTE ON FUNCTION projects.work_items_ensure_ref()                    FROM anon;
REVOKE EXECUTE ON FUNCTION projects.work_items_assert_membership()             FROM anon;

-- The two policy helpers are evaluated AS THE CALLING ROLE inside every policy,
-- so authenticated must hold EXECUTE on them or every SELECT on the four
-- tables fails with "permission denied for function". The three calculators
-- are callable by the app directly (client-side due-date prediction, the
-- people-picker). The three TRIGGER functions get no grant at all: Postgres
-- checks EXECUTE on a trigger function at CREATE TRIGGER time, for the
-- creator, never at fire time — so the triggers fire for a contractor's
-- insert while the functions stay uncallable by anyone but the owner.
GRANT EXECUTE ON FUNCTION projects.user_can_read_work_item(uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.user_can_write_work_item(uuid,text)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.add_working_days(date,int,uuid,text)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.push_past_builders_shutdown(date,uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION projects.resolve_work_item_assignee(uuid,text,uuid) TO authenticated, service_role;

-- ─── 9. RLS ──────────────────────────────────────────────────────────────────
-- ⚠ A RESTRICTIVE policy grants nothing. RLS needs at least one PERMISSIVE
-- policy to pass before a RESTRICTIVE one is even consulted. 00171 added its
-- RESTRICTIVE trio to a table that already had permissive policies; these
-- tables are brand new, so BOTH are written here. A RESTRICTIVE-only table
-- silently rejects every write and looks like a broken feature.
--
-- DROP IF EXISTS before every CREATE POLICY (the file's convention, §1), so a
-- partial re-apply does not stop on "policy already exists".
--
-- SELECT is PERMISSIVE and deliberately WIDER than the write gate — for everyone
-- except a client viewer. Gating on user_effective_project_role IS NOT NULL
-- would be narrower than the source tables (rfis is org-wide for
-- non-client-viewers, 00034:103-115) and narrower than the assignment rule,
-- giving a user who sees the RFI in the module list but not its work item.
-- 00107's own header says it "does NOT gate ACCESS".
--
-- The client_viewer exclusion on the project-access arm is PR #162's fix applied
-- to a new table: public.user_has_project_access() is TRUE for ANY
-- project_members row regardless of role (00106 clause (a)), which is precisely
-- how a client viewer could list and download every saved report of every kind.
-- Unqualified here it would expose mirrored order_followup and qc_defect titles
-- the same landlord is deliberately gated out of on the Equipment & Materials
-- report. They keep every item they hold, gatekeep or watch — §04 §(d)'s
-- "filtered to items where they are ball-in-court", enforced in the database
-- rather than left to the query.
DROP POLICY IF EXISTS work_items_select ON projects.work_items;
CREATE POLICY work_items_select ON projects.work_items
  FOR SELECT TO authenticated
  USING (
    ( public.user_has_project_access(project_id)
      AND COALESCE(public.user_effective_project_role(project_id, auth.uid()), 'client_viewer')
          <> 'client_viewer' )
    OR assignee_id   = auth.uid()
    OR gatekeeper_id = auth.uid()
    OR EXISTS (SELECT 1 FROM projects.work_item_watchers w
                WHERE w.work_item_id = projects.work_items.id AND w.user_id = auth.uid())
  );

-- PERMISSIVE INSERT. Without this the RESTRICTIVE policy below grants nothing
-- and every insert is silently rejected: RESTRICTIVE narrows, it never permits.
-- Rule 3 (§12 §(b)): organisation_id is bound to the PROJECT's own org. The
-- foreign-org walk this prevents is a real prior incident — a draft site form
-- could be hopped into an org the author was not a member of (PR #160 defect 3).
DROP POLICY IF EXISTS work_items_insert ON projects.work_items;
CREATE POLICY work_items_insert ON projects.work_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_project_access(project_id)
    AND created_by = auth.uid()
    AND organisation_id = (SELECT p.organisation_id FROM projects.projects p WHERE p.id = project_id)
  );

-- RESTRICTIVE INSERT gate, 00171's construction (00171:115-146). A restrictive
-- policy is the only construct that cannot be widened by a later permissive
-- policy someone adds in a hurry. Its arms, in order:
--
-- (a) `task` is the ONLY client-insertable type in Q1, and it carries no
--     source. Every mirrored type stays source-only: the source row is the only
--     entry point (§03 §1.2). `order_followup` becomes client-insertable when
--     the explicit chase control on the order line ships; that item adds an
--     arm here requiring node_order_id and nothing else. Item 8 adds the
--     project_module_enabled() arm. The ref shape is defence in depth: WITH
--     CHECK is evaluated AFTER the BEFORE ROW triggers, so §6's own output
--     always passes, and the arm only refuses a client-supplied ref — 'JUNK'
--     would be a permanent row (ref immutable from §12, rows never deleted)
--     that §6's suffix filter has to dodge forever.
-- (b) Born live. The column default is 'triage' and createWorkItemTaskAction
--     inserts 'open' as a server-side literal (§03 §1.6, a named assignee);
--     nothing legitimate inserts 'answered', 'closed' or 'void'. A born-closed
--     row has no events behind it (metrics 4, 7) and a born-void row carries a
--     void_reason nobody wrote. This is the INSERT half of what §12's guard
--     does on UPDATE — the guard is BEFORE UPDATE only and must stay so
--     (work-item-ref.sql 3a inserts as the table owner).
-- (c) origin is 'manual', said explicitly. The column DEFAULTS to 'mirror'
--     (the source-driven case), so a client insert that omitted it would be
--     recorded as the mirror of a source it does not have; 'split' is item
--     3's deliberate construction, never a client's. createWorkItemTaskAction
--     inserts origin = 'manual'.
-- (d) Born live, born unclosed. The status default is 'triage' and
--     createWorkItemTaskAction inserts 'open' as a server-side literal (§03
--     §1.6, a named assignee); nothing legitimate inserts 'answered', 'closed'
--     or 'void'. A born-closed row has no events behind it (metrics 4, 7) and
--     a born-void row carries a void_reason nobody wrote; closed_at, closed_by
--     and void_reason are §12's to write on the UPDATE that closes or voids,
--     so a client cannot pre-fill them either. This is the INSERT half of what
--     §12's guard does on UPDATE — the guard is BEFORE UPDATE only and must
--     stay so (work-item-ref.sql 3a inserts as the table owner). opened_at and
--     last_activity_at cannot be pinned by a WITH CHECK; §5's trigger stamps
--     them for any client session instead.
-- (e) The registry's write set. No registered type admits client_viewer, so
--     this arm is also what blocks a client viewer from INSERTING. 00161 does
--     not cover this table.
DROP POLICY IF EXISTS work_items_insert_gate ON projects.work_items;
CREATE POLICY work_items_insert_gate ON projects.work_items
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    item_type = 'task'
    AND ref ~ '^TASK-[0-9]{1,9}$'
    AND rfi_id IS NULL AND snag_id IS NULL AND qc_entry_id IS NULL
    AND diary_id IS NULL AND site_form_id IS NULL
    AND node_order_id IS NULL AND inspection_id IS NULL
    AND origin = 'manual'
    AND status IN ('triage','open')
    AND closed_at IS NULL AND closed_by IS NULL AND void_reason IS NULL
    AND projects.user_can_write_work_item(project_id, item_type)
  );

-- PERMISSIVE UPDATE. The two identity clauses are how a contractor answers
-- their own item without holding a project-wide write role. Its WITH CHECK is
-- THE binding layer for organisation_id on UPDATE: the RESTRICTIVE gate below
-- does not repeat the clause, because RESTRICTIVE and PERMISSIVE WITH CHECKs
-- are ANDed and one is sufficient — and it lives on the permissive policy
-- because that is the one every UPDATE must pass. §12's guard additionally
-- makes organisation_id and project_id immutable outright; this clause is the
-- layer beneath it. Asserted by work-item-rls.sql 9b.
DROP POLICY IF EXISTS work_items_update ON projects.work_items;
CREATE POLICY work_items_update ON projects.work_items
  FOR UPDATE TO authenticated
  USING (
    public.user_has_project_access(project_id)
    OR assignee_id = auth.uid() OR gatekeeper_id = auth.uid()
  )
  WITH CHECK (
    organisation_id = (SELECT p.organisation_id FROM projects.projects p WHERE p.id = project_id)
  );

-- RESTRICTIVE UPDATE gate. client_viewer is blocked outright in Q1, and THIS IS
-- THE ONLY LAYER doing it for work_items: 00161_client_viewer_readonly_write_block
-- loops over a hard-coded list of 13 tables (00161:61-75) and a new table is not
-- among them. An item pointed at a client viewer is moved to 'answered' by its
-- gatekeeper on their behalf (§03 §1.9). Q3 replaces this arm with a WITH CHECK
-- admitting client_viewer only when assignee_id = auth.uid() and the row
-- difference is confined to status -> 'answered'.
--
-- The WITH CHECK deliberately does NOT re-bind organisation_id: the permissive
-- work_items_update above is the binding layer on UPDATE (see its comment).
DROP POLICY IF EXISTS work_items_update_gate ON projects.work_items;
CREATE POLICY work_items_update_gate ON projects.work_items
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    COALESCE(public.user_effective_project_role(project_id, auth.uid()), 'client_viewer') <> 'client_viewer'
    AND ( projects.user_can_write_work_item(project_id, item_type)
          OR assignee_id = auth.uid() OR gatekeeper_id = auth.uid() )
  )
  WITH CHECK (
    COALESCE(public.user_effective_project_role(project_id, auth.uid()), 'client_viewer') <> 'client_viewer'
    AND ( projects.user_can_write_work_item(project_id, item_type)
          OR assignee_id = auth.uid() OR gatekeeper_id = auth.uid() )
  );

-- NO DELETE policy, deliberately. An item leaves an inbox by becoming 'void',
-- never by disappearing — which is also what keeps the ref counter monotonic
-- and what stops a deletion destroying the events behind metrics 4, 5 and 7.

-- Read the history if you can read the item. NO write policy, deliberately:
-- the append trigger (§11) is SECURITY DEFINER and bypasses RLS by ownership,
-- which is what makes that shape possible (00179:504-506). An INSERT policy
-- here would let a client forge the audit trail — PR #160 defect 6.
DROP POLICY IF EXISTS work_item_events_select ON projects.work_item_events;
CREATE POLICY work_item_events_select ON projects.work_item_events
  FOR SELECT TO authenticated USING (projects.user_can_read_work_item(work_item_id));

DROP POLICY IF EXISTS work_item_watchers_select ON projects.work_item_watchers;
CREATE POLICY work_item_watchers_select ON projects.work_item_watchers
  FOR SELECT TO authenticated USING (projects.user_can_read_work_item(work_item_id));
-- Follow anything you can read; add someone else only with the type's write
-- role. No UPDATE policy: a watcher row is added or removed, never edited.
DROP POLICY IF EXISTS work_item_watchers_insert ON projects.work_item_watchers;
CREATE POLICY work_item_watchers_insert ON projects.work_item_watchers
  FOR INSERT TO authenticated
  WITH CHECK (projects.user_can_read_work_item(work_item_id)
              AND (user_id = auth.uid() OR EXISTS (
                SELECT 1 FROM projects.work_items wi
                 WHERE wi.id = work_item_id
                   AND projects.user_can_write_work_item(wi.project_id, wi.item_type))));
DROP POLICY IF EXISTS work_item_watchers_delete ON projects.work_item_watchers;
CREATE POLICY work_item_watchers_delete ON projects.work_item_watchers
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM projects.work_items wi
     WHERE wi.id = work_item_id
       AND projects.user_can_write_work_item(wi.project_id, wi.item_type)));

-- ─── 10. Grants ──────────────────────────────────────────────────────────────
-- 00025:26 sets ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES TO anon for
-- this schema, and unlike cable_schedule and structure it was never revoked
-- (00168:92-98 revoked only those two). All four tables are therefore born with
-- a standing anon SELECT grant, leaving RLS as the only thing between an
-- unauthenticated PostgREST caller and the inbox. ALL rather than SELECT — the
-- convention for every new table in an exposed schema. anon holds only SELECT
-- through that default today (pg_default_acl for projects, measured
-- 2026-09-12: anon=r on tables, nothing on sequences, no function default), so
-- the two are the same revoke; ALL stays correct if the default ever widens.
REVOKE ALL ON projects.work_items, projects.work_item_events,
                 projects.work_item_watchers, projects.work_item_types
  FROM anon;

-- No client ever deletes a work item or an event; revoking makes the refusal a
-- clear permission error instead of a silent zero-row statement, and it is
-- the other half of what makes §6's MAX+1 monotonic. Revoking INSERT/UPDATE on
-- work_item_events is what turns a SECURITY INVOKER append trigger into a hard
-- permission failure rather than a policy failure — see the mutation proof in
-- Task 10. The registry is migration-managed (§1): no client writes it.
REVOKE DELETE ON projects.work_items, projects.work_item_events FROM authenticated;
REVOKE INSERT, UPDATE ON projects.work_item_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON projects.work_item_types FROM authenticated;
-- A watcher row is added or removed, never edited: there is no UPDATE policy
-- on work_item_watchers, and a standing grant with no policy is exactly the
-- silent zero-row shape the revokes above exist to avoid.
REVOKE UPDATE ON projects.work_item_watchers FROM authenticated;

-- The durable one-line fix, so the NEXT table in this schema is not born
-- anon-readable either. ALTER DEFAULT PRIVILEGES is per-role: this edits the
-- entry owned by postgres, which is the role 00025 ran as and the role both
-- db push and the Management API run as (measured 2026-09-12) — run as any
-- other role it would silently touch a different, empty entry and change
-- nothing. SELECT is the whole of anon's default there (anon=r), so SELECT is
-- what is revoked; work-item-rls.sql assertion 1 reads pg_default_acl back.
ALTER DEFAULT PRIVILEGES IN SCHEMA projects REVOKE SELECT ON TABLES FROM anon;

NOTIFY pgrst, 'reload schema';
