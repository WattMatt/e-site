# Dropbox Team-Scoped App Migration Roadmap

> **Audience:** Arno + Claude-in-Chrome session + Claude Code session.
> **Goal:** Migrate from the current Architecture A (per-user OAuth, individual-scoped Dropbox app) to **Architecture B** (admin-installed, team-scoped Dropbox app). After this lands, an org admin authorises Dropbox once for the entire org, and every user in the org sees the same team-folder mappings. No per-user OAuth.
> **Companion docs:** [`cloud-storage-oauth-setup-roadmap.md`](cloud-storage-oauth-setup-roadmap.md) (the original A-style setup; superseded by this doc for Dropbox), [`paystack-go-live-roadmap.md`](paystack-go-live-roadmap.md) (same Claude-Chrome PRE-FILL pattern).
> **Status as of 2026-05-13:** Architecture A is shipped on `feat/powersync` but is the wrong fit for B2B team workflows — every user has to OAuth individually, the path-root header dance is fragile, and per-user disconnect creates per-user data loss. Architecture B is a clean break.

---

## How to use this doc

Same two-layer pattern as the Paystack roadmap:

1. **PRE-FILL blocks** — boxed `> **PRE-FILL BEFORE PASTING**` sections. Arno fills with values Claude-in-Chrome can't discover.
2. **Pasteable scripts** — boxed `> **Task:**` sections. Self-contained Claude-in-Chrome prompts.

**Sequence (do in order, each section depends on the previous):**

| § | Doer | Time | Output |
|---|---|---|---|
| 0 | Arno | 0 | Confirm Architecture B + scope |
| 1 | Arno | 5 min | Confirm prerequisites (admin access, Dropbox business plan tier) |
| 2 | Claude-in-Chrome | 20 min | New Dropbox app re-registered as Team scoped, admin-approved |
| 3 | Claude Code | 1 h | Migration committed: schema + provider + server actions + UI + tests |
| 4 | Claude Code via CLI | 5 min | New env vars set on Vercel + Supabase Edge |
| 5 | Arno | 10 min | Smoke test: admin install → org-wide visibility |
| 6 | Claude Code | 30 min | Cleanup: delete old user-scoped app, deprecate per-user connection rows |

Total: ~2.5 hours from start to working team-scoped flow.

---

## §0 — Architecture decision locked: B

**What changes vs. Architecture A:**

| Concern | A (current) | B (this migration) |
|---|---|---|
| Dropbox app type | Scoped, individual access (Full Dropbox) | Scoped, **team access** with `team_data.*` + `members.read` |
| Who OAuths | Each user, individually | Org admin, once |
| Token type | Per-user user-token | One team-token per org |
| API call shape | Bearer + (sometimes) `Dropbox-API-Path-Root` header | Bearer + `Dropbox-API-Select-User` header (act-as a specific team member) |
| `org_storage_connections` row count | One per (org, provider, user_email) | **One per (org, provider)** — uniqueness changes |
| Disconnect impact | Only that user's connection lost | Whole-org disconnect (with warning) |
| New-user onboarding | Each user clicks Connect after signup | Just-works — they inherit the org's connection |
| Folder picker visibility | Whatever that user can see in Dropbox | Whatever the team has — admin's view |

**What stays the same:**

- The `<CloudFolderPicker>` and `<CloudSyncToolbar>` UIs (just point at a different connection model)
- The `cloud-sync-project` edge function shape (just gets a team token instead of a user token)
- The encryption-at-rest pattern (`STORAGE_TOKEN_ENC_KEY` unchanged)
- Per-project folder mappings (`projects.cloud_storage_connection_id` etc. unchanged)
- The Path-Root header logic shipped in `bcc1ab9` is **kept** — it's still needed because admin tokens also have a home namespace; the Select-User header just changes which team member's perspective is used. Defence in depth.

**What this does NOT cover:**

