# Invite Flow Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the recovery-flow `createUserAction` with a proper invitation flow — a
branded invite email + create-password page for new users, in-app acceptance for existing
users.

**Architecture:** Supabase-native `inviteUserByEmail` for new emails; pending
`user_organisations` rows + in-app acceptance for existing emails. No DB migration
(`accepted_at IS NULL` = pending). Web-only acceptance.

**Tech Stack:** Next.js 15 App Router, Supabase Auth (GoTrue), Resend (transactional email),
TypeScript, Zod, react-hook-form.

**Design spec:** `docs/2026-05-21-invite-flow-design.md` — read it first.

**Conventions observed:**
- Server actions return `{ ok: true; warning? } | { ok: false; error }`.
- `getOrgContext()` → `{ userId, organisationId, role }` or null; `isOrgAdmin(role)` → owner/admin.
- `createClient()` (SSR) and `createServiceClient()` (service-role) from `@/lib/supabase/server`.
- Each task ends with `pnpm --filter web type-check` clean (no NEW errors beyond the
  documented pre-existing ones in onboarding/supplier/paystack/project.service) and a commit.

---

## Task 1: Membership-state helper

**Files:**
- Create: `apps/web/src/lib/membership.ts`
- Test: `apps/web/src/lib/membership.test.ts`

A pure classifier used by the Users page and the actions.

- [ ] **Step 1 — failing test.** `membership.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { membershipState } from './membership'

describe('membershipState', () => {
  it('new-user invite (active, unaccepted) is pending', () => {
    expect(membershipState({ is_active: true, accepted_at: null })).toBe('pending')
  })
  it('existing-user invite (inactive, unaccepted) is pending', () => {
    expect(membershipState({ is_active: false, accepted_at: null })).toBe('pending')
  })
  it('accepted + active is active', () => {
    expect(membershipState({ is_active: true, accepted_at: '2026-05-21T00:00:00Z' })).toBe('active')
  })
  it('accepted + inactive is deactivated', () => {
    expect(membershipState({ is_active: false, accepted_at: '2026-05-21T00:00:00Z' })).toBe('deactivated')
  })
})
```

- [ ] **Step 2 — run, expect FAIL.** `pnpm --filter web test -- membership` → fails (module missing).
- [ ] **Step 3 — implement** `membership.ts`:

```ts
export type MembershipState = 'pending' | 'active' | 'deactivated'

/** Classify a user_organisations row. accepted_at IS NULL == pending invite. */
export function membershipState(row: { is_active: boolean; accepted_at: string | null }): MembershipState {
  if (row.accepted_at == null) return 'pending'
  return row.is_active ? 'active' : 'deactivated'
}
```

- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit:** `feat(invite): membership-state helper`.

---

## Task 2: Org-invite transactional email helper

**Files:**
- Create: `apps/web/src/lib/emails/org-invite-email.ts`

The Path-B "you've been invited to join [org]" email (existing users — no token, they accept
in-app). Direct Resend API call; `RESEND_API_KEY` / `RESEND_FROM` are already set on Vercel.

- [ ] **Step 1 — implement.** `sendOrgInviteEmail({ to, orgName, inviterName }): Promise<{ ok: boolean; error?: string }>`:
  - `POST https://api.resend.com/emails` with `Authorization: Bearer ${process.env.RESEND_API_KEY}`,
    `from: process.env.RESEND_FROM`, `to`, subject `You've been invited to join ${orgName} on E-Site`.
  - HTML body: short message — "[inviterName] invited you to join [orgName] on E-Site.
    Log in to accept the invitation:" + a button/link to `${process.env.NEXT_PUBLIC_SITE_URL}/login`.
  - Wrap in try/catch; never throw; return `{ ok: false, error }` on any failure or non-2xx.
- [ ] **Step 2 — typecheck** `pnpm --filter web type-check` → no new errors.
- [ ] **Step 3 — commit:** `feat(invite): transactional org-invite email helper`.

No unit test — external API call, verified in the smoke walkthrough.

---

## Task 3: `inviteUserAction` — rewrite `createUserAction`

**Files:**
- Modify: `apps/web/src/actions/users.actions.ts`

Rename `createUserAction` → `inviteUserAction`; keep the owner/admin gate, rate limit, Zod
schema (`email`, `fullName`, `role`), and the `owner`-blocked-at-creation rule.

- [ ] **Step 1 — detect existing account.** After validation, query `profiles` by email via
  the service-role client: `service.from('profiles').select('id').eq('email', email).maybeSingle()`.
- [ ] **Step 2 — Path A (no profile row):**
  - `service.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName, invited_to_org: ctx.organisationId, invited_role: role }, redirectTo: \`${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/invite\` })`.
  - If it errors and the message matches `/already|registered|exists/i` → fall through to Path B.
  - On success: insert `user_organisations` `{ user_id: created.user.id, organisation_id: ctx.organisationId, role, is_active: true, accepted_at: null, invited_by: ctx.userId }`.
  - If the membership insert fails → `service.auth.admin.deleteUser(created.user.id)` rollback, return error.
