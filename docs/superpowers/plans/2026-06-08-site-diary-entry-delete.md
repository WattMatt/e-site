# Site Diary Entry — Delete · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the author of a site diary entry — or any owner/admin/PM on the project — permanently delete it, with attachment blobs cleaned up.

**Architecture:** A new shared-service `hardDelete` (gather attachment storage paths → delete the entry → best-effort remove blobs; rows cascade via FK) and a `getEntryForGate` reader. A new role-gated server action `deleteDiaryEntryAction` (the diary's first action): loads the entry with the RLS client (tenancy guard + binds to the entry's own project), allows the author OR owner/admin/PM, then deletes with the service client. A two-step-confirm `DeleteDiaryEntryButton`, rendered per-entry on the project diary page only when the viewer may delete.

**Tech Stack:** Next.js 15 server actions, Supabase JS (cookie + service clients), `@esite/shared` service layer, Vitest + Testing Library. **No DB migration** (attachment FK already `ON DELETE CASCADE`; no DELETE RLS policy exists, so the service client does the delete after the in-app gate).

**Spec:** [`docs/superpowers/specs/2026-06-08-site-diary-entry-delete-design.md`](../specs/2026-06-08-site-diary-entry-delete-design.md)

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/shared/src/services/diary.service.ts` | Add `getEntryForGate` (gate read) + `hardDelete` (delete + storage cleanup) to `diaryService` | Modify |
| `packages/shared/src/services/diary.service.test.ts` | Unit tests for the two new methods | Modify |
| `apps/web/src/actions/diary.actions.ts` | `deleteDiaryEntryAction` — auth + author-or-PM gate + service-client delete | Create |
| `apps/web/src/actions/diary.actions.test.ts` | Gate/auth/validation/failure tests for the action | Create |
| `apps/web/src/app/(admin)/projects/[id]/diary/DeleteDiaryEntryButton.tsx` | Two-step-confirm client button | Create |
| `apps/web/src/app/(admin)/projects/[id]/diary/DeleteDiaryEntryButton.test.tsx` | Component tests | Create |
| `apps/web/src/app/(admin)/projects/[id]/diary/page.tsx` | Compute per-entry `canDelete`, render the button | Modify |
| `docs/rbac-matrix.md` | Record delete = author OR owner/admin/PM | Modify |

Dependency order: Task 1 (service) → Task 2 (action, imports the service methods) → Task 3 (component, imports the action) → Task 4 (page, imports the component) → Task 5 (docs + full verification).

---

## Task 1: Shared service — `getEntryForGate` + `hardDelete`

**Files:**
- Modify: `packages/shared/src/services/diary.service.ts`
- Test: `packages/shared/src/services/diary.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `packages/shared/src/services/diary.service.test.ts` with:

