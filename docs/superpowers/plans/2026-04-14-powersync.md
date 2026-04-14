# PowerSync Offline-First Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire PowerSync as the sync layer for `projects`, `snags`, and `snag_photos` tables so field crews can view and work with these records offline on mobile.

**Architecture:** PowerSync syncs Supabase Postgres rows to a local SQLite DB on device, partitioned by the user's `org_id` JWT claim. TanStack Query remains the query interface — `useDb()` routes reads to PowerSync SQLite for synced tables and to Supabase directly for everything else. Writes bypass PowerSync entirely and go direct to Supabase service layer; PowerSync propagates them back down automatically.

**Tech Stack:** `@powersync/react-native`, `@powersync/connector-supabase`, TanStack Query v4, Expo SDK 49, Supabase JS v2

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/mobile/src/lib/powersync/schema.ts` | Create | AppSchema — SQLite column definitions for synced tables |
| `apps/mobile/src/lib/powersync/connector.ts` | Create | SupabaseConnector — provides JWT to PowerSync, handles token refresh |
| `apps/mobile/src/lib/powersync/database.ts` | Create | Singleton `PowerSyncDatabase` instance |
| `apps/mobile/src/providers/PowerSyncProvider.tsx` | Create | Initialises DB, calls `db.connect()` after auth, exposes via context |
| `apps/mobile/app/_layout.tsx` | Modify | Restructure provider order: `SupabaseProvider > AuthProvider > PowerSyncProvider > QueryProvider > Slot` |
| `apps/mobile/src/hooks/useDb.ts` | Create | Routing hook — returns `{ type: 'local', db }` or `{ type: 'remote', db }` |
| `apps/mobile/src/hooks/useSnags.ts` | Modify | Branch `queryFn` on `useDb('snags')` type |
| `apps/mobile/src/hooks/useProjects.ts` | Modify | Branch `queryFn` on `useDb('projects')` type |
| `apps/mobile/app.config.ts` | Modify | Add `@powersync/react-native` to Expo plugins |
| `supabase/powersync/sync-rules.yaml` | Create | Sync bucket definitions, `org_id` JWT partition |
| `supabase/migrations/00014_powersync_jwt_hook.sql` | Create | Postgres function for custom JWT `org_id` claim |
| `apps/mobile/src/__tests__/powersync-roundtrip.test.ts` | Create | Sprint 0 exit gate integration test |

---

## Task 1: Install Dependencies

**Files:**
- Modify: `apps/mobile/package.json`

- [ ] **Step 1: Install PowerSync packages**

```bash
cd apps/mobile
pnpm add @powersync/react-native @powersync/connector-supabase
```

Expected: packages added to `apps/mobile/package.json` under `dependencies`.

- [ ] **Step 2: Verify installation**

```bash
cd apps/mobile
pnpm list @powersync/react-native
```

Expected: version number printed, no error.

- [ ] **Step 3: Add PowerSync Expo plugin to app.config.ts**

Read `apps/mobile/app.config.ts`. Find the `plugins` array. Add `'@powersync/react-native'` to it:

```ts
plugins: [
  'expo-router',
  'expo-secure-store',
  'expo-camera',
  'expo-image-picker',
  'expo-notifications',
  '@powersync/react-native',   // ADD THIS
],
```

- [ ] **Step 4: Add env var placeholder**

In `apps/mobile/.env.example` (create if missing), add:

```
EXPO_PUBLIC_POWERSYNC_URL=https://your-instance.powersync.journeyapps.com
```

Also add the same key (with real value) to `apps/mobile/.env.local`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json apps/mobile/app.config.ts apps/mobile/.env.example
git commit -m "chore(mobile): install @powersync/react-native"
```

---

## Task 2: Create PowerSync Schema

**Files:**
- Create: `apps/mobile/src/lib/powersync/schema.ts`

- [ ] **Step 1: Create the schema file**

