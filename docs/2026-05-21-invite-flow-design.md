# Invite Flow Rebuild — Design Spec

**Date:** 2026-05-21
**Status:** Approved (brainstorm) — pending implementation plan

## 1. Problem

E-Site's admin "Add user" action (`createUserAction` in `apps/web/src/actions/users.actions.ts`)
provisions a passwordless `auth.users` row and then sends a **password-recovery** email
(`resetPasswordForEmail`). New users therefore receive a "reset your password" email rather
than a real invitation, and land on the reset-password page instead of a welcoming
"create your password" experience.

E-Site once had a proper invite flow (`inviteUserByEmail`, an `org_invites` table, an accept
page). Migration `00079_admin_managed_users.sql` deleted it and replaced it with the
recovery-flow shortcut. This spec rebuilds a proper invitation flow.

## 2. Goals & non-goals

**Goals**
- A brand-new user receives a branded "You've been invited to E-Site" email and lands on a
  "create your password" page.
- An email that already has an E-Site account is invited to *join the organisation* and must
  explicitly accept.
- Admins can resend invites; the users list shows who is still pending.

**Non-goals / out of scope**
- Mobile deep-linked invite acceptance (universal links). Web acceptance only — mobile users
  accept in a browser, then sign into the app. The orphan
  `apps/mobile/app/(auth)/invite/[token].tsx` is left untouched.
- Changing the password-recovery ("forgot password") flow — it stays exactly as is.
- The onboarding-wizard invite step (not reintroduced here).

## 3. Decisions (from brainstorm)

- **Mechanism:** Supabase-native `inviteUserByEmail` for new users; in-app acceptance for
  existing users. Rejected: a fully-custom `org_invites` token system — more code, more
  security surface, rebuilds what `00079` deleted.
- **Scope:** web acceptance only.
- **Existing users:** must explicitly accept (not added silently).

## 4. Architecture

One admin action, two paths chosen automatically by whether the email already has an
E-Site account.

### Path A — new email

1. Admin submits email + full name + role on `/settings/users`.
2. `inviteUserAction` calls
   `supabase.auth.admin.inviteUserByEmail(email, { data: { full_name, invited_to_org, invited_role }, redirectTo: <site>/auth/callback?next=/invite })`
   — this creates the `auth.users` row and sends Supabase's "Invite user" email.
3. It inserts the `user_organisations` membership: `is_active: true`, `accepted_at: NULL`,
   `role`, `invited_by`.
4. The invitee clicks the email link → `/auth/callback` verifies the `type=invite` token,
   establishes a session → forwards to `/invite`.
5. `/invite` shows "Welcome to E-Site — create your password." On submit the password is set
   and `accepted_at` is stamped; the user is redirected to `/dashboard`.

### Path B — existing email

1. Admin submits the same form. `inviteUserAction` detects the email already has an account.
2. It inserts a **pending** `user_organisations` membership: `is_active: false`,
   `accepted_at: NULL`, `role`, `invited_by`.
3. It sends a transactional "You've been invited to join [org] on E-Site" email via Resend.
4. The existing user logs in normally (their account is untouched) → the dashboard shows a
   `PendingInvitations` card: "[Org] invited you to join as [role]" + Accept / Decline.
5. Accept → `is_active: true`, `accepted_at: now()`. Decline → the pending row is deleted.

## 5. Data model

**No database migration.** `user_organisations` already has `is_active`, `accepted_at`
(nullable `TIMESTAMPTZ`), `invited_by`, `role`.

**Pending = `accepted_at IS NULL`.**

| State | `is_active` | `accepted_at` |
|---|---|---|
| New-user invite, incomplete | `true` | `NULL` |
| Existing-user invite, unaccepted | `false` | `NULL` |
| Active member | `true` | set |
| Deactivated member | `false` | set |

`get_user_org_ids()` filters `is_active = TRUE` (verified in migration `00027`) and is **not
modified**. The existing-user pending row (`is_active: false`) is therefore correctly withheld
from org access until accepted. The new-user pending row is `is_active: true`, which is
harmless because the new user has no password and no session until they accept.