- Google Drive and Microsoft OneDrive equivalents — those have their own team-scoped patterns (Drive shared drives, OneDrive Sites). Out of scope for this migration; address in separate roadmaps if/when those providers come online.
- Migrating existing per-user connection rows. The current set is small (one or two test connections from this week's debugging). Plan: deprecate the old rows in §6, leave their schema columns until a future cleanup commit.

---

## §1 — Pre-flight (Arno gathers, ~5 min)

**Hard prerequisites — all of these must be true or §2 will fail:**

- [ ] **Dropbox Business plan tier**: Standard, Advanced, or Enterprise (Business Plus does NOT support team apps via the public API in some configurations — verify by attempting §2).
- [ ] **Arno is the Dropbox team admin** (not just a member). Confirm at https://www.dropbox.com/team/admin — should see "Admin Console" in the sidebar.
- [ ] **Existing user-scoped "E-Site Construction" app** (App key `xze8h0qfb3ces0q`) — we keep this for now, will delete in §6 after migration is verified.

**Decisions:**

- [ ] **Team-app name** — must be globally unique within Dropbox app namespace. Suggested: `E-Site Construction Team` (reuse logo, contact email).
- [ ] **Whether to require team-admin role for the install action in E-Site** — yes, recommended. Only org owner/admin in E-Site can hit the Connect button. Field workers / PMs see a "Connect to enable cloud sync — ask your org owner" message instead.

**Documents/keys ready:**

- Same `OAUTH_STATE_SECRET` + `STORAGE_TOKEN_ENC_KEY` already on Vercel + Supabase Edge — no rotation needed.
- New `DROPBOX_TEAM_APP_KEY` + `DROPBOX_TEAM_APP_SECRET` will come from §2.

---

## §2 — Re-register Dropbox app as Team scoped (Claude-in-Chrome, ~20 min)

> **PRE-FILL BEFORE PASTING.**
>
> ```
> # The Dropbox account that owns the team. MUST be the team admin
> # (verify by checking that "Admin Console" appears in the Dropbox sidebar).
> DROPBOX_OWNER_EMAIL=<arno@wmeng.co.za>
>
> # New app name. Must be globally unique. Suggested name appended with
> # "Team" so it doesn't collide with the existing user-scoped app.
> DROPBOX_TEAM_APP_NAME=<E-Site Construction Team>
>
> # Public-facing description for the consent screen.
> DROPBOX_TEAM_APP_DESCRIPTION=<Construction site management — sync project drawings + documents from your Dropbox team folders.>
>
> # Redirect URIs (paste ALL THREE — same as the user-scoped app uses).
> REDIRECT_URI_PROD=https://app.e-site.live/api/auth/cloud-callback
> REDIRECT_URI_STAGING=https://esite-lilac.vercel.app/api/auth/cloud-callback
> REDIRECT_URI_BRANCH=https://esite-git-feat-powersync-arno-mattheus-projects.vercel.app/api/auth/cloud-callback
> ```

> **Task: register a new Dropbox app for E-Site as TEAM SCOPED, configure team-data scopes, and approve it in the Admin Console.**
>
> **Context:** The existing user-scoped "E-Site Construction" app must be left in place — it's still serving prior connections. We're adding a new app side-by-side. After approval, the app will appear in the Dropbox Admin Console as an installed third-party app and team members will be able to use it transparently.
>
> **Pre-flight sanity checks:**
> a. Confirm logged in to `dashboard.paystack.com`... wait, wrong vendor. Confirm logged in to `dropbox.com/developers/apps` as DROPBOX_OWNER_EMAIL. Top-right avatar matches.
> b. Confirm the existing "E-Site Construction" app (App key `xze8h0qfb3ces0q`) is visible in the apps list — if not, you may be on the wrong Dropbox account.
> c. Confirm "Admin Console" link appears in the Dropbox web sidebar (`https://www.dropbox.com/home` left rail). If absent, the account isn't a team admin and the team-app install will fail at the approval step.
>
> **Steps:**
>
> **A. Create the new app**
> 1. Open `https://www.dropbox.com/developers/apps`. Click **Create app**.
> 2. Choose API: **Scoped access**.
> 3. Choose access type: **Team Scoped App** *(NOT "Full Dropbox" / "App folder" — those are individual-scoped; we want the team option, may also be labelled "App that needs to access an organization's data").*
>    - **If the only options shown are "App folder" and "Full Dropbox" with no team-scoped option:** the Dropbox account is not a Business team admin. Stop and report back to Arno — he must verify team-admin status before proceeding.
> 4. App name: paste `DROPBOX_TEAM_APP_NAME`. If "name not available", append a digit.
> 5. Click **Create app**.
>
> **B. Configure permissions (scopes)**
> 6. Permissions tab. Tick:
>    - `account_info.read`
>    - `members.read`
>    - `team_info.read`
>    - `team_data.member`
>    - `team_data.team_space` (only present if the team uses team space — if not visible, skip)
>    - `files.metadata.read`
>    - `files.content.read`
>    - `sharing.read` (optional but useful for shared-folder context)
>
>    *(Do NOT tick any `*.write` scopes — read-only is sufficient for sync-FROM Dropbox.)*
> 7. Click **Submit**.
>
> **C. Configure OAuth + redirect URIs**
> 8. Settings tab. Scroll to OAuth 2 → Redirect URIs.
> 9. Add `REDIRECT_URI_PROD`, click Add.
> 10. Add `REDIRECT_URI_STAGING`, click Add.
> 11. Add `REDIRECT_URI_BRANCH`, click Add. (All three should now be listed.)
>
> **D. Approve the app for the team (Admin Console)**
> 12. Open `https://www.dropbox.com/team/admin/integrations` in a NEW tab (don't navigate away from the app settings).
> 13. Find the newly-created app in the "Connected apps" list. May appear under "Pending approval" or as a new row.
> 14. Click on it → **Approve** / **Allow team members to use this app**.
>     - Some Dropbox tenants require an additional admin-console approval flow with a "review permissions" modal — accept all listed scopes from §2 step 6.
> 15. Confirm app status in admin console shows "Approved" (green tick).
>
> **E. Capture credentials**
> 16. Switch back to the app settings tab.
> 17. Note **App key** at top of Settings (does NOT need clicking Show). Save as:
>     ```
>     DROPBOX_TEAM_APP_KEY=<paste app key>
>     ```
> 18. Click **Show** next to App secret. Save as:
>     ```
>     DROPBOX_TEAM_APP_SECRET=<paste app secret>
>     ```
>
> **Report back:**
> - App created with team-scoped access? Y/N + screenshot of the access-type radio choice
> - All scopes from step 6 added + submitted? Y/N + list of which were available
> - All 3 redirect URIs added? Y/N
> - App approved in Admin Console? Y/N + screenshot
> - DROPBOX_TEAM_APP_KEY + DROPBOX_TEAM_APP_SECRET captured? Y/N (don't paste the values back to chat)

---

## §3 — Database migration (committed by Claude Code)

New migration `00045_org_storage_team_connections.sql` (or next available number — check current top):

```sql
-- 00045_org_storage_team_connections.sql
-- Schema changes for Architecture B (team-scoped cloud-storage apps).
--
-- Migrates org_storage_connections from "one row per (org, provider, user)"
-- to "one row per (org, provider)" — admin installs once for the org and
-- every member inherits the connection.

BEGIN;

-- 1. Add new columns capturing team metadata (NULL for legacy A-style rows;
--    NOT NULL for new B-style rows enforced via partial CHECK below).
ALTER TABLE tenants.org_storage_connections
  ADD COLUMN IF NOT EXISTS install_mode  TEXT NOT NULL DEFAULT 'user'
    CHECK (install_mode IN ('user', 'team')),
  ADD COLUMN IF NOT EXISTS team_id       TEXT,           -- e.g. "dbtid:..."
  ADD COLUMN IF NOT EXISTS team_name     TEXT,
  ADD COLUMN IF NOT EXISTS installed_by  UUID REFERENCES auth.users(id);

-- 2. Drop the old per-user uniqueness, add per-org uniqueness for team installs.
--    User-mode rows are not subject to org-uniqueness (legacy compat — they
--    can coexist with a team install during migration).
ALTER TABLE tenants.org_storage_connections
  DROP CONSTRAINT IF EXISTS org_storage_connections_org_provider_email_uq;

CREATE UNIQUE INDEX IF NOT EXISTS org_storage_connections_team_uq
  ON tenants.org_storage_connections (organisation_id, provider)
  WHERE install_mode = 'team';

-- 3. Mark legacy rows + flag them as deprecated for ops visibility.
COMMENT ON COLUMN tenants.org_storage_connections.install_mode IS
  'Architecture A=user-scoped per-user; Architecture B=team-scoped admin-installed. ''user'' rows are deprecated as of 2026-05-13.';

COMMIT;
```

Notes:
- Existing rows get `install_mode='user'` automatically via the DEFAULT — no data loss
- New team installs use `install_mode='team'` with the per-org UNIQUE constraint
- A future cleanup migration drops `install_mode='user'` rows after all orgs migrate

---

## §4 — Code changes (committed by Claude Code as ONE PR)

**Files to add:**

- `packages/shared/src/services/cloud-storage/dropbox-team.provider.ts` — new provider implementing `CloudStorageProvider` for team apps. Key differences from `dropbox.provider.ts`:
  - `buildAuthUrl`: same OAuth endpoint, but state encodes `installMode: 'team'`
  - `exchangeCode`: returns a team token; ALSO captures team_id + team_name from `/team/get_info` (call requires team_data.member scope)
  - `listFolder` / `downloadFile`: send `Dropbox-API-Select-User: <team_member_id>` header in addition to the existing path-root header. Member ID is the org admin's team_member_id captured at OAuth time (so admin's view is what's mapped).
  - Cache shape changes — keyed per (org, team_id) instead of per access token.

- `packages/db/src/types.ts` regenerated against new schema (manual until type regen pipeline ships).

- `apps/edge-functions/supabase/functions/_shared/cloud-storage/dropbox-team.provider.ts` — Deno copy.

**Files to modify:**

- `apps/web/src/services/cloud-storage.server.ts` — `connectCloudProvider()` writes a `team`-mode row with `team_id`, `team_name`, `installed_by`. `disconnectCloudConnection()` adds explicit "this affects all users" warning in caller.
- `apps/web/src/actions/cloud-storage.actions.ts` — `startCloudOAuthAction()` checks the caller is org owner/admin (returns 403 otherwise). New parameter `installMode: 'user' | 'team'` — UI passes 'team' for new installs.
- `apps/web/src/app/api/auth/cloud-callback/route.ts` — branches on `installMode` from state, calls the appropriate provider's `exchangeCode`, writes the connection with team metadata.
- `apps/web/src/services/cloud-storage-folder.server.ts` — `getActiveAccessTokenFor(connectionId)` reads the connection row, picks the right provider (team or user) based on `install_mode`. For team rows, threads the `installed_by` user's `team_member_id` into provider calls so the act-as-member header is set.
- `apps/web/src/app/(admin)/settings/integrations/page.tsx` — UI updates:
  - Connect Dropbox button now reads "Connect Dropbox for your team" with admin-only gate
  - Connection row shows "Installed by Arno · Team: WATSON MATTHEUS" instead of an email
  - Disconnect button shows "Disconnect — this removes Dropbox sync for everyone in your org" confirmation
- `apps/web/src/components/cloud-storage/CloudFolderPicker.tsx` — no functional change needed (the team-token API calls return team-root contents per the existing path-root logic).
- `apps/edge-functions/supabase/functions/cloud-sync-project/index.ts` — picks the right provider via `install_mode` column on the connection row.

**Tests to add:**

- `packages/shared/src/services/cloud-storage/__tests__/dropbox-team.provider.test.ts` — mirrors the existing `dropbox.provider.test.ts`, mocks Dropbox API responses with team-scoped tokens, asserts Select-User + Path-Root headers are both sent.
- Schema migration test (vitest with pg-mem or pglite) confirming the unique-index on (org, provider) where install_mode='team' is enforced.

---

## §5 — Env vars rotation (Claude Code via Vercel CLI + supabase secrets, ~5 min)

After §2 captures the new keys, set them on Vercel + Supabase Edge using the existing CLI patterns (no Chrome MCP — Vercel admin is blocklisted):

```bash
# Vercel — Production + Preview (same flow as session 18 Resend rotation)
vercel env add DROPBOX_TEAM_APP_KEY production --value "<key>" --yes
vercel env add DROPBOX_TEAM_APP_KEY preview feat/powersync --value "<key>" --yes
vercel env add DROPBOX_TEAM_APP_SECRET production --value "<secret>" --yes
vercel env add DROPBOX_TEAM_APP_SECRET preview feat/powersync --value "<secret>" --yes

# Supabase Edge
cd apps/edge-functions
supabase secrets set --project-ref cbskbnvvgcybmfikxgky \
  DROPBOX_TEAM_APP_KEY=<key> \
  DROPBOX_TEAM_APP_SECRET=<secret>

# Trigger Vercel preview redeploy
vercel redeploy <latest-feat-powersync-deployment-url>

# Redeploy edge fn
supabase functions deploy cloud-sync-project --project-ref cbskbnvvgcybmfikxgky
```

The provider-utils env-var lookup map gets a new entry:
```ts
dropbox_team: { id: 'DROPBOX_TEAM_APP_KEY', secret: 'DROPBOX_TEAM_APP_SECRET' }
```

The legacy `DROPBOX_APP_KEY` + `DROPBOX_APP_SECRET` stay in place during the migration period — used by any remaining `install_mode='user'` rows. Removed in §6 cleanup.

---

## §6 — Smoke test (Arno, ~10 min)

After §3-§5 are deployed:

1. Open `/settings/integrations` on the branch alias as an org owner.
2. Click **Connect Dropbox for your team** (button label updated per §4).
3. Pass Dropbox consent (on the team admin account from §1).
4. Land back at `?connected=dropbox` with a green banner showing "Installed by Arno · Team: WATSON MATTHEUS".
5. **Open a SECOND browser session** (incognito or different account) and sign in as a non-admin team member of the same E-Site org.
6. Navigate to the same `/settings/integrations` — the Dropbox connection row should be visible to them too (read-only — no Disconnect button).
7. Both users go to a project's Floor Plans tab → "Set folder…". Picker should show:
   - ARNO MATTHEUS (your member folder)
   - OFFICE (the team-shared folder Arno mentioned earlier)
   - Any other top-level team folders
8. Pick OFFICE → "Use this folder" → "Sync now".
9. Confirm both users see the same drawings populate the table.
10. Disconnect from admin session → confirm the non-admin's view also loses the connection.

**Pass criteria:**
- ✓ Admin install creates one team-scoped row in `org_storage_connections` with `install_mode='team'`, `team_id` matches Dropbox's `dbtid:...`, `installed_by` matches admin's user ID
- ✓ Non-admin user sees the connection without having to OAuth themselves
- ✓ Both users see the same folder structure in the picker
- ✓ Sync completes for the team folder
- ✓ Admin disconnect removes visibility for everyone

If any step fails, file a follow-up bug — no piecemeal fixes; another clean PR.

---

## §7 — Cleanup (Claude Code, ~30 min)

After smoke test passes:

1. **Delete the old user-scoped Dropbox app** on dropbox.com/developers/apps. App key `xze8h0qfb3ces0q` becomes invalid. Any lingering user-mode connection rows will fail to refresh tokens (acceptable — it's the deprecation signal).
2. **Migration script** (`scripts/migrate-dropbox-user-to-team.ts`) — for each org with both `install_mode='user'` rows AND a new `install_mode='team'` row, copy any per-project `cloud_storage_connection_id` mappings to point at the team row, then delete the user rows.
3. **Drop legacy env vars** on Vercel + Supabase Edge: `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`. Use the same CLI pattern.
4. **Drop the legacy `DropboxProvider`** from `packages/shared/src/services/cloud-storage/` and the Deno copy. Keep only the team variant.
5. **Drop the temporary debug route** at `apps/web/src/app/api/debug/dropbox-rootinfo/route.ts`.
6. **Update CLAUDE.md** preamble to point at this doc instead of `cloud-storage-oauth-setup-roadmap.md` for Dropbox.

---

## §8 — Rollback plan

If §6 smoke test reveals a fundamental issue:

1. **Stop new admin installs**: PATCH the `connectCloudProvider` server action to early-return for `installMode === 'team'`. Revert via env var `DROPBOX_TEAM_INSTALLS_ENABLED=false` checked at action entry.
2. **Re-enable user-scoped flow**: legacy code path still exists during migration; admin can OAuth as a regular user via the old `install_mode='user'` flow.
3. **Existing team rows stay valid** — no destructive action needed. They'll just stop being created.
4. **Rollback the schema migration** if blocking: `00045_rollback.sql` drops the new columns + unique index. `install_mode` defaults preserve existing data semantics.

---

## Quick-reference: key shape comparison

| Element | A (current) | B (after migration) |
|---|---|---|
| Dropbox app type | "Scoped access — Full Dropbox" | "Scoped access — Team Scoped App" |
| App key env var | `DROPBOX_APP_KEY` | `DROPBOX_TEAM_APP_KEY` |
| OAuth scopes | `files.{metadata,content}.read` + `account_info.read` | + `team_data.member` + `members.read` + `team_info.read` |
| Token returned | User token | Team token |
| Required headers on /files/* | (sometimes) `Dropbox-API-Path-Root` | Both `Dropbox-API-Path-Root` AND `Dropbox-API-Select-User` |
| `org_storage_connections.install_mode` | `'user'` | `'team'` |
| Provider class | `DropboxProvider` | `DropboxTeamProvider` |
| Who can connect | Any org member | Org owner/admin only |
| Disconnect impact | One user | Whole org (with confirmation) |
