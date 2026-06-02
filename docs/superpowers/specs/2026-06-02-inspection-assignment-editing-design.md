# Inspection assignment — editable Inspector/Verifier + name-resolution fix

**Date:** 2026-06-02
**Status:** Design — approved, pending spec review
**Author:** Arno (with Claude)

---

## 1. Problem statement

Two related issues in the inspections feature:

1. **Cannot edit assigned members.** An inspection's Inspector (`assigned_to_id`) and Verifier (`verifier_id`) are set once, at creation, by `AssignmentForm` → `createInspectionAction`. There is no action or UI to change them afterward.
2. **Assignment dropdown shows a "database code" instead of names.** When picking a member, the dropdown renders an 8-character UUID fragment rather than the person's name. The same breakage hides the verifier name on the inspection detail page.

Both are scoped to the single-Inspector / single-Verifier model that exists today (confirmed with the user — no many-to-many).

---

## 2. Root cause (issue 2)

`listProjectMembersAction` resolves member names with the caller's **RLS-bound** Supabase client:

```ts
// apps/web/src/actions/inspections.actions.ts:178
supabase.from('profiles').select('id, full_name, email').in('id', userIds)
```

`public.profiles` is locked down by RLS (`apps/edge-functions/supabase/migrations/00009_rls_policies.sql:76-89`): a cookie/RLS client effectively reads only the **viewer's own** profile row. Every other member's `full_name`/`email` returns `null`, so the dropdown label falls back to the UUID slice:

```ts
// apps/web/src/app/(admin)/projects/[id]/inspections/new/AssignmentForm.tsx:135
const labelFor = (m: Member) => m.full_name ?? m.email ?? m.user_id.slice(0, 8)
```

**Evidence:** the *settings* members list does NOT have this bug because it was already fixed during the membership-system work. `apps/web/src/actions/project-members.actions.ts:96-138` documents the exact trap ("the cookie client can only ever see the *viewer's* identity") and resolves names with `createServiceClient()` (service-role, bypasses RLS) **after** a role gate. The two inspections reads predate that pattern and were never updated.

**Architecture-or-symptom check:** symptom-level bug. The design (resolve names server-side, after an access gate) is correct; two older functions simply use the wrong client. Fix = apply the proven sibling pattern. (Loosening `profiles` RLS was rejected — wide blast radius on a sensitive table.)

### Three affected read sites
| Site | File:line | Symptom |
|---|---|---|
| Member dropdowns (assignee + verifier) | `inspections.actions.ts:178` (`listProjectMembersAction`) | UUID slice instead of name |
| Inspections list view | `inspections.actions.ts:306-317` (`listInspectionsAction`) | assignee/verifier names blank/code |
| Detail page header | `…/[inspectionId]/page.tsx:77-85` | verifier line silently disappears for non-self verifiers |

---

## 3. Decisions (from brainstorming)

- **Assignment model:** keep single Inspector + single Verifier. No schema change.
- **When editable:** **any status**, including `certified` and `abandoned` (maximum flexibility).
- **Who can edit:** owner / admin / project_manager — identical to who can create.
- **Notifications on reassignment:** notify **only the new Inspector**, and only when the Inspector actually changed and isn't the actor. Do not notify the previous Inspector or the Verifier (parity with create; easy to extend later).
- **Known implication accepted:** reassigning a `certified` inspection changes the `verifier_id`/`assigned_to_id` FKs, but a COC document generated at certify time is a point-in-time artifact and will not retroactively update. Allowed as requested; no confirm-prompt for v1.

---

## 4. Design

### Part 1 — Fix name resolution

Apply the `project-members.actions.ts` pattern (service-role read after an access gate) to all three sites.

**`listProjectMembersAction`** (`inspections.actions.ts:162`)
- Resolve the project's `organisation_id`, then gate: `requireRole(supabase, orgId, <all active roles>)`. On gate failure return `[]` (preserves the current `Member[]` contract; callers are already page-gated, so this is defense-in-depth).
- Select `user_id, organisation_id` from `project_members`.
- Resolve `profiles` (by `user_id`) and `user_organisations.role` (keyed by `user_id|organisation_id`, cross-org safe) via `createServiceClient()`.
- Return shape unchanged: `{ user_id, full_name, email, role }[]`.

**`listInspectionsAction`** (`inspections.actions.ts:306-317`)
- The `inspections` SELECT is already RLS-gated — returned rows prove the caller has project access. Hydrate assignee/verifier names via `createServiceClient()`. No extra gate needed (the RLS read *is* the gate). Add a one-line comment stating this.

**Detail page** (`…/[inspectionId]/page.tsx:77-85`)
- The inspection-row read is RLS-gated (a returned row proves access). Resolve the verifier **and** inspector names via `createServiceClient()` for display.

