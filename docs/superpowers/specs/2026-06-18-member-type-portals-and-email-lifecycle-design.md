# Member-type portals & auth email lifecycle — design

Date: 2026-06-18
Status: Draft for review
Author: Arno (Watson Mattheus) + Claude

## 1. Context & goal

End-to-end review and redesign of how every member type accesses and experiences
e-site, plus a complete overhaul of the transactional auth email lifecycle (invite,
set-password, reset). Driving principle from the owner: **leave nothing as assumed** —
every access rule, portal surface and email is verified against code, confirmed, then
specified before build.

Two big architectural decisions were taken during design:

1. **True portals per member type** (not one shared admin shell with filtered nav).
2. **Client cost-visibility is granted per site, explicitly** — reversing the existing
   "no cost to client" guardrail in a controlled, scoped way.

## 2. Current state (verified from code)

- Stack: Next.js 15 App Router monorepo (`apps/web`, `apps/mobile`, `apps/edge-functions`,
  `packages/shared`), Supabase Postgres + RLS, Resend for some transactional mail.
- 7 org roles: `owner, admin, project_manager, contractor, inspector, supplier, client_viewer`
  (`packages/shared/src/types/index.ts`). Plus project-level overrides (`project_members`),
  a Cable-Schedule sub-role mapping, and per-seat / per-user feature gates.
- **No portal separation today:** every authenticated user lands in the same `(admin)`
  shell. `supplier` and `client_viewer` are never redirected out. Project-level nav is
  barely role-filtered — roles see menu items they can't use ("menu shown, action blocked").
- **Org-role vs project-role mismatch:** `ProjectRole` is only
  `project_manager | contractor | client_viewer`, so `inspector` and `supplier` are
  undefined at project scope.
- **WM bypass** is a hardcoded org id (`dddddddd-…-0001`) short-circuiting feature/MV
  access functions + a seeded enterprise subscription (migration 00133). Not a super-admin role.
- **GCR** (`gcr.*` schema): zones (= "generator banks") with `zone_generators`
  (`generator_size` kVA capacity, `generator_cost`), tenants (`structure.nodes` kind
  `tenant_db`: area, category, participation), `tenant_assignments` (node→zone, manual kW
  override), `settings`, immutable numbered `report_revisions`. Cost is apportioned
  **load-proportional** scheme-wide. RLS **explicitly blocks `client_viewer`** from GCR
  ("cost figures must never reach the client portal").
- **Email:** two inconsistent systems — Supabase native (unbranded: signup, recovery; and
  "invite" reuses the recovery email) + Resend (branded dark template: notifications,
  onboarding, and an `invite` template that is **never called**). Custom invite link points
  to `/onboarding/join` which has **no web route** (404 on desktop). No unsubscribe.

## 3. Target architecture — portals per member type (Option B)

Login resolves the user's primary role and routes to that portal's home. WM owner-org keeps
the cross-org command view.

| # | Portal | Route | Role(s) | Lands on | Key capability | Hidden |
|---|--------|-------|---------|----------|----------------|--------|
| 1 | Command Centre | `/command` | owner, admin | Org dashboard | Everything; org admin (users, billing, seats, sub-orgs, security), templates, all project tools, cross-org switch | — |
| 2 | Delivery | `/delivery` | project_manager | My managed projects | Full project tools, snag/COC **sign-off**, inspections-as-verifier, GCR admin, cost fields, project settings | org users/billing/sub-orgs, template authoring |
| 3 | Field | `/field` | contractor | Today's site work | Capture-first: raise/close snags, raise RFI, upload COC, site capture, diary; view cables/equipment | cost fields, settings, GCR, templates, org admin |
| 4 | Inspect | `/inspect` | inspector | Assigned inspections | Run assigned inspections, raise snags, site capture; **submits for verification** (cannot self-certify) | cost, settings, GCR, project mgmt, org admin |
| 5 | Supplier | `/supplier` | supplier | Orders dashboard | Orders, catalogue, company profile (Phase-2 marketplace) | all project/site tools, cost, admin |
| 6 | Client | `/portal` | client_viewer | My sites picker | Read-only site overview, **GCR review + comment/request**, compliance certs, handover docs | contractor cost inputs/margin, any editing, field tools, admin |

