# Auth punch-list — acceptance checklist

**Source:** [auth-punch-list-kickoff.md](../../Obsidian%20Vault/Projects/E-Site/auth-punch-list-kickoff.md) (Session 19 / 20)
**Branch:** `feat/powersync`
**Status:** all 13 items code-shipped; Arno-side prep + manual test pass remain.

This is the single review surface for verifying the punch list landed correctly. Each section maps an item → commit → Arno-side prep → manual test plan → sign-off box.

---

## Pre-test setup (one-time)

Before walking the per-item tests below:

- [ ] **Apply migrations to staging:** `cd esite/apps/edge-functions && supabase db push --db-url $STAGING_DB_URL` — runs `00038_auth_events.sql` + `00039_auth_events_magic_link.sql`. Without these, audit-event writes silently console.error.
- [ ] **Verify migrations applied:** check `auth_events` table exists in Supabase Studio + the CHECK constraint includes `magic_link_requested`.
- [ ] **Pin a fresh demo user:** sign up `qa-test-<n>@example.com` so per-item tests can run against an isolated account without polluting the demo seed.

---

## P0 — production blockers

### #1 — Account deletion (POPIA §24) — `598e18f`

**Arno prep:** none — works out of the box.

**Manual test:**
- [ ] Sign up new user → land on `/dashboard` (or `/onboarding`)
- [ ] Navigate `/settings` → click "Delete Account →" → lands on `/settings/account` with industrial red Danger panel
- [ ] Type wrong email → button stays disabled
- [ ] Type correct email + correct password → goodbye page renders
- [ ] Reload `/dashboard` → redirected to `/login`
- [ ] In Supabase Studio: `auth.users` row gone, `public.profiles` gone (cascade), `public.auth_events` row exists with `event_type='account_deleted'` and `metadata.initiated_by='self'`
- [ ] Sole-owner guard: as a sole-owner test user → blocked with "Transfer ownership in Settings → Team"
- [ ] Paid-sub guard: org with `tier='starter'` `status='active'` → blocked with "Cancel it in Settings → Billing"
- [ ] Rate limit: 4× attempts within 5 min from same IP → 4th blocked

### #2 — Auth audit log wire-up — `ed7a602`

**Arno prep:** apply migrations (above).

**Manual test:**
- [ ] Sign in → `auth_events` row with `event_type='login'`, `metadata.method='password'`
- [ ] POST `/auth/signout` → `event_type='logout'` row
- [ ] `/reset-password` submit → `event_type='password_reset_requested'`, `user_id=NULL`, `metadata.email_domain` set
- [ ] `/reset-password/confirm` submit → `event_type='password_changed'`, `metadata.via='reset_link'`

### #3 — Supabase rate limits — `4596668`

**Arno prep:** none — audit-only commit.

**Manual test:**
- [ ] Read `docs/auth-rate-limits.md` → confirm the audit table matches your understanding
- [ ] Decide if any limit needs tightening (defaults are recommended for launch scale)
- [ ] If yes, follow the "How to PATCH" snippet — **PATCH the FULL block** per ADR-005

### #4 — Signup `emailRedirectTo` + ToS links — `8270a7d`

**Arno prep:** none.

**Manual test:**
- [ ] `/signup` → POPIA consent label has 3 underlined links: Terms / Privacy / Acceptable Use → all `target="_blank"`
- [ ] Submit signup → email arrives → click link → land on `/onboarding` (not `/`)

### #5 — Email-verification gate — `55749b9`

**Arno prep:** none.

**Manual test:**
- [ ] Sign up new user → forwarded to `/verify-email` after the form
- [ ] Open inbox → click confirmation link → `/verify-email` auto-forwards to `/onboarding` (within ≤4s poll)
- [ ] Open `/dashboard` directly while still unverified → middleware redirects to `/verify-email`
- [ ] Click "Resend confirmation email" → second email arrives within ~30s
- [ ] Click "Sign out" on `/verify-email` → cookies cleared, lands at `/login`

---

## P1 — user-facing polish

### #6 — Email change at `/settings/account` — `7b1f583`

**Arno prep:** none.

**Manual test:**
- [ ] `/settings/account` → enter new email + password → "Confirmation link sent to <new>"
- [ ] Inbox of new email receives link → click → email field updates in Supabase Studio
- [ ] `auth_events` row with `event_type='account_email_changed'`, `metadata.from_email` + `metadata.to_email`
- [ ] Wrong password → "Incorrect password"
- [ ] Same-as-current email → "New email matches your current email"
- [ ] 6th attempt within 10 min from same IP → rate-limit message

### #7 — Active sessions UI + sign-out-everywhere — `788f304`

**Arno prep:** none.

**Manual test:**
- [ ] `/settings` → click "Manage security" → `/settings/security` loads with current session highlighted "THIS DEVICE"
- [ ] Sign in from a second browser → refresh `/settings/security` → second session row appears
- [ ] Click "Sign out everywhere else" → second browser's next request returns 401, current session stays
- [ ] Click "Sign out everywhere (incl. this device)" → confirm → redirect to `/login`

### #8 — zxcvbn + HIBP password checks — `45a5bdd`

**Arno prep:** none.

**Manual test:**
- [ ] `/signup` → type `Password1` → red bar, "Very weak" + "appeared in N breaches" warning
- [ ] Type `correcthorsebatterystaple` → green bar, "Very strong", no breach line
- [ ] Submit blocked when score < 2 OR pwned > 0
- [ ] Same on `/reset-password/confirm` (use a fresh reset link)
- [ ] Disable network → submit a strong password → submit succeeds (HIBP failure ≠ blocking)

