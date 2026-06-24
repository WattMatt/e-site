# RFI Notifications — Design Spec

**Date:** 2026-06-24
**Status:** Approved (design), pending implementation
**Author:** investigation + build session

## Problem

RFIs were landing unassigned (fixed separately: schema coercion + project-default
resolution in `rfiService.create`, migration `00143` for diary RLS). This spec
covers the **notification** side: making sure the right people are actually told
when an RFI is raised, on both channels.

Current state discovered during investigation:

- **In-app bell + mobile push — WIRED.** `createRfiAction` → `dispatchNotification`
  → `send-notification` edge fn → inserts a `public.notifications` row (web bell
  `NotificationCentre.tsx`) **and** sends an Expo push. Body carries the
  description; `action_url = /rfis/<id>` is the link. After the assignee fix it
  targets the resolved/default assignee. Needs runtime verification only.
- **Email — NOT WIRED.** `send-email` has an `rfi-assigned` template (with
  description + "View RFI" link) but its only caller is PAIA data-requests. The
  `notifyRfiEmail` toggle + `notifyRfiTo` list + `getNotificationConfig` accessor
  are orphaned (zero callers — same dead-code pattern as the old `getRfiDefaults`).
  Provider is **Resend** (needs `RESEND_API_KEY`; Mailpit cannot catch it).

## Goal

When an RFI is created, send an email (description + deep link) to the **assignee,
the raiser, and the project `notifyRfiTo` list**, gated by the project
`notifyRfiEmail` toggle. In-app/push behaviour is unchanged. Email is **create-only**.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Recipients | **all active `project_members`** (+ assignee/raiser defensively), deduped by lowercased email. (Superseded the earlier assignee+raiser+`notifyRfiTo` model — roster-driven so new members are auto-included; `notifyRfiTo` no longer drives RFI recipients.) |
| Gating | `notifyRfiEmail` toggle gates **all** RFI email (off → none) |
| Triggers | created/assigned only (respond/close = later follow-up) |
| Self-skip | **none** for email — the raiser gets a "logged & assigned" email even if they are the actor. (In-app push keeps its existing skip-self for the assignee.) |
| Provider | Resend (existing `send-email` edge fn) |
| Test depth | full pyramid: unit → live-DB integration → edge-fn → Playwright e2e → manual |

## Architecture

Additive second channel mirroring `dispatchNotification`. No changes to the
in-app/push path. No DB triggers. No generic notification engine (YAGNI).

```
createRfiAction
  ├─ rfiService.create (resolves default assignee)        [done]
  ├─ dispatchNotification(...)  → send-notification        [existing, unchanged]
  └─ dispatchRfiEmail(...)      → send-email (rfi-created)  [NEW, best-effort]
```

## Components

### 1. `buildRfiEmailRecipients(args)` — pure, `packages/shared`
Inputs: `{ notifyRfiEmail: boolean, assignee?: {email}, raiser?: {email},
notifyRfiTo: string[] }`. Returns `{ to: string }[]` deduped by lowercased email.
Rule: `notifyRfiEmail === false` → `[]`. Otherwise union of assignee + raiser +
list, filtered to valid non-empty emails, deduped. Pure → unit-tested in isolation.

### 2. `renderRfiCreatedEmail(payload)` — pure, edge `_shared/email-templates/`
Recipient-neutral template (replaces the dead `rfi-assigned`). Returns
`{ subject, html }`. Subject: `New RFI: <subject>`. HTML body states project,
raised-by, **assignee (or "Unassigned")**, subject/priority/due (the description),
and a **"View RFI" button → `${SITE_URL}/rfis/<id>`** (the link). Pure (template
literals only) → unit-tested; asserts link + description present. `send-email`
gains a `type: 'rfi-created'` branch that calls it.

### 3. `dispatchRfiEmail(args)` — web lib, best-effort never-throws
Like `dispatchNotification`. Reads `getNotificationConfig(projectId)`; if `rfiEmail`
off → return. Fetches project name + assignee/raiser profiles (name+email), builds
recipients via (1), invokes `send-email` (`type: 'rfi-created'`) **once per
recipient** (personalised, privacy-safe). All failures logged, never surfaced.
Requires `SUPABASE_SERVICE_ROLE_KEY` (service-role invoke); no-ops if absent.

### 4. `createRfiAction` — one added call
After the existing `dispatchNotification`, `await dispatchRfiEmail(...)`.

## Data flow

`createRfiAction` resolves assignee → ① in-app+push to resolved assignee
(existing) → ② email to assignee+raiser+`notifyRfiTo`, gated on `notifyRfiEmail`
(new). Both awaited, both best-effort.

## Error handling

Email is best-effort: `dispatchRfiEmail` never throws (matches
`dispatchNotification`'s contract) so a Resend/edge failure never blocks RFI
creation or surfaces to the user. Failures `console.error`-logged for ops.

## Testing (full pyramid)

| Layer | Coverage |
|---|---|
| Unit (vitest, shared) | `buildRfiEmailRecipients`: empty-when-off, dedup, valid-email filter, union. `renderRfiCreatedEmail`: subject, **link present**, **description present**, "Unassigned" fallback |
| Integration (live local Supabase + `functions serve`) | extend the gated integration test: RFI create → **bell** row exists with `action_url=/rfis/<id>` + body; `send-email` invoked with the expected recipients + payload (asserted at the fetch boundary) |
| Edge-fn | `send-notification` persists row (exists); `send-email` `rfi-created` branch builds correct payload |
| E2E (Playwright, extend `05c-rfis.spec.ts`) | create RFI → bell badge +1 → click → navigates to `/rfis/<id>` |
| Manual (Preview/Chrome MCP) | submit RFI, eyeball the bell; render the email HTML; one real Resend send to a test inbox **only if** `RESEND_API_KEY` set (Mailpit can't catch Resend — honest local limit) |

## Out of scope (follow-ups)

- Respond/close emails (need `rfi-response` / `rfi-closed` templates).
- Mobile push automated e2e (needs a device + Expo token).
- Hardening the diary create path (separate task chip).
- Fixing `db:reset` 00138 FK (separate task chip).
- Web RFI success toast; mobile assignee picker.
```
