# Site-Scoped Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every role except org owner/admin sees and writes only the projects they are a member of — in the database, in storage, in the web app's service-key paths and in the mobile token.

**Architecture:** One migration, GENERATED from a reviewed manifest, adds a RESTRICTIVE `site_scope` policy to every table that holds site data (direct `project_id`, or a child resolved to its project through a SECURITY DEFINER lookup). `user_has_project_access` / `user_effective_project_role` stop treating an org `project_manager` as all-sites. Storage gets one restrictive policy keyed on the path's project segment. The web app gains `requireProjectAccess` and a guard test over every service-key file. Proof is behavioural: impersonate a real contractor on production in rolled-back transactions, red first.

**Tech Stack:** Postgres/Supabase RLS, Management-API dry-run harness (`scripts/db/dry-run-migration.sh`), TypeScript generator in `packages/db` (vitest), Next.js 15 server code (vitest).

**Spec:** `docs/superpowers/specs/2026-10-01-site-scoped-access-design.md` (PR #258). Read §1–§8 before starting.

---

## Ground rules (read once)

- **Worktree on the SSD**, never under `~/.config` (pnpm store lives on the SSD): `git -C "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/esite" worktree add "../wt-site-scope" -b feat/site-scoped-access origin/main`, then `pnpm install --frozen-lockfile` inside it. Run tests with `TMPDIR="/Volumes/Extreme SSD/tmp"`.
- **The migration number is claimed at APPLY time (Task 12), not now.** Until then the generated SQL lives at `scripts/db/site-scope/site_scoped_access.sql`. Never put a numbered file in `apps/edge-functions/supabase/migrations/` before Task 12 — an early number strands (CLAUDE.md "Claiming a number is not holding it").
- **Three suites on any migration work:** `pnpm --filter web test`, `pnpm --filter @esite/shared test`, `pnpm --filter @esite/db test:ci`.
- **Dry runs** touch production inside `BEGIN … ROLLBACK`; the PAT comes from the keychain via `scripts/db/mgmt-api.sh`. The Management API returns only the LAST result set — every assertion file ends in ONE `SELECT check, ok …`.
- `set_config('request.jwt.claims', …, true)` outlives `RESET ROLE` within the transaction: seed fixtures as `postgres` FIRST, then impersonate.
- No em dash inside an `@verify` `sql:` payload outside a string literal or `/* */`.

## File map

| File | Responsibility |
|---|---|
| `scripts/db/assert-site-scope-coverage.sql` (create) | Schema-derived: every site table carries `site_scope` or is exempt; no orphan rows the gate would hide from everyone |
| `scripts/db/assert-site-scope.sql` (create) | Behavioural: real contractor sees own site, zero foreign rows, foreign write refused, storage refused; admin sees all and can create a project; org PM is site-only |
| `packages/db/src/site-scope/manifest.ts` (create) | The reviewed list: resolvers, gated tables + their project expression, exempt tables + reason |
| `packages/db/src/site-scope/generate.ts` (create) | Pure function: manifest + fixed SQL → migration text + `@verify` block |
| `packages/db/src/site-scope/fixed.sql.ts` (create) | Hand-written SQL: the two role functions, storage, profiles, projects, JWT hook |
| `packages/db/src/site-scope/generate.test.ts` (create) | Generator unit tests |
| `scripts/db/site-scope/emit.ts` (create) | CLI: writes `scripts/db/site-scope/site_scoped_access.sql` |
| `scripts/db/assert-uhpa-org-admin-control.sql` (modify) | Expectation change: org PM no longer auto-passes |
| `apps/web/src/lib/auth/require-project-access.ts` (create) | `requireProjectAccess(projectId)` |
| `apps/web/src/lib/auth/require-project-access.test.ts` (create) | Unit tests |
| `apps/web/src/lib/auth/service-client-gates.contract.test.ts` (create) | Every service-key file declares its gate |
| `apps/web/src/app/api/diary/notify/route.ts`, `actions/project-members*.ts`, `app/api/projects/[id]/boq/import/route.ts`, `actions/tender.actions.ts` (modify) | The weak gates the audit found |
| `supabase/powersync/sync-rules.yaml` (modify) | Org buckets only for `all_sites` tokens |
| `apps/web/src/app/(admin)/settings/users/*` (modify) | Each person's sites |
| `docs/rbac-matrix.md` (modify) | The rule at the top |

---

### Task 1: Coverage assertion (schema-derived), seen red

**Files:**
- Create: `scripts/db/assert-site-scope-coverage.sql`
- Create: `scripts/db/fixtures/noop.sql` (if absent: one line `SELECT 1;`)

The candidate set is computed from the catalog, never typed by hand: a hand-written list can only confirm its author's belief (CLAUDE.md, the `00204` family). The exempt list is the only hand-typed part and each entry carries its reason.

- [ ] **Step 1: Write the assertion file**

```sql
-- COVERAGE for site_scope: derived from the catalog.
--   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-site-scope-coverage.sql            (red)
--   scripts/db/dry-run-migration.sh scripts/db/site-scope/site_scoped_access.sql scripts/db/assert-site-scope-coverage.sql (green)
-- A site table = a base table in a site schema with a project_id column, or a
-- single-column FK (up to 3 hops) to such a table or to projects.projects.
WITH RECURSIVE
site_schemas(s) AS (VALUES ('public'),('projects'),('inspections'),('field'),('tenants'),
                           ('structure'),('gcr'),('cable_schedule'),('marketplace'),('whatsapp')),
exempt(t, reason) AS (VALUES
  ('projects.jbcc_letter_number_seqs','allocator table, no end-user access (definer only)'),
  ('inspections.coc_number_seqs','allocator table, no end-user access (definer only)'),
  ('field.form_number_seqs','allocator table, no end-user access (definer only)'),
  ('marketplace.orders','two-party contractor/supplier model; marketplace IN DEV; own follow-up'),
  ('marketplace.order_items','child of marketplace.orders (exempt)'),
  ('marketplace.supplier_ratings','child of marketplace.orders (exempt)'),
  ('marketplace.commission_records','child of marketplace.orders (exempt)'),
  ('public.email_events','org-admin-only read; project_id is metadata'),
  ('public.product_events','insert-only telemetry; project_id is metadata'),
  ('public.rate_sources','org rate library (rate_library_can_access), not site data'),
  ('public.rate_observations','org rate library, not site data'),
  ('public.rate_source_lines','org rate library, not site data'),
  ('cable_schedule.rate_library','org rate library, not site data'),
  ('whatsapp.inbound','service/definer only; wa_* functions act as the user under real RLS'),
  ('whatsapp.outbox','service/definer only'),
  ('whatsapp.phone_links','own-row policy; current_project_id is a menu pointer, not site data'),
  ('whatsapp.form_sessions','service/definer only'),
  ('whatsapp.form_links','service/definer only')
),
tbl AS (
  SELECT c.oid, n.nspname||'.'||c.relname AS t,
         EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='project_id' AND NOT a.attisdropped) AS has_pid
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relkind IN ('r','p') AND NOT c.relispartition AND n.nspname IN (SELECT s FROM site_schemas)
),
fk AS (
  SELECT con.conrelid AS child, con.confrelid AS parent FROM pg_constraint con
   WHERE con.contype='f' AND array_length(con.conkey,1)=1
),
reach(oid, depth) AS (
  SELECT oid, 0 FROM tbl WHERE has_pid OR t='projects.projects'
  UNION
  SELECT fk.child, r.depth+1 FROM reach r JOIN fk ON fk.parent=r.oid WHERE r.depth < 3
),
cand AS (
  SELECT DISTINCT t.t FROM tbl t JOIN reach r ON r.oid=t.oid WHERE t.t NOT IN (SELECT t FROM exempt)
),
gated AS (
  SELECT schemaname||'.'||tablename AS t FROM pg_policies
   WHERE policyname='site_scope' AND permissive='RESTRICTIVE' AND cmd='ALL'
)
SELECT 'site_scope present: '||c.t AS check, (c.t IN (SELECT t FROM gated)) AS ok
  FROM cand c
UNION ALL
SELECT 'exempt table still exists: '||e.t, EXISTS (SELECT 1 FROM tbl WHERE tbl.t=e.t) FROM exempt e
UNION ALL
SELECT 'storage site_scope_objects present',
       EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
                AND policyname='site_scope_objects' AND permissive='RESTRICTIVE')
ORDER BY 1;
```

- [ ] **Step 2: Run against a no-op — must be RED**

Run: `scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-site-scope-coverage.sql`
Expected: every `site_scope present: …` row `false` (about 115 rows), every `exempt table still exists` row `true`, storage row `false`. Save the list of `site_scope present` table names: it is the authoritative input for Task 3. If it names a table that is NOT in the Task 3 manifest, add it there (gate it, or exempt it here with a reason). If an exempt row is `false`, the table was dropped — remove the entry.

- [ ] **Step 3: Commit**

```bash
git add scripts/db/assert-site-scope-coverage.sql scripts/db/fixtures/noop.sql
git commit -m "test(db): site_scope coverage assertion derived from the catalog (red)"
```

---

### Task 2: Behavioural assertion, seen red

**Files:**
- Create: `scripts/db/assert-site-scope.sql`

Fixtures are real production users picked by query (never hard-coded ids): a contractor in WM-Consulting with exactly ONE active membership; a WM project they are NOT on that has drawings and nodes; an org admin; a client viewer. An org-level PM does not exist in production, so one is minted inside the transaction (rolled back) — without it the PM change has no negative case.

- [ ] **Step 1: Write the file**

```sql
-- BEHAVIOURAL assertions for site-scoped access, as real roles.
--   scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-site-scope.sql            (red)
--   scripts/db/dry-run-migration.sh scripts/db/site-scope/site_scoped_access.sql scripts/db/assert-site-scope.sql (green)
CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;
GRANT ALL ON _r TO authenticated, anon, service_role;

DO $$
DECLARE
  c_org      CONSTANT uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_con      uuid;  v_own uuid;  v_foreign uuid;
  v_admin    uuid;  v_cv uuid;   v_cv_proj uuid;  v_pm uuid;
  v_n        int;   v_m int;     v_ok boolean;    v_obj text;   v_new uuid;
BEGIN
  -- contractor with exactly one active membership in WM
  SELECT pm.user_id, min(pm.project_id::text)::uuid INTO v_con, v_own
    FROM projects.project_members pm
    JOIN public.user_organisations uo ON uo.user_id=pm.user_id AND uo.organisation_id=c_org AND uo.is_active AND uo.role='contractor'
   WHERE pm.is_active AND pm.organisation_id=c_org
   GROUP BY pm.user_id HAVING count(*)=1 LIMIT 1;
  IF v_con IS NULL THEN RAISE EXCEPTION 'fixture: no single-project contractor'; END IF;

  SELECT p.id INTO v_foreign FROM projects.projects p
   WHERE p.organisation_id=c_org AND p.id<>v_own
     AND EXISTS (SELECT 1 FROM tenants.floor_plans f WHERE f.project_id=p.id)
     AND EXISTS (SELECT 1 FROM structure.nodes x WHERE x.project_id=p.id)
     AND NOT EXISTS (SELECT 1 FROM projects.project_members m WHERE m.project_id=p.id AND m.user_id=v_con)
   LIMIT 1;
  SELECT uo.user_id INTO v_admin FROM public.user_organisations uo
   WHERE uo.organisation_id=c_org AND uo.is_active AND uo.role='admin' LIMIT 1;
  SELECT pm.user_id, pm.project_id INTO v_cv, v_cv_proj FROM projects.project_members pm
   WHERE pm.role='client_viewer' AND pm.is_active AND pm.organisation_id=c_org LIMIT 1;
  SELECT o.name INTO v_obj FROM storage.objects o
   WHERE o.bucket_id='drawings' AND split_part(o.name,'/',2)=v_foreign::text LIMIT 1;

  -- org-level PM with no membership (minted, rolled back)
  v_pm := gen_random_uuid();
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES (v_pm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'site-scope-probe-pm@e-site.invalid', '', now(), now(), now(), '{}', '{}');
  INSERT INTO public.user_organisations (user_id, organisation_id, role, is_active) VALUES (v_pm, c_org, 'project_manager', true);

  -- ── contractor ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.projects;                                  INSERT INTO _r VALUES ('contractor sees exactly 1 project', v_n=1);
  SELECT count(*) INTO v_n FROM projects.projects WHERE id=v_foreign;               INSERT INTO _r VALUES ('contractor cannot see foreign project', v_n=0);
  SELECT count(*) INTO v_n FROM tenants.floor_plans WHERE project_id=v_foreign;     INSERT INTO _r VALUES ('contractor sees 0 foreign floor plans', v_n=0);
  SELECT count(*) INTO v_n FROM structure.nodes WHERE project_id=v_foreign;         INSERT INTO _r VALUES ('contractor sees 0 foreign nodes', v_n=0);
  SELECT count(*) INTO v_n FROM projects.rfis WHERE project_id=v_foreign;           INSERT INTO _r VALUES ('contractor sees 0 foreign rfis', v_n=0);
  SELECT count(*) INTO v_n FROM projects.project_members WHERE project_id=v_foreign; INSERT INTO _r VALUES ('contractor sees 0 foreign members', v_n=0);
  SELECT count(*) INTO v_n FROM cable_schedule.cables c
   WHERE public.site_project_of_revision(c.revision_id)=v_foreign;                 INSERT INTO _r VALUES ('contractor sees 0 foreign cables (child gate)', v_n=0);
  SELECT count(*) INTO v_m FROM structure.nodes WHERE project_id=v_own;             -- as the contractor
  RESET ROLE;
  SELECT count(*) INTO v_n FROM structure.nodes WHERE project_id=v_own;             -- as postgres: the truth
  INSERT INTO _r VALUES ('contractor still sees every own-site node', v_m=v_n);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_con, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.projects WHERE id=v_own;                   INSERT INTO _r VALUES ('contractor still sees own project', v_n=1);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id='drawings' AND name=v_obj; INSERT INTO _r VALUES ('contractor cannot read foreign drawing file', v_obj IS NOT NULL AND v_n=0);
  -- tenants.floor_plans "Org members can manage floor plans" lets ANY org member write today
  UPDATE tenants.floor_plans SET name = name WHERE project_id = v_foreign;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r VALUES ('contractor cannot write a foreign floor plan', v_n = 0);
  RESET ROLE;

  -- ── org PM without membership ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_pm, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.projects;                                  INSERT INTO _r VALUES ('org PM without membership sees 0 projects', v_n=0);
  INSERT INTO _r VALUES ('effective role of org PM on a project is NULL', public.user_effective_project_role(v_foreign) IS NULL);
  RESET ROLE;

  -- ── admin ──
  SELECT count(*) INTO v_m FROM projects.projects WHERE organisation_id=c_org;      -- as postgres
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.projects WHERE organisation_id=c_org;      INSERT INTO _r VALUES ('admin sees every WM project', v_n=v_m AND v_m>1);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id='drawings' AND name=v_obj; INSERT INTO _r VALUES ('admin reads foreign drawing file', v_n=1);
  BEGIN
    INSERT INTO projects.projects (organisation_id, name, status, created_by) VALUES (c_org, 'site-scope probe project', 'planning', v_admin) RETURNING id INTO v_new;
    v_ok := v_new IS NOT NULL;
  EXCEPTION WHEN OTHERS THEN v_ok := false;
  END;
  INSERT INTO _r VALUES ('admin can still create a project', v_ok);
  RESET ROLE;

  -- ── client viewer: unchanged ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cv, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM projects.projects;                                  INSERT INTO _r VALUES ('client viewer sees only their projects', v_n>=1 AND v_n<=(SELECT count(*) FROM projects.project_members WHERE user_id=v_cv AND is_active));
  RESET ROLE;
END $$;

SELECT k AS check, v AS ok FROM _r ORDER BY k;
```

Note for the implementer: `public.site_project_of_revision` does not exist before the migration, so against the no-op this file ABORTS — the harness reports that as one failed check, which is the expected red. To see the per-row red as well, temporarily comment the `cables (child gate)` line, run, then restore it. If `projects.contacts` has other NOT NULL columns, add them to the probe insert (check with `\d projects.contacts` via `mgmt_query`); the refusal must come from the policy, not from a missing column — so the step that proves this is Task 5 Step 4 (the admin insert of the same shape must succeed).

- [ ] **Step 2: Run against the no-op — must be RED**

Run: `scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-site-scope.sql`
Expected (with the cables line commented): `contractor sees exactly 1 project` false (it sees 13), the four `0 foreign` rows false, `foreign drawing file` false, `org PM … 0 projects` false, `effective role … NULL` false. Admin and client-viewer rows true.

- [ ] **Step 3: Commit**

```bash
git add scripts/db/assert-site-scope.sql
git commit -m "test(db): behavioural site-scope assertions as real roles (red)"
```

---

### Task 3: Manifest

**Files:**
- Create: `packages/db/src/site-scope/manifest.ts`

The resolver paths below were derived from the live FK graph on 2026-10-05. Every child column used is NOT NULL (checked); `site_diary_attachments.diary_entry_id`, `snag_photos.snag_id`, `qc_comments.report_id` etc. included.

- [ ] **Step 1: Write the manifest**

```ts
// packages/db/src/site-scope/manifest.ts
// The reviewed source for the site_scope migration. Generated SQL must never be
// edited by hand: change this file and re-run scripts/db/site-scope/emit.ts.

/** A SECURITY DEFINER lookup: id of a row in `table` -> its project id. */
export interface Resolver {
  /** function name, created as public.site_project_of_<name>(uuid) */
  name: string
  table: string
  /** how the project is found from that row: its own project_id, or another resolver over one of its columns */
  via: { column: 'project_id' } | { column: string; resolver: string }
}

export interface Gated {
  table: string
  /** SQL expression yielding the row's project id */
  project: { column: string } | { resolver: string; column: string }
}

export const RESOLVERS: Resolver[] = [
  { name: 'site_diary_entry', table: 'projects.site_diary_entries', via: { column: 'project_id' } },
  { name: 'jbcc_letter',      table: 'projects.jbcc_letters',       via: { column: 'project_id' } },
  { name: 'node',             table: 'structure.nodes',             via: { column: 'project_id' } },
  { name: 'node_order',       table: 'structure.node_orders',       via: { column: 'project_id' } },
  { name: 'tenant_document',  table: 'structure.tenant_documents',  via: { column: 'node_id', resolver: 'node' } },
  { name: 'work_item',        table: 'projects.work_items',         via: { column: 'project_id' } },
  { name: 'boq_import',       table: 'projects.boq_imports',        via: { column: 'project_id' } },
  { name: 'boq_section',      table: 'projects.boq_sections',       via: { column: 'import_id', resolver: 'boq_import' } },
  { name: 'rfi',              table: 'projects.rfis',               via: { column: 'project_id' } },
  { name: 'gcr_zone',         table: 'gcr.zones',                   via: { column: 'project_id' } },
  { name: 'snag',             table: 'field.snags',                 via: { column: 'project_id' } },
  { name: 'floor_plan',       table: 'tenants.floor_plans',         via: { column: 'project_id' } },
  { name: 'variation_order',  table: 'projects.variation_orders',   via: { column: 'project_id' } },
  { name: 'valuation',        table: 'projects.valuations',         via: { column: 'project_id' } },
  { name: 'qc_report',        table: 'projects.qc_reports',         via: { column: 'project_id' } },
  { name: 'revision',         table: 'cable_schedule.revisions',    via: { column: 'project_id' } },
  { name: 'supply_route',     table: 'cable_schedule.supply_routes', via: { column: 'revision_id', resolver: 'revision' } },
  { name: 'cable',            table: 'cable_schedule.cables',       via: { column: 'revision_id', resolver: 'revision' } },
  { name: 'inspection',       table: 'inspections.inspections',     via: { column: 'project_id' } },
  { name: 'site_form',        table: 'field.site_forms',            via: { column: 'project_id' } },
  { name: 'tender',           table: 'projects.tenders',            via: { column: 'project_id' } },
]

const direct = (table: string): Gated => ({ table, project: { column: 'project_id' } })
const child = (table: string, resolver: string, column: string): Gated => ({ table, project: { resolver, column } })

export const GATED: Gated[] = [
  // ── direct project_id ──
  ...[
    'projects.jbcc_letters', 'projects.reports', 'field.snag_visits', 'gcr.settings', 'projects.project_members',
    'projects.rfis', 'projects.drawings', 'projects.contacts', 'projects.handover_checklist', 'gcr.zones',
    'gcr.tenant_assignments', 'projects.site_diary_entries', 'field.cables', 'field.inspection_milestones',
    'field.inspection_requests', 'projects.jbcc_parties', 'field.snags', 'gcr.report_revisions',
    'projects.variation_orders', 'tenants.handover_folders', 'projects.project_settings_history',
    'tenants.documents', 'structure.nodes', 'projects.work_item_events', 'tenants.floor_plans',
    'cable_schedule.sans_overrides', 'tenants.floor_plan_versions', 'structure.node_orders', 'projects.qc_entries',
    'projects.valuations', 'projects.qc_reports', 'projects.qc_entry_photos', 'projects.work_item_notes',
    'projects.work_item_attachments', 'projects.boq_imports', 'tenants.cloud_sync_runs', 'cable_schedule.revisions',
    'field.site_forms', 'inspections.inspections', 'tenants.floor_plan_markups', 'projects.load_profiles',
    'projects.load_profile_sources', 'projects.work_items', 'projects.tenders', 'projects.project_settings',
  ].map(direct),
  // ── children ──
  child('projects.site_diary_attachments', 'site_diary_entry', 'diary_entry_id'),
  child('projects.jbcc_letter_events', 'jbcc_letter', 'letter_id'),
  child('projects.jbcc_letter_recipients', 'jbcc_letter', 'letter_id'),
  child('projects.jbcc_letter_attachments', 'jbcc_letter', 'letter_id'),
  child('structure.tenant_documents', 'node', 'node_id'),
  child('structure.tenant_document_revisions', 'tenant_document', 'tenant_document_id'),
  child('structure.tenant_units', 'node', 'node_id'),
  child('structure.tenant_scope_items', 'node', 'node_id'),
  child('structure.tenant_details', 'node', 'node_id'),
  child('structure.node_circuits', 'node', 'node_id'),
  child('structure.node_order_documents', 'node_order', 'node_order_id'),
  child('structure.node_order_shop_drawings', 'node_order', 'node_order_id'),
  child('projects.work_item_watchers', 'work_item', 'work_item_id'),
  child('projects.boq_sections', 'boq_import', 'import_id'),
  child('projects.boq_items', 'boq_section', 'section_id'),
  child('projects.rfi_responses', 'rfi', 'rfi_id'),
  child('public.rfi_annotations', 'rfi', 'rfi_id'),
  child('gcr.zone_generators', 'gcr_zone', 'zone_id'),
  child('field.snag_photos', 'snag', 'snag_id'),
  child('tenants.floor_plan_zones', 'floor_plan', 'floor_plan_id'),
  child('tenants.floor_plan_page_scales', 'floor_plan', 'floor_plan_id'),
  child('projects.variation_lines', 'variation_order', 'variation_order_id'),
  child('projects.valuation_lines', 'valuation', 'valuation_id'),
  child('projects.qc_comments', 'qc_report', 'report_id'),
  ...['route_history', 'mv_study_settings', 'fault_sources', 'protection_devices', 'cables', 'change_log',
      'fault_results', 'cost_lines', 'discrimination_checks', 'mv_study_signoff', 'supply_routes', 'sources', 'supplies']
    .map((t) => child(`cable_schedule.${t}`, 'revision', 'revision_id')),
  child('cable_schedule.route_segments', 'supply_route', 'route_id'),
  child('cable_schedule.terminations', 'cable', 'cable_id'),
  child('cable_schedule.cable_tags', 'cable', 'cable_id'),
  ...['response_history', 'signatures', 'coc_validations', 'certificates', 'responses', 'photos']
    .map((t) => child(`inspections.${t}`, 'inspection', 'inspection_id')),
  ...['form_photos', 'form_signatures', 'form_responses', 'form_response_history']
    .map((t) => child(`field.${t}`, 'site_form', 'form_id')),
  child('projects.tender_boq_items', 'tender', 'tender_id'),
  child('projects.tender_requirements', 'tender', 'tender_id'),
  child('projects.tender_estimate_lines', 'tender', 'tender_id'),
]
```

`projects.projects` and `public.profiles` are NOT in `GATED`: their policies are special and live in `fixed.sql.ts` (Task 4).

- [ ] **Step 2: Reconcile against Task 1's red list**

Every table Task 1 printed as `site_scope present: X … false` must be either in `GATED`, be `projects.projects`, or be added to the Task 1 `exempt` CTE with a reason. Fix both files until they agree. (Task 5 proves it: coverage turns all-green.)

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/site-scope/manifest.ts
git commit -m "feat(db): site_scope manifest — resolvers, gated tables"
```

---

### Task 4: Fixed SQL (role functions, projects, profiles, storage, JWT hook)

**Files:**
- Create: `packages/db/src/site-scope/fixed.sql.ts`

These bodies replace live functions. Keep each function's existing attributes (`STABLE SECURITY DEFINER`, `SET search_path`, `SET row_security TO 'off'`) — `CREATE OR REPLACE` keeps the ACL. Write NO comment containing the words `project_manager` inside `user_has_project_access` or `user_effective_project_role`: the `@verify` predicates grep the definitions for that word.

- [ ] **Step 1: Write the module**

```ts
// packages/db/src/site-scope/fixed.sql.ts
// Hand-written parts of the site_scope migration. See spec §3 and §4.

export const ROLE_FUNCTIONS_SQL = `
CREATE OR REPLACE FUNCTION public.user_has_project_access(_project_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' SET row_security TO 'off'
AS $function$
  SELECT
    -- (a) an active membership row whose identity org membership is active (00204)
    EXISTS (
      SELECT 1 FROM projects.project_members pm
      JOIN public.user_organisations uo ON uo.user_id = pm.user_id AND uo.organisation_id = pm.organisation_id
      WHERE pm.project_id = _project_id AND pm.user_id = auth.uid() AND pm.is_active AND uo.is_active)
    -- (b) owner or admin of the project's org sees every site (site-scoped access)
    OR EXISTS (
      SELECT 1 FROM projects.projects p
      JOIN public.user_organisations uo ON uo.organisation_id = p.organisation_id
      WHERE p.id = _project_id AND uo.user_id = auth.uid() AND uo.is_active AND uo.role IN ('owner', 'admin'))
$function$;

CREATE OR REPLACE FUNCTION public.user_effective_project_role(p_project_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' SET row_security TO 'off'
AS $function$
  WITH org AS (
    SELECT uo.role FROM projects.projects p
    JOIN public.user_organisations uo ON uo.organisation_id = p.organisation_id
    WHERE p.id = p_project_id AND uo.user_id = p_user_id AND uo.is_active = TRUE LIMIT 1
  ), pm AS (
    SELECT pm.role FROM projects.project_members pm
    WHERE pm.project_id = p_project_id AND pm.user_id = p_user_id AND pm.is_active = TRUE LIMIT 1
  )
  SELECT CASE
    WHEN (SELECT role FROM org) IN ('owner', 'admin') THEN (SELECT role FROM org)   -- org owner/admin: every site
    WHEN (SELECT role FROM pm) IS NOT NULL THEN (SELECT role FROM pm)               -- everyone else: their membership
    ELSE NULL
  END;
$function$;
`

/**
 * projects.projects. The access lookup cannot see a row inserted by the same
 * statement, and INSERT ... RETURNING re-reads the new row under USING, so the
 * policy also decides from the row's own columns: org owner/admin of its
 * organisation (same meaning as clause b), or an org project manager on a
 * project they created. Measured: without this an admin could not create a project.
 */
export const PROJECTS_SQL = `
DROP POLICY IF EXISTS site_scope ON projects.projects;
CREATE POLICY site_scope ON projects.projects AS RESTRICTIVE FOR ALL
  USING (
    public.user_has_project_access(id)
    OR EXISTS (SELECT 1 FROM public.user_organisations uo
               WHERE uo.organisation_id = projects.organisation_id AND uo.user_id = auth.uid() AND uo.is_active
                 AND (uo.role IN ('owner', 'admin') OR (uo.role = 'project_manager' AND projects.created_by = auth.uid())))
  )
  WITH CHECK (
    public.user_has_project_access(id)
    OR EXISTS (SELECT 1 FROM public.user_organisations uo
               WHERE uo.organisation_id = projects.organisation_id AND uo.user_id = auth.uid() AND uo.is_active
                 AND (uo.role IN ('owner', 'admin') OR (uo.role = 'project_manager' AND projects.created_by = auth.uid())))
  );
`

/** Profiles: yourself, people who share a project with you, or anyone in an org you own/administer. */
export const PROFILES_SQL = `
CREATE OR REPLACE FUNCTION public.user_can_see_profile(p_target uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public' SET row_security TO 'off'
AS $function$
  SELECT p_target = auth.uid()
    OR EXISTS (SELECT 1 FROM projects.project_members a JOIN projects.project_members b ON b.project_id = a.project_id
               WHERE a.user_id = auth.uid() AND a.is_active AND b.user_id = p_target AND b.is_active)
    OR EXISTS (SELECT 1 FROM public.user_organisations me JOIN public.user_organisations them ON them.organisation_id = me.organisation_id
               WHERE me.user_id = auth.uid() AND me.is_active AND me.role IN ('owner', 'admin')
                 AND them.user_id = p_target AND them.is_active)
$function$;
REVOKE ALL ON FUNCTION public.user_can_see_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_see_profile(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS site_scope ON public.profiles;
CREATE POLICY site_scope ON public.profiles AS RESTRICTIVE FOR SELECT
  USING (public.user_can_see_profile(id));
`

const SITE_BUCKETS = ['drawings', 'project-documents', 'rfi-attachments', 'diary-attachments', 'snag-photos',
  'coc-documents', 'qc-report-entries', 'jbcc-letters', 'cable-schedule-evidence']

/** Storage: path {org}/{project}/... ({org}/projects/{project}/... for jbcc-letters). Org owner/admin always pass (orphans of deleted projects stay readable to them). */
export const STORAGE_SQL = `
CREATE OR REPLACE FUNCTION public.storage_site_access(p_bucket text, p_name text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public' SET row_security TO 'off'
AS $function$
DECLARE
  v_org  text := split_part(p_name, '/', 1);
  v_proj text := CASE WHEN p_bucket = 'jbcc-letters' THEN split_part(p_name, '/', 3) ELSE split_part(p_name, '/', 2) END;
  c_uuid CONSTANT text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF v_org ~ c_uuid AND EXISTS (SELECT 1 FROM public.user_organisations uo
       WHERE uo.organisation_id = v_org::uuid AND uo.user_id = auth.uid() AND uo.is_active AND uo.role IN ('owner', 'admin')) THEN
    RETURN true;
  END IF;
  RETURN v_proj ~ c_uuid AND public.user_has_project_access(v_proj::uuid);
END;
$function$;
REVOKE ALL ON FUNCTION public.storage_site_access(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_site_access(text, text) TO authenticated, service_role;

DROP POLICY IF EXISTS site_scope_objects ON storage.objects;
CREATE POLICY site_scope_objects ON storage.objects AS RESTRICTIVE FOR ALL
  USING (CASE WHEN bucket_id IN (${SITE_BUCKETS.map((b) => `'${b}'`).join(', ')}) THEN public.storage_site_access(bucket_id, name) ELSE true END)
  WITH CHECK (CASE WHEN bucket_id IN (${SITE_BUCKETS.map((b) => `'${b}'`).join(', ')}) THEN public.storage_site_access(bucket_id, name) ELSE true END);
`

/** Mobile token: add all_sites (owner/admin of the first active org). Body otherwise identical to 00204's. */
export const JWT_HOOK_SQL = `
CREATE OR REPLACE FUNCTION public.custom_jwt_claims(event jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid; _org_id uuid; _org_role text; _project_ids jsonb; _claims jsonb;
BEGIN
  _user_id := (event ->> 'user_id')::uuid;
  SELECT organisation_id, role INTO _org_id, _org_role FROM public.user_organisations
   WHERE user_id = _user_id AND is_active = true ORDER BY created_at ASC LIMIT 1;
  SELECT COALESCE(jsonb_agg(DISTINCT pm.project_id), '[]'::jsonb) INTO _project_ids
    FROM projects.project_members pm
    JOIN public.user_organisations uo ON uo.user_id = pm.user_id AND uo.organisation_id = pm.organisation_id
   WHERE pm.user_id = _user_id AND pm.is_active = TRUE AND uo.is_active = TRUE;
  _claims := event -> 'claims';
  IF _org_id IS NOT NULL THEN
    _claims := jsonb_set(_claims, '{org_id}', to_jsonb(_org_id::text));
  END IF;
  _claims := jsonb_set(_claims, '{project_ids}', _project_ids);
  _claims := jsonb_set(_claims, '{all_sites}', to_jsonb(COALESCE(_org_role IN ('owner', 'admin'), false)));
  RETURN jsonb_set(event, '{claims}', _claims);
END;
$function$;
`

export const FIXED_VERIFY = [
  `-- sql: (SELECT pg_get_functiondef('public.user_has_project_access(uuid)'::regprocedure) NOT LIKE '%project_manager%')`,
  `-- sql: (SELECT pg_get_functiondef('public.user_effective_project_role(uuid,uuid)'::regprocedure) NOT LIKE '%project_manager%')`,
  `-- policy: site_scope ON projects.projects RESTRICTIVE`,
  `-- policy: site_scope ON public.profiles RESTRICTIVE`,
  `-- policy: site_scope_objects ON storage.objects RESTRICTIVE`,
  `-- function: public.user_has_project_access(uuid)`,
  `-- function: public.user_effective_project_role(uuid, uuid)`,
  `-- function: public.custom_jwt_claims(jsonb)`,
  `-- function: public.storage_site_access(text, text)`,
  `-- function: public.user_can_see_profile(uuid)`,
  `-- sql: (SELECT NOT has_function_privilege('anon', 'public.storage_site_access(text,text)', 'EXECUTE'))`,
  `-- sql: (SELECT NOT has_function_privilege('anon', 'public.user_can_see_profile(uuid)', 'EXECUTE'))`,
  `-- sql: (SELECT pg_get_functiondef('public.custom_jwt_claims(jsonb)'::regprocedure) LIKE '%all_sites%')`,
]
```

Before writing `user_effective_project_role`, read its live definition (`SELECT pg_get_functiondef('public.user_effective_project_role(uuid,uuid)'::regprocedure)` via `mgmt_query`) and confirm the signature and default match exactly; if the live function has extra arms (an inactive-member guard etc.) keep them.

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/site-scope/fixed.sql.ts
git commit -m "feat(db): site_scope fixed SQL — role functions, projects, profiles, storage, JWT all_sites"
```

---

### Task 5: Generator + tests

**Files:**
- Create: `packages/db/src/site-scope/generate.ts`
- Create: `packages/db/src/site-scope/generate.test.ts`
- Create: `scripts/db/site-scope/emit.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/src/site-scope/generate.test.ts
import { describe, it, expect } from 'vitest'
import { generateMigration, projectExpr } from './generate'
import { RESOLVERS, GATED } from './manifest'

describe('site_scope generator', () => {
  const sql = generateMigration()

  it('gives every gated table exactly one RESTRICTIVE FOR ALL site_scope policy using the access function', () => {
    for (const g of GATED) {
      const create = `CREATE POLICY site_scope ON ${g.table} AS RESTRICTIVE FOR ALL`
      expect(sql.split(create).length - 1, g.table).toBe(1)
    }
    expect((sql.match(/USING \(public\.user_has_project_access\(/g) ?? []).length).toBeGreaterThanOrEqual(GATED.length)
  })

  it('creates every resolver before any policy uses it, revoked from anon', () => {
    for (const r of RESOLVERS) {
      const fn = `public.site_project_of_${r.name}(`
      const def = sql.indexOf(`CREATE OR REPLACE FUNCTION ${fn}`)
      const use = sql.indexOf(`${fn}`, def + 10)
      expect(def, r.name).toBeGreaterThan(-1)
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.site_project_of_${r.name}(uuid) FROM PUBLIC, anon;`)
      if (use > -1) expect(use).toBeGreaterThan(def)
    }
  })

  it('every child references a resolver that exists', () => {
    const names = new Set(RESOLVERS.map((r) => r.name))
    for (const g of GATED) if ('resolver' in g.project) expect(names.has(g.project.resolver), g.table).toBe(true)
  })

  it('no table is gated twice', () => {
    const seen = GATED.map((g) => g.table)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('projectExpr renders direct and child shapes', () => {
    expect(projectExpr({ column: 'project_id' })).toBe('project_id')
    expect(projectExpr({ resolver: 'rfi', column: 'rfi_id' })).toBe('public.site_project_of_rfi(rfi_id)')
  })

  it('emits a parseable @verify block naming every gated table', () => {
    const block = sql.slice(sql.indexOf('-- @verify:begin'), sql.indexOf('-- @verify:end'))
    for (const g of GATED) expect(block).toContain(`-- policy: site_scope ON ${g.table} RESTRICTIVE`)
    expect(block).not.toMatch(/sql:[^\n]*—/) // no em dash in a sql payload (#194)
  })
})
```

- [ ] **Step 2: Run — FAIL (module missing)**

Run: `pnpm --filter @esite/db test -- site-scope`
Expected: FAIL `Cannot find module './generate'`.

- [ ] **Step 3: Implement**

```ts
// packages/db/src/site-scope/generate.ts
import { RESOLVERS, GATED, type Gated, type Resolver } from './manifest'
import { ROLE_FUNCTIONS_SQL, PROJECTS_SQL, PROFILES_SQL, STORAGE_SQL, JWT_HOOK_SQL, FIXED_VERIFY } from './fixed.sql'

