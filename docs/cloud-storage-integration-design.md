# Cloud Storage Integration — Design Investigation

**Status:** Investigation. No code change yet. Awaiting Arno greenlight on
the open questions in §6 before any implementation begins.

**Goal:** allow E-Site users to connect their own Dropbox / Google Drive /
OneDrive, point a project at a folder, and have drawings flow into the
project's drawings panel — replacing or augmenting today's "upload PDF
from local disk" flow.

**Reference:** another project's Dropbox-only integration, summarised in
the brief that triggered this investigation (manual picker + temp links +
bulk auto-sync, all proxied through edge functions).

---

## 1. Current state of E-Site drawings

- Drawings are modelled as the `projects.floor_plans` table. Files live in
  a Supabase Storage bucket (defined in `00012_invites_storage.sql`).
- Upload UI: [apps/web/src/app/(admin)/projects/[id]/floor-plans/FloorPlanUploadButton.tsx](../apps/web/src/app/(admin)/projects/%5Bid%5D/floor-plans/FloorPlanUploadButton.tsx)
  — local-disk file picker → Supabase Storage → `floor_plans` row insert.
- Markup canvas v2 (`00035_floor_plan_calibration.sql` + `MarkupCanvas.tsx`)
  layers calibration + measure + multi-page-PDF tooling on top.
- RFI annotations key off `floor_plans` rows via `00033_rfi_attachments.sql`.
- Mobile app reads/annotates the same `floor_plans` table via the
  `floor-plan.service.ts` shared service, with PowerSync mirroring it
  offline.
- **Greenfield for cloud integration:** zero references to `dropbox`,
  `google_drive`, `onedrive`, `oauth_token`, `storage_connection`, or
  similar in any migration or code path today.
- **`projects.projects` has no `project_number` column** — name only —
  so the parenthesized-folder-name auto-match pattern from the reference
  doesn't apply unless we add one.

## 2. Adapting the reference architecture

The reference architecture maps cleanly with one structural change
(multi-provider) and one schema delta (project numbering).

### 2.1. Database

```sql
-- Per-user OAuth credentials (encrypted at rest via pgcrypto / Supabase Vault).
-- One user can have multiple providers connected; UNIQUE prevents duplicates per
-- (user, provider, account_email).
CREATE TABLE public.user_storage_connections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('dropbox','google_drive','onedrive')),
  account_email TEXT NOT NULL,
  access_token  BYTEA NOT NULL,           -- encrypted
  refresh_token BYTEA NOT NULL,           -- encrypted
  scope         TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider, account_email)
);
-- RLS: only owner can read/update their connection.

-- Per-project folder mapping. New columns on projects.projects.
ALTER TABLE projects.projects ADD COLUMN cloud_storage_provider     TEXT;
ALTER TABLE projects.projects ADD COLUMN cloud_storage_folder_id    TEXT;   -- stable provider ID
ALTER TABLE projects.projects ADD COLUMN cloud_storage_folder_path  TEXT;   -- display path
ALTER TABLE projects.projects ADD COLUMN cloud_storage_connected_by UUID
                                            REFERENCES public.profiles(id); -- whose tokens
ALTER TABLE projects.projects ADD COLUMN cloud_storage_last_sync_at TIMESTAMPTZ;

-- Optional: floor_plans gets a provenance column so we can tell apart
-- locally-uploaded PDFs from synced ones.
ALTER TABLE projects.floor_plans ADD COLUMN source_provider     TEXT;       -- null = local upload
ALTER TABLE projects.floor_plans ADD COLUMN source_file_id      TEXT;       -- provider stable ID
ALTER TABLE projects.floor_plans ADD COLUMN source_revision_id  TEXT;       -- for revision tracking
ALTER TABLE projects.floor_plans ADD COLUMN synced_at           TIMESTAMPTZ;
CREATE UNIQUE INDEX ON projects.floor_plans (project_id, source_provider, source_file_id)
  WHERE source_provider IS NOT NULL;
```

### 2.2. Edge functions (Deno, service-role-guarded)

| Function                 | Role |
|--------------------------|------|
| `cloud-oauth-exchange`   | Code → token swap; provider-aware. Stores tokens. |
| `cloud-list-folder`      | Proxy: list children of a folder (for picker UI). |
| `cloud-get-temp-link`    | Proxy: short-lived direct-download URL for a file. |
| `cloud-sync-drawings`    | Bulk: walks project's mapped folder, imports new PDFs. |

