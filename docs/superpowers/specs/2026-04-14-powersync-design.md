# E-Site: PowerSync Offline-First Sync

**Date:** 2026-04-14  
**Source:** SPEC DOCS gap analysis + graphify run  
**Status:** Approved  
**Delivery:** Single PR — Sprint 0 exit gate

---

## Background

The E-Site SPEC DOCS define PowerSync as a non-negotiable Sprint 0 exit gate. The mobile app currently fetches all data directly from Supabase over the network; there is no offline capability. A field crew on a construction site without signal cannot view their snag list, take photos, or log work. This PR wires up PowerSync as the sync layer for field-capture tables, with TanStack Query remaining as the query interface on top.

Sprint 0 exit gate (non-negotiable): confirmed round-trip sync — snag created on mobile appears in Supabase and is returned to the local SQLite DB within a reasonable window.

---

## Sync Scope

**Synced via PowerSync (SQLite-local, offline-capable):**

| Table | Reason |
|---|---|
| `projects` | Core entity — needed to navigate and create snags offline |
| `snags` | Primary field-capture object |
| `snag_photos` | Photo metadata (not binary — S3 paths only) |

**Remains Supabase-only (no offline requirement):**

RFIs, compliance/COC, procurement, billing, org settings, site diary, handover checklist. These are back-office or connectivity-assumed workflows.

---

## Architecture

### 1. PowerSync Setup + Provider

**Package:** `@powersync/react-native` + `@powersync/supabase-connector`

**File:** `apps/mobile/src/lib/powersync/schema.ts`

Defines the local SQLite schema PowerSync manages. Column lists mirror the Supabase tables exactly — PowerSync will not sync columns that are not declared here.

```ts
import { column, Schema, Table } from '@powersync/react-native'

const projects = new Table({
  name: column.text,
  status: column.text,
  city: column.text,
  province: column.text,
  organisation_id: column.text,
})

const snags = new Table({
  title: column.text,
  description: column.text,
  status: column.text,
  priority: column.text,
  project_id: column.text,
  organisation_id: column.text,
  assigned_to: column.text,
  created_by: column.text,
  created_at: column.text,
})

const snag_photos = new Table({
  snag_id: column.text,
  storage_path: column.text,
  organisation_id: column.text,
  created_at: column.text,
})

export const AppSchema = new Schema({ projects, snags, snag_photos })
export type Database = (typeof AppSchema)['types']
```

**File:** `apps/mobile/src/lib/powersync/connector.ts`

SupabaseConnector subclass — provides PowerSync with the JWT it needs to authenticate sync, and handles token refresh transparently.

```ts
import { AbstractPowerSyncDatabase, PowerSyncBackendConnector } from '@powersync/react-native'
import { SupabaseClient } from '@supabase/supabase-js'

export class SupabaseConnector implements PowerSyncBackendConnector {
  constructor(private supabase: SupabaseClient) {}

  async fetchCredentials() {
    const { data: { session } } = await this.supabase.auth.getSession()
    if (!session) throw new Error('No session')
    return {
      endpoint: process.env.EXPO_PUBLIC_POWERSYNC_URL!,
      token: session.access_token,
    }
  }

  async uploadData(database: AbstractPowerSyncDatabase) {
    // PowerSync manages local writes — Supabase is still the write target via service calls
    // This connector is read-sync only; writes go direct to Supabase
  }
}
```

**File:** `apps/mobile/src/providers/PowerSyncProvider.tsx`

Initialises the PowerSync DB singleton, connects via the Supabase JWT, and exposes it via the PowerSync React context. Wraps children only after the session is established.

Placement: inside `AuthProvider` in `_layout.tsx`, outside `QueryProvider` (so TanStack Query can use it).

---

### 2. Sync Rules

**File:** `supabase/powersync/sync-rules.yaml`

Sync rules mirror the existing RLS policies. The JWT `org_id` claim (added to `user_metadata` at org join time, same mechanism as `org_role`) is the partition key — each user only syncs their own organisation's data.

```yaml
bucket_definitions:
  org_projects:
    parameters:
      - name: org_id
        token_parameter: org_id          # read from JWT
    data:
      - SELECT id, name, status, city, province, organisation_id
        FROM projects
        WHERE organisation_id = bucket.org_id

  org_snags:
    parameters:
      - name: org_id
        token_parameter: org_id
    data:
      - SELECT id, title, description, status, priority,
               project_id, organisation_id, assigned_to,
               created_by, created_at
        FROM snags
        WHERE organisation_id = bucket.org_id

  org_snag_photos:
    parameters:
      - name: org_id
        token_parameter: org_id
    data:
      - SELECT id, snag_id, storage_path, organisation_id, created_at
        FROM projects.snag_photos
        WHERE organisation_id = bucket.org_id
```

