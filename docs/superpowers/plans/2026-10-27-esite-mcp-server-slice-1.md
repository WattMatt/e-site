# E-Site MCP Server, Slice 1 (auth, transport, audit, discovery tools) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude client (Desktop or Code) can connect to `https://www.e-site.live/api/mcp`, sign in as an E-Site team member through Supabase's OAuth 2.1 server, and call four discovery tools that see exactly what that person sees, with every call audited.

**Architecture:** A stateless streamable-HTTP MCP route inside the Next.js app. A bearer token (Supabase user JWT) is verified per request and bound into a Supabase client; a request-scoped override in `createClient()` makes every existing loader and action use that client instead of cookies. Tools call existing loaders. An audit RPC (the only service-key use in the module) records each call and enforces the rate limit. The consent page completes the OAuth flow.

**Tech Stack:** Next.js 15 app router, `@modelcontextprotocol/sdk` 1.32.x (`WebStandardStreamableHTTPServerTransport`), Zod 3.25, `@supabase/supabase-js` 2.103 (`auth.oauth.*`), Node `AsyncLocalStorage`, Vitest (jsdom, `server-only` stubbed), Postgres migration with `@verify`.

**Spec:** `docs/superpowers/specs/2026-10-27-esite-mcp-server-design.md` (approved 2026-10-27). The tenant-schedule tool contract referenced by later slices is `docs/superpowers/specs/2026-10-21-tenant-schedule-from-dropbox-design.md`.

## Global Constraints