**No RLS changes.** Accept / decline / complete-invite run in server actions using the
service-role client (E-Site's established pattern for privileged auth ops); each verifies the
caller owns the row. Users can already read their own `user_organisations` rows via the
existing `user_id = auth.uid()` SELECT policy. Org and inviter names for the prompt are
fetched server-side.

## 6. Components & files

**New**
- `apps/web/src/app/(auth)/invite/page.tsx` — new-user accept page. Modelled on
  `/reset-password/confirm`: session check, a "create your password" form with signup-grade
  strength (zxcvbn) + breach (HIBP) checks, and an "I have a code" fallback (mirrors
  `/reset-password`) for scanner-burned links. On success: set password, stamp `accepted_at`,
  redirect to `/dashboard`.
- `apps/web/src/actions/invitations.actions.ts` — invitee-side actions:
  `acceptOrgInvitationAction`, `declineOrgInvitationAction`, and the new-user
  `completeInviteAction` (set password + stamp `accepted_at`). All service-role; all verify
  caller ownership.
- A `PendingInvitations` component — dashboard card listing the user's pending invites with
  Accept / Decline; rendered only when pending invites exist.

**Changed**
- `apps/web/src/actions/users.actions.ts` — `createUserAction` → `inviteUserAction` with the
  two-path branch; `resendInviteAction` reworked (re-issue the Supabase invite for Path A;
  re-send the notification for Path B).
- `apps/web/src/app/(admin)/settings/users/page.tsx` — fetch `accepted_at`; show a "pending"
  badge while `accepted_at IS NULL`.
- `apps/web/src/app/(admin)/settings/users/UserRowActions.tsx` — resend control.
- `apps/web/src/app/(admin)/settings/users/AddUserForm.tsx` — invite-flavoured copy; calls
  `inviteUserAction`.
- The dashboard page — render `PendingInvitations`.
- `apps/web/src/middleware.ts` — allow an authenticated user to reach `/invite` (otherwise
  middleware step 2 bounces them to `/dashboard`).

**Supabase config (not files)**
- "Invite user" email template — branded copy, customised via the Management API (same
  method used for the recovery template per `auth-execution-spec.md` §12).

This work supersedes the parked commit `8bf8e76` (env-var fix + pending badge + resend on the
old recovery-flow design); its still-valid parts are folded in here.

## 7. Email

- **Path A:** Supabase's "Invite user" template — branded "You've been invited to E-Site";
  shows the link and the `{{ .Token }}` 6-digit code (for the code fallback).
- **Path B:** a transactional "You've been invited to join [org]" email via Resend (no token
  — they accept in-app).

## 8. Error handling

- Already an active member of this org → "already a member."
- Already has a pending invite here → "already invited — use Resend."
- A deactivated member here → error pointing the admin to reactivate from the members list
  (no silent resurrection).
- `inviteUserByEmail` reports the email already exists → fall back to Path B (the up-front
  new-vs-existing check is belt-and-suspenders). Other `inviteUserByEmail` failures → surface
  the error; roll back an orphaned `auth.users` row if the membership insert then fails
  (existing `createUserAction` pattern, kept).
- Path-B notification email fails → non-fatal; the pending membership still exists, the
  invitee sees it on login, the admin gets a warning + Resend.
- Invite link expired / scanner-burned / already used → `/invite` finds no valid session →
  "this link has expired or was already used," with the code fallback and an "ask your admin
  to resend" hint.
- Accepting a withdrawn invite (admin deleted it first) → `acceptOrgInvitationAction` handles
  "row not found" → "this invitation is no longer available."

**Permissions & limits:** `inviteUserAction` and resend stay owner/admin-gated; accept and
decline are any authenticated user but only on their own pending rows; `owner` cannot be
assigned at invite time; existing rate limits are kept.

## 9. Audit

Invite / accept / decline reuse existing `auth_events` types (`user_created`, `user_updated`
+ metadata) — no new event types, no migration.

## 10. Testing

- **Unit:** pure helpers (e.g. membership-state classification from `is_active` +
  `accepted_at`) get vitest coverage. There is little pure logic in this feature, so coverage
  is modest.
- **Typecheck:** stays clean across web (no new errors beyond the documented pre-existing
  ones).
- **Manual smoke walkthrough**, run before claiming done: Path A new email → branded email →
  link → set password → dashboard; Path A via the 6-digit code; Path B existing email →
  login → pending card → Accept; Decline; Resend on both; the two main errors
  (already-member, already-pending).

No integration harness exists for server actions in this codebase, so the flows are verified
by the smoke walkthrough + typecheck rather than automated e2e.

## Appendix A — Supabase "Invite user" email template

The branded template below replaces Supabase's default invite template so new-user (Path A)
invite emails are E-Site-branded. It is applied to the Supabase project's auth config via the
Management API — **a production-config change, applied manually with sign-off** (it is not
committed code).

**Subject** (`mailer_subjects_invite`): `You've been invited to E-Site`

**HTML body** (`mailer_templates_invite_content`) — uses Supabase template variables
`{{ .ConfirmationURL }}` (the accept link → `/auth/callback?next=/invite`) and `{{ .Token }}`
(the 6-digit code for the `/invite` page's code fallback):

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:40px 36px;">
        <tr><td style="padding-bottom:24px;">
          <span style="font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:-0.5px;">E-Site</span>
        </td></tr>
        <tr><td style="font-size:16px;color:#1a1a1a;line-height:1.6;padding-bottom:16px;">
          You've been invited to join <strong>E-Site</strong>.
        </td></tr>
        <tr><td style="font-size:15px;color:#444444;line-height:1.6;padding-bottom:32px;">
          Click below to accept your invitation and create your password:
        </td></tr>
        <tr><td style="padding-bottom:28px;">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#d97706;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:6px;">Accept invitation</a>
        </td></tr>
        <tr><td style="font-size:13px;color:#666666;line-height:1.6;padding-bottom:8px;">
          Or enter this 6-digit code on the invite page:
        </td></tr>
        <tr><td style="padding-bottom:32px;">
          <span style="font-family:monospace;font-size:24px;font-weight:700;letter-spacing:6px;color:#1a1a1a;">{{ .Token }}</span>
        </td></tr>
        <tr><td style="font-size:13px;color:#888888;line-height:1.5;border-top:1px solid #eeeeee;padding-top:24px;">
          If you weren't expecting this invitation, you can safely ignore this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
```

**How to apply:** `PATCH https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/config/auth`
with body `{ "mailer_subjects_invite": "...", "mailer_templates_invite_content": "..." }`,
authenticated with the Supabase Management API PAT (macOS keychain, service `Supabase CLI`).
Capture the current values first so the change is reversible.

**Note:** the feature works without this step — Supabase's default invite template is already a
genuine "you've been invited" email (not a password reset). This appendix is branding polish.
