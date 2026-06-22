# Phase 1 — Auth Email Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every Supabase auth email (signup, recovery, invite, magic-link, email-change) through one in-repo branded, org-co-branded template sent via Resend behind a Supabase **Send Email** auth hook, and ship a real role-/site-aware invite flow ending at a working `/accept-invite` → set-password page.

**Architecture:** A new Deno edge function `auth-email-hook` is registered as Supabase's `[auth.hook.send_email]`. Supabase calls it for *all* auth emails with a `standardwebhooks`-signed payload. The function verifies the signature, branches on `email_action_type`, builds the correct branded link, renders a new **light, org-co-branded** template, and sends through Resend. All the branchable, link-building, signature-verifying, and template-rendering logic lives in pure, runtime-agnostic modules under `_shared/auth-email/` so they are unit-testable with vitest; `index.ts` is a thin Deno wrapper. The invite triggers in the two server actions switch from `resetPasswordForEmail` to `auth.admin.inviteUserByEmail(..., { data, redirectTo })` so role/site context rides in user metadata. A new `/accept-invite` route consumes the invite token and lands on the existing set-password page. The dark `baseTemplate` in `send-email` is replaced by the new light template.

**Tech Stack:** Deno (Supabase edge runtime), Resend HTTP API, `standardwebhooks` HMAC-SHA256 verification (base64 secret), Next.js 15 App Router (web routes + server actions), `@supabase/supabase-js` admin API, Vitest (unit tests), Supabase CLI `config.toml`.

---

## Context the implementer needs (verified from code)

- **Org branding source.** `public.organisations` has `name`, `logo_url`, `report_accent_color` (migration `00001_initial_schema.sql:38-44`, `00117_report_export_branding.sql:29-30`). `logo_url` is a **storage path** inside the private `report-logos` bucket — reports download it to a `data:` URI via the service client (`apps/web/src/lib/reports/generator-report-data.ts:226-271`). Default accent is `#E69500` (`apps/web/src/lib/reports/theme.ts:3` `DEFAULT_ACCENT`).
- **Existing Resend pattern.** `apps/edge-functions/supabase/functions/_shared/email-sequence.ts` posts to `https://api.resend.com/emails` with `from`, `to`, `subject`, `html`; `FROM = Deno.env.get('RESEND_FROM') ?? 'E-Site <noreply@e-site.live>'`. A `baseTemplate()` + `escape()` already exist in `_shared/email-templates/base.ts` (dark palette — we are NOT reusing that one; this phase introduces a separate **light** template for auth + notification mail).
- **Current notification sender.** `apps/edge-functions/supabase/functions/send-email/index.ts` uses a dark inline `baseTemplate(content: string)` and contains an `invite` branch linking to `${SITE_URL}/onboarding/join?token=...` — that web route does **not exist** (spec §2). We retire that branch.
- **Current invite triggers (the lines to change):**
  - `apps/web/src/actions/users.actions.ts:103-105` — `service.auth.resetPasswordForEmail(email, { redirectTo: '/auth/callback?next=/reset-password/confirm' })`.
  - `apps/web/src/actions/sub-org-members.actions.ts:243-247` (single) and `:505-509` (bulk) — same `resetPasswordForEmail` call.