```ts
import { describe, it, expect, vi } from 'vitest'
import { attachmentKindFromMime, diaryService } from './diary.service'

describe('attachmentKindFromMime', () => {
  it('classifies images', () => {
    expect(attachmentKindFromMime('image/jpeg')).toBe('image')
    expect(attachmentKindFromMime('image/png')).toBe('image')
    expect(attachmentKindFromMime('image/heic')).toBe('image')
  })
  it('classifies video', () => {
    expect(attachmentKindFromMime('video/mp4')).toBe('video')
    expect(attachmentKindFromMime('video/quicktime')).toBe('video')
  })
  it('classifies everything else as document', () => {
    expect(attachmentKindFromMime('application/pdf')).toBe('document')
    expect(attachmentKindFromMime('application/vnd.ms-excel')).toBe('document')
    expect(attachmentKindFromMime('')).toBe('document')
  })
})

/** Mock for getEntryForGate: schema().from().select().eq().maybeSingle(). */
function makeGateClient(row: object | null) {
  return {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          }),
        }),
      }),
    }),
  }
}

/**
 * Mock for hardDelete:
 * - listAttachments  → schema().from().select().in().order()
 * - entry delete     → schema().from().delete().eq()
 * - storage cleanup  → storage.from().remove()
 */
function makeDeleteClient(opts: {
  attachments?: Array<{ file_path: string }>
  deleteError?: { message: string } | null
  removeRejects?: boolean
} = {}) {
  const { attachments = [], deleteError = null, removeRejects = false } = opts
  const removeSpy = vi.fn(() =>
    removeRejects
      ? Promise.reject(new Error('storage down'))
      : Promise.resolve({ data: [], error: null }),
  )
  const client = {
    schema: () => ({
      from: () => ({
        select: () => ({
          in: () => ({
            order: () => Promise.resolve({ data: attachments, error: null }),
          }),
        }),
        delete: () => ({
          eq: () => Promise.resolve({ error: deleteError }),
        }),
      }),
    }),
    storage: { from: () => ({ remove: removeSpy }) },
  }
  return { client, removeSpy }
}

describe('diaryService.getEntryForGate', () => {
  it('returns the row when found', async () => {
    const row = { id: 'e1', project_id: 'p1', organisation_id: 'o1', created_by: 'u1' }
    const res = await diaryService.getEntryForGate(makeGateClient(row) as never, 'e1')
    expect(res).toEqual(row)
  })
  it('returns null when not found', async () => {
    const res = await diaryService.getEntryForGate(makeGateClient(null) as never, 'missing')
    expect(res).toBeNull()
  })
})

describe('diaryService.hardDelete', () => {
  it('gathers attachment paths, deletes the entry, then removes the blobs', async () => {
    const { client, removeSpy } = makeDeleteClient({
      attachments: [{ file_path: 'o/p/e/a.jpg' }, { file_path: 'o/p/e/b.pdf' }],
    })
    await diaryService.hardDelete(client as never, 'e1')
    expect(removeSpy).toHaveBeenCalledWith(['o/p/e/a.jpg', 'o/p/e/b.pdf'])
  })

  it('does not call storage.remove when there are no attachments', async () => {
    const { client, removeSpy } = makeDeleteClient({ attachments: [] })
    await diaryService.hardDelete(client as never, 'e1')
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('throws when the entry delete fails, before any storage work', async () => {
    const { client, removeSpy } = makeDeleteClient({
      attachments: [{ file_path: 'a' }],
      deleteError: { message: 'boom' },
    })
    await expect(diaryService.hardDelete(client as never, 'e1')).rejects.toEqual({ message: 'boom' })
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('still resolves when storage removal rejects (best-effort)', async () => {
    const { client } = makeDeleteClient({ attachments: [{ file_path: 'a' }], removeRejects: true })
    await expect(diaryService.hardDelete(client as never, 'e1')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @esite/shared test -- diary.service`
Expected: FAIL — `diaryService.getEntryForGate is not a function` / `diaryService.hardDelete is not a function`.

- [ ] **Step 3: Implement the two methods**

In `packages/shared/src/services/diary.service.ts`, add this exported interface just below the `DiaryAttachment` interface (after line ~37, before `attachmentKindFromMime`):

```ts
/** Minimal entry fields needed by the delete gate. */
export interface DiaryEntryGateRow {
  id: string
  project_id: string
  organisation_id: string
  created_by: string | null
}
```