### Part 2 — Edit Inspector + Verifier

**New server action `updateInspectionAssignmentAction`** (`inspections.actions.ts`)
```ts
updateInspectionAssignmentAction(input: {
  inspectionId: string
  projectId: string
  organisationId: string
  assignedToId: string | null   // Inspector — optional (may be unassigned)
  verifierId: string            // Verifier — required (mirrors create)
}): Promise<void>               // throws on failure; client catches (matches AssignmentForm)
```
- Gate: `requirePmOrAbove(supabase, organisationId)` + `requireFeature(organisationId, 'inspections', supabase)` — identical to `createInspectionAction`.
- Read the current `assigned_to_id` (to detect a real change), then `UPDATE inspections.inspections SET assigned_to_id, verifier_id WHERE id = inspectionId`.
- **No status guard** (any status editable).
- If `assignedToId && assignedToId !== oldAssignedToId && assignedToId !== user.id` → `dispatchNotification` with the same `inspection_assigned` payload create uses.
- `revalidatePath` the detail page and the inspections list.
- Verifier-eligibility is enforced client-side only (parity with create — create has no server-side verifier-role check).

**New client component `AssignmentEditor.tsx`** (`…/[inspectionId]/AssignmentEditor.tsx`)
- Props: `{ inspectionId, projectId, organisationId, members: Member[], initialAssignedToId, initialVerifierId, canEdit }`.
- `canEdit === false` → render read-only `Inspector: … · Verifier: …`.
- `canEdit === true` → two `<select>`s pre-filled with current values; Inspector list = all members, Verifier list = members whose role ∈ {owner, admin, project_manager} (reuse `AssignmentForm`'s `labelFor` + `VERIFIER_ROLES`). Save button + inline error.
- On save: `await updateInspectionAssignmentAction({...})` then `router.refresh()`.
- **All hooks unconditional, above any early return** (React #310 lesson — `StickySaveBar`/`OrgSwitcher` regressions).

**Detail-page wiring** (`…/[inspectionId]/page.tsx`)
- Fetch members via the fixed `listProjectMembersAction(projectId)`.
- Compute `canEdit = ['owner','admin','project_manager'].includes(userOrgRole)` (page already resolves `userOrgRole`).
- Render `AssignmentEditor` (compact Card) above the `CaptureForm`, passing the inspection's current `assigned_to_id`/`verifier_id` and `organisation_id`.

---

## 5. Files touched

| File | Change |
|---|---|
| `apps/web/src/actions/inspections.actions.ts` | Fix name resolution in `listProjectMembersAction` + `listInspectionsAction`; add `updateInspectionAssignmentAction`. |
| `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/page.tsx` | Service-client name resolution; fetch members; render `AssignmentEditor`. |
| `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/AssignmentEditor.tsx` | **New** client component. |
| Tests (apps/web vitest) | Action: gate / update / notify-on-change-only. Editor: read-only vs editable render; hook-order regression (rerender with toggled `canEdit`). |

**No migration.** `inspections.inspections` already has the columns and the UPDATE RLS policy (`00066`) already permits project contributors to update.

---

## 6. Out of scope (YAGNI)

- Many-to-many inspectors / a join table.
- Notifying the previous Inspector or the Verifier.
- A confirm-prompt when reassigning a `certified` inspection.
- Server-side verifier-eligibility validation (UI-enforced, matching create).
- Unifying `listProjectMembersAction` with `listProjectMembers` (different return shapes; possible later cleanup).
- COC-document regeneration on post-certification reassignment.

---

## 7. Verification

1. Unit tests green (`pnpm --filter web test`).
2. Manual on the Vercel preview:
   - New-inspection dropdowns show real member **names** (not UUID codes), including cross-org/sub-org members.
   - Inspections list shows assignee/verifier names.
   - Detail page shows the verifier name; PM+ sees the `AssignmentEditor`, a non-PM sees read-only names.
   - Reassign Inspector on the detail page → persists after refresh, and the new Inspector receives an `inspection_assigned` notification; saving without changing the Inspector sends no notification.

---

## 8. References

- `apps/web/src/actions/inspections.actions.ts` — `listProjectMembersAction:162`, `createInspectionAction:214`, `listInspectionsAction:260`.
- `apps/web/src/actions/project-members.actions.ts:96-138` — the proven service-client name-resolution pattern.
- `apps/web/src/app/(admin)/projects/[id]/inspections/new/AssignmentForm.tsx` — current dropdowns + `labelFor:135` + `VERIFIER_ROLES:28`.
- `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/page.tsx` — detail page.
- `apps/edge-functions/supabase/migrations/00009_rls_policies.sql:76-89` — `profiles` RLS.
- `apps/edge-functions/supabase/migrations/00066_inspections_module.sql` — inspections schema + RLS.
