# CONFORMANCE.md — E-Site vs WM Onboarding Standard v1

Standard: `/Volumes/Extreme SSD/DEVELOPER/APPS/ONBOARDING-STANDARD/STANDARD.md` (+ `kit/`).
Profile: **S** (Supabase web app, `apps/web`) with an **N**-style native companion (`apps/mobile`, Expo).
Approved product-model exception (STANDARD §1, 2026-08-05): **ESITE keeps hardened self-signup + org-creation onboarding** — A3-style invite-only entry does not apply.

Status legend: ✓ conformant · **partial** · **—** gap · **n.a.** not applicable.
Rule (STANDARD §4, generalizing ESITE's rbac-matrix rule): **update this file in the same PR as any auth change.**

Last updated: 2026-08-05 (Phase 2 standardization pass, branch `fix/membership-write-authz-rls`).

## A. Entry & authentication

| # | Requirement (condensed) | Level | Status | Evidence |
|---|---|---|---|---|
| A1 | Root/launch triage by session and role | MUST | ✓ | `apps/web/src/middleware.ts` (session/verify/org gates) + `apps/web/src/lib/auth/require-role.ts` role gates on (admin)/(portal) shells |
| A2 | Branded auth surface | SHOULD | ✓ | `apps/web/src/app/(auth)/layout.tsx` branded E-Site auth shell (product-level branding; per-org branding n.a. for self-serve SaaS) |
| A3 | Self-signup disabled UI + provider | MUST | n.a. | Approved exception (STANDARD §1): hardened self-signup — captcha slot, verify-email gate, zxcvbn+HIBP on `(auth)/signup` |
| A4 | Password + magic-link/OTP login (`shouldCreateUser: false`) | SHOULD | ✓ | `apps/web/src/app/(auth)/login/page.tsx` — password/magic-link tabs; `shouldCreateUser: false` on `signInWithOtp` |
| A5 | zxcvbn (score ≥2) + HIBP on every password-set surface | MUST | ✓ | `apps/web/src/lib/password-strength.ts` + `PasswordStrengthMeter` on `(auth)/signup` and `(auth)/reset-password/confirm` (the only set surfaces — in-app change and admin-created users route through the recovery flow) |
| A6 | Enumeration defence: uniform responses + 1.0–1.3 s timing pad | MUST | ✓ (this pass) | `apps/web/src/lib/timing-pad.ts`; padded reset request (`reset-password/page.tsx onRequestCode`, now answers uniformly — no raw provider error) and magic-link request (`login/page.tsx onMagicLinkSubmit`) |
| A7 | `?next` through allow-list + dot-segment normalization, unit-tested | MUST | ✓ (this pass) | `apps/web/src/lib/safe-next.ts` (kit `loginNext.ts` port, prefixes derived from route groups) consumed at login password/magic-link + verify-mfa; tests `apps/web/src/lib/safe-next.test.ts` |
| A8 | Captcha slot, env-gated (Turnstile) | SHOULD | code-complete, provider config pending | `apps/web/src/components/CaptchaTurnstile.tsx` gated on `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; enable per `docs/auth-captcha-setup.md` |
| A9 | Guards on every protected surface, failing closed | MUST | ✓ | `middleware.ts` + `requireRolePage`/`requireRoleAPI` (unknown/error ⇒ deny); contract in `docs/rbac-matrix.md` |
| A10 | Server-side gating where the stack allows | SHOULD | ✓ | `apps/web/src/middleware.ts` — ESITE is the standard's reference implementation |
| A11 | Guard unit tests | MUST | ✓ (this pass) | `apps/web/src/middleware.test.ts` (session/email/MFA/org gates) + `apps/web/src/lib/safe-next.test.ts` + `apps/web/src/lib/auth/require-effective-role.test.ts` + `(auth)/auth/callback/route.test.ts` |
| A12 | Auto-logout: idle timer + warning + storage purge | SHOULD | — | Gap: no idle timer in web. Mitigation: `settings/security` SessionList (sign out others/everywhere). Port source: kit `session/useSessionMonitor` |
| A13 | Token scrubbing; OTP-first recovery links | MUST | ✓ | `(auth)/reset-password/page.tsx` OTP-first (code-entry default; scanner-burnt-link self-heal); `token_hash` server-side verifyOtp in `(auth)/auth/callback/route.ts` |
| A14 | MFA (TOTP) | SHOULD (operator-grade) | ✓ | `apps/web/src/actions/mfa.actions.ts` + `(auth)/verify-mfa` + middleware aal1→verify-mfa gate (server-enforced) |

## B. Invitations

ESITE deleted the invite subsystem in migration `00079_admin_managed_users.sql` (admins create users directly; users set passwords through the recovery flow). B rows are assessed against that admin-managed model.

| # | Requirement (condensed) | Level | Status | Evidence |
|---|---|---|---|---|
| B1 | Admin invite UI (email, name, role, scope) | MUST | ✓ (adapted) | `(admin)/settings/users` — admin-managed creation (email/name/role); sub-org rosters scope membership |
| B2 | Server-enforced admin-only creation | MUST | ✓ | `apps/web/src/actions/users.actions.ts` `createUserAction` (admin-gated server action, validated input) |
| B3 | Role reaches membership + scope at invite time; no orphan users | MUST | ✓ | `createUserAction` writes `user_organisations` (role, `is_active`) server-side in the same action that creates the auth user |
| B4 | Branded email; never passwords in email; CSPRNG temp pw + forced-change if relayed | MUST | ✓ | `apps/edge-functions/supabase/functions/auth-email-hook` (branded token_hash links + 6-digit codes via Resend); no temp-password path exists at all |
| B5 | Delivery never blocks on email; copy-link fallback | SHOULD | partial | `createUserAction` falls back to the plain recovery email when the branded send fails; admin Resend button; no copy-link relay |
| B6 | Resend-invite: fresh link; degrade to recovery for confirmed users | MUST | ✓ | `users.actions.ts` `resendInviteAction` (fresh link; recovery-flow degrade per header comment) |
| B7 | Truthful invite status from real auth state | SHOULD | ✓ | `(admin)/settings/users/page.tsx` derives `hasSignedIn` from `last_sign_in_at`; known limit: `listUsers` 1000-user page cap (tracked follow-up) |
| B8 | Expired/pre-consumed link self-heal inline | SHOULD | ✓ | `/auth/callback` bounces to `/reset-password?step=code&reason=link-expired` — inline code entry + fresh-code request (`route.test.ts` covers the bounce) |
| B9 | Bespoke invite table hardening | MUST (C) | n.a. | No bespoke invite table — `org_invites` dropped in `00079`; Supabase-native tokens only |

## C. Provisioning & database

| # | Requirement (condensed) | Level | Status | Evidence |
|---|---|---|---|---|
| C1 | All schema versioned in the repo | MUST | ✓ | `apps/edge-functions/supabase/migrations/` (00001…; applied via Management API, logged in `schema_migrations`) |
| C2 | `handle_new_user` creates profile; role logic out of trigger | MUST (S) | ✓ | `00001_initial_schema.sql` trigger creates the profile; role/org membership written by signup/admin paths, not the trigger |
| C3 | Separate roles table (or documented single-role variant) | MUST (S/N) | ✓ (documented variant) | Role on membership rows: `public.user_organisations.role` + `projects.project_members.role` (CHECK-constrained); contract in `docs/rbac-matrix.md` |
| C4 | SECURITY DEFINER role helpers used by RLS | MUST (S) | ✓ | `public.user_effective_project_role` (e.g. `00122_project_boq_rates.sql`); this branch's `00177` adds membership-write helpers |
| C5 | Forced-change flag, verified write | MUST | ✓ (by design) | No temp passwords exist: admin-created accounts are unusable until set-password via the recovery flow — nothing to force-change |
| C6 | Active/inactive enforced at request time; reversible; last-admin guards | MUST | partial | `is_active` checked per request (`middleware.ts hasOrg`, RLS); `users.actions.ts` update/remove guard active-admin counts and self-action; session revocation on deactivation not verified this pass |
| C7 | Auth events audit table, no user FK, broad coverage | MUST | ✓ | `public.auth_events` (event whitelist in `00079`) + `actions/auth-event.actions.ts` / shared `logAuthEvent` across login, resets, MFA, account changes; note: writers are best-effort, no client retry queue |
| C8 | Honest deletion; self-service where required | MUST | ✓ | `(admin)/settings/account/DeleteAccountForm.tsx` + `actions/account.actions.ts` + `/account-deleted`; ESITE guards are the standard's cited reference |
| C9 | Onboarding completion flag + backfill | MUST | ✓ (documented variant) | Completion derived live from active org membership (`middleware.ts hasOrg`) — no flag to drift, no backfill needed |
| C10 | No privileged credentials in client artifacts; native = Keychain | MUST | ✓ | Service-role confined to server (middleware/actions/edge fns); mobile sessions in `expo-secure-store` (`apps/mobile/src/lib/supabase.ts`) |
| C11 | RLS default-deny; no `USING (true)` writes; anon via narrow RPCs | MUST (S) | ✓ (this branch) | Migration `00177` (this branch / PR #157) adds RESTRICTIVE write policies on `user_organisations` + `project_members`; anon SELECT revoked (`00168`) — pending merge/apply |

## D. First-run experience

| # | Requirement (condensed) | Level | Status | Evidence |
|---|---|---|---|---|
| D1 | Multi-step wizard with progress | MUST | ✓ (approved variant) | `(auth)/onboarding/page.tsx` — org → project → done wizard with step track (org-creation onboarding per ESITE's product-model exception) |
| D2 | Dedicated-route, server-enforced, non-dismissable gate | MUST | ✓ | `middleware.ts` no-org → `/onboarding` redirect — ESITE is the standard's reference |
| D3 | Role explained to the new user | SHOULD | — | Gap: no role-overview step (owner is implicit in self-serve; admin-created members land on dashboard without a role explainer) |
| D4 | Wizard failure modes handled (missing profile row) | MUST | ✓ | Wizard surfaces server-action errors inline; profile row comes from the `00001` trigger, wizard is not profile-dependent |
| D5 | Product tours / checklists | MAY | partial | Onboarding email drip (`onboarding-email-d0…d14` edge fns); no in-app tour |
| D6 | PWA install helper | MAY | — | Not implemented |

## E. Cross-cutting security

| # | Requirement (condensed) | Level | Status | Evidence |
|---|---|---|---|---|
| E1 | CSRF double-submit, server-verified | MUST (C) | n.a. | S profile — Next.js server actions (origin-checked) + `@supabase/ssr` cookie handling |
| E2 | Rate limiting on login/reset/invite | MUST (C) · SHOULD (S) | partial (code-complete) | Supabase provider limits configured (`docs/auth-rate-limits.md`); Turnstile captcha code-complete, provider config pending (`docs/auth-captcha-setup.md`) |
| E3 | Cache/state purge on sign-out and user change | MUST | partial | Server sign-out clears session cookies (`app/auth/signout/route.ts`); web has no persistent client cache layer; mobile offline-queue purge not re-verified this pass |
| E4 | Password change requires re-auth | MUST | ✓ (by flow) | All password changes route through the recovery flow (email round-trip = isolated re-auth); no silent in-session change path |
| E5 | Docs match code; stale " 2" duplicates removed | SHOULD | ✓ | `docs/auth-*.md` + `docs/rbac-matrix.md` maintained under the same-PR rule (this file now included). Note: a stale `esite 2` sibling exists OUTSIDE the repo (not in git) — flagged for deletion |
| E6 | Guard units + invite→accept→login and reset→login smoke | MUST | partial | Guard units ✓ (`middleware.test.ts`, `safe-next.test.ts`, require-role, auth-callback, login/reset page tests) + Playwright `00-auth-guard`/`08`/`09-rbac`; a CI-run invite/reset end-to-end smoke is not yet scripted (live smokes performed manually 2026-07-07) |

## Env-gated items (user action required)

| Item | State | To enable |
|---|---|---|
| Turnstile captcha (A8/E2) | code-complete, provider config pending | Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (+ secret in Supabase) per `docs/auth-captcha-setup.md` |
| Google OAuth sign-in | code-complete, provider config pending | Set `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=true` + provider setup per `docs/auth-google-oauth-setup.md` |

## Native companion note (N profile)

The mobile app carries no invite/set-password surface by design: account emails land on the **web** app (STANDARD §1, N profile — GMI decision D3, no native deep links). The dead `apps/mobile/app/(auth)/invite/[token].tsx` screen (self-upserted `user_organisations` with a role defaulting to `'member'`, invalid under the `00001` role CHECK, for the invite subsystem dropped in `00079`) was deleted in this pass.