Then, inside the `diaryService` object, add these two methods immediately after `deleteAttachment` (i.e. after the closing `},` of `deleteAttachment`, before the object's final `}`):

```ts
  /** Minimal entry fields for the delete gate (author + org/project resolution). */
  async getEntryForGate(
    client: TypedSupabaseClient,
    entryId: string,
  ): Promise<DiaryEntryGateRow | null> {
    const { data, error } = await client
      .schema('projects')
      .from('site_diary_entries')
      .select('id, project_id, organisation_id, created_by')
      .eq('id', entryId)
      .maybeSingle()
    if (error) throw error
    return (data ?? null) as unknown as DiaryEntryGateRow | null
  },

  /**
   * Permanently delete a diary entry and clean up its attachment blobs.
   *
   * Attachment ROWS cascade via the FK (site_diary_attachments.diary_entry_id
   * ON DELETE CASCADE), so this gathers the storage paths FIRST (the cascade
   * drops the rows), deletes the entry, then best-effort removes the blobs.
   * A storage failure must not fail the delete.
   */
  async hardDelete(client: TypedSupabaseClient, entryId: string): Promise<void> {
    const attachments = await diaryService.listAttachments(client, [entryId])
    const paths = attachments.map((a) => a.file_path).filter(Boolean)

    const { error } = await client
      .schema('projects')
      .from('site_diary_entries')
      .delete()
      .eq('id', entryId)
    if (error) throw error

    if (paths.length > 0) {
      try {
        await client.storage.from('diary-attachments').remove(paths)
      } catch {
        /* best-effort: an orphaned blob must not fail the delete */
      }
    }
  },
```

(The `diaryService.listAttachments(...)` self-reference inside the object mirrors `getWeeklySummary`, which already calls `diaryService.listByOrg`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @esite/shared test -- diary.service`
Expected: PASS — all `attachmentKindFromMime`, `getEntryForGate`, and `hardDelete` tests green.

- [ ] **Step 5: Type-check the package**

Run: `pnpm --filter @esite/shared type-check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/services/diary.service.ts packages/shared/src/services/diary.service.test.ts
git commit -m "feat(diary): service getEntryForGate + hardDelete (delete entry + storage cleanup)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Server action — `deleteDiaryEntryAction`

**Files:**
- Create: `apps/web/src/actions/diary.actions.ts`
- Test: `apps/web/src/actions/diary.actions.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/actions/diary.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted so mocks exist before the hoisted vi.mock factories run.
const {
  createClientMock,
  createServiceClientMock,
  revalidatePathMock,
  getEntryForGateMock,
  hardDeleteMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  getEntryForGateMock: vi.fn(),
  hardDeleteMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return {
    ...actual,
    diaryService: {
      ...actual.diaryService,
      getEntryForGate: getEntryForGateMock,
      hardDelete: hardDeleteMock,
    },
  }
})

import { deleteDiaryEntryAction } from './diary.actions'

const ENTRY_ID   = '11111111-1111-1111-1111-111111111111'
const PROJECT_ID = '22222222-2222-2222-2222-222222222222'
const AUTHOR_ID  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OTHER_ID   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

/** Cookie client mock: auth.getUser + rpc (rpc feeds the real requireEffectiveRole). */
function mockClient(opts: { userId?: string; role?: string | null } = {}) {
  const { userId = AUTHOR_ID, role = 'project_manager' } = opts
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: userId } } }) },
    rpc: () => Promise.resolve({ data: role, error: null }),
  }
}

beforeEach(() => {
  createClientMock.mockReset()
  createServiceClientMock.mockReset()
  revalidatePathMock.mockReset()
  getEntryForGateMock.mockReset()
  hardDeleteMock.mockReset()

  createClientMock.mockResolvedValue(mockClient())
  createServiceClientMock.mockReturnValue({})
  getEntryForGateMock.mockResolvedValue({
    id: ENTRY_ID, project_id: PROJECT_ID, organisation_id: 'org-1', created_by: AUTHOR_ID,
  })
  hardDeleteMock.mockResolvedValue(undefined)
})

describe('deleteDiaryEntryAction — validation', () => {
  it('rejects a non-uuid entryId before any I/O', async () => {
    const res = await deleteDiaryEntryAction('not-a-uuid')
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })
})

describe('deleteDiaryEntryAction — auth + existence', () => {
  it('rejects when unauthenticated', async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    })
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({ error: 'Not authenticated' })
    expect(hardDeleteMock).not.toHaveBeenCalled()
  })

  it('returns "Entry not found" when the entry is not visible (other org / missing)', async () => {
    getEntryForGateMock.mockResolvedValue(null)
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({ error: 'Entry not found' })
    expect(hardDeleteMock).not.toHaveBeenCalled()
  })
})

describe('deleteDiaryEntryAction — author-or-PM gate', () => {
  it('lets the AUTHOR delete their own entry without a role check', async () => {
    // Author is a plain contractor — author short-circuit must still allow it.
    createClientMock.mockResolvedValue(mockClient({ userId: AUTHOR_ID, role: 'contractor' }))
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({})
    expect(hardDeleteMock).toHaveBeenCalledWith(expect.anything(), ENTRY_ID)
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT_ID}/diary`)
  })

  it('lets a PM delete ANOTHER user\'s entry', async () => {
    createClientMock.mockResolvedValue(mockClient({ userId: OTHER_ID, role: 'project_manager' }))
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({})
    expect(hardDeleteMock).toHaveBeenCalledWith(expect.anything(), ENTRY_ID)
  })

  it('blocks a non-author who is not owner/admin/PM', async () => {
    createClientMock.mockResolvedValue(mockClient({ userId: OTHER_ID, role: 'contractor' }))
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({ error: 'You do not have permission to delete this entry.' })
    expect(hardDeleteMock).not.toHaveBeenCalled()
  })

  it('blocks a non-author with no project access (null role)', async () => {
    createClientMock.mockResolvedValue(mockClient({ userId: OTHER_ID, role: null }))
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({ error: 'You do not have permission to delete this entry.' })
    expect(hardDeleteMock).not.toHaveBeenCalled()
  })
})