Decisions:
- **Field is desktop-first** (mobile optional), like the others.
- **Command Centre** = today's admin app + a new org-level **Client requests** inbox (the GCR
  review queue) + the cross-org switcher. Confirmed as-is otherwise.
- Each non-command portal is a strict subset; the same project tools render inside a project,
  gated by the corrected role model (§4).

## 4. Role-model corrections (shared enablers)

1. **Unify project role with org role** so `inspector` and `supplier` are first-class at
   project scope. Either extend `ProjectRole` to all org roles, or resolve project capability
   from org role + explicit `project_members` override consistently. Removes the "menu shown,
   action blocked" dead-ends by driving nav off real capability.
2. **Role-based nav + landing**: each portal filters nav to what the role can actually use and
   lands on a role-appropriate home.

## 5. Client portal — GCR review feature (detailed)

The feature that motivated the review. Lets a client see and comment on a site's generator
cost recovery without ever editing the live schedule.

### 5.1 Access model — per site, explicit
- **One client account; access granted per site, explicitly** (ticked site by site by an
  admin/PM). Default = **no sites**.
- Visibility is driven by a **dedicated client→site grant table** (e.g. `gcr_client_site_access`
  / a general `client_site_grants`), **not** by org-level `client_viewer` membership — otherwise
  org RLS over-shares every project in the org.
- A multi-site client logs in once and lands on a **"My sites" picker**, then drills into one
  site. Grants are keyed to the site (project), so a client may span sites across sub-orgs.

### 5.2 What the client sees — Option B (tenant-facing outputs only)
- **Visible:** per-tenant load (kW), assigned generator bank, each bank's installed capacity
  (kVA) + utilisation, per-tenant monthly cost + R/m², billed tariff (R/kWh).
- **Hidden (contractor-only):** generator capital costs, total capital cost, diesel/maintenance
  inputs and the tariff build-up, any margin.
- This reverses the old "no cost to client" guardrail to "**no contractor cost inputs** to
  client", scoped to GCR outputs on granted sites only.

### 5.3 Interaction — play, propose, submit
- Client may edit any figure to see the effect; **nothing is saved** (ephemeral what-if).
- An edit becomes a **captured proposal** (old → new) on that tenant; client attaches a
  comment. Proposable fields = editable **inputs only** (area, category, participation, zone,
  manual kW override) — never derived outputs.
- "Submit requests to admin" sends the batch (proposals + comments).

### 5.4 Data source — frozen snapshot
- Client reviews a **published revision snapshot**, not live data. Admin "publishes for client
  review"; requests pin to that revision. Extends the existing immutable `report_revisions` to
  carry the **full interactive dataset** (not just the PDF), or a parallel review-snapshot entity.

### 5.5 Admin handling
- Requests arrive in an in-app **Client requests** queue (per project, surfaced at org level in
  Command Centre) **plus** an email (via the unified system, like rfi/snag notifications).
- Each request shows tenant · field · old → proposed · comment, pinned to the reviewed revision.
- Admin actions: **Accept → auto-applies** the proposed value to the live schedule; Decline
  (with reason); Reply (thread). On the next publish, the client is notified.

## 6. Auth email lifecycle

### 6.1 System setup — unify on Resend via Supabase auth hook
- **All** auth emails (invite, set-password, reset, signup confirmation) are generated in-repo
  through **one branded template** and sent via Resend, triggered by the Supabase **auth email
  hook**. Single sender, single look, full control. **Applies to all invites**, every member type.
- Account-level mails (reset, signup) fall back to E-Site platform branding when there's no
  single org context; org-scoped mails (invites) are org-co-branded.

### 6.2 The emails (look & content)
- **Org-co-branded, clean light layout** (not the current generic dark "E-Site" template):
  org logo + accent (WM amber `#E69500`), "via E-Site", single clear CTA, expiry, paste-able
  fallback link, footer.
