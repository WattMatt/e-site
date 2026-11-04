# E-Site MCP — open database (slice 2) — design

**Date:** 2026-11-03
**Status:** draft for owner approval
**Supersedes in part:** `2026-10-27-esite-mcp-server-design.md` §5 and §10 (the per-module tool catalogue and the slice order). §3 (auth), §4 (transport), §6 (audit) and §7 (safeguards) of that document stay in force and are relied on here.
**Owner decision this implements (2026-11-03):** *"we need a detailed two way street here for all database entries … a full two way open database."*

---

## 1. Intent

Slice 1 shipped four read tools. The owner's first real question through Claude, *the meter serial numbers on an inspection report*, could not be answered: those values live in `inspections.responses.value_text`, keyed by `field_id`, and need a join nobody wrote a tool for. Every curated catalogue has this problem on day one and forever after.

So the MCP server stops curating. Every table PostgREST exposes becomes readable and writable through Claude **as the signed-in person**, under the database's own row security, with the audit, rate limit and refusal sentences slice 1 already has. The person's rights through Claude are the person's rights through the browser's data layer, no more and no less, with a short list of write exceptions named in §5.

## 2. Goals, non-goals, anti-goals

**Goals**
- Any table in the 14 exposed schemas (259 tables on 2026-11-03: `public 27, projects 54, inspections 10, field 13, tenants 11, suppliers 3, billing 8, marketplace 7, cable_schedule 22, structure 11, gcr 5, solar 62, tariffs 16, whatsapp 10`) can be listed, read, inserted into, updated and deleted from, and any exposed function called, by one generic tool each.
- A read-only SQL statement of the person's own can be run, so joins and aggregates need no new tool.
- Every call still acts as the person (bearer-bound client, RLS), is audited in `public.mcp_tool_calls`, and is rate limited.
- A model can discover the schema without reading the repo.

**Non-goals**
- No business-rule emulation inside the tools. The app's server actions keep their gates; this path is the data layer.
- No new per-module tools. Slice 1's four discovery tools stay as conveniences; nothing else curated is added.
- No bypass of RLS, triggers or constraints. Nothing here uses the service key except the existing audit write.

**Anti-goals (what would make this a failure even if it works)**
- A person doing through Claude what the browser forbids them **on the tables that decide who may do what** (memberships, roles, billing, sealed bids, the audit log). §5 closes those for writes.
- A `DELETE` or `UPDATE` with no filter wiping a table. §4 refuses it.
- A write that happens before the person saw what it would touch. §4 previews update and delete.
- A long or heavy SQL statement stalling the Vercel function. §4 caps rows and time.

## 3. What exists that this stands on (verified on `origin/main` 2026-11-03)

