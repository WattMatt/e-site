# Unified Notification System — Design Spec

**Date:** 2026-06-24 · **Status:** approved (decisions locked), building Phase 1

## Goal
One notification system across **RFI, Snags, Site Diary**: every event notifies
**every current member with access to the site** via in-app bell (+push) and
email. Recipients resolved **live at send time** — never a snapshot.

## Locked decisions
| # | Decision |
|---|---|
| Recipients | Everyone with site access = **active explicit `project_members` ∪ implicit org `owner/admin/project_manager`**. Re-resolved on every send (no caching). |
| Domain | **`e-site.live`** is the single source of truth (sender + email links + web `NEXT_PUBLIC_SITE_URL`). Must be the verified Resend domain. |
| Snag emails | Email full roster on **create + status change + sign-off**. |
| Diary emails | Email full roster on **every entry**. |
| RFI emails | Keep create; **add response + close** for parity. |
| `notifyRfiTo` | **Drop** (settable-but-ignored dead field). |
| Per-module toggles | `notifyRfiEmail` (exists, default true) + add `notifySnagEmail`, `notifyDiaryEmail` (default true). |

## Canonical recipient model (live, SQL)
New `SECURITY DEFINER` function `public.project_notification_recipients(p_project_id, p_exclude_user)`
returning `(user_id, email, full_name)`, reusing the **exact** access predicates from
`00106_relax_user_has_project_access` (clause A explicit members + clause B implicit org admins):

```
(A) projects.project_members (is_active) ⋈ user_organisations (is_active)  WHERE project_id = P
UNION
(B) user_organisations (is_active, role IN owner/admin/project_manager)    WHERE org = P's org
→ JOIN public.profiles (email)
→ exclude p_exclude_user
```
Runs at call time → always current. `row_security off` (no RLS recursion). Web dedupes by lowercased email + filters invalid (existing `buildRfiEmailRecipients`). Fixes the gap where org owners/admins (never `project_members` rows per the `00002:46` CHECK) currently receive **nothing**.

## Unified design (DRY)
- **`resolveProjectRecipients(projectId, { excludeUserId })`** (`apps/web/src/lib/recipients.ts`) — service-role RPC wrapper over the SQL function → `{ userIds, emails }`.
- **`notifyEntityEvent({ projectId, actorId, entityType, entityId, route, bell, email })`** (`apps/web/src/lib/notify.ts`) — resolves recipients once, fires `dispatchNotification` (bell+push, never-throw) and, if the module toggle is on, renders + batch-sends email via the `send-email` passthrough. Single path for all modules.
- **Template registry** (`packages/shared/src/email/`) — `renderRfiCreatedEmail` + add `renderSnagCreatedEmail`, `renderDiaryCreatedEmail` sharing `baseEmailTemplate`. The `send-email` edge fn keeps the batch passthrough (`{to[],subject,html}`); add `snag-created`/`diary-created` types (or a generic passthrough), delete dead `snag-assigned`.

## Phased build (each shippable)
- **P1 — Foundations + RFI:** SQL function (migration 00146) + `resolveProjectRecipients` + `notifyEntityEvent`; refactor RFI create to use them (now includes implicit admins). Add RFI response/close email. Verify resolver includes an org-admin with no `project_members` row.
- **P2 — Snags:** `notifySnagEmail` column/schema/toggle; `renderSnagCreatedEmail`; `snag-created` passthrough; wire create (web/mobile/visit) + status + sign-off through `notifyEntityEvent`.
- **P3 — Site diary:** `notifyDiaryEmail`; `renderDiaryCreatedEmail`; `diary-created` passthrough; wire create (web/mobile).
- **P4 — Domain unification:** collapse to `e-site.live` across FROM/SITE_URL/NEXT_PUBLIC_SITE_URL; fix hardcoded footer labels; optional Reply-To.

## Out of scope (later)
Per-tenant sender override (needs per-tenant Resend verification); diary digest; inspection email; mobile push for invited-but-unregistered users (no profile yet).
