# Programme module: apply runbook (P2, schema and actions)

Migration: `00261_programme_schema.sql`. Server actions: `apps/web/src/actions/programme.actions.ts`.
Roles and gates: `docs/rbac-matrix.md`, section "Programme".
The module ships dark. There is no page and no nav entry yet.

## 0. Before you merge

The number `00261` is provisional. A claimed number is not a held number: the ledger head moves when someone applies.
At apply time, check all three places and renumber if any has moved:

1. Ledger: `select max(version) from supabase_migrations.schema_migrations;`
2. `origin/main` migration filenames.
3. Migration filenames in open PRs.

If the head is `00261` or higher, renumber the file above it. Re-run the `@verify` sweep after a renumber.

## 1. Apply order

1. **Merge.** The deploy workflow applies the migration. The post-push `@verify` step must pass.
   A green workflow is not proof. Read the schema back (step 2).
2. **Read back.**
   - `select count(*) from pg_tables where schemaname = 'programme';` should be 21.
   - The helper functions exist: `can_read`, `can_edit`, `cost_visible`, `can_read_org_library`, `org_cost_visible`.
   - `anon` has no EXECUTE on any `programme` function: check with `has_function_privilege('anon', oid, 'EXECUTE')`, not by reading `proacl`.
   - `authenticated` holds SELECT on the tables and no INSERT, UPDATE or DELETE.
3. **Run the role assertions.** `scripts/db/assert-programme-roles.sql` must run after the apply.
   Run it with `scripts/db/dry-run-migration.sh <noop.sql> scripts/db/assert-programme-roles.sql`.
   The noop file is a migration that does nothing (for example one `select 1;`). The script header explains the harness.
   It runs in a rolled-back transaction, so it leaves no residue.
   Record the pass count in the PR and in `sessions.md`. Do not say "passing" without the count.
4. **Then PATCH PostgREST `db_schema`.**
   - Management API: `PATCH /v1/projects/{ref}/postgrest`.
   - Send the FULL current schema list plus `programme`. A short list drops every other schema from the API.
   - Read the config back twice (two separate GETs).
   - Do it AFTER the schema exists. A `db_schema` that names a missing schema can loop the API on `PGRST002`.
5. **`NOTIFY pgrst, 'reload schema';`**
6. **`PROGRAMME_ENABLED` stays unset** until P1 to P9 are done. Every programme action refuses with "The programme module is not switched on yet." while it is unset.

## 2. What to know about the design

- Clients read only. Every write is a `SECURITY DEFINER` function that locks the programme, refuses a stale version, and audits in the same transaction.
- Rands are masked by RLS on the cost tables and on the resource rates. Nothing else is masked.
- The audit log holds ids, counts and verbs. It never holds a rand figure.
- Delete tombstones an activity that carries history (field updates, assignments, codes, a work item, an external uid, baselines). A bare activity is hard-deleted. P2 has no restore.
- The Site calendar is working days plus Saturday. The builders' shutdown is on Site only (00196 A(h)). The owner may override.
- Resources are readable by any non-client-viewer member of the organisation. Their rates are masked to owner, admin and project manager.
- Field updates are reported progress. They move no date. An editor decides them through `save_changes` (`p_decisions`): the decision and the agreed actuals (sent as activity ops in the same call) commit in one transaction under one version check. A stale version refuses both, so a report is never "applied" without its values.
- Calendars refuse a weekday listed twice and a coverage range that ends before it starts (CHECKs, mirrored in `applyOps`).

## 3. Rules for later phases, and open items

### Rules later work must keep

- **Exact counts in the `@verify` block.** 00261's block pins exact numbers: 21 tables with RLS forced, 19 `site_scope` policies, 21 PERMISSIVE SELECT policies, 3 cost-mask policies, 9 definer functions. The post-push verifier re-checks every migration since 00185 on every deploy. So a later migration that adds a programme table, policy or definer function must edit those counts in 00261 in the same PR, and re-run the full `@verify` sweep under the new migration (`scripts/db/emit-verify-sweep.ts`). Otherwise the deploy goes red at the verify step after the push has already succeeded.
- **No rands in the open JSONB columns.** `audit.object_ref`, `imports.diff`, `imports.mapping` and `progress_periods.per_activity` are readable by every programme reader, contractors included. The cost mask only covers the four cost tables. Any writer (the importers, progress periods, EVM) must keep money out of these columns: ids, counts, dates and percentages only.
- **The MCP open database does not see `programme`.** After the PostgREST PATCH adds `programme` to `db_schema`, the comment in `apps/web/src/lib/mcp-mask/exposed-schemas.ts` ("Matches PostgREST `db_schema`") and the hard-coded 14-schema `mcp_catalog()` in `00259` are out of date. Fix them in a follow-up. Exposing `programme` to the MCP also means adding it to `EXPOSED_SCHEMAS` there, a new `mcp_catalog`, and regenerating the cost mask, because programme has money-named numeric columns.
- **Merge order.** This branch is stacked on the P1 engine PR. Merge P1 first, then this one, and do the renumber check in §0 at merge time.
- **Any new programme table** is picked up by `scripts/db/assert-programme-roles.sql` from the catalog. A project-keyed table needs a seeded row there. A new table without `project_id` turns `every_programme_table_is_covered` red until its read rule is written down and asserted.