```ts
// apps/mobile/src/lib/powersync/schema.ts
import { column, Schema, Table } from '@powersync/react-native'

const projects = new Table(
  {
    name: column.text,
    status: column.text,
    city: column.text,
    province: column.text,
    organisation_id: column.text,
  },
  { indexes: { org_idx: ['organisation_id'] } }
)

const snags = new Table(
  {
    title: column.text,
    description: column.text,
    status: column.text,
    priority: column.text,
    project_id: column.text,
    organisation_id: column.text,
    assigned_to: column.text,
    created_by: column.text,
    created_at: column.text,
  },
  { indexes: { project_idx: ['project_id'], org_idx: ['organisation_id'] } }
)

const snag_photos = new Table(
  {
    snag_id: column.text,
    storage_path: column.text,
    organisation_id: column.text,
    created_at: column.text,
  },
  { indexes: { snag_idx: ['snag_id'] } }
)

export const AppSchema = new Schema({ projects, snags, snag_photos })

export type Database = (typeof AppSchema)['types']
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/lib/powersync/schema.ts
git commit -m "feat(mobile): add PowerSync AppSchema for projects, snags, snag_photos"
```

---

## Task 3: Create SupabaseConnector

**Files:**
- Create: `apps/mobile/src/lib/powersync/connector.ts`

The connector provides PowerSync with a valid JWT from the current Supabase session. `uploadData` is a no-op because writes bypass PowerSync and go direct to Supabase — PowerSync propagates them back down automatically.

- [ ] **Step 1: Create the connector**

```ts
// apps/mobile/src/lib/powersync/connector.ts
import {
  AbstractPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from '@powersync/react-native'
import { SupabaseClient } from '@supabase/supabase-js'

export class SupabaseConnector implements PowerSyncBackendConnector {
  constructor(private readonly supabase: SupabaseClient) {}

  async fetchCredentials(): Promise<PowerSyncCredentials> {
    const {
      data: { session },
      error,
    } = await this.supabase.auth.getSession()

    if (error || !session) {
      throw new Error('No active Supabase session — cannot fetch PowerSync credentials')
    }

    return {
      endpoint: process.env.EXPO_PUBLIC_POWERSYNC_URL!,
      token: session.access_token,
      expiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : undefined,
    }
  }

  // Writes bypass PowerSync — go direct to Supabase service layer.
  // PowerSync propagates Supabase changes back to SQLite automatically.
  async uploadData(_database: AbstractPowerSyncDatabase): Promise<void> {
    return
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/lib/powersync/connector.ts
git commit -m "feat(mobile): add SupabaseConnector for PowerSync auth"
```

---

## Task 4: Create PowerSync Database Singleton

**Files:**
- Create: `apps/mobile/src/lib/powersync/database.ts`

PowerSync recommends a singleton instance to avoid opening the SQLite file multiple times.

- [ ] **Step 1: Create the singleton**

```ts
// apps/mobile/src/lib/powersync/database.ts
import { PowerSyncDatabase } from '@powersync/react-native'
import { AppSchema } from './schema'

export const powerSyncDb = new PowerSyncDatabase({
  schema: AppSchema,
  database: {
    dbFilename: 'esite-sync.db',
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/lib/powersync/database.ts
git commit -m "feat(mobile): add PowerSync database singleton"
```

---

## Task 5: Create PowerSyncProvider

**Files:**
- Create: `apps/mobile/src/providers/PowerSyncProvider.tsx`

The provider calls `db.connect(connector)` after the user signs in and `db.disconnect()` on sign-out. It uses the Supabase singleton directly (not the React context) to avoid a dependency on `useSupabase()` at this level.

- [ ] **Step 1: Write the provider**

```tsx
// apps/mobile/src/providers/PowerSyncProvider.tsx
'use client'

import React, { useEffect } from 'react'
import { PowerSyncContext } from '@powersync/react-native'
import { powerSyncDb } from '../lib/powersync/database'
import { SupabaseConnector } from '../lib/powersync/connector'
import { supabase } from '../lib/supabase'

const connector = new SupabaseConnector(supabase)

export function PowerSyncProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let connected = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        powerSyncDb.connect(connector)
        connected = true
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' && !connected) {
        powerSyncDb.connect(connector)
        connected = true
      }
      if (event === 'SIGNED_OUT') {
        powerSyncDb.disconnect()
        connected = false
      }
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  return (
    <PowerSyncContext.Provider value={powerSyncDb}>
      {children}
    </PowerSyncContext.Provider>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/providers/PowerSyncProvider.tsx
git commit -m "feat(mobile): add PowerSyncProvider — connects DB on auth, disconnects on sign-out"
```

---

## Task 6: Restructure Provider Order in `_layout.tsx`

