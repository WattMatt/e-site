# E-Site MCP server — slice 1: reads across every module, writes only through the existing import and preview paths

**Date:** 2026-10-27  
**Owner decisions:** 2026-10-21, E-Site extracts from the project's Dropbox folder itself and is the single truth. 2026-10-27, this is not an in-app Claude feature: E-Site gets a dedicated MCP server so every Claude session (Claude Code, Claude Desktop, the `_Claude Project` sessions, cowork) can read from and write to the app and manage project information; slice 1 is read tools for every module plus writes only through the import and preview paths the app already has.  
**Supersedes in part:** `2026-10-21-tenant-schedule-from-dropbox-design.md`. Its write contract (row shape, diff, preview → commit, `tenant_schedule_reads` with provenance, canonical shop-number matching, decommission guard, opening-date proposal un-ticked) carries over unchanged as the tool contract in §5.1. Its in-app extraction, the embedded Anthropic call and the "Read from Dropbox" button are dropped: the session does the reading.  
**Status:** approved by the owner 2026-10-27 (with the connect rule in §9.12). Builder-checked; nothing built. Evidence was read from `origin/main` at `a3746e8a` through a detached worktree; the canonical `esite/` checkout is on an old branch and was not used.

---

## 1. What exists today (evidence)

### How a session reaches E-Site now

It does not. A Claude session has Dropbox, mail and a Supabase Management API token, so it can read the project folder and the database, but it cannot act *as a user through the app's rules*. Everything it learns about a project has to be re-typed into E-Site by a person, or written straight into the database with the service key (no gates, no triggers, no audit). The owner's separate `_Claude Project` pipeline in Dropbox is the result: a second record beside E-Site.

### What the app already has that an MCP server can stand on

