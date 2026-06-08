# Site Diary Entry — Delete

**Date:** 2026-06-08
**Status:** Design (awaiting review → plan)
**Backlog:** #7 (site-diary edit/delete) — this spec covers **delete only**; edit is a separate follow-up.

---

## Problem

Site diary entries (`projects.site_diary_entries`) sometimes get posted **twice** (duplicates). Today there is no way to remove an entry — and the diary has **no server-action layer at all**: entries are created straight from [`AddDiaryEntryForm.tsx`](../../../apps/web/src/app/(admin)/projects/[id]/diary/AddDiaryEntryForm.tsx) via `diaryService.create()`, gated only by RLS (any org member of the entry's org may INSERT/UPDATE).

The confirmed motivation is **duplicate cleanup**: the removed entry is redundant, so no unique record is lost.

---

## Decisions (locked)

1. **Hard delete.** The entry row is permanently removed (chosen over soft-delete).
   - *Rationale:* duplicate cleanup loses no unique record; simpler — no new columns, no read-filter changes.
   - **Accepted risk (on the record):** irreversible. Combined with author-delete (below), an author can permanently remove their *own* genuine (non-duplicate) entries with no recovery. The two-step confirm is the only guard. Product accepts this for the duplicate-cleanup use case. *(This is a deliberate departure from the project's general "contemporaneous record → soft-delete + audit" guidance.)*

2. **Who can delete = author OR owner/admin/PM.** You can delete an entry you created; `owner`/`admin`/`project_manager` can delete any entry in their project. A non-author below PM (`contractor`/`inspector`/`supplier`/`client_viewer`) cannot delete others' entries.

3. **Scope = delete only.** Editing entries is a separate backlog follow-up.

4. **Surface = the per-project diary view only (v1).** Delete is offered on `/projects/[id]/diary`. The org-wide `/diary` feed and weekly summary stay read-only. *(Org-feed delete is a possible follow-up — resolving per-project effective role across a multi-project feed adds complexity not worth v1.)*

---

## No migration required

Confirmed by reading the schema:

- `site_diary_attachments.diary_entry_id → site_diary_entries(id) ON DELETE CASCADE` ([00091:12](../../../apps/edge-functions/supabase/migrations/00091_site_diary_attachments.sql)) — deleting the entry auto-removes its attachment **rows**.
- There is **no DELETE RLS policy** on `site_diary_entries`, so a user's own RLS client cannot delete it. The action performs the delete with the **service client** (RLS-bypassing) *after* an in-app role gate — the established hardening pattern (snag/tenant actions). No new RLS policy is needed.
- Storage **files** are *not* removed by the DB cascade; the action removes them best-effort (below), reusing the existing `diary-attachments` bucket + `remove()` helper.

→ The whole feature is **a server action + a small UI affordance**. No DB change.

---

## Server action — `deleteDiaryEntryAction(entryId: string)`

New file `apps/web/src/actions/diary.actions.ts` — the first diary action. (The create path is left untouched; see Out of scope.)

Flow:

1. **Auth** — current user via the cookie/RLS client; reject if unauthenticated.
2. **Load the entry (RLS client)** — `select id, project_id, organisation_id, created_by`. If not found/not visible → `{ error: 'Entry not found.' }`.
   - This RLS read is also the **tenancy guard**: the SELECT policy only returns the entry if `organisation_id = ANY(get_user_org_ids())`, so a caller from another org can't even see (let alone delete) it. The gate is bound to the entry's *own* `project_id` — never a client-supplied one — closing the cross-project write-hole (snag-work lesson).
3. **Gate (author-or-PM):**
   ```ts
   const isAuthor = entry.created_by === user.id
   const gate = await requireEffectiveRole(supabase, entry.project_id, ORG_WRITE_ROLES)
   if (!isAuthor && !gate.ok) return { error: 'You do not have permission to delete this entry.' }
   ```
4. **Gather attachment paths (service client)** — `diaryService.listAttachments(service, [entryId])` → collect `file_path[]`. **Must precede the delete** — the cascade drops the rows.
5. **Delete the entry (service client)** — `DELETE FROM projects.site_diary_entries WHERE id = entryId`. Cascade removes the attachment rows.
6. **Best-effort storage cleanup (service client)** — `storage.from('diary-attachments').remove(paths)` when any. Swallow/log storage errors — an orphaned blob must not fail the delete.
7. **Revalidate** — `revalidatePath` for `/projects/[id]/diary` (and `/diary` + `/diary/weekly`) so feeds refresh.
8. Return `{ ok: true }` / `{ error }`.

Steps 4–6 factor into `diaryService.hardDelete(serviceClient, entryId)` so the action stays orchestration + gate and the service owns Supabase access (mirrors the existing service shape).

---

## Shared service additions — `packages/shared/src/services/diary.service.ts`

- `getEntryForGate(client, entryId)` → `{ id, project_id, organisation_id, created_by } | null` (used by the action's RLS-client read in step 2).
- `hardDelete(client, entryId)` → gather attachment paths via `listAttachments`, delete the entry, best-effort `remove()` the blobs. Reuses the storage-removal logic already in `deleteAttachment`.

---

## Reads — unchanged

Hard delete removes the row, so `diaryService.list` / `listByOrg` / `getWeeklySummary` need **no** filter changes. Nothing to hide.

---

## UI — per-entry Delete on the project diary

- [`/projects/[id]/diary/page.tsx`](../../../apps/web/src/app/(admin)/projects/[id]/diary/page.tsx) is a server component that already resolves the viewer's role and renders entry cards. Pass each card the viewer's `userId` and a `viewerCanWrite` boolean (`role ∈ ORG_WRITE_ROLES`).
- New client component `DeleteDiaryEntryButton` (or a small `DiaryEntryActions`): renders a **Delete** control only when `viewerId === entry.created_by || viewerCanWrite`.
- **Two-step inline confirm** — Safari suppresses `window.confirm` (repo lesson from the photo-delete work; mirror the pattern in [`DiaryAttachmentStrip.tsx`](../../../apps/web/src/components/diary/DiaryAttachmentStrip.tsx)). First tap arms (“Delete” → “Confirm?”), second tap within ~3s calls `deleteDiaryEntryAction(entry.id)`, auto-resets after the timeout. Disable while submitting; show a small inline error on failure.
- On success the action's `revalidatePath` refreshes the list and the card disappears.

---

## RBAC matrix

Update the diary rows in [`docs/rbac-matrix.md`](../../../docs/rbac-matrix.md) to record: create = any org member (unchanged); **delete = author OR owner/admin/PM**.

---

## Testing

**Action tests** (`diary.actions.test.ts`; use `vi.hoisted` for mocked deps per the inspections-test hoisting lesson):
- author deletes **own** entry → ok; service delete + storage `remove` called.
- owner/admin/PM deletes **another** user's entry → ok.
- non-author `contractor`/`inspector`/`client_viewer` → blocked; no delete called.
- caller who can't see the entry (other org) → `Entry not found`; no delete called.
- entry with attachments → paths gathered **before** delete; `remove()` called with them; a storage error does **not** fail the action.

**Component test** (`DeleteDiaryEntryButton`):
- two-step confirm arms then fires `deleteDiaryEntryAction`.
- control hidden when viewer is neither author nor write-role.

---

## Out of scope

- **Editing** entries (separate follow-up; backlog #7 couples edit + delete).
- **Hardening the create path** (still RLS-only, any org member) — not changed here.
- **Delete from the org-wide `/diary` feed + weekly summary** (possible follow-up).
- **Soft-delete / recovery / audit trail** — explicitly chosen against.

---

## Verification

- `pnpm --filter web type-check` clean; web + shared test suites green (new tests included).
- Manual: create two identical entries as a contractor → delete one **as that contractor** (allowed) → confirm it's gone; as a **different** contractor confirm no Delete control on it; as a **PM** confirm Delete appears on anyone's; with an entry that has a photo, confirm the storage blob is removed after delete.