describe('deleteDiaryEntryAction — failure handling', () => {
  it('surfaces a hardDelete error', async () => {
    hardDeleteMock.mockRejectedValue(new Error('db exploded'))
    const res = await deleteDiaryEntryAction(ENTRY_ID)
    expect(res).toEqual({ error: 'db exploded' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web test -- diary.actions`
Expected: FAIL — cannot resolve `./diary.actions` (module does not exist yet).

- [ ] **Step 3: Implement the action**

Create `apps/web/src/actions/diary.actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { diaryService, ORG_WRITE_ROLES } from '@esite/shared'

const uuidSchema = z.string().uuid()

/**
 * Permanently delete a site diary entry.
 *
 * Gate: the entry's AUTHOR, or owner/admin/PM on the entry's project.
 * The entry is loaded with the cookie/RLS client first — that read only
 * returns rows in the caller's org, so it doubles as the tenancy guard and
 * binds the gate to the entry's OWN project_id (never a client-supplied id).
 * The delete + storage cleanup run with the service client (RLS-bypassing),
 * so the in-app gate is mandatory — matching snag-visit.actions.ts.
 */
export async function deleteDiaryEntryAction(
  entryId: string,
): Promise<{ error?: string }> {
  const parse = uuidSchema.safeParse(entryId)
  if (!parse.success) return { error: 'Invalid entry id' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const entry = await diaryService.getEntryForGate(supabase as never, entryId)
  if (!entry) return { error: 'Entry not found' }

  const isAuthor = entry.created_by === user.id
  if (!isAuthor) {
    const gate = await requireEffectiveRole(supabase, entry.project_id, ORG_WRITE_ROLES)
    if (!gate.ok) return { error: 'You do not have permission to delete this entry.' }
  }

  const serviceClient = createServiceClient()
  try {
    await diaryService.hardDelete(serviceClient as never, entryId)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  revalidatePath(`/projects/${entry.project_id}/diary`)
  revalidatePath('/diary')
  revalidatePath('/diary/weekly')
  return {}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web test -- diary.actions`
Expected: PASS — all validation/auth/gate/failure tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/diary.actions.ts apps/web/src/actions/diary.actions.test.ts
git commit -m "feat(diary): deleteDiaryEntryAction — author-or-PM gated hard delete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: UI — `DeleteDiaryEntryButton` (two-step confirm)

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/diary/DeleteDiaryEntryButton.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/diary/DeleteDiaryEntryButton.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/(admin)/projects/[id]/diary/DeleteDiaryEntryButton.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { DeleteDiaryEntryButton } from './DeleteDiaryEntryButton'

const { deleteMock, refreshMock } = vi.hoisted(() => ({ deleteMock: vi.fn(), refreshMock: vi.fn() }))
vi.mock('@/actions/diary.actions', () => ({
  deleteDiaryEntryAction: (...args: unknown[]) => deleteMock(...args),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }))

beforeEach(() => vi.clearAllMocks())

describe('DeleteDiaryEntryButton', () => {
  it('shows "Delete" initially and calls nothing', () => {
    render(<DeleteDiaryEntryButton entryId="e1" />)
    expect(screen.getByText('Delete')).toBeDefined()
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('arms on the first click without calling the action', () => {
    render(<DeleteDiaryEntryButton entryId="e1" />)
    fireEvent.click(screen.getByText('Delete'))
    expect(screen.getByText('Confirm delete?')).toBeDefined()
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('calls deleteDiaryEntryAction + router.refresh on the second click', async () => {
    deleteMock.mockResolvedValue({})
    render(<DeleteDiaryEntryButton entryId="e1" />)
    fireEvent.click(screen.getByText('Delete'))            // arm
    await act(async () => {
      fireEvent.click(screen.getByText('Confirm delete?')) // commit
    })
    expect(deleteMock).toHaveBeenCalledWith('e1')
    expect(refreshMock).toHaveBeenCalled()
  })

  it('shows the error and does not refresh when the action fails', async () => {
    deleteMock.mockResolvedValue({ error: 'nope' })
    render(<DeleteDiaryEntryButton entryId="e1" />)
    fireEvent.click(screen.getByText('Delete'))
    await act(async () => {
      fireEvent.click(screen.getByText('Confirm delete?'))
    })
    expect(screen.getByText('nope')).toBeDefined()
    expect(refreshMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web test -- DeleteDiaryEntryButton`
Expected: FAIL — cannot resolve `./DeleteDiaryEntryButton`.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/app/(admin)/projects/[id]/diary/DeleteDiaryEntryButton.tsx`:

```tsx
'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteDiaryEntryAction } from '@/actions/diary.actions'

interface Props {
  entryId: string
}

/**
 * Two-step inline delete confirm. Safari suppresses window.confirm (see the
 * photo-delete lesson), so the first click arms and a second click within 3s
 * commits. Visibility (author-or-PM) is decided by the parent server component,
 * which only renders this when the viewer may delete the entry.
 */
export function DeleteDiaryEntryButton({ entryId }: Props) {
  const router = useRouter()
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function arm() {
    setArmed(true)
    setError('')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setArmed(false), 3000)
  }

  async function commit() {
    if (timer.current) clearTimeout(timer.current)
    setBusy(true)
    setError('')
    const res = await deleteDiaryEntryAction(entryId)
    if (res?.error) {
      setError(res.error)
      setBusy(false)
      setArmed(false)
      return
    }
    router.refresh()
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {error && <span style={{ color: 'var(--c-red)', fontSize: 11 }}>{error}</span>}
      <button
        type="button"
        onClick={armed ? commit : arm}
        disabled={busy}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em',
          textTransform: 'uppercase', cursor: busy ? 'wait' : 'pointer',
          background: armed ? 'var(--c-red)' : 'transparent',
          color: armed ? '#fff' : 'var(--c-red)',
          border: '1px solid var(--c-red)', borderRadius: 6, padding: '3px 8px',
        }}
      >
        {busy ? 'Deleting…' : armed ? 'Confirm delete?' : 'Delete'}
      </button>
    </span>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web test -- DeleteDiaryEntryButton`
Expected: PASS — all four tests green.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/diary/DeleteDiaryEntryButton.tsx" "apps/web/src/app/(admin)/projects/[id]/diary/DeleteDiaryEntryButton.test.tsx"
git commit -m "feat(diary): DeleteDiaryEntryButton (two-step inline confirm)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire the button into the project diary page

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/diary/page.tsx`

No new test (server component — covered by type-check + the manual checklist in Task 5). The button and action are unit-tested in Tasks 2–3.

- [ ] **Step 1: Update the imports**

In `apps/web/src/app/(admin)/projects/[id]/diary/page.tsx`:

Change line 4 from:
```ts
import { projectService, diaryService, formatDate, ENTRY_TYPE_LABELS } from '@esite/shared'
```
to:
```ts
import { projectService, diaryService, formatDate, ENTRY_TYPE_LABELS, ORG_WRITE_ROLES } from '@esite/shared'
```

Change line 5 from:
```ts
import type { DiaryEntryType } from '@esite/shared'
```
to:
```ts
import type { DiaryEntryType, OrgRole } from '@esite/shared'
```

Add after line 7 (`import { DiaryAttachmentStrip, ... }`):
```ts
import { DeleteDiaryEntryButton } from './DeleteDiaryEntryButton'
```

- [ ] **Step 2: Compute the viewer's write capability**

After line 35 (`const canEdit = mem?.role !== 'client_viewer'`), add:
```ts
  const viewerRole = (mem?.role ?? null) as OrgRole | null
  const viewerCanWrite = viewerRole !== null && ORG_WRITE_ROLES.includes(viewerRole)
```

- [ ] **Step 3: Compute per-entry `canDelete`**

Inside the `entries.map((entry: any) => {` block, after the `const typeLabel = ...` line (line 87), add:
```ts
            const canDelete = entry.created_by === user!.id || viewerCanWrite
```

- [ ] **Step 4: Render the button in the card header**

In the header's right-side group, the workers span currently ends like this (lines 107–111):
```tsx
                    {entry.workers_on_site != null && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                        {entry.workers_on_site} worker{entry.workers_on_site !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
```
Insert the button between the closing `)}` of the workers span and the closing `</div>`, so it becomes:
```tsx
                    {entry.workers_on_site != null && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                        {entry.workers_on_site} worker{entry.workers_on_site !== 1 ? 's' : ''}
                      </span>
                    )}
                    {canDelete && <DeleteDiaryEntryButton entryId={entry.id} />}
                  </div>
```

- [ ] **Step 5: Type-check the web app**

Run: `pnpm --filter web type-check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/diary/page.tsx"
git commit -m "feat(diary): show Delete on diary entries for author + owner/admin/PM

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: RBAC matrix + full verification

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Record the delete capability in the RBAC matrix**

Open `docs/rbac-matrix.md`, find the site-diary entries (search for "diary"). Add a row/line in the same format as the surrounding entries recording:

> **Site diary — delete entry** (`deleteDiaryEntryAction`): the entry **author**, or **owner / admin / project_manager** on the project. Other roles (contractor / inspector / supplier / client_viewer) may not delete others' entries. *(Create remains: any active org member.)*

- [ ] **Step 2: Run the full shared + web test suites**

Run: `pnpm --filter @esite/shared test`
Expected: PASS (includes the new `diary.service` tests).

Run: `pnpm --filter web test`
Expected: PASS (includes the new `diary.actions` + `DeleteDiaryEntryButton` tests; no regressions).

- [ ] **Step 3: Type-check both workspaces**

Run: `pnpm --filter @esite/shared type-check && pnpm --filter web type-check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): record site-diary delete gate (author OR owner/admin/PM)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Manual verification (preview)**

> ⚠ The preview shares the production DB — these deletes are REAL. Use throwaway diary entries on a test project only.

1. As a **contractor**, create two identical diary entries on a project → a **Delete** control shows on each → delete one → it disappears; the other remains.
2. As a **different contractor**, view those entries → **no Delete** control on entries you did not author.
3. As an **owner/admin/PM**, view the same entries → **Delete** appears on anyone's entry → delete works.
4. Create an entry **with a photo attachment**, then delete it → the entry is gone and the storage blob is removed (no orphaned file in the `diary-attachments` bucket).

---

## Notes / accepted tradeoffs (from the spec)

- **Hard delete is irreversible.** Combined with author-delete, an author can permanently remove their own genuine entries; the two-step confirm is the only guard. Accepted for the duplicate-cleanup use case.
- **No DB migration.** Attachment rows cascade via the existing FK; no DELETE RLS policy exists, so the service client performs the delete after the in-app gate.
- **UI visibility uses the org-level role** (`mem.role`), while the action enforces the **effective project role**. A user promoted to PM only on this project (contractor at org level) would not see the Delete control on others' entries but the action would allow it — this is a safe UI under-permission, consistent with the existing `canEdit` computation on the same page.
- **Out of scope:** edit; org-wide `/diary` feed delete; hardening the create path; soft-delete/recovery.
```