# Cloud-Storage OAuth Setup Roadmap

> **Audience:** Arno + Claude-in-Chrome session.
> **Goal:** End-to-end testing of the Dropbox / Google Drive / OneDrive cloud-folder sync flow that's been shipped end-to-end on `feat/powersync` since Session 19 (M1–M9). The wiring is done — this doc fills in the OAuth-app registrations + env vars that turn the "Connect" buttons in `/settings/integrations` from "Missing X env vars" errors into real provider consent screens.
> **Companion docs:** [`paystack-go-live-roadmap.md`](paystack-go-live-roadmap.md) (same Claude-Chrome PRE-FILL pattern), [`.secrets/vercel.md`](../.secrets/vercel.md) (env-var inventory).

---

## How to use this doc

Same two-layer pattern as the Paystack roadmap:
1. **PRE-FILL blocks** — boxed `> **PRE-FILL BEFORE PASTING**` sections. Arno fills these with values Claude-in-Chrome can't discover (developer email, Dropbox/Google/Microsoft account credentials, etc.).
2. **Pasteable scripts** — boxed `> **Task:**` sections. Self-contained prompts that drive a Claude-in-Chrome session through each provider's developer dashboard.

Each section is independent — you can register one provider and ignore the other two. The web UI in `/settings/integrations` enumerates all three, but the connect button for each is gated by *its own* env vars: setting only Dropbox's vars makes Dropbox-only work; the other two buttons error gracefully ("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars for provider google_drive") inline.

---

## 0. Why this was previously labelled "blocked on `@e-site.live` mailbox"

The Session 19 closure said M10 was "blocked on `@e-site.live` mailbox routing for OAuth-app registrations." That was conservative — for **production polish** (where you want app registrations, OAuth consent screens, and all support contacts to use brand-aligned `developer@e-site.live`), waiting for the mailbox is right.

**For end-to-end TESTING right now**, all three providers' developer consoles accept ANY contact email (`arno@watsonmattheus.com`, a personal Gmail, etc.). Each provider has a "test mode" / "development mode" that allows up to a small whitelist of test users without app review:
- **Dropbox** — "Development" status, no review, up to 500 users you can add manually.
- **Google Cloud** — "Testing" status, allowlist of up to 100 test users (test users bypass the unverified-app warning).
- **Microsoft (Entra ID)** — "Single tenant" or personal MSA, no review needed for read-only Files.Read.All.

Once the mailbox is sorted, you can rotate the contact email on each provider dashboard without losing the existing OAuth client IDs / secrets. **No need to wait** to start testing.

---

## 1. Pre-flight (Arno gathers, ~15 min, before any provider)

**Decisions:**
- [ ] **Developer contact email** — used on all three provider dashboards as the "developer / support" contact. Recommended: Arno's primary email (`arno@watsonmattheus.com`). Can be rotated later.
- [ ] **Test users** — list of email addresses that will test the OAuth flow during dev. At minimum, the Gmail / Microsoft accounts you'll use to test each provider's "Connect" button. Each provider's test allowlist accepts ~100 users.
- [ ] **Production redirect URL** — `https://app.e-site.live/api/auth/cloud-callback` once DNS cutover is done; for testing today, use `https://esite-lilac.vercel.app/api/auth/cloud-callback`. Each provider lets you register multiple redirect URIs, so register both (production + staging-vercel-alias) up-front to avoid round-tripping later.

**Existing accounts you'll need:**
- [ ] A **Dropbox** account (any — personal works; will be used both as the dev account AND the "test user" Arno connects from in `/settings/integrations`).
- [ ] A **Google account** with access to https://console.cloud.google.com (any Gmail works — the dev account becomes the project owner).
- [ ] A **Microsoft account** — personal Microsoft account (`@outlook.com`/`@hotmail.com`/`@live.com`) OR a work/school account. For testing, personal MSA is simplest.

**Generate the two app secrets** (do this once locally; same value goes to Vercel + Supabase Edge):