### #9 — Cloudflare Turnstile CAPTCHA — `aa99775`

**Arno prep:** required (see `docs/auth-captcha-setup.md`):
- [ ] Create Turnstile widget at https://dash.cloudflare.com → site key + secret
- [ ] Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in Vercel (production + preview + development) via REST API direct
- [ ] PATCH the FULL Supabase Auth config with `security_captcha_enabled` + `security_captcha_provider='turnstile'` + `security_captcha_secret`
- [ ] Persist the secret in `.secrets/supabase.md`

**Manual test (post-prep):**
- [ ] `/signup` → Turnstile widget renders below the form
- [ ] Submit without challenge → "Please complete the verification challenge."
- [ ] Pass challenge → submit succeeds
- [ ] Same on `/reset-password` and both `/login` tabs

### #11 — Magic-link login — `f7f09ab`

**Arno prep:** none (apart from migrations).

**Manual test:**
- [ ] `/login` → click "Magic link" tab → enter email → "Check your inbox"
- [ ] Click email link → land on `/dashboard`
- [ ] `auth_events`: row `event_type='login'`, `metadata.method='magic_link'`
- [ ] `auth_events`: row `event_type='magic_link_requested'` (anonymous, with `metadata.email_domain`)
- [ ] Email for non-existent account → no link sent (Supabase handles silently)

### #13 — Mobile reset-password — `ba6aa0f`

**Arno prep:**
- [ ] Build mobile app: `pnpm --filter mobile run ios` (or `android`)
- [ ] Test device or simulator with the staging build

**Manual test:**
- [ ] Open app → "Forgot password?" → enter email → success state
- [ ] Open the email on the same device → tap link → app opens at `/reset-password-confirm` with the recovery session
- [ ] Set new password → "Password updated" → tap "Sign in" → sign in with new password succeeds

---

## P2 — value-adds

### #10 — TOTP MFA — `694edcc`

**Arno prep:** required (see `docs/auth-mfa-setup.md`):
- [ ] PATCH the FULL Supabase Auth config: `mfa_totp_enroll_enabled: true` + `mfa_totp_verify_enabled: true`

**Manual test (post-prep):**
- [ ] `/settings/security` → click "Manage two-factor authentication" → `/settings/security/mfa`
- [ ] Click "Enable two-factor authentication" → QR code renders
- [ ] Scan with 1Password / Google Authenticator / Authy → enter 6-digit code → "Confirm and enable"
- [ ] `/settings/security/mfa` shows the factor as enabled
- [ ] `auth_events`: row `event_type='mfa_enrolled'`, `metadata.factor_type='totp'`
- [ ] Sign out → sign in with password → middleware redirects to `/verify-mfa`
- [ ] Enter current code → land on `/dashboard`
- [ ] `/settings/security/mfa` → click "Disable" → confirm → factor removed
- [ ] `auth_events`: row `event_type='mfa_unenrolled'`

### #12 — Google OAuth — `61f9086`

**Arno prep:** required (see `docs/auth-google-oauth-setup.md`):
- [ ] Create OAuth client at https://console.cloud.google.com (Web app, redirect URI = Supabase callback)
- [ ] PATCH the FULL Supabase Auth config: `external_google_enabled: true` + `external_google_client_id` + `external_google_secret`
- [ ] Set `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=true` on Vercel via REST API direct
- [ ] Persist client_secret in `.secrets/supabase.md`

**Manual test (post-prep):**
- [ ] `/login` → "Continue with Google" → Google consent screen → callback → `/dashboard`
- [ ] `auth_events`: row `event_type='login'`, `metadata.method='oauth_google'`
- [ ] `/signup` → "Continue with Google" → consent → `/onboarding` (because `next=/onboarding`)
- [ ] Sign in via Google with email already in `auth.users` → Supabase links the accounts; profile remains intact

---

## Sign-off

When every box above is checked:

- [ ] **Arno** — all manual tests passed; no regressions noticed in the rest of the app.
- [ ] **Arno** — fast-forward `main` to `feat/powersync`: `git push origin feat/powersync:main --force-with-lease` (matches Session 17 procedure).
- [ ] **Vercel** — production deployment auto-builds within ~2 min and serves from the new SHA.
- [ ] **Promote to CLAUDE.md "Resolved" block** — once main is fast-forwarded.

## If something doesn't work

- **Audit row missing after action:** likely migrations 00038/00039 not applied. Run `supabase db push` against staging.
- **CAPTCHA / Google / MFA flow does nothing:** corresponding env flag or Supabase Auth config not set. Check the matching `docs/auth-*-setup.md`.
- **Email arrives from `mail.app.supabase.io` instead of `noreply@e-site.live`:** Supabase Auth SMTP config drifted (Session 18 lesson). Re-PATCH the FULL SMTP block.
- **`/verify-mfa` infinite-loops:** the `user.amr` JWT claim isn't populating after `mfa.verify`. Open issue, may need a JWT decode in middleware instead of relying on the user object shape.
- **NOT NULL profile-FK FK violation on delete:** the user has activity tied to non-nullable FK columns. Surface contacts arno@watsonmattheus.com manual deletion path. Tombstone-profile migration is a separate piece of work.