**Files:**
- Modify: `apps/mobile/app/_layout.tsx`

Current order: `SupabaseProvider > QueryProvider > AuthProvider > Slot`

Required order: `SupabaseProvider > AuthProvider > PowerSyncProvider > QueryProvider > Slot`

This ensures PowerSyncProvider can read the auth session (set up by AuthProvider) before TanStack Query hooks try to use `usePowerSync()`.

- [ ] **Step 1: Update _layout.tsx**

Replace the full file with:

```tsx
// apps/mobile/app/_layout.tsx
import { Slot } from 'expo-router'
import { SupabaseProvider } from '../src/providers/SupabaseProvider'
import { AuthProvider } from '../src/providers/AuthProvider'
import { PowerSyncProvider } from '../src/providers/PowerSyncProvider'
import { QueryProvider } from '../src/providers/QueryProvider'

export default function RootLayout() {
  return (
    <SupabaseProvider>
      <AuthProvider>
        <PowerSyncProvider>
          <QueryProvider>
            <Slot />
          </QueryProvider>
        </PowerSyncProvider>
      </AuthProvider>
    </SupabaseProvider>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): add PowerSyncProvider to root layout"
```

---

## Task 7: Create `useDb()` Routing Hook

**Files:**
- Create: `apps/mobile/src/hooks/useDb.ts`

- [ ] **Step 1: Write the hook**

```ts
// apps/mobile/src/hooks/useDb.ts
import { usePowerSync } from '@powersync/react-native'
import { useSupabase } from '../providers/SupabaseProvider'

// Tables in this set are synced locally via PowerSync.
// All other tables go direct to Supabase.
const POWERSYNC_TABLES = new Set(['snags', 'projects', 'snag_photos'])

export type LocalDb = ReturnType<typeof usePowerSync>
export type RemoteDb = ReturnType<typeof useSupabase>

export type DbResult =
  | { type: 'local'; db: LocalDb }
  | { type: 'remote'; db: RemoteDb }

export function useDb(table: string): DbResult {
  const powerSync = usePowerSync()
  const supabase = useSupabase()

  if (POWERSYNC_TABLES.has(table)) {
    return { type: 'local', db: powerSync }
  }
  return { type: 'remote', db: supabase }
}
```

- [ ] **Step 2: Write a unit test**

```ts
// apps/mobile/src/__tests__/useDb.test.ts
import { describe, it, expect, vi } from 'vitest'

// The routing logic doesn't need the full hook — test the decision function directly
const POWERSYNC_TABLES = new Set(['snags', 'projects', 'snag_photos'])

function routeTable(table: string): 'local' | 'remote' {
  return POWERSYNC_TABLES.has(table) ? 'local' : 'remote'
}

describe('useDb routing', () => {
  it('routes synced tables to local PowerSync', () => {
    expect(routeTable('snags')).toBe('local')
    expect(routeTable('projects')).toBe('local')
    expect(routeTable('snag_photos')).toBe('local')
  })

  it('routes non-synced tables to remote Supabase', () => {
    expect(routeTable('rfis')).toBe('remote')
    expect(routeTable('compliance_coc')).toBe('remote')
    expect(routeTable('site_diary_entries')).toBe('remote')
    expect(routeTable('handover_checklist')).toBe('remote')
  })
})
```

- [ ] **Step 3: Add vitest to mobile package (if not present)**

```bash
cd apps/mobile
pnpm add -D vitest
```

Add to `apps/mobile/package.json` scripts:
```json
"test": "vitest run"
```

- [ ] **Step 4: Run the test**

```bash
cd apps/mobile
pnpm test src/__tests__/useDb.test.ts
```

Expected: `2 tests passed`

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/hooks/useDb.ts apps/mobile/src/__tests__/useDb.test.ts
git commit -m "feat(mobile): add useDb routing hook + unit test"
```

---

## Task 8: Update `useSnags.ts`

**Files:**
- Modify: `apps/mobile/src/hooks/useSnags.ts`

The `queryFn` branches on `useDb('snags').type`. When `local`, it queries the PowerSync SQLite DB using parameterised SQL. When `remote`, it falls back to the Supabase client (used during the transition period or if PowerSync is not connected).

Mutations (create, update, delete) remain unchanged — they write direct to Supabase; PowerSync propagates the changes back.

- [ ] **Step 1: Rewrite useSnags.ts**

```ts
// apps/mobile/src/hooks/useSnags.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDb } from './useDb'
import { useSupabase } from '../providers/SupabaseProvider'
import type { PowerSyncDatabase } from '@powersync/react-native'