- Work from a fresh worktree on `origin/main` (`a3746e8a` or later) on the SSD: `/Volumes/Extreme SSD/DEVELOPER/worktrees/esite-mcp-slice-1`, branch `feat/mcp-server-slice-1`. The canonical `esite/` checkout is on an old branch; do not use it. `pnpm install` inside the worktree (never symlink another tree's `node_modules`).
- Node `>=22 <25`; `zod@3.25.76` is what resolves; install `@modelcontextprotocol/sdk@^1.32.2` only (never `@modelcontextprotocol/server`, never `mcp-handler`).
- No service key inside `apps/web/src/mcp/**` except `apps/web/src/mcp/audit.ts`, which is declared in `apps/web/src/lib/auth/service-client-gates.contract.test.ts` `DECLARED` with the reason `'MCP audit RPC; acts only after the bearer user was verified'`.
- Tool names are `esite_<module>_<verb>`; responses carry `content: [{ type: 'text', text: JSON.stringify(out) }]` and `structuredContent: out`; refusals are tool errors (`isError: true`) carrying the gate's own sentence.
- Refusal sentences, verbatim: connect rule `Claude access is for E-Site team members; ask your project owner.`; aal `Finish the two-factor check in the browser, then reconnect.`; rate limit `Slow down; try again in a minute.`; redirect caught `Sign in required.`; unexpected `Something went wrong on the server; the error was logged.`
- Every migration ≥ 00185 carries a `-- @verify:begin … end` block; the number is claimed at apply time (head `00256` on 2026-10-27; re-check the ledger, `origin/main` and open-PR filenames); dry-run with `scripts/db/dry-run-migration.sh` and the sweep `scripts/db/emit-verify-sweep.ts` before pushing. Run all three suites on migration work: `pnpm --filter web test`, `pnpm --filter @esite/shared test`, `pnpm --filter @esite/db test:ci`.
- The repo is public: no real project data, tokens or client ids in fixtures or docs.
- Commit after every task; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `docs/rbac-matrix.md` gains a section in the same PR as the route (Task 10).

## Review Focus

1. A token whose user has been removed from every org since consent: `auth.getUser()` still succeeds; the connect rule must refuse on every call, not only at consent (Task 4 tests it).
2. A POST whose body is a JSON-RPC notification or an `initialize` with no `Accept: text/event-stream`: the transport must answer, never hang; `enableJsonResponse: true` is set and tested (Task 5).
3. A `projectId` the person cannot see: tools return the gate's sentence as a tool error, never a stack, never a different status than an invisible project in the browser (Task 8).
4. A `limit` of 10,000 or 0: clamped to 1–200 (Task 8).
5. A bearer that is valid but the kill switch is off, or the route is hit with GET: 404 and 405 respectively, and no audit row (Task 5).

---

### Task 1: Worktree, dependencies, specs committed

**Files:**
- Create: worktree `/Volumes/Extreme SSD/DEVELOPER/worktrees/esite-mcp-slice-1` on branch `feat/mcp-server-slice-1`
- Modify: `apps/web/package.json` (add `@modelcontextprotocol/sdk`)
- Create: `docs/superpowers/specs/2026-10-27-esite-mcp-server-design.md`, `docs/superpowers/specs/2026-10-21-tenant-schedule-from-dropbox-design.md`, `docs/superpowers/plans/2026-10-27-esite-mcp-server-slice-1.md` (copied from `/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/esite/docs/superpowers/…`, where they sit untracked)

**Interfaces:**
- Produces: a buildable tree with the SDK resolvable from `apps/web`.

- [ ] **Step 1: Create the worktree and branch**

Run: `cd "/Volumes/Extreme SSD/DEVELOPER/APPS/ESITE.V1/esite" && git fetch -q origin && git worktree add -b feat/mcp-server-slice-1 "/Volumes/Extreme SSD/DEVELOPER/worktrees/esite-mcp-slice-1" origin/main`
Expected: the worktree exists; `git -C … log --oneline -1` shows `a3746e8a` or newer.

- [ ] **Step 2: Install and add the SDK**

Run (in the worktree): `pnpm install && pnpm --filter web add @modelcontextprotocol/sdk@^1.32.2`
Expected: `apps/web/package.json` lists the SDK; `pnpm-lock.yaml` resolves `zod@3.25.76` unchanged (no zod 4 pulled in: `grep -c "zod@4" pnpm-lock.yaml` prints `0`).

- [ ] **Step 3: Copy the three documents in and confirm the tree builds**

Run: `pnpm --filter web type-check`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml docs/superpowers/specs/2026-10-27-esite-mcp-server-design.md docs/superpowers/specs/2026-10-21-tenant-schedule-from-dropbox-design.md docs/superpowers/plans/2026-10-27-esite-mcp-server-slice-1.md
git commit -m "chore(mcp): add MCP SDK and the MCP server design, plan and tenant-schedule contract"
```

---

### Task 2: JWT claims helper and MFA-factor helper lifted out of the middleware

**Files:**
- Create: `apps/web/src/lib/supabase/jwt.ts`, `apps/web/src/lib/auth/has-verified-mfa-factor.ts`
- Modify: `apps/web/src/lib/supabase/middleware.ts:1-10,64-76`, `apps/web/src/middleware.ts:159-175` (replace the inline `hasVerifiedMfaFactor` with the import), `apps/web/src/lib/auth/service-client-gates.contract.test.ts:24` (`DECLARED` entry for the new helper: `'lib/auth/has-verified-mfa-factor.ts': 'admin users read for the MFA gate; caller already verified the user'`)
- Test: `apps/web/src/lib/supabase/jwt.test.ts`

**Interfaces:**
- Produces: `decodeAccessTokenClaims(token: string): JwtClaims | null` and `type JwtClaims = { sub?: string; email?: string; aal?: 'aal1' | 'aal2'; amr?: { method: string; timestamp: number }[]; client_id?: string; exp?: number }` (moved from `lib/supabase/middleware.ts`, extended with `client_id`); `hasVerifiedMfaFactor(userId: string): Promise<boolean>` (moved from `middleware.ts`, same body).

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/supabase/jwt.test.ts
import { decodeAccessTokenClaims } from './jwt'
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
it('decodes aal and client_id from the payload', () => {
  const tok = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u1', aal: 'aal1', client_id: 'c9' })}.sig`
  expect(decodeAccessTokenClaims(tok)).toMatchObject({ sub: 'u1', aal: 'aal1', client_id: 'c9' })
})
it('returns null for a malformed token', () => {
  expect(decodeAccessTokenClaims('not.a.jwt.at.all')).toBeNull()
  expect(decodeAccessTokenClaims('')).toBeNull()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/supabase/jwt.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Move the decoder into `jwt.ts` and the MFA helper into `has-verified-mfa-factor.ts`; point both middleware files at them**

The middleware behaviour must not change: the existing middleware tests (if any) and `pnpm --filter web test` are the oracle.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter web exec vitest run src/lib/supabase/jwt.test.ts src/lib/auth/service-client-gates.contract.test.ts && pnpm --filter web type-check`
Expected: PASS; the gates test passes with the new `DECLARED` entry.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/supabase/jwt.ts apps/web/src/lib/supabase/jwt.test.ts apps/web/src/lib/auth/has-verified-mfa-factor.ts apps/web/src/lib/supabase/middleware.ts apps/web/src/middleware.ts apps/web/src/lib/auth/service-client-gates.contract.test.ts
git commit -m "refactor(auth): lift JWT claim decoding and the MFA-factor check into lib"
```

---

### Task 3: Request-scoped bearer override in `createClient()`

**Files:**
- Create: `apps/web/src/lib/supabase/request-auth.ts`
- Modify: `apps/web/src/lib/supabase/server.ts:12-35`
- Test: `apps/web/src/lib/supabase/request-auth.test.ts`

**Interfaces:**
- Consumes: Task 2 `JwtClaims` from `@/lib/supabase/jwt`.
- Produces: `runWithBearer<T>(ctx: BearerContext, fn: () => Promise<T>): Promise<T>` and `getBearerContext(): BearerContext | null` where `BearerContext = { accessToken: string; user: User; claims: JwtClaims }` (`User` from `@supabase/supabase-js`). `createClient()` is unchanged in signature; under a bearer context it returns a client bound to the token and never reads cookies.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/supabase/request-auth.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest'
const cookies = vi.fn()
vi.mock('next/headers', () => ({ cookies }))
const createSupabaseClient = vi.fn(() => ({ tag: 'bearer-client' }))
const createServerClient = vi.fn(() => ({ tag: 'cookie-client' }))
vi.mock('@supabase/supabase-js', () => ({ createClient: createSupabaseClient }))
vi.mock('@supabase/ssr', () => ({ createServerClient }))
import { createClient } from './server'
import { runWithBearer, getBearerContext } from './request-auth'

describe('createClient under a bearer context', () => {
  beforeEach(() => { cookies.mockReset(); createSupabaseClient.mockClear(); createServerClient.mockClear() })
  it('binds the bearer and never touches cookies', async () => {
    const ctx = { accessToken: 'tok', user: { id: 'u1' } as never, claims: { sub: 'u1', aal: 'aal1' } as never }
    const client = await runWithBearer(ctx, () => createClient())
    expect(client).toEqual({ tag: 'bearer-client' })
    expect(cookies).not.toHaveBeenCalled()
    expect(createSupabaseClient).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
      global: { headers: { Authorization: 'Bearer tok' } },
      auth: { persistSession: false, autoRefreshToken: false },
    }))
  })
  it('outside the context behaves as before', async () => {
    cookies.mockResolvedValue({ getAll: () => [], set: () => {} })
    const client = await createClient()
    expect(client).toEqual({ tag: 'cookie-client' })
    expect(cookies).toHaveBeenCalledTimes(1)
    expect(getBearerContext()).toBeNull()
  })
  it('does not leak across concurrent requests', async () => {
    const a = runWithBearer({ accessToken: 'A', user: { id: 'a' } as never, claims: {} as never }, async () => { await new Promise(r => setTimeout(r, 5)); return getBearerContext()?.accessToken })
    const b = runWithBearer({ accessToken: 'B', user: { id: 'b' } as never, claims: {} as never }, async () => getBearerContext()?.accessToken)
    expect(await Promise.all([a, b])).toEqual(['A', 'B'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/supabase/request-auth.test.ts`
Expected: FAIL, `Cannot find module './request-auth'`.

- [ ] **Step 3: Implement `request-auth.ts`**

`AsyncLocalStorage<BearerContext>` from `node:async_hooks`; `runWithBearer` = `store.run(ctx, fn)`; `getBearerContext` = `store.getStore() ?? null`. Add `import 'server-only'` at the top.

- [ ] **Step 4: Modify `createClient()` in `server.ts`**

At the top of `createClient()`: `const bearer = getBearerContext(); if (bearer) return createSupabaseClient<Database>(url, anonKey, { global: { headers: { Authorization: \`Bearer ${bearer.accessToken}\` } }, auth: { persistSession: false, autoRefreshToken: false } })`. The cookie branch is untouched. Keep the existing `as unknown as SupabaseClient<Database>` cast style for the return.

- [ ] **Step 5: Run the test and the whole web suite**

Run: `pnpm --filter web exec vitest run src/lib/supabase/request-auth.test.ts && pnpm --filter web test`
Expected: PASS; the full suite is green (no existing test mocks `createClient` in a way the early return breaks; if one does, fix that test's mock to include `getBearerContext` returning null).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/supabase/request-auth.ts apps/web/src/lib/supabase/request-auth.test.ts apps/web/src/lib/supabase/server.ts
git commit -m "feat(auth): request-scoped bearer override for createClient()"
```

---

### Task 4: Bearer authentication and the connect rule

**Files:**
- Create: `apps/web/src/mcp/auth.ts`
- Test: `apps/web/src/mcp/auth.test.ts`

**Interfaces:**
- Consumes: Task 3 `BearerContext`, Task 2 `decodeAccessTokenClaims`, `hasVerifiedMfaFactor`.
- Produces: `authenticateMcpRequest(request: Request): Promise<McpAuthResult>` where `McpAuthResult = { ok: true; ctx: BearerContext; memberships: { organisationId: string; role: OrgRole }[] } | { ok: false; status: 401 | 403; sentence: string }`. Also `CONNECT_REFUSAL`, `AAL_REFUSAL` constants with the Global Constraints sentences.

Rules: no `Authorization: Bearer …` header → 401; `auth.getUser()` error → 401; claims undecodable → 401; `aal === 'aal1'` and `hasVerifiedMfaFactor(user.id)` → 403 `AAL_REFUSAL`; memberships = the user's active `public.user_organisations` rows read **as the user** (`createSupabaseClient` with the bearer, same options as Task 2); none, or every role `client_viewer` → 403 `CONNECT_REFUSAL`. A tender-only account has no membership, so it is refused by the same rule.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/mcp/auth.test.ts
import { vi, it, expect, beforeEach } from 'vitest'
const getUser = vi.fn(); const from = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser }, from }) }))
const hasVerifiedMfaFactor = vi.fn()
vi.mock('@/lib/auth/has-verified-mfa-factor', () => ({ hasVerifiedMfaFactor }))
import { authenticateMcpRequest, CONNECT_REFUSAL, AAL_REFUSAL } from './auth'
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = (claims: object) => `${b64({})}.${b64(claims)}.s`
const req = (auth?: string) => new Request('https://x/api/mcp', { method: 'POST', headers: auth ? { Authorization: auth } : {} })
const rows = (r: { organisation_id: string; role: string }[]) => from.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: r, error: null }) }) }) })
beforeEach(() => { getUser.mockReset(); from.mockReset(); hasVerifiedMfaFactor.mockResolvedValue(false) })

it('401 without a bearer', async () => { expect(await authenticateMcpRequest(req())).toMatchObject({ ok: false, status: 401 }) })
it('401 when getUser fails', async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } })
  expect(await authenticateMcpRequest(req(`Bearer ${token({ sub: 'u1' })}`))).toMatchObject({ ok: false, status: 401 })
})
it('refuses a client_viewer-only user with the connect sentence', async () => {
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }); rows([{ organisation_id: 'o1', role: 'client_viewer' }])
  expect(await authenticateMcpRequest(req(`Bearer ${token({ sub: 'u1', aal: 'aal1' })}`))).toEqual({ ok: false, status: 403, sentence: CONNECT_REFUSAL })
})
it('refuses a user with no org (tender-only)', async () => {
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }); rows([])
  expect(await authenticateMcpRequest(req(`Bearer ${token({ sub: 'u1' })}`))).toMatchObject({ ok: false, sentence: CONNECT_REFUSAL })
})
it('refuses aal1 when a factor is verified', async () => {
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }); rows([{ organisation_id: 'o1', role: 'contractor' }]); hasVerifiedMfaFactor.mockResolvedValue(true)
  expect(await authenticateMcpRequest(req(`Bearer ${token({ sub: 'u1', aal: 'aal1' })}`))).toEqual({ ok: false, status: 403, sentence: AAL_REFUSAL })
})
it('admits a contractor and returns memberships and client_id', async () => {
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }); rows([{ organisation_id: 'o1', role: 'contractor' }, { organisation_id: 'o2', role: 'client_viewer' }])
  const r = await authenticateMcpRequest(req(`Bearer ${token({ sub: 'u1', aal: 'aal1', client_id: 'c9' })}`))
  expect(r).toMatchObject({ ok: true, memberships: [{ organisationId: 'o1', role: 'contractor' }, { organisationId: 'o2', role: 'client_viewer' }] })
  expect(r.ok && r.ctx.claims.client_id).toBe('c9')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web exec vitest run src/mcp/auth.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `auth.ts`**

The memberships query: `.from('user_organisations').select('organisation_id, role').eq('user_id', user.id).eq('is_active', true)`.

- [ ] **Step 4: Run the test**

Run: `pnpm --filter web exec vitest run src/mcp/auth.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/mcp/auth.ts apps/web/src/mcp/auth.test.ts
git commit -m "feat(mcp): bearer authentication, aal mirror and the connect rule"
```

---

### Task 5: Audit migration and RPCs

**Files:**
- Create: `apps/edge-functions/supabase/migrations/002NN_mcp_tool_calls.sql` (NN = head + 1 at apply time), `scripts/db/assert-mcp-tool-calls.sql`
- Modify: `packages/shared/src/lib/analytics/product-events.ts:7-46` (append `'mcp_tool_called'` under a `// MCP (002NN).` comment), `scripts/db/assert-site-scope-coverage.sql` (no change expected; the table carries a `site_scope` policy, see below)

**Interfaces:**
- Produces, in SQL:
  - `public.mcp_tool_calls(id uuid pk default gen_random_uuid(), user_id uuid not null, client_id text, organisation_id uuid, project_id uuid null, tool text not null, kind text not null check (kind in ('read','preview','write')), args_digest text not null, outcome text not null check (outcome in ('ok','refused','error')), refusal text, result_ids jsonb, duration_ms integer not null, created_at timestamptz not null default now())`, index `(user_id, created_at desc)`, index `(project_id, created_at desc)`.
  - RLS enabled and forced. Policy `site_scope` RESTRICTIVE FOR ALL: `USING ((user_id = auth.uid() OR public.user_is_org_admin(organisation_id)) AND (project_id IS NULL OR public.user_has_project_access(project_id))) WITH CHECK (false)` — the coverage check requires a RESTRICTIVE ALL policy named `site_scope`. Plus one PERMISSIVE `mcp_tool_calls_select` FOR SELECT with the same USING expression. No write policies: writes happen only through the definer RPC. (If `public.user_is_org_admin(uuid)` does not exist with that signature, use the EXISTS-over-`user_organisations` form from `PROJECTS_SQL` in `packages/db/src/site-scope/fixed.sql.ts:49-57`.)
  - `public.mcp_rate_status(p_user uuid) RETURNS TABLE (calls integer, writes integer)` SECURITY DEFINER, counts rows for `p_user` with `created_at > now() - interval '60 seconds'` (writes = kind in preview/write). EXECUTE revoked from PUBLIC and anon, granted to service_role.
  - `public.record_mcp_call(p_user uuid, p_client text, p_org uuid, p_project uuid, p_tool text, p_kind text, p_args_digest text, p_outcome text, p_refusal text, p_result_ids jsonb, p_duration_ms integer) RETURNS uuid` SECURITY DEFINER, inserts and returns the id. Same grants.
  - `product_events_event_check` re-declared with the full list from `00218_solar_operations.sql:903-939` plus `'mcp_tool_called'`.
- `@verify` block: `-- table: public.mcp_tool_calls`; `-- policy: site_scope ON public.mcp_tool_calls RESTRICTIVE`; `-- policy: mcp_tool_calls_select ON public.mcp_tool_calls PERMISSIVE`; `-- function: public.mcp_rate_status(uuid)`; `-- function: public.record_mcp_call(uuid,text,uuid,uuid,text,text,text,text,text,jsonb,integer)`; `-- anon_execute_absent: public.record_mcp_call(uuid,text,uuid,uuid,text,text,text,text,text,jsonb,integer)`; `-- anon_execute_absent: public.mcp_rate_status(uuid)`; `-- sql: (SELECT pg_get_constraintdef(oid) LIKE '%mcp_tool_called%' FROM pg_constraint WHERE conrelid = 'public.product_events'::regclass AND conname = 'product_events_event_check')`; `-- behaviour: a user reads only their own rows and rows of projects they can access; an org owner/admin reads the org's rows; anon and authenticated cannot insert; proven by scripts/db/assert-mcp-tool-calls.sql`.

- [ ] **Step 1: Write the assertion file first and run it red against a no-op**

`scripts/db/assert-mcp-tool-calls.sql` impersonates (the `set_config('request.jwt.claims', …, true)` pattern; seed claims before the first `SET LOCAL ROLE`, as in `assert-floor-plan-markups-roles.sql`) the `rbac-test` contractor (`018f2d31-bbe8-4cc1-bbdd-63af0187081e`, member of KINGSWALK) and a throwaway admin created inside the transaction: insert rows via the RPC for both; assert the contractor sees exactly their own rows and none for a project they are not on; assert the admin sees the org's rows; assert a direct `INSERT` as `authenticated` fails with 42501; assert `mcp_rate_status` counts 2 after two inserts and 0 for a stranger; assert `anon` cannot execute either function. Every assertion prints `check | ok`.
Run: `scripts/db/dry-run-migration.sh scripts/db/noop.sql scripts/db/assert-mcp-tool-calls.sql`
Expected: every row `ok = false` (table absent), i.e. red first.

- [ ] **Step 2: Write the migration (number claimed now against the ledger, `origin/main` and open PRs)**

- [ ] **Step 3: Dry-run green, then the sweep**

Run: `scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/002NN_mcp_tool_calls.sql scripts/db/assert-mcp-tool-calls.sql`
Expected: all `ok = true`.
Run: `npx tsx scripts/db/emit-verify-sweep.ts apps/edge-functions/supabase/migrations/002NN_mcp_tool_calls.sql`
Expected: every earlier `@verify` directive still passes under the new migration (the count printed equals the count of directives, 0 failures).
Run: `scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/002NN_mcp_tool_calls.sql scripts/db/assert-site-scope-coverage.sql`
Expected: `site_scope present: public.mcp_tool_calls | true`.

- [ ] **Step 4: Mutation checks**

Remove the `site_scope` policy from a scratch copy → the coverage assertion and at least one role assertion go red. Remove `WITH CHECK (false)` and the SELECT policy → the direct-insert assertion stays red only because no permissive INSERT policy exists; note this in the PR.

- [ ] **Step 5: Run the three suites**

Run: `pnpm --filter web test && pnpm --filter @esite/shared test && pnpm --filter @esite/db test:ci`
Expected: all green; `migration-verify-block.contract.test.ts` accepts the block.

- [ ] **Step 6: Commit**

```bash
git add apps/edge-functions/supabase/migrations/002NN_mcp_tool_calls.sql scripts/db/assert-mcp-tool-calls.sql packages/shared/src/lib/analytics/product-events.ts
git commit -m "feat(db): mcp_tool_calls audit table, rate-status and record RPCs, mcp_tool_called event"
```

---

### Task 6: Audit module, rate limit and the tool wrapper

**Files:**
- Create: `apps/web/src/mcp/audit.ts`, `apps/web/src/mcp/define-tool.ts`
- Modify: `apps/web/src/lib/auth/service-client-gates.contract.test.ts:24` (`DECLARED` entry for `mcp/audit.ts`, reason in Global Constraints)
- Test: `apps/web/src/mcp/define-tool.test.ts`

**Interfaces:**
- Consumes: Task 5 RPC names.
- Produces:
  - `rateStatus(userId: string): Promise<{ calls: number; writes: number }>`; `recordToolCall(row: AuditRow): Promise<void>` where `AuditRow = { userId; clientId: string | null; organisationId: string | null; projectId: string | null; tool; kind: 'read' | 'preview' | 'write'; argsDigest; outcome: 'ok' | 'refused' | 'error'; refusal: string | null; resultIds: unknown | null; durationMs }`; `argsDigest(args: unknown): string` (sha256 hex of `JSON.stringify` with sorted keys).
  - `defineTool<I extends ZodRawShape>(def: { name: string; title: string; description: string; kind: 'read' | 'preview' | 'write'; inputSchema: I; projectIdOf?: (args) => string | null; organisationIdOf?: (args) => string | null; handler: (args, ctx: ToolContext) => Promise<unknown> }): RegisteredTool`, `runTool(tool: RegisteredTool, args: unknown, ctx: ToolContext): Promise<CallToolResult>` (the wrapper below, exported so tests call it without a transport), `registerTools(server: McpServer, tools: RegisteredTool[], ctx: ToolContext)`, and `class ToolRefusal extends Error`, where `ToolContext = { client: SupabaseClient<Database>; user: User; claims: JwtClaims; memberships: McpAuthResult['memberships'] }`.
  - The wrapper: checks `rateStatus` before the handler (`calls >= 120`, or `writes >= 20` for preview/write → tool error `Slow down; try again in a minute.`, outcome `refused`); times the handler; a `ToolRefusal` thrown by a handler (`class ToolRefusal extends Error`) → `isError` with its message, outcome `refused`; a thrown `NEXT_REDIRECT` (Next's `isRedirectError`) → `Sign in required.`; any other error → the unexpected sentence, outcome `error`, `console.error('[mcp] <tool> failed', { err: err.name })`; success → `{ content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out }`; always `recordToolCall` and `emitProductEvent({ actorId, projectId, event: 'mcp_tool_called', properties: { tool, kind, outcome }, organisationId })`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/mcp/define-tool.test.ts
import { vi, it, expect, beforeEach } from 'vitest'
const rateStatus = vi.fn(); const recordToolCall = vi.fn()
vi.mock('./audit', () => ({ rateStatus, recordToolCall, argsDigest: () => 'd' }))
const emitProductEvent = vi.fn()
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent }))
import { defineTool, ToolRefusal, runTool } from './define-tool'
import { z } from 'zod'
const ctx = { client: {} as never, user: { id: 'u1' } as never, claims: { client_id: 'c9' }, memberships: [] } as never
beforeEach(() => { rateStatus.mockResolvedValue({ calls: 0, writes: 0 }); recordToolCall.mockReset(); emitProductEvent.mockReset() })

it('returns structuredContent and audits ok', async () => {
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'read', inputSchema: { projectId: z.string() }, projectIdOf: a => a.projectId, handler: async () => ({ x: 1 }) })
  const r = await runTool(t, { projectId: 'p1' }, ctx)
  expect(r).toEqual({ content: [{ type: 'text', text: '{"x":1}' }], structuredContent: { x: 1 } })
  expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ tool: 'esite_t', kind: 'read', outcome: 'ok', projectId: 'p1', clientId: 'c9', argsDigest: 'd' }))
  expect(emitProductEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'mcp_tool_called', properties: { tool: 'esite_t', kind: 'read', outcome: 'ok' } }))
})
it('turns a ToolRefusal into an isError result with the sentence', async () => {
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'read', inputSchema: {}, handler: async () => { throw new ToolRefusal('Project not found') } })
  expect(await runTool(t, {}, ctx)).toEqual({ isError: true, content: [{ type: 'text', text: 'Project not found' }] })
  expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'refused', refusal: 'Project not found' }))
})
it('refuses over the rate limit before running the handler', async () => {
  rateStatus.mockResolvedValue({ calls: 120, writes: 0 }); const handler = vi.fn()
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'read', inputSchema: {}, handler })
  expect(await runTool(t, {}, ctx)).toEqual({ isError: true, content: [{ type: 'text', text: 'Slow down; try again in a minute.' }] })
  expect(handler).not.toHaveBeenCalled()
})
it('applies the write limit to preview tools', async () => {
  rateStatus.mockResolvedValue({ calls: 5, writes: 20 })
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'preview', inputSchema: {}, handler: async () => ({}) })
  expect((await runTool(t, {}, ctx)).isError).toBe(true)
})
it('hides unexpected errors behind the named sentence', async () => {
  const t = defineTool({ name: 'esite_t', title: 't', description: 'd', kind: 'read', inputSchema: {}, handler: async () => { throw new Error('secret detail') } })
  const r = await runTool(t, {}, ctx)
  expect(r.content[0].text).toBe('Something went wrong on the server; the error was logged.')
  expect(JSON.stringify(r)).not.toContain('secret detail')
  expect(recordToolCall).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error' }))
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web exec vitest run src/mcp/define-tool.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `audit.ts` (service client → the two RPCs; `import 'server-only'`) and `define-tool.ts` (`defineTool`, `runTool`, `registerTools`, `ToolRefusal`)**

`registerTools` calls `server.registerTool(def.name, { title, description, inputSchema }, (args) => runTool(tool, args, ctx))`.

- [ ] **Step 4: Run the tests and the gates contract test**

Run: `pnpm --filter web exec vitest run src/mcp/define-tool.test.ts src/lib/auth/service-client-gates.contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/mcp/audit.ts apps/web/src/mcp/define-tool.ts apps/web/src/mcp/define-tool.test.ts apps/web/src/lib/auth/service-client-gates.contract.test.ts
git commit -m "feat(mcp): audit, rate limit and the tool wrapper"
```

---

### Task 7: The MCP route, server factory, protected-resource metadata, middleware and kill switch

**Files:**
- Create: `apps/web/src/mcp/server.ts`, `apps/web/src/app/api/mcp/route.ts`, `apps/web/src/app/.well-known/oauth-protected-resource/[[...path]]/route.ts`, `apps/web/src/mcp/metadata.ts`
- Modify: `apps/web/src/middleware.ts:91` (`SELF_AUTH_PATHS` gains `'/api/mcp'` and `'/.well-known/oauth-protected-resource'`), `apps/web/.env.example` (append `MCP_ENABLED=false` with a one-line comment), `apps/web/src/lib/safe-next.ts:30-48` (append `'/oauth'`)
- Test: `apps/web/src/mcp/metadata.test.ts`, `apps/web/src/app/api/mcp/route.test.ts`, `apps/web/src/lib/safe-next.test.ts` (one added case)

**Interfaces:**
- Consumes: Task 4 `authenticateMcpRequest`, Task 3 `runWithBearer`, Task 6 `registerTools`. Inside `runWithBearer` the route calls `createClient()` (now bearer-bound) once and builds `toolCtx = { client, user: ctx.user, claims: ctx.claims, memberships }`.
- Produces:
  - `createEsiteServer(ctx: ToolContext): McpServer` in `server.ts`: `new McpServer({ name: 'e-site', version: process.env.npm_package_version ?? '0.0.0' }, { instructions: INSTRUCTIONS })` with `INSTRUCTIONS` = `'Every tool acts as the signed-in E-Site user. Preview tools write nothing; commit tools need a previewId from the same person within 24 hours. Call esite_whoami first to learn your projects and roles.'`, then `registerTools(server, ALL_TOOLS, ctx)` where `ALL_TOOLS` is imported from `./tools/index.ts` (Task 8).
  - `protectedResourceMetadata(): { resource: string; authorization_servers: string[]; bearer_methods_supported: ['header']; scopes_supported: ['openid','email','profile'] }` in `metadata.ts`, using `NEXT_PUBLIC_SITE_URL` + `/api/mcp` and `NEXT_PUBLIC_SUPABASE_URL` + `/auth/v1`; `unauthorizedResponse(status: 401 | 403, sentence: string): Response` with header `WWW-Authenticate: Bearer realm="e-site", resource_metadata="<site>/.well-known/oauth-protected-resource/api/mcp"` and a JSON body `{ error: sentence }`.
  - Route `POST /api/mcp`: `export const runtime = 'nodejs'`, `export const maxDuration = 300`; if `process.env.MCP_ENABLED !== 'true'` → 404; `authenticateMcpRequest` → on failure `unauthorizedResponse`; else `runWithBearer(ctx, async () => { const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true }); const server = createEsiteServer(toolCtx); await server.connect(transport); return transport.handleRequest(request) })`. `GET` and `DELETE` export handlers returning 405.
  - Metadata route: `GET` → `Response.json(protectedResourceMetadata())` for both `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp`; 404 for any other suffix; 404 when `MCP_ENABLED !== 'true'`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/mcp/metadata.test.ts
import { protectedResourceMetadata, unauthorizedResponse } from './metadata'
it('names the resource and the Supabase authorization server', () => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.e-site.live'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://ref.supabase.co'
  expect(protectedResourceMetadata()).toEqual({ resource: 'https://www.e-site.live/api/mcp', authorization_servers: ['https://ref.supabase.co/auth/v1'], bearer_methods_supported: ['header'], scopes_supported: ['openid', 'email', 'profile'] })
})
it('challenges with the metadata URL', async () => {
  const r = unauthorizedResponse(401, 'Sign in required.')
  expect(r.status).toBe(401)
  expect(r.headers.get('WWW-Authenticate')).toBe('Bearer realm="e-site", resource_metadata="https://www.e-site.live/.well-known/oauth-protected-resource/api/mcp"')
  expect(await r.json()).toEqual({ error: 'Sign in required.' })
})
```

```ts
// apps/web/src/app/api/mcp/route.test.ts
import { vi, it, expect, beforeEach } from 'vitest'
const authenticateMcpRequest = vi.fn()
vi.mock('@/mcp/auth', () => ({ authenticateMcpRequest }))
const recordToolCall = vi.fn(async () => {})
vi.mock('@/mcp/audit', () => ({ rateStatus: async () => ({ calls: 0, writes: 0 }), recordToolCall, argsDigest: () => 'd' }))
vi.mock('@/lib/analytics/product-events', () => ({ emitProductEvent: async () => {} }))
import { POST, GET } from './route'
const init = (body: unknown, accept = 'application/json, text/event-stream') => new Request('https://www.e-site.live/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept, authorization: 'Bearer t' }, body: JSON.stringify(body) })
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }
beforeEach(() => { process.env.MCP_ENABLED = 'true'; authenticateMcpRequest.mockResolvedValue({ ok: true, ctx: { accessToken: 't', user: { id: 'u1' }, claims: {} }, memberships: [] }) })

it('404 when the kill switch is off, and nothing is audited', async () => { process.env.MCP_ENABLED = 'false'; expect((await POST(init(initialize))).status).toBe(404); expect(recordToolCall).not.toHaveBeenCalled() })
it('405 on GET, and nothing is audited', async () => { expect((await GET()).status).toBe(405); expect(recordToolCall).not.toHaveBeenCalled() })
it('401 with the challenge when auth fails', async () => {
  authenticateMcpRequest.mockResolvedValue({ ok: false, status: 401, sentence: 'Sign in required.' })
  const r = await POST(init(initialize)); expect(r.status).toBe(401); expect(r.headers.get('WWW-Authenticate')).toContain('resource_metadata=')
})
it('answers initialize with JSON (no SSE) and lists tools', async () => {
  const r = await POST(init(initialize)); expect(r.status).toBe(200); expect(r.headers.get('content-type')).toContain('application/json')
  const body = await r.json(); expect(body.result.serverInfo.name).toBe('e-site')
  const list = await POST(init({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
  const names = (await list.json()).result.tools.map((t: { name: string }) => t.name)
  expect(names).toEqual(expect.arrayContaining(['esite_whoami', 'esite_projects_list', 'esite_project_get', 'esite_project_history']))
})
it('answers a notification with 202 and an empty body', async () => {
  const r = await POST(init({ jsonrpc: '2.0', method: 'notifications/initialized' })); expect(r.status).toBe(202)
})
```

The `tools/list` assertion depends on Task 8; until then assert `Array.isArray(result.tools)`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web exec vitest run src/mcp/metadata.test.ts src/app/api/mcp/route.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `metadata.ts`, `server.ts`, the two routes, the middleware list, `.env.example`, `safe-next.ts`**

`safe-next.test.ts` gains: `expect(safeNext('/oauth/consent?authorization_id=abc')).toBe('/oauth/consent?authorization_id=abc')`.

- [ ] **Step 4: Run the tests, type-check, lint**

Run: `pnpm --filter web exec vitest run src/mcp src/app/api/mcp src/lib/safe-next.test.ts && pnpm --filter web type-check && pnpm --filter web lint`
Expected: PASS, 0 errors. If the SDK's transport needs `@modelcontextprotocol/sdk` in `serverExternalPackages` to run under Next (an `ERR_REQUIRE_ESM` or similar at `next build`), add it there and note it in the PR.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/mcp/server.ts apps/web/src/mcp/metadata.ts apps/web/src/mcp/metadata.test.ts apps/web/src/app/api/mcp apps/web/src/app/.well-known apps/web/src/middleware.ts apps/web/.env.example apps/web/src/lib/safe-next.ts apps/web/src/lib/safe-next.test.ts
git commit -m "feat(mcp): /api/mcp stateless route, protected-resource metadata, kill switch"
```

---

### Task 8: Discovery tools and the cost-visibility lift

**Files:**
- Create: `apps/web/src/mcp/tools/index.ts`, `apps/web/src/mcp/tools/discovery.ts`, `apps/web/src/mcp/schemas.ts`, `apps/web/src/lib/projects/cost-visibility.ts`
- Modify: `apps/web/src/app/(admin)/projects/page.tsx:32-66` (replace the inline maps and `canSeeCostFor` with `loadCostVisibility`)
- Test: `apps/web/src/lib/projects/cost-visibility.test.ts`, `apps/web/src/mcp/tools/discovery.test.ts`

**Interfaces:**
- Consumes: `projectService.listAccessible(client)` / `getById(client, id)` (`packages/shared/src/services/project.service.ts:32,47`), `getProjectSettingsCached(projectId)`, `getProjectHistoryCached(projectId, limit)`, `listProjectContacts(projectId)`, `listProjectMembers(projectId)`, `listMyOrganisations()`, `requireEffectiveRole(client, projectId, COST_VIEW_ROLES)`, `requireProjectAccess(client, projectId)`.
- Produces:
  - `schemas.ts`: `projectId = z.string().uuid()`, `limit = z.number().int().min(1).max(200).default(50)` (values outside are **clamped**, not refused: `z.number().int().transform(n => Math.min(200, Math.max(1, n)))`), `cursor = z.string().optional()`.
  - `loadCostVisibility(client, userId: string, projects: { id: string; organisation_id: string }[]): Promise<(p) => boolean>` with the exact logic of `projects/page.tsx:32-66`.
  - Tools (all `kind: 'read'`):
    - `esite_whoami` `{}` → `{ userId, email, clientId, organisations: { id, name, role }[], projects: { id, code, name, organisationId, effectiveRole }[] }` (effective role via `user_effective_project_role` RPC per project, through `client.rpc`).
    - `esite_projects_list` `{ limit?, cursor? }` → `{ projects: { id, code, name, status, clientName, startDate, endDate, openingDate, dropboxMapped: boolean, canSeeCost: boolean, contractValue?: number | null }[], nextCursor: string | null, truncated: boolean }` (contract value only when `canSeeCost`; cursor = the created_at of the last row, opaque base64).
    - `esite_project_get` `{ projectId }` → `{ project, settings, contract: null | {...}, contacts, members }` where `contract` is non-null only when `requireEffectiveRole(client, projectId, COST_VIEW_ROLES).ok`; `requireProjectAccess` failing → `ToolRefusal('Project not found')`.
    - `esite_project_history` `{ projectId, limit? }` → `{ rows }`.
  - `index.ts`: `export const ALL_TOOLS = [...discoveryTools]`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/projects/cost-visibility.test.ts
import { loadCostVisibility } from './cost-visibility'
const client = (orgRoles: [string, string][], projRoles: [string, string][]) => ({
  from: (t: string) => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: t === 'user_organisations' ? orgRoles.map(([organisation_id, role]) => ({ organisation_id, role })) : [], error: null }) }) }) }),
  schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: projRoles.map(([project_id, role]) => ({ project_id, role })), error: null }) }) }) }) }),
}) as never
it('org PM sees cost; project-promoted PM sees cost; contractor does not', async () => {
  const can = await loadCostVisibility(client([['o1', 'project_manager']], [['p2', 'project_manager']]), 'u1', [{ id: 'p1', organisation_id: 'o1' }, { id: 'p2', organisation_id: 'o9' }, { id: 'p3', organisation_id: 'o9' }])
  expect([can({ id: 'p1', organisation_id: 'o1' }), can({ id: 'p2', organisation_id: 'o9' }), can({ id: 'p3', organisation_id: 'o9' })]).toEqual([true, true, false])
})
```

```ts
// apps/web/src/mcp/tools/discovery.test.ts  (mock the loaders; assert shapes and refusals)
it('esite_project_get omits contract for a contractor and refuses an invisible project')  // requireEffectiveRole → {ok:false}; requireProjectAccess → {ok:false,status:404,error:'Project not found'} → ToolRefusal('Project not found')
it('esite_projects_list clamps limit to 200 and 1 and reports truncated')               // 250 rows mocked, limit 10000 → 200 rows, truncated true, nextCursor set
it('esite_whoami returns clientId from claims and effectiveRole per project')
```

Write each as a full test with mocked modules (`@esite/shared` `projectService`, `@/lib/project-settings`, `@/actions/project-contacts.actions`, `@/actions/project-members.actions`, `@/lib/auth/require-role`, `@/lib/auth/require-project-access`), calling the tool's `handler` directly with a fake `ToolContext`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web exec vitest run src/lib/projects/cost-visibility.test.ts src/mcp/tools/discovery.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the lift, switch `projects/page.tsx` to it, implement the four tools and `index.ts`**

- [ ] **Step 4: Run the tests, the page's existing tests, the route test (now asserting the four names), type-check**

Run: `pnpm --filter web exec vitest run src/lib/projects src/mcp src/app/api/mcp "src/app/(admin)/projects" && pnpm --filter web type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/mcp/tools apps/web/src/mcp/schemas.ts apps/web/src/lib/projects "apps/web/src/app/(admin)/projects/page.tsx"
git commit -m "feat(mcp): whoami, projects list, project get and history tools; lift cost visibility"
```

---

### Task 9: Module contract tests (no service key, allowlisted imports)

**Files:**
- Create: `apps/web/src/mcp/mcp-module.contract.test.ts`

**Interfaces:**
- Produces: two guards over `apps/web/src/mcp/**/*.ts` (excluding `*.test.ts`), read from disk with comments stripped (reuse the comment-stripping approach of `service-client-gates.contract.test.ts`).

- [ ] **Step 1: Write the tests (they must pass against Tasks 4–8 as written, and fail under mutation)**

```ts
// apps/web/src/mcp/mcp-module.contract.test.ts
import fs from 'node:fs'; import path from 'node:path'
const dir = path.join(__dirname); const files = fs.readdirSync(dir, { recursive: true }).map(String).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
const SERVICE = /createServiceClient|SUPABASE_SERVICE_ROLE_KEY|service_role/
const ALLOWED_IMPORT = /^(\.\.?\/|@\/lib\/|@\/actions\/|@\/services\/|@esite\/shared|@esite\/db|@modelcontextprotocol\/sdk|@supabase\/supabase-js|zod|server-only|next\/|node:)/
it('only audit.ts touches the service key', () => {
  for (const f of files) { const src = fs.readFileSync(path.join(dir, f), 'utf8'); if (f !== 'audit.ts') expect(src, f).not.toMatch(SERVICE) }
})
it('tool files import only loaders, actions, services and shared packages; no raw queries', () => {
  for (const f of files.filter(f => f.startsWith('tools/'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const m of src.matchAll(/from '([^']+)'/g)) expect(m[1], `${f} imports ${m[1]}`).toMatch(ALLOWED_IMPORT)
    expect(src, `${f} runs a raw query`).not.toMatch(/\.from\(['"]/)
  }
})
```

(`esite_whoami`'s effective-role lookup uses `client.rpc`, not `.from(`, so it passes; the memberships read lives in `auth.ts`, outside `tools/`.)

- [ ] **Step 2: Run, then mutation-check**

Run: `pnpm --filter web exec vitest run src/mcp/mcp-module.contract.test.ts`
Expected: PASS. Then add `createServiceClient()` to `tools/discovery.ts` → FAIL naming the file; revert. Add `.from('projects')` to a tool file → FAIL; revert.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/mcp/mcp-module.contract.test.ts
git commit -m "test(mcp): module contract — no service key, allowlisted imports, no raw queries"
```

---

### Task 10: Consent page, runbook, rbac-matrix

**Files:**
- Create: `apps/web/src/app/oauth/consent/page.tsx`, `apps/web/src/app/oauth/consent/ConsentClient.tsx`, `docs/mcp/enable-oauth.md`
- Modify: `docs/rbac-matrix.md` (new section `## MCP tools (\`apps/web/src/mcp/*\`)` placed after "Server actions", with the table header of :560 and one row per tool: `esite_whoami` R for every role except client_viewer, `esite_projects_list` R same, `esite_project_get` R same with the note that the contract block needs COST_VIEW, `esite_project_history` R same; a blockquote stating the connect rule and the kill switch)
- Test: `apps/web/src/app/oauth/consent/ConsentClient.test.tsx`

**Interfaces:**
- Consumes: the existing browser client factory `apps/web/src/lib/supabase/client.ts` (verify the export name with `grep -n "export" apps/web/src/lib/supabase/client.ts`), `supabase.auth.oauth.getAuthorizationDetails(id)`, `.approveAuthorization(id, { skipBrowserRedirect: true })`, `.denyAuthorization(id, { skipBrowserRedirect: true })` (`@supabase/auth-js@2.103.0`).
- Produces: `page.tsx` (server component, **outside** `(admin)`): reads `authorization_id` from `searchParams`; `createClient()` → `getUser()`; no user → `redirect('/login?next=' + encodeURIComponent('/oauth/consent?authorization_id=' + id))`; user with no active non-`client_viewer` membership (query `user_organisations` as the user) → renders the `CONNECT_REFUSAL` sentence and no buttons; else renders `<ConsentClient authorizationId={id} />`. `ConsentClient` (client component): on mount calls `getAuthorizationDetails`; shows the client name, redirect URI and scopes, plus the fixed copy `Claude will be able to read your E-Site projects and run imports you preview and confirm, as you.`; Approve → `approveAuthorization(id, { skipBrowserRedirect: true })` then `window.location.assign(data.redirect_url)`; Deny → `denyAuthorization` likewise; errors render the API's message.

- [ ] **Step 1: Write the failing component test**

```tsx
// apps/web/src/app/oauth/consent/ConsentClient.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, it, expect } from 'vitest'
const oauth = { getAuthorizationDetails: vi.fn(async () => ({ data: { client: { name: 'Claude Desktop' }, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', scopes: ['openid', 'email'] }, error: null })), approveAuthorization: vi.fn(async () => ({ data: { redirect_url: 'https://claude.ai/cb?code=1' }, error: null })), denyAuthorization: vi.fn() }
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { oauth } }) }))
import ConsentClient from './ConsentClient'
it('shows the client and approves to the redirect url', async () => {
  const assign = vi.fn(); Object.defineProperty(window, 'location', { value: { assign }, writable: true })
  render(<ConsentClient authorizationId="a1" />)
  await waitFor(() => expect(screen.getByText('Claude Desktop')).toBeInTheDocument())
  expect(screen.getByText(/read your E-Site projects and run imports you preview and confirm/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /approve/i }))
  await waitFor(() => expect(oauth.approveAuthorization).toHaveBeenCalledWith('a1', { skipBrowserRedirect: true }))
  expect(assign).toHaveBeenCalledWith('https://claude.ai/cb?code=1')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web exec vitest run src/app/oauth/consent/ConsentClient.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the page and client component with the app's `Card / CardHeader / CardBody` components and CSS-var styling**

- [ ] **Step 4: Write `docs/mcp/enable-oauth.md`**

Contents, in this order: (1) the Management API `PATCH /v1/projects/cbskbnvvgcybmfikxgky/config/auth` body `{ "oauth_server_enabled": true, "oauth_server_authorization_path": "/oauth/consent", "oauth_server_allow_dynamic_registration": true }` with the keychain PAT (`security find-generic-password -s "Supabase CLI" -w`, strip `go-keyring-base64:` and decode), and the GET to read the three keys back twice; (2) `MCP_ENABLED=true` in Vercel Production (and Preview if a preview is to be tested); (3) connecting Claude Desktop (Settings → Connectors → Add custom connector, URL `https://www.e-site.live/api/mcp`) and Claude Code (`claude mcp add --transport http e-site https://www.e-site.live/api/mcp`, then `/mcp` → authenticate); (4) the verification walk from the design §8; (5) rollback: `MCP_ENABLED=false`, and the OAuth switch can stay on (it affects only OAuth clients). State plainly that enabling the OAuth server does not change password or magic-link sign-in.

- [ ] **Step 5: Update `docs/rbac-matrix.md`, run the tests, lint**

Run: `pnpm --filter web exec vitest run src/app/oauth && pnpm --filter web lint && pnpm --filter web type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/oauth docs/mcp/enable-oauth.md docs/rbac-matrix.md
git commit -m "feat(mcp): OAuth consent page, enablement runbook, rbac-matrix section"
```

---

### Task 11: Whole-branch verification and PR

**Files:** none new.

- [ ] **Step 1: Run everything**

Run: `pnpm --filter web test && pnpm --filter @esite/shared test && pnpm --filter @esite/db test:ci && pnpm --filter web type-check && pnpm --filter web lint && pnpm --filter web build`
Expected: all green; the build must pass because `'use server'`-adjacent mistakes and ESM transport issues surface only there.

- [ ] **Step 2: Local smoke with a real token (no OAuth needed yet)**

Start the dev server with `MCP_ENABLED=true`. Mint a session for the `rbac-test` contractor with the GoTrue password grant (CLAUDE.md "Verification pattern") and POST an `initialize` then `tools/list` then `esite_whoami` to `http://localhost:3000/api/mcp` with `Authorization: Bearer <access_token>`.
Expected: 200s; `esite_whoami` returns the contractor's KINGSWALK membership with `effectiveRole: 'contractor'`; `esite_project_get` on KINGSWALK returns `contract: null`; a row appears in `public.mcp_tool_calls` for each call (read back with the Management API as one statement). Delete the smoke rows afterwards (they are the fixture user's; zero residue rule).

- [ ] **Step 3: Push over SSH and open the PR**

`git push git@github.com:WattMatt/e-site.git feat/mcp-server-slice-1`, then `gh pr create` with: what shipped (Tasks 2–10), the migration number and dry-run/sweep counts, the mutation checks of Tasks 5 and 9, the smoke results, what is not verified (the OAuth flow end to end needs the owner to flip the switch; Claude Desktop connect; aal with a real factor), and the deploy order (migration → Vercel env `MCP_ENABLED` → OAuth switch → owner walk). End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 4: After merge** (owner steps from the runbook; not the builder's): migration deploy green and read back; `MCP_ENABLED=true`; OAuth switch; connect Claude Desktop; the walk.
