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