- **Supabase clients.** `apps/web/src/lib/supabase/server.ts`: `createClient()` (RLS, cookie-bound) and `createServiceClient()` (service-role, bypasses RLS). In Deno, `_shared/email-sequence.ts:57-62` shows the service-role client pattern (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
- **Auth callback / OTP.** `apps/web/src/app/(auth)/auth/callback/route.ts` already handles `verifyOtp({ token_hash, type })` for `signup | invite | magiclink | recovery | email_change | email` and PKCE `exchangeCodeForSession`. The reset flow (`reset-password/page.tsx`, `reset-password/confirm/page.tsx`) keeps an OTP-code fallback (`verifyOtp({ email, token, type:'recovery' })` → `updateUser({ password })`).
- **config.toml.** `apps/edge-functions/supabase/config.toml`: `[auth]` `site_url = "http://localhost:3000"`, `additional_redirect_urls = ["exp://localhost:8081"]`; `[auth.email]` `enable_confirmations = false`; **no** `[auth.hook]` block today.
- **Test runner.** `apps/web/vitest.config.ts` includes `src/**/*.test.{ts,tsx}` only (jsdom, globals). No edge-function test runner or `package.json` exists in `apps/edge-functions`, and Deno is not on PATH. **Decision:** the pure hook modules live under `_shared/auth-email/` and are tested by a new minimal vitest setup added to `apps/edge-functions` (Task 0); `index.ts` (the Deno wrapper) is not unit-tested. The `/accept-invite` route logic is tested under `apps/web` vitest.
- **Latest migration** is `00139_inspections_template_categories.sql`; the next number is **`00140`**. (Note: the user's memory mentions a `00140` for an inspection cert; if that has already landed by execution time, use the next free number and update the deploy checklist accordingly.)

---

## File structure

### Created

| Path | Responsibility |
|------|----------------|
| `apps/edge-functions/package.json` | Minimal workspace package so `turbo run test` and vitest run for edge-function pure modules. |
| `apps/edge-functions/vitest.config.ts` | Vitest config (node env) that resolves explicit `.ts` relative imports for the `_shared/auth-email` modules. |
| `apps/edge-functions/supabase/functions/_shared/auth-email/verify-signature.ts` | Pure `verifyHookSignature(payload, headers, secret)` — `standardwebhooks` HMAC-SHA256 over `${id}.${timestamp}.${body}`, base64 secret (strips `v1,whsec_` prefix), constant-time compare, timestamp tolerance. |
| `apps/edge-functions/supabase/functions/_shared/auth-email/build-email.ts` | Pure `buildAuthEmail(payload, opts)` — branches on `email_action_type`, builds the branded link + subject + body copy, returns `{ to, subject, html }`. |
| `apps/edge-functions/supabase/functions/_shared/auth-email/types.ts` | Shared TS types for the hook payload + branding input. |
| `apps/edge-functions/supabase/functions/_shared/email-templates/branded.ts` | NEW light, org-co-branded template `brandedTemplate(vars)` + re-exported `escape`. Replaces the dark templates for auth + notification mail. |
| `apps/edge-functions/supabase/functions/auth-email-hook/index.ts` | Thin Deno wrapper: verify signature → load org branding (service client) → `buildAuthEmail` → Resend send. |
| `apps/edge-functions/supabase/functions/_shared/auth-email/verify-signature.test.ts` | Unit tests for signature verification. |
| `apps/edge-functions/supabase/functions/_shared/auth-email/build-email.test.ts` | Unit tests for each `email_action_type` branch + branding + invite metadata. |
| `apps/edge-functions/supabase/functions/_shared/email-templates/branded.test.ts` | Unit tests for the branded template render (logo/accent/name, fallback link, expiry, footer). |
| `apps/web/src/app/(auth)/accept-invite/page.tsx` | Client page: consume `?token_hash=&type=invite` (or `?code=` PKCE), establish session, route to `/reset-password/confirm`; OTP-code fallback. |
| `apps/web/src/app/(auth)/accept-invite/accept-invite.ts` | Pure helper `resolveAcceptInviteAction(params)` returning a discriminated action (`verify_otp` / `exchange_code` / `error`) — unit-testable. |
| `apps/web/src/app/(auth)/accept-invite/accept-invite.test.ts` | Unit tests for the route's param resolution. |

### Modified

| Path | Change |
|------|--------|
| `apps/edge-functions/supabase/config.toml` | Add `[auth.hook.send_email]` block; add `/accept-invite` + `/reset-password/confirm` redirect URLs to `additional_redirect_urls`. |
| `apps/edge-functions/supabase/functions/send-email/index.ts` | Replace dark `baseTemplate` with the new light `brandedTemplate`; **delete** the broken `invite` branch (it is never called — confirmed spec §2). |
| `apps/web/src/actions/users.actions.ts` | `createUserAction`: swap `resetPasswordForEmail` → `inviteUserByEmail(email, { data: { invited_role, org_name, org_id, inviter_name }, redirectTo: '/accept-invite' })`. |
| `apps/web/src/actions/sub-org-members.actions.ts` | `addSubOrgMember` + `bulkInviteSubOrgMembers`: same swap, with sub-org name/id in `data`. |
| `apps/web/src/actions/users.actions.test.ts` *(create if absent)* | Assert invite uses `inviteUserByEmail` with role/org metadata. |
| `apps/web/src/actions/sub-org-members.actions.test.ts` | Update the existing invite assertions to `inviteUserByEmail`. |

---

## Task 0: Edge-function test harness

**Files:**
- Create: `apps/edge-functions/package.json`
- Create: `apps/edge-functions/vitest.config.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/edge-functions/supabase/functions/_shared/auth-email/types.ts`:

```ts
// Shape Supabase Send Email hook delivers (standardwebhooks JSON body).
export interface AuthHookPayload {
  user: { id: string; email: string; user_metadata?: Record<string, unknown> }
  email_data: {
    token: string
    token_hash: string
    redirect_to: string
    email_action_type: 'signup' | 'recovery' | 'invite' | 'magiclink' | 'email_change'
    site_url: string
    /** Present only for some flows; carried through when set. */
    token_new?: string
    token_hash_new?: string
  }
}

export interface OrgBranding {
  name: string
  /** data: URI or absolute URL; null falls back to platform branding. */
  logoSrc: string | null
  accent: string
}

export const DEFAULT_ACCENT = '#E69500'
export const PLATFORM_NAME = 'E-Site'
```

Create `apps/edge-functions/supabase/functions/_shared/auth-email/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_ACCENT, PLATFORM_NAME } from './types.ts'

describe('auth-email types module', () => {
  it('exposes the WM amber default accent and platform name', () => {
    expect(DEFAULT_ACCENT).toBe('#E69500')
    expect(PLATFORM_NAME).toBe('E-Site')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/edge-functions && npx vitest run supabase/functions/_shared/auth-email/types.test.ts`
Expected: FAIL — "Cannot find config" / "command not found vitest" (no `package.json`/config yet).

- [ ] **Step 3: Write minimal implementation**

Create `apps/edge-functions/package.json`:

```json
{
  "name": "@esite/edge-functions",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:ci": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
```

Create `apps/edge-functions/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

// Pure auth-email modules are runtime-agnostic TS and use explicit `.ts`
// relative imports (Deno style). Vitest resolves explicit `.ts` extensions
// natively, so no alias is required. index.ts (the Deno wrapper) imports
// from https://esm.sh/... and is intentionally excluded from unit tests.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['supabase/functions/**/*.test.ts'],
    exclude: ['**/index.ts', 'node_modules/**'],
  },
})
```

Then install: `cd apps/edge-functions && npm install`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/edge-functions && npx vitest run supabase/functions/_shared/auth-email/types.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/package.json apps/edge-functions/vitest.config.ts apps/edge-functions/supabase/functions/_shared/auth-email/types.ts apps/edge-functions/supabase/functions/_shared/auth-email/types.test.ts
git commit -m "test(edge): add vitest harness + auth-email types for the Send Email hook"
```

---

## Task 1: Hook signature verification (standardwebhooks)

**Files:**
- Create: `apps/edge-functions/supabase/functions/_shared/auth-email/verify-signature.ts`
- Test: `apps/edge-functions/supabase/functions/_shared/auth-email/verify-signature.test.ts`

Supabase signs Send Email hook requests with the `standardwebhooks` scheme: secret is `v1,whsec_<base64>`; the signature header `webhook-signature` is `v1,<base64(HMAC_SHA256(secret_bytes, "${id}.${timestamp}.${body}"))>` (space-separated list possible). Headers `webhook-id` and `webhook-timestamp` are signed alongside the body. We verify with the Web Crypto API (available in Deno *and* Node ≥ 20, so the same module runs in vitest).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { verifyHookSignature } from './verify-signature.ts'

// Build a valid signature the same way standardwebhooks does, so the test is
// self-contained (no Supabase round-trip needed).
async function sign(secretB64: string, id: string, ts: string, body: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(secretB64), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const data = new TextEncoder().encode(`${id}.${ts}.${body}`)
  const sig = await crypto.subtle.sign('HMAC', key, data)
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
  return `v1,${b64}`
}

const SECRET_B64 = btoa('super-secret-hook-key-32bytes!!') // raw secret bytes, base64
const FULL_SECRET = `v1,whsec_${SECRET_B64}`
const BODY = JSON.stringify({ hello: 'world' })
const ID = 'msg_123'
const TS = String(Math.floor(Date.now() / 1000))

describe('verifyHookSignature', () => {
  it('accepts a correctly signed payload', async () => {
    const sigHeader = await sign(SECRET_B64, ID, TS, BODY)
    const ok = await verifyHookSignature(BODY, {
      'webhook-id': ID, 'webhook-timestamp': TS, 'webhook-signature': sigHeader,
    }, FULL_SECRET)
    expect(ok).toBe(true)
  })

  it('rejects a tampered body', async () => {
    const sigHeader = await sign(SECRET_B64, ID, TS, BODY)
    const ok = await verifyHookSignature('{"hello":"evil"}', {
      'webhook-id': ID, 'webhook-timestamp': TS, 'webhook-signature': sigHeader,
    }, FULL_SECRET)
    expect(ok).toBe(false)
  })

  it('rejects a wrong secret', async () => {
    const sigHeader = await sign(SECRET_B64, ID, TS, BODY)
    const ok = await verifyHookSignature(BODY, {
      'webhook-id': ID, 'webhook-timestamp': TS, 'webhook-signature': sigHeader,
    }, `v1,whsec_${btoa('a-different-secret-key-32-bytes!!')}`)
    expect(ok).toBe(false)
  })

  it('rejects a stale timestamp (> 5 min skew)', async () => {
    const staleTs = String(Math.floor(Date.now() / 1000) - 60 * 10)
    const sigHeader = await sign(SECRET_B64, ID, staleTs, BODY)
    const ok = await verifyHookSignature(BODY, {
      'webhook-id': ID, 'webhook-timestamp': staleTs, 'webhook-signature': sigHeader,
    }, FULL_SECRET)
    expect(ok).toBe(false)
  })

  it('accepts when the header carries multiple space-separated signatures', async () => {
    const good = await sign(SECRET_B64, ID, TS, BODY)
    const header = `v1,AAAA ${good}`
    const ok = await verifyHookSignature(BODY, {
      'webhook-id': ID, 'webhook-timestamp': TS, 'webhook-signature': header,
    }, FULL_SECRET)
    expect(ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/edge-functions && npx vitest run supabase/functions/_shared/auth-email/verify-signature.test.ts`
Expected: FAIL with "Failed to resolve import './verify-signature.ts'".

- [ ] **Step 3: Write minimal implementation**

```ts
// standardwebhooks verification used by the Supabase Send Email auth hook.
// Secret format: "v1,whsec_<base64>". Signed content: `${id}.${timestamp}.${body}`.
// Header `webhook-signature` is a space-separated list of `v1,<base64sig>` entries.
// Runs on Web Crypto (Deno + Node >= 20), so it is unit-testable under vitest.

const FIVE_MIN = 60 * 5

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

function bytesToBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

/** Constant-time string compare to avoid signature timing leaks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyHookSignature(
  body: string,
  headers: Record<string, string | null | undefined>,
  secret: string,
  toleranceSeconds = FIVE_MIN,
  now: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const id = headers['webhook-id']
  const ts = headers['webhook-timestamp']
  const sigHeader = headers['webhook-signature']
  if (!id || !ts || !sigHeader) return false

  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > toleranceSeconds) return false

  // Strip the "v1,whsec_" wrapper; the remainder is the base64 raw secret.
  const rawSecretB64 = secret.replace(/^v1,whsec_/, '').replace(/^whsec_/, '')
  let keyBytes: Uint8Array
  try {
    keyBytes = base64ToBytes(rawSecretB64)
  } catch {
    return false
  }

  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signed = new TextEncoder().encode(`${id}.${ts}.${body}`)
  const expected = `v1,${bytesToBase64(await crypto.subtle.sign('HMAC', key, signed))}`

  // The header may list several signatures (key rotation). Accept any match.
  for (const candidate of sigHeader.split(' ')) {
    if (candidate && timingSafeEqual(candidate, expected)) return true
  }
  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/edge-functions && npx vitest run supabase/functions/_shared/auth-email/verify-signature.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/functions/_shared/auth-email/verify-signature.ts apps/edge-functions/supabase/functions/_shared/auth-email/verify-signature.test.ts
git commit -m "feat(edge): standardwebhooks signature verification for the Send Email hook"
```

---

## Task 2: Light org-co-branded template

**Files:**
- Create: `apps/edge-functions/supabase/functions/_shared/email-templates/branded.ts`
- Test: `apps/edge-functions/supabase/functions/_shared/email-templates/branded.test.ts`

Light layout per spec §6.2: org logo (or org wordmark when no logo) + "via E-Site", single CTA, expiry line, paste-able fallback link, footer. WM amber default `#E69500`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { brandedTemplate } from './branded.ts'

describe('brandedTemplate', () => {
  const base = {
    heading: 'Accept your invitation',
    bodyHtml: '<p>You were invited.</p>',
    ctaLabel: 'Accept invitation & set password',
    ctaHref: 'https://app.e-site.live/accept-invite?token_hash=abc&type=invite',
    expiryLabel: 'This link expires in 60 minutes.',
    fallbackLink: 'https://app.e-site.live/accept-invite?token_hash=abc&type=invite',
    org: { name: 'Watson Mattheus', logoSrc: 'data:image/png;base64,AAAA', accent: '#E69500' },
  }

  it('renders the org logo when present and the accent on the CTA', () => {
    const html = brandedTemplate(base)
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).toContain('#E69500')
    expect(html).toContain('via E-Site')
  })

  it('falls back to the org name as a wordmark when no logo', () => {
    const html = brandedTemplate({ ...base, org: { name: 'Bob Building', logoSrc: null, accent: '#123456' } })
    expect(html).toContain('Bob Building')
    expect(html).not.toContain('<img') // no logo image rendered
    expect(html).toContain('#123456')
  })

  it('renders CTA, expiry and a paste-able fallback link', () => {
    const html = brandedTemplate(base)
    expect(html).toContain('Accept invitation &amp; set password')
    expect(html).toContain('This link expires in 60 minutes.')
    // fallback link appears as visible, copyable text
    expect(html).toContain('https://app.e-site.live/accept-invite?token_hash=abc&amp;type=invite')
  })

  it('escapes org name to prevent HTML injection', () => {
    const html = brandedTemplate({ ...base, org: { name: '<script>x</script>', logoSrc: null, accent: '#E69500' } })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('uses platform-only header when org is null (account-level mail)', () => {
    const html = brandedTemplate({ ...base, org: null, ctaLabel: 'Reset password', ctaHref: 'x', fallbackLink: 'x' })
    expect(html).toContain('E-Site')
    expect(html).not.toContain('via E-Site') // no org → no co-brand line
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/edge-functions && npx vitest run supabase/functions/_shared/email-templates/branded.test.ts`
Expected: FAIL with "Failed to resolve import './branded.ts'".

- [ ] **Step 3: Write minimal implementation**

```ts
// Light, org-co-branded transactional template for auth + notification mail.
// Replaces the dark baseTemplate. Inline CSS only (email clients strip <style>).

import type { OrgBranding } from '../auth-email/types.ts'

export interface BrandedTemplateVars {
  heading: string
  bodyHtml: string            // inner HTML; keep inline. Caller pre-escapes user text.
  ctaLabel: string
  ctaHref: string
  /** e.g. "This link expires in 60 minutes." */
  expiryLabel?: string
  /** Paste-able fallback URL shown as visible text. */
  fallbackLink: string
  /** Org co-branding; null → platform-only (account-level mail). */
  org: OrgBranding | null
  siteUrl?: string
}

const PALETTE = {
  bg:       '#F4F5F7',
  card:     '#FFFFFF',
  border:   '#E2E5EA',
  text:     '#1A1F2B',
  textMid:  '#5B6472',
  textDim:  '#9AA2AF',
  ctaText:  '#FFFFFF',
}

export function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function brandedTemplate(v: BrandedTemplateVars): string {
  const siteUrl = v.siteUrl ?? 'https://app.e-site.live'
  const accent = v.org?.accent ?? '#E69500'

  // Header: org logo image OR org wordmark, with "via E-Site". Platform-only
  // when org is null.
  let header: string
  if (v.org) {
    const mark = v.org.logoSrc
      ? `<img src="${v.org.logoSrc}" alt="${escape(v.org.name)}" style="max-height:36px;max-width:180px;display:block">`
      : `<span style="font-size:18px;font-weight:700;color:${PALETTE.text}">${escape(v.org.name)}</span>`
    header = `${mark}<div style="margin-top:6px;font-size:11px;letter-spacing:0.08em;color:${PALETTE.textDim};text-transform:uppercase">via E-Site</div>`
  } else {
    header = `<span style="font-size:18px;font-weight:700;letter-spacing:0.04em;color:${accent}">E-Site</span>`
  }

  const expiry = v.expiryLabel
    ? `<p style="margin:20px 0 0;font-size:12px;color:${PALETTE.textDim}">${escape(v.expiryLabel)}</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(v.heading)}</title>
</head>
<body style="margin:0;padding:32px 16px;background:${PALETTE.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${PALETTE.text}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:480px;margin:0 auto">
  <tr><td style="padding:0 4px 20px">${header}</td></tr>
  <tr><td style="background:${PALETTE.card};border:1px solid ${PALETTE.border};border-radius:10px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:${PALETTE.text};line-height:1.3">${escape(v.heading)}</h1>
    <div style="font-size:14px;line-height:1.65;color:${PALETTE.textMid}">${v.bodyHtml}</div>
    <div style="margin-top:24px">
      <a href="${v.ctaHref}" style="display:inline-block;background:${accent};color:${PALETTE.ctaText};text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:700;font-size:14px">${escape(v.ctaLabel)}</a>
    </div>
    ${expiry}
    <p style="margin:20px 0 0;font-size:12px;color:${PALETTE.textDim};line-height:1.5">
      Button not working? Copy and paste this link into your browser:<br>
      <span style="color:${PALETTE.textMid};word-break:break-all">${escape(v.fallbackLink)}</span>
    </p>
  </td></tr>
  <tr><td style="padding:20px 4px 0;font-size:11px;color:${PALETTE.textDim};line-height:1.5">
    E-Site · Construction management for SA electrical contractors.<br>
    <a href="${siteUrl}" style="color:${PALETTE.textMid};text-decoration:underline">app.e-site.live</a>
  </td></tr>
</table>
</body>
</html>`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/edge-functions && npx vitest run supabase/functions/_shared/email-templates/branded.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/functions/_shared/email-templates/branded.ts apps/edge-functions/supabase/functions/_shared/email-templates/branded.test.ts
git commit -m "feat(edge): light org-co-branded email template (replaces dark baseTemplate)"
```

---

## Task 3: Action-type branching + link building

**Files:**
- Create: `apps/edge-functions/supabase/functions/_shared/auth-email/build-email.ts`
- Test: `apps/edge-functions/supabase/functions/_shared/auth-email/build-email.test.ts`

Per spec §6: invite → `${SITE_URL}/accept-invite?...`; recovery → `/reset-password/confirm`; signup → `/auth/callback?next=/onboarding` (confirm); magic-link → `/auth/callback`; email-change → `/auth/callback`. Each link carries `token_hash` + `type` (matching `auth/callback/route.ts`'s `verifyOtp` contract). Recovery + invite also surface the 6-digit `token` as the OTP-code fallback in the body copy.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildAuthEmail } from './build-email.ts'
import type { AuthHookPayload, OrgBranding } from './types.ts'

const SITE = 'https://app.e-site.live'
const ORG: OrgBranding = { name: 'Watson Mattheus', logoSrc: null, accent: '#E69500' }

function payload(overrides: Partial<AuthHookPayload['email_data']> & { metadata?: Record<string, unknown> }): AuthHookPayload {
  const { metadata, ...ed } = overrides
  return {
    user: { id: 'u-1', email: 'inv@example.com', user_metadata: metadata ?? {} },
    email_data: {
      token: '123456',
      token_hash: 'HASH',
      redirect_to: `${SITE}/dashboard`,
      email_action_type: 'recovery',
      site_url: SITE,
      ...ed,
    },
  }
}

describe('buildAuthEmail', () => {
  it('invite → /accept-invite link, role+site copy, OTP fallback, org-branded', () => {
    const out = buildAuthEmail(
      payload({
        email_action_type: 'invite',
        metadata: { invited_role: 'inspector', site_name: 'Kingswalk Mall', org_name: 'Watson Mattheus', inviter_name: 'Arno' },
      }),
      { siteUrl: SITE, org: ORG },
    )
    expect(out.to).toBe('inv@example.com')
    expect(out.subject).toMatch(/invited/i)
    expect(out.html).toContain(`${SITE}/accept-invite?token_hash=HASH&type=invite`)
    expect(out.html).toContain('inspector')
    expect(out.html).toContain('Kingswalk Mall')
    expect(out.html).toContain('123456')          // OTP-code fallback
    expect(out.html).toContain('via E-Site')       // org co-brand
  })

  it('recovery → /reset-password/confirm link + OTP code + 60-min expiry', () => {
    const out = buildAuthEmail(payload({ email_action_type: 'recovery' }), { siteUrl: SITE, org: null })
    expect(out.subject).toMatch(/reset/i)
    expect(out.html).toContain(`${SITE}/auth/callback?next=/reset-password/confirm&token_hash=HASH&type=recovery`)
    expect(out.html).toContain('123456')
    expect(out.html).toContain('60 minutes')
  })

  it('signup → confirm link via /auth/callback to onboarding', () => {
    const out = buildAuthEmail(payload({ email_action_type: 'signup' }), { siteUrl: SITE, org: null })
    expect(out.subject).toMatch(/confirm/i)
    expect(out.html).toContain(`${SITE}/auth/callback?next=/onboarding&token_hash=HASH&type=signup`)
  })

  it('magiclink → /auth/callback', () => {
    const out = buildAuthEmail(payload({ email_action_type: 'magiclink' }), { siteUrl: SITE, org: null })
    expect(out.html).toContain(`${SITE}/auth/callback?next=/dashboard&token_hash=HASH&type=magiclink`)
  })

  it('email_change → /auth/callback', () => {
    const out = buildAuthEmail(payload({ email_action_type: 'email_change' }), { siteUrl: SITE, org: null })
    expect(out.subject).toMatch(/email/i)
    expect(out.html).toContain(`${SITE}/auth/callback?next=/dashboard&token_hash=HASH&type=email_change`)
  })

  it('invite without metadata still renders a generic invite (no crash)', () => {
    const out = buildAuthEmail(payload({ email_action_type: 'invite' }), { siteUrl: SITE, org: ORG })
    expect(out.subject).toMatch(/invited/i)
    expect(out.html).toContain(`${SITE}/accept-invite?token_hash=HASH&type=invite`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/edge-functions && npx vitest run supabase/functions/_shared/auth-email/build-email.test.ts`
Expected: FAIL with "Failed to resolve import './build-email.ts'".

- [ ] **Step 3: Write minimal implementation**

```ts
import type { AuthHookPayload, OrgBranding } from './types.ts'
import { brandedTemplate, escape } from '../email-templates/branded.ts'

export interface BuildOpts {
  siteUrl: string
  /** Org co-branding for invites; null for account-level mail (reset/signup). */
  org: OrgBranding | null
}

export interface BuiltEmail {
  to: string
  subject: string
  html: string
}

function link(siteUrl: string, path: string, type: string, tokenHash: string): string {
  // /accept-invite consumes token directly; the others route through
  // /auth/callback which already handles verifyOtp({ token_hash, type }).
  if (path === '/accept-invite') {
    return `${siteUrl}/accept-invite?token_hash=${tokenHash}&type=${type}`
  }
  return `${siteUrl}${path}&token_hash=${tokenHash}&type=${type}`
}

export function buildAuthEmail(payload: AuthHookPayload, opts: BuildOpts): BuiltEmail {
  const { siteUrl, org } = opts
  const { token, token_hash, email_action_type } = payload.email_data
  const to = payload.user.email
  const meta = payload.user.user_metadata ?? {}

  const codeBlock = (label: string) => `
    <p style="margin:16px 0 0;font-size:13px;color:#5B6472">${label}</p>
    <p style="margin:6px 0 0;font-size:24px;font-weight:700;letter-spacing:6px;color:#1A1F2B">${escape(token)}</p>`

  switch (email_action_type) {
    case 'invite': {
      const role = typeof meta.invited_role === 'string' ? meta.invited_role : null
      const site = typeof meta.site_name === 'string' ? meta.site_name : null
      const orgName = (typeof meta.org_name === 'string' && meta.org_name) || org?.name || 'your team'
      const inviter = typeof meta.inviter_name === 'string' ? meta.inviter_name : null
      const ctaHref = link(siteUrl, '/accept-invite', 'invite', token_hash)
      const roleLine = role ? ` as a <strong>${escape(role)}</strong>` : ''
      const siteLine = site ? `, to review <strong>${escape(site)}</strong>` : ''
      const inviterLine = inviter ? `<strong>${escape(inviter)}</strong> invited you` : 'You have been invited'
      return {
        to,
        subject: `You've been invited to ${orgName === 'your team' ? 'E-Site' : orgName}`,
        html: brandedTemplate({
          org,
          heading: 'Accept your invitation',
          bodyHtml: `<p>${inviterLine} to join <strong>${escape(orgName)}</strong> on E-Site${roleLine}${siteLine}.</p>
            <p>Click below to accept and set your password.</p>
            ${codeBlock('Or use this one-time code on the set-password page:')}`,
          ctaLabel: 'Accept invitation & set password',
          ctaHref,
          expiryLabel: 'This invitation expires in 60 minutes.',
          fallbackLink: ctaHref,
          siteUrl,
        }),
      }
    }
    case 'recovery': {
      const ctaHref = link(siteUrl, '/auth/callback?next=/reset-password/confirm', 'recovery', token_hash)
      return {
        to,
        subject: 'Reset your password',
        html: brandedTemplate({
          org,
          heading: 'Reset your password',
          bodyHtml: `<p>We received a request to reset your E-Site password. Click below to choose a new one.</p>
            ${codeBlock('Or enter this one-time code on the set-password page:')}`,
          ctaLabel: 'Reset password',
          ctaHref,
          expiryLabel: 'This link and code expire in 60 minutes.',
          fallbackLink: ctaHref,
          siteUrl,
        }),
      }
    }
    case 'signup': {
      const ctaHref = link(siteUrl, '/auth/callback?next=/onboarding', 'signup', token_hash)
      return {
        to,
        subject: 'Confirm your E-Site account',
        html: brandedTemplate({
          org,
          heading: 'Confirm your account',
          bodyHtml: `<p>Welcome to E-Site. Confirm your email to activate your account.</p>`,
          ctaLabel: 'Confirm account',
          ctaHref,
          expiryLabel: 'This link expires in 60 minutes.',
          fallbackLink: ctaHref,
          siteUrl,
        }),
      }
    }
    case 'magiclink': {
      const ctaHref = link(siteUrl, '/auth/callback?next=/dashboard', 'magiclink', token_hash)
      return {
        to,
        subject: 'Your E-Site sign-in link',
        html: brandedTemplate({
          org,
          heading: 'Sign in to E-Site',
          bodyHtml: `<p>Click below to sign in. This link is single-use.</p>`,
          ctaLabel: 'Sign in',
          ctaHref,
          expiryLabel: 'This link expires in 60 minutes.',
          fallbackLink: ctaHref,
          siteUrl,
        }),
      }
    }
    case 'email_change': {
      const ctaHref = link(siteUrl, '/auth/callback?next=/dashboard', 'email_change', token_hash)
      return {
        to,
        subject: 'Confirm your new email address',
        html: brandedTemplate({
          org,
          heading: 'Confirm your new email',
          bodyHtml: `<p>Confirm this address to finish changing your E-Site email.</p>`,
          ctaLabel: 'Confirm new email',
          ctaHref,
          expiryLabel: 'This link expires in 60 minutes.',
          fallbackLink: ctaHref,
          siteUrl,
        }),
      }
    }
    default: {
      // Exhaustiveness guard — unknown action types fail loud rather than send junk.
      throw new Error(`Unsupported email_action_type: ${String(email_action_type)}`)
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/edge-functions && npx vitest run supabase/functions/_shared/auth-email/build-email.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/functions/_shared/auth-email/build-email.ts apps/edge-functions/supabase/functions/_shared/auth-email/build-email.test.ts
git commit -m "feat(edge): branch auth emails by action type, build branded links + OTP fallback"
```

---

## Task 4: The Deno hook wrapper

**Files:**
- Create: `apps/edge-functions/supabase/functions/auth-email-hook/index.ts`

This is the only Deno-specific file. It is excluded from vitest (Task 0 config). It wires: read raw body → verify signature → parse → resolve org branding for invites (service client, downloads `logo_url` from `report-logos` to a `data:` URI, reads `report_accent_color`) → `buildAuthEmail` → Resend send. It returns `{}` 200 on success (Supabase requires a 2xx with empty/`{}` body) and a `{ error: { http_code, message } }` shape on failure.

- [ ] **Step 1: Write the wrapper** (no separate unit test — pure logic is covered by Tasks 1-3; verification is the live test-invite in the deploy checklist)

```ts
/**
 * Edge Function: auth-email-hook  (Supabase "Send Email" auth hook)
 *
 * Registered via config.toml [auth.hook.send_email]. Supabase POSTs a
 * standardwebhooks-signed payload for EVERY auth email. We verify the
 * signature, branch on email_action_type, render the branded template, and
 * send through Resend. Returning 2xx tells Supabase the mail was handled
 * (it then suppresses its own built-in email).
 *
 * Pure logic (verify / branch / link / template) lives in ../_shared/auth-email/*
 * and ../_shared/email-templates/branded.ts and is unit-tested with vitest.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyHookSignature } from '../_shared/auth-email/verify-signature.ts'
import { buildAuthEmail } from '../_shared/auth-email/build-email.ts'
import type { AuthHookPayload, OrgBranding } from '../_shared/auth-email/types.ts'
import { DEFAULT_ACCENT } from '../_shared/auth-email/types.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = Deno.env.get('RESEND_FROM') ?? 'E-Site <noreply@e-site.live>'
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://app.e-site.live'
const HOOK_SECRET = Deno.env.get('SEND_EMAIL_HOOK_SECRET') ?? ''
const LOGO_BUCKET = 'report-logos'

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

/** Download an org logo storage path to a data: URI; null on any failure. */
async function logoDataUri(supabase: ReturnType<typeof serviceClient>, path: string | null): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabase.storage.from(LOGO_BUCKET).download(path)
  if (error || !data) return null
  const buf = new Uint8Array(await data.arrayBuffer())
  let bin = ''
  for (const b of buf) bin += String.fromCharCode(b)
  const mime = (data as Blob).type || 'image/png'
  return `data:${mime};base64,${btoa(bin)}`
}

/**
 * Resolve org branding for an invite. We get the org id from invite metadata
 * (`org_id`). Account-level mail (reset/signup) passes org=null → platform brand.
 */
async function resolveOrgBranding(
  supabase: ReturnType<typeof serviceClient>,
  payload: AuthHookPayload,
): Promise<OrgBranding | null> {
  if (payload.email_data.email_action_type !== 'invite') return null
  const orgId = payload.user.user_metadata?.org_id
  if (typeof orgId !== 'string' || !orgId) return null

  const { data } = await supabase
    .from('organisations')
    .select('name, logo_url, report_accent_color')
    .eq('id', orgId)
    .maybeSingle()
  if (!data) return null

  const logoSrc = await logoDataUri(supabase, (data as { logo_url: string | null }).logo_url)
  return {
    name: (data as { name: string | null }).name ?? 'Your organisation',
    logoSrc,
    accent: (data as { report_accent_color: string | null }).report_accent_color ?? DEFAULT_ACCENT,
  }
}

async function resendSend(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { http_code: 405, message: 'Method not allowed' } }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Must read the RAW body for signature verification — re-stringifying changes bytes.
  const rawBody = await req.text()
  const headers = {
    'webhook-id': req.headers.get('webhook-id'),
    'webhook-timestamp': req.headers.get('webhook-timestamp'),
    'webhook-signature': req.headers.get('webhook-signature'),
  }

  const valid = await verifyHookSignature(rawBody, headers, HOOK_SECRET)
  if (!valid) {
    return new Response(JSON.stringify({ error: { http_code: 401, message: 'Invalid signature' } }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  let payload: AuthHookPayload
  try {
    payload = JSON.parse(rawBody) as AuthHookPayload
  } catch {
    return new Response(JSON.stringify({ error: { http_code: 400, message: 'Bad JSON' } }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabase = serviceClient()
    const org = await resolveOrgBranding(supabase, payload)
    const { to, subject, html } = buildAuthEmail(payload, { siteUrl: SITE_URL, org })
    await resendSend(to, subject, html)
    // Empty 2xx tells Supabase the email was delivered; it sends nothing itself.
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('auth-email-hook error:', err)
    return new Response(
      JSON.stringify({ error: { http_code: 500, message: err instanceof Error ? err.message : 'send failed' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
```

- [ ] **Step 2: Type-check the pure imports compile**

Run: `cd apps/edge-functions && npx vitest run supabase/functions/_shared/auth-email/`
Expected: PASS (all `_shared/auth-email` tests green — confirms `index.ts`'s imported modules resolve and export the names used).

- [ ] **Step 3: Commit**

```bash
git add apps/edge-functions/supabase/functions/auth-email-hook/index.ts
git commit -m "feat(edge): auth-email-hook Deno wrapper — verify, brand, send via Resend"
```

---

## Task 5: config.toml — register the hook + redirect allowlist

**Files:**
- Modify: `apps/edge-functions/supabase/config.toml`

- [ ] **Step 1: Add the redirect URLs and hook block**

Replace the `additional_redirect_urls` line (line 32) with:

```toml
additional_redirect_urls = [
  "exp://localhost:8081",
  "http://localhost:3000/accept-invite",
  "http://localhost:3000/reset-password/confirm",
  "http://localhost:3000/auth/callback",
]
```

After the `[auth.email]` block (after line 41 `enable_confirmations = false`), add:

```toml

# Send Email auth hook — routes ALL auth emails (signup, recovery, invite,
# magiclink, email_change) through the auth-email-hook edge function, which
# renders the branded template and sends via Resend. The secret is read from
# the env var SEND_EMAIL_HOOK_SECRET (set in .env for local; Supabase dashboard
# in prod — see the deploy checklist). PRODUCTION uses HOSTED Supabase, so this
# block governs LOCAL behaviour only; prod is configured in the dashboard.
[auth.hook.send_email]
enabled = true
uri = "http://host.docker.internal:54321/functions/v1/auth-email-hook"
secrets = "env(SEND_EMAIL_HOOK_SECRET)"
```

- [ ] **Step 2: Validate config parses (local Supabase)**

Run: `cd apps/edge-functions && supabase start` (or `supabase stop && supabase start` if already running)
Expected: Supabase boots with no config-parse error; `auth` container logs show the send_email hook registered.

> If Supabase is not running locally in the execution environment, skip the boot and instead confirm the TOML is syntactically valid: `cd apps/edge-functions && supabase config --help` returns without a parse error referencing config.toml. Note the limitation in the PR description.

- [ ] **Step 3: Commit**

```bash
git add apps/edge-functions/supabase/config.toml
git commit -m "chore(supabase): register send_email auth hook + accept-invite redirect allowlist"
```

---

## Task 6: Repoint send-email to the branded template; retire broken invite

**Files:**
- Modify: `apps/edge-functions/supabase/functions/send-email/index.ts`

- [ ] **Step 1: Replace the dark `baseTemplate` import/definition with the branded one**

Delete the local `baseTemplate(content: string)` function (lines 40-48) and replace each `baseTemplate(...)` call site with a `brandedTemplate(...)` call. Add at the top of the file (after the existing constants):

```ts
import { brandedTemplate } from '../_shared/email-templates/branded.ts'
```

Convert the `rfi-assigned` branch to the branded template (apply the same pattern to `snag-assigned`, `data-subject-request`, `coc-status`):

```ts
    else if (type === 'rfi-assigned') {
      const { to, assigneeName, rfiSubject, projectName, rfiId, raisedByName, dueDate } = payload
      const link = `${SITE_URL}/rfis/${rfiId}`
      await sendEmail({
        to,
        subject: `RFI assigned: ${rfiSubject}`,
        html: brandedTemplate({
          org: null,
          heading: 'RFI assigned to you',
          bodyHtml: `<p>Hi ${assigneeName},</p>
            <p><strong>${raisedByName}</strong> assigned you an RFI on <strong>${projectName}</strong>.</p>
            <p><strong>Subject:</strong> ${rfiSubject}${dueDate ? `<br><strong>Due:</strong> ${dueDate}` : ''}</p>`,
          ctaLabel: 'View RFI',
          ctaHref: link,
          fallbackLink: link,
          siteUrl: SITE_URL,
        }),
      })
    }
```

> Apply the identical `brandedTemplate({ org: null, heading, bodyHtml, ctaLabel, ctaHref, fallbackLink, siteUrl: SITE_URL })` conversion to the `snag-assigned`, `data-subject-request`, and `coc-status` branches, preserving each branch's existing copy, subject, and link. `data-subject-request` has no CTA link in the original — give it `ctaLabel: 'Open admin'`, `ctaHref: SITE_URL`, `fallbackLink: SITE_URL`.

- [ ] **Step 2: Delete the broken `invite` branch**

Remove the entire `if (type === 'invite') { ... }` block (lines 86-100), including its `/onboarding/join` link. Update the file's top-of-file doc comment to drop `invite` from the supported types list. Invites are now handled exclusively by `auth-email-hook` via `inviteUserByEmail` (Task 7).

- [ ] **Step 3: Verify the file still parses and the branded import resolves**

Run: `cd apps/edge-functions && npx vitest run supabase/functions/_shared/email-templates/branded.test.ts`
Expected: PASS (the template module that `send-email` now imports is green).

> There is no unit test for `send-email/index.ts` itself (it is a Deno wrapper, excluded from vitest like `auth-email-hook`). Correctness of the conversion is covered by the branded template tests + manual smoke in the deploy checklist.

- [ ] **Step 4: Commit**

```bash
git add apps/edge-functions/supabase/functions/send-email/index.ts
git commit -m "refactor(edge): send-email uses branded template; remove dead /onboarding/join invite"
```

---

## Task 7: Role-/site-aware invite triggers (inviteUserByEmail)

**Files:**
- Modify: `apps/web/src/actions/users.actions.ts:101-109`
- Test: `apps/web/src/actions/users.actions.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/actions/users.actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getOrgContextMock, isOrgAdminMock, createServiceClientMock, rateLimitMock, revalidatePathMock } = vi.hoisted(() => ({
  getOrgContextMock: vi.fn(),
  isOrgAdminMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  rateLimitMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/lib/auth-org', () => ({ getOrgContext: getOrgContextMock, isOrgAdmin: isOrgAdminMock }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: createServiceClientMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rateLimitMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }))
vi.mock('next/headers', () => ({ headers: () => ({ get: () => null }) }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual, logAuthEvent: vi.fn().mockResolvedValue(undefined) }
})

const ORG_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const NEW_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.e-site.live'
  getOrgContextMock.mockResolvedValue({ userId: USER_ID, organisationId: ORG_ID, role: 'admin', orgName: 'Watson Mattheus' })
  isOrgAdminMock.mockReturnValue(true)
  rateLimitMock.mockReturnValue(true)
})

describe('createUserAction invite', () => {
  it('invites via inviteUserByEmail with role/org metadata and redirectTo=/accept-invite', async () => {
    const inviteUserByEmail = vi.fn().mockResolvedValue({ data: { user: { id: NEW_ID } }, error: null })
    const insert = vi.fn().mockResolvedValue({ error: null })
    createServiceClientMock.mockReturnValue({
      auth: { admin: { inviteUserByEmail, deleteUser: vi.fn() } },
      from: vi.fn().mockReturnValue({ insert }),
    })

    const { createUserAction } = await import('./users.actions')
    const res = await createUserAction({ email: 'New@Example.com', fullName: 'New Person', role: 'inspector' })

    expect(res.ok).toBe(true)
    expect(inviteUserByEmail).toHaveBeenCalledWith(
      'new@example.com',
      expect.objectContaining({
        data: expect.objectContaining({ invited_role: 'inspector', org_id: ORG_ID, full_name: 'New Person' }),
        redirectTo: 'https://app.e-site.live/accept-invite',
      }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/actions/users.actions.test.ts`
Expected: FAIL — `createUserAction` currently calls `createUser` + `resetPasswordForEmail`, so `inviteUserByEmail` is never called.

- [ ] **Step 3: Replace the create+reset flow with inviteUserByEmail**

In `apps/web/src/actions/users.actions.ts`, replace the block that creates the auth user (lines 66-84) AND the set-password email block (lines 101-109) with a single invite call. The membership insert (lines 86-99) stays, keyed off the invited user's id. New flow:

```ts
  const service = createServiceClient()

  // 1. Invite the user — provisions the auth row (no password) AND triggers the
  //    Supabase Send Email hook, which renders the branded role-aware invite.
  //    Role/org/site context rides in `data` (user_metadata) for the hook.
  const { data: invited, error: inviteErr } = await service.auth.admin.inviteUserByEmail(email, {
    data: {
      full_name:    fullName,
      invited_role: role,
      org_id:       ctx.organisationId,
      org_name:     ctx.orgName ?? null,
      inviter_name: ctx.userName ?? null,
    },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite`,
  })
  if (inviteErr || !invited?.user) {
    const msg = inviteErr?.message ?? 'Could not invite the user.'
    return {
      ok: false,
      error: /already|exist|registered/i.test(msg)
        ? 'A user with that email already exists.'
        : msg,
    }
  }
  const newUserId = invited.user.id

  // 2. Add the org membership (handle_new_user already created public.profiles).
  const { error: memberErr } = await service.from('user_organisations').insert({
    user_id:         newUserId,
    organisation_id: ctx.organisationId,
    role,
    is_active:       true,
    invited_by:      ctx.userId,
    accepted_at:     new Date().toISOString(),
  })
  if (memberErr) {
    await service.auth.admin.deleteUser(newUserId).catch(() => {})
    return { ok: false, error: `Could not add the user to your organisation: ${memberErr.message}` }
  }

  // 3. Audit.
  await logAuthEvent(service, {
    userId:    newUserId,
    eventType: 'user_created',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { created_by: ctx.userId, organisation_id: ctx.organisationId, role, via: 'invite' },
  })

  revalidatePath('/settings/users')
  return { ok: true }
```

> `ctx.orgName` / `ctx.userName`: if `getOrgContext()` does not currently expose these, pass `null` (the hook already falls back to the org row's `name` for `org_name` and omits the inviter line when absent). Do NOT add fields to `getOrgContext` in this task — keep the change surgical. If the type complains, use `(ctx as { orgName?: string }).orgName ?? null`.

Since `inviteUserByEmail` replaces both the create and the reset-email calls, the `warning` return path (the "email could not be sent" branch) is removed. The function's `ActionResult` type already allows `{ ok: true }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/actions/users.actions.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/users.actions.ts apps/web/src/actions/users.actions.test.ts
git commit -m "feat(web): createUserAction invites via inviteUserByEmail with role/org metadata"
```

---

## Task 8: Sub-org invite triggers (single + bulk)

**Files:**
- Modify: `apps/web/src/actions/sub-org-members.actions.ts:242-247` (single) and `:504-509` (bulk)
- Test: `apps/web/src/actions/sub-org-members.actions.test.ts` (update existing)

- [ ] **Step 1: Update the failing test expectations**

In `apps/web/src/actions/sub-org-members.actions.test.ts`, the happy-path tests currently mock `resetPasswordForEmail`. Add an `inviteUserByEmail` mock to each service-client mock and assert it is called. In the `addSubOrgMember` "provisions a new user" test (around line 196), change the service mock to use `inviteUserByEmail` instead of `createUser`, and add this assertion after the result check:

```ts
    expect(inviteUserByEmail).toHaveBeenCalledWith(
      'mike@example.com',
      expect.objectContaining({
        data: expect.objectContaining({ invited_role: 'contractor', org_id: PARENT_ORG_ID, sub_organisation_id: SUB_ORG_ID }),
        redirectTo: expect.stringContaining('/accept-invite'),
      }),
    )
```

Define `const inviteUserByEmail = vi.fn().mockResolvedValueOnce({ data: { user: { id: newUserId } }, error: null })` and put it under `auth.admin` in that test's `createServiceClientMock`. Remove the now-unused `createUser`/`resetPasswordForEmail` mocks from the happy paths. The email-collision test keeps `inviteUserByEmail` returning an "already registered" error, then the existing profiles look-up path.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/actions/sub-org-members.actions.test.ts`
Expected: FAIL — `inviteUserByEmail` not called (action still uses `createUser` + `resetPasswordForEmail`).

- [ ] **Step 3: Swap both call sites to inviteUserByEmail**

In `addSubOrgMember`, replace the `createUser` call (lines 194-198) and the `resetPasswordForEmail` block (lines 242-247) with a single invite, mirroring Task 7. The membership insert + collision fallback stay. New provisioning block:

```ts
  // 3. Invite the user — provisions auth + fires the branded role-aware hook.
  let newUserId: string
  let createdHere = false

  const { data: invited, error: inviteErr } = await service.auth.admin.inviteUserByEmail(email, {
    data: {
      full_name:           fullName,
      invited_role:        role,
      org_id:              subOrg.parent_organisation_id,
      sub_organisation_id: subOrgId,
      inviter_name:        null,
    },
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite`,
  })

  if (inviteErr || !invited?.user) {
    const msg = inviteErr?.message ?? ''
    if (/already|exist|registered/i.test(msg)) {
      const { data: existing } = await (service as any)
        .from('profiles').select('id').eq('email', email).maybeSingle()
      if (!existing?.id) {
        return { ok: false, error: 'A user with that email already exists but could not be found.' }
      }
      newUserId = existing.id
    } else {
      return { ok: false, error: msg || 'Could not invite the user.' }
    }
  } else {
    newUserId = invited.user.id
    createdHere = true
  }
```

Then in the membership-insert rollback, replace `if (created?.user)` with `if (createdHere)`. Delete the standalone `resetPasswordForEmail` block (lines 242-247) entirely.

In `bulkInviteSubOrgMembers`, apply the same swap at lines 452-457 (`createUser` → `inviteUserByEmail`) and delete the `resetPasswordForEmail` block (lines 504-509). Carry the same `data` payload (`full_name: email.split('@')[0]`, `invited_role: role`, `org_id: subOrg.parent_organisation_id`, `sub_organisation_id: parsed.data.subOrgId`). Replace `if (!isExisting && created?.user)` in the rollback with a local `createdHere` flag set the same way.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/actions/sub-org-members.actions.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/sub-org-members.actions.ts apps/web/src/actions/sub-org-members.actions.test.ts
git commit -m "feat(web): sub-org invites (single+bulk) use inviteUserByEmail with role/site metadata"
```

---

## Task 9: /accept-invite param resolver (pure)

**Files:**
- Create: `apps/web/src/app/(auth)/accept-invite/accept-invite.ts`
- Test: `apps/web/src/app/(auth)/accept-invite/accept-invite.test.ts`

The page can arrive three ways: OTP (`?token_hash=&type=invite`), PKCE (`?code=`), or an error bounce (`?error_code=`). A pure resolver keeps the branching testable.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { resolveAcceptInvite } from './accept-invite'

describe('resolveAcceptInvite', () => {
  it('PKCE code → exchange_code', () => {
    const r = resolveAcceptInvite(new URLSearchParams('code=PKCE123'))
    expect(r).toEqual({ kind: 'exchange_code', code: 'PKCE123' })
  })

  it('OTP token_hash + type=invite → verify_otp', () => {
    const r = resolveAcceptInvite(new URLSearchParams('token_hash=HASH&type=invite'))
    expect(r).toEqual({ kind: 'verify_otp', tokenHash: 'HASH', type: 'invite' })
  })

  it('legacy ?token alias is accepted as token_hash', () => {
    const r = resolveAcceptInvite(new URLSearchParams('token=HASH&type=invite'))
    expect(r).toEqual({ kind: 'verify_otp', tokenHash: 'HASH', type: 'invite' })
  })

  it('error_code bounce → error', () => {
    const r = resolveAcceptInvite(new URLSearchParams('error_code=otp_expired'))
    expect(r).toEqual({ kind: 'error', code: 'otp_expired' })
  })

  it('nothing usable → error invalid_link', () => {
    const r = resolveAcceptInvite(new URLSearchParams(''))
    expect(r).toEqual({ kind: 'error', code: 'invalid_link' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run "src/app/(auth)/accept-invite/accept-invite.test.ts"`
Expected: FAIL with "Failed to resolve import './accept-invite'".

- [ ] **Step 3: Write minimal implementation**

```ts
import type { EmailOtpType } from '@supabase/supabase-js'

export type AcceptInviteAction =
  | { kind: 'exchange_code'; code: string }
  | { kind: 'verify_otp'; tokenHash: string; type: EmailOtpType }
  | { kind: 'error'; code: string }

export function resolveAcceptInvite(params: URLSearchParams): AcceptInviteAction {
  const errorCode = params.get('error_code')
  if (errorCode) return { kind: 'error', code: errorCode }

  const code = params.get('code')
  if (code) return { kind: 'exchange_code', code }

  const tokenHash = params.get('token_hash') ?? params.get('token')
  const type = (params.get('type') ?? 'invite') as EmailOtpType
  if (tokenHash) return { kind: 'verify_otp', tokenHash, type }

  return { kind: 'error', code: 'invalid_link' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run "src/app/(auth)/accept-invite/accept-invite.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(auth)/accept-invite/accept-invite.ts" "apps/web/src/app/(auth)/accept-invite/accept-invite.test.ts"
git commit -m "feat(web): pure resolver for /accept-invite token/code/error branching"
```

---

## Task 10: /accept-invite page

**Files:**
- Create: `apps/web/src/app/(auth)/accept-invite/page.tsx`

Consume the invite, establish a session, route to `/reset-password/confirm` (the shared set-password page — already works for any active session per `reset-password/confirm/page.tsx:47-54`). On error, surface the same OTP-code fallback used by reset, pointed at `type:'invite'`.

- [ ] **Step 1: Write the page** (logic covered by Task 9's pure resolver tests; the page is a thin client wrapper, verified live in the deploy checklist)

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveAcceptInvite } from './accept-invite'

export const dynamic = 'force-dynamic'

type Status = 'working' | 'code' | 'error'

/**
 * Accept-invitation landing. Consumes the invite token (OTP token_hash or PKCE
 * code) to establish a session, then forwards to /reset-password/confirm where
 * the invited user sets their first password. If the link was burned by an
 * email scanner, we fall back to the 6-digit OTP code from the same email.
 */
export default function AcceptInvitePage() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<Status>('working')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function run() {
      const action = resolveAcceptInvite(new URLSearchParams(searchParams?.toString() ?? ''))
      if (action.kind === 'error') {
        if (!cancelled) {
          setServerError(`This invitation link could not be used (${action.code}). Enter the 6-digit code from your email.`)
          setStatus('code')
        }
        return
      }
      if (action.kind === 'exchange_code') {
        const { error } = await supabase.auth.exchangeCodeForSession(action.code)
        if (cancelled) return
        if (error) { setServerError(error.message); setStatus('code'); return }
        router.replace('/reset-password/confirm')
        return
      }
      // verify_otp
      const { error } = await supabase.auth.verifyOtp({ token_hash: action.tokenHash, type: action.type })
      if (cancelled) return
      if (error) {
        setServerError('Your invitation link has expired or was already used. Enter the 6-digit code from your email.')
        setStatus('code')
        return
      }
      router.replace('/reset-password/confirm')
    }
    void run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (!/^\S+@\S+\.\S+$/.test(email)) { setServerError('Enter the email this invitation was sent to.'); return }
    if (code.length !== 6) { setServerError('Enter the 6-digit code from your email.'); return }
    setVerifying(true)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: 'invite' })
    setVerifying(false)
    if (error) { setServerError(error.message); setCode(''); return }
    router.replace('/reset-password/confirm')
  }

  if (status === 'working') {
    return (
      <div className="auth-card auth-success">
        <div className="auth-success-icon">⏳</div>
        <h2>Accepting your invitation…</h2>
        <p>One moment.</p>
      </div>
    )
  }

  return (
    <div className="auth-card">
      <h2 className="auth-card-title">Accept your invitation</h2>
      <p className="auth-card-sub">Enter the email this invite was sent to and the 6-digit code.</p>

      <form onSubmit={onVerifyCode}>
        {serverError && <div className="auth-alert-error">{serverError}</div>}

        <div className="auth-field">
          <label className="auth-label">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.co.za"
            className="auth-input"
            autoComplete="email"
            autoFocus
          />
        </div>

        <div className="auth-field">
          <label className="auth-label">6-digit code</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            className="auth-input"
            style={{ fontSize: 22, letterSpacing: 6, textAlign: 'center' }}
          />
        </div>

        <button type="submit" disabled={verifying || code.length !== 6} className="auth-btn">
          {verifying ? 'Verifying…' : 'Continue →'}
        </button>
      </form>

      <div className="auth-links">
        <Link href="/login" className="auth-link">← Back to sign in</Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the build compiles (route picked up)**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: No type errors referencing `accept-invite`.

> If `tsc --noEmit` is too slow/noisy in the environment, instead run `cd apps/web && npx vitest run "src/app/(auth)/accept-invite/"` to confirm the resolver import the page depends on is green, and note the full build runs in CI.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(auth)/accept-invite/page.tsx"
git commit -m "feat(web): /accept-invite page — consume invite token, OTP fallback, route to set-password"
```

---

## Task 11: Full regression run

**Files:** none (verification only)

- [ ] **Step 1: Run the edge-function suite**

Run: `cd apps/edge-functions && npx vitest run`
Expected: PASS — `types`, `verify-signature` (5), `build-email` (6), `branded` (5).

- [ ] **Step 2: Run the affected web suites**

Run: `cd apps/web && npx vitest run src/actions/users.actions.test.ts src/actions/sub-org-members.actions.test.ts "src/app/(auth)/accept-invite/accept-invite.test.ts"`
Expected: PASS — no regressions in the invite actions; accept-invite resolver green.

- [ ] **Step 3: Commit (only if any incidental fixes were needed)**

```bash
git add -A
git commit -m "test: green Phase-1 email lifecycle suites (edge + web)"
```

---

## Production deploy checklist

> **Production runs HOSTED Supabase.** The `[auth.hook.send_email]` block in `config.toml` governs LOCAL only. Steps marked **(owner)** must be done by the project owner in the Supabase dashboard / management API — they cannot be performed from code.

1. **Merge the PR to `main`.** No DB migration is required for Phase 1 (no schema change — invites reuse `auth.users` + `user_organisations`). If a migration is added later for an `org_invites`/grant table (spec §6.3, deferred to Phase 2), bump from `00140` (or the next free number) and record the ledger row per the repo's migration convention.
2. **Deploy the edge functions.** From `apps/edge-functions`:
   `supabase functions deploy auth-email-hook --project-ref <PROD_REF>`
   `supabase functions deploy send-email --project-ref <PROD_REF>` (re-deploy: now imports the branded template).
3. **(owner) Set function secrets** in the Supabase dashboard → Edge Functions → Secrets (or `supabase secrets set --project-ref <PROD_REF> KEY=VALUE`):
   - `RESEND_API_KEY` (existing — confirm present)
   - `RESEND_FROM` = `E-Site <noreply@e-site.live>` (optional; falls back)
   - `SITE_URL` = `https://app.e-site.live`
   - `SEND_EMAIL_HOOK_SECRET` = the standardwebhooks secret (next step generates it)
4. **(owner) Enable the Send Email hook** in dashboard → Authentication → Hooks → **Send Email** → enable → URI = the deployed `auth-email-hook` function URL (`https://<PROD_REF>.supabase.co/functions/v1/auth-email-hook`). The dashboard generates the signing secret (`v1,whsec_…`) — copy it into `SEND_EMAIL_HOOK_SECRET` (step 3). The values **must match**.
5. **(owner) Add redirect URLs** in dashboard → Authentication → URL Configuration → Redirect URLs: `https://app.e-site.live/accept-invite`, `https://app.e-site.live/reset-password/confirm`, `https://app.e-site.live/auth/callback`.
6. **(owner) Confirm `NEXT_PUBLIC_APP_URL`** in the web app's host (Vercel/hosting) env = `https://app.e-site.live`, so `redirectTo` in the invite actions is correct.
7. **Verify the hook fires (live test invite):**
   - As an org admin, add a user via Settings → Users (or sub-org roster) with a real inbox you control, role e.g. `inspector`.
   - Confirm the inbox receives a **light, org-co-branded** email titled "Accept your invitation" with the org logo/name + "via E-Site", the role + site copy, a single CTA, a 60-min expiry line, a paste-able fallback link, and a 6-digit code.
   - Click the CTA → lands on `/accept-invite` → forwards to `/reset-password/confirm` → set a password → land in the app.
   - Burn-the-link check: open the same email's CTA from an environment that pre-fetches links (or simply visit the CTA twice); the second attempt should land on `/accept-invite` in code-entry mode and the 6-digit code must complete the flow.
   - Trigger a password reset for the same user → confirm a branded "Reset your password" email (platform-branded, no org co-brand) with code + link; both paths reach `/reset-password/confirm`.
8. **Verify Supabase no longer double-sends:** confirm the inbox gets exactly ONE email per action (the hook's Resend mail), not also Supabase's default template.
9. **Resend dashboard check:** confirm the sends appear under the Resend account with `from: noreply@e-site.live` and no bounces.

---

## Self-review against spec §6

- **§6.1 unify on Resend via auth hook, all auth emails, all member types** → Tasks 1-5 (hook fn + signature + branch + config). Covered.
- **§6.1 account-level mail platform-branded; invites org-co-branded** → `buildAuthEmail` passes `org: null` for recovery/signup/magiclink/email_change and resolves org branding only for invites (Task 3 + Task 4 `resolveOrgBranding`). Covered.
- **§6.2 light layout: org logo+accent+name, "via E-Site", single CTA, expiry, fallback link, footer** → `brandedTemplate` (Task 2) with tests asserting each element; WM amber `#E69500` default. Covered.
- **§6.2 invite role-+site-aware copy** → Task 3 invite branch renders role + site from metadata; Tasks 7-8 supply that metadata via `inviteUserByEmail({ data })`. Covered.
- **§6.2 reset = button + fallback code, 60 min** → Task 3 recovery branch (code block + "60 minutes" expiry). Covered.
- **§6.2 set-password page works for invite + recovery incl OTP fallback** → Task 10 routes both to `/reset-password/confirm`; accept-invite has its own OTP-code fallback (`type:'invite'`); reset keeps its existing fallback. Covered.
- **§6.2 signup confirmation same template, platform-branded** → Task 3 signup branch, `org: null`. Covered. (Note: `config.toml` has `enable_confirmations=false` today; the hook still renders confirmations correctly if/when confirmations are enabled — see Risk 4.)
- **§6.3 real invite (not reset reuse) → /accept-invite → set password → portal** → Tasks 7-10. Covered.
- **§6.3 retire the unused infrastructure / broken `/onboarding/join`** → Task 6 deletes the dead `invite` branch in `send-email`. Covered. (The `org_invites` *table* swap to a real grant record is spec §6.3's deeper item; this phase removes the broken email path and uses `inviteUserByEmail`'s native invite — the dedicated grant table is Phase-2/Phase-0 territory per §10. Flagged as Risk 5.)
- **§6.3 keep reset OTP-code-first resilience** → untouched reset flow + Task 3 still emits the code. Covered.
- **D10 (unify on Resend via auth hook, all invites) / D11 (org-co-branded light)** → whole plan. Covered.

Placeholder scan: no TBD/TODO; every code step is complete. Type consistency: `OrgBranding`, `AuthHookPayload`, `buildAuthEmail`, `brandedTemplate`, `verifyHookSignature`, `resolveAcceptInvite` names are consistent across tasks and tests.

---

## Risks & ambiguities for the human to resolve

1. **Cross-runtime testing (decision taken).** Edge functions are Deno but Deno isn't on PATH and no edge test runner exists. I put all testable logic in runtime-agnostic `_shared/auth-email/*` modules tested by a *new* vitest setup in `apps/edge-functions` (Task 0), leaving `index.ts` (Deno-only, imports `https://esm.sh/...`) untested except via the live deploy-checklist invite. Confirm you're happy adding `vitest` as a dev dep to `apps/edge-functions`. Alternative: a Deno test task if you later add Deno to CI.
2. **standardwebhooks header/secret format.** I implemented Supabase's documented scheme: secret `v1,whsec_<base64>`, signed content `${id}.${timestamp}.${body}`, header `webhook-signature` = space-separated `v1,<b64>`. If your Supabase version emits a different header set, the live test-invite (checklist step 7) will fail closed (401) and the verify module's tolerance/parse may need a tweak — it is isolated and unit-tested, so adjusting is cheap.
3. **`getOrgContext` may not expose `orgName`/`userName`.** Task 7 passes them best-effort (`null` fallback); the hook backfills `org_name` from the org row. If you want the inviter's name in invites, extend `getOrgContext` in a *separate* change — I deliberately kept this surgical.
4. **`enable_confirmations=false` today.** Signup currently does NOT send a confirmation email, so the hook's `signup` branch won't fire until confirmations are turned on. The branch is implemented per spec §6.2 ("signup confirmation — same template") so it's correct whenever you enable it. Decide whether Phase 1 also flips `enable_confirmations=true`; the spec implies signup confirmation is in scope but the current config disables it. **Flagging — not changed in this plan.**
5. **Native invite vs `org_invites`/grant record.** Spec §6.3 wants "a real invite/grant record … instead of the unused infrastructure." This plan uses Supabase's native `inviteUserByEmail` (which provisions `auth.users` + fires the hook) plus the existing `user_organisations` membership row — it removes the *broken* path but does not introduce a new `org_invites` row. Per §10, the dedicated grant table is Phase-0/Phase-2 work (client→site grants). Confirm that native invite + `user_organisations` is acceptable for Phase 1, or tell me to add an `org_invites` migration here.
6. **Hosted-Supabase hook config is owner-only.** Checklist steps 3-6 cannot be automated from this repo. The hook will silently not fire until the dashboard hook + secret are set, so the live test-invite (step 7) is the real gate — schedule it with the owner.
7. **`data:`-URI logos in email.** Some inbox clients block/clip large inline images. Org logos go in `report-logos` (≤5 MiB). If deliverability/rendering suffers, switch to a signed public URL for the logo instead of a data URI — localized to `resolveOrgBranding` in `index.ts`.