export function projectExpr(p: Gated['project']): string {
  return 'resolver' in p ? `public.site_project_of_${p.resolver}(${p.column})` : p.column
}

function resolverSql(r: Resolver): string {
  const body = 'resolver' in r.via
    ? `SELECT public.site_project_of_${r.via.resolver}(${r.via.column}) FROM ${r.table} WHERE id = p_id`
    : `SELECT project_id FROM ${r.table} WHERE id = p_id`
  const fn = `public.site_project_of_${r.name}(uuid)`
  return [
    `CREATE OR REPLACE FUNCTION public.site_project_of_${r.name}(p_id uuid)`,
    ` RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' SET row_security TO 'off'`,
    `AS $f$ ${body} $f$;`,
    `REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC, anon;`,
    `GRANT EXECUTE ON FUNCTION ${fn} TO authenticated, service_role;`,
  ].join('\n')
}

function policySql(g: Gated): string {
  const e = `public.user_has_project_access(${projectExpr(g.project)})`
  return [
    `DROP POLICY IF EXISTS site_scope ON ${g.table};`,
    `CREATE POLICY site_scope ON ${g.table} AS RESTRICTIVE FOR ALL`,
    `  USING (${e})`,
    `  WITH CHECK (${e});`,
  ].join('\n')
}

