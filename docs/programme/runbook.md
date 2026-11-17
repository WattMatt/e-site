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
- Field updates are reported progress. They move no date. An editor decides them, and the server action then applies the agreed values through `save_changes`.

## 3. Known follow-ups (from the build log, not yet done)

Outside P2:

- `inspections.verdicts` (`00253`) has no `site_scope` policy. The coverage check is already red on production.

Minor, deferred:

- Task 1: M-1 to M-7. Task 2: M-1 to M-6 (M-5 and M-6 were carried to Task 3). Task 3: M-1 to M-8. Details are in each task's review file under `.superpowers/sdd/2026-11-17-programme-p2-schema/`.
- Task 3 M-9: a live child can sit under a tombstoned parent.
- Task 3 M-10: `set_activity_code` can write to a tombstoned activity.
- Task 5: Mr1 sort order rounding, M2, M4, M7, M8.
- Task 6: M4 the `.in()` URL is long for 500 ids. M6 test gaps. N1 a long activity list in the I1 sentence. N2 versions are compared in milliseconds.

Open owner calls:

- Whether the Site calendar should be Saturday-inclusive as built.
- Whether a field update from a contractor or inspector is allowed only when tagged to them (built that way, spec 4.6).