**JWT `org_id` claim:** Added via Supabase Auth `custom_access_token` hook (Postgres function). At login, the hook reads `user_organisations` for the user's active org and injects `org_id` into the JWT. If the user belongs to multiple orgs, the first active org is used (Phase 1 scope — multi-org switching is Phase 2).

---

### 3. `useDb()` Routing Hook

**File:** `apps/mobile/src/hooks/useDb.ts`

Single source of truth for "where does this table live". Callers never need to know whether they're hitting SQLite or Supabase.

```ts
import { usePowerSync } from '@powersync/react-native'
import { useSupabase } from '../providers/SupabaseProvider'

const POWERSYNC_TABLES = new Set(['snags', 'projects', 'snag_photos'])

export function useDb(table: string) {
  const powerSync = usePowerSync()
  const supabase = useSupabase()
  if (POWERSYNC_TABLES.has(table)) {
    return { type: 'local', db: powerSync } as const
  }
  return { type: 'remote', db: supabase } as const
}
```

**Updated hooks:**

`apps/mobile/src/hooks/useSnags.ts` — `useDb` is called at the top of the hook (not inside `queryFn`, as hooks can't be called inside callbacks), and the resolved `type` and `db` are captured in the closure:

```ts
export function useSnags(projectId: string) {
  const { type, db } = useDb('snags')   // called at hook level
  const supabase = useSupabase()

  return useQuery({
    queryKey: ['snags', projectId, type],
    queryFn: async () => {
      if (type === 'local') {
        return (db as PowerSyncDatabase).getAll(
          'SELECT * FROM snags WHERE project_id = ? ORDER BY created_at DESC',
          [projectId]
        )
      }
      return snagService.list(supabase, projectId)
    },
    enabled: !!projectId,
  })
}
```

`apps/mobile/src/hooks/useProjects.ts` — same pattern, `projects` table.

**Write path — unchanged.** `snagService.create()` / `snagService.updateStatus()` still write directly to Supabase via the service layer. PowerSync sync propagates those writes back down to SQLite automatically. No local-write / conflict-resolution complexity in Phase 1.

---

### 4. `snag_photos` + Sprint 0 Validation

**Photo metadata** (`storage_path`, `snag_id`) syncs via the `org_snag_photos` bucket. Photo binaries are S3 objects — they are NOT synced through PowerSync, only the paths. The existing `useSnagPhotos` hook reads photo records from PowerSync SQLite (for the metadata) and constructs Supabase Storage URLs for display. Upload still goes direct to Supabase Storage.

**Sprint 0 exit gate test:**

**File:** `apps/mobile/src/__tests__/powersync-roundtrip.test.ts`

```ts
import { PowerSyncDatabase } from '@powersync/react-native'
import { snagService } from '@esite/shared'
import { AppSchema } from '../lib/powersync/schema'

describe('PowerSync round-trip', () => {
  it('creates a snag in Supabase and syncs to SQLite within 15s', async () => {
    // 1. Create via Supabase service (write path)
    const created = await snagService.create(supabase, orgId, userId, {
      projectId: TEST_PROJECT_ID,
      title: 'Roundtrip test snag',
      priority: 'low',
    })

    // 2. Wait for sync
    await new Promise(r => setTimeout(r, 15_000))

    // 3. Assert in local SQLite
    const rows = await db.getAll(
      'SELECT * FROM snags WHERE id = ?',
      [created.id]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Roundtrip test snag')

    // 4. Update via Supabase, assert propagates
    await snagService.updateStatus(supabase, created.id, 'in_progress')
    await new Promise(r => setTimeout(r, 15_000))
    const updated = await db.get('SELECT status FROM snags WHERE id = ?', [created.id])
    expect(updated?.status).toBe('in_progress')
  }, 60_000)
})
```

This test is the Sprint 0 gate. It must pass before the PR can merge.

---

## What is explicitly out of scope

- Multi-org switching (Phase 2 — single active org only in Phase 1)
- Optimistic local writes / conflict resolution (writes go to Supabase; PowerSync propagates back)
- Offline write queue / background sync (Phase 2)
- RFI, compliance, diary, handover offline support (back-office, connectivity assumed)
- Photo binary sync (S3 paths only, not binary blobs)

---

## Delivery

Single PR. Merge gate: `powersync-roundtrip.test.ts` passes on a real device or simulator connected to the PowerSync instance.

Environment variables required:
- `EXPO_PUBLIC_POWERSYNC_URL` — PowerSync managed service endpoint
- PowerSync dashboard sync rules deployed from `supabase/powersync/sync-rules.yaml`