/** Resolvers ordered so a resolver that calls another comes after it. */
function orderedResolvers(): Resolver[] {
  const done = new Set<string>(); const out: Resolver[] = []
  const visit = (r: Resolver) => {
    if (done.has(r.name)) return
    if ('resolver' in r.via) visit(RESOLVERS.find((x) => x.name === (r.via as { resolver: string }).resolver)!)
    done.add(r.name); out.push(r)
  }
  RESOLVERS.forEach(visit)
  return out
}

export function generateMigration(): string {
  const verify = [
    '-- @verify:begin',
    ...FIXED_VERIFY,
    ...RESOLVERS.map((r) => `-- function: public.site_project_of_${r.name}(uuid)`),
    ...RESOLVERS.map((r) => `-- sql: (SELECT NOT has_function_privilege('anon', 'public.site_project_of_${r.name}(uuid)', 'EXECUTE'))`),
    ...GATED.map((g) => `-- policy: site_scope ON ${g.table} RESTRICTIVE`),
    '-- @verify:end',
  ].join('\n')
  return [
    '-- Site-scoped access. GENERATED by scripts/db/site-scope/emit.ts from',
    '-- packages/db/src/site-scope/{manifest,fixed.sql}.ts. Do not edit by hand.',
    '-- Spec: docs/superpowers/specs/2026-10-01-site-scoped-access-design.md',
    verify,
    '',
    ROLE_FUNCTIONS_SQL.trim(),
    '',
    ...orderedResolvers().map(resolverSql),
    '',
    ...GATED.map(policySql),
    '',
    PROJECTS_SQL.trim(),
    PROFILES_SQL.trim(),
    STORAGE_SQL.trim(),
    JWT_HOOK_SQL.trim(),
    '',
    "NOTIFY pgrst, 'reload schema';",
    '',
  ].join('\n')
}
```

```ts
// scripts/db/site-scope/emit.ts
// Usage: npx tsx scripts/db/site-scope/emit.ts [out.sql]
import { writeFileSync } from 'node:fs'
import { generateMigration } from '../../../packages/db/src/site-scope/generate'
const out = process.argv[2] ?? 'scripts/db/site-scope/site_scoped_access.sql'
writeFileSync(out, generateMigration())
console.log(`wrote ${out}`)
```

- [ ] **Step 4: Run tests — PASS**

Run: `pnpm --filter @esite/db test -- site-scope`
Expected: 6 passed.

- [ ] **Step 5: Emit and commit**

```bash
npx tsx scripts/db/site-scope/emit.ts
git add packages/db/src/site-scope scripts/db/site-scope
git commit -m "feat(db): site_scope generator, tests and emitted migration"
```

---

### Task 6: Dry run green, existing assertions, mutation

**Files:**
- Modify: `scripts/db/assert-uhpa-org-admin-control.sql` (and any other file Step 3 turns red because of the deliberate PM change)

- [ ] **Step 1: Coverage — GREEN**

Run: `scripts/db/dry-run-migration.sh scripts/db/site-scope/site_scoped_access.sql scripts/db/assert-site-scope-coverage.sql`
Expected: every row `true`. A `false` `site_scope present` row means the manifest misses a table → Task 3 Step 2.

- [ ] **Step 2: Behaviour — GREEN** (cables line restored)

Run: `scripts/db/dry-run-migration.sh scripts/db/site-scope/site_scoped_access.sql scripts/db/assert-site-scope.sql`
Expected: every row `true`. If `admin can still create a project` is false, read the error by re-running that block alone with the exception handler removed; an AFTER INSERT trigger writing a child table (e.g. `project_settings`) must pass because the project row is visible by then; a BEFORE trigger writing a child would not — fix in `fixed.sql.ts`, never by exempting the child.

- [ ] **Step 3: Every existing assertion suite that touches these functions or tables**

Run each with the migration (one command per file, read every row):

```bash
for f in scripts/db/assert-uhpa-*.sql scripts/db/assert-floor-plan-markups*.sql scripts/db/assert-diary-update-*.sql \
         scripts/db/assert-load-profile-rls.sql scripts/db/assert-tender-boq-roles.sql scripts/db/assert-rate-library-roles.sql \
         scripts/db/assert-whatsapp-actor.sql scripts/db/assert-whatsapp-channel.sql scripts/db/assert-whatsapp-inspections.sql \
         scripts/db/assert-inspection-response-history.sql scripts/db/assert-reports-storage-hardening.sql; do
  echo "== $f"; scripts/db/dry-run-migration.sh scripts/db/site-scope/site_scoped_access.sql "$f" | grep -E "false|FAIL|ERROR" || echo "all green"
