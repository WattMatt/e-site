# Enabling the E-Site MCP server (OAuth 2.1)

Design: `docs/superpowers/specs/2026-10-27-esite-mcp-server-design.md`. Slice 1 is read-only: `esite_whoami`, `esite_projects_list`, `esite_project_get`, `esite_project_history`.

Enabling the Supabase OAuth server does **not** change password or magic-link sign-in. It affects only OAuth clients (Claude Desktop, Claude Code) that complete the consent page.

Step 0 first, then two switches, in this order. Nothing is reachable until both switches are on.

## 0. Confirm the database objects exist (before any switch)

The server rate-checks and audits every call through two functions and a table that migration `00257` creates. Merge the PR, confirm the `Deploy DB Migrations` workflow is green, then read the objects back with the Management API (token as in step 1):

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d '{"query":"select proname from pg_proc where proname in ('"'"'mcp_rate_status'"'"','"'"'record_mcp_call'"'"')"}'
curl -sS -X POST "https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d '{"query":"select version from supabase_migrations.schema_migrations where version = '"'"'00257'"'"'"}'
```

Expect two rows from the first (`mcp_rate_status`, `record_mcp_call`) and one from the second (`00257`). Only then set `MCP_ENABLED`. A green workflow alone is not evidence the migration ran.

With the objects absent, `initialize` and `tools/list` still answer 200, but every `tools/call` answers "Something went wrong on the server; the error was logged." because the rate check fails closed. That looks like a broken server, not a missing migration.

## 1. Turn on the Supabase OAuth server

Project ref: `cbskbnvvgcybmfikxgky`. The Management API token lives in the macOS keychain; never paste or commit its value.

```bash
RAW=$(security find-generic-password -s "Supabase CLI" -w)
# strip the "go-keyring-base64:" prefix and base64-decode to get the sbp_* token
PAT=$(printf '%s' "${RAW#go-keyring-base64:}" | base64 -d)

curl -sS -X PATCH "https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/config/auth" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d '{
    "oauth_server_enabled": true,
    "oauth_server_authorization_path": "/oauth/consent",
    "oauth_server_allow_dynamic_registration": true
  }'
```

Read the three keys back, twice (a single-field PATCH to the auth config has wiped unrelated blocks before, and one read can be served stale):

```bash
for i in 1 2; do
  curl -sS "https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/config/auth" \
    -H "Authorization: Bearer $PAT" \
  | jq '{oauth_server_enabled, oauth_server_authorization_path, oauth_server_allow_dynamic_registration}'
done
```

Both reads must show `true`, `"/oauth/consent"`, `true`. Dynamic registration stays on because Claude's clients need it; the consent page is the human check on every new client.

## 2. Turn on the route

Set `MCP_ENABLED=true` in Vercel **Production** (and **Preview** only if a preview is to be tested), then redeploy.

`MCP_ENABLED` is the kill switch. It gates both `/api/mcp` and `/.well-known/oauth-protected-resource`; unless it is exactly `'true'`, both answer 404. Both paths are exempt from the session middleware (they authenticate by bearer token or are public metadata); `/oauth/consent` is not exempt and is an ordinary signed-in page.

## 3. Connect a client

- **Claude Desktop:** Settings → Connectors → Add custom connector, URL `https://www.e-site.live/api/mcp`.
- **Claude Code:** `claude mcp add --transport http e-site https://www.e-site.live/api/mcp`, then `/mcp` and choose authenticate.

The client opens a browser. Sign in to E-Site if asked, check the client name and redirect URI on the consent page, and press Approve. Only E-Site team members (an active non-client-viewer organisation membership) can connect; anyone else sees the sentence "Claude access is for E-Site team members; ask your project owner." The consent page only declines early; the control is `/api/mcp`, which refuses a client_viewer-only (or membership-less) token on every call.

## 4. Verification walk (design section 8)