App secrets stay in Edge env vars: `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET`,
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `MS_GRAPH_CLIENT_ID` /
`MS_GRAPH_CLIENT_SECRET`. Token refresh happens server-side, transparently.

### 2.3. TypeScript abstraction

```ts
interface CloudStorageProvider {
  authorize(state: string, redirectUri: string): { authUrl: string }
  exchangeCode(code: string, redirectUri: string): Promise<TokenBundle>
  refreshTokens(refreshToken: string): Promise<TokenBundle>
  listFolder(folderId: string | null, token: string): Promise<CloudItem[]>
  getTempLink(fileId: string, token: string): Promise<{ url: string; expiresAt: Date }>
  downloadFile(fileId: string, token: string): Promise<{ body: ReadableStream; mime: string; name: string }>
  // Optional Phase 3:
  watchFolder?(folderId: string, callbackUrl: string, token: string): Promise<{ subscriptionId: string }>
}

class DropboxProvider implements CloudStorageProvider { ... }
class GoogleDriveProvider implements CloudStorageProvider { ... }
class OneDriveProvider implements CloudStorageProvider { ... }
```

Provider-specific gotchas the abstraction must hide:
- **Dropbox:** refresh-token long-lived, access-token short-lived; choose
  app-folder vs full-Dropbox scope (full needed for "point at any folder").
- **Google Drive:** shared-drives have a different surface from My Drive;
  `drive.readonly` scope (not `drive.file`) needed to point at user's
  pre-existing folders.
- **OneDrive:** Microsoft Graph; personal vs business endpoints differ;
  `Files.Read.All` scope; `driveItem` IDs survive renames but not deletes.

### 2.4. Three import modes (1-to-1 with the reference)

| Mode | Maps to | Notes |
|------|---------|-------|
| Manual file picker | `FloorPlanUploadButton` source-of-file dropdown gains "From cloud" → folder browser dialog | Replaces local upload OR coexists |
| Direct temp link | New optional render path in `DrawingViewer` | Skip if Pattern A chosen — files always live in Supabase |
| Bulk auto-sync | "Sync now" button on `/projects/[id]/floor-plans` | Calls `cloud-sync-drawings`; reports new/skip/error counts |

## 3. Sync model decision (the big one)

|                           | A. Sync-then-own | B. Live-link | C. Hybrid |
|---------------------------|:---:|:---:|:---:|
| Files copied to Supabase Storage   | every imported file | none | on first view, cached |
| "Latest revision" freshness        | after sync | always | mostly fresh |
| Annotations stable on rename       | yes (path stable internally) | yes (key off provider file_id) | yes |
| Storage $$ on Supabase             | doubled | minimal | medium |
| Render latency                     | fast | slow (1 API call) | fast on hit / slow on miss |
| Mobile offline (PowerSync)         | works | breaks | partial |
| Cloud revoke / file deleted        | imported file persists | breaks | partial |

**Recommendation: Pattern A for Phase 1.**
- E-Site mobile relies on PowerSync to mirror `floor_plans` + their files
  for offline use on construction sites. Pattern B breaks that.
- Pattern A is structurally identical to today's flow — only the *source*
  of the file changes. All downstream code (RFI annotations, markup canvas,
  mobile annotator) stays untouched.
- "Latest revision" gap is solved by sync triggers (manual + scheduled),
  not by re-architecting reads.

## 4. Phased plan

### Phase 1 — Three providers + documents + floor_plans (~3 sprints)

Per Arno's decisions: all three providers in parallel, plus a new generic
`documents` concept alongside `floor_plans`, plus per-org connections.

1. **Migration** `0004x_org_storage_connections.sql` — table + pgcrypto
   token encryption + RLS (any org member SELECT, owners/PMs INSERT).
2. **Migration** `0004x_projects_documents_and_cloud.sql` — new
   `projects.documents` table with provenance columns, `floor_plans`
   provenance columns, project mapping columns, RLS.
3. **Migration** `0004x_storage_buckets_documents.sql` — new Storage
   bucket `project-documents` (in addition to existing floor-plans bucket),
   RLS policies on it.
4. **Shared abstraction** in `packages/shared/src/services/cloud-storage/`:
   `CloudStorageProvider` interface + 3 implementations
   (`DropboxProvider`, `GoogleDriveProvider`, `OneDriveProvider`) + a
   `cloud-storage.service.ts` facade that the web/mobile UI calls.