done
```

Expected: green except rows whose MEANING changed on purpose (an org-level project manager auto-passing `user_has_project_access` — `assert-uhpa-org-admin-control.sql` line 4 describes exactly that clause). For each such row: change the expectation to the new rule AND rename the check text to say so (e.g. `'org owner/admin auto-pass; org project_manager does not'`). Any other red is a regression in the migration — fix the migration, not the assertion.

- [ ] **Step 4: Mutation — exactly one table turns red**

Copy the emitted SQL to `/tmp/mut.sql`, delete the two lines creating `site_scope ON tenants.floor_plans`, run:
`scripts/db/dry-run-migration.sh /tmp/mut.sql scripts/db/assert-site-scope-coverage.sql scripts/db/assert-site-scope.sql`
Expected: coverage shows exactly `site_scope present: tenants.floor_plans` false; behaviour shows `contractor sees 0 foreign floor plans` false. Everything else true. Then mutate `user_has_project_access` clause (b) back to include `'project_manager'` in `/tmp/mut2.sql`: expected `org PM without membership sees 0 projects` false. Record both results in the PR body.

- [ ] **Step 5: Three suites**

Run: `pnpm --filter @esite/db test:ci && pnpm --filter @esite/shared test && pnpm --filter web test`
Expected: all pass. The packages/db anon-execute guard must see the REVOKEs; if it flags a resolver, the generator's REVOKE line is wrong.

- [ ] **Step 6: Commit**

```bash
git add scripts/db
git commit -m "test(db): site_scope green on prod dry run; org-PM expectation updated deliberately"
```

---

### Task 7: `requireProjectAccess` helper

**Files:**
- Create: `apps/web/src/lib/auth/require-project-access.ts`
- Create: `apps/web/src/lib/auth/require-project-access.test.ts`

- [ ] **Step 1: Failing test**

```ts
// apps/web/src/lib/auth/require-project-access.test.ts
import { describe, it, expect, vi } from 'vitest'
import { requireProjectAccess } from './require-project-access'