```bash
# OAUTH_STATE_SECRET — HMAC key for signing OAuth state tokens.
# Must be ≥32 chars per packages/shared/src/utils/oauth-state.ts.
openssl rand -hex 32

# STORAGE_TOKEN_ENC_KEY — AES-256-GCM key for encrypting refresh tokens
# at rest in tenants.org_storage_connections (BYTEA column). Must be
# exactly 32 bytes hex per packages/db/src/encryption.ts.
openssl rand -hex 32
```

Save both to a temporary secure note (1Password / Bitwarden / sticky note that gets shredded). They go into Vercel + Supabase Edge in §5 / §6.

---

## 2. Dropbox app registration (Claude-in-Chrome, ~15 min)

> **PRE-FILL BEFORE PASTING — Claude-in-Chrome cannot discover any of these.**
>
> ```
> # The Dropbox account that owns the dev app.
> # Any Dropbox account works — personal email is fine.
> DROPBOX_OWNER_EMAIL=<arno@watsonmattheus.com or similar>
>
> # The full app name visible to end-users on the consent screen.
> # 24-char max, must be globally unique within Dropbox's app namespace.
> # Suggested: "E-Site Construction" — append a digit if taken.
> DROPBOX_APP_NAME=<E-Site Construction>
>
> # Public-facing app description shown on consent screen.
> DROPBOX_APP_DESCRIPTION=<Construction site management — sync project drawings + documents from your Dropbox folders.>
>
> # Redirect URIs (paste BOTH; Dropbox accepts a list).
> REDIRECT_URI_PROD=https://app.e-site.live/api/auth/cloud-callback
> REDIRECT_URI_STAGING=https://esite-lilac.vercel.app/api/auth/cloud-callback
> ```

> **Task: register a new Dropbox app for E-Site cloud-storage integration in Development mode.**
>
> **Context:** E-Site needs `account_info.read` + read-only file access. Pre-fill values for owner email, app name, description, and redirect URIs are at the top of this prompt. After registration, Arno needs the `App key` and `App secret` to paste into Vercel.
>
> **Steps:**
> 1. Open `https://www.dropbox.com/developers/apps` and sign in as `DROPBOX_OWNER_EMAIL`.
> 2. Click **Create app**.
> 3. Choose API: **Scoped access** (not Full Dropbox API).
> 4. Choose access type: **Full Dropbox** (so users can map folders anywhere in their account, not just an `/Apps/E-Site` sandbox folder).
> 5. App name: paste `DROPBOX_APP_NAME`. If Dropbox rejects ("name not available"), append a digit.
> 6. Click **Create app**.
> 7. On the new app's settings page, scroll to **Permissions** tab. Tick:
>    - `account_info.read`
>    - `files.metadata.read`
>    - `files.content.read`
> 8. Click **Submit** at the bottom of the Permissions tab.
> 9. Back to **Settings** tab. Add the redirect URIs:
>    - Under "OAuth 2 → Redirect URIs", paste `REDIRECT_URI_PROD`, click Add.
>    - Paste `REDIRECT_URI_STAGING`, click Add.
> 10. Under "App folder name" — leave blank (we chose Full Dropbox in step 4).
> 11. Under "Description" — paste `DROPBOX_APP_DESCRIPTION`.
> 12. Confirm "Status" shows **Development**. (App is automatically in development mode; no submission for review needed unless you exceed 500 users.)
> 13. Scroll to "App key" + "App secret" at top of Settings. **Copy both into Arno's secure note** as:
>     ```
>     DROPBOX_APP_KEY=<paste app key>
>     DROPBOX_APP_SECRET=<click "Show" then paste app secret>
>     ```
>
> **Report back:**
> - App created? Y/N + app name actually used (in case digit was appended)
> - Permissions submitted? Y/N + screenshot of granted scopes
> - Both redirect URIs added? Y/N
> - DROPBOX_APP_KEY + DROPBOX_APP_SECRET captured? Y/N (DO NOT paste the values back to chat — Arno saves them in his secure note)

---

## 3. Google Drive app registration (Claude-in-Chrome, ~25 min — most fiddly of the three)