1. Add the connector in Claude Desktop, consent as an owner or admin.
2. Call `esite_whoami`: it names you and lists your memberships. Then confirm the audit row landed: `select user_id, tool, outcome from public.mcp_tool_calls order by created_at desc limit 1` shows your `user_id` with `tool = 'esite_whoami'`.
3. Call `esite_projects_list`: you see the same projects the web app shows you.
4. Call `esite_project_get` on a project, and `esite_project_history`.
5. Repeat step 4 as a contractor or inspector: `esite_project_get` must show no contract block. An owner, admin or project_manager (the COST_VIEW roles) sees it.
6. Add the same server in Claude Code and repeat `esite_whoami`.
7. Negative checks: `curl -i https://www.e-site.live/api/mcp` without a token returns 401 with a `WWW-Authenticate: Bearer resource_metadata=...` header; a client_viewer-only account is declined on the consent page, and a token minted for one anyway is refused by `/api/mcp` on every call.

## 5. Rollback

Set `MCP_ENABLED=false` (or remove it) in Vercel and redeploy: `/api/mcp` and the metadata route answer 404 at once. The Supabase OAuth switch can stay on; it only affects OAuth clients and nothing else signs in through it. 

Slice 1 has no per-client revoke, and token expiry is not a revoke: refresh tokens renew access. A person is refused only when they lose every active non-client_viewer organisation membership (deactivate the membership), or when the owner revokes the client's grant in Supabase (auth-js has `oauth.revokeGrant`; it is not wired into E-Site in slice 1).

## 6. What Claude can do

Once connected, Claude reads every table the signed-in person can see, in the 14 exposed schemas (`public, projects, inspections, field, tenants, suppliers, billing, marketplace, cable_schedule, structure, gcr, solar, tariffs, whatsapp`), and writes to most of them. Every call runs as that person through their own session: row-level security and the site scope decide which rows exist for them, and no tool uses the service key. Design: `docs/superpowers/specs/2026-11-03-esite-mcp-open-database-design.md`; role table: `docs/rbac-matrix.md` → "MCP tools". The database objects behind it are in migration `00259_mcp_open_database.sql` (`public.mcp_previews`, `public.mcp_run_select`, `public.mcp_catalog`); the number is re-checked against the ledger, `origin/main` and open PR filenames before merge.

> **Where inspection answers live (added 2026-11-04 after the first owner query missed them).** An answer is a row in `inspections.responses` keyed by a text `field_id`, with the value in `value_text` / `value_number` / `value_bool` / `pass_state`. A repeating group is written `group[N].field` — the meter table on the Electrical Meter Inspection Report is `sub_feeds[N].feed_label / .meter_serial / .ct_ratio / .breaker_size` — so match with `field_id like 'sub_feeds[%'` and pivot by the suffix; join `inspections.inspections` for `project_id`, `target_label` (the board) and `template_id`, and read labels from `inspections.templates.schema_json`. Site forms use the same shape in `field.form_responses`. The server instructions carry this hint so a connected model finds it without the runbook.

- **`esite_whoami`, `esite_projects_list`, `esite_project_get`, `esite_project_history`:** the four slice-1 reads (section 4).
- **`esite_db_schemas`:** lists the exposed schemas, or one schema's tables and columns as the person may see them. Claude calls it before reading.
- **`esite_db_select`:** reads rows from any exposed `schema.table` with filters, ordering and paging (limit 1 to 1000, default 100; `nextOffset` continues). `count` is exact up to 1000 rows and the planner's estimate above that, so a large count is approximate. Cost columns come back `null` for roles that may not see them, judged per row, and `maskedColumns` names them.
- **`esite_db_sql`:** one read-only SELECT (or `WITH ... SELECT`); at most 1000 rows, `truncated` says when there were more. Only for people who hold owner, admin or project_manager in every organisation they belong to AND on every project they are a member of (an organisation-level project manager who is a contractor on one project is refused); everyone else gets `SQL is for owners, admins and project managers; use esite_db_select.` The database function `public.mcp_run_select` refuses them again, so calling it directly over PostgREST gets nothing. The rows are **not cost-masked**: the role rule is the only thing that decides who sees cost figures here.
- **`esite_db_insert`:** inserts 1 to 500 rows; returns `inserted`, `ids` and the stored rows (masked like a read).
- **`esite_db_update`, `esite_db_delete`:** need at least one filter and always go through a preview (below).
- **`esite_db_rpc`:** calls any function in an exposed schema as the person (a POST, so it may write). `readOnly: true` only changes how the call is audited (kind `read`) and rate-limited; it is Claude's statement of intent, not a guarantee, and the database does not stop the function writing. The result is not masked per row: any key named like a cost column is `null` unless the person passes the same every-organisation-and-every-project rule as `esite_db_sql`.