const client = (data: unknown, error: unknown = null) => ({ rpc: vi.fn().mockResolvedValue({ data, error }) }) as never

describe('requireProjectAccess', () => {
  it('passes when user_has_project_access is true', async () => {
    const c = client(true)
    await expect(requireProjectAccess(c, 'p1')).resolves.toEqual({ ok: true })
    expect((c as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith('user_has_project_access', { _project_id: 'p1' })
  })
  it('refuses as not-found when false, so another client site is not confirmed to exist', async () => {
    await expect(requireProjectAccess(client(false), 'p1')).resolves.toEqual({ ok: false, status: 404, error: 'Project not found' })
  })
  it('fails closed on an RPC error or a non-boolean', async () => {
    await expect(requireProjectAccess(client(null, { message: 'boom' }), 'p1')).resolves.toMatchObject({ ok: false, status: 404 })
    await expect(requireProjectAccess(client('true'), 'p1')).resolves.toMatchObject({ ok: false })
  })
  it('refuses an empty project id without calling the database', async () => {
    const c = client(true)
    await expect(requireProjectAccess(c, '')).resolves.toMatchObject({ ok: false })
    expect((c as { rpc: ReturnType<typeof vi.fn> }).rpc).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — FAIL**

Run: `pnpm --filter web test -- require-project-access`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/auth/require-project-access.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type ProjectAccessResult = { ok: true } | { ok: false; status: 404; error: string }

/**
 * Site-scoped access gate for code that then uses the SERVICE client.
 * Pass the caller's SESSION client: the check runs as them.
 * Returns a result object, never a boolean — test `.ok`, not truthiness
 * (role-gate-call-sites.contract.test.ts).
 */
export async function requireProjectAccess(sessionClient: SupabaseClient, projectId: string): Promise<ProjectAccessResult> {
  const denied: ProjectAccessResult = { ok: false, status: 404, error: 'Project not found' }
  if (!projectId) return denied
  const { data, error } = await sessionClient.rpc('user_has_project_access', { _project_id: projectId })
  return !error && data === true ? { ok: true } : denied
}
```

- [ ] **Step 4: Run — PASS; add `requireProjectAccess` to `OBJECT_RESULT_HELPERS` in `apps/web/src/lib/auth/role-gate-call-sites.contract.test.ts`** so a bare `if (!await requireProjectAccess(...))` is caught.

Run: `pnpm --filter web test -- require-project-access role-gate-call-sites`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/auth
git commit -m "feat(web): requireProjectAccess — site gate for service-key paths"
```

---

### Task 8: Guard over every service-key file

**Files:**
- Create: `apps/web/src/lib/auth/service-client-gates.contract.test.ts`

A file that uses the service client must contain one of the recognised gates, or be listed with its reason. A new file fails the build until classified. The lists come from the 2026-10-05 audit (158 files).

- [ ] **Step 1: Write the test**

```ts
// apps/web/src/lib/auth/service-client-gates.contract.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

/**
 * Every server file that reaches for the SERVICE client (RLS bypassed) must
 * prove the caller may see the project first. Site-scoped access
 * (spec 2026-10-01) only holds if no service-key path skips it.
 */
const WEB_SRC = resolve(__dirname, '../..')
const SERVICE = /createServiceClient|createAdminClient|SUPABASE_SERVICE_ROLE_KEY/

/** Any of these in the file counts as a project gate (each is site-aware after the migration). */
const GATES = [
  'requireProjectAccess', 'requireEffectiveRole', 'requireSolarLevel', 'requireSolarLevelAPI', 'getSolarAccessLevel',
  'assertExportPolicy', 'getExportPolicy', 'requirePortalAccess', 'user_has_project_access', 'user_effective_project_role',
  'projectService.getById', 'requireVisibleProject', 'guardProjectAccess', 'requirePlatformTariffAdmin',
]

/** Files with no project data, or gated by their caller / a signature. path (relative to src) -> reason */
const DECLARED: Record<string, string> = {
  'lib/supabase/server.ts': 'defines the clients',
  'instrumentation.ts': 'env presence check only',
  'middleware.ts': 'auth infra; reads own user_organisations',
  'app/api/health/route.ts': 'health probe',
  'app/(auth)/auth/callback/route.ts': 'auth infra',
  'app/auth/signout/route.ts': 'auth infra',
  'actions/account.actions.ts': 'own account',
  'actions/auth-event.actions.ts': 'own auth events',
  'actions/mfa.actions.ts': 'own MFA',
  'actions/security.actions.ts': 'own sessions',
  'actions/onboarding-email.actions.ts': 'own onboarding mail',
  'actions/unsubscribe.actions.ts': 'signed unsubscribe link',
  'actions/whatsapp-link.actions.ts': 'own WhatsApp link',
  'actions/data-request.actions.ts': 'public POPIA form',
  'actions/billing.actions.ts': 'org billing', 'actions/onboarding.actions.ts': 'org onboarding',
  'actions/org-branding.actions.ts': 'org branding', 'actions/seats.actions.ts': 'org seats',
  'actions/sub-org-members.actions.ts': 'org users', 'actions/users.actions.ts': 'org users',
  'actions/whatsapp-admin.actions.ts': 'platform WhatsApp settings', 'actions/project.actions.ts': 'creates a project',
  'actions/supplier.actions.ts': 'marketplace (exempt, spec §2)', 'actions/tariff-explorer.actions.ts': 'tariff library',
  'app/(admin)/settings/account/page.tsx': 'own account', 'app/(admin)/settings/branding/page.tsx': 'org',
  'app/(admin)/settings/users/page.tsx': 'org', 'app/(admin)/settings/whatsapp/page.tsx': 'platform',
  'app/(admin)/projects/[id]/settings/general/page.tsx': 'org name only, after requireRole',
  'app/(admin)/projects/[id]/settings/members/page.tsx': 'org owner only, after requireRole',
  'app/api/internal/whatsapp/forms/route.ts': 'HMAC-signed internal call; acts as the linked user',
  'app/api/paystack/callback/route.ts': 'billing', 'app/api/paystack/mv-subscribe/route.ts': 'billing',
  'app/api/paystack/subaccount/route.ts': 'supplier billing', 'app/api/paystack/webhook/route.ts': 'HMAC webhook',
  'app/api/webhooks/resend/route.ts': 'svix webhook', 'app/api/notifications/dispatch/route.ts': 'bearer; notifications only',
  'app/inspection/[shareToken]/page.tsx': 'public share token with expiry/revocation',
  'lib/analytics/product-events.ts': 'caller-gated telemetry', 'lib/notifications.ts': 'caller-gated',
  'lib/notify.ts': 'caller-gated', 'lib/invite-email.ts': 'caller-gated', 'lib/jbcc/letterhead.ts': 'org letterhead',
  'lib/diary-email.ts': 'caller-gated', 'lib/qc-email.ts': 'caller-gated', 'lib/rfi-email.ts': 'caller-gated',
  'lib/site-form-email.ts': 'caller-gated', 'lib/snag-email.ts': 'caller-gated',
  'lib/reports/file-inspection-report.ts': 'caller-gated', 'lib/reports/file-site-form-report.ts': 'caller-gated',
  'lib/solar/activity.ts': 'caller-gated', 'lib/solar/audit.ts': 'caller-gated', 'lib/solar/grantors.ts': 'org',
  'lib/solar/notify.ts': 'caller-gated', 'lib/solar/pricing/pricing-hash.ts': 'HMAC key fallback only',
  'lib/solar/proposals/client.ts': 'share token or portal caller', 'lib/solar/proposals/email-toggle.ts': 'caller-gated',
  'lib/solar/proposals/notify.ts': 'caller-gated', 'lib/solar/access-panel.ts': 'solar_is_grantor rpc',
  'lib/tenant-electrical/recompute.ts': 'caller-gated', 'lib/whatsapp-forms/after-submit.ts': 'after HMAC / web submit',
  'lib/whatsapp/kick-worker.ts': 'kicks the worker', 'app/(admin)/admin/tariffs/reports/page.tsx': 'platform tariff admin',
}

function strip(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
}
function walk(dir: string, out: string[] = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next') continue
    const f = join(dir, e)
    if (statSync(f).isDirectory()) walk(f, out)
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(f)
  }
  return out
}

describe('service-key files declare a project gate', () => {
  const files = walk(WEB_SRC).filter((f) => SERVICE.test(readFileSync(f, 'utf8')))

  it('finds the service-key files (sanity: the scan works)', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('every one is gated or declared', () => {
    const bad = files
      .map((f) => relative(WEB_SRC, f))
      .filter((rel) => !(rel in DECLARED))
      .filter((rel) => !GATES.some((g) => strip(readFileSync(join(WEB_SRC, rel), 'utf8')).includes(g)))
    expect(bad, `service-key file with no project gate — add requireProjectAccess, or declare it with a reason:\n${bad.join('\n')}`).toEqual([])
  })

  it('every declared file still exists (no stale exemptions)', () => {
    const rels = new Set(files.map((f) => relative(WEB_SRC, f)))
    expect(Object.keys(DECLARED).filter((d) => !rels.has(d))).toEqual([])
  })
})
```

- [ ] **Step 2: Run — expect the weak files listed**

Run: `pnpm --filter web test -- service-client-gates`
Expected: FAIL listing files the audit classed as weak and gate-less, at least `app/api/diary/notify/route.ts`, `actions/project-members.actions.ts`, `actions/project-members-bulk.actions.ts`, `actions/project-members-from-sub-org.actions.ts`, `app/api/projects/[id]/boq/import/route.ts`. Any OTHER listed file: read it; if it touches project data add the gate in Task 9, otherwise declare it with a reason here. Prove the guard bites: temporarily rename `requireEffectiveRole` in `actions/qc.actions.ts` to `requireEffectiveRoleX` in a scratch copy of the GATES list (not the source) and see `actions/qc.actions.ts` appear; revert.

- [ ] **Step 3: Commit (red is fine on this commit only if Task 9 follows immediately; otherwise squash with Task 9)**

```bash
git add apps/web/src/lib/auth/service-client-gates.contract.test.ts
git commit -m "test(web): every service-key file declares its project gate"
```

---

### Task 9: Fix the weak gates

**Files:**
- Modify: `apps/web/src/app/api/diary/notify/route.ts`
- Modify: `apps/web/src/actions/project-members.actions.ts`, `project-members-bulk.actions.ts`, `project-members-from-sub-org.actions.ts`
- Modify: `apps/web/src/app/api/projects/[id]/boq/import/route.ts`
- Modify: `apps/web/src/actions/tender.actions.ts` (`gateTender`)

For each file: read it fully first; keep its existing role check; ADD the site gate before the first service-client read. Pattern:

```ts
import { requireProjectAccess } from '@/lib/auth/require-project-access'
// ... after auth.getUser(), with the SESSION client `supabase`:
const access = await requireProjectAccess(supabase, projectId)
if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })   // route handlers
// server actions: if (!access.ok) return { error: access.error }
```

- [ ] **Step 1: `diary/notify`** — it derives the project from the diary entry with the service client and checks org membership only. Read the entry with the SESSION client first (`supabase.schema('projects').from('site_diary_entries').select('project_id').eq('id', entryId).maybeSingle()`); a missing row → 404; then `requireProjectAccess(supabase, entry.project_id)`; only then the existing service-client work. Add a test in the file's existing test (or create `route.test.ts` beside it) mocking the RPC to `false` and asserting 404 with no service-client call.

- [ ] **Step 2: project-members actions** — after the existing `requireRole(...)` add `requireProjectAccess(supabase, projectId)` (owner/admin pass trivially; an org PM now needs membership of that project, which is the spec's rule). Where the project id is derived from a member row (`resolveMemberOrg`), gate on the derived project id.

- [ ] **Step 3: `boq/import`** — move the gate BEFORE the service-client project read: `requireProjectAccess(supabase, id)` first, then the existing `requireRoleAPI(COST_VIEW_ROLES, project.organisation_id)`.

- [ ] **Step 4: `gateTender`** — read the tender's `project_id` with the SESSION client (RLS: `tenders_select` now needs effective role owner/admin/PM AND site_scope), 404 if absent, then the existing `requireEffectiveRole`. The `download(path)` action: assert the path starts with `${orgId}/${projectId}/` of the gated tender before signing.

- [ ] **Step 5: Run**

Run: `pnpm --filter web test -- service-client-gates diary boq tender project-members && pnpm --filter web exec tsc --noEmit`
Expected: guard green; touched tests green; tsc 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "fix(web): site gate before service-key reads in diary notify, members, BOQ import, tender"
```

---

### Task 10: PowerSync rules (dormant, kept correct)

**Files:**
- Modify: `supabase/powersync/sync-rules.yaml`

No PowerSync instance runs in production (spec §4), so this ships no behaviour today; it keeps the rules right for when one does.

- [ ] **Step 1:** For every bucket whose parameter is `token_parameter: org_id`, change the parameter block to the query form so the bucket exists only for all-sites tokens:

```yaml
    parameters: SELECT token_parameters.org_id AS org_id WHERE token_parameters.all_sites = true
```

and add, beside each such bucket, a project-keyed twin that site-only tokens get (same `data:` queries with `WHERE project_id = bucket.project_id` instead of `organisation_id = bucket.org_id`; for snag photos/inspection responses join through the parent's `project_id`):

```yaml
  site_snags:
    parameters: SELECT value AS project_id FROM json_each(token_parameters.project_ids) WHERE token_parameters.all_sites = false
    data:
      - SELECT id, title, description, status, priority, project_id, organisation_id FROM field.snags WHERE project_id = bucket.project_id
```

(Copy each org bucket's exact column list from the file.)

- [ ] **Step 2:** Validate YAML: `npx js-yaml supabase/powersync/sync-rules.yaml > /dev/null && echo ok`. Expected `ok`.

- [ ] **Step 3: Commit**

```bash
git add supabase/powersync/sync-rules.yaml
git commit -m "chore(mobile): sync rules — org buckets only for all_sites tokens"
```

---

### Task 11: Settings → Users shows each person's sites; docs

**Files:**
- Modify: `apps/web/src/app/(admin)/settings/users/page.tsx` (and its client table component — find it by the import at the top of `page.tsx`)
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1:** In `page.tsx` (already `getOrgContext`-gated, owner/admin only), load memberships for the org with the session client: `supabase.schema('projects').from('project_members').select('user_id, role, project_id, projects(name)').eq('organisation_id', ctx.organisationId).eq('is_active', true)`. Group by `user_id`. Pass `sitesByUser: Record<string, { projectId: string; name: string; role: string }[]>` (plain JSON — page → client props must be JSON) to the table.

- [ ] **Step 2:** In the table, add a **Sites** column: for owner/admin rows show `All sites`; otherwise one link per site to `/projects/{projectId}/settings/members` with the project name, or `No sites — add them to a project` linking to `/projects` when empty. Add a component test (RTL) beside it: a contractor with two sites renders two links; an admin renders "All sites"; a contractor with none renders the empty hint.

- [ ] **Step 3:** `docs/rbac-matrix.md`: add at the top, before the route table:

```md
> **Site scope (2026-10, migration `<number>_site_scoped_access`).** Org **owner** and **admin** see every project in their organisation. Every other role — including an org-level `project_manager` — sees and writes only projects they are an active member of (`projects.project_members`). Enforced by a RESTRICTIVE `site_scope` policy on every site table, `site_scope_objects` on storage, and `requireProjectAccess` before service-key reads. Exempt by design: rate library, billing, org settings, marketplace (IN DEV), WhatsApp internals.
```

- [ ] **Step 4: Run** `pnpm --filter web test -- settings/users && pnpm --filter web exec tsc --noEmit`. Expected: pass, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(admin\)/settings/users docs/rbac-matrix.md
git commit -m "feat(settings): show each person's sites; rbac matrix states the site-scope rule"
```

---

### Task 12: Claim the number, PR, apply, verify live

- [ ] **Step 1: Claim at apply time.** Check THREE places in one sitting: ledger (`mgmt_query "SELECT max(version) FROM supabase_migrations.schema_migrations"`), `git ls-tree --name-only origin/main apps/edge-functions/supabase/migrations/ | tail -3`, and open-PR filenames (`gh pr list --repo WattMatt/e-site --json files --jq '.[].files[].path' | grep migrations/ | sort | tail`). Number = max of all three + 1. Copy: `cp scripts/db/site-scope/site_scoped_access.sql apps/edge-functions/supabase/migrations/<NNNNN>_site_scoped_access.sql`. Rebase on `origin/main` first; if `origin/main` added migrations since Task 6, re-run Task 6 Steps 1–3 against the rebased state.

- [ ] **Step 2: Full local gate:** the three suites + `pnpm --filter web exec tsc --noEmit` + `pnpm --filter web lint`.

- [ ] **Step 3: PR** (ready, not draft) with: the red→green tables from Tasks 1/2/6, both mutation results, the audit summary, the deliberate expectation changes, and the walk plan below. Merge when CI is green — the owner merges, or this session merges only with the owner's explicit go-ahead in chat. Do NOT run the ledger check and `gh pr merge` in one command.

- [ ] **Step 4: After the deploy workflow:** read back — ledger contains `<NNNNN>`; the workflow's verify step green; then re-run against the LIVE state with a no-op: `scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-site-scope-coverage.sql scripts/db/assert-site-scope.sql` → all true. Vercel production deployment = the merge commit (GitHub deployments API).

- [ ] **Step 5: Browser walk (local app pointed at production, `rbac-test` contractor via an admin-generated magic link — no password):** `/projects` lists **1** project (KINGSWALK) and no "+ New Project"; `/projects/<ITONKA id>/floor-plans` shows not-found/empty; KINGSWALK pages still load (overview, floor plans, a drawing). Screenshot each for the PR. The owner walks as an admin: all projects still there, create a throwaway project, delete it.

- [ ] **Step 6:** Update `CLAUDE.md` "Current state" and the vault `sessions.md`.

---

## Self-review notes (done while writing)

- Spec coverage: §2 rule → Task 4 role functions; §3.1 PM clause in both functions → Task 4, proven Task 2 (`org PM …`) + Task 6 mutation 2; §3.2 gates → Tasks 3/5; §3.3 projects → Task 4 `PROJECTS_SQL` + Task 2 admin-create; §3.4 members/profiles → members gated directly, profiles Task 4; §3.5 Solar exempt → not in site schemas list; §3.6 storage → Task 4 + Task 2 file checks; §3.7 @verify → Task 5; §4 mobile → Task 4 hook + Task 10; §5.1 service client → Tasks 7–9; §5.2 lists → narrow automatically via RLS, walked Task 12; §5.3 users → Task 11; §5.4 matrix → Task 11; §6 WhatsApp → `whatsapp_actor` is a member of `authenticated`; policies are created without a TO clause so they apply to it (Task 6 Step 3 runs the WhatsApp actor suites); §7 proof → Tasks 1, 2, 6; §8 rollout → Task 12.
- Policies omit `TO`, so they apply to every role including `whatsapp_actor`; `service_role` bypasses RLS and is unaffected.
- Child resolvers use NOT NULL FK columns only, so no row resolves to NULL (which would hide it even from admins).
