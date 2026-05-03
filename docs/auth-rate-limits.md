# Supabase Auth — rate-limit audit

**Last verified:** 2026-05-03
**Project ref:** `cbskbnvvgcybmfikxgky`
**Source:** `GET /v1/projects/{ref}/config/auth` (Supabase Management API)

Closes auth punch-list **#3** (verify + tighten Supabase rate limits).

## Current settings (post-audit)

| Field | Value | Notes |
|---|---:|---|
| `rate_limit_anonymous_users` | 30 / hr / IP | Signup, password-reset, magic-link triggering. Default; appropriate for B2B SaaS — a real signup spike (10–20/hr from one IP) is plausible during a launch demo, but 30/hr is room enough. |
| `rate_limit_otp` | 30 / hr / IP | Magic-link generation (lands when #11 ships). Default fine. |
| `rate_limit_verify` | 30 / hr / IP | Per-IP cap on link/code verification. Default fine. |
| `rate_limit_token_refresh` | 150 / 5 min / IP | Legitimate refresh (~12/hr/user) is well under cap; an attacker burning refresh tokens hits the wall fast. |
| `rate_limit_email_sent` | 2 / hr | **Dormant under custom SMTP.** With Resend SMTP active (per [ADR-005](../../.../decisions/ADR-005-resend-smtp-for-supabase-auth.md)), Supabase relies on the SMTP provider for delivery rate-limiting. Resend's plan is the effective ceiling. |
| `rate_limit_sms_sent` | 30 / hr | SMS not used by E-Site. |
| `rate_limit_web3` | 30 / hr | Not used. |
| `password_min_length` | 8 | Matches `updatePasswordSchema` Zod min(8). Strength is enforced at form-level in #8 (zxcvbn + HIBP). |
| `disable_signup` | `false` | Open signup intentional. |
| `smtp_max_frequency` | 1 (1 email per second per recipient) | Per [ADR-005](). Protects against accidentally-replayed emails. |
| `mfa_totp_enroll_enabled` | `false` | Will flip to `true` when #10 lands. |
| `mfa_totp_verify_enabled` | `false` | Will flip to `true` when #10 lands. |

## Decision

**No PATCH applied.** Current values are reasonable defaults for a B2B SaaS at our launch scale. Aggressive tightening would block legitimate-burst patterns (e.g. a launch-day demo with 10+ signups from a shared office NAT) without measurable security upside.

Application-layer rate limits — `apps/web/src/lib/rate-limit.ts` — provide an additional tight per-action ceiling on top of the Supabase floor (e.g. 3 deletion attempts per 5 minutes per IP from `deleteAccountAction`).

## Revisit when

- Abuse signal: any single IP triggering > 50% of the daily cap, or a sustained >5/min signup wave from a single IP. Tighten `rate_limit_anonymous_users` to 10 first.
- TOTP MFA enabled (#10) — verify the MFA verify endpoint isn't covered by `rate_limit_verify` separately; if it is, raise to 60 to allow legitimate retry.
- Magic-link adoption (#11) — if magic-link becomes the primary login, `rate_limit_otp: 30` may be tight. Raise to 60.

## How to PATCH (when needed)

**Critical: PATCH the FULL block, never a single field.** Sending `{ rate_limit_otp: 60 }` alone causes Supabase Management API to wipe adjacent fields to `null` (we hit this in Session 18 with the SMTP password). See [ADR-005](../../.../decisions/ADR-005-resend-smtp-for-supabase-auth.md) "Bad / accepted trade-offs" for the incident.

The full PATCH payload must include every currently-set field — `GET /v1/projects/{ref}/config/auth` first, mutate, `PATCH` the whole result back.