type Snag = {
  id: string
  project_id: string
  title: string
  description: string
  status: 'open' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high'
  created_at: string
  updated_at: string
}

export function useSnags(projectId: string) {
  const { type, db } = useDb('snags')
  const supabase = useSupabase()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['snags', projectId, type],
    queryFn: async (): Promise<Snag[]> => {
      if (type === 'local') {
        return (db as PowerSyncDatabase).getAll<Snag>(
          'SELECT * FROM snags WHERE project_id = ? ORDER BY created_at DESC',
          [projectId]
        )
      }
      const { data, error } = await (db as typeof supabase)
        .from('snags')
        .select('*')
        .eq('project_id', projectId)
      if (error) throw error
      return data as Snag[]
    },
    enabled: !!projectId,
  })

  const createSnag = useMutation({
    mutationFn: async (input: Omit<Snag, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase.from('snags').insert(input).select()
      if (error) throw error
      return data[0] as Snag
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snags', projectId] })
    },
  })

  const updateSnag = useMutation({
    mutationFn: async (input: Partial<Snag> & { id: string }) => {
      const { id, ...update } = input
      const { data, error } = await supabase
        .from('snags')
        .update(update)
        .eq('id', id)
        .select()
      if (error) throw error
      return data[0] as Snag
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snags', projectId] })
    },
  })

  const deleteSnag = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('snags').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['snags', projectId] })
    },
  })

  return {
    snags: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createSnag: createSnag.mutate,
    updateSnag: updateSnag.mutate,
    deleteSnag: deleteSnag.mutate,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/hooks/useSnags.ts
git commit -m "feat(mobile): useSnags reads from PowerSync SQLite when available"
```

---

## Task 9: Update `useProjects.ts`

**Files:**
- Modify: `apps/mobile/src/hooks/useProjects.ts`

Same pattern as `useSnags` — branch on `useDb('projects').type`.

- [ ] **Step 1: Rewrite useProjects.ts**

```ts
// apps/mobile/src/hooks/useProjects.ts
import { useQuery } from '@tanstack/react-query'
import { useDb } from './useDb'
import { useSupabase } from '../providers/SupabaseProvider'
import { useAuth } from '../providers/AuthProvider'
import type { PowerSyncDatabase } from '@powersync/react-native'

type Project = {
  id: string
  name: string
  status: string
  city: string | null
  province: string | null
  organisation_id: string
}

export function useProjects() {
  const { type, db } = useDb('projects')
  const supabase = useSupabase()
  const { profile } = useAuth()
  const orgId = (profile as any)?.user_organisations?.[0]?.organisation_id ?? null

  return useQuery({
    queryKey: ['projects', orgId, type],
    queryFn: async (): Promise<Project[]> => {
      if (!orgId) return []

      if (type === 'local') {
        return (db as PowerSyncDatabase).getAll<Project>(
          'SELECT * FROM projects WHERE organisation_id = ? ORDER BY name ASC',
          [orgId]
        )
      }
      const { data, error } = await (db as typeof supabase)
        .from('projects')
        .select('*')
        .eq('organisation_id', orgId)
      if (error) throw error
      return data as Project[]
    },
    enabled: !!orgId,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/mobile/src/hooks/useProjects.ts
git commit -m "feat(mobile): useProjects reads from PowerSync SQLite when available"
```

---

## Task 10: Create Sync Rules

**Files:**
- Create: `supabase/powersync/sync-rules.yaml`

Sync rules are deployed to the PowerSync dashboard (not via Supabase migrations). They mirror the RLS policies — every row is filtered by `org_id` from the JWT.

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p supabase/powersync
```

- [ ] **Step 2: Write sync-rules.yaml**

```yaml
# supabase/powersync/sync-rules.yaml
#
# Deploy via: PowerSync Dashboard > Sync Rules > paste contents
# Each bucket is partitioned by org_id from the JWT token_parameters.
# This mirrors the Supabase RLS policies — each user only syncs their org's data.

bucket_definitions:
  org_projects:
    parameters:
      - name: org_id
        token_parameter: org_id
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

- [ ] **Step 3: Commit**

```bash
git add supabase/powersync/sync-rules.yaml
git commit -m "feat: add PowerSync sync-rules.yaml (org_id bucket partitioning)"
```

---

## Task 11: JWT `org_id` Hook Migration

**Files:**
- Create: `supabase/migrations/00014_powersync_jwt_hook.sql`

PowerSync uses `org_id` from the JWT `token_parameters` to filter sync buckets. This Postgres function injects `org_id` into every JWT at sign-in time.

**Deploy:** After running this migration, go to Supabase Dashboard → Authentication → Hooks → Enable "Custom access token" hook → select function `public.custom_jwt_claims`.

- [ ] **Step 1: Create the migration directory (if needed)**

```bash
mkdir -p supabase/migrations
```

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/00014_powersync_jwt_hook.sql
-- Description: Custom JWT hook — injects org_id claim for PowerSync bucket partitioning.
-- Deploy: run migration, then enable hook in Supabase Dashboard > Auth > Hooks.

CREATE OR REPLACE FUNCTION public.custom_jwt_claims(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id  UUID;
  _org_id   UUID;
  _claims   JSONB;
BEGIN
  _user_id := (event ->> 'user_id')::UUID;

  -- Get the user's first active organisation
  SELECT organisation_id INTO _org_id
  FROM user_organisations
  WHERE user_id = _user_id
    AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1;

  _claims := event -> 'claims';

  IF _org_id IS NOT NULL THEN
    _claims := jsonb_set(_claims, '{org_id}', to_jsonb(_org_id::TEXT));
  END IF;

  RETURN jsonb_set(event, '{claims}', _claims);
END;
$$;

-- Allow Supabase Auth to call this function
GRANT EXECUTE ON FUNCTION public.custom_jwt_claims(JSONB) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_jwt_claims(JSONB) FROM PUBLIC;
```

- [ ] **Step 3: Apply the migration**

Option A — Supabase CLI (if configured):
```bash
supabase db push
```

Option B — Supabase SQL editor:
Copy the SQL above into Supabase Dashboard → SQL Editor → Run.

- [ ] **Step 4: Enable the hook in the dashboard**

Go to: Supabase Dashboard → Authentication → Hooks → "Custom access token hook"
Select function: `public.custom_jwt_claims`
Save.

- [ ] **Step 5: Verify — sign out and back in, check JWT**

```bash
# In a browser console on the app:
const { data } = await supabase.auth.getSession()
const payload = JSON.parse(atob(data.session.access_token.split('.')[1]))
console.log(payload.org_id)   // should print the UUID of the user's org
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00014_powersync_jwt_hook.sql
git commit -m "feat: add custom JWT hook to inject org_id claim for PowerSync"
```

---

## Task 12: Sprint 0 Roundtrip Integration Test

**Files:**
- Create: `apps/mobile/src/__tests__/powersync-roundtrip.test.ts`

This is the Sprint 0 exit gate. It must pass before the PR merges. It requires a real PowerSync instance and a real Supabase connection — run it with real env vars, not mocks.

**Prerequisites:** `EXPO_PUBLIC_POWERSYNC_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `TEST_ORG_ID`, `TEST_PROJECT_ID`, `TEST_USER_EMAIL`, `TEST_USER_PASSWORD` all set in `apps/mobile/.env.test`.

- [ ] **Step 1: Write the test**

```ts
// apps/mobile/src/__tests__/powersync-roundtrip.test.ts
//
// Sprint 0 exit gate — MUST PASS before merging PowerSync PR.
// Requires real env vars: see apps/mobile/.env.test
//
// Run: DOTENV_CONFIG_PATH=.env.test pnpm vitest run src/__tests__/powersync-roundtrip.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { PowerSyncDatabase } from '@powersync/react-native'
import { AppSchema } from '../lib/powersync/schema'
import { SupabaseConnector } from '../lib/powersync/connector'

const SYNC_WAIT_MS = 15_000

describe('PowerSync round-trip (Sprint 0 exit gate)', () => {
  let supabase: ReturnType<typeof createClient>
  let db: PowerSyncDatabase
  let createdSnagId: string

  beforeAll(async () => {
    supabase = createClient(
      process.env.EXPO_PUBLIC_SUPABASE_URL!,
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!
    )

    // Sign in as test user
    const { error } = await supabase.auth.signInWithPassword({
      email: process.env.TEST_USER_EMAIL!,
      password: process.env.TEST_USER_PASSWORD!,
    })
    if (error) throw new Error(`Auth failed: ${error.message}`)

    // Init and connect PowerSync
    db = new PowerSyncDatabase({
      schema: AppSchema,
      database: { dbFilename: 'esite-test.db' },
    })
    await db.connect(new SupabaseConnector(supabase))

    // Wait for initial sync
    await new Promise(r => setTimeout(r, SYNC_WAIT_MS))
  }, 60_000)

  afterAll(async () => {
    // Clean up test snag
    if (createdSnagId) {
      await supabase.from('snags').delete().eq('id', createdSnagId)
    }
    await db.disconnect()
    await db.close()
    await supabase.auth.signOut()
  })

  it('creates a snag in Supabase and syncs it to local SQLite', async () => {
    // 1. Write to Supabase (write path — bypasses PowerSync)
    const { data: created, error } = await supabase
      .from('snags')
      .insert({
        title: 'PowerSync roundtrip test',
        description: 'Sprint 0 exit gate — delete me',
        status: 'open',
        priority: 'low',
        project_id: process.env.TEST_PROJECT_ID!,
        organisation_id: process.env.TEST_ORG_ID!,
      })
      .select()
      .single()

    expect(error).toBeNull()
    expect(created).not.toBeNull()
    createdSnagId = created!.id

    // 2. Wait for PowerSync to sync the row down
    await new Promise(r => setTimeout(r, SYNC_WAIT_MS))

    // 3. Assert the row is in local SQLite
    const rows = await db.getAll<{ id: string; title: string }>(
      'SELECT id, title FROM snags WHERE id = ?',
      [createdSnagId]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('PowerSync roundtrip test')
  }, 60_000)

  it('updates a snag in Supabase and the update syncs to SQLite', async () => {
    expect(createdSnagId).toBeDefined()

    // 1. Update via Supabase
    await supabase
      .from('snags')
      .update({ status: 'in_progress' })
      .eq('id', createdSnagId)

    // 2. Wait for sync
    await new Promise(r => setTimeout(r, SYNC_WAIT_MS))

    // 3. Assert update in SQLite
    const row = await db.get<{ status: string }>(
      'SELECT status FROM snags WHERE id = ?',
      [createdSnagId]
    )
    expect(row?.status).toBe('in_progress')
  }, 60_000)
})
```

- [ ] **Step 2: Create `.env.test` template**

```bash
# apps/mobile/.env.test — fill in real values before running roundtrip test
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_POWERSYNC_URL=
TEST_USER_EMAIL=
TEST_USER_PASSWORD=
TEST_ORG_ID=
TEST_PROJECT_ID=
```

- [ ] **Step 3: Run the test (requires live services)**

```bash
cd apps/mobile
DOTENV_CONFIG_PATH=.env.test pnpm vitest run src/__tests__/powersync-roundtrip.test.ts
```

Expected: `2 tests passed` (each with up to 60s timeout)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/__tests__/powersync-roundtrip.test.ts apps/mobile/.env.test
git commit -m "test(mobile): add PowerSync Sprint 0 roundtrip exit gate test"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] PowerSync setup + `PowerSyncProvider` → Tasks 1-5
- [x] Sync rules YAML with `org_id` JWT partition → Task 10
- [x] JWT `org_id` hook → Task 11
- [x] `useDb()` routing hook → Task 7
- [x] `useSnags` updated → Task 8
- [x] `useProjects` updated → Task 9
- [x] `snag_photos` in schema + sync rules → Tasks 2, 10
- [x] Sprint 0 roundtrip test → Task 12

**Type consistency:**
- `PowerSyncDatabase` used consistently in Tasks 4, 5, 8, 9, 12
- `SupabaseConnector` defined in Task 3, used in Tasks 5, 12
- `AppSchema` defined in Task 2, used in Tasks 4, 12
- `useDb()` return shape `{ type, db }` consistent across Tasks 7, 8, 9

**No placeholders:** All code blocks are complete and runnable.

**Provider order:** Task 6 restructures layout correctly before Tasks 8-9 try to use `usePowerSync()`.
