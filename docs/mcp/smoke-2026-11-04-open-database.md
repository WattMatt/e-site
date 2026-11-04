# Authenticated local smoke: open-database tools (pre-apply), 2026-11-04

Branch `feat/mcp-open-database` at `d6d83710` (PR #308). `next dev` on `http://localhost:3200`
with `MCP_ENABLED` set, talking to the PRODUCTION Supabase project as the fixture
`rbac-test@e-site.live` (user `018f2d31-bbe8-4cc1-bbdd-63af0187081e`, `contractor` on WM-Consulting and on
KINGSWALK, project `81fc2329-2462-457d-9d24-9b051673c909`). Bearer minted by the owner beforehand; it is not
recorded here. Calls were made 08:16-08:18 UTC with a small `urllib` JSON-RPC helper (stateless POST to
`/api/mcp`).

Migration state during the run: `00257` applied; `00259` (`public.mcp_previews`, `public.mcp_run_select`,
`public.mcp_catalog`) NOT applied. So everything that needs those three objects was expected to fail closed.

## Result in one line

All positive reads, refusals and the write cycle behaved as specified. The three objects from `00259` are
absent and the three tools that need them (`esite_db_schemas`, update/delete preview) refuse with a verbatim
PostgREST error, never with data. `esite_db_sql` was refused by the tool's own role gate before any RPC.
The inserted throwaway row was removed and read back as gone. 33 audit rows for 33 `tools/call` requests.

## Handshake

| Call | Result |
|---|---|
| `initialize` (`protocolVersion` 2025-06-18) | HTTP 200, `serverInfo.name` `e-site`, instructions text present |
| `tools/list` | HTTP 200, 11 tools: `esite_whoami`, `esite_projects_list`, `esite_project_get`, `esite_project_history`, `esite_db_schemas`, `esite_db_select`, `esite_db_sql`, `esite_db_insert`, `esite_db_update`, `esite_db_delete`, `esite_db_rpc` |
| `esite_whoami {}` | one organisation (WM-Consulting, `contractor`); one project: `(643) KINGSWALK`, id above, `effectiveRole: contractor` |

(`initialize` and `tools/list` are not audited, by design: only `tools/call` is.)

## Step 3: positive reads

| # | Call (arguments abbreviated) | Response excerpt |
|---|---|---|
| 1 | `esite_db_select` `inspections.inspections`, `columns:[id,status,project_id]`, filter `project_id eq KINGSWALK`, `limit:3` | 3 rows (status `assigned`), `count:30`, `truncated:true`, `maskedColumns:[]` |
| 2 | `esite_db_select` `inspections.responses`, filter `inspection_id eq` each of those three ids, `limit:5` | `rows:[]`, `count:0` for all three (those inspections are only assigned). Not a useful positive read; see 4 |
| 3 | `esite_db_select` `inspections.responses`, `columns:[id,inspection_id]`, `limit:3` | rows from two inspections, `count:393` |
| 4 | `esite_db_select` `inspections.inspections` `id eq 2f82a5c8-50d0-45e6-8d0b-737ead47c171` | `project_id` = KINGSWALK, `status: in_progress`. Then `inspections.responses` `inspection_id eq` that id, `limit:5`: full rows including `value_text` (null on the first five, which are pass/na answers), `value_bool`, `pass_state`, `latest_responded_at`; `maskedColumns:[]` |
| 5 | `esite_db_select` `projects.boq_items`, `columns:[id,rate]`, `limit:3` | `rate: null` on all three rows, `count:1001`, `maskedColumns:["rate"]` |
| 6 | `esite_db_select` `projects.projects`, `columns:[code,contract_value]` | `{"code":"636","contract_value":null}`, `maskedColumns:["contract_value"]` |
| 7 | `esite_db_select` `projects.boq_items`, `columns:[id]`, `order:[{column:rate}]` | refused: `That column is not available to your role.` |
| 8 | `esite_db_select` `schema:auth`, `table:users` | refused: `That schema is not exposed; call esite_db_schemas for the list.` |
| 9 | filter `fts` on `projects.projects.name` = `kingswalk` | 1 row, `(643) KINGSWALK`; no database error |
| 10 | filter `fts` on `inspections.responses.value_text` = `photo` | `rows:[]`, no database error (plain text column, zero matches) |
| 11 | filter `not.in` on `inspections.inspections.status` = `["assigned"]`, `limit:1` | 1 row `in_progress`, `count:9` (21 `assigned` via `in`, 30 total: consistent) |
| 12 | filters `in ["in_progress"]` plus `not.eq "zzz"`, `limit:2` | 2 rows, `count:9` |
| 13 | filter `not.in ["assigned","in_progress"]` | `rows:[]`, `count:0` (nothing else exists; checked against #11 so it is not vacuous) |

Was the mask real or just empty data? Read-only check through the Management API on production:
`projects.boq_items` has 39 rows with a non-null `rate` of 3074, and KINGSWALK's `contract_value` is non-null in
the database. The contractor saw `null` for both, and `maskedColumns` named them. The mask works.

`fts` and `not.in` go over the wire without a database error.

## Step 4: refusals

| Call | Refusal, verbatim |
|---|---|
| `esite_db_sql {sql:"select 1"}` | `SQL is for owners, admins and project managers; use esite_db_select.` |
| `esite_db_insert {schema:projects, table:project_members, rows:[{}]}` | `This table is managed in the app, not through Claude.` |
| `esite_db_update {schema:field, table:snags, filters:[], patch:{x:1}}` | `Update and delete need at least one filter.` |
| `esite_db_insert {schema:field, table:snags, rows:[{"rate; drop":1}]}` | `Column names must be plain identifiers.` |

All four returned HTTP 200 with `isError: true` and the sentence as the only content.

## Step 5: fail-closed before the migration is applied

| Call | Exact text returned |
|---|---|
| `esite_db_schemas {}` | `Database error PGRST202: Could not find the function public.mcp_catalog(p_schema) in the schema cache — Searched for the function public.mcp_catalog with parameter p_schema or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache. (Perhaps you meant to call the function public.mcp_rate_status)` |
| `esite_db_update` preview: `field.snags`, filter `id eq 00000000-0000-0000-0000-000000000000`, patch `{title:...}` | `Database error PGRST205: Could not find the table 'public.mcp_previews' in the schema cache (Perhaps you meant the table 'public.email_suppressions')` |
| `esite_db_delete` preview: `projects.site_diary_entries`, filter `id eq 0000...` | the same `PGRST205` text as the update preview |

Not the slice-1 generic sentence and not `42883/42P01`: PostgREST answers `PGRST202` (function) and `PGRST205`
(table) from its schema cache, and the tool surfaces them verbatim as a refusal. Nothing was written, no data
came back, and each was audited as a refused call (Step 7). The all-zeros id was used so that the preview, had
the table existed, would have matched no row.

## Step 6: write cycle

Candidates: `field.snags` (readable, 0 rows visible, so no sample of the column set was needed; its schema is in
`00004_field_schema.sql`) and the diary. `field.diary_entries` and `field.site_diary_entries` do not exist
(`PGRST205`); the diary is `projects.site_diary_entries`. I used the diary because the author can delete their own
row (`00149`) and it has no side-effect triggers beyond `updated_at`; a snag could have been picked up by the
notification path.

| Step | Call | Result |
|---|---|---|
| select a sample | `esite_db_select` `projects.site_diary_entries`, 6 columns, `limit:2` | 2 rows, `count:26` |
| insert | `esite_db_insert` `projects.site_diary_entries`, one row: `project_id` KINGSWALK, `organisation_id` WM, `entry_date` 2026-11-04, `progress_notes` `MCP smoke 2026-11-04 — delete me`, `created_by` the fixture; `returning:[id,progress_notes,created_by]` | `{"inserted":1,"ids":["c8023874-b7fd-4fad-84ce-db7d0198359b"], rows:[...]}` |
| read back | `esite_db_select` `id eq c8023874-...` | 1 row, text as inserted, `entry_type: progress` (column default) |
| remove | direct PostgREST `DELETE /rest/v1/site_diary_entries?id=eq.c8023874-...` as the fixture (`Accept-Profile`/`Content-Profile: projects`, `Prefer: return=representation`) | HTTP 200, the deleted row returned |
| confirm gone | `esite_db_select` `id eq c8023874-...` | `rows:[]`, `count:0` |
| sweep | `esite_db_select` `progress_notes ilike %MCP smoke%` on the same table | `rows:[]` |

Residue: none. The direct DELETE is not an MCP call, so it has no audit row.

## Step 7: audit read-back

Management API, read-only, `public.mcp_tool_calls` for the fixture over the last 2 hours: 33 rows, equal to the
33 `tools/call` requests made, in order. Columns below are `tool / kind / outcome / refusal / result_ids`.

| Time (UTC) | Tool | Kind | Outcome | Refusal (verbatim) | result_ids |
|---|---|---|---|---|---|
| 08:16:15 | esite_whoami | read | ok | | |
| 08:16:22-08:16:55 | esite_db_select x9 | read | ok | | |
| 08:16:56 | esite_db_select | read | refused | `That column is not available to your role.` | |
| 08:16:57 | esite_db_select | read | refused | `That schema is not exposed; call esite_db_schemas for the list.` | |
| 08:17:05-08:17:19 | esite_db_select x6 | read | ok | | |
| 08:17:27 | esite_db_sql | read | refused | `SQL is for owners, admins and project managers; use esite_db_select.` | |
| 08:17:28 | esite_db_insert | write | refused | `This table is managed in the app, not through Claude.` | |
| 08:17:29 | esite_db_update | preview | refused | `Update and delete need at least one filter.` | |
| 08:17:30 | esite_db_insert | write | refused | `Column names must be plain identifiers.` | |
| 08:17:31 | esite_db_schemas | read | refused | `Database error PGRST202: Could not find the function public.mcp_catalog(p_schema) in the schema cache ...` | |
| 08:17:33 | esite_db_update | preview | refused | `Database error PGRST205: Could not find the table 'public.mcp_previews' in the schema cache ...` | |
| 08:17:39 | esite_db_select | read | ok | | |
| 08:17:40, 08:17:42 | esite_db_select x2 | read | refused | `Database error PGRST205: Could not find the table 'field.site_diary_entries' ...` / `'field.diary_entries' ...` | |
| 08:18:00 | esite_db_select | read | ok | | |
| 08:18:12 | esite_db_insert | write | ok | | `["c8023874-b7fd-4fad-84ce-db7d0198359b"]` |
| 08:18:22, 08:18:29, 08:18:30 | esite_db_select x3 | read | ok | | |
| 08:18:41 | esite_db_delete | preview | refused | `Database error PGRST205: Could not find the table 'public.mcp_previews' ...` | |

Kinds are as designed: `read` for selects, schemas and the refused SQL; `write` for inserts; `preview` for
update and delete without a `previewId`. `result_ids` holds the inserted id.

Observation, not a defect: a refused call that hits a missing table (PGRST205 on a wrong table name) is audited
as a refusal, so a typo in a table name is logged the same way a policy refusal is.

## Owed after the merge and `00259` apply (not done here)

Run as `rbac-test` against production, and as an owner for the SQL one:

1. **`esite_db_schemas`**: lists the 14 exposed schemas, tables and columns; the list agrees with the PostgREST
   `db_schema` config; `rbac-test` sees no table outside what RLS allows. Read back `public.mcp_catalog`.
2. **Preview then confirm on a throwaway row**: insert a diary row as in Step 6, `esite_db_update` with one filter
   returns `previewId`, `wouldAffect:1` and a sample; the confirm with the `previewId` writes exactly that row;
   the PATCH under the column-only grant on `mcp_previews` (`consumed_at is null`, `select('id')`) and the
   `42703` head-count fallback; a second confirm with the same id refuses with
   `That preview has expired or does not match; run the preview again.`; repeat for `esite_db_delete`; audit
   kinds `preview` and `write` with `result_ids`.
3. **`esite_db_sql` as an owner or admin and the time cap**: one SELECT through `public.mcp_run_select` over
   PostgREST; the refusals (`;`, `pg_sleep`, `net.`); a deliberately slow SELECT is cut by the `authenticated`
   role's `statement_timeout` (8 s from `rolconfig`) and the measured value goes in `docs/mcp/enable-oauth.md`
   section 6. Also confirm that `rbac-test` calling `public.mcp_run_select` directly over PostgREST gets
   `SQL is for owners, admins and project managers; use esite_db_select.` and nothing else.

Also still owed from the slice: the `not.in`/`fts` filters were seen over the wire here (done), `esite_db_rpc` was
not exercised in this smoke, and the owner's meter-serial query through Claude Desktop.
