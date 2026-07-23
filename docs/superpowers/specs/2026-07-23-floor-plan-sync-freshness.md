# Floor-plan cloud sync freshness — spec

**Date:** 2026-07-23
**Status:** approved (Arno, 2026-07-23 — "correct the issues and advance the setting and pages")
**Investigation:** full-chain, prod-evidenced. See PR body for the evidence table.

## Problems being fixed

1. **MAX_FILES=50 walk cap counts unchanged files.** `cloud-sync-project` collects at most
   50 files per run and rev-skipped files consume the budget, so folders with >50 files
   never sync the remainder (KINGSWALK: 73 plans, every run processes exactly 50;
   ITONKA frozen at exactly 50 since 2026-05-26). Reconcile (delete/rename) is skipped
   whenever the cap is hit, so Dropbox deletions never propagate for large folders.
2. **No automatic sync.** The 15-min `cloud-sync-poll` cron shipped as a commented-out
   block in 00148 and was never scheduled (prod `cron.job` has 7 jobs, none for sync;
   all 11 `cloud_sync_runs` rows ever are `trigger='manual'`).
3. **Sync ≠ what users see.** Changed drawings only get `has_newer_version=true` + a
   small badge; the active file never moves without a per-row "Update" click. Users
   read "Sync done" + an unchanged drawing as "sync is broken".
4. **Drift:** the edge `_shared/cloud-storage` copy lost `sortCloudItems` (walk order =
   raw Dropbox order → the 50-window is arbitrary per run) and carries stale comments.
5. **Dishonest telemetry:** `cloud_storage_last_sync_at` stamps even on failed runs;
   an all-files-failed run returns HTTP 200; a dead refresh token 500s forever with no
   user-visible "reconnect" state.
6. **Waste:** a changed-but-unadopted drawing is re-downloaded on every subsequent run
   (`newVersions` recounts until adopted).

## Design

### Engine (`cloud-sync-project`)
- **Metadata-first walk:** enumerate the whole tree (BFS, `MAX_DEPTH=5` kept,
  hidden-dot skip kept, `MAX_ENTRIES=2000` runaway guard). Listing is cheap; rev
  comparison needs no downloads and runs against a **prefetched index** (two
  queries per run, not two per file — a 2000-entry walk must not pay ~4000
  sequential round-trips). `walk_complete` is true unless enumeration genuinely
  stopped early (exactly-at-cap complete walks are not "truncated").
- **Download budget:** only new/changed files are downloaded, up to
  `MAX_DOWNLOADS=20` **successes** per invocation, with a separate
  `MAX_DOWNLOAD_ATTEMPTS=40` cap so permanently-failing files can't starve the
  files behind them in walk order. The response reports `remaining`; callers
  loop until 0 (bounded).
- **Already-captured skip:** a changed drawing whose `latest_revision_id` already
  equals the live rev (version row captured, adoption pending) is `skipped`, not
  re-downloaded (reactivated if it was soft-removed and reappeared).
- **New-file classification precedence:** CAD extensions (always drawings) →
  explicit request intent (a user clicked Sync on a tab) → the project's
  persisted `cloud_storage_default_target` (declared when the folder was
  mapped — what cron/auto triggers use) → filename/folder heuristic. Tab-open
  auto-syncs pass NO intent: which tab happened to be open must not decide
  where new files are filed.
- **Auto-adopt rule (approved recommendation):** on a changed drawing, if the plan has
  **zero annotations** — no `rfi_annotations.source_floor_plan_id` rows, no
  `projects.qc_entry_photos.source_floor_plan_id` rows, no `field.snags` row whose
  `floor_plan_pin` contains the plan id, and `pixels_per_meter IS NULL` — the new
  revision is adopted immediately (active file swapped; version row still recorded;
  `has_newer_version` stays false; counted as `adopted`). The check **fails
  closed**: any query error counts as annotated, and a post-adopt re-check flags
  the drawing if an annotation landed inside the check-then-act window.
  Annotated drawings keep the explicit two-step flow (badge + Update / Update all).
- **Run row lifecycle:** insert `cloud_sync_runs` row at start (`status='running'`),
  close in a `finally` (`done`/`error`, counts, `files_seen`, `downloads`,
  `walk_complete`, `remaining`, `finished_at`). In-flight detection = a `running` row
  younger than 3 min. Also the concurrency guard for auto-sync.
- **Stamping:** `cloud_storage_last_sync_at` stamps on every run that completes
  without a fatal error — it means "the folder was checked at T" and is what the
  auto-sync freshness gate reads (gating it on `walk_complete` would make
  over-cap folders re-walk on every tab open forever). `walk_complete` on the
  run row records whether enumeration truly covered everything; the deletion
  reconcile stays gated on that.