- `apps/web/src/mcp/define-tool.ts`: `defineTool`, `runTool` (rate check → handler → audit → event), `ToolRefusal`, `ToolContext { client, user, claims, memberships }`, the three refusal sentences, `safeId`, the audit organisation derivation (project → org via the person's client, else sole membership).
- `apps/web/src/mcp/audit.ts`: the only service-key file; `rateStatus`, `recordToolCall`, `argsDigest`.
- `apps/web/src/mcp/mcp-module.contract.test.ts`: no service key outside `audit.ts`; `tools/**` imports only from the allowlist and never calls `.from(`. **§6 relaxes the `.from(` rule for the new `tools/db/` folder only**, because the generic tools are exactly the place raw queries belong.
- PostgREST: `db_schema` = the 14 schemas above; `max_rows = 1000` (also caps RPC results); `Accept-Profile` selects the schema; OpenAPI at `GET /rest/v1/` describes the tables and columns of one schema for the caller.
- `supabase-js`: `client.schema(s).from(t).select/insert/update/delete`, `.rpc(fn, args, { get: true })`.
- Migration tooling: `@verify` blocks, `scripts/db/dry-run-migration.sh`, `emit-verify-sweep.ts`, three suites. Ledger head `00257`; the next number is claimed at apply time.
- `lib/cable-schedule/export-role.ts`: `redactCost` = role not in `COST_VIEW_ROLES` (`owner`, `admin`, `project_manager`).

## 4. Tools

All names `esite_db_<verb>`. All `kind` values feed the existing rate rule (120 calls/min; 20 preview+write/min).

| Tool | Kind | Input | Output | Notes |
|---|---|---|---|---|
| `esite_db_schemas` | read | `{ schema? }` | without `schema`: the 14 schema names with table counts; with it: each table's columns (name, type, nullable, default) and whether it is a view | Reads `public.mcp_catalog(p_schema)` (§4.1), an invoker function over `information_schema` limited to the 14 exposed schemas, so the listing is the catalogue, not rows, and does not depend on PostgREST's OpenAPI (which may be restricted to secret keys and hides ungranted tables). |
| `esite_db_select` | read | `{ schema, table, columns?: string[], filters?: Filter[], order?: { column, ascending? }[], limit?: 1..1000 (default 100), offset?: number }` | `{ rows, count, nextOffset: number \| null, truncated, maskedColumns }` | `Filter = { column, op, value }`, `op` ∈ `eq neq gt gte lt lte like ilike in is cs cd ov fts not.eq not.in not.is`. `columns`, filter and order column names must be plain identifiers (`^[a-z_][a-z0-9_]*$`): no aliases, casts, embeds or JSON paths, so the cost mask in §5 cannot be sidestepped. `count` via `{ count: 'exact' }`, capped by PostgREST. |
| `esite_db_sql` | read | `{ sql }` | `{ rows, rowCount, truncated }` | One read-only statement, run as the person through `public.mcp_run_select(p_sql)` (§4.1) by **POST** (the text does not belong in a URL). Capped 1000 rows; time capped by the `authenticated` role's statement timeout (§4.1). Role gate §5. |
| `esite_db_insert` | write | `{ schema, table, rows: object[] (1..500), returning?: string[] }` | `{ inserted, ids, rows }` | `insert(rows).select(returning ?? '*')`; `ids` = the `id` column of the returned rows when present (the audit's `result_ids` reads it). Denylist §5. |
| `esite_db_update` | preview / write | `{ schema, table, filters: Filter[] (≥1), patch: object, previewId? }` | without `previewId`: `{ previewId, wouldAffect, sample (≤50 rows), expiresAt }`; with it: `{ updated, ids, rows }` | The preview runs the select the update will match and stores the matched ids. `previewId` is the `uuid` id of the `public.mcp_previews` row (§4.2), single-use, 24 h, bound to the user and to the exact `{schema, table, filters, patch}` by digest. **At confirm the select runs again; if the id set differs from the preview the call is refused** (sentence §4), so rows that changed meanwhile are never touched blind. `wouldAffect` above 1000 is refused at preview time: narrow the filter. |
| `esite_db_delete` | preview / write | `{ schema, table, filters: Filter[] (≥1), previewId? }` | as update | Same preview rule. |
| `esite_db_rpc` | read or write | `{ schema, fn, args?: object, readOnly?: boolean }` | `{ result, maskedColumns }` | Always POST. `readOnly: true` only changes the audit kind to `read` and the rate bucket; it is the caller's statement of intent, not a guarantee. Rows in the result pass through the same cost mask as `esite_db_select`. No function denylist: PostgREST already exposes every one of these functions to the same person directly, and each definer function enforces its own checks. |

A refusal anywhere is a `ToolRefusal` with a sentence; the three slice-1 sentences stay. New sentences, verbatim:

- missing filter: `Update and delete need at least one filter.`
- denylisted table: `This table is managed in the app, not through Claude.`
- unknown op: `Unknown filter operator.`
- bad identifier: `Column names must be plain identifiers.`
- masked column in a filter or order: `That column is not available to your role.`
- SQL not read-only / multi-statement: `Only one read-only SELECT is allowed here.`
- preview mismatch / expired / rows changed: `That preview has expired or does not match; run the preview again.`
- preview too wide: `That would touch more than 1000 rows; narrow the filter.`
- SQL role gate: `SQL is for owners, admins and project managers; use esite_db_select.`

### 4.1 Two invoker functions (one migration, number claimed at apply)

**`public.mcp_run_select(p_sql text) RETURNS jsonb`**

- **SECURITY INVOKER** and declared **STABLE**. Invoker means the dynamic statement runs as the calling role (`authenticated`) with the caller's JWT claims, so **RLS applies exactly as it does to any PostgREST read**; nothing is impersonated and no claim is set by hand. Three independent things stop a write: PostgREST runs an RPC on a STABLE function in a read-only transaction; a STABLE plpgsql function executes its SPI in read-only mode, which rejects INSERT/UPDATE/DELETE and data-modifying CTEs inside `EXECUTE`; and the text check below. The assertion file in §7 proves a write fails; the builder records which error code it fails with.
- Text checks before `EXECUTE`: after stripping leading whitespace and comments the statement must begin with `select` or `with` (case-insensitive); it must contain no `;`; it must not contain `pg_sleep`, `set_config`, `set role`, `copy`, `lo_import` as words.
- **Time cap:** the `authenticated` role's `statement_timeout` (Supabase's default is 8 s) is the real limit; a `set_config('statement_timeout', …, true)` inside the function does not re-arm the timer of the statement already running, so the design does not claim one. The builder verifies with `select pg_sleep(20)` after removing it from the word list in a scratch copy, and records the observed cap in the runbook. Vercel's `maxDuration` (300 s) is not the binding limit.
- Result: `jsonb_agg` of the rows, wrapped in `select … limit 1001`; truncation flagged when 1001 rows come back.
- `REVOKE EXECUTE FROM PUBLIC, anon`; `GRANT EXECUTE TO authenticated`. **Not** granted to `service_role`. The cost-role gate (§5) lives in the tool, not in the function: a contractor calling `mcp_run_select` directly over PostgREST gets what RLS already gives them over PostgREST, which is the same as today.
- `@verify`: function exists, `prosecdef = false`, `provolatile = 's'`, anon EXECUTE absent, authenticated EXECUTE present.

**`public.mcp_catalog(p_schema text DEFAULT NULL) RETURNS jsonb`**

- **SECURITY INVOKER**, STABLE. Without an argument: the 14 exposed schema names (hard-coded list in the function, matching PostgREST `db_schema`; the `@verify` block compares the two) each with its table count from `information_schema.tables`. With one: every table and view in that schema with its columns (`column_name`, `data_type`, `is_nullable`, `column_default`) from `information_schema.columns`, and `table_type`. `information_schema` already filters to objects the role has some privilege on, which for `authenticated` is every exposed table. Any other schema name returns `[]`.
- Grants as `mcp_run_select`.

### 4.2 `public.mcp_previews` (same migration)

`id uuid pk default gen_random_uuid(), user_id uuid not null default auth.uid(), tool text not null, args_digest text not null, matched_ids jsonb not null, would_affect integer not null, created_at timestamptz default now(), consumed_at timestamptz null`. RLS forced; a person reads and writes only their own rows (`user_id = auth.uid()` in USING and WITH CHECK), written through the **person's** client (not the service key) so the contract test's rule holds. The `id` is the `previewId` the client receives. A preview is valid when it is the caller's, unconsumed, under 24 h old, and its `args_digest` equals the digest of the confirm call's `{schema, table, filters, patch}`; consuming it sets `consumed_at` in the same request before the write runs. Rows older than 7 days are deleted by the person's own preview insert path (their rows only); no cron.

## 5. Guards

**Write denylist** (`apps/web/src/mcp/tools/db/denylist.ts`, one entry per table with a one-line reason; a contract test asserts every entry names an existing table on `origin/main` by reading the migrations, and that the list is used by insert, update, delete):

- `public.user_organisations`, `projects.project_members`, `public.profiles` — who is who; written by the users pages.
- `billing.*` (8 tables), `marketplace.paystack_subaccounts`, `marketplace.orders`, `marketplace.order_items`, `marketplace.commission_records`, `marketplace.commission_payouts` — money and Paystack state.
- `projects.tender_submissions`, `projects.tender_submission_lines`, `projects.tender_submission_documents` — sealed until closing; written by definer functions only. (`projects.tender_estimate_lines`, WM's own estimate, stays open.)
- `structure.scope_item_types` — an **org-wide** registry edited from a project page; one stray row put a "Shop 6" column on every tenant schedule in every project (2026-10-16).
- `public.mcp_tool_calls`, `public.mcp_previews` (the latter only through its own path) — the audit must not be editable by what it audits.
- `inspections.templates`, `field.form_templates` — a template must keep rendering against the wording its signatory saw; the triggers block only `schema_json`, so `name`/`is_active` edits would succeed here and are kept in the app's own template pages.

Reads are not denylisted anywhere: RLS already decides what a person sees.

**Why a denylist at all, when RLS acts as the person:** this codebase has repeatedly found row security looser than the app's checks on exactly these tables (self-promotion to org `owner` over PostgREST before 00177; any member reading every saved report before 00183; a contractor rewriting a DRAFT cable schedule before 00193). Those were fixed, but the pattern is the risk, and an eager model will probe faster than a browser user. The list is short and every line says why.

**Cost masking is a hard boundary, not cosmetic.** The browser hides rates and contract figures from site roles while the database lets them read the rows (00122 made BOQ rates readable project-wide and left the hiding to the app). This path must not undo that. So, for a caller who is not a cost-view role:

- the masked column list is **derived from the schema at build time**, not typed by hand: every column in the 14 schemas whose name matches `^(.*_)?(rate|price|amount|value|total|cost|retention)(_.*)?$` and is numeric, minus an explicit allowlist of non-commercial matches (`tariffs.*` rates are public reference data; `*_pct` other than `retention_pct`; measurement columns such as `design_load_a`). The builder generates `apps/web/src/mcp/tools/db/masked-columns.ts` from the migrations with a script and a contract test that fails when a new matching column appears without a decision. Known members from the check: `contract_value`, `retention_pct`, `retention_amount`, `supply_rate`, `install_rate`, `unit_price`, `quoted_price`, `value_to_date`, `total_ex_vat`, `amount_excl_vat`, `rate_per_*`;
- masked columns come back `null`, and `maskedColumns` names them;
- a filter or an order on a masked column is **refused** (bisection would reveal the value);
- `columns` entries are plain identifiers only (aliases, casts, embeds and JSON paths refused), so a mask keyed on the column name cannot be routed around;
- `esite_db_rpc` results pass through the same mask;
- **which role decides:** when the table has a `project_id` column, per row, by `user_effective_project_role(project_id)` (the post-00238 rule, cached per project within the call); when it has none, the caller's **highest** org role across their active memberships must be in `COST_VIEW_ROLES`, else masked. A cost-view role on every project the caller can see is not assumed from one project.

**`esite_db_sql` is limited to callers whose org role (in `user_organisations`) is in `COST_VIEW_ROLES`** — owner, admin or org-level project manager. A project-promoted PM (contractor at org level) does not get SQL, because SQL cannot be masked and that person may be a contractor on another project. Everyone else gets the sentence and `esite_db_select`.

**Write rules:** update and delete need at least one filter and a preview; insert is capped at 500 rows per call; the write budget stays 20 per minute (a 500-row insert is one call). Every write records the returned ids in the audit row (`result_ids`, capped at 200 ids).

**Audit labels:** when a table has a `project_id` column and the filters or rows fix it to one value, that value is the audit row's `project_id`; otherwise null and the org falls back to the slice-1 rule.

## 6. Repo rules and mechanics this changes

- `define-tool.ts`: a tool's `kind` becomes resolvable per call. `ToolDef` gains an optional `kindOf(args): ToolKind`; `runTool` uses it (falling back to the fixed `kind`) for the rate bucket and the audit row. Update and delete are `preview` without a `previewId` and `write` with one; rpc is `read` when `readOnly` is true.
- `define-tool.ts`: `result_ids` already reads an `ids` field from the handler's output; every write tool returns one (§4), capped at 200 ids before the audit call.
- `mcp-module.contract.test.ts`: the no-`.from(` rule exempts `tools/db/**` only. The no-service-key rule is unchanged and still covers `tools/db/**`.
- `docs/rbac-matrix.md` "MCP tools": seven new rows; `esite_db_sql` is R for owner/admin/PM only; all writes `W` for every role but client_viewer **subject to RLS**, with the denylist named.
- `docs/mcp/enable-oauth.md` gains a "What Claude can do" section: open read of every table the person can see; writes through preview; the denylist; how to read the audit table.
- Spec 2026-10-27 §5 and §10 get a one-paragraph note at the top pointing here.

## 7. Testing (the plan must carry each as a test that can fail)

- Unit (mocked client): filter operator mapping (every op, and the unknown-op refusal); missing-filter refusal; denylist refusal on all three write tools; cost masking on and off by role; preview → confirm happy path; preview with a different patch refused; expired preview refused; insert cap; `esite_db_sql` role gate; `esite_db_rpc` GET vs POST.
- Contract: denylist entries exist as tables in the migrations; `tools/db/**` uses no service key.
- Migration dry-run + `@verify` + full sweep + `assert-mcp-open-database.sql` impersonating `rbac-test` (contractor, KINGSWALK): `mcp_run_select('select count(*) from structure.nodes')` returns only KINGSWALK's rows; a `select` naming another project returns 0; `mcp_run_select('delete from …')` fails `25006` or the text check; `mcp_run_select('select pg_sleep(20)')` fails the text check; `anon` has no EXECUTE; `mcp_previews` is invisible across users. Red first against a no-op.
- Live smoke on a dev server as `rbac-test` after the migration is applied: `esite_db_schemas`, `esite_db_select inspections.responses` (filtered to one inspection), `esite_db_sql` refused (contractor), one insert/preview/update/preview/delete cycle on a throwaway row the fixture may write (the builder picks a table RLS lets a contractor write, e.g. a diary entry on KINGSWALK), audit rows read back, zero residue.
- Owner walk: the meter-serial query itself through Claude Desktop with `esite_db_sql`.

## 8. Calls I made (overridable)

1. `esite_db_sql` limited to org-level owner/admin/PM; everyone else has `esite_db_select` with masking. — Why: SQL cannot be masked, and a project-promoted PM may be a contractor elsewhere.
2. Cost masking is a hard boundary (schema-derived column list, plain identifiers only, filters on masked columns refused, rpc results masked). — Why: the app hides these figures from site roles and the database does not; this path must not become the leak. The builder check showed a name-only mask could be routed around four ways.
3. Masking role is per row by `user_effective_project_role` where a `project_id` exists, else the highest org role. — Why: the post-00238 rule; one call may span projects where the caller holds different roles.
4. Preview records in a table, keyed by uuid, re-checked at confirm against the current id set, capped at 1000 rows. — Why: Vercel instances do not share memory; rows can change between preview and confirm; a cap stops a wide delete passing on one glance.
5. Schema listing by an `information_schema` function, not PostgREST OpenAPI. — Why: OpenAPI may be restricted to secret keys and follows privileges; the function is deterministic and verifiable.
6. No function denylist for `esite_db_rpc`. — Why: PostgREST already exposes every function to the same person; the denylist is about tables whose RLS has been looser than the app.
7. No statement-timeout claim inside the SQL function; the role's timeout is the cap and is measured, not asserted. — Why: `set_config` inside a running statement does not re-arm its timer.
8. Write denylist as in §5, now including `structure.scope_item_types` and the marketplace money tables. — Why: §5's second paragraph and the 2026-10-16 incident.
9. Write budget stays 20/min. — Why: nothing yet shows it is too low; raising it is a one-line change.
10. No `esite_db_upsert`. — Why: PostgREST upsert needs the `Prefer: resolution=merge-duplicates` header, which has bitten this codebase three times; insert then update with a preview is explicit.
11. Slice 1's four discovery tools stay. — Why: `esite_whoami` is the model's orientation call and costs nothing to keep.

## 9. Open to the owner (answers change what gets built)

1. Should `esite_db_sql` open to every connected role, not only org-level cost-view roles? (Then contractors see contract values and rates through SQL that the UI hides from them.)
2. Any table to add to or remove from the write denylist (§5)? In particular `structure.scope_item_types` (org-wide registry) and `projects.tender_estimate_lines` (WM's estimate, left open).
3. Should a write through Claude also notify like the app does (emails, bells)? This design says **no**: the data layer writes rows and the app's triggers fire, but server-action side effects (emails) do not. Say if you want them.

## 10. Delivery

One PR, one migration (number claimed at apply), subagent-driven like slice 1: implementer and reviewer per task, whole-branch review, local smoke, PR, deploy, owner walk. No new switch: `MCP_ENABLED` and the OAuth server already gate it.