### Outside P2

- `inspections.verdicts` (`00253`) has no `site_scope` policy. The coverage check is already red on production.

### Open owner calls

- Whether the Site calendar should be Saturday-inclusive as built.
- Whether a field update from a contractor or inspector is allowed only when tagged to them (built that way, spec 4.6).
- Resource rates follow the ORG role, not the project role. A person promoted to project manager on one project whose org role is contractor reads that project's assignment rands but not the rate. An org project manager who is on no project reads every rate in the organisation.
- On Solar module programmes, the cost tables use the cost roles (owner, admin, project manager), not Solar's own money rule (`edit_financials`). Decide before the first cost writer. P2 writes no cost rows.
- `module_summary` weights level-of-effort activities into the percentage, and returns the percentage unrounded.

### Minor, deferred (none blocks a dark ship)

- A contractor or supplier from another company on the project can read `resource_assignments` but not the `resources` row it points at, because resources are read by membership of the programme's organisation. A Gantt or resource view in P3+ will hit this. Decide the rule then.
- Some trigger refusals name internal tables (for example "programme.programmes: a programme cannot move…"). Only the service path or a definer function can reach them, but the action would pass such a 22023 sentence through as written.
- Audit rows: `created_at` and `actor_id` could be supplied on a direct INSERT, and there is no trigger guarding DELETE. Both rely on clients having no write grant (they have none) and on `write_audit` setting the actor.
- Organisation-level audit rows (no programme) can only be written by the service path. Nothing in P2 writes one.
- The bind trigger on child tables re-reads the programme on every UPDATE as well as INSERT. Cheap now; worth measuring before bulk imports.
- The `@verify` block does not list the `*_touch` triggers or the non-primary-key indexes.
- Each read policy calls a helper per row. Run an EXPLAIN on a large programme before the P3 importers.
- `submit_field_update` can raise a raw numeric-overflow error for an absurd value. The action turns it into its generic sentence, so nothing leaks.
- The definer functions answer "no longer exists" and "belongs to a different programme" differently, so an editor can tell whether a uuid exists in another programme.
- `submit_field_update` reads whether the activity is tombstoned before it takes the programme lock.
- In `save_changes`, a key that looks like a uuid is matched as a key first, so it can shadow a real id. The effect stays inside the same programme.
- Coverage of a calendar can be overstated when the public-holiday table has a gap year. Today's seed is contiguous.
- A baseline cost row can carry a NULL budgeted cost when every assignment cost is NULL.
- `set_activity_code` can tag a tombstoned activity. Harmless: reporting on and upserting a tombstoned activity are both refused.
- Role assertion gaps: refusal rows check the SQLSTATE but not the sentence; there are no unknown-field rows for calendar and programme ops; the `module_summary` result shape is not asserted for every caller; a lapsed member of a tagged organisation is not tried on `submit_field_update`; the file has a few dead variables and literal totals.
- `applyOps` rounds `sort_order` to 2 decimals, but the column is an integer, so a value like 1.5 passes the engine and is then refused by the database.
- `applyOps` treats `exceptions: null` as an empty list, while `save_changes` refuses it.
- `applyOps` is stricter than the database on date formats and whitespace in a few fields (it refuses some values the database would accept).
- `rows.test` does not cover every column mapping.
- `decideFieldUpdatesAction` reads the field updates with `.in(ids)`. At the 500-decision limit the URL is about 18.5 KB. Consider a limit of 200 until it is measured.
- The action's early version check compares to the millisecond; `save_changes` then compares exactly under the lock, so it only ever fails safe.
- No web test makes a positive module-programme save; the role assertions cover it in SQL.
