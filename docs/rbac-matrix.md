# RBAC Matrix

The contract for "who can see/do what" across E-Site. **Every new route or
API endpoint must be added here in the same PR that introduces it.** If a
cell is wrong, the gate is wrong — file a bug.

The codebase has 7 org-level roles, defined in
[`packages/shared/src/types/index.ts`](../packages/shared/src/types/index.ts).
A user can hold different roles in different organisations (multi-tenancy),
and the marketplace `supplier` role is independent of the contractor-side
membership.

## Legend

| Symbol | Meaning |
|---|---|
| **W** | Can view *and* mutate (full CRUD as the route allows) |
| **R** | Read-only — page renders or GET returns data, but writes are blocked |
| **—** | No access — page redirects, or API returns 401/403/404 |
| **?** | Behaviour not verified; flag for audit |

## Roles

| Role | Typical persona |
|---|---|
| `owner` | Founder / main contractor — full control incl. billing |
| `admin` | Senior team lead — full operational control, no billing |
| `project_manager` | PM scoped to one or more projects |
| `contractor` | Site team — read/write project data, no admin |
| `inspector` | Third-party compliance auditor — inspections only, paywall-gated |
| `supplier` | Marketplace seller — supplier portal only |
| `client_viewer` | Client / external rep — project-scoped read-only |

## Page routes (`apps/web/src/app/(admin)/*`)

| Route | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `/dashboard` | W | W | W | W | W | W | R |
| `/projects` (list) | W | W | W | W | R | — | R |
| `/projects/[id]` (overview) | W | W | W | W | R | — | R |
| `/projects/[id]/snags` | W | W | W | W | R | — | R |
| `/projects/[id]/diary` | W | W | W | W | R | — | R |
| `/projects/[id]/cables` | W | W | W | W | — | — | R¹ |
| `/projects/[id]/equipment-schedule` | W | W | W | W | — | — | R¹ |
| `/projects/[id]/tenant-schedule` | W | W | W | W | — | — | R¹ |
| `/projects/[id]/floor-plans` | W | W | W | W | R | — | R |
| `/projects/[id]/handover` | W | W | W | R | R | — | R |
| `/projects/[id]/inspections` | W² | W² | W² | R² | W² | — | R² |
| `/rfis?projectId=…` | W | W | W | W | R | — | R |
| `/inspections/templates` | W² | W² | R² | — | — | — | — |
| `/inspections/unlock` | W | R | R | — | — | — | — |
| `/marketplace` | W³ | W³ | W³ | W³ | — | — | — |
| `/marketplace/supplier/*` | — | — | — | — | — | W | — |
| `/site` (site capture) | W | W | W | W | W | — | — |
| `/cable-schedule/sans` | R | R | R | R | R | R | R |
| `/settings` | W | W | — | — | — | — | — |
| `/settings/billing` | W | W | — | — | — | — | — |
| `/settings/users` | W | W | — | — | — | — | — |
| `/settings/organisation` | W | W | ? | — | — | — | — |
| `/settings/integrations` | W | W | ? | — | — | — | — |

¹ `client_viewer` exports redact cost columns ([`export-role.ts:104`](../apps/web/src/lib/cable-schedule/export-role.ts:104)).
² All inspections access requires `public.has_feature(org_id, 'inspections') = true` — the paywall layer comes before the role check. WM-Consulting bypasses.
³ Marketplace is Phase 2-gated by `NEXT_PUBLIC_PHASE_2_MARKETPLACE=true`.

## API routes (`apps/web/src/app/api/*`)

| Endpoint | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `POST /api/paystack/checkout` | W | W | — | — | — | — | — |
| `POST /api/paystack/cancel-subscription` | W | W | — | — | — | — | — |
| `POST /api/paystack/callback` | n/a — public webhook, signature-validated |
| `POST /api/inspections/delete-photo` | W | W | W | W² | W² | — | — |
| `POST /api/notifications/dispatch` | bearer-token; not session-gated — **not yet audited** |

## Public / unauthenticated

| Route | Access |
|---|---|
| `/login`, `/signup`, `/forgot-password` | Public |
| `/inspection/[token]` | Public; signed COC share link (expires) |
| `/(portal)/compliance` | Public; client view of approved COCs |

## How to add a new route

1. **Server-side gate.** Use one of these:
   - Server component / page → `requireRolePage(allowedRoles)` from [`@/lib/auth/require-role`](../apps/web/src/lib/auth/require-role.ts). Redirects on failure.
   - API route → `requireRoleAPI(allowedRoles, orgId?)`. Returns `NextResponse` on failure.
   - Server action with an entity-bound org id → `requireRole(supabase, orgId, allowedRoles)` (primitive).
2. **Constants.** Import role groups from `@esite/shared`: `OWNER_ADMIN`, `ORG_WRITE_ROLES`. Don't hardcode `['owner','admin']` arrays — drift surface.
3. **Update this matrix.** Add a row with the verified W/R/— cells for each role.
4. **RLS.** Confirm Postgres RLS independently denies cross-org reads/writes. The app-layer gate should not be load-bearing — RLS is the backstop.

## Known gaps & open audits

These are tracked outside this doc:

- **Supplier portal isolation.** No `(supplier)` route group exists; suppliers reach `(admin)/*` and rely on per-page gates. Audit whether every page either redirects suppliers or semantically tolerates supplier access.
- **`/api/notifications/dispatch` bearer auth.** Confirm the bearer secret is required, rate-limited, and the dispatch payload can't leak cross-org notifications.
- **Cable-schedule RLS.** App-layer gates are present ([`require-role.ts`](../apps/web/src/lib/cable-schedule/require-role.ts)); verify RLS denies cross-org access independently.
- **Multi-org users.** `getOrgContext()` resolves the *oldest* membership, not a user-selected current org. Role checks for users in multiple orgs may apply against the wrong org. Out of scope until multi-org UX exists.
- **Cells marked `?`.** `/settings/organisation` and `/settings/integrations` for `project_manager` — behaviour not yet verified end-to-end.