- **Token health:** an **auth-class** refresh failure (invalid_grant / 400 / 401)
  sets `org_storage_connections.needs_reauth=true` + `last_sync_error`; transient
  failures (5xx/network) do NOT flag. A 401 thrown by the walk itself (token
  revoked while `expires_at` still future) also flags. The flag is cleared by an
  OAuth reconnect (the callback upsert). Sync requests against a `needs_reauth`
  connection fail fast; the web maps that to a calm "paused — reconnect" chip.

### Web
- **Auto-sync on tab open (stale-while-revalidate):** the floor-plans and documents
  pages render instantly from the DB; a client effect calls
  `autoSyncCloudFolderAction`, which triggers the edge function with
  `trigger='auto'` **iff** the project is mapped, the caller can view the project, no
  run is in-flight, and the last completed check is older than `AUTO_SYNC_MAX_AGE_MIN=5`.
  It loops while `remaining>0` (max 6 legs). Read-only members trigger it too (they
  deserve fresh data; the edge function is service-role either way).
- **Indicator:** a slim status chip near the toolbar: "Checking Dropbox for updates…" →
  "Up to date · checked HH:MM" / "N updates pulled" (then router.refresh()) /
  "Sync problem: <reason>" (incl. reconnect-needed). Rendered for read-only users too.
- **"Update all":** when any plan has `has_newer_version`, a banner above the list
  shows the count + one button to adopt all flagged plans (single confirm, same
  warning text as per-row Update, which remains).
- **Reauth surfacing:** `CloudSyncToolbar` shows a warning row when the mapped
  connection `needs_reauth`; `/settings/integrations` shows a "Reconnect" state on the
  connection card (re-runs the normal OAuth connect flow).
- `syncProjectCloudFolderAction` (manual button) also loops on `remaining` so "Sync
  now" finishes the whole folder in one click.

### Cron
`cloud-sync-cron` (already deployed, never scheduled) gets scheduled every 15 min as
`cloud-sync-poll` via the Management API after deploy, mirroring the existing jobs'
`net.http_post` + inline service-key pattern (jobs 1–7). Not a migration — job config,
consistent with how 00029–00031's crons were applied. The cron function now loops each
project while `remaining>0` (bounded) so large folders converge.

### Migration `00175_cloud_sync_freshness.sql`
(00174 left for open PR #151's renumber.)
- `tenants.cloud_sync_runs`: + `status text NOT NULL DEFAULT 'done'
  CHECK (status IN ('running','done','error'))`, + `files_seen int`, + `downloads int`,
  + `walk_complete boolean`, + `remaining int`; `trigger` CHECK widened to
  `('manual','cron','auto')`.
- `projects.projects`: + `cloud_storage_default_target text
  CHECK (IN ('drawings','documents'))`, backfilled to `'drawings'` for existing
  mappings whose imports are exclusively floor plans (prod-verified reality for
  all 4 mapped projects).
- `public.org_storage_connections`: + `needs_reauth boolean NOT NULL DEFAULT false`,
  + `last_sync_error text`.
- Plain column adds → `NOTIFY pgrst, 'reload schema'` only (no schema create/drop).

### Deploy order (matters)
1. Merge → migration auto-applies (deploy-migrations.yml) + Vercel builds web.
2. Deploy `cloud-sync-project` + `cloud-sync-cron` via CLI immediately after
   the migration lands (the new engine selects `needs_reauth` /
   `cloud_storage_default_target` — pre-migration it would 500; the new web
   normalizes old-engine responses so that direction degrades gracefully).
3. Schedule the `cloud-sync-poll` cron via the Management API (inline-key
   `net.http_post` pattern, same as prod jobs 1–7).

## Non-goals
- Dropbox webhooks (Phase 3 as designed).
- Team-scoped app migration (Architecture B roadmap).
- Changing classification heuristics.

## Verification plan (stated upfront)
1. CI: shared + web vitest, type-check, lint.
2. Post-deploy, service-role manual sync on KINGSWALK: expect `files_seen ≥ 73`,
   `walk_complete=true`, run row `done`, and the >50-file tail finally checked.
3. ITONKA: expect a backlog import (two months stale) across looped legs; counts land
   in `cloud_sync_runs`; `cloud_storage_last_sync_at` current.
4. `cron.job` lists `cloud-sync-poll`; within 30 min ≥1 run row with `trigger='cron'`.
5. Browser (www.e-site.live): floor-plans tab shows the checking → up-to-date chip;
   read-only fixture sees the chip but no write controls.
6. Auto-adopt: verify a changed unannotated drawing swaps `file_path` with no badge;
   annotated drawings still flag.
