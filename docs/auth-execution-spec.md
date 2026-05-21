# Auth Execution Spec — E-Site

**Status:** Reconstructed from source on 2026-05-20. Authoritative reference for
how authentication, user assignment, and Row-Level Security work in E-Site.

**How this was built:** every flow below was reconstructed by reading the actual
code — `apps/web/src/middleware.ts`, the `(auth)/` route group, the auth server
actions, and the RLS migrations — not from session notes (which drift). File
paths are cited so you can verify. Portable, app-agnostic lessons live in the
companion [`auth-pitfalls-playbook.md`](./auth-pitfalls-playbook.md). Provider
setup is in [`auth-mfa-setup.md`](./auth-mfa-setup.md),
[`auth-google-oauth-setup.md`](./auth-google-oauth-setup.md),
[`auth-captcha-setup.md`](./auth-captcha-setup.md), and
[`auth-rate-limits.md`](./auth-rate-limits.md).

> Several real inconsistencies were found during reconstruction — see
> [§15 Known gaps](#15-known-gaps--inconsistencies). Resolve those before
> treating this spec as fully settled.

---

## 1. Overview & auth stack

E-Site authentication is **Supabase Auth** (GoTrue) fronted by **Next.js 15 App
Router middleware**. Mobile uses the same Supabase Auth, synced offline via
PowerSync.

| Layer | Responsibility |
|---|---|
| Supabase Auth (`auth.users`) | Credentials, sessions, JWTs, MFA factors, OTP issuance, SMTP email |
| Next.js middleware (`src/middleware.ts`) | Per-request gate: authentication, email verification, MFA (AAL2), onboarding |
| Server actions (`src/actions/*.actions.ts`) | All privileged auth operations — Zod-validated, rate-limited |
| Postgres RLS | Authorises every data read/write by org membership + role |
| `public.auth_events` | Append-only audit log of auth-significant events |

Two server-side Supabase clients are used:
- **Cookie / SSR client** — acts as the signed-in user; RLS applies.
- **Service-role client** (`createAdminClient`) — bypasses RLS. Used for admin
  reads (org-member listing — see §11), admin auth calls (`admin.deleteUser`,
  `admin.inviteUserByEmail`, session listing), and cross-schema writes.

---

## 2. Identity model

### Tables

| Table | Schema | Created | Purpose |
|---|---|---|---|
| `auth.users` | `auth` | Supabase-managed | Credentials, email, MFA factors, sessions |
| `profiles` | `public` | `00001` | 1:1 with `auth.users` — `profiles.id` **is** the `auth.users.id` (no surrogate key). Auto-created by the `handle_new_user()` trigger. Holds `full_name`, `email`, `notification_preferences`, `popia_consent_at`. |
| `organisations` | `public` | `00001` | Tenant. `slug`, `subscription_tier` (`free`/`starter`/`professional`/`enterprise`), `paystack_customer_id`. |
| `user_organisations` | `public` | `00001` | Membership join — `user_id`→`profiles`, `organisation_id`→`organisations`, `role`, `is_active`, `invited_by`, `accepted_at`. `UNIQUE(user_id, organisation_id)`. **The authoritative role record.** |
| `project_members` | `projects` | `00002` | Per-project assignment — `project_id`, `user_id`, `organisation_id`, `role`, `is_active`. `UNIQUE(project_id, user_id)`. |
| `org_invites` | `public` | `00012` | Pending invitations — `email`, `role`, `token` (hex of 32 random bytes, UNIQUE), `invited_by`, `expires_at` (default `NOW()+7d`), `accepted_at`. **The invitations table is named `org_invites`, not `invitations`.** |

### FK chain

```
auth.users ──1:1── public.profiles ──membership── public.user_organisations ──> public.organisations
                                  └──────────────  projects.project_members ──> projects.projects
```

`profiles.id` is `FK → auth.users(id) ON DELETE CASCADE`. Deleting the auth user
cascades `profiles → user_organisations + notifications`.

### Three role vocabularies (not identical — easy to trip over)

| Where | Allowed `role` values |
|---|---|
| `user_organisations.role` *(authoritative)* | `owner`, `admin`, `project_manager`, `contractor`, `inspector`, `supplier`, `client_viewer` — 7 |
| `project_members.role` | `project_manager`, `contractor`, `inspector`, `supplier`, `client_viewer` — 5 (no `owner`/`admin`) |
| `org_invites.role` | `admin`, `project_manager`, `contractor`, `inspector`, `supplier`, `client_viewer` — 6 (no `owner`) |

Authority order at org level: `owner` > `admin` > all others. `client_viewer` is
the only **project-scoped, read-only** role (see §11).

---

## 3. Signup & onboarding

### Signup — `/signup`

`src/app/(auth)/signup/page.tsx`. Client-rendered. On submit:
1. Blocks if the password is HIBP-pwned or zxcvbn score `< 2` (`MIN_ACCEPTABLE_SCORE`).
2. Blocks if CAPTCHA is enabled and no Turnstile token.
3. Calls **`supabase.auth.signUp`** with `email`, `password`,
   `options.data.full_name`, `emailRedirectTo = <origin>/auth/callback?next=/onboarding`,
   and (if enabled) `captchaToken`.
4. Best-effort fires the `onboarding-email-d0` edge function, shows "Check your inbox".

Google path: `<GoogleSignInButton next="/onboarding" />`. No audit event is
written at signup (the `login` event is written later by `/auth/callback`).

### Email verification — `/verify-email`

`src/app/(auth)/verify-email/page.tsx` (`force-dynamic`). Polls `getUser()` every
4 s: no user → `/login`; `email_confirmed_at` set → `/dashboard`. "Resend" calls
**`supabase.auth.resend({ type: 'signup', ... })`**. The actual confirmation is
processed by `/auth/callback` (§5). Middleware enforces this gate (§10 step 3).

### Onboarding — `/onboarding`

`src/app/(auth)/onboarding/page.tsx` — a 4-step wizard (`org → project → invite →
done`). Server actions in `src/actions/onboarding.actions.ts`:

- **`createOrganisationAction`** — uses the **service-role client** to:
  (a) insert `organisations`; (b) insert `user_organisations` with
  **`role: 'admin'`**, `is_active: true`; (c) set `profiles.popia_consent_at`;
  (d) seed a `billing.subscriptions` row (`tier:'free'`, `status:'active'`).
  Emits analytics `ONBOARDING_STARTED`.
- **`createFirstProjectAction`** — inserts `projects.projects` (`status:'active'`),
  then `projects.project_members` with **`role:'project_manager'`** for the creator.
- **`inviteTeamMemberAction`** — see §4.

> The organisation **creator becomes `admin`**, not `owner`. The `owner` role
> exists and some features gate on it — see [§15](#15-known-gaps--inconsistencies).

---

## 4. User assignment & invitations

There are two ways a user gains org membership.

### Path A — create an org (onboarding)

Covered in §3: `createOrganisationAction` inserts the creator's
`user_organisations` row as `admin`.

### Path B — invitation

**Send** — `inviteTeamMemberAction` (used by both the onboarding wizard and
`/settings/team`'s `InviteForm`): rate-limited `invite:{userId}` 10/hr, then
**`supabase.auth.admin.inviteUserByEmail(email, { data: { invited_to_org,
invited_role }, redirectTo: <APP_URL>/onboarding/join })`**.

**Accept** — `/invite/[token]` (`src/app/(auth)/invite/[token]/page.tsx`):
1. On mount, **`supabase.auth.verifyOtp({ token_hash: token, type: 'invite' })`**
   establishes a session and reads `user_metadata.invited_to_org` / `invited_role`.
2. On submit, **`supabase.auth.updateUser({ password, data: { full_name } })`**,
   then **upsert** `user_organisations` (`role: invited_role`, `is_active: true`,
   `onConflict: 'user_id,organisation_id'`).
3. Redirects by role — `/snags` for field roles, else `/dashboard`.

> The invite send/accept routing is inconsistent — `inviteTeamMemberAction`
> redirects to `/onboarding/join`, the accept page lives at `/invite/[token]`,
> and the role defaults to the non-existent value `'member'`. See
> [§15](#15-known-gaps--inconsistencies).

### Project assignment

Org membership (`user_organisations`) ≠ project assignment. A user is assigned to
a specific project by a row in `projects.project_members`. `createFirstProjectAction`
adds the project creator as `project_manager`. `project_members` is what scopes a
`client_viewer` down to specific projects (§11).

---

## 5. Login

`/login` (`src/app/(auth)/login/page.tsx`) offers three methods.

| Method | SDK call | Audit event |
|---|---|---|
| **Password** | `signInWithPassword({ email, password, captchaToken? })` | `login` (`method: 'password'`) |
| **Magic link** — request | `signInWithOtp({ email, options: { emailRedirectTo: …?from=magic_link, shouldCreateUser: false, captchaToken? } })` | `magic_link_requested` |
| **Magic link** — verify | `verifyOtp({ email, token: code, type: 'email' })` | `login` (`method: 'magic_link'`) |
| **Google OAuth** | `signInWithOAuth({ provider: 'google', options: { redirectTo: …?from=oauth_google, queryParams: { access_type: 'offline', prompt: 'consent' } } })` | `login` (written by `/auth/callback`) |

Magic link is a two-step flow (request → typed 6-digit code), not link-only —
see playbook pitfall #1. The Google button only renders when
`NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === 'true'`.

### `/auth/callback`

`src/app/(auth)/auth/callback/route.ts` — `GET` handler. Reads `code`,
`token_hash`/`token`, `type`, `next` (default `/dashboard`), `error_code`, `from`.

1. **Error branch** — if `error_code` present, redirect to
   `/reset-password?step=code&error=…` (when `next` is a reset path) or
   `/login?error=…`. This is how a scanner-burned link recovers gracefully.
2. **PKCE branch** — if `?code`: **`exchangeCodeForSession(code)`** →
   `auditLogin` → redirect to `next`.
3. **OTP branch** — if `?token_hash` + valid `type` (`signup`, `invite`,
   `magiclink`, `recovery`, `email_change`, `email`):
   **`verifyOtp({ token_hash, type })`** → `auditLogin` (unless
   `type === 'email_change'`) → redirect to `next`.
4. Fallthrough → `/login?error=auth_callback_failed`.

`auditLogin` writes a `login` event via the service-role logger, with
`metadata.method = from ?? type`. The dual `?code` / `?token_hash` handling is
deliberate — see playbook pitfall #1.

---

## 6. MFA (TOTP)

Server actions in `src/actions/mfa.actions.ts`. UI at `/settings/security/mfa`.

| Action | SDK calls | Audit |
|---|---|---|
| `enrollTotpAction` | `mfa.enroll({ factorType: 'totp' })` → returns `factorId`, `qrCode`, `secret` | none (factor unverified) |
| `verifyEnrollAction` | `mfa.challenge` → `mfa.verify({ factorId, challengeId, code })` | `mfa_enrolled` |
| `unenrollAction` | password re-verify → `mfa.unenroll({ factorId })` | `mfa_unenrolled` |
| `challengeMfaAction` | `mfa.listFactors` → `mfa.challenge` → `mfa.verify` | none |

### AAL2 gate

Once a user has a **verified** TOTP factor, the middleware forces step-up: an
`aal1` session is redirected to `/verify-mfa` (§10 step 4b). `/verify-mfa` submits
the code to `challengeMfaAction`; success elevates the session to `aal2` and
redirects to `next`. See [`auth-mfa-setup.md`](./auth-mfa-setup.md).

---

## 7. Password reset & email change

### Password reset — `/reset-password` → `/reset-password/confirm`

Both pages are `force-dynamic`. `src/app/(auth)/reset-password/page.tsx` is a
two-step state machine (`email | code`):

1. **Request** — `resetPasswordForEmail(email, { redirectTo:
   <origin>/auth/callback?next=/reset-password/confirm&email=… , captchaToken? })`
   → audit `password_reset_requested` → step `code`.
2. **Verify** — `verifyOtp({ email, token: code, type: 'recovery' })` →
   `/reset-password/confirm`.
3. An **"I already have a code →"** path jumps straight to code entry *without*
   re-sending (re-sending would invalidate the existing code — playbook #5).
   `?step=code`, `?email=`, `?error=` are pre-loaded from `/auth/callback` bounce-backs.

`reset-password/confirm/page.tsx` — checks for a session (`getSession()` →
`ready`/`invalid`), blocks weak/pwned passwords, then **`updateUser({ password })`**
→ audit `password_changed` (`via: 'reset_otp'`) → **`signOut()`** so the user
re-authenticates with the new password.

### Email change — `/settings/account`

`src/actions/account.actions.ts`:
- **`changeEmailAction`** — rate-limited; re-verifies the current password;
  **`updateUser({ email: newEmail })`** (Supabase emails the new address a code).
- **`confirmEmailChangeAction`** — rate-limited; **`verifyOtp({ email: newEmail,
  token: code, type: 'email_change' })`** → audit `account_email_changed`.

---

## 8. Sessions

`src/actions/security.actions.ts`, UI at `/settings/security/sessions`.

- **`getActiveSessionsAction`** — service-role `fetch` to
  `/auth/v1/admin/users/{id}/sessions`; flags the current session by decoding the
  `session_id` JWT claim. Read-only.
- **`signOutOthersAction`** → `signOut({ scope: 'others' })`.
- **`signOutEverywhereAction`** → `signOut({ scope: 'global' })`.
  Both are rate-limited and write a `logout` event (`metadata.scope`) *before*
  calling `signOut`.
- **`POST /auth/signout`** (`src/app/auth/signout/route.ts`) — writes `logout`,
  `signOut()`, redirects `/login`.

---

## 9. Account deletion

`deleteAccountAction` in `src/actions/account.actions.ts` — POPIA §24 self-service
deletion. Rate-limited `account-delete:{ip}` 3/5min. Ordered checks:

1. Zod-validate `confirmEmail` + `password`; `getUser()`.
2. Confirm the typed email matches the account email.
3. **Re-verify the password *first*** — before any ownership/billing checks. This
   ordering is deliberate: it prevents the deletion form being used as an
   enumeration oracle ("does this account own orgs / have a paid sub?").
4. Block if the user is the **sole owner** of any org.
5. Block if any owned org has a **paid, active** `billing.subscriptions` row.
6. Write `account_deleted` audit event, then **`admin.deleteUser(user.id)`**,
   then `signOut()`. On failure, surface a support contact.

FK `ON DELETE CASCADE` from `auth.users` removes `profiles`, `user_organisations`,
and `notifications`. `auth_events` rows survive (no FK — see §11).

---

## 10. Middleware gate

`src/middleware.ts` — runs on every request except static assets (`matcher`
excludes `_next/static`, `_next/image`, `favicon.ico`, and common asset
extensions). It uses a service-role client for `hasOrg()` and
`hasVerifiedMfaFactor()`.

**Constants:** `PUBLIC_PATHS` = `/login`, `/signup`, `/reset-password`,
`/auth/callback`, `/share`, `/account-deleted`, `/inspection`.
`SELF_AUTH_PATHS` = `['/api/notifications/dispatch']`.

**Ordered decision tree:**

| Step | Condition | Action |
|---|---|---|
| 0 | path starts with a `SELF_AUTH_PATHS` entry | `NextResponse.next()` immediately — **no session lookup** (route self-verifies its Bearer JWT — playbook #13) |
| — | `updateSession()` resolves `{ user, aal }` (`aal` decoded from the access-token JWT) | |
| 1 | no `user`, not a public/verify path | redirect `/login?next=<path>` |
| 2 | `user` on a public/auth page (excl. `/auth/*`, `/reset-password*`, `/inspection*`) | redirect `/dashboard` |
| 3 | `user` with no `email_confirmed_at` | redirect `/verify-email` |
| 4 | on `/verify-email` but already confirmed | redirect `/dashboard` (or `/onboarding` if no org) |
| 4b | `user`, `aal === 'aal1'`, **and** a verified MFA factor exists | redirect `/verify-mfa?next=<path>` |
| 5 | `user`, no org, not already on `/onboarding` | redirect `/onboarding` |
| 6 | `user` with an org sitting on `/onboarding` | redirect `/dashboard` |
| — | fallthrough | return the response |

---

## 11. RLS model

### Principle — org-scoping

Every domain table in `projects` / `compliance` / `field` / `suppliers` /
`marketplace` / `tenants` / `billing` carries a denormalised `organisation_id`.
The standard policy is:

```sql
organisation_id = ANY (public.get_user_org_ids())
```

RLS is enabled on all tables (`00009`). Schema-level grants for `authenticated` /
`anon` / `service_role` come from `00025`.

### Helper functions (all `SECURITY DEFINER`)

| Function | Returns | Notes |
|---|---|---|
| `public.get_user_org_ids()` | `UUID[]` | Caller's active org IDs. Hardened in `00027` with `SET search_path=public`, `SET row_security=off`. The workhorse of org-scoping. |
| `public.user_is_client_viewer(org)` | `BOOLEAN` | True iff the caller's active membership in *that* org has `role='client_viewer'`. Added `00034`. |
| `public.user_has_project_access(project)` | `BOOLEAN` | True iff the caller is an active `project_members` row. `00066`, fixed `00068`. |
| `inspections.user_can_verify` / `is_inspection_verifier` / `user_can_write_responses` / `user_has_inspection_read` | `BOOLEAN` | Module-specific, finer-grained policies for the inspections schema (`00066`–`00068`). |

### `client_viewer` scope-down (`00034`)

**The bug it fixed:** org-only SELECT policies let a `client_viewer` assigned to
one project read the *entire* org. Tenancy was checked; role was not (playbook #10).

**The fix:** SELECT policies on 16 tables became role-aware:

```sql
organisation_id = ANY (get_user_org_ids())
AND ( NOT user_is_client_viewer(organisation_id)
      OR <id|project_id> IN (
            SELECT project_id FROM projects.project_members
            WHERE user_id = auth.uid() ) )
```

Internal roles short-circuit the `NOT user_is_client_viewer` branch (unchanged
behaviour). For tables with **no project FK** (`compliance.*`, `marketplace.orders`
/`order_items`), `00034` adds **RESTRICTIVE** policies `NOT user_is_client_viewer(...)`
— restrictive policies `AND` with permissive ones, correctly overriding any
pre-existing `FOR ALL` policy that would otherwise re-admit the client.

### Standard CRUD pattern

- **SELECT** — `organisation_id = ANY(get_user_org_ids())` (+ the client_viewer
  clause above). Child tables with no `organisation_id` scope through the parent.
- **INSERT** — `WITH CHECK (organisation_id = ANY(get_user_org_ids()))`. `00009`
  shipped INSERT for only a few tables; **`00027` backfilled** INSERT/UPDATE for
  10 tables that were silently failing writes.
- **UPDATE / manage** — privileged tables (`organisations`, `projects.projects`)
  use `FOR ALL` / `FOR UPDATE` with an `EXISTS` check against `user_organisations`
  for `role ∈ owner/admin(/project_manager)`.
- **DELETE** — generally no dedicated policy; relies on `FOR ALL` policies or
  service-role + FK CASCADE.

### Effective access matrix (base RLS)

| Capability | owner / admin | project_manager | contractor / inspector / supplier | client_viewer |
|---|---|---|---|---|
| Read org domain data | ✓ | ✓ | ✓ | only assigned projects |
| Write domain data | ✓ | ✓ | ✓ | ✗ |
| Manage org / billing | ✓ | ✗ | ✗ | ✗ |
| Access `compliance.*` / `marketplace.*` | ✓ | ✓ | ✓ | ✗ (RESTRICTIVE block) |

Finer rules — owner-only project hard-delete, inspections verifier
separation-of-duties — are enforced in **server actions** and **module-specific
RLS**, not base RLS.

### Recursion history — `00024` → `00026` → `00027`

- **`00024`** — the `user_organisations` SELECT policy called `get_user_org_ids()`,
  which itself `SELECT`s `user_organisations`. Postgres' structural cycle check
  rejects *any* policy on table T whose expression queries T — regardless of
  `SECURITY DEFINER` (playbook #11).
- **`00026`** — `00024`'s bypass attempt still tripped the cycle check, so all
  `user_organisations` SELECT policies were dropped, leaving a single safe
  self-lookup: `user_id = auth.uid()`. **Consequence: listing all members of an
  org now requires the service-role client** — RLS alone can no longer answer
  "who else is in my org."
- **`00027`** — re-created `get_user_org_ids()` hardened (so it reads real org
  IDs independent of `user_organisations` RLS), and backfilled the missing
  INSERT/UPDATE policies.

### Audit table

`public.auth_events` (`00038`, extended `00039`) — append-only. **No FK to
`auth.users`**, nullable `user_id`: rows must survive user deletion for POPIA §24.
RLS: a user may `SELECT` their own rows; writes are service-role only.

---

## 12. Auth email delivery

Supabase Auth sends all auth email (verification, magic link, recovery,
email-change, invite) via **custom SMTP → Resend**.

- **SMTP config:** host `smtp.resend.com`, port `465`, user `resend`, sender
  `noreply@e-site.live`, password = the Resend API key.
- **Templates:** the recovery / magic-link / email-change templates render
  `{{ .Token }}` (the 6-digit OTP) prominently, with `{{ .ConfirmationURL }}` as
  a fallback link — this is the defence against corporate scanners burning
  single-use links (playbook #1).
- **DNS:** `e-site.live` has DKIM + SPF records published and is verified in
  Resend for sending.

The five layers that must *all* be correct for email to land are catalogued in
playbook #2. Rotating the Resend key means PATCHing the **whole** SMTP object,
never `smtp_pass` alone (playbook #3).

---

## 13. Config reference

### Environment variables

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `…_ANON_KEY` | Cookie/SSR + browser clients |
| `SUPABASE_SERVICE_ROLE_KEY` | `createAdminClient`, middleware helpers |
| `NEXT_PUBLIC_SITE_URL` / `APP_URL` | `emailRedirectTo`, invite `redirectTo` |
| `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED` | Renders the Google sign-in button |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Enables CAPTCHA on signup/reset |
| `RESEND_API_KEY` / `RESEND_FROM` | Edge-function transactional email |

### Supabase dashboard / Management API settings

- **Site URL** — `https://esite-lilac.vercel.app` (production). Must track the
  real app host (playbook #4).
- **`uri_allow_list`** — includes `/auth/callback`, `/auth/callback?next=*`,
  `/reset-password/confirm`, staging `/**`, Vercel preview wildcards, and the
  mobile `exp://` scheme.
- **SMTP** — see §12.
- **Rate limits** — defaults are appropriate at launch scale; see
  [`auth-rate-limits.md`](./auth-rate-limits.md).
- **OAuth / MFA / CAPTCHA** — setup steps in the dedicated `auth-*-setup.md` docs.

---

## 14. Verification checklist

Smoke-test each flow after any auth change. The commit-mapped acceptance matrix
is [`auth-punch-list-acceptance.md`](./auth-punch-list-acceptance.md).

- [ ] **Signup** — new email → "check inbox" → confirm link → lands on `/onboarding`.
- [ ] **Onboarding** — create org → creator has an `admin` `user_organisations` row + a `free` `billing.subscriptions` row.
- [ ] **Invite** — send invite → accept at the invite URL → `user_organisations` upsert with the invited role.
- [ ] **Login** — password, magic-link (code), and Google all reach `/dashboard`; an `auth_events` `login` row is written each time.
- [ ] **MFA** — enroll → `aal1` session is bounced to `/verify-mfa` → code elevates to `aal2`.
- [ ] **Password reset** — request → 6-digit code → confirm → old password rejected, new one works.
- [ ] **Email change** — request → code to new address → `account_email_changed` logged.
- [ ] **Sessions** — "sign out everywhere" invalidates other sessions; `logout` logged.
- [ ] **Account deletion** — wrong password rejected *before* any ownership probe; sole-owner / paid-sub blocks fire; `auth_events` row survives the delete.
- [ ] **RLS** — a `client_viewer` assigned to one project sees only that project; cannot read `compliance.*` / `marketplace.*`.

---

## 15. Known gaps & inconsistencies

Surfaced during reconstruction. Each needs a decision — they are **not** resolved
by this spec.

1. **Invite routing is three-way inconsistent.** `inviteTeamMemberAction` sets
   `redirectTo` to `/onboarding/join`; the accept page actually lives at
   `/invite/[token]`; `InviteForm.tsx`'s comment claims `/invite/{token}`.
   Verify which route invited users actually land on and align all three.
2. **Invite role default is an invalid value.** The invite-accept upsert defaults
   `invited_role` to `'member'`, which is not in *any* of the three role CHECK
   lists (§2). An invite that reaches that default would violate the
   `user_organisations` role constraint. Default to a real role (e.g.
   `client_viewer`) or fail loudly.
3. **Org creator is `admin`, not `owner`.** `createOrganisationAction` assigns
   `admin`. The `owner` role exists and features reference owner-only behaviour
   (e.g. project hard-delete, sole-owner deletion block). Confirm whether any
   account is ever actually assigned `owner` — if not, either assign the creator
   `owner` or drop `owner` from the enum.
4. **`/invite/[token]` skips password hardening.** Unlike `/signup`, the invite
   accept form has only `minLength={8}` — no zxcvbn score check, no HIBP pwned
   check, no CAPTCHA. Apply the same password gate as signup.
5. **`lockout` audit event is dead.** `lockout` is in the `AuthEventType` union
   and the DB CHECK constraint but nothing ever emits it. Either wire up
   lockout detection or remove the type.

---

*Companion: [`auth-pitfalls-playbook.md`](./auth-pitfalls-playbook.md) — portable
lessons for the next app.*
