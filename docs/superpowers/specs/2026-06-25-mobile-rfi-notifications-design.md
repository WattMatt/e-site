# Mobile-created RFIs notify the whole project team — design

**Date:** 2026-06-25
**Branch:** `feat/rfi-notifications`
**Status:** Approved

## Problem

RFIs created from the Expo mobile app (`apps/mobile/app/rfis/create.tsx`) call
`rfiService.create` directly and dispatch **no notifications**. Only the web
path (`createRfiAction`) fans out the in-app bell + email to all active project
members (shipped for web in PR #99). So **RFIs raised on mobile notify nobody**,
breaking the team-wide notification model. A future "floor-plan markup" caller
of `rfiService.create` would have the same gap.

## Goal

Make every RFI create — web, mobile, and any future caller — notify the whole
active project roster (bell via `send-notification`, email via `send-email`
`rfi-created`), identical to web today, with **no service-role key on the
device** and **no new database infrastructure**.

## Chosen approach

A single new edge function, **`notify-rfi-created`**, invoked from **inside
`rfiService.create`** (the one shared code path all clients already use). The
shared service forwards the caller's own JWT via `client.functions.invoke`; the
function holds the service role and does the entire fan-out.

### Why this over the alternatives

- **Postgres trigger on `projects.rfis` INSERT** — most bulletproof, but the
  `pg_net` / `net.http_post` pattern is only commented-out boilerplate in this
  repo (never enabled in prod). It would require enabling `pg_net` **and storing
  the service-role key inside Postgres** (`app.settings`/vault) — a new secret
  surface inconsistent with the "secrets live in the function env" topology.
  Async fan-out is also harder to assert in tests. Rejected: infra cost not
  justified.
- **Explicit `notify` call per client** — smallest diff, but reintroduces the
  exact drift risk we are fixing (a caller can forget). Rejected.
- **Invoke from inside `rfiService.create`** (chosen) — drift-proof at the one
  shared choke point, zero new DB infra, service role stays server-side.

## Architecture

### Components

1. **`notify-rfi-created` edge function** (new) —
   `apps/edge-functions/supabase/functions/notify-rfi-created/index.ts`
   - **Input:** `{ rfiId: string }`.
   - **Abuse guard — forgery-proof, independent of the gateway `verify_jwt`
     setting** (deliberately NOT trusting a base64-decoded JWT claim — that was a
     past auth-bypass, see [[rfi-notifications-feature]]). Authorize only if the
     bearer is the **service-role key** (constant-time compare) **or** a user JWT
     that **validates via `auth.getUser`** AND whose id `=== rfis.raised_by`.
     Otherwise `403`. Stops an authed user from triggering a fan-out for an
     arbitrary `rfiId`.
   - With a service-role client it resolves everything from `rfiId` alone:
     the `rfis` row (`subject, priority, due_date, raised_by, assigned_to,
     project_id, organisation_id`), the project `name`, the `notify_rfi_email`
     toggle, and the **audience via the canonical
     `project_notification_recipients(p_project_id, p_exclude_user)` SQL
     function** (migration 00146 — active explicit `project_members` UNION
     implicit org owners/admins/PMs; `SECURITY DEFINER`, granted to
     `service_role`). This is the same source web's notify path uses
     (`apps/web/src/lib/recipients.ts`), so the two cannot drift. The bell calls
     it with `p_exclude_user = raised_by`; the email with `p_exclude_user = null`
     (raiser included).
   - **Bell channel:** POST to existing `send-notification` (service-role
     bearer) with:
     - `userIds` = the RPC audience − raiser
     - `title` = `New RFI raised`
     - `body` = `"{subject}" — {priority} priority[ · due {dueDate}]`
     - `data.route` = `/rfis/{rfiId}`, `type` = `rfi_created`,
       `entityType` = `rfi`, `entityId` = `rfiId`
   - **Email channel:** if `notifyRfiEmail` is on, render the dark-card HTML in
     Deno (a **lockstep mirror** of `renderRfiCreatedEmail` /
     `buildRfiEmailRecipients` in `packages/shared/src/email/rfi-email.ts` —
     carry a `keep in lockstep` header comment, matching the repo convention
     used by `calculate-health-scores` / `payment-recovery-check`). POST one
     batched `send-email` call: `{ type: 'rfi-created', payload: { to:
     recipients[], subject, html } }`. Recipients = deduped emails from the RPC
     roster (raiser included), gated by the toggle; raiser/assignee display
     names come from a small `profiles` lookup, mirroring web's `dispatchRfiEmail`.
   - Best-effort internally: never throws; logs failures; returns a tally.
   - `send-notification` and `send-email` are **unchanged**.

2. **`rfiService.create`** (`packages/shared/src/services/rfi.service.ts`) —
   after the insert succeeds, add the single best-effort invoke that every
   caller inherits:
   ```ts
   try {
     await client.functions.invoke('notify-rfi-created', { body: { rfiId: data.id } })
   } catch {
     // best-effort: a notification failure must never fail RFI creation
   }
   ```
   `client.functions.invoke` forwards the signed-in user's access token (mobile
   session JWT or the web server client's session), so no service key reaches
   the device.

3. **Web `createRfiAction`** (`apps/web/src/actions/rfi.actions.ts`) — remove
   the now-redundant fan-out so creation does not double-notify:
   - Delete the in-app bell block (the `project_members` read +
     `dispatchNotification` call).
   - Delete the `dispatchRfiEmail` call.
   - Keep auth/org resolution, `trackServer(RFI_CREATED)`, `revalidatePath`.
   - `dispatchNotification` is still used by `respondToRfiAction` /
     `closeRfiAction`, so the helper and its import stay.

4. **Orphan cleanup** — `dispatchRfiEmail` (`apps/web/src/lib/rfi-email.ts`)
   becomes unused once `createRfiAction` stops calling it. Remove the file and
   its `apps/web/src/lib/rfi-email.integration.test.ts` (superseded by the new
   e2e test below). The pure helpers `buildRfiEmailRecipients` /
   `renderRfiCreatedEmail` stay in `packages/shared` (still the canonical
   reference for the Deno mirror, and still unit-tested).

### Data flow (mobile create)

```
create.tsx → rfiService.create(client, …)
  └─ INSERT projects.rfis (status 'open')           [user RLS]
  └─ client.functions.invoke('notify-rfi-created', { rfiId })   [user JWT]
       └─ notify-rfi-created (service role)
            ├─ guard: jwt.sub === rfi.raised_by || service_role
            ├─ resolve roster / profiles / project / toggle
            ├─ POST send-notification  → inserts public.notifications + Expo push
            └─ POST send-email (if toggle) → Resend batch
```

## Error handling

- `rfiService.create`: the invoke is wrapped in try/catch and swallowed — the
  insert result is returned regardless. Matches the never-throw contract of the
  web dispatch helpers.
- `notify-rfi-created`: each downstream POST is best-effort; a failure of one
  channel must not block the other. Returns a tally for log inspection.
- **Deploy order is critical.** `notify-rfi-created` must be deployed to prod
  **before** the web/shared bundle ships. Once `createRfiAction` stops
  dispatching inline, ALL RFI notifications (web *and* mobile) flow through the
  function — if the web change deploys first, every RFI silently notifies nobody
  until the function lands (invokes 404 → swallowed best-effort; creation still
  succeeds, but no bell/email). The edge-function deploy workflow is manual
  (`workflow_dispatch`) while Vercel auto-deploys `main`, so: run
  `Deploy Edge Functions` (or `supabase functions deploy notify-rfi-created`)
  FIRST, confirm it's live, THEN merge to `main`.

## Testing

Gated live-DB integration test (mirrors `rfi-email.integration.test.ts`'s
gating + fixture setup), new file
`apps/web/src/lib/rfi-notification.integration.test.ts` (or a mobile/shared
equivalent):

- Gate: `RUN_INTEGRATION_TESTS=true` + Supabase env. **Also requires local edge
  functions served** (`supabase functions serve`) because the fan-out is now
  out-of-process — documented in the test header.
- Fixture: org + project + 4 users (assignee, raiser, member3, inactive) +
  roster (3 active, 1 inactive), same as the existing test.
- Act: a **mobile-style** `rfiService.create` performed as the raiser (signed-in
  user client, or service-role client impersonating the raiser path) for the
  fixture project.
- Assert (bell channel — fully observable in `public.notifications`):
  - exactly the active members **except the raiser** get a row (assignee +
    member3); **not** the inactive member, **not** non-members.
  - each row: `type = 'rfi_created'`, `entity_id = rfiId`,
    `action_url = '/rfis/{rfiId}'`.
- Email recipient logic remains covered by the existing pure unit test of
  `buildRfiEmailRecipients`.

Success criteria: with functions served and the toggle’s default, a mobile-style
create produces bell rows for every active member minus the raiser, and zero
rows for inactive/non-members.

## Out of scope

- Changing `send-notification` / `send-email` contracts.
- Notifications for RFI respond/close (already handled by `dispatchNotification`).
- A `pg_net` trigger or any database HTTP infrastructure.
- An opt-out flag on `rfiService.create` (YAGNI — add only if a bulk importer
  needs it).
