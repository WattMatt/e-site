# E-Site: Permissions Enforcement + ErrorBoundary Granularity

**Date:** 2026-04-14  
**Source:** graphify codebase analysis  
**Status:** Approved  
**Delivery:** Two sequential PRs

---

## Background

A graphify knowledge-graph run on the E-Site monorepo identified two actionable findings:

1. **Permissions dead code** — `packages/shared/src/utils/permissions.ts` defines 9 `can*` functions backed by a role-hierarchy map, but no web or mobile code calls them. The permission system exists and is correct; it is simply not wired up.
2. **Single error boundary** — one `ErrorBoundary` wraps the entire web app. A crash in the Sidebar kills the page and vice versa.

Format utilities (low cohesion signal from graphify) and god-node name collisions (`onSubmit`, `POST`, `GET`) were investigated and determined to be graph artefacts — no code changes needed.

---

## PR 1 — Permissions Enforcement

### Approach

`usePermissions()` hook on each platform feeds the current user's role into the shared `can*()` functions. No prop-drilling. No new abstractions. Server-side enforcement uses the same shared functions directly.

### 1. Shared layer (no changes to existing functions)

`packages/shared/src/utils/permissions.ts` is the single source of truth. All `can*` functions remain as-is. No modifications required.

### 2. Web — `usePermissions()` hook

**File:** `apps/web/src/hooks/usePermissions.ts`

- Client-only hook (`'use client'`)
- Reads `orgRole` from the Supabase session profile via `useAuth()` or direct Supabase client call
- Returns all `can*` functions pre-bound to the current user's role
- If role is undefined (profile loading), all permissions return `false` — nothing renders prematurely

```ts
// Shape
{
  canCreateProject: () => boolean
  canManageTeam: () => boolean
  canManageBilling: () => boolean
  canCreateSnag: () => boolean      // requires projectRole — returns false if no project context
  canSignOffSnag: () => boolean
  canManageProcurement: () => boolean
  canUploadCoc: () => boolean
  canCreateRfi: () => boolean
  isReadOnly: () => boolean
}
```

**File:** `apps/web/src/lib/getOrgRole.ts`

- Server-side helper (not a hook)
- Accepts a Supabase server client, returns `OrgRole | null`
- Used in server components and middleware for role resolution without a round-trip hook

### 3. Web — Middleware route blocking

**File:** `apps/web/src/middleware.ts` (extended)

After the existing auth check, read `org_role` from the Supabase JWT user metadata and redirect to `/403` for blocked routes:

| Route | Minimum role |
|---|---|
| `/settings/team` | `admin` |
| `/settings/billing` | `admin` |
| `/projects/new` | `project_manager` |
| `/procurement` | `project_manager` |

`org_role` is stored in Supabase `user_metadata` at org join time and updated on role change. This avoids a DB round-trip in middleware.

**File:** `apps/web/src/app/403/page.tsx` — simple static page: "You don't have permission to view this page." with a back link.

### 4. Web — Server component secondary guards

For pages where middleware is the fast path but not infallible, sensitive server components add a one-liner fallback:

```ts
const role = await getOrgRole(supabase)
if (!canCreateProject(role)) redirect('/403')
```

Applied to: `projects/new/page.tsx`, `settings/team/page.tsx`, `settings/billing/page.tsx`, `procurement/page.tsx`.

### 5. Web — Component-level UI adaptation

Action-initiating elements (buttons, form triggers, links to create/edit flows) are conditionally rendered using `usePermissions()`. Read views remain fully visible to all roles.

Key gating points:

| Component | Gate |
|---|---|
| Sidebar "+ Project" link | `canCreateProject()` |
| Settings/Team `<InviteForm>` | `canManageTeam()` |
| Procurement `<ProcurementStatusButton>` | `canManageProcurement()` |
| Compliance `<CocUploadButton>` | `canUploadCoc()` |
| Project detail "+ Snag" button | `canCreateSnag()` |
| RFI `<RfiRespondForm>` | `canCreateRfi()` |
| RFI `<RfiCloseButton>` | `canManageProcurement()` (project_manager+) |

### 6. Mobile — `usePermissions()` hook

**File:** `apps/mobile/src/hooks/usePermissions.ts`

- Reads `orgRole` from `useAuth()` → `profile.user_organisations[0].role`
- Same return shape as web hook
- Role defaults to most restrictive if profile is loading

Key gating points on mobile:

| Screen | Gate |
|---|---|
| Project detail "+ New Snag" | `canCreateSnag()` |
| Project detail "+ New RFI" | `canCreateRfi()` |
| Snag detail sign-off button | `canSignOffSnag()` |
| RFI detail respond form | `canCreateRfi()` |
| RFI detail close button | `canSignOffSnag()` (project_manager) |

### 7. Org service update

When a member's role changes, update `user_metadata.org_role` in Supabase Auth so the middleware JWT claim stays current. Add this to `orgService.updateMemberRole()` in the shared org service.

---

## PR 2 — Section-level ErrorBoundary + God Node Audit

### 1. Section-level boundaries

**Current:** one `ErrorBoundary` wraps the entire app.

**After:**

```
ErrorBoundary (root — AppCrash fallback)
  └─ div.flex
       ├─ ErrorBoundary (sidebar — SidebarFallback)
       │    └─ <Sidebar />
       └─ ErrorBoundary (main — PageFallback)
            └─ <main>{children}</main>
```

**Three fallback components** added to `apps/web/src/components/providers/`:

- `AppCrash` — full-screen fallback, reload button, used only if both inner boundaries fail simultaneously
- `SidebarFallback` — sidebar-width panel, hardcoded plain `<a>` links to main routes (no JS required), so navigation remains usable even if the Sidebar component crashes
- `PageFallback` — centred card "This section failed to load", retry button calling `window.location.reload()`

**Mobile:** no change. Expo's native crash handler manages JS errors; `AuthProvider` already handles profile load failures gracefully.

### 2. God node audit (documentation only)

`onSubmit`, `POST()`, and `GET()` appeared as high-degree god nodes in the graphify graph. Investigation confirms these are graph artefacts — shared function names across unrelated files create false coupling in AST graphs. No code changes required.

For future graphify runs, add a `graphify-out/.graphify_ignore` noting these false positives so they can be filtered.

---

## What is explicitly out of scope

- Project-role enforcement (snag create/sign-off within a project requires knowing the user's `project_members.role` for that specific project — this adds a per-project DB lookup and is a Phase 2 concern)
- Format utility changes (no action needed)
- Mobile error boundaries (Expo handles this natively)
- Any new features or UI changes beyond hiding/showing existing elements

---

## Delivery order

1. **PR 1** — Permissions (shared hook → middleware → server guards → component gating)
2. **PR 2** — ErrorBoundary (after PR 1 merges, independent of permissions work)