- [ ] **Step 3 — Path B (profile exists):** the profile `id` is the user id.
  - Look up any existing `user_organisations` row for `(that user_id, ctx.organisationId)`.
  - If found and `accepted_at` set and `is_active` → `{ ok: false, error: 'That person is already a member of your organisation.' }`.
  - If found and `accepted_at IS NULL` → `{ ok: false, error: 'That person already has a pending invitation — use Resend.' }`.
  - If found and `accepted_at` set and not `is_active` → `{ ok: false, error: 'That person was deactivated — reactivate them from the members list instead.' }`.
  - Else insert pending row `{ user_id, organisation_id, role, is_active: false, accepted_at: null, invited_by: ctx.userId }`, then `sendOrgInviteEmail({ to: email, orgName, inviterName })` (look up `orgName` from `organisations`, `inviterName` from the caller's profile). If the email send returns `!ok`, still return `{ ok: true, warning: 'Invited, but the notification email could not be sent.' }`.
- [ ] **Step 4 — audit + revalidate.** Keep `logAuthEvent` `user_created`; `revalidatePath('/settings/users')`.
- [ ] **Step 5 — typecheck** clean.
- [ ] **Step 6 — commit:** `feat(invite): inviteUserAction — Supabase invite for new users, pending membership for existing`.

---

## Task 4: Invitee-side actions — `invitations.actions.ts`

**Files:**
- Create: `apps/web/src/actions/invitations.actions.ts`

All actions are `'use server'`. Use `createClient()` to identify the caller (`getUser()`) and
`createServiceClient()` for the privileged read/write.

- [ ] **Step 1 — `listPendingInvitationsForCurrentUser()`** — `getUser()`; service-role select
  from `user_organisations` where `user_id = uid AND accepted_at IS NULL`, embedding
  `organisations(name)` and the inviter `profiles!invited_by(full_name)`. Return
  `{ membershipId, organisationId, orgName, role, invitedByName }[]`.
- [ ] **Step 2 — `acceptOrgInvitationAction({ membershipId })`** — `getUser()`; service-role
  fetch the row by id; verify `row.user_id === uid` and `row.accepted_at == null` (else
  `{ ok: false, error: 'This invitation is no longer available.' }`); UPDATE
  `{ is_active: true, accepted_at: new Date().toISOString() }`; `logAuthEvent` `user_updated`
  with `metadata.action: 'invitation_accepted'`; `revalidatePath('/dashboard')`.
- [ ] **Step 3 — `declineOrgInvitationAction({ membershipId })`** — same ownership + pending
  check; service-role DELETE the row; `logAuthEvent` `user_updated`
  `metadata.action: 'invitation_declined'`; `revalidatePath('/dashboard')`.
- [ ] **Step 4 — `completeInviteAction({ password })`** — for the new-user `/invite` page.
  `getUser()` (must have a session from the invite token, else error). Validate the password
  with the existing `apps/web/src/lib/password-strength.ts` helpers (score ≥ 2, not pwned).
  `service.auth.admin.updateUserById(uid, { password })`. Stamp `accepted_at = now()` on the
  user's pending `user_organisations` row(s) (`user_id = uid AND accepted_at IS NULL`).
  `logAuthEvent` `password_changed` + `user_updated`. Return `{ ok: true }`.
- [ ] **Step 5 — typecheck** clean.
- [ ] **Step 6 — commit:** `feat(invite): invitee-side actions (accept / decline / complete / list)`.

---

## Task 5: `/invite` accept page + middleware

**Files:**
- Create: `apps/web/src/app/(auth)/invite/page.tsx`
- Modify: `apps/web/src/middleware.ts`

- [ ] **Step 1 — `/invite/page.tsx`.** Client component, `export const dynamic = 'force-dynamic'`.
  Model on `apps/web/src/app/(auth)/reset-password/confirm/page.tsx`:
  - `Status = 'checking' | 'ready' | 'invalid' | 'updated'`; `getSession()` on mount.
  - `ready`: heading "Welcome to E-Site — create your password"; password form using
    `PasswordStrengthMeter`; on submit call `completeInviteAction({ password })`; on success →
    `router.push('/dashboard')`.
  - `invalid`: "This invite link has expired or was already used." + a button revealing the
    code fallback.
  - **Code fallback:** email + 6-digit code inputs → `supabase.auth.verifyOtp({ email, token, type: 'invite' })`; on success set status to `ready`. Mirrors the `/reset-password` `?step=code` pattern.
- [ ] **Step 2 — middleware.** In `apps/web/src/middleware.ts`, the step-2 check that
  redirects an authenticated user off auth pages excludes `/auth/*`, `/reset-password*`,
  `/inspection*`. Add `/invite` to that exclusion so an authenticated invitee can stay on it.
- [ ] **Step 3 — typecheck** clean.
- [ ] **Step 4 — commit:** `feat(invite): /invite accept page + middleware allowance`.

---

## Task 6: `PendingInvitations` card + dashboard wiring

**Files:**
- Create: `apps/web/src/components/PendingInvitations.tsx`
- Modify: `apps/web/src/app/(admin)/dashboard/page.tsx`

- [ ] **Step 1 — `PendingInvitations.tsx`.** Client component. Props: the array from
  `listPendingInvitationsForCurrentUser()`. For each entry render a card row "[orgName]
  invited you to join as [role]" + Accept / Decline buttons (`Button` component, `useTransition`).
  Accept → `acceptOrgInvitationAction`; Decline → `declineOrgInvitationAction`; both
  `router.refresh()` on success, surface errors inline. Render nothing when the array is empty.
- [ ] **Step 2 — dashboard.** In `dashboard/page.tsx` (RSC), call
  `listPendingInvitationsForCurrentUser()` and render `<PendingInvitations invitations={...} />`
  at the top of the page, above the existing cards.
- [ ] **Step 3 — typecheck** clean.
- [ ] **Step 4 — commit:** `feat(invite): pending-invitation card on the dashboard`.

---

## Task 7: Users page — pending badge, resend, invite copy

**Files:**
- Modify: `apps/web/src/app/(admin)/settings/users/page.tsx`
- Modify: `apps/web/src/app/(admin)/settings/users/UserRowActions.tsx`
- Modify: `apps/web/src/app/(admin)/settings/users/AddUserForm.tsx`
- Modify: `apps/web/src/actions/users.actions.ts`

- [ ] **Step 1 — `page.tsx`.** Add `accepted_at` to the `user_organisations` select and to
  the `MemberRow` interface. Render a `badge badge-amber` "pending" chip when
  `membershipState({ is_active, accepted_at }) === 'pending'` (import the Task 1 helper).
  Pass a `pending` boolean to `UserRowActions`.
- [ ] **Step 2 — `UserRowActions.tsx`.** When `pending`, show a "Resend invite" button
  (`Button variant="secondary" size="sm"`) that calls `resendInviteAction({ userId })` with
  `useTransition`; show a transient "Invite sent." confirmation on success.
- [ ] **Step 3 — `AddUserForm.tsx`.** Update copy: panel/button "Invite user" / "Send invite";
  success message "Invitation sent to {email}". Call `inviteUserAction` (renamed in Task 3).
- [ ] **Step 4 — `resendInviteAction`** in `users.actions.ts`. Owner/admin-gated, rate-limited.
  Look up the membership + auth user. If the membership is pending and the auth user has never
  signed in (new-user invite): re-issue via
  `service.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: \`${SITE_URL}/auth/callback?next=/invite\` } })` and send the resulting link with `sendOrgInviteEmail`-style branded mail.
  If the membership is pending and the user HAS an account (existing-user invite): re-send via
  `sendOrgInviteEmail`. If not pending → `{ ok: false, error: 'That member has already accepted.' }`.
- [ ] **Step 5 — typecheck** clean.
- [ ] **Step 6 — commit:** `feat(invite): users page pending badge + resend + invite copy`.

---

## Task 8: Supabase "Invite user" email template

**Files:** none — Supabase Auth config via the Management API.

- [ ] **Step 1 — customise the invite template.** PATCH the project's auth config
  (`mailer_templates_invite_content` + `mailer_subjects_invite`) via
  `https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/config/auth`, using the
  Management API PAT (macOS keychain, service `Supabase CLI` — see CLAUDE.md ops notes).
  Subject: "You've been invited to E-Site". Body: branded HTML showing `{{ .ConfirmationURL }}`
  as the primary button and `{{ .Token }}` as a 6-digit code fallback (mirrors the recovery
  template per `auth-execution-spec.md` §12).
- [ ] **Step 2 — record** the final template HTML in `docs/2026-05-21-invite-flow-design.md`
  (an appendix) so it is version-controlled.
- [ ] **Step 3 — commit:** `chore(invite): document the customised Supabase invite email template`.

---

## Closing verification

- [ ] `pnpm --filter web type-check` — clean (no new errors).
- [ ] `pnpm --filter web test` — the `membershipState` test passes.
- [ ] **Smoke walkthrough** (per the design spec §10): Path A new email → branded invite email
  → link → `/invite` → set password → dashboard; Path A via the 6-digit code; Path B existing
  email → notification email → login → pending card → Accept; Decline; Resend on both; the
  two main errors (already-member, already-pending).
- [ ] Final commit if the walkthrough surfaced fixes.