5. **Edge functions:**
   - `cloud-oauth-exchange` — generic, branches on `?provider=` query param.
   - `cloud-list-folder` — picker browse proxy.
   - `cloud-get-temp-link` — provider temp-link proxy (used during sync).
   - `cloud-sync-project` — bulk import, classifier routes each file into
     `floor_plans` or `documents` per §6 routing rule.
6. **Token encryption helper** in `packages/db/src/encryption.ts` —
   pgcrypto `encrypt_iv` / `decrypt_iv` wrapper, key from env var.
7. **Web UI:**
   - `/settings/integrations` page — list of connections, "Connect
     Dropbox/Drive/OneDrive" buttons, disconnect, last-used.
   - Project drawings tab: folder-picker dialog, "Sync now" button, sync-
     status panel (last run, counts, errors).
   - New project documents tab: list view + upload (local) + cloud picker.
   - `FloorPlanUploadButton` gains a "From cloud" path.
8. **Mobile:** read-only consumption initially; `documents` table added
   to PowerSync sync rules so synced docs appear offline.
9. **Smoke tests + RLS audit** across all 3 providers, all 4 demo roles
   (owner, PM, field, client_viewer): client_viewer should NOT see synced
   docs/drawings outside their assigned project.

### Phase 2 — Auto-sync + revisions (~1 sprint)
- Scheduled `pg_cron` job calling `cloud-sync-project` for active projects.
- Revision detection: store `source_revision_id`, on sync compare, insert as new `floor_plans` / `documents` row OR replace based on policy.
- Webhooks where supported (Dropbox file-request, Drive Push, Graph
  subscriptions) — gracefully degrades to polling when not.

### Phase 3 — Polish
- Audit log of every sync action for the project drawings tab.
- Folder convention auto-match (depends on Open Q2 — `project_number`).
- Multi-folder per project (drawings vs documents vs handover) — modelled
  via a 1-to-many `project_cloud_folders` table replacing the columns from
  Phase 1.

## 5. Security checklist