**How a write works.** `esite_db_update` and `esite_db_delete` first return a preview and change nothing: `previewId`, `wouldAffect` (a match of more than 1000 rows is refused: `That would touch more than 1000 rows; narrow the filter.`), a `sample` of at most 50 rows and `expiresAt`. To commit, Claude calls the same tool again with that `previewId` and the same schema, table, filters and patch, within 24 hours, as the same person; a preview works once. The commit re-selects the matching rows and refuses with `That preview has expired or does not match; run the preview again.` if the ids or the count changed since the preview. Previews are rows in `public.mcp_previews`, visible only to their owner; a person's previews older than 7 days are deleted by their next preview.

**What cannot be written.** A fixed list of tables is managed in the app and refused with `This table is managed in the app, not through Claude.`: `public.user_organisations`, `projects.project_members`, `public.profiles`, `public.metric_accounts` (a writable view over `profiles`), every `billing.*` table, `marketplace.paystack_subaccounts`, `marketplace.orders`, `marketplace.order_items`, `marketplace.commission_records`, `marketplace.commission_payouts`, the three `projects.tender_submission*` tables (sealed bids), `structure.scope_item_types`, `public.mcp_tool_calls`, `public.mcp_previews`, `inspections.templates` and `field.form_templates`. The list is `apps/web/src/mcp/tools/db/denylist.ts` and covers writes only; reads are never denylisted (RLS decides). It does not cover `esite_db_rpc`: a function that writes is only as safe as the function.

**The cost mask.** In rows from `esite_db_select`, `esite_db_insert`, `esite_db_update` and `esite_db_delete`, money columns come back `null` unless the person is an owner, admin or project_manager for the row (by project role where the table has a project, else by the row's organisation, else by the rule below). `esite_db_sql` results, `esite_db_rpc` results and filtering or ordering on a money column are **not masked per row**: they need owner, admin or project_manager in every active organisation membership AND every active project membership. The list of masked columns is generated from the migrations (`pnpm --filter web exec tsx scripts/mcp/generate-masked-columns.ts`, output `apps/web/src/mcp/tools/db/masked-columns.ts`) and a contract test fails the build when a new money-named numeric column appears without a decision.

**Reading the audit.** Every call, refused ones included, is a row in `public.mcp_tool_calls`:

```sql
select tool, kind, outcome, refusal, created_at
from public.mcp_tool_calls
order by created_at desc
limit 50;
```

`kind` is `read`, `preview` (an update or delete without a `previewId`) or `write` (with one, or any insert; an `esite_db_rpc` call is `read` when it says `readOnly`). `result_ids` holds the ids a call returned or wrote, capped at 200. The rate limit is unchanged: 120 calls a minute, of which at most 20 may be previews or writes.

**Time cap.** `esite_db_sql` is cut off by the `authenticated` role's `statement_timeout`, which reads 8 s in `rolconfig` (2026-11-03). That figure comes from the catalog; the live measurement over PostgREST is owed to the post-apply smoke (record it here once measured).

**Known limits.**

- Money inside JSON or text columns is not masked (owner decision). A cost figure typed into a notes column, or held in a JSONB column, is returned as stored.
- Between the preview's re-check and the write there is a gap: a row that starts matching in that moment is written. Nothing wraps the two in one transaction.
- `esite_db_sql` refuses any reference to the `net` schema only as a text check. pg_net's `net._http_response` and `net.http_request_queue` are granted ALL to PUBLIC by `supabase_admin`, and `postgres` cannot revoke that grant. Owner follow-up: raise the grant with Supabase.
