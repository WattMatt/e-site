# E-Site MCP — open database (slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven generic MCP tools (`esite_db_schemas`, `esite_db_select`, `esite_db_sql`, `esite_db_insert`, `esite_db_update`, `esite_db_delete`, `esite_db_rpc`) that read and write every table PostgREST exposes, as the signed-in person, under RLS, with the slice-1 audit and rate limit, a write denylist, a hard cost mask and previewed updates and deletes.

**Architecture:** The tools live in `apps/web/src/mcp/tools/db/` and call `ctx.client.schema(s).from(t)` / `.rpc()` directly (the one folder the contract test allows raw queries in). One migration adds `public.mcp_previews` (the person's own preview rows) and two SECURITY INVOKER functions, `public.mcp_run_select(text)` and `public.mcp_catalog(text)`. The cost-mask column list is generated from the migrations by a script and pinned by a contract test. `define-tool.ts` gains a per-call `kindOf` so update/delete audit as `preview` without a `previewId` and `write` with one.

**Tech Stack:** Next.js 15.5 route (`/api/mcp`), `@modelcontextprotocol/sdk` 1.32, `@supabase/supabase-js`, zod, vitest; Postgres migrations with `@verify` blocks; `scripts/db/dry-run-migration.sh` against production in rolled-back transactions.

**Spec:** `docs/superpowers/specs/2026-11-03-esite-mcp-open-database-design.md` (approved 2026-11-03). Slice 1's spec `2026-10-27-esite-mcp-server-design.md` §3, §4, §6, §7 stay in force.

**Worktree:** `/Volumes/Extreme SSD/DEVELOPER/worktrees/esite-mcp-slice-1`, branch `feat/mcp-open-database` (cut from `origin/main` `3fc8248e`). All commands below run from that root. Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Global Constraints

- **Exposed schemas (14, verbatim):** `public, projects, inspections, field, tenants, suppliers, billing, marketplace, cable_schedule, structure, gcr, solar, tariffs, whatsapp`.
- **Identifiers:** every schema, table, column, filter column, order column, patch key, insert-row key and function name must match `^[a-z_][a-z0-9_]*$`. No aliases, casts, embeds (`a:b(*)`), JSON paths (`->`), or `*` except the implicit select list.
- **Limits:** select `limit` 1..1000, default 100; `esite_db_sql` 1001-row fetch, 1000 returned, `truncated` when 1001 came back; insert 1..500 rows; preview `wouldAffect` ≤ 1000 else refused; preview `sample` ≤ 50 rows; preview valid 24 h, single-use; preview rows older than 7 days deleted by the person's next preview; `result_ids` in the audit capped at 200 ids; rate limit unchanged (120 calls, 20 preview+write per minute).
- **Refusal sentences, verbatim (spec §4):**
  - `Update and delete need at least one filter.`
  - `This table is managed in the app, not through Claude.`
  - `Unknown filter operator.`
  - `Column names must be plain identifiers.`
  - `That column is not available to your role.`
  - `Only one read-only SELECT is allowed here.`
  - `That preview has expired or does not match; run the preview again.`
  - `That would touch more than 1000 rows; narrow the filter.`
  - `SQL is for owners, admins and project managers; use esite_db_select.`
- **Sentences this plan adds (spec silent; plan rulings, verbatim):**
  - unknown schema: `That schema is not exposed; call esite_db_schemas for the list.`
  - empty patch: `The patch is empty.`
  - a database error from the person's own client: `Database error <code>: <message>` followed by ` — <details>` and ` (<hint>)` when present. PostgREST returns the same text to the same person over REST, so nothing new is exposed. Exception: when the message is itself one of the sentences above (the SQL function raises `Only one read-only SELECT is allowed here.`), the refusal is that sentence alone.
- **Cost mask:** `COST_VIEW_ROLES` from `@esite/shared` (`owner`, `admin`, `project_manager`) is the only definition of who sees money. Masked columns come back `null`; `maskedColumns` lists them; a filter or order on a masked column is refused unless the caller holds an org-level cost role; write-returned rows and rpc results pass through the same mask.
- **Repo rules:** no service key anywhere under `src/mcp/**` except `audit.ts`; `tools/db/**` is the only place under `tools/` allowed `.from(`; every tool is a `defineTool`; every write tool returns `ids`.
- **Three suites on any migration work:** `pnpm --filter web test`, `pnpm --filter @esite/shared test`, `pnpm --filter @esite/db test:ci`. Plus `pnpm --filter web type-check` and `pnpm --filter web lint`.
- **Migration number is claimed at apply time.** The file is written as `00258` and re-checked against the ledger, `origin/main` and open-PR filenames immediately before merge.
- **Tests must be able to fail:** every refusal test asserts the exact sentence; every mask test asserts the null AND that the same row is un-nulled for a cost role.

## Review Focus

Input classes the spec implies but does not name; each has its test in the owning task.

1. **A table with no `id` column** (join tables, composite keys): preview must still work. Task 6 pins the count-only fallback when PostgREST answers `42703`.
2. **`in` with a non-array value, `is` with a string:** refused with `Unknown filter operator.`-class sentence, never a 500. Task 2 pins both (`in` requires an array; `is` requires `null`, `true` or `false`).
3. **Patch or insert keys that are not identifiers** (`"rate; drop table"`): refused with the identifier sentence before any query. Task 6 pins it.
4. **A select that omits `project_id` on a table with masked columns:** `project_id` is fetched internally for the per-row role and stripped from the output. Task 5 pins it.
5. **`esite_db_sql` text that starts with a comment, or contains a second statement:** `-- note\nselect 1` runs; `select 1; select 2` is refused; `with d as (delete from …) select 1` fails read-only. Task 4 pins all three in the assertion file.

---

### Task 1: Per-call tool kind and the audit id cap

**Files:**
- Modify: `apps/web/src/mcp/define-tool.ts`
- Modify: `apps/web/src/mcp/define-tool.test.ts`
- Modify: `apps/web/src/mcp/mcp-module.contract.test.ts`

**Interfaces:**
- Produces: `ToolDef<I>.kindOf?: (args: z.infer<z.ZodObject<I>>) => ToolKind` and `RegisteredTool.kindOf?: (args: never) => ToolKind`. `runTool` resolves `kind = tool.kindOf?.(args) ?? tool.kind` (a throw inside `kindOf` falls back to `tool.kind`) and uses it for the rate bucket, the audit row and the product event. `MAX_RESULT_IDS = 200`: an `ids` array longer than that is sliced before `recordToolCall`.
- Produces: the contract test's raw-query rule exempts files whose path starts with `tools/db/`.

- [ ] **Step 1: Write the failing tests** in `define-tool.test.ts`

```ts
it('kindOf decides the kind per call: preview without previewId, write with one', async () => {
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'write', inputSchema: { previewId: z.string().optional() },
    kindOf: a => (a.previewId ? 'write' : 'preview'), handler: async () => ({}) })
  await runTool(t, {}, ctx)
  expect(recordToolCall).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'preview' }))
  await runTool(t, { previewId: 'p' }, ctx)
  expect(recordToolCall).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'write' }))
})
it('a kindOf that throws falls back to the declared kind', async () => {
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'read', inputSchema: {}, kindOf: () => { throw new Error('x') }, handler: async () => ({}) })
  await runTool(t, {}, ctx)
  expect(recordToolCall).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'read', outcome: 'ok' }))
})
it('the write limit applies when kindOf resolves to write', async () => {
  rateStatus.mockResolvedValue({ calls: 5, writes: 20 })
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'read', inputSchema: {}, kindOf: () => 'write', handler: async () => ({}) })
  expect((await runTool(t, {}, ctx)).isError).toBe(true)
})
it('caps result ids at 200 in the audit row', async () => {
  const ids = Array.from({ length: 250 }, (_, i) => `id${i}`)
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'write', inputSchema: {}, handler: async () => ({ ids }) })
  await runTool(t, {}, ctx)
  expect((recordToolCall.mock.lastCall![0] as { resultIds: string[] }).resultIds).toHaveLength(200)
})
```

- [ ] **Step 2: Run them**: `pnpm --filter web exec vitest run src/mcp/define-tool.test.ts` — expected FAIL (`kindOf` ignored; 250 ids recorded).
- [ ] **Step 3: Implement** in `define-tool.ts`: add `kindOf` to both types; in `runTool` compute `const kind = resolveKind(tool, args)` first (try/catch → `tool.kind`), replace the three uses of `tool.kind` (`writing`, `recordToolCall`'s `kind`, the event's `properties.kind`); add `const MAX_RESULT_IDS = 200` and slice `resultIds` when it is an array.
- [ ] **Step 4: Relax the contract test**: in `mcp-module.contract.test.ts` the `.from(` assertion runs only when `!f.startsWith('tools/db/')`; the import allowlist and the service-key rule stay for every file. Add a comment: `tools/db/** holds the generic database tools; raw queries are their whole job.`
- [ ] **Step 5: Run**: `pnpm --filter web exec vitest run src/mcp` — expected all PASS. `pnpm --filter web type-check` clean.
- [ ] **Step 6: Commit**: `feat(mcp): per-call tool kind (kindOf) and a 200-id audit cap; tools/db may run raw queries`

---

### Task 2: `tools/db` foundations — schemas, identifiers, filters, denylist, errors, fake client

**Files:**
- Create: `apps/web/src/mcp/tools/db/sentences.ts`
- Create: `apps/web/src/mcp/tools/db/exposed-schemas.ts`
- Create: `apps/web/src/mcp/tools/db/identifiers.ts`
- Create: `apps/web/src/mcp/tools/db/filters.ts`
- Create: `apps/web/src/mcp/tools/db/denylist.ts`
- Create: `apps/web/src/mcp/tools/db/db-error.ts`
- Create: `apps/web/src/mcp/test/fake-client.ts` (not under `tools/`, so only the service-key rule applies to it)
- Test: `apps/web/src/mcp/tools/db/filters.test.ts`, `identifiers.test.ts`, `denylist.test.ts`, `denylist.contract.test.ts`, `db-error.test.ts`

**Interfaces:**
- `sentences.ts` exports one `const` per sentence in Global Constraints: `NEED_FILTER`, `DENYLISTED`, `UNKNOWN_OP`, `BAD_IDENT`, `MASKED_COLUMN`, `SQL_ONLY_SELECT`, `PREVIEW_MISMATCH`, `PREVIEW_TOO_WIDE`, `SQL_ROLE`, `UNKNOWN_SCHEMA`, `EMPTY_PATCH`.
- `exposed-schemas.ts`: `export const EXPOSED_SCHEMAS = [...14 names] as const`; `export function assertExposedSchema(schema: string): void` → `ToolRefusal(UNKNOWN_SCHEMA)`.
- `identifiers.ts`: `export const IDENT = /^[a-z_][a-z0-9_]*$/`; `export function assertIdent(name: unknown): string`; `export function assertIdents(names: readonly unknown[]): string[]` → `ToolRefusal(BAD_IDENT)`.
- `filters.ts`: `export const FILTER_OPS = ['eq','neq','gt','gte','lt','lte','like','ilike','in','is','cs','cd','ov','fts','not.eq','not.in','not.is'] as const`; `export const filterSchema = z.object({ column: z.string(), op: z.string(), value: z.unknown() })`; `export type Filter = z.infer<typeof filterSchema>`; `export function applyFilters<Q extends FilterableQuery>(query: Q, filters: Filter[]): Q` where `FilterableQuery` is the subset of PostgrestFilterBuilder methods used (`eq neq gt gte lt lte like ilike in is contains containedBy overlaps textSearch not`). Mapping: `eq→.eq`, `neq→.neq`, `gt/gte/lt/lte→same`, `like→.like`, `ilike→.ilike`, `in→.in(col, value)` (value must be an array, else `UNKNOWN_OP`), `is→.is(col, value)` (value must be `null | true | false`, else `UNKNOWN_OP`), `cs→.contains`, `cd→.containedBy`, `ov→.overlaps`, `fts→.textSearch(col, String(value))`, `not.eq→.not(col,'eq',value)`, `not.in→.not(col,'in',`(${value.join(',')})`)` (array required), `not.is→.not(col,'is',value)`. Column validated with `assertIdent` before the op check. `export function filterColumns(filters: Filter[]): string[]`.
- `denylist.ts`: `export const WRITE_DENYLIST: ReadonlyArray<{ table: string; reason: string }>` — entries, one reason each, exactly: `public.user_organisations`, `projects.project_members`, `public.profiles`, `billing.*`, `marketplace.paystack_subaccounts`, `marketplace.orders`, `marketplace.order_items`, `marketplace.commission_records`, `marketplace.commission_payouts`, `projects.tender_submissions`, `projects.tender_submission_lines`, `projects.tender_submission_documents`, `structure.scope_item_types`, `public.mcp_tool_calls`, `public.mcp_previews`, `inspections.templates`, `field.form_templates` (reasons from spec §5). `export function isWriteDenied(schema: string, table: string): boolean` (a `schema.*` entry matches every table in that schema); `export function assertWritable(schema: string, table: string): void` → `ToolRefusal(DENYLISTED)`.
- `db-error.ts`: `export type DbError = { code?: string; message?: string; details?: string | null; hint?: string | null } | null`; `export function refuseOnDbError(error: DbError): void` → throws `ToolRefusal` per the Global Constraints sentence rule (known sentence passes through alone; otherwise `Database error <code>: <message>` + optional ` — <details>` + ` (<hint>)`; missing code → `unknown`).
- `test/fake-client.ts`: `export function fakeClient(): { client: any; calls: Array<{ path: string; method: string; args: unknown[] }>; respond(next: { data: unknown; error?: unknown; count?: number | null }): void }`. `client.schema(s).from(t)` and `client.rpc(fn, args)` return a recording builder: every method call is pushed to `calls` (path `s.t` or `rpc:fn`) and returns the builder; the builder is thenable and resolves to the next queued response (`respond` queues one; an empty queue resolves `{ data: [], error: null, count: null }`). `maybeSingle`/`single` resolve the same way.

- [ ] **Step 1: Write failing tests**

`filters.test.ts` — one `it` per op using the fake client, asserting the recorded call, e.g.
```ts
it.each([
  ['eq', 5, ['eq', ['c', 5]]], ['neq', 5, ['neq', ['c', 5]]], ['gt', 1, ['gt', ['c', 1]]], ['gte', 1, ['gte', ['c', 1]]],
  ['lt', 1, ['lt', ['c', 1]]], ['lte', 1, ['lte', ['c', 1]]], ['like', 'a%', ['like', ['c', 'a%']]], ['ilike', 'a%', ['ilike', ['c', 'a%']]],
  ['in', [1, 2], ['in', ['c', [1, 2]]]], ['is', null, ['is', ['c', null]]], ['cs', ['x'], ['contains', ['c', ['x']]]],
  ['cd', ['x'], ['containedBy', ['c', ['x']]]], ['ov', ['x'], ['overlaps', ['c', ['x']]]], ['fts', 'meter', ['textSearch', ['c', 'meter']]],
  ['not.eq', 5, ['not', ['c', 'eq', 5]]], ['not.in', [1, 2], ['not', ['c', 'in', '(1,2)']]], ['not.is', null, ['not', ['c', 'is', null]]],
])('maps %s', (op, value, [method, args]) => { … expect(calls.at(-1)).toMatchObject({ method, args }) })
it('refuses an unknown operator with the sentence', () => expect(() => applyFilters(q, [{ column: 'c', op: 'regex', value: 1 }])).toThrow('Unknown filter operator.'))
it('refuses in with a non-array and is with a string', …)   // both throw 'Unknown filter operator.'
it('refuses a column that is not a plain identifier', () => expect(() => applyFilters(q, [{ column: 'a:b(*)', op: 'eq', value: 1 }])).toThrow('Column names must be plain identifiers.'))
```
`identifiers.test.ts`: accepts `shop_number`, `_x1`; refuses `Shop`, `a.b`, `a b`, `a->b`, `*`, `''`, `42`, `undefined`.
`denylist.test.ts`: `isWriteDenied('billing','invoices')` true; `('projects','tender_estimate_lines')` false; `assertWritable('structure','scope_item_types')` throws the sentence.
`denylist.contract.test.ts`: reads `apps/edge-functions/supabase/migrations/*.sql`; for every concrete entry, `CREATE TABLE (IF NOT EXISTS )?<schema>.<table>` exists and no later `DROP TABLE … <schema>.<table>` follows; for `billing.*` at least one `CREATE TABLE … billing.` exists; every entry has a non-empty reason.
`db-error.test.ts`: `null` does not throw; `{ code: '42P01', message: 'relation "x" does not exist', details: null, hint: null }` → `Database error 42P01: relation "x" does not exist`; `{ code: 'P0001', message: 'Only one read-only SELECT is allowed here.' }` → exactly that sentence.
`exposed-schemas` test (in `identifiers.test.ts` or its own): `assertExposedSchema('solar')` ok; `('auth')` throws `That schema is not exposed; call esite_db_schemas for the list.`

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run src/mcp/tools/db` — expected FAIL (modules missing).
- [ ] **Step 3: Implement** the six modules and the fake client per Interfaces.
- [ ] **Step 4: Run** the same command — expected PASS; `pnpm --filter web exec vitest run src/mcp/mcp-module.contract.test.ts` PASS (imports all `./`, `../`, `zod`); type-check clean.
- [ ] **Step 5: Commit**: `feat(mcp): tools/db foundations — exposed schemas, identifiers, filter mapping, write denylist, db errors`

---

### Task 3: The cost mask — generated column list, contract test, masking helpers

**Files:**
- Create: `apps/web/src/lib/mcp-mask/mask-candidates.ts` (parser)
- Create: `apps/web/src/lib/mcp-mask/allowlist.ts`
- Create: `apps/web/scripts/mcp/generate-masked-columns.ts`
- Create (generated): `apps/web/src/mcp/tools/db/masked-columns.ts`
- Create: `apps/web/src/mcp/tools/db/mask.ts`
- Test: `apps/web/src/lib/mcp-mask/mask-candidates.test.ts`, `apps/web/src/mcp/tools/db/masked-columns.contract.test.ts`, `apps/web/src/mcp/tools/db/mask.test.ts`

**Interfaces:**
- `mask-candidates.ts`: `export const MASK_NAME = /^(.*_)?(rate|price|amount|value|total|cost|retention)(_.*)?$/`; `export const NUMERIC_TYPES = /^(numeric|decimal|integer|int|int4|int8|bigint|smallint|real|double precision|money)\b/i`; `export type Candidate = { schema: string; table: string; column: string }`; `export type TableInfo = { hasProjectId: boolean }`; `export function readMigrations(dir: string): { candidates: Candidate[]; tables: Record<string, TableInfo> }` — walks files in name order; tracks `CREATE TABLE [IF NOT EXISTS] s.t (…)` bodies (column lines `name type …`, skipping `CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|EXCLUDE` lines), `ALTER TABLE s.t ADD COLUMN [IF NOT EXISTS] name type`, `ALTER TABLE s.t DROP COLUMN [IF EXISTS] name`, `ALTER TABLE s.t RENAME COLUMN a TO b`, `ALTER TABLE s.t RENAME TO u`, `DROP TABLE [IF EXISTS] s.t`; a table in `public` may be written without a schema prefix. Only schemas in `EXPOSED_SCHEMAS` are kept. `hasProjectId` = the table has a column named `project_id` after all edits.
- `allowlist.ts`: `export const MASK_ALLOWLIST: ReadonlyArray<{ schema: string; table: string; column: string; reason: string }>` with `'*'` wildcards. Initial entries (this plan's decisions; the generator run may show more candidates, which the implementer sorts into the allowlist with a reason or leaves masked):
  - `tariffs.*.*` — public reference data;
  - `*.*.vat_rate` — statutory rate;
  - `inspections.responses.value_number`, `inspections.response_history.value_number`, `field.form_responses.value_number`, `field.form_response_history.value_number` — measurements (the meter-serial case lives here);
  - `solar.meter_readings.value`, `cable_schedule.supply_routes.total_length_m` — measurements;
  - `public.platform_metrics_weekly.value`, `billing.usage_records.value`, `public.rate_index_values.value` — counts and public indices;
  - `solar.tariff_override_charges.amount_excl_vat`, `solar.study_export_rates.amount_excl_vat` — tariff reference figures.
  Everything else the survey found stays masked, including `projects.projects.contract_value/budget_amount`, `projects.project_settings.retention_pct`, `projects.boq_items.rate/supply_rate/install_rate/amount`, `cable_schedule.cost_lines.*`, `cable_schedule.rate_library.*`, `projects.valuations.*`, `projects.valuation_lines.value_to_date`, `projects.variation_lines.*`, `projects.boq_imports.total_ex_vat/total_incl_vat/vat_amount`, `gcr.settings.*`, `gcr.zone_generators.generator_cost`, `projects.tender*`, `public.rate_*`, `marketplace.*`, `billing.*` amounts, `solar.bill_checks.*`, `projects.procurement_*`, `projects.supplier_invoices.*`, `projects.engineer_equipment_schedule.estimated_unit_cost`.
- `generate-masked-columns.ts` (run `pnpm --filter web exec tsx scripts/mcp/generate-masked-columns.ts`): reads migrations, removes allowlisted candidates, writes `masked-columns.ts` with a header `// GENERATED by scripts/mcp/generate-masked-columns.ts — do not edit; rerun the script.` and `export const MASKED: Record<string, { columns: string[]; hasProjectId: boolean }>` keyed `schema.table`, columns sorted, keys sorted; plus `export const MASKED_COLUMN_NAMES: string[]` (the sorted union of column names, for rpc results).
- `masked-columns.contract.test.ts`: recomputes the structure from the migrations and `MASK_ALLOWLIST` and `expect(...).toEqual(MASKED)` (so a new matching column fails the build until it is masked by regeneration or allowlisted with a reason); asserts every allowlist entry matches at least one candidate (no dead entries); asserts `MASKED['projects.projects'].columns` contains `contract_value` and `MASKED['projects.project_settings'].columns` contains `retention_pct` and `MASKED['inspections.responses']` is undefined.
- `mask.ts`:
  - `export function hasOrgCostRole(ctx: ToolContext): boolean` — `ctx.memberships.some(m => COST_VIEW_ROLES.includes(m.role))`.
  - `export function maskedColumnsOf(schema: string, table: string): string[]` — from `MASKED`.
  - `export function assertFilterableColumns(schema: string, table: string, columns: string[], ctx: ToolContext): void` — refuses `MASKED_COLUMN` when any column is masked for this table and `!hasOrgCostRole(ctx)`. (Ruling: filters and orders on masked columns are allowed only to org-level cost roles; a project-promoted PM is refused even on their own project, because the role is only known after the query.)
  - `export async function maskRows(schema: string, table: string, rows: Record<string, unknown>[], ctx: ToolContext): Promise<{ rows: Record<string, unknown>[]; maskedColumns: string[] }>` — no masked columns, or `hasOrgCostRole(ctx)`: unchanged, `maskedColumns: []`. Otherwise per row: if the table `hasProjectId` and `row.project_id` is a uuid, `canSee = COST_VIEW_ROLES.includes(await role(project_id))` where `role` calls `ctx.client.rpc('user_effective_project_role', { p_project_id, p_user_id: ctx.user.id })` once per distinct project (Map cache); a row without a usable `project_id`, or a table without one, uses `hasOrgCostRole(ctx)` (false here) → masked. Masked columns present in the row set to `null`; `maskedColumns` = the masked columns that were present in at least one row.
  - `export function maskRpcResult(result: unknown, ctx: ToolContext): { result: unknown; maskedColumns: string[] }` — when `!hasOrgCostRole(ctx)`, walks arrays and plain objects recursively and nulls any key in `MASKED_COLUMN_NAMES`. (Ruling: an rpc result has no table, so the union of masked names and the org role decide.)

- [ ] **Step 1: Write failing tests**

`mask-candidates.test.ts` (fixture migration text written inline to a temp dir with `fs.mkdtempSync`):
```ts
it('finds numeric columns matching the name pattern, follows add/drop/rename and drop table, and records project_id', () => {
  write('00001_a.sql', `CREATE TABLE projects.a (id uuid, project_id uuid, rate numeric, name text, total_count integer);
    ALTER TABLE projects.a ADD COLUMN unit_price numeric(12,2); ALTER TABLE projects.a DROP COLUMN total_count;
    CREATE TABLE public.b (id uuid, amount integer); DROP TABLE public.b; CREATE TABLE auth.c (amount integer);
    CREATE TABLE d (id uuid, value numeric); ALTER TABLE d RENAME COLUMN value TO reading_value;`)
  const { candidates, tables } = readMigrations(dir)
  expect(candidates).toEqual([
    { schema: 'projects', table: 'a', column: 'rate' }, { schema: 'projects', table: 'a', column: 'unit_price' },
    { schema: 'public', table: 'd', column: 'reading_value' } ])
  expect(tables['projects.a']).toEqual({ hasProjectId: true }); expect(tables['public.d']).toEqual({ hasProjectId: false })
})
it('ignores text columns and constraint lines', …)  // `CONSTRAINT total_check CHECK (…)`, `rate text` → no candidate
```
`masked-columns.contract.test.ts` as in Interfaces.
`mask.test.ts` (fake client; `ctx.memberships` controls the org role):
```ts
it('an org cost role sees every column unchanged', …)                      // maskedColumns []
it('a contractor sees contract_value as null on projects.projects, by per-row effective role', …)
   // two rows, project P1 (rpc → 'project_manager') keeps 100, project P2 (rpc → 'contractor') → null; rpc called once per project
it('a table without project_id masks by org role', …)                     // cable_schedule.rate_library row → null for contractor
it('a filter on a masked column is refused for a contractor and allowed for an owner', …)  // sentence 'That column is not available to your role.'
it('maskRpcResult nulls masked names recursively for a contractor only', …) // { total: [{ rate: 1, name: 'x' }] } → rate null, name kept
```

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run src/lib/mcp-mask src/mcp/tools/db/mask` — expected FAIL.
- [ ] **Step 3: Implement** the parser, the allowlist, the generator; run the generator; open the generated file and sort any candidate not in the plan's lists into the allowlist (with a reason) or leave it masked; rerun the generator; implement `mask.ts`.
- [ ] **Step 4: Verify the parser against the live catalogue once** (not a test): via the Management API (`scripts/db/mgmt-api.sh` helpers; PAT from the keychain), run `select table_schema||'.'||table_name||'.'||column_name from information_schema.columns where table_schema = any('{<14 schemas>}') and column_name ~ '^(.*_)?(rate|price|amount|value|total|cost|retention)(_.*)?$' and data_type in ('numeric','integer','bigint','smallint','real','double precision','money') order by 1` and diff against the parser's candidate list. Record the diff in the task report; a parser miss is fixed in the parser, never by hand-editing the generated file.
- [ ] **Step 5: Run** the tests — expected PASS; type-check and lint clean; `pnpm --filter web exec vitest run src/mcp/mcp-module.contract.test.ts` PASS.
- [ ] **Step 6: Commit**: `feat(mcp): schema-derived cost mask — generated masked-columns, allowlist, per-row role masking`

---

### Task 4: Migration `00258` — `mcp_previews`, `mcp_run_select`, `mcp_catalog` — with behavioural assertions

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00258_mcp_open_database.sql`
- Create: `scripts/db/assert-mcp-open-database.sql`

**Interfaces:**
- `public.mcp_previews` (spec §4.2): `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `user_id uuid NOT NULL DEFAULT auth.uid()`, `tool text NOT NULL`, `args_digest text NOT NULL`, `matched_ids jsonb` (NULL allowed: count-only previews), `would_affect integer NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`, `consumed_at timestamptz`. `ENABLE` + `FORCE ROW LEVEL SECURITY`; `REVOKE ALL FROM PUBLIC, anon`; `GRANT SELECT, INSERT, UPDATE, DELETE TO authenticated`; `GRANT ALL TO service_role`; one PERMISSIVE policy `mcp_previews_own FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())`. Index `(user_id, created_at)`.
- `public.mcp_run_select(p_sql text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public`: strips `--…` line comments and `/* … */` block comments, trims; `lower(left(stripped, 6))` must start the text with `select` or `with` as a word (`stripped ~* '^(select|with)\M'`); `position(';' in stripped) = 0`; `stripped !~* '\m(pg_sleep|set_config|lo_import|copy)\M'` and `stripped !~* '\mset\s+role\M'`; otherwise `RAISE EXCEPTION 'Only one read-only SELECT is allowed here.' USING ERRCODE = 'P0001'`. Then `EXECUTE format('select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (%s limit 1001) q', stripped) INTO result; RETURN result;`. `REVOKE EXECUTE FROM PUBLIC, anon, service_role; GRANT EXECUTE TO authenticated`.
- `public.mcp_catalog(p_schema text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public`: with NULL → `[{ "schema": s, "tables": n }]` for the 14 names (hard-coded array in the function, in the Global Constraints order) with counts from `information_schema.tables`; with a name in the list → `[{ "table": t, "kind": "table"|"view", "columns": [{ "name", "type", "nullable", "default" }] }]` ordered by table then `ordinal_position`; any other name → `'[]'::jsonb`. Grants as `mcp_run_select`.
- `@verify` block (every directive one this migration alone satisfies): `table: public.mcp_previews`; `policy: mcp_previews_own ON public.mcp_previews PERMISSIVE`; `function: public.mcp_run_select(text)`; `function: public.mcp_catalog(text)`; `grant_absent: anon EXECUTE ON public.mcp_run_select(text)`; `grant_absent: anon EXECUTE ON public.mcp_catalog(text)`; `grant_present: authenticated EXECUTE ON public.mcp_run_select(text)`; `grant_absent: anon SELECT ON public.mcp_previews`; `sql: (SELECT NOT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.mcp_run_select(text)'::regprocedure)`; `sql: (SELECT jsonb_array_length(public.mcp_catalog()) = 14)`; `behaviour: … proven by scripts/db/assert-mcp-open-database.sql`. (Ruling: the catalogue list cannot be compared to PostgREST's `db_schema` from SQL; the builder compares it once by `GET /v1/projects/{ref}/postgrest` and records the 14 names in the report.)
- `assert-mcp-open-database.sql` (same shape as `assert-mcp-tool-calls.sql`: fixtures seeded before the first `SET LOCAL ROLE`, `request.jwt.claims` set per identity, last statement returns `(check text, ok boolean)`), impersonating `rbac-test` (`018f2d31-bbe8-4cc1-bbdd-63af0187081e`, contractor on KINGSWALK) and a throwaway second user:
  1. `mcp_run_select('select count(*) as n from structure.nodes')` as rbac-test = the count the same role gets from `select count(*) from structure.nodes` directly (RLS applies identically);
  2. `mcp_run_select('select count(*) as n from structure.nodes where project_id = ''<v_proj_off>''')` → `[{"n":0}]`;
  3. `mcp_run_select('-- note' || E'\n' || 'select 1 as x')` → `[{"x":1}]`;
  4. `mcp_run_select('select 1; select 2')` raises with message `Only one read-only SELECT is allowed here.`;
  5. `mcp_run_select('delete from public.mcp_previews')` raises the same sentence (text check);
  6. `mcp_run_select('with d as (delete from public.mcp_previews returning id) select count(*) from d')` raises; record the SQLSTATE in a `check` label (`25006` or `0A000`), assert it is one of the two;
  7. `mcp_run_select('select pg_sleep(20)')` raises the sentence;
  8. `mcp_run_select('select set_config(''x.y'',''1'',true)')` raises the sentence;
  9. `has_function_privilege('anon', 'public.mcp_run_select(text)', 'EXECUTE')` false; `('authenticated', …)` true; `('service_role', …)` false;
  10. `mcp_catalog()` has 14 elements; `mcp_catalog('inspections')` lists a table named `responses` with a column `value_text`; `mcp_catalog('auth')` = `[]`;
  11. as rbac-test insert a `mcp_previews` row (defaults fill `user_id`), read it back (1 row); as the second user read `mcp_previews` → 0 rows; as the second user update the first user's row → 0 rows affected; as rbac-test insert with `user_id` = the other user → fails WITH CHECK (`42501`);
  12. anon: `select from public.mcp_previews` → `42501`.
- [ ] **Step 1: Write the assertion file first and run it red**: `scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-mcp-open-database.sql` — expected: the chain aborts or every check is false (functions and table missing). Record the output.
- [ ] **Step 2: Write the migration.** Check the ledger head before naming it: `select max(version) from supabase_migrations.schema_migrations` via the Management API, `ls apps/edge-functions/supabase/migrations | tail -1` on `origin/main`, and `gh pr list --state open --json files` for any `0025x_`/`0026x_` filename. Name the file one above the highest.
- [ ] **Step 3: Dry-run green**: `scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00258_mcp_open_database.sql scripts/db/assert-mcp-open-database.sql` — expected every check `ok = true`. Then two mutations, each red: (a) drop the `position(';')` check → assertion 4 goes false; (b) drop the policy's `WITH CHECK` → assertion 11's cross-user insert succeeds and goes false. Restore.
- [ ] **Step 4: Sweep**: `pnpm --filter web exec tsx scripts/db/emit-verify-sweep.ts apps/edge-functions/supabase/migrations/00258_mcp_open_database.sql` (or the script's documented invocation) — every earlier `@verify` directive green under the new migration; record the count.
- [ ] **Step 5: Measure the time cap** (spec §4.1; not an assertion): over PostgREST with a real `rbac-test` JWT (`POST https://cbskbnvvgcybmfikxgky.supabase.co/rest/v1/rpc/mcp_run_select` with `{"p_sql":"select count(*) from generate_series(1, 300000000)"}`) is only possible after apply, so note it as owed to the post-apply smoke (Task 8) and record the `authenticated` role's `statement_timeout` from `select rolconfig from pg_roles where rolname = 'authenticated'` now.
- [ ] **Step 6: Run the db suite**: `pnpm --filter @esite/db test:ci` — expected PASS (the `@verify` grammar guard and migration guards read the file text).
- [ ] **Step 7: Commit**: `feat(db): 00258 mcp_previews + mcp_run_select + mcp_catalog (SECURITY INVOKER, read-only SQL for the MCP server)`

---

### Task 5: Read tools — `esite_db_schemas`, `esite_db_select`, `esite_db_sql`

**Files:**
- Create: `apps/web/src/mcp/tools/db/catalog.ts`, `select.ts`, `sql.ts`, `project-id.ts`, `index.ts`
- Modify: `apps/web/src/mcp/tools/index.ts` (`ALL_TOOLS = [...discoveryTools, ...dbTools]`)
- Test: `apps/web/src/mcp/tools/db/catalog.test.ts`, `select.test.ts`, `sql.test.ts`, `project-id.test.ts`

**Interfaces:**
- Consumes: Task 2 (`assertExposedSchema`, `assertIdent(s)`, `filterSchema`, `applyFilters`, `filterColumns`, `refuseOnDbError`, sentences), Task 3 (`maskRows`, `assertFilterableColumns`, `hasOrgCostRole`, `MASKED`), Task 1 (`defineTool`).
- `project-id.ts`: `export function projectIdFromFilters(filters: Filter[] | undefined): string | null` — the value of an `eq` filter on `project_id` when it is a uuid string; `export function projectIdFromRows(rows: Record<string, unknown>[]): string | null` — when every row carries the same uuid `project_id`. Used as `projectIdOf` by select/update/delete (filters) and insert (rows).
- `catalog.ts` → `esite_db_schemas`: `inputSchema { schema: z.string().optional() }`, kind `read`; handler: when `schema` given, `assertExposedSchema`; `ctx.client.rpc('mcp_catalog', { p_schema: schema ?? null })`; `refuseOnDbError`; returns `{ schemas: data }` or `{ schema, tables: data }`.
- `select.ts` → `esite_db_select`: `inputSchema { schema: z.string(), table: z.string(), columns: z.array(z.string()).optional(), filters: z.array(filterSchema).optional(), order: z.array(z.object({ column: z.string(), ascending: z.boolean().optional() })).optional(), limit: z.number().int().min(1).max(1000).default(100), offset: z.number().int().min(0).default(0) }`; kind `read`; `projectIdOf: a => projectIdFromFilters(a.filters)`. Handler order: `assertExposedSchema(schema)`; `assertIdent(table)`; `assertIdents(columns ?? [])`; `assertIdents(order columns)`; `assertFilterableColumns(schema, table, [...filterColumns(filters), ...order columns], ctx)`; `needProjectId = MASKED[`${schema}.${table}`]?.hasProjectId && columns && !columns.includes('project_id')`; select list = `columns ? [...columns, ...(needProjectId ? ['project_id'] : [])].join(',') : '*'`; `q = ctx.client.schema(schema).from(table).select(list, { count: 'exact' })`; `applyFilters`; each `order` → `.order(column, { ascending: ascending ?? true })`; `.range(offset, offset + limit - 1)`; await; `refuseOnDbError(error)`; `maskRows`; strip `project_id` from each row when `needProjectId`; return `{ rows, count, nextOffset: count != null && offset + rows.length < count ? offset + rows.length : null, truncated: nextOffset != null, maskedColumns }`.
- `sql.ts` → `esite_db_sql`: `inputSchema { sql: z.string().min(1) }`; kind `read`; handler: `if (!hasOrgCostRole(ctx)) throw new ToolRefusal(SQL_ROLE)`; `ctx.client.rpc('mcp_run_select', { p_sql: sql })`; `refuseOnDbError`; `rows = data as unknown[]`; `truncated = rows.length > 1000`; return `{ rows: rows.slice(0, 1000), rowCount: Math.min(rows.length, 1000), truncated }`.
- `index.ts`: `export const dbTools: RegisteredTool[] = [esiteDbSchemas, esiteDbSelect, esiteDbSql]` (Tasks 6 and 7 append).

- [ ] **Step 1: Write failing tests** (fake client; `ctx` built as in `discovery.test.ts` with `memberships` set per case; parse args through `z.object(t.inputSchema).parse` as that test does)

`select.test.ts`:
```ts
it('selects with filters, order and range, and returns paging', …)
  // args { schema:'inspections', table:'responses', filters:[{column:'inspection_id',op:'eq',value:I1}], order:[{column:'field_id'}], limit:2, offset:0 }
  // respond { data:[r1,r2], count:5 } → calls include ['select',['*',{count:'exact'}]], ['eq',['inspection_id',I1]], ['order',['field_id',{ascending:true}]], ['range',[0,1]]
  // out = { rows:[r1,r2], count:5, nextOffset:2, truncated:true, maskedColumns:[] }
it('last page has nextOffset null and truncated false', …)
it('refuses an unexposed schema with the sentence', …)                      // 'auth'
it('refuses a table name with a dot', …)                                   // 'projects.boq_items' as table → identifier sentence
it('refuses an order on a masked column for a contractor', …)              // projects.projects order contract_value → 'That column is not available to your role.'
it('fetches project_id internally for a masked table when columns omit it, masks per row, and strips it', …)
  // contractor, projects.boq_items (hasProjectId true), columns ['id','rate'] → select list 'id,rate,project_id'
  // rpc user_effective_project_role → 'contractor' → rate null, project_id absent in output, maskedColumns ['rate']
it('surfaces a PostgREST error as a refusal with code and message', …)     // error { code:'42P01', message:'relation "projects.nope" does not exist' }
it('limit above 1000 fails input parsing', () => expect(() => z.object(tool.inputSchema).parse({ schema:'public', table:'x', limit: 1001 })).toThrow())
it('projectIdOf reads an eq filter on project_id', …)
```
`sql.test.ts`: contractor refused with `SQL is for owners, admins and project managers; use esite_db_select.` and `rpc` not called; owner → `rpc('mcp_run_select', { p_sql })` called, `{ rows, rowCount, truncated:false }`; 1001 rows → 1000 returned, `truncated:true`; a `P0001` error with the read-only sentence → refusal text is exactly that sentence.
`catalog.test.ts`: no arg → `rpc('mcp_catalog', { p_schema: null })` and `{ schemas }`; `'solar'` → `{ schema:'solar', tables }`; `'auth'` refused with the unknown-schema sentence.
`project-id.test.ts`: eq on project_id with uuid → id; `in` on project_id → null; rows all P1 → P1; rows mixed → null.

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run src/mcp/tools/db` — expected FAIL.
- [ ] **Step 3: Implement** per Interfaces; register in `tools/index.ts`.
- [ ] **Step 4: Run** `pnpm --filter web exec vitest run src/mcp` (whole module incl. the contract test and `route.test.ts`) — PASS; type-check; lint.
- [ ] **Step 5: Commit**: `feat(mcp): esite_db_schemas, esite_db_select (masked, paged) and esite_db_sql (cost roles only)`

---

### Task 6: Write tools — `esite_db_insert`, previews, `esite_db_update`, `esite_db_delete`

**Files:**
- Create: `apps/web/src/mcp/tools/db/previews.ts`, `insert.ts`, `mutate.ts`
- Modify: `apps/web/src/mcp/tools/db/index.ts` (append `esiteDbInsert, esiteDbUpdate, esiteDbDelete`)
- Test: `previews.test.ts`, `insert.test.ts`, `mutate.test.ts`

**Interfaces:**
- `previews.ts`: `export type PreviewArgs = { schema: string; table: string; filters: Filter[]; patch?: Record<string, unknown> }`; `export async function createPreview(ctx, input: { tool: string; args: PreviewArgs; matchedIds: string[] | null; wouldAffect: number }): Promise<{ previewId: string; expiresAt: string }>` — first `ctx.client.schema('public').from('mcp_previews').delete().lt('created_at', <now − 7 d ISO>)` (RLS limits it to the person's rows; an error here is ignored), then `.insert({ tool, args_digest: argsDigest(args), matched_ids, would_affect }).select('id, created_at').single()`; `refuseOnDbError`; `expiresAt = created_at + 24 h`. `argsDigest` imported from `../../audit`. `export async function consumePreview(ctx, input: { previewId: string; tool: string; args: PreviewArgs }): Promise<{ matchedIds: string[] | null; wouldAffect: number }>` — `.select('*').eq('id', previewId).maybeSingle()`; refuse `PREVIEW_MISMATCH` when: no row, `row.tool !== tool`, `row.args_digest !== argsDigest(args)`, `row.consumed_at != null`, or `created_at` older than 24 h; then `.update({ consumed_at: now }).eq('id', previewId).is('consumed_at', null).select('id')` → zero rows → refuse `PREVIEW_MISMATCH` (single use under concurrency).
- `insert.ts` → `esite_db_insert`: `inputSchema { schema, table, rows: z.array(z.record(z.unknown())).min(1).max(500), returning: z.array(z.string()).optional() }`; kind `write`; `projectIdOf: a => projectIdFromRows(a.rows)`. Handler: `assertExposedSchema`; `assertIdent(table)`; `assertIdents(every key of every row)`; `assertIdents(returning ?? [])`; `assertWritable(schema, table)`; `.insert(rows).select((returning ?? ['*']).join(','))`; `refuseOnDbError`; `maskRows`; `ids` = `rows.map(r => r.id).filter(isUuidOrString)` when present else `[]`; return `{ inserted: rows.length, ids, rows }`.
- `mutate.ts` → both `esite_db_update` and `esite_db_delete` from one `makeMutateTool(verb: 'update' | 'delete')`. `inputSchema { schema, table, filters: z.array(filterSchema), patch: z.record(z.unknown()) (update only), previewId: z.string().uuid().optional() }`; declared `kind: 'write'`, `kindOf: a => (a.previewId ? 'write' : 'preview')`; `projectIdOf: a => projectIdFromFilters(a.filters)`. Handler order: `assertExposedSchema`; `assertIdent(table)`; `if (filters.length === 0) throw ToolRefusal(NEED_FILTER)`; update: `if (Object.keys(patch).length === 0) throw ToolRefusal(EMPTY_PATCH)`; `assertIdents(patch keys)`; `assertWritable`; `assertFilterableColumns(schema, table, filterColumns(filters), ctx)`; `args: PreviewArgs = { schema, table, filters, patch? }`.
  - **Preview (no `previewId`):** `q = .select('*', { count: 'exact' })` + `applyFilters` + `.limit(1000)`; `refuseOnDbError`; `if ((count ?? rows.length) > 1000) throw ToolRefusal(PREVIEW_TOO_WIDE)`; `matchedIds = rows.length && 'id' in rows[0] ? rows.map(r => String(r.id)).sort() : null`; `{ rows: sample } = await maskRows(schema, table, rows.slice(0, 50), ctx)`; `createPreview(ctx, { tool: name, args, matchedIds, wouldAffect: count ?? rows.length })`; return `{ previewId, wouldAffect, sample, expiresAt }`.
  - **Confirm (`previewId`):** `consumePreview(...)`; re-run `.select('id', { count: 'exact' })` + filters + `.limit(1000)`; if the error code is `42703` (no `id` column) re-run `.select('*', { count: 'exact', head: true })` and compare counts only; else compare sorted id arrays with `matchedIds` (when `matchedIds` is null compare counts). Mismatch → `ToolRefusal(PREVIEW_MISMATCH)`. Then `update(patch)` / `delete()` + `applyFilters` + `.select('*')`; `refuseOnDbError`; `maskRows`; return `{ [verb === 'update' ? 'updated' : 'deleted']: rows.length, ids, rows }`.

- [ ] **Step 1: Write failing tests**

`previews.test.ts`: `createPreview` records a `delete().lt('created_at', …)` then an `insert` whose `args_digest` equals `argsDigest(args)` and returns `expiresAt` = created_at + 24 h; `consumePreview` refuses (sentence) on: no row; wrong tool; different patch (digest differs); `consumed_at` set; `created_at` 25 h ago; `update … is('consumed_at', null)` returning `[]`; happy path returns `{ matchedIds, wouldAffect }` and records the update.
`insert.test.ts`: happy path (`insert` then `select('*')`, output `{ inserted:2, ids:[…], rows }`); `returning: ['id','name']` → `select('id,name')`; denylisted `billing.invoices` → sentence and no query; a row key `'rate; drop'` → identifier sentence; 501 rows fail parsing; contractor inserting into `projects.boq_items` gets `rate` null in the returned rows (mask on write output).
`mutate.test.ts` (both verbs via `it.each(['update','delete'])` where the shape is shared):
```ts
it('is a preview without previewId and a write with one (kindOf)', …)
it('refuses zero filters with the sentence and runs no query', …)
it('update refuses an empty patch', …)
it('refuses a denylisted table', …)                                     // projects.project_members
it('refuses a filter on a masked column for a contractor', …)
it('preview: selects with count, stores sorted ids, returns ≤50 masked sample and expiresAt', …)
   // 60 rows → sample length 50, wouldAffect 60, createPreview called with matchedIds sorted
it('preview: refuses when count exceeds 1000', …)                      // count 1001 → 'That would touch more than 1000 rows; narrow the filter.'
it('confirm: re-selects ids, refuses when the id set changed', …)      // preview ids [a,b], now [a,c] → mismatch sentence, no update
it('confirm: runs the write with the same filters and returns ids and masked rows', …)
   // update → calls include ['update',[patch]], ['eq',[...]], ['select',['*']]; delete → ['delete',[]]
it('confirm on a table without id (42703) compares counts only', …)     // select('id') errors 42703 → head count 3 vs stored 3 → proceeds
it('projectIdOf reads project_id from an eq filter', …)
```

- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement** per Interfaces; append to `dbTools`.
- [ ] **Step 4: Run** `pnpm --filter web exec vitest run src/mcp` — PASS; type-check; lint; contract test PASS (`previews.ts` imports `../../audit` which is allowed by `../`).
- [ ] **Step 5: Commit**: `feat(mcp): esite_db_insert, esite_db_update and esite_db_delete with stored, re-checked previews`

---

### Task 7: `esite_db_rpc`, server instructions and documentation

**Files:**
- Create: `apps/web/src/mcp/tools/db/rpc.ts`; Test: `rpc.test.ts`
- Modify: `apps/web/src/mcp/tools/db/index.ts` (append), `apps/web/src/mcp/server.ts` (INSTRUCTIONS)
- Modify: `docs/rbac-matrix.md` (MCP tools section), `docs/mcp/enable-oauth.md` (new section), `docs/superpowers/specs/2026-10-27-esite-mcp-server-design.md` (note at top)

**Interfaces:**
- `rpc.ts` → `esite_db_rpc`: `inputSchema { schema: z.string().default('public'), fn: z.string(), args: z.record(z.unknown()).optional(), readOnly: z.boolean().default(false) }`; declared `kind: 'write'`, `kindOf: a => (a.readOnly ? 'read' : 'write')`. Handler: `assertExposedSchema(schema)`; `assertIdent(fn)`; `ctx.client.schema(schema).rpc(fn, args ?? {})` (POST); `refuseOnDbError`; `{ result, maskedColumns } = maskRpcResult(data, ctx)`; `ids` = when `result` is an array of objects with `id`, those ids (so a writing function's rows reach the audit); return `{ result, maskedColumns, ids }`.
- `server.ts` INSTRUCTIONS (replace, verbatim): `Every tool acts as the signed-in E-Site user under the database's row security. Start with esite_whoami. esite_db_schemas lists tables and columns; esite_db_select reads any table; esite_db_sql runs one read-only SELECT (owners, admins and project managers). esite_db_update and esite_db_delete first return a preview with a previewId; call again with that previewId within 24 hours to commit. Cost figures are null for roles that may not see them. A few tables (memberships, billing, sealed bids, templates, the audit log) are not writable here.`
- `docs/rbac-matrix.md` "MCP tools": rename the lead sentence (no longer "Slice 1 is read-only"); add seven rows: `esite_db_schemas` R all but client_viewer; `esite_db_select` R (masked for non-cost roles); `esite_db_sql` R for owner/admin/project_manager (org-level), `—` others; `esite_db_insert`/`esite_db_update`/`esite_db_delete` `W*` all but client_viewer; `esite_db_rpc` R/W all but client_viewer; a note block: `*subject to RLS and the write denylist (apps/web/src/mcp/tools/db/denylist.ts)`, the preview rule, the cost-mask rule and where the mask list is generated.
- `docs/mcp/enable-oauth.md`: new `## 6. What Claude can do` — open read of every table the person can see; the seven tools in one line each; writes through preview; the denylist; how to read `public.mcp_tool_calls` (`select tool, kind, outcome, refusal, created_at from public.mcp_tool_calls order by created_at desc limit 50`); the measured SQL time cap (filled in by Task 8).
- Spec 2026-10-27: a one-paragraph `> **Note (2026-11-03):** §5 and §10 are superseded by 2026-11-03-esite-mcp-open-database-design.md …` under the status line.

- [ ] **Step 1: Write failing tests** (`rpc.test.ts`): `rpc('fn', args)` recorded on `schema('public')`; `kindOf` read when `readOnly`, write otherwise; `fn` `'a.b'` refused with the identifier sentence; result `[{ id:'x', rate: 2 }]` for a contractor → `rate` null, `maskedColumns ['rate']`, `ids ['x']`; owner unchanged; a PostgREST error surfaces as `Database error 42883: …`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** and append to `dbTools`; update INSTRUCTIONS; edit the three docs. **Step 4: Run** `pnpm --filter web exec vitest run src/mcp` PASS; `pnpm --filter web test` (whole web suite) PASS; type-check; lint.
- [ ] **Step 5: Commit**: `feat(mcp): esite_db_rpc; server instructions; rbac-matrix, runbook and spec notes for the open-database tools`

---

### Task 8: Local smoke as `rbac-test` and the pre-apply fail-closed check

**Files:**
- Create: `docs/mcp/smoke-2026-11-03-open-database.md` (the record)
- Modify: `docs/mcp/enable-oauth.md` §6 (time cap line) — only if measurable; otherwise mark owed.

**Procedure** (the migration is NOT applied on production until the merge's deploy, so previews, `esite_db_sql` and `esite_db_schemas` must fail closed here, and the positive smoke of those three is owed to the post-apply check):
- [ ] **Step 1: Build and start** the dev server from the worktree: `pnpm --filter web build` then the launch entry `mcp-slice-1-web` (port 3200) through the preview tool, `MCP_ENABLED=true`.
- [ ] **Step 2: Mint a bearer** for `rbac-test@e-site.live` (GoTrue password grant as in slice 1's smoke; password in CLAUDE.md "Key gotchas"; never email the fixture). `POST /api/mcp` `initialize` → 200; `tools/list` → 11 tools.
- [ ] **Step 3: Positive reads:** `esite_db_select { schema:'inspections', table:'responses', filters:[{column:'inspection_id',op:'eq',value:<a KINGSWALK inspection id>}], limit:5 }` → rows with `value_text`; `esite_db_select { schema:'projects', table:'boq_items', columns:['id','rate'], limit:3 }` → `rate: null`, `maskedColumns:['rate']`; `esite_db_select` with `order:[{column:'rate'}]` → masked-column sentence; `esite_db_select { schema:'auth', … }` → unknown-schema sentence.
- [ ] **Step 4: Refusals:** `esite_db_sql` → the role sentence (contractor); `esite_db_insert { schema:'projects', table:'project_members', rows:[{}] }` → denylist sentence; `esite_db_update` without filters → filter sentence.
- [ ] **Step 5: Fail-closed pre-apply:** `esite_db_schemas {}` and an `esite_db_update` preview on a writable table → the slice-1 unexpected sentence or a `Database error 42883/42P01` refusal (functions and table absent); record which.
- [ ] **Step 6: Write cycle on a table RLS lets a contractor write:** pick a KINGSWALK diary entry table or `field.snags` (the implementer confirms with a direct select that the fixture may write there); `esite_db_insert` one throwaway row → `ids` returned; `esite_db_select` it back; delete it with a direct `esite_db_delete`… (previews unavailable pre-apply) — so remove it with the fixture's own client over PostgREST; confirm zero residue by selecting again.
- [ ] **Step 7: Audit read-back:** as the fixture, `select tool, kind, outcome, refusal from public.mcp_tool_calls where user_id = '018f2d31-…' order by created_at desc limit 20` (Management API) → one row per call above, kinds `read`/`write`/`preview` as expected, refusal sentences verbatim.
- [ ] **Step 8: Record** everything in the smoke doc with request/response excerpts; list the three owed post-apply checks (schemas, previews end to end, SQL + time cap). Commit: `docs(mcp): local smoke for the open-database tools (pre-apply)`.

---

## Post-merge (controller, not a task)

After the PR merges: watch `Deploy DB Migrations` green **and** read back `mcp_previews`, `mcp_run_select`, `mcp_catalog` and the ledger row; then run the three owed checks against production as `rbac-test` (schemas; a preview → confirm cycle on a writable row; `mcp_run_select` time cap over PostgREST) and the owner walks the meter-serial query through Claude Desktop with `esite_db_sql`.

## Self-review notes

- **Spec coverage:** §4 tools → Tasks 5, 6, 7; §4.1 functions and §4.2 table → Task 4; §5 denylist → Task 2, mask → Task 3, SQL gate → Task 5, write rules → Task 6, audit labels → Task 5 (`project-id.ts`); §6 `kindOf`/`ids` cap/contract test → Task 1, docs → Task 7; §7 unit/contract/migration/smoke → Tasks 2–6, 4, 8; owner walk → post-merge.
- **Rulings this plan makes beyond the spec** (each marked inline): unknown-schema and empty-patch sentences; database errors surfaced verbatim as refusals; filters/orders on masked columns allowed only to org-level cost roles; rpc results masked by name union and org role; count-only previews for tables without `id`; `mcp_catalog` compared to PostgREST config by hand, not by `@verify`.
- **Type consistency:** `Filter`, `applyFilters`, `filterColumns`, `assertFilterableColumns`, `maskRows`, `maskRpcResult`, `createPreview`/`consumePreview`, `projectIdFromFilters`/`projectIdFromRows` are named identically across Tasks 2–7.