- [ ] Tokens encrypted at rest (Supabase Vault or `pgcrypto` with a key in Edge env).
- [ ] RLS: `user_storage_connections` readable only by `user_id`.
- [ ] App secrets ONLY in Edge function env. Never shipped to browser/mobile.
- [ ] OAuth state parameter signed (HMAC of user_id + nonce + ttl) to prevent CSRF.
- [ ] Refresh-token rotation if provider supports it (Dropbox does).
- [ ] Audit log for connection create/revoke + every bulk sync.
- [ ] Token revocation endpoint that explicitly calls provider's revoke API
      (don't just delete the row).
- [ ] Rate-limit per-user calls to edge functions to avoid hitting provider
      quotas (Drive 1000 req/100 sec/user, Dropbox 1200 req/min, Graph
      throttles aggressively).

## 6. Open questions — RESOLVED 2026-05-04 (Arno)

1. **Phase 1 scope** → floor_plans AND a new generic `documents` concept.
   The Phase 1 schema additions therefore cover both: drawings continue
   to flow into `projects.floor_plans`; everything else (specs, RFIs in
   PDF, handover packs, contracts, photos, etc.) flows into a new
   `projects.documents` table with a similar provenance shape.
2. **`projects.project_number`** → not added. Folder mapping is **manual
   per project forever** (or until a future Phase chooses to reopen this).
3. **Per-user vs per-org connections** → **per-org**. Any team member of
   the org can browse the connected folder, trigger sync, and see synced
   files. Tokens still owned by the org member who connected (so we have
   a stable refresh trail), but reads/syncs are not gated by which member
   ran them. Schema reflects this — see §2.1 update below.
4. **Sync model** → Pattern A (sync-then-own). Confirmed.
5. **Provider rollout** → all three (Dropbox + Google Drive + OneDrive)
   shipped together in Phase 1. Increases parallel work but means one
   migration, one UI, one launch announcement.
6. **Storage cost ceiling** → noted, no fixed cap. Revisit when usage data
   exists.
7. **OAuth app registrations** → **wait**. Hold off on creating the
   Dropbox / Google Cloud / Microsoft app registrations until
   `@e-site.live` mailboxes are routed. Phase 1 work can otherwise
   proceed; the Dev Console registrations are a small step that gates
   only end-user OAuth, not implementation.

### Schema delta from §2.1 reflecting decision #3 (per-org connections)

```sql
-- Renamed from user_storage_connections → org_storage_connections.
-- Token still owned by the user who connected (foreign key audit trail),
-- but the row is keyed by org and any org member can use it.
CREATE TABLE public.org_storage_connections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('dropbox','google_drive','onedrive')),
  account_email   TEXT NOT NULL,         -- the cloud account, not the org member
  connected_by    UUID NOT NULL REFERENCES public.profiles(id),
  access_token    BYTEA NOT NULL,        -- encrypted
  refresh_token   BYTEA NOT NULL,        -- encrypted
  scope           TEXT,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, provider, account_email)
);
-- RLS: any active member of the org (`user_organisations`) can SELECT.
-- Only org owners/PMs can INSERT/UPDATE/DELETE (i.e. connect/disconnect).
-- Tokens themselves never leave Edge functions — they're decrypted there
-- and never returned to the client.

-- Per-project folder mapping. Same as before, but now a project can use
-- ANY connection in its org's pool (not tied to a single user).
ALTER TABLE projects.projects ADD COLUMN cloud_storage_connection_id UUID
                                            REFERENCES public.org_storage_connections(id);
ALTER TABLE projects.projects ADD COLUMN cloud_storage_folder_id    TEXT;
ALTER TABLE projects.projects ADD COLUMN cloud_storage_folder_path  TEXT;
ALTER TABLE projects.projects ADD COLUMN cloud_storage_last_sync_at TIMESTAMPTZ;

-- New generic documents concept (decision #1).
CREATE TABLE projects.documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id UUID NOT NULL REFERENCES public.organisations(id),
  name            TEXT NOT NULL,
  category        TEXT,                  -- e.g. 'spec', 'contract', 'handover', 'photo', 'misc'
  storage_path    TEXT NOT NULL,         -- Supabase Storage path
  mime_type       TEXT,
  size_bytes      BIGINT,
  -- Provenance (null for locally-uploaded; populated for cloud-synced).
  source_provider     TEXT,
  source_file_id      TEXT,
  source_revision_id  TEXT,
  source_path         TEXT,
  synced_at           TIMESTAMPTZ,
  uploaded_by         UUID REFERENCES public.profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ON projects.documents (project_id, source_provider, source_file_id)
  WHERE source_provider IS NOT NULL;

-- floor_plans gets the same provenance columns so cloud sync can target it
-- when the file looks like a drawing (PDF, .dwg/.dxf/.dgn naming heuristic,
-- or a project subfolder convention like /Drawings/).
ALTER TABLE projects.floor_plans ADD COLUMN source_provider     TEXT;
ALTER TABLE projects.floor_plans ADD COLUMN source_file_id      TEXT;
ALTER TABLE projects.floor_plans ADD COLUMN source_revision_id  TEXT;
ALTER TABLE projects.floor_plans ADD COLUMN source_path         TEXT;
ALTER TABLE projects.floor_plans ADD COLUMN synced_at           TIMESTAMPTZ;
CREATE UNIQUE INDEX ON projects.floor_plans (project_id, source_provider, source_file_id)
  WHERE source_provider IS NOT NULL;
```

### Sync routing rule (decision #1 implication)

When `cloud-sync-drawings` walks the project's mapped folder, each file
needs to land in either `floor_plans` or `documents`. Initial heuristic:

- `.pdf` files in a subfolder named `/Drawings/` (case-insensitive),
  `/Plans/`, `/Floor Plans/`, or at folder root with filename matching
  `*plan*.pdf` / `*drawing*.pdf` → `floor_plans`.
- `.dwg`, `.dxf`, `.dgn`, `.rvt` files → `floor_plans` (raw CAD; PDF
  flatten happens at view time per markup-canvas v2).
- Everything else (`.docx`, `.xlsx`, `.zip`, `.jpg`, other `.pdf`) →
  `documents`.

This is the cheapest classifier; revisit in Phase 4 with a per-folder
override (e.g. project owner explicitly tags a subfolder as "drawings"
or "documents"). Edge function name will be `cloud-sync-project` rather
than `cloud-sync-drawings` to reflect the broader scope.

## 7. Estimate (post-decision)

- Phase 1 (3 providers + documents + floor_plans + per-org): **~3 sprints
  (15–20 working days)**. The wider scope (3 providers in parallel,
  documents table additional to floor_plans) costs ~50% more than the
  original 2-sprint estimate but saves a future re-launch.
- Phase 2 (auto-sync + revisions): **~1 sprint**.
- Phase 3 (polish): scoped per item.

Total to "all three providers + auto-sync": ~4 sprints if uninterrupted.

## 8. Phase 1 milestone breakdown

Decomposed into commit-sized chunks. Each row is independently shippable
to feat/powersync as a preview build.

| # | Milestone | Changes | Acceptance |
|---|-----------|---------|------------|
| 1 | Schema foundation | 3 migrations: `org_storage_connections`, `documents` + `cloud_*` columns, `project-documents` storage bucket. RLS. Token-encryption helper in `packages/db`. | Migrations apply clean to staging; RLS probe shows correct visibility per role. |
| 2 | Provider abstraction | `CloudStorageProvider` interface + 3 stub implementations + `cloud-storage.service.ts` facade. Unit tests for each provider against mocks. | TS clean, all 3 providers pass shared interface test suite. |
| 3 | OAuth + token storage | `cloud-oauth-exchange` edge function + `/auth/cloud-callback` web route + start-OAuth web action. App secrets read from Supabase Edge env. | Connect-then-disconnect flow works for all 3 providers (using test apps + dummy redirect). |
| 4 | Folder browse + picker UI | `cloud-list-folder` edge function + `<CloudFolderPicker />` React component (modal dialog, hierarchical tree, search). | Browse all 3 providers, pick a folder, store mapping on project. |
| 5 | Bulk sync + classifier | `cloud-sync-project` edge function with the routing rule from §6. "Sync now" button on drawings + documents tabs. Server reports counts (new / skipped / failed / classified-as-drawing-vs-document). | One project mapped to a real folder per provider; sync produces the expected `floor_plans` + `documents` rows; reruns are idempotent. |
| 6 | Documents tab UI | `/projects/[id]/documents` page (list, filter, search, download via temp link, delete). Local-upload also lands here for non-cloud users. | Owner + PM + field can list/upload; client_viewer scoped per RLS. |
| 7 | Drawings tab cloud integration | `FloorPlanUploadButton` gains "From cloud" mode; existing local-upload preserved. | Existing markup-canvas + RFI-annotation flows work unchanged on cloud-synced floor_plans. |
| 8 | Mobile read-only sync | `documents` added to PowerSync sync rules; mobile shows synced files in a project's documents tab. | Documents visible offline on mobile after a sync. |
| 9 | RLS audit + smoke test pass | Probe all 4 demo roles × 3 providers × 2 tabs (drawings, documents). Cross-org probe must 403. Per-project scope for client_viewer. | RLS table green; 0 cross-org leaks. |
| 10 | OAuth-app registrations (BLOCKED on `@e-site.live` mailboxes) | Create Dropbox app, Google Cloud project, Microsoft App Registration. Add redirect URIs. Wire client IDs/secrets into Supabase Edge env. | All 3 providers reach end-user OAuth consent in production. |

Milestone 10 unlocks production rollout but is gated on Arno's mailbox
work — Phase 1 implementation (#1–#9) can land in preview builds without
it; the registrations only block the final go-live moment.

## 9. Risks + watch-outs

- **PowerSync compatibility**: PowerSync sync rules need updating to
  include the `documents` table. Verify the offline payload size doesn't
  blow up — a 50-MB drawing folder synced offline per project is fine,
  500 MB is not. May need a "sync only metadata + thumbnails offline" flag.
- **Storage bucket sprawl**: Decided on one bucket `project-documents` for
  documents in addition to existing floor-plans bucket. Avoids RLS
  cross-pollination. Revisit if document categories grow > 5.
- **OAuth refresh-token revocation**: when a user (the `connected_by`)
  leaves the org, what happens to the connection? Phase 1 keeps the
  token (org owns the connection, not the user). Phase 3 adds a UI to
  rotate the token to another member or disconnect.
- **Drive shared-drives**: the `drive.readonly` scope works for shared
  drives, but enumerating files needs `supportsAllDrives=true` and
  `includeItemsFromAllDrives=true`. The provider impl must handle this.
- **OneDrive personal vs business**: different auth endpoints. The
  provider impl branches on the user's account type, which is reported
  in the token claims after exchange.
- **Encryption-key management**: token encryption key lives in Edge env
  (`STORAGE_TOKEN_ENC_KEY`). Rotation requires re-encrypting all
  `org_storage_connections` rows. Document the rotation procedure.