> **PRE-FILL BEFORE PASTING.**
>
> ```
> # Google account that owns the dev project. Any Gmail works.
> GOOGLE_OWNER_EMAIL=<arno@watsonmattheus.com or personal Gmail>
>
> # Project name in Google Cloud Console.
> # Doesn't need to be globally unique — Google appends a project ID.
> GOOGLE_PROJECT_NAME=<e-site-cloud-storage>
>
> # OAuth consent screen — public-facing app name.
> GOOGLE_APP_NAME=<E-Site Construction>
>
> # User support email shown on the consent screen.
> # Must be the same email logged in (or a Google Group the logged-in user belongs to).
> GOOGLE_USER_SUPPORT_EMAIL=<arno@watsonmattheus.com>
>
> # Developer contact (Google may email about API changes / quota).
> GOOGLE_DEVELOPER_EMAIL=<arno@watsonmattheus.com>
>
> # Test users — emails that can connect during the "Testing" phase, before
> # the app is verified. Limit ~100. Add yourself + anyone testing.
> GOOGLE_TEST_USERS=<arno@watsonmattheus.com,otheruser@gmail.com,...>
>
> REDIRECT_URI_PROD=https://app.e-site.live/api/auth/cloud-callback
> REDIRECT_URI_STAGING=https://esite-lilac.vercel.app/api/auth/cloud-callback
>
> # Authorised JavaScript origins (NOT the redirect URIs — these are the
> # origins that will host the OAuth init). Same hosts, no path.
> JS_ORIGIN_PROD=https://app.e-site.live
> JS_ORIGIN_STAGING=https://esite-lilac.vercel.app
> ```