- **Invite** — role- and site-aware: "X invited you to {Org} on E-Site as a {Role}, to review
  {Site}." CTA "Accept invitation & set password" → working web route.
- **Reset** — "Reset your password" + button + **fallback one-time code**; valid 60 min.
- **Set-password page** — the destination for both invite-accept and reset; password +
  confirm + strength meter; includes the **OTP-code fallback** so scanner-burned links never
  dead-end.
- **Signup confirmation** — same template, platform-branded.

### 6.3 Flow fixes
- Implement a real **invite** (not a reset-link reuse): branded role-aware email →
  `/accept-invite?token=…` web route → set password → land in the role's portal.
- Use a real invite/grant record (the `org_invites` table and/or the client→site grant table)
  instead of the unused infrastructure.
- Keep the reset OTP-code-first resilience.

## 7. Public shares (unauthenticated)

- Surfaces: `/inspection/[shareToken]` (inspection certificate) and `/scan/site/tag/[text]`.
- **No new capability.** Brand-align headers with the org-co-branded look; confirm token
  scoping/expiry/revocation; **assert no cost/GCR data is ever exposed publicly** (GCR stays
  authenticated, client-portal-only). A secure per-revision GCR *share link* (the earlier
  "Option B" quick-view) is explicitly **deferred** — membership is the chosen path.

## 8. Security considerations

- The GCR cost-visibility reversal is **scoped**: client_viewer + per-site grant + outputs-only.
  New RLS must (a) allow a granted client to read only the published review snapshot for granted
  sites, (b) never expose contractor cost inputs, (c) leave org-level `client_viewer` unable to
  read raw `gcr.*` directly.
- Email hook runs server-side with the service role; tokens single-use + expiring.
- Preserve the WM owner-org bypass everywhere new gating is added.

## 9. Decision register (confirmed with owner)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Client GCR edit semantics | Edit = captured proposal (old→new) + comment |
| D2 | Client cost-visibility scope | Option B — tenant-facing outputs only |
| D3 | Client data source | Frozen snapshot (published revision) |
| D4 | Admin "Accept" behaviour | Auto-applies proposed value to live schedule |
| D5 | Client access grant | Per site, explicit, default none; dedicated grant table |
| D6 | Cross-sub-org client | Allowed — grant is keyed to the site |
| D7 | Portal model | True portals per member type (B) |
| D8 | Portal groupings | owner+admin together; contractor (Field) ≠ inspector (Inspect) |
| D9 | Field client target | Desktop-first, mobile optional |
| D10 | Email system | Unify on Resend via Supabase auth hook; all invites |
| D11 | Email branding | Org-co-branded, light layout |

## 10. Phased implementation plan (each independently shippable)

- **Phase 0 — Enablers:** role-model unification (inspector/supplier first-class), role-based
  login routing skeleton, per-site client→site grant table + RLS. *(no user-visible portal change yet)*
- **Phase 1 — Email lifecycle:** unified branded Resend-via-auth-hook; role-aware invite +
  `/accept-invite` + set-password page + reset (OTP fallback); retire the broken invite path.
- **Phase 2 — Client portal + GCR review:** publish-for-review snapshot, outputs-only read view,
  comments + captured proposals, submit, admin request queue, accept-auto-applies, notifications.
- **Phase 3 — Portal separation:** Command / Delivery / Field / Inspect landings + role-filtered
  nav; kill "menu shown, action blocked".
- **Phase 4 — Supplier portal:** only if/when marketplace leaves Phase-2 (currently in-dev) — likely deferred.
- **Phase 5 — Public shares:** brand-align + leakage assertion tests.

Each phase: branch → build → tests → PR → **owner-gated production deploy** (PR merge +
Supabase migration apply). State deploy cost before each.

## 11. Open assumptions (flag if wrong)

- "Site" = "project" throughout (Kingswalk Mall = one project).
- Snapshot extends `report_revisions` rather than a brand-new entity (TBD at plan time).
- Account-level emails may use platform branding; only invites must be org-branded.
- Supplier/marketplace stays deferred (Phase-2 in code).