- **One role model, enforced twice.** Every page and action gates with `requireEffectiveRole(supabase, projectId, roles)` / `requireRole` / `requireRolePage` / `requireRoleAPI` / `requireProjectAccess` (`lib/auth/require-role.ts`, `lib/auth/require-project-access.ts`), and the database enforces it again with RLS plus the site-scope policies of 00238. The site-scope policies call `public.user_has_project_access(project_id)` and friends; **none reads a JWT claim** (0 occurrences of `auth.jwt()` or `request.jwt.claims` in 00238). The `all_sites` claim written by `public.custom_jwt_claims` exists for PowerSync and the custom-access-token hook is **off** in the project's auth config, so a browser JWT and any other Supabase-issued JWT for the same user are treated identically by the database.
- **Loaders a tool can call.** Most modules have a server-side loader that takes a Supabase client (`loadEquipmentMaterialsData(client, projectId)`, `loadTenantPlanPage(client, …)`, `loadLoadProfileView`, `loadLibrary`, `listInspectionsAction`, `snagService.list(client, …)`, `diaryService.list`, `rfiService.list`, `projectService.listAccessible(client)`, …). Some modules read only inline in a `page.tsx` (tenant schedule's scope items, orders and circuits; cable revision detail; documents; inspection detail; work items; handover; standards; metrics; RFIs list). The full inventory is in Appendix A.
- **Import and preview paths with a second, deliberate step.** Tenant schedule (parse → commit, server re-parses), cable schedule (parse → commit takes the previewed cables, refuses any row with errors, DRAFT only), project BOQ (parse + reconcile → `importBoqAction` with the parsed workbook), load profile (parse stored file → commit re-parses), tender BOQ (one step, draft only, review report stored), status plans Detect blocks (browser detection → `acceptDetectedBlocksAction`), Re-align (preview → apply → undo), rate library price-from-library (preview → apply refuses if the result moved) and review-queue confirms, Solar meter files and schedule imports (Solar-gated). Full list with types in Appendix B.
- **Auth primitives.** Supabase Auth, cookie sessions via `@supabase/ssr`; two routes already accept a Supabase user JWT as a bearer (`api/notifications/dispatch`, `api/diary/notify` → `auth.getUser(token)`); the middleware keeps bypass lists for bearer and webhook paths. **No API-token or personal-access-token mechanism exists.** MFA is enrolled in the app but TOTP is disabled in the project config today; the only AAL check is the middleware redirect for an `aal1` session with a verified factor.
- **Supabase Auth OAuth 2.1 server.** The project's auth config exposes `oauth_server_enabled`, `oauth_server_allow_dynamic_registration` and `oauth_server_authorization_path` (all off / null on 2026-10-27). The feature is Supabase's documented way to authenticate MCP clients as existing users: discovery at `https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`, authorization-code flow with PKCE, dynamic client registration, refresh tokens, the app hosting the consent page, custom access token hooks applying to the issued tokens, and a `client_id` claim in every token. Status: public beta since 2025-11-26, GA was targeted for Q4 2025; the owner confirms the current status in the dashboard before slice 1 ships.
- **Claude clients.** Claude Desktop custom connectors accept **OAuth or no auth, never a static header**. Claude Code accepts both (`claude mcp add --transport http … --header`), with a known preflight bug around headers. So OAuth is not optional if Desktop sessions are in scope, and the user said they are.
- **Existing Claude use in the app** (two call sites, `ANTHROPIC_API_KEY`, no document reading) is unaffected by this design.

### Production facts that set the stakes (2026-10-21)

16 projects, 7 mapped to Dropbox; 462 tenant boards, 0 breaker ratings, 0 fed-from, 12 legend circuits; 495 equipment orders with 0 notes; 706 drawings, 6 calibrated; 19 document rows. Three shop-number conventions in `structure.nodes.shop_number` (`01`, `Shop 14a`, `10a`).

---

## 2. Design decision

**E-Site exposes a remote MCP server inside the web app.** It speaks streamable HTTP at `https://www.e-site.live/api/mcp`, authenticates every call with a Supabase-issued user token obtained through Supabase Auth's OAuth 2.1 server, and runs every tool with a Supabase client built from that token. The tool therefore sees exactly what the person sees in the browser: RLS, site scope and the role gates are the same code paths. There is no service-key path in the MCP module, pinned by a test.

**Reads cover every module; writes are only the paths that already preview and then commit.** A write tool is a thin adapter over an existing import, preview, accept or apply function, with the same gate, the same server-side validation and the same refusal sentences. Nothing in slice 1 lets a session set a field on a record directly.

Goals: a session can answer "what is the state of this project" for any module without a person opening the app; a session can land a tenant schedule, cable schedule, BOQ, load-profile file or tender BOQ it has read from Dropbox or mail, with the preview a person would see and the audit saying which session did it; the owner's Dropbox pipeline can stop keeping a second record.  
Non-goals (slice 1): direct record writes; running the sync; reading Dropbox from inside E-Site (the session has its own connector); notifications or realtime; a hosted agent. Anti-goals: any tool that bypasses a gate the UI enforces; an audit that cannot say which user and which client made a write; a response that silently truncates.

---

## 3. Authentication and identity

### Flow

1. The owner enables the OAuth 2.1 server on the Supabase project (dashboard: Authentication → OAuth Server, or the Management API `PATCH /v1/projects/{ref}/config/auth` with `oauth_server_enabled: true`, `oauth_server_authorization_path: "/oauth/consent"`, `oauth_server_allow_dynamic_registration: true`). Site URL is already `https://www.e-site.live`. This changes nothing for existing browser sessions.
2. The app serves **RFC 9728 protected-resource metadata** at `/.well-known/oauth-protected-resource` (and the `/api/mcp` variant) naming `https://<ref>.supabase.co/auth/v1` as the authorization server, and answers an unauthenticated MCP request with `401` plus a `WWW-Authenticate: Bearer resource_metadata="…"` challenge. Claude Desktop and Claude Code discover the authorization server from that, register dynamically, and run the PKCE flow.
3. Supabase redirects the person to **`/oauth/consent?authorization_id=…`** in E-Site. The page (server component inside the signed-in `(admin)` group, so an unauthenticated person is sent to login and back) calls `supabase.auth.oauth.getAuthorizationDetails`, shows the client name, redirect URI and a plain-words list of what the MCP server can do, and calls `approveAuthorization` or `denyAuthorization`, then redirects to the returned URL. Supabase remembers the grant, so later connections from the same client auto-approve.
4. The client receives an access token (Supabase JWT, `exp` 3600 s per `jwt_exp`, carrying `sub`, `role: authenticated`, `email`, `client_id`) and a refresh token; it refreshes on its own.
5. Every MCP request carries `Authorization: Bearer <access token>`. The route builds a Supabase client bound to that token (`global.headers.Authorization`, `auth.persistSession: false`), calls `auth.getUser()` once (401 on failure, never cached across requests), and runs the tool.

### How the token reaches code that builds its own client

127 action files and `requireRoleAPI` call `lib/supabase/server.ts: createClient()`, which reads `cookies()`. A bearer request has no cookie, so without a change every action-backed tool would see no user. **The factory gains a request-scoped override:** the MCP route runs each tool inside `AsyncLocalStorage` holding `{ accessToken, user }`; `createClient()` checks the store first and, when it is set, returns a client bound to that bearer and never touches `cookies()`. Browser requests are unchanged (empty store → cookies, as today). This is one change in one file that every page uses, so it carries its own contract test: under the store, `createClient().auth.getUser()` returns the bearer's user and `cookies()` is never called (spy); outside the store, behaviour is byte-identical to today. The six action files that `redirect('/login')` on a missing user cannot fire under a valid bearer; the MCP route still catches a thrown `NEXT_REDIRECT` and turns it into the refusal "Sign in required", so a redirect can never leak as a protocol error. `requireRolePage` is never called from a tool (it redirects by design); tools wrap actions, loaders and `requireRoleAPI`/`requireEffectiveRole` only, and the allowlist test (§8) enforces that.

### Rules

- **Acts as a person, always.** The token's `sub` is the actor; `client_id` is the client. Both are written to the audit row. "Arno via Claude Desktop" and "Arno via Claude Code" are distinguishable.
- **No service key in the MCP module.** Where an existing action internally uses the service client after its own gate (members list, BOQ, valuations, report URLs, inspection detail), the tool calls that action and inherits its gate; it never constructs a service client itself. A contract test scans `apps/web/src/mcp/**` for `createServiceClient` and the service-role env var and fails on any hit.
- **MFA.** If the project enables TOTP later, the consent flow authenticates with MFA (Supabase handles it before consent) and the token carries `aal`. The MCP gate mirrors the middleware: a token at `aal1` for a user with a verified factor is refused with the same sentence. Today there are no verified factors in the config, so the check is inert but present.
- **Which organisation.** `getOrgContext` follows `profiles.active_organisation_id`, which the browser's org switcher writes, so a multi-org person's Claude session would change org whenever they flip a tab. Org-level tools (`esite_organisation_get`, `esite_suppliers_list`, `esite_rate_library_*`, `esite_cable_rates_list`) therefore take an explicit `organisationId` (refused unless the token's user is an active member); `esite_whoami` lists the memberships so the session can pick. Project-scoped tools derive the organisation from the project. The audit row's `organisation_id` is derived the same way, never from the active-org pointer.
- **Who may connect.** The consent page lives **outside** `(admin)` (which bounces client viewers to `/portal` and would strand the `authorization_id`), at `app/oauth/consent/page.tsx` with its own signed-in check, and `/oauth` joins the `safe-next.ts` allow-list so the login round-trip keeps the `authorization_id`. Which roles may complete consent is an owner decision recorded in §9; `mcp/auth.ts` refuses a token outside the allowed set with one sentence, and the rbac-matrix "MCP tools" section states the rule.
- **Revocation.** The person revokes a client from a "Connected AI clients" list on `/settings/security` (`supabase.auth.oauth.listGrants()` and `revokeGrant({ clientId })`, present in the resolved `@supabase/auth-js@2.103.0`), which kills the refresh token; access tokens expire within an hour. Removing a user from the org or project revokes at the next call, because every call re-reads the role.
- **Middleware.** `/api/mcp` and `/.well-known/oauth-protected-resource*` join the bearer/public bypass list; `/oauth/consent` stays a normal signed-in page. The CSP already lists the Supabase host.
- **Rate limit.** Per user: 120 calls per minute and 20 write-tool calls per minute, counted from the audit table (one indexed query), answered with the MCP error "Slow down; try again in a minute". Serverless has no shared memory, so the table is the counter.
- **Why not a personal access token.** It would need a hand-minted session (`generateLink` → `verifyOtp` per token, stored refresh token), a token UI, and still would not work in Claude Desktop. OAuth is the client-supported path and Supabase provides the server. A PAT is not built.

### What the owner must confirm before slice 1 ships

- The OAuth 2.1 server's status on the project's plan (beta or GA) and that enabling it is acceptable on production. It is a config switch with no effect on password or magic-link sign-in.
- Dynamic client registration ON (needed by Claude's clients), with the consent page as the human check on every new client.
- `@supabase/supabase-js` is bumped to a version that ships `auth.oauth.*` (the app pins `^2.45`; the builder verifies the minimum and updates the lockfile).

---

## 4. Transport, hosting and packaging

- **Route:** `apps/web/src/app/api/mcp/route.ts`, `POST` only (stateless streamable HTTP; `GET`/`DELETE` answer 405), `export const maxDuration = 300` because the import tools parse workbooks and the load-profile commit re-parses a file. The protected-resource metadata is a sibling route under `app/.well-known/`.
- **Library:** `@modelcontextprotocol/sdk` 1.32.x (the v1 maintenance line; peer `zod ^3.25 || ^4.0`, so the app's `zod@3.25.76` satisfies it), using `WebStandardStreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js` in stateless mode (`sessionIdGenerator: undefined`), which takes a Web `Request` and returns a `Response` and therefore mounts in a Next.js route handler without an adapter. One `McpServer` instance is built per request with the user's client bound into the tool closures. **Clock:** v1.x receives fixes until at least 2027-01-27 (six months after the v2 release of 2026-07-27) and implements the MCP spec up to 2025-11-25, which Claude Desktop and Claude Code both still speak. Moving to v2 (`@modelcontextprotocol/server`, `zod@^4`) is a follow-up coupled to a Zod 4 upgrade across `apps/web` and `packages/shared`; the tool module keeps its schemas in one file so that migration is mechanical. `mcp-handler` is not used (its 2.x needs SDK v2 and Zod 4; its 1.x adds nothing over the SDK's own web-standard transport).
- **Module layout:** `apps/web/src/mcp/` with `server.ts` (registration), `auth.ts` (bearer → client, aal check, audit context), `tools/<module>.ts` (one file per module), `schemas.ts` (shared Zod pieces: `projectId`, `cursor`, `limit`), `audit.ts`. Tool files import existing loaders and actions; they contain no queries of their own beyond what Appendix A marks "lift first".
- **Responses:** every tool returns `content: [{ type: 'text', text: <JSON> }]` and `structuredContent` with the same object, in the shape of the loader's own type. Lists are paged (`limit` default 50, max 200, `cursor` opaque); a response says `truncated: true` and how to continue, never drops rows silently (PostgREST caps at 1,000 anyway). Money fields are omitted, not zeroed, when the caller may not see cost; the response says `costRedacted: true`.
- **Errors:** a gate refusal returns the gate's own sentence as an MCP tool error (not a protocol error), so the session can relay it. An unexpected error returns one named sentence and a Sentry event with the tool name only.
- **Server identity:** `serverInfo: { name: 'e-site', version: <app version> }`, plus a `server.instructions` string that tells the model the three rules: everything is as the signed-in person; previews write nothing; commits need a `previewId`.

---

## 5. Tool catalogue

Names are `esite_<module>_<verb>`. Every tool takes `projectId` unless it is org- or platform-level. "Gate" names the existing function the tool calls; "Source" names the loader or action it wraps.

### 5.0 Discovery (read)

| Tool | Returns | Source |
|---|---|---|
| `esite_whoami` | user id, email, orgs and roles, `client_id`, the projects the token can see with the effective role on each | `getOrgContext`, `projectService.listAccessible`, `user_effective_project_role` per project |
| `esite_projects_list` | projects with code, name, status, client, dates, whether a Dropbox folder is mapped, cost visibility | `projectService.listAccessible(client)` + the page's per-row cost flag |
| `esite_project_get` | the settings bundle: general, site, client, dates, operational; contract only when COST_VIEW; contacts; members with roles | `projectService.getById`, `getProjectSettingsCached`, `listProjectContacts`, `listProjectMembers` (SVC inside its own gate) |
| `esite_project_history` | the settings history rows | `getProjectHistoryCached` |

### 5.1 Tenant schedule

| Tool | Kind | Source / gate |
|---|---|---|
| `esite_tenant_schedule_get` | read | **lift first:** the inline reads in `tenant-schedule/page.tsx` (nodes via `listNodes`, `tenant_details`, `scope_item_types`, `tenant_scope_items`, `node_orders`, `node_circuits`) move into `lib/tenant-schedule/load.ts: loadTenantSchedule(client, projectId)`; the page switches to it. Includes computed BO dates (`bo.service.ts`) and plan cards (`loadTenantPlanCards`). |
| `esite_tenant_documents_list` | read | `listTenantDocumentsAction` (guardProjectRead) |
| `esite_tenant_db_legend_get` | read | from the lifted loader; `nodeId` filter |
| `esite_tenant_schedule_preview_import` | write-preview | input `{ projectId, source }` with `source` one of `{ kind: 'rows', rows: TenantImportRow-like[] , issuedOn?, openingDate? }`, `{ kind: 'upload', fileRef }` (xlsx), `{ kind: 'dropbox', fileId }` (xlsx in the project's own folder, through the app's connection). Rows go through `toImportResult(read, existingTenantNodes)` from the 2026-10-21 design (canonical key on both sides, project convention for new shops, sub-rows to warnings, low-confidence rows never decommission), then `diffTenantSchedule`. Stores a `structure.tenant_schedule_reads` row (`source_kind = 'mcp'`, `client_id`, `extraction`) and returns `ImportPreview & { previewId, decommissionGuard: { count, needsConfirm }, openingDateProposal }`. Gate: eff(ORG_WRITE). Writes nothing else. |
| `esite_tenant_schedule_commit_import` | write | input `{ previewId, confirmDecommission?: boolean, applyOpeningDate?: boolean }`. Re-runs the diff from the stored extraction against current nodes, refuses if the read is older than 24 h or the decommission guard needs a confirm that was not given, writes through the write functions lifted out of `api/tenant-schedule/commit/route.ts` into `lib/tenant-schedule/commit-writes.ts` (the xlsx route calls the same functions; its tests are the parity oracle), patches `bo_period_days` where the read gave one, stamps `tenant_details.schedule_read_id`, applies the opening date only if ticked, marks the read committed, returns `CommitResult`. Gate: eff(ORG_WRITE). |

The PDF never reaches E-Site. The session reads it with its Dropbox connector, extracts the rows itself (it is the model), and sends `kind: 'rows'`. The server keeps the deterministic normalisation and the diff, so two sessions sending the same rows produce the same preview.

### 5.2 Cable schedule

| Tool | Kind | Source / gate |
|---|---|---|
| `esite_cable_revisions_list` | read | **lift first** from `cables/page.tsx` |
| `esite_cable_revision_get` | read | **lift first** from `cables/[revisionId]/page.tsx` (revision, sources, nodes, supplies, cables, route sheets via `listRouteSheetsForRevision`); cost columns only under `getExportPolicy(...).redactCost === false` |
| `esite_cable_rates_list` | read | `listRateLibraryAction` (org ROLES_ENGINEER) |
| `esite_cable_schedule_preview_import` | write-preview | `{ projectId, source: upload | dropbox }` → `parseScheduleWorkbook(buffer)` → the route's `ImportPreview` with counts; stored as a preview row; returns `previewId`. Gate: eff(ORG_WRITE). |
| `esite_cable_schedule_commit_import` | write | `{ previewId, cables?: ImportedCablePayload[], intoRevisionId?, revisionDescription? }`. If `cables` is given it must be the previewed set with only amber-row edits (same rule as the UI: any row with `errors.length > 0` is refused); the commit runs the existing commit code (new DRAFT revision or into a DRAFT). Gate: eff(ORG_WRITE). |

### 5.3 Project BOQ, rates and tender

| Tool | Kind | Source / gate |
|---|---|---|
| `esite_boq_get` | read | `listBoqAction` (eff COST_VIEW) |
| `esite_boq_preview_import` | write-preview | `{ projectId, source: upload | dropbox }` → `parseBoqXlsx` + `reconcile` → `{ parsed, report, previewId }`; the parsed workbook is stored with the preview. Gate: `requireProjectAccess` + COST_VIEW, as the route. |
| `esite_boq_commit_import` | write | `{ previewId }` → `importBoqAction(projectId, storedParsed, sourceFilename, storagePath)`. The stored parse is used, never a client-sent one. Gate: eff(COST_VIEW). |
| `esite_rate_library_search` | read | `loadLibrary`, `loadItemDetail`, `loadQueue` (org COST_VIEW; `logRateAccess` keeps logging) |
| `esite_rate_library_preview_price` | write-preview | `previewPriceFromLibraryAction(projectId, statistic)` |
| `esite_rate_library_apply_price` | write | `applyPriceFromLibraryAction(projectId, statistic, shown)` where `shown` is the preview's rows; the action refuses if the result moved. |
| `esite_rate_library_confirm_group` | write (review queue) | `confirmGroupAction(groupKey, itemId)` |
| `esite_tenders_list` / `esite_tender_get` | read | `listTendersAction`, `getTenderDetailAction`, `loadAdjudication` (gateTender) |
| `esite_tender_import_boq` | write | `{ tenderId, source: upload | dropbox, estimate?: upload | dropbox }` → the signed-upload step then `importTenderAction`. Draft tenders only, as today; the stored review report is returned. Gate: gateTender. |
| `esite_valuations_list` / `get`, `esite_variations_list` | read | the valuation and variation actions (eff COST_VIEW) |

### 5.4 Equipment, documents, drawings, plans

| Tool | Kind | Source / gate |
|---|---|---|
| `esite_equipment_materials_get` | read | `loadEquipmentMaterialsData(client, projectId)` |
| `esite_documents_list` | read | **lift first** from `documents/page.tsx` (`tenants.documents` with the connection state) |
| `esite_drawings_list` | read | `floorPlanService.listByProject(client, projectId)` + `listFloorPlanMarkupsAction` on request |
| `esite_tenant_plans_get` | read | `loadTenantPlanPage(client, …)` (sheets, shapes, links, colour-by) |
| `esite_tenant_plans_detect_blocks` | write-preview | runs `extractPageText` + `detectBlocks` / `snapBlocks` / `matchBlock` / `reviewDetection` on the server for a line-diagram sheet; returns the review rows and a `previewId`; writes nothing. Gate: eff(ORG_WRITE). |
| `esite_tenant_plans_accept_blocks` | write | `acceptDetectedBlocksAction({ sheetId, blocks })` with the previewed blocks (or a subset by index) |
| `esite_tenant_plans_realign` | write | `realignShapesAction` with moves from a prior `plan_realignment` preview (same `expectedUpdatedAt` protection) |

### 5.5 Site modules

| Tool | Kind | Source / gate |
|---|---|---|
| `esite_inspections_list` / `get` | read | `listInspectionsAction`; detail **lift first** from `inspections/[inspectionId]/page.tsx` (responses, photos as signed URLs, signatures, history) |
| `esite_inspection_templates_list` / `get` | read | `listTemplatesAction`, `getTemplateAction` |
| `esite_site_forms_list` / `get` | read | `listProjectFormsAction`; detail **lift first** |
| `esite_snags_list`, `esite_snag_visits_list` / `get` | read | `snagService.list`, `snagVisitService.listVisits / getVisit / listVisitSnags` |
| `esite_qc_list` / `get` | read | `qc.service.ts` |
| `esite_diary_list` | read | `diaryService.list`, `getWeeklySummary` |
| `esite_rfis_list` / `get` | read | `rfi.service.ts` |
| `esite_work_items_list` / `get` | read | **lift first** from `items/[ref]/page.tsx` (`work_items`, notes, attachments, events); registry from `WORK_ITEM_TYPES` |
| `esite_handover_get` | read | **lift first** from the handover pages |
| `esite_reports_list` / `esite_report_url` | read | `listProjectReportsAction`, `getProjectReportUrlAction` (`REPORT_KIND_READ_ROLES` applies) |

### 5.6 Load profile, Solar, tariffs, standards, org

| Tool | Kind | Source / gate |
|---|---|---|
| `esite_load_profile_get` | read | `loadLoadProfileView(client, projectId, { canEdit })` (eff LOAD_PROFILE_READ) |
| `esite_load_profile_preview_import` | write-preview | `{ projectId, source: upload | dropbox }` → store the file in `load-profile-files` the way the UI does → `parseLoadProfileFileAction` → `ParseResult` + `previewId` |
| `esite_load_profile_commit_import` | write | `{ previewId, sheet, selections: ChannelSelection[] }` → `commitLoadProfileFileAction` (re-parses the stored file). Gate: eff(ORG_WRITE). |
| `esite_solar_*` | read, and the meter-file and schedule preview/commit | only when `requireSolarLevel` admits the caller; same two-step shape as above; slice 1b |
| `esite_tariffs_search` / `esite_tariff_get` | read | `explorer-data.ts` loaders (signed in) |
| `esite_standards_lookup` | read | `sans-lookup.service.ts` + **lift first** of the standards page reads (WM-only visibility stays in RLS) |
| `esite_organisation_get`, `esite_suppliers_list` | read | `listMyOrganisations`, `orgService.getMembers` (OWNER_ADMIN), `supplierService.listAll` |
| `esite_metrics_get` | read | **lift first**; page(OWNER_ADMIN) |

### 5.7 Files

| Tool | Kind | Notes |
|---|---|---|
| `esite_file_upload` | write (scratch) | `{ projectId, fileName, contentBase64 }` (≤ 20 MB decoded) into a private bucket `mcp-uploads/<user>/<uuid>/<name>`, auto-deleted after 24 h by a cron; returns `fileRef`. Only the preview tools accept a `fileRef`, and only for the project it was uploaded under. |
| `esite_dropbox_file` source | — | not a tool; the `{ kind: 'dropbox', fileId }` source on preview tools downloads through `downloadCloudFile({ connectionId, fileId, maxBytes })` on `origin/main`, restricted to files under the project's `cloud_storage_folder_id`. |

**Excluded from slice 1, by the rule "existing preview paths only":** site-form prefill (inserts immediately), equipment order-document upload (no parse, auto-advances status), inspection template import (one step), any direct field write, tenant delete, sync triggers.

---

## 6. Provenance and audit

- **`public.mcp_tool_calls`** (one row per call): `id`, `user_id`, `client_id`, `organisation_id`, `project_id` (nullable), `tool`, `kind` (`read` | `preview` | `write`), `args_digest` (sha256 of the canonical JSON, never the args), `outcome` (`ok` | `refused` | `error`), `refusal` (the sentence, nullable), `result_ids` (jsonb, ids the write produced), `duration_ms`, `created_at`. Insert via a service-role RPC `public.record_mcp_call(...)` called from the route after the tool returns, the only place the service key appears; the same RPC performs the rate-limit count and returns `limited: true` when the user is over, so no read of the table happens under the caller's role. **Policy shape:** half of the calls have no project (`whoami`, projects list, org, rate library, tariffs, standards), so the generated site-scope shape (`USING (user_has_project_access(project_id))`) would hide them from everyone. The table is declared in `packages/db/src/site-scope/fixed.sql.ts` with a hand-written SELECT policy: `user_id = auth.uid()` OR the caller is owner/admin of `organisation_id`, AND (`project_id IS NULL` OR `user_has_project_access(project_id)`); no INSERT/UPDATE/DELETE policy for any role (the RPC is SECURITY DEFINER). The `@verify` block names the policy and asserts both arms with a `sql:` predicate; `assert-site-scope-coverage.sql` recognises the fixed entry.
- **`public.mcp_previews`**: `id`, `user_id`, `client_id`, `project_id`, `tool`, `payload` (jsonb: the parsed workbook, the cable preview, the detection rows, …), `file_sha256`, `created_at`, `consumed_at`. Every preview tool writes one; every commit tool consumes one by id, refuses a preview older than 24 h, made by another user, for another project, or already consumed. The tenant schedule keeps its own `tenant_schedule_reads` (richer, and part of the module) and the generic table points at it by id.
- **Module provenance** where a column already exists: `tenant_details.schedule_read_id`; cable `change_log` `entity_type = 'import'` rows gain `source: 'mcp'` and the `client_id` in their payload; `boq_imports.source_filename` keeps the file name, and the `mcp_tool_calls.result_ids` row names the import id; `load_profile_sources.imported_by` is the user as today.
- **`product_events`:** one new event `mcp_tool_called` (properties `tool`, `kind`, `outcome`), emitted through `emitProductEvent` from the route, so the weekly metrics can show agent activity beside human activity. The CHECK is widened in the same migration.
- **Nothing from tool arguments or results is logged** to Sentry or the console beyond tool name and outcome.

---

## 7. Safeguards

- Every tool: `auth.getUser()` per request, role gate per call, RLS underneath, no service key in the module (contract test), rate limit from the audit table.
- Every write: preview first, `previewId` bound to user + project + 24 h + single use; the decommission guard and the "refuse if the result moved" rules of the underlying paths are kept; a commit never takes a client-sent diff where the existing path does not.
- Cost: `getExportPolicy` / COST_VIEW decide redaction exactly as the exports do; redacted responses say so.
- Site scope: inherent; a user off a site gets the same empty result as the app.
- Files: 20 MB cap, bucket-level RLS by user, 24 h sweep, `fileRef` bound to the uploading user and project.
- Public repo: no secrets, no real project data in fixtures; the consent page copy and tool descriptions are the only prose a stranger sees.
- Owner-visible kill switch: `MCP_ENABLED` env var; when unset the route answers 404 and the metadata route is absent.

---

## 8. Testing

Deterministic:
- **No-service-key guard:** scans `apps/web/src/mcp/**` for `createServiceClient`, `SUPABASE_SERVICE_ROLE_KEY`, `service_role`; fails on any hit (mutation-proven by adding one).
- **Every tool is backed by a known loader or action:** a contract test lists the imports of each tool file against an allowlist of `lib/`, `services/`, `actions/` exports; a raw `.from(` in a tool file fails.
- **Gate parity:** for each write tool, a fake contractor token gets the same refusal sentence the route or action gives; for `esite_project_get`, a contractor sees no contract block; for cable revision, `costRedacted: true`.
- **Preview binding:** stale (25 h), consumed, other-user, other-project previews are refused; the happy path consumes exactly once.
- **Tenant schedule:** the existing `toImportResult` and commit-parity tests from the 2026-10-21 design; `kind: 'rows'` and `kind: 'upload'` produce identical previews for the same content.
- **Pagination:** `limit`/`cursor` round-trips; a 1,200-row list reports `truncated` and continues.
- **Auth:** missing bearer → 401 with the `WWW-Authenticate` challenge naming the metadata URL; invalid or expired token → 401; aal mirror.
- **Rate limit:** the 121st call in a minute is refused with the named sentence.
- **Metadata:** the protected-resource document validates against RFC 9728 (resource, `authorization_servers`, `bearer_methods_supported`).

Owner walk (not automatable from here): enable the OAuth server; add the connector in Claude Desktop; consent; `esite_whoami`; `esite_projects_list`; read the KINGSWALK Ti schedule PDF through the Dropbox connector in that session, send `esite_tenant_schedule_preview_import` with the rows, check the preview against the PDF, commit; then add the same server to Claude Code and repeat `whoami`.

---

## 9. Calls I made (overridable)

1. **Supabase Auth OAuth 2.1 server is the authorization server**, with dynamic client registration on and the consent page as the human check. No PAT.
2. **MCP TypeScript SDK 1.x in stateless streamable-HTTP mode**, mounted in the Next.js app; no Redis, no separate service. `mcp-handler` 2.x waits for a Zod 4 upgrade.
3. **Lift-before-wrap:** a module whose read lives only in a `page.tsx` gets a loader in `lib/<module>/load.ts` that the page switches to; the tool calls the loader. Duplicating the query in the tool is not allowed.
4. **Previews are server-stored and single-use**; commits take a `previewId`, even where the existing route takes a client-posted preview (cable schedule) or parsed workbook (BOQ). This is stricter than today for those two paths and costs nothing.
5. **Sessions send rows for PDFs** (the model is in the session); the server keeps normalisation and diff deterministic.
6. **Solar tools are slice 1b**, gated by `requireSolarLevel`, same shapes.
7. **A kill switch env var** and a 24 h scratch bucket.
8. **Tool names are `esite_<module>_<verb>`**, flat, so a session can discover them by prefix.
9. **The bearer reaches existing actions through a request-scoped override in `createClient()`** (AsyncLocalStorage), not by threading a client parameter through dozens of action signatures. One change, one contract test.
10. **Org-level tools take an explicit `organisationId`**; the audit organisation is derived from the project or that argument, never from the browser's active-org pointer.
11. **The audit table uses a hand-written policy** in `fixed.sql.ts`, not the generated site-scope shape, so calls without a project stay visible to their user.
12. **Who may connect (owner decision, 2026-10-27):** every active org member except `client_viewer` may complete consent and use the server; a tender-only account never may. `mcp/auth.ts` refuses a token whose user has no active org membership, whose only memberships are `client_viewer`, or who is a tender-only account, with the sentence "Claude access is for E-Site team members; ask your project owner." A project-scoped `client_viewer` on a project where the person is otherwise staff is allowed in and RLS decides per tool, as in the browser.

---

## 10. Delivery slices (each its own PR, merged in order)

1. **Auth + skeleton:** OAuth enablement runbook (`docs/mcp/enable-oauth.md`), consent page, protected-resource metadata, `/api/mcp` with stateless transport, bearer → client, aal mirror, connect rule, audit RPCs + `mcp_tool_calls` migration (`@verify`, `product_events` CHECK), rate limit, kill switch, `esite_whoami`, `esite_projects_list`, `esite_project_get`, `esite_project_history`, the two contract tests, `docs/rbac-matrix.md` section "MCP tools". (`mcp_previews` ships with slice 4b, the first slice that uses it; the tenant-schedule path has its own read table.) Plan: `docs/superpowers/plans/2026-10-27-esite-mcp-server-slice-1.md`.
2. **Reads, no lift needed:** equipment, drawings, tenant plans, inspections list, templates, site forms list, snags, visits, QC, diary, reports, load profile, tariffs, rate library, tenders, BOQ, valuations, variations, org, suppliers.
3. **Reads with a lift:** tenant schedule, cable revisions and detail, documents, inspection detail, site form detail, work items, handover, standards, metrics (each lift lands with its page switched and the page's tests green).
4a. **Tenant schedule write path (the largest slice):** nothing of the 2026-10-21 contract exists on `main` yet. This PR builds it: migration `structure.tenant_schedule_reads` + `tenant_details.schedule_read_id` (manifest entry, `@verify`), `packages/shared/src/structure/tenant-schedule-read.ts` (`toImportResult`, canonical shop-number key, project-convention detection, sub-rows and low-confidence rules), the decommission guard, the lift of the 455-line commit route's write functions into `lib/tenant-schedule/commit-writes.ts` with the existing route tests as the parity oracle, and the two tools. The 2026-10-21 spec is committed alongside slice 1's docs so the builder can read it from `main`.
4b. **Other writes:** scratch upload, Dropbox source, cable schedule preview/commit, BOQ preview/commit, load profile preview/commit, tender import.
5. **Accept paths:** detect blocks, realign, rate-library preview/apply and confirm.
6. **Slice 1b:** Solar tools. **Later, not in this design's gate:** direct record writes; "Connected AI clients" revoke panel; a `project_brief` resource summarising a project for a session; migrating the two existing Anthropic call sites to a shared helper.

Deploy order per slice: migration (number claimed at apply time, head `00256` today) → manifest check green → Vercel. The OAuth config switch happens once, before slice 1 is verified, by the owner.

---

## 11. Out of scope

Claude-side orchestration (which session reads which folder); a scheduled agent; notifications; mobile; the `_Claude Project` pipeline's own files; any UI beyond the consent page and the revoke panel.

---

## Appendix A — read inventory on `origin/main` (`a3746e8a`)

S = session client; SVC = service client inside an existing gate; eff(R) = `requireEffectiveRole`; org(R) = `requireRole`; page(R) = `requireRolePage`.

| Module | Loader | Client | Gate | Lift needed |
|---|---|---|---|---|
| Projects list | `project.service.ts:32 listAccessible(client)` + inline counts in `(admin)/projects/page.tsx` | S | RLS | counts only |
| Project settings | `projectService.getById`; `lib/project-settings.ts:33 getProjectSettingsCached`, `:41 getProjectHistoryCached`; `project-contacts.actions.ts:67 listProjectContacts`; `project-members.actions.ts:76 listProjectMembers` | S (members SVC after gate) | org(all) / eff(COST_VIEW) for contract | no |
| Tenant schedule | `listNodes` + inline details/scope/orders/circuits in `tenant-schedule/page.tsx`; `plan-cards.ts:25`, `on-plan-links.ts:34`, `shop-facts.ts:27` | S | RLS; eff(ORG_WRITE) for controls | **yes** |
| Tenant documents | `tenant-documents.actions.ts:198 listTenantDocumentsAction` | S | guardProjectRead | no |
| Cable schedule | inline in `cables/page.tsx` and `cables/[revisionId]/page.tsx`; `route-sheets.ts:109`; `export-role.ts:39 getExportPolicy`; `export-payload.ts:283` | S | eff(COST_VIEW) for cost | **yes** |
| Cable rates | `rate-library.actions.ts:39 listRateLibraryAction` | S | org(ROLES_ENGINEER) | no |
| Equipment | `lib/equipment-materials/load.ts:55 loadEquipmentMaterialsData(client, projectId)` | injected | RLS | no |
| Documents | inline `documents/page.tsx` | S | RLS | **yes** |
| Drawings | `floor-plan.service.ts:4 listByProject(client, projectId)`; `floor-plan-markup.actions.ts:95` | S | RLS | no |
| Tenant plans | `load-plan-page.ts:100 loadTenantPlanPage(client, …)` | S | eff(ORG_WRITE) inside for `canEdit` | no |
| Inspections | `inspections.actions.ts:429 listInspectionsAction`; detail inline in `inspections/[inspectionId]/page.tsx` | S / SVC | RLS | **detail** |
| Templates | `inspections-template.actions.ts:48 / :82` | S | requireFeature | no |
| Site forms | `site-forms.actions.ts:268 listProjectFormsAction`; detail inline | S | RLS / eff(FORMS_FIELD) | **detail** |
| Snags, visits | `snag.service.ts:6 list`; `snag-visit.service.ts:11 / :43 / :117` | S / SVC in page | notFound | no |
| QC | `qc.service.ts:88 / :134 / :284` | S | eff for controls | no |
| Diary | `diary.service.ts:55 list`, `:125 getWeeklySummary`, `:207 listAttachments` | S | RLS | no |
| RFIs | `rfi.service.ts:23 list`, `:49 getById` | S | RLS | no |
| Work items | inline `items/[ref]/page.tsx`; `WORK_ITEM_TYPES` | S | RLS | **yes** |
| Load profile | `lib/load-profile/load.ts:98 loadLoadProfileView` | S | eff(LOAD_PROFILE_READ) | no |
| Tender | `tender.actions.ts:67 / :275`; `tender-invite.actions.ts:81`; `load-adjudication.ts:25` | S | gateTender | no |
| BOQ | `boq.actions.ts:72 listBoqAction` | SVC after gate | eff(COST_VIEW) | no |
| Rate library | `lib/rate-library/data.ts:121 / :162 / :214 / :239` | S | org(COST_VIEW) | no |
| Valuations, variations | `valuation.actions.ts:124 / :154`; `variation.actions.ts:86 / :116` | SVC after gate | eff(COST_VIEW) | no |
| GCR | `gcr.actions.ts:69 loadGcrConfigAction` | S | eff(COST_VIEW) | no |
| Handover | inline | S | notFound | **yes** |
| Reports | `project-reports.actions.ts:161 / :209`; `report-kind-access.ts:38` | S + SVC | kind roles | no |
| Solar | `lib/solar/**` loaders; `lib/solar/access.ts:37 requireSolarLevel` | S | Solar level | no |
| Tariffs | `lib/tariffs/explorer-data.ts:37 …` | S | signed in | no |
| Standards | inline `(admin)/standards/page.tsx`; `sans-lookup.service.ts:455` | S | RLS | **yes** |
| Metrics | inline `(admin)/metrics/page.tsx` | S | page(OWNER_ADMIN) | **yes** |
| Org, members, suppliers | `active-organisation.actions.ts:52`; `org.service.ts:48`; `supplier.service.ts:4` | S / SVC | OWNER_ADMIN for members | no |

## Appendix B — existing preview → commit paths (types quoted from main)

- **Tenant schedule:** `parseTenantSchedule(buffer): TenantImportResult` → `diffTenantSchedule(rows, errors, nodes, warnings): ImportPreview { new_entries, updated_entries, conflict_entries, decommissioned_entries, parse_errors, warnings, parsed_row_count }`; commit re-parses; gate eff(ORG_WRITE).
- **Cable schedule:** `parseScheduleWorkbook(buffer): ImportPreview { schedule_sheet_name, schedule_header_row, detected_columns, cables: ImportedCable[], section_breaks, conductor_headers, placeholders_skipped, duplicate_tags, parallel_fanouts, legacy_format_detected }`; commit `CommitPayload { projectId, fileName, fileSizeBytes, intoRevisionId?, revisionDescription?, cables }`, refuses any `errors.length > 0`, DRAFT only; gate eff(ORG_WRITE).
- **BOQ:** `parseBoqXlsx(buffer): ParsedBoq` + `reconcile(parsed): ReconciliationReport`; `importBoqAction(projectId, parsed, sourceFilename, storagePath)`; gate COST_VIEW.
- **Tender:** `importTenderAction(tenderId, { sourcePath, sourceFilename, estimatePath?, estimateFilename? })`, one step, draft only, review report stored; gate gateTender.
- **Load profile:** `parseLoadProfileFileAction(projectId, path, fileName): ParseResult { parts: { sheet, plan: ImportPlan, summary }[] }` → `commitLoadProfileFileAction(projectId, { path, fileName, sheet, selections: ChannelSelection[] })`, re-parses; gate eff(ORG_WRITE).
- **Status plans:** detection in `packages/shared/src/status-plans/{detect-blocks,snap-blocks,match-nodes,detect-review}.ts`; `acceptDetectedBlocksAction({ sheetId, blocks: { points: number[8], nodeId, detectedTag }[] })`; `realignShapesAction({ sheetId, moves: { shapeId, expectedUpdatedAt, points }[] })`; gate eff(ORG_WRITE).
- **Rate library:** `previewPriceFromLibraryAction(projectId, statistic)` → `applyPriceFromLibraryAction(projectId, statistic, shown)`; `confirmGroupAction(groupKey, itemId)`; `addProjectBoqToLibraryAction`; gate COST_VIEW.
- **Solar:** meter files parse/commit (`CommitBody` union), schedule import parse → `commitScheduleImportAction`; gate Solar `edit`.
- **Floor-plan Shops scan → Link N** lives on `origin/feat/floor-plan-label-detection`, not on main; it is a candidate for slice 5 once merged.