> **Task: register a Google Drive OAuth client for E-Site cloud-storage integration in Testing mode.**
>
> **Context:** Google's OAuth setup has 3 sub-steps that have to land in order: create a Cloud project → enable Drive API → configure consent screen → create OAuth client ID. This is the most fiddly of the three providers; Google has migrated some of this to a new console UI in 2025–2026 — if the navigation looks different from the steps below, find the equivalent under Settings or APIs & Services.
>
> **Steps:**
>
> **A. Create / select project**
> 1. Open `https://console.cloud.google.com` and sign in as `GOOGLE_OWNER_EMAIL`.
> 2. Top-left project picker → **NEW PROJECT** (skip if `GOOGLE_PROJECT_NAME` already exists).
> 3. Project name: paste `GOOGLE_PROJECT_NAME`. Organisation: "No organization" if personal Gmail, or pick the org. Location: leave default.
> 4. Click **Create**, wait ~10s, then ensure the project is selected in the top-left picker.
>
> **B. Enable Drive API**
> 5. Sidebar → **APIs & Services** → **Library**.
> 6. Search "Google Drive API". Click the result. Click **Enable**.
>
> **C. Configure OAuth consent screen**
> 7. Sidebar → **APIs & Services** → **OAuth consent screen**.
> 8. User type: **External** (unless `GOOGLE_OWNER_EMAIL` is a Google Workspace org email AND you only want that org's users — then choose Internal).
> 9. Click **Create**.
> 10. Fill the form:
>     - App name: `GOOGLE_APP_NAME`
>     - User support email: `GOOGLE_USER_SUPPORT_EMAIL`
>     - App logo: skip for now (can add later)
>     - Application home page: `JS_ORIGIN_PROD`
>     - Authorised domains: `e-site.live` (and `vercel.app` if needed for the staging URL — Google may auto-detect this)
>     - Developer contact: `GOOGLE_DEVELOPER_EMAIL`
> 11. **Save and continue.**
> 12. **Scopes step**: click **ADD OR REMOVE SCOPES**. In the filter box, search for and tick:
>     - `.../auth/userinfo.email`
>     - `.../auth/userinfo.profile`
>     - `.../auth/drive.readonly` (this is the read-only Drive scope — sufficient for E-Site since we only download files, never write back)
>     - `.../auth/drive.metadata.readonly` (optional — provides folder browsing without download permission)
> 13. **Save and continue.**
> 14. **Test users step**: click **+ ADD USERS**. Paste each comma-separated email from `GOOGLE_TEST_USERS` (one per Add operation; the form takes one email at a time). Save.
> 15. **Save and continue** to the summary, review, then **Back to Dashboard**.
>
> **D. Create OAuth client ID**
> 16. Sidebar → **APIs & Services** → **Credentials**.
> 17. **+ CREATE CREDENTIALS** → **OAuth client ID**.
> 18. Application type: **Web application**.
> 19. Name: `<GOOGLE_APP_NAME> Web Client`.
> 20. Authorised JavaScript origins: paste `JS_ORIGIN_PROD` and `JS_ORIGIN_STAGING` (one per "Add URI" row).
> 21. Authorised redirect URIs: paste `REDIRECT_URI_PROD` and `REDIRECT_URI_STAGING`.
> 22. Click **Create**.
> 23. A modal pops up with **Client ID** + **Client secret**. Copy both into Arno's secure note as:
>     ```
>     GOOGLE_CLIENT_ID=<paste client id, ends with .apps.googleusercontent.com>
>     GOOGLE_CLIENT_SECRET=<paste client secret>
>     ```
> 24. Click **OK** to close the modal.
>
> **Report back:**
> - Project created + Drive API enabled? Y/N
> - Consent screen saved with all scopes? Y/N + which scopes
> - All test users added? Y/N + count
> - OAuth client created with both redirect URIs + both JS origins? Y/N
> - GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET captured? Y/N

---

## 4. Microsoft OneDrive (Entra ID) app registration (Claude-in-Chrome, ~15 min)

> **PRE-FILL BEFORE PASTING.**
>
> ```
> # Microsoft account that owns the app registration.
> # Personal MSA (@outlook.com/@hotmail.com/@live.com) is fine for testing.
> MS_OWNER_EMAIL=<arno@watsonmattheus.com or personal MSA>
>
> # App display name (shown on consent screen, can be edited later).
> MS_APP_NAME=<E-Site Construction>
>
> # Supported account types — pick based on who connects.
> # "AzureADandPersonalMicrosoftAccount" = both work + personal accounts (recommended for SaaS)
> # "PersonalMicrosoftAccount" = personal only
> # "AzureADMyOrg" = single Azure tenant only
> # Provider code at packages/shared/src/services/cloud-storage/onedrive.provider.ts
> # uses the /common/ tenant which assumes the broadest setting.
> MS_SUPPORTED_ACCOUNTS=<AzureADandPersonalMicrosoftAccount>
>
> REDIRECT_URI_PROD=https://app.e-site.live/api/auth/cloud-callback
> REDIRECT_URI_STAGING=https://esite-lilac.vercel.app/api/auth/cloud-callback
> ```

> **Task: register a Microsoft Entra ID (formerly Azure AD) app for E-Site OneDrive sync.**
>
> **Context:** Microsoft renamed Azure AD to Entra ID in 2023 — same product, the URLs and dashboard UI use the new name. The provider code at `packages/shared/src/services/cloud-storage/onedrive.provider.ts` uses the `/common/` tenant endpoint, which means whatever tenant scope you pick here just determines which accounts CAN consent — the app code is tenant-agnostic.
>
> **Steps:**
> 1. Open `https://entra.microsoft.com` and sign in as `MS_OWNER_EMAIL`.
>    - **Alternative:** if you can't access entra.microsoft.com (sometimes restricted), go to `https://portal.azure.com` and search for "App registrations" — same product.
> 2. Sidebar → **Identity** → **Applications** → **App registrations**.
> 3. Click **+ New registration**.
> 4. Name: `MS_APP_NAME`.
> 5. Supported account types: pick the option matching `MS_SUPPORTED_ACCOUNTS` (the radio button for "Accounts in any organizational directory and personal Microsoft accounts" if you used the recommended value).
> 6. Redirect URI:
>    - Platform: **Web**.
>    - URI: paste `REDIRECT_URI_STAGING` (only one allowed at registration — the second gets added below).
> 7. Click **Register**.
> 8. On the new app's overview page, **Application (client) ID** is shown. Copy it as:
>    ```
>    MS_GRAPH_CLIENT_ID=<paste application (client) id — UUID format>
>    ```
> 9. Sidebar (left, on the app page) → **Authentication**. Under "Web" → "Redirect URIs", click **Add URI**, paste `REDIRECT_URI_PROD`. Save.
> 10. Same Authentication page → "Implicit grant and hybrid flows" — leave both unchecked (we use the standard Authorization Code flow with PKCE). "Allow public client flows" — leave No.
> 11. Sidebar → **Certificates & secrets** → tab "Client secrets" → **+ New client secret**.
> 12. Description: `e-site-oauth-secret`. Expires: **24 months** (the longest option; rotate before then). Click **Add**.
> 13. The new secret's **Value** column shows the secret ONCE. Copy it immediately as:
>     ```
>     MS_GRAPH_CLIENT_SECRET=<paste the Value column, NOT the Secret ID column>
>     ```
>     (If you click away before copying, you have to delete and recreate — the value is unrecoverable.)
> 14. Sidebar → **API permissions** → **+ Add a permission** → **Microsoft Graph** → **Delegated permissions** (NOT Application). Search for and tick:
>     - `Files.Read.All`
>     - `offline_access` (required for refresh tokens)
>     - `User.Read` (default; usually pre-ticked)
> 15. Click **Add permissions**.
> 16. Above the permissions table, click **Grant admin consent for <tenant>** if the button is enabled (only available for tenant admins — for personal MSA testing you can skip; users will be asked individually at consent time).
> 17. Confirm "Status" column shows green ticks for all three permissions.
>
> **Report back:**
> - App registered with both redirect URIs? Y/N + screenshot of Authentication page showing both URIs
> - Permissions added (Files.Read.All / offline_access / User.Read)? Y/N
> - Client secret created with 24-month expiry? Y/N + expiry date for calendar
> - MS_GRAPH_CLIENT_ID + MS_GRAPH_CLIENT_SECRET captured? Y/N

---

## 5. Set env vars on Vercel (Claude-in-Chrome, ~10 min)

> **PRE-FILL BEFORE PASTING — values from §1 (`openssl rand -hex 32`) + §2/§3/§4 (provider dashboards).**
>
> ```
> # Section 1 — generated locally.
> OAUTH_STATE_SECRET=<openssl rand -hex 32 result, 64 hex chars>
> STORAGE_TOKEN_ENC_KEY=<openssl rand -hex 32 result, 64 hex chars>
>
> # Section 2 — from Dropbox dashboard (skip if not registering Dropbox).
> DROPBOX_APP_KEY=<from §2 step 13>
> DROPBOX_APP_SECRET=<from §2 step 13>
>
> # Section 3 — from Google Cloud (skip if not registering Drive).
> GOOGLE_CLIENT_ID=<from §3 step 23, ends with .apps.googleusercontent.com>
> GOOGLE_CLIENT_SECRET=<from §3 step 23>
>
> # Section 4 — from Microsoft Entra (skip if not registering OneDrive).
> MS_GRAPH_CLIENT_ID=<from §4 step 8>
> MS_GRAPH_CLIENT_SECRET=<from §4 step 13>
> ```

> **Task: set 8 env vars on the Vercel `esite` project, both Production and Preview, then trigger a redeploy.**
>
> **Context:** All 8 values are pre-filled at the top of this prompt. The Vercel project is `arno-mattheus-projects/esite`. Setting on both Production AND Preview means PR previews can test the OAuth flow against the same dev OAuth apps; for production polish later, rotate to per-env apps if desired.
>
> **Validation before starting:**
> a. Confirm `OAUTH_STATE_SECRET` is 64 hex chars (32 bytes). Anything shorter throws at runtime.
> b. Confirm `STORAGE_TOKEN_ENC_KEY` is 64 hex chars. The encryption helper at `packages/db/src/encryption.ts` enforces exactly 32 bytes.
> c. If any provider section was skipped, that's fine — just don't set those env vars. The connect button for that provider will continue to error inline; the others will work.
>
> **Steps:**
> 1. Open `https://vercel.com/arno-mattheus-projects/esite/settings/environment-variables`.
> 2. For each non-blank value in the PRE-FILL block above, click **Add another** (or **Add new**) and:
>    - Name: the env var name (e.g. `OAUTH_STATE_SECRET`).
>    - Value: paste the value.
>    - Environments: tick **Production** AND **Preview**. Leave Development unticked unless Arno does local-CLI testing.
>    - Click **Save**.
> 3. After all 8 saves, click the project's "Deployments" tab → filter by Production → latest → ⋯ menu → **Redeploy** (tick "Use existing Build Cache"). Env-var changes don't auto-redeploy.
> 4. Wait for status READY (~50s).
>
> **Post-rotation verification:**
> 5. Open `https://app.e-site.live/settings/integrations` (or staging URL until DNS cutover) and log in as a user with role admin/owner/PM.
> 6. Click **Connect Dropbox** (or whichever provider you registered).
>    - Expected: redirect to the provider's consent screen, NOT an inline error.
>    - If the inline error still says "Missing X / Y env vars," step 1 didn't take effect — check that you ticked both Production AND Preview, and that the redeploy actually completed.
> 7. Complete the OAuth consent (sign in with the Dropbox/Google/Microsoft account from §2/§3/§4 — must be in the test-users list for Google).
> 8. After consent, the browser lands on `https://<host>/settings/integrations?connected=dropbox` (or `google_drive` / `onedrive`) with a green "Connected" banner.
> 9. Confirm the new connection row appears under "Active connections" with the correct account email + correct provider label + today's date.
>
> **Report back:**
> - All 8 env vars saved on Production AND Preview? Y/N (`vercel env ls production` from a Bash MCP would confirm if available)
> - Redeploy READY? Y/N + new dpl_… ID
> - Connect button on `/settings/integrations` redirects to provider consent? Y/N for each provider attempted
> - OAuth round-trip lands back at `?connected=<provider>` with green banner? Y/N
> - New connection row visible with correct account email? Y/N

---

## 6. Set env vars on Supabase Edge (Claude-in-Chrome, ~5 min)

The cloud-storage flow has TWO runtimes that each need the OAuth credentials:

| Runtime | Why it needs the creds | Where to set |
|---|---|---|
| **Vercel** (web server actions) | `startCloudOAuthAction` builds the consent-screen URL using `clientId`. `/api/auth/cloud-callback` exchanges the auth code for tokens using `clientId + clientSecret`. | §5 above |
| **Supabase Edge** (`cloud-sync-project` function) | Background sync needs to refresh expired access tokens (using `clientId + clientSecret`) before downloading files via the provider's API. | This section |

> **PRE-FILL — same 8 values from §5.** Just re-pasted into Supabase this time.

> **Task: set the same 8 env vars on the Supabase Edge functions runtime for project `cbskbnvvgcybmfikxgky`.**
>
> **Context:** Supabase Edge functions read env vars via `Deno.env.get()`. Same names as Vercel; no `NEXT_PUBLIC_` prefix needed (these aren't browser-exposed).
>
> **Steps:**
> 1. Open `https://supabase.com/dashboard/project/cbskbnvvgcybmfikxgky/settings/functions`.
> 2. Scroll to **Edge Function Secrets**.
> 3. For each env var name from the §5 PRE-FILL block, click **+ New secret**, paste name + value, Save.
> 4. (Optional CLI alternative if Arno has supabase CLI locally:
>    ```bash
>    cd apps/edge-functions
>    supabase secrets set OAUTH_STATE_SECRET=... \
>                         STORAGE_TOKEN_ENC_KEY=... \
>                         DROPBOX_APP_KEY=... \
>                         DROPBOX_APP_SECRET=... \
>                         GOOGLE_CLIENT_ID=... \
>                         GOOGLE_CLIENT_SECRET=... \
>                         MS_GRAPH_CLIENT_ID=... \
>                         MS_GRAPH_CLIENT_SECRET=...
>    ```
>    The CLI persists across function deploys.)
> 5. After saving in dashboard or CLI, the **next** invocation of `cloud-sync-project` will pick up the new secrets — no redeploy needed for env-var changes (Supabase Edge rebuilds each cold start).
>
> **Post-set verification — a real end-to-end "Sync now":**
> 6. In the app: navigate to a project → **Documents** tab.
> 7. Click **Set folder…**. Pick any folder from the connection made in §5. Click **Use this folder**.
> 8. Click **Sync now**. Expected: spinner, then a toast "Synced N files (M floor_plans, P documents)." If Sync now returns 500, it's almost certainly an Edge env-var miss — check Supabase dashboard logs for the function.
> 9. Switch to **Floor Plans** tab on the same project — drawings detected by the classifier should appear there too.
>
> **Report back:**
> - All 8 secrets set on Supabase Edge? Y/N
> - Sync now returns success toast? Y/N + counts
> - If failed, the error message from the toast OR from Supabase function logs

---

## 7. Smoke test checklist (Arno, ~10 min)

Run through this list to confirm end-to-end:

- [ ] **Sidebar nav**: log in to staging, "Integrations" item visible in sidebar footer (Cloud icon).
- [ ] **Settings index**: `/settings` page shows an "Cloud-storage integrations" card with "Manage integrations →" link.
- [ ] **Integrations page**: `/settings/integrations` loads, shows three "Connect …" buttons + flash banners.
- [ ] **Connect — successful path**: click "Connect Dropbox" (or any provider you registered) → consent screen on provider's domain → grant access → redirect back to `/settings/integrations?connected=<provider>` → green banner + new connection row.
- [ ] **Connect — denied path**: click "Connect …" → on provider consent screen, click Cancel/Deny → redirect back to `/settings/integrations?error=user_denied` → red banner.
- [ ] **Per-project map**: navigate to a project's Documents or Floor Plans tab → CloudSyncToolbar visible → "Set folder…" opens picker → select folder → "Use this folder" persists → toolbar updates.
- [ ] **Bulk sync**: "Sync now" succeeds → expected file counts show in toast → Documents table populates → Floor Plans tab shows drawings.
- [ ] **Disconnect**: back on `/settings/integrations` → click "Disconnect" on a connection → 4-second confirm → row removed → re-attempt mapping on a project shows "No cloud connections" empty state.
- [ ] **Client_viewer gate**: log in as a `client_viewer` role user → navigating to `/settings/integrations` redirects to `/dashboard`.
- [ ] **RLS gate**: client_viewer user CANNOT see cloud-mapped folders for projects they're not assigned to (already verified in M9 RLS audit but worth re-checking with real connections in place).

---

## Quick-reference: file locations

| Need to change | File |
|---|---|
| Env-var names + per-provider lookup logic | `packages/shared/src/services/cloud-storage/provider-utils.ts` |
| OAuth state HMAC (the 32-char `OAUTH_STATE_SECRET` checker) | `packages/shared/src/utils/oauth-state.ts` |
| Refresh-token encryption (`STORAGE_TOKEN_ENC_KEY` consumer) | `packages/db/src/encryption.ts` |
| `startCloudOAuthAction` server action | `apps/web/src/actions/cloud-storage.actions.ts` |
| OAuth callback (`/api/auth/cloud-callback`) | `apps/web/src/app/api/auth/cloud-callback/route.ts` |
| `/settings/integrations` page (org-level connect/disconnect UX) | `apps/web/src/app/(admin)/settings/integrations/page.tsx` |
| Per-project folder mapping toolbar | `apps/web/src/components/cloud-storage/CloudSyncToolbar.tsx` |
| Per-project folder picker modal | `apps/web/src/components/cloud-storage/CloudFolderPicker.tsx` |
| Bulk sync edge function (Supabase) | `apps/edge-functions/supabase/functions/cloud-sync-project/` |

---

## Rollback / disable

If you need to **disable** cloud-storage entirely (e.g. a security incident):

1. **Supabase Edge:** delete the OAuth secrets from the Edge functions secrets dashboard. Existing connections will fail to refresh tokens; sync attempts will return 500.
2. **Vercel:** delete `OAUTH_STATE_SECRET` (or any of the per-provider client IDs/secrets). The `/settings/integrations` connect buttons will return inline errors. Existing connections will continue to appear in the UI but new ones can't be created.
3. **Database:** to also revoke existing connections, run:
   ```sql
   -- Stops sync across the whole org_storage_connections table.
   UPDATE tenants.org_storage_connections SET expires_at = NOW() - INTERVAL '1 day';
   ```
   Edge function will refuse to refresh expired tokens (provider will reject the rotation), so background sync stops cleanly.
4. **Provider side:** for the most thorough kill switch, log in to each provider's developer dashboard and revoke / suspend the OAuth app. All issued tokens become invalid immediately — even tokens E-Site has cached.
