# Auth & Supabase Pitfalls Playbook

A portable catalogue of mistakes to avoid when building authentication and
Supabase-backed data access on a **Supabase + Next.js (App Router) + Resend**
stack. Every entry here was a real, costly bug — distilled so the next app can
skip the lesson instead of re-learning it.

This file is deliberately **app-agnostic**. Drop it into any new project's
`docs/` and work the pre-flight checklist before writing auth code.

---

## Pre-flight checklist

Do these on day one. Each item links to the numbered pitfall that explains why.

**Before you ship any email-based auth:**
- [ ] Email templates expose a **6-digit OTP code** (`{{ .Token }}`), not just a magic link — #1
- [ ] All five email-delivery layers verified end-to-end: DNS, sender domain, SMTP password, redirect allowlist, app deploy — #2
- [ ] SMTP config PATCHed as a **complete object**, never `smtp_pass` alone — #3
- [ ] `Site URL` + `uri_allow_list` include every callback path plus preview/mobile variants — #4

**Every time you add a table:**
- [ ] RLS enabled, with SELECT/INSERT/UPDATE/DELETE policies — and SELECT scoped by **role**, not just tenant — #10
- [ ] Membership lookups go through a `SECURITY DEFINER` helper, never an inline subquery on the same table — #11

**Every time you add a storage bucket:**
- [ ] SELECT **and** INSERT **and** DELETE policies on `storage.objects`, in the same migration that creates the bucket — #8

**Every time a migration creates or drops a schema:**
- [ ] PATCH the PostgREST `db_schema` config via the Management API in the same change — #7

**Every time you add an API route or edge function:**
- [ ] Bearer-auth API routes are on the middleware bypass allowlist — #13
- [ ] Edge functions deployed with `--verify-jwt` (the default) — #18
- [ ] Pages that read cookies/`searchParams` or fire a load-time action are `force-dynamic` — #14

---

## Email & auth-link delivery

### 1. Corporate email scanners burn single-use auth links

**Symptom:** Password-reset and magic-link emails work for personal inboxes but
fail for corporate ones. The user clicks the link and lands back on `/login`
with `error_code=otp_expired` — even though they clicked within seconds.

**Root cause:** Microsoft Defender for Office 365, Mimecast, Proofpoint and
similar gateways **pre-fetch every URL in an email** to scan it for phishing.
Supabase's PKCE recovery codes and magic-link tokens are **single-use** — the
scanner's GET consumes the token before the human ever clicks.

**Fix:** Don't rely on link-based auth alone. Use a **6-digit OTP code** as the
primary path. In the Supabase email templates, render `{{ .Token }}`
prominently in a code box and keep `{{ .ConfirmationURL }}` only as a fallback.
In the app, accept the typed code via `verifyOtp({ type, token, email })`.

**Rule:** Any link-based auth flow (recovery, magic link, email change, invite)
must also offer a typed-code path. Treat the link as a convenience, not the
mechanism.

### 2. Email delivery is a five-layer chain — any one breaks it silently

**Symptom:** "We enabled custom SMTP, why don't reset emails arrive?" No error
anywhere; the email just never lands.

**Root cause:** For one auth email to reach an inbox, **all five** of these must
be correct, and a break in any layer fails silently:
1. **DNS** — DKIM + SPF records published for the sending domain
2. **Sender domain** — verified at the email provider (e.g. Resend)
3. **SMTP credentials** — the provider API key set as the Supabase Auth SMTP password
4. **Redirect allowlist** — `Site URL` + `uri_allow_list` accept the callback URL
5. **App + deploy** — the code calls the right method and is actually deployed

**Fix:** Verify each layer independently, bottom-up. Don't declare email auth
"done" until a real end-to-end send lands in a real inbox.

**Rule:** Keep a five-layer checklist in the repo. When email "doesn't work,"
walk the layers in order — don't guess.

### 3. PATCHing `smtp_pass` alone wipes the whole SMTP block

**Symptom:** You rotate the email API key, PATCH the Supabase Auth config with
just the new password — and now **all** auth email stops. A config readback
shows `smtp_host`, `smtp_user`, `smtp_admin_email` are all `null`.

**Root cause:** The Management API treats the SMTP settings as one object.
PATCHing a partial object **replaces** it — the omitted fields become null.

**Fix:** Always PATCH the **complete** SMTP object — host, port, user, pass,
admin_email, sender_name — even when only the password changed. Read the config
back afterwards to confirm.

**Rule:** Mutate provider config objects whole, never field-by-field. Verify
with a readback.

### 4. Stale Site URL / redirect allowlist bounces links to the wrong host

**Symptom:** Reset/confirm links open on a stale domain (an old deploy alias, or
production when you're on a preview branch), then 404 or fail the code exchange.

**Root cause:** `Site URL` is interpolated into `{{ .ConfirmationURL }}`;
`uri_allow_list` gates which `redirectTo` values are accepted. Both drift as
domains change.

**Fix:** Keep them current. The allowlist should include `/auth/callback`,
`/auth/callback?next=*`, the password-confirm route, a `/**` entry for staging,
preview-deploy wildcards (`https://*.vercel.app/**`), and any mobile deep-link
scheme (`exp://`, `yourapp://`).

**Rule:** Treat `Site URL` + allowlist as deploy-critical config. Re-check them
on every domain change.

### 5. "Resend code" silently invalidates the code the user already has

**Symptom:** The user has a valid OTP, clicks "resend" to be safe, then the
original code (which they then type) is rejected.

**Root cause:** Re-calling `resetPasswordForEmail` / `signInWithOtp` issues a
**new** code and invalidates the prior one. `verifyOtp` is also single-use.

**Fix:** Give the UI an explicit "I already have a code →" path that jumps
straight to code entry **without** re-sending. Only the dedicated "resend"
button re-fires the send.

**Rule:** Separate "send me a code" from "I have a code" in the UI. Never
auto-resend on the verify screen.

---

## RLS & PostgREST

### 6. Cross-schema writes via supabase-js silently drop the service-role header

**Symptom:** A trusted server route uses the service-role client to INSERT into
a non-`public` schema and gets `new row violates row-level security policy`.
Confusingly, a **SELECT** through the same `.schema()` call works fine.

**Root cause:** `supabase.schema('xyz').from('t').insert(...)` does not carry
the service-role `Authorization` header through on writes — the request falls
back to the anon role, and RLS denies it.

**Fix:** For cross-schema writes from a trusted server context, bypass
supabase-js: raw `fetch()` to `/rest/v1/<table>` with header
`Content-Profile: <schema>`, and the service-role key as **both** `apikey` and
`Authorization: Bearer`.

**Rule:** If a `.schema(...).insert/update/delete()` fails RLS but the matching
SELECT works, suspect the stripped header. Use raw PostgREST for cross-schema
writes.

### 7. Creating or dropping a schema strands PostgREST in a cache loop

**Symptom:** A migration runs fine, then the whole REST API returns
`PGRST002 — Could not query the database for the schema cache. Retrying.` for
30+ minutes. The database is healthy; only PostgREST is stuck.

**Root cause:** PostgREST serves a fixed list of schemas (its `db_schema`
config). A migration that runs `CREATE SCHEMA` or `DROP SCHEMA` makes that list
wrong — it references a now-gone schema and/or omits the new one — and PostgREST
cannot rebuild its cache.

**Fix:** In the **same change** as the migration, PATCH the project's PostgREST
`db_schema` config via the Management API to the new schema list. Recovery is
~8 seconds after the PATCH. The CLI does not expose this setting — Management
API only.

**Rule:** "Migration touches a schema" ⇒ "PATCH PostgREST config." Pair them
every time.

### 8. Storage-bucket RLS is separate from table RLS

**Symptom:** File uploads fail with `new row violates row-level security
policy`, even though your app table's policies are correct.

**Root cause:** An upload writes a row to `storage.objects`, which has **its
own** RLS. Scaffolding a bucket with only a SELECT policy leaves INSERT/DELETE
at default-deny — uploads fail at the storage layer, before any app-table code
runs.

**Fix:** Every new bucket gets **SELECT + INSERT + DELETE** policies on
`storage.objects`, written in the same migration that creates the bucket.
(A service-role-only bucket is the exception — leave INSERT closed
deliberately, and document why.)

**Rule:** A bucket is not "created" until its read/write policies exist. Treat
them as part of the bucket definition.

### 9. "Same error message" does not mean "same bug"

**Symptom:** You chase an RLS failure on table A, the fix doesn't work — because
the error was actually coming from table B.

**Root cause:** PostgREST emits the **identical** string `new row violates
row-level security policy` regardless of which table failed. `storage.objects`
and an app table produce byte-identical errors.

**Fix:** Before theorising, trace **which exact statement** throws. Add the
table name to your own error context. Verify the layer cheapest-first.

**Rule:** Identical error text ≠ identical cause. Identify the failing statement
before proposing a fix.

### 10. Org-wide SELECT policies that forget to check role leak across scope

**Symptom:** A user who should see only one project (a read-only role assigned
to a single project) can read **every** project, document, and record in the
whole organisation.

**Root cause:** The SELECT policies checked **tenant membership** but not
**role**. A project-scoped role still satisfies "is a member of the org," so
org-wide policies hand them everything.

**Fix:** Make SELECT policies role-aware. Add a `SECURITY DEFINER` helper (e.g.
`user_is_client_viewer(org)`), and for project-scoped roles narrow the policy to
rows reachable through a `project_members` join. Block such roles entirely from
schemas that have no per-project link.

**Rule:** Tenancy and authorisation are two separate checks. A SELECT policy
that only checks tenancy is a leak waiting to happen.

### 11. RLS policies that query their own table cause infinite recursion

**Symptom:** `infinite recursion detected in policy for relation "..."`.
Queries that touch a membership table fail outright.

**Root cause:** A policy on table X contains a subquery against table X (or a
mutually-referencing pair) — evaluating the policy re-triggers the policy.

**Fix:** Move the membership lookup into a `SECURITY DEFINER` function (e.g.
`get_user_org_ids()`) that runs with the owner's rights and bypasses RLS.
Policies call the function instead of sub-querying.

**Rule:** Never reference a table inside its own RLS policy. Route every
cross-table membership check through a `SECURITY DEFINER` helper.

### 12. PostgREST cannot embed-join across schemas (PGRST200)

**Symptom:** A foreign-table embed such as `profiles!created_by(full_name)`
returns `PGRST200` and null data — when the two tables sit in different schemas.

**Root cause:** PostgREST's embedded-resource resolver does not follow foreign
keys across schema boundaries.

**Fix:** Select the raw FK UUIDs, then run a single batched second query against
the other schema (`... in (<uuids>)`) and join in application code.

**Rule:** Cross-schema joins are app-side. Don't reach for embed shorthand
across a schema boundary.

---

## Next.js (App Router) & Vercel

### 13. Cookie-session middleware hijacks Bearer-auth API routes

**Symptom:** An API route that authenticates with `Authorization: Bearer`
returns `307` redirects to `/login` instead of `401`/`403`. If the caller
swallows errors, the feature **silently does nothing** — possibly for weeks.

**Root cause:** Auth middleware runs on every non-static path. For a cookieless
request it redirects to `/login` **before** the route's own Bearer-JWT check
ever executes.

**Fix:** Keep an explicit allowlist (`SELF_AUTH_PATHS`) of routes that do their
own auth, and `return NextResponse.next()` for them at the very top of the
middleware — skipping the cookie-session lookup entirely.

**Rule:** Middleware and route-level auth must not both fire on the same
request. Any route that authenticates itself must be exempt from session
middleware.

### 14. `force-dynamic` vs. static caching — load-time logic runs only once

**Symptom:** A page that should re-run server logic per request (or fire a
server action on load) appears to "work once" then go stale — the same cached
HTML serves forever.

**Root cause:** Next.js statically renders and caches the route at build time.
Server logic — including a side-effecting action invoked during render — runs
once, at build.

**Fix:** `export const dynamic = 'force-dynamic'` on the page (or the
route-group `layout.tsx`) for anything that reads cookies/headers/`searchParams`
or triggers a load-time action.

**Rule:** If a page must reflect per-request state, it must be dynamic. Don't
let auth or side-effecting pages be statically prerendered.

### 15. `useSearchParams()` forces a page out of static prerender

**Symptom:** Build fails with `useSearchParams() should be wrapped in a suspense
boundary`.

**Root cause:** In the App Router, a component reading `useSearchParams()`
cannot be statically prerendered unless it sits inside a `<Suspense>` boundary.

**Fix:** Either wrap the consumer in `<Suspense>`, or mark the route group
`force-dynamic` (auth pages gain nothing from static prerender — they all read
per-request state anyway).

**Rule:** `useSearchParams` ⇒ Suspense boundary or `force-dynamic`. Decide per
route group up front.

### 16. Module-scope client construction crashes the production build

**Symptom:** `next build` / prerender fails because a Supabase (or other) client
is constructed at import time and required env vars aren't bound.

**Root cause:** The build environment and the runtime environment have different
env vars. A client built at module scope runs during prerender, when runtime
secrets may be absent.

**Fix:** Make client construction build-tolerant — return a Proxy stub during
prerender, bind the real client lazily at request time. Or construct clients
inside request handlers, never at module scope.

**Rule:** Never do env-dependent work at module scope. Construction that needs
secrets happens per-request.

---

## Migrations & edge functions

### 17. Migration-numbering collisions desync the migration tracker

**Symptom:** `supabase db push` mis-tracks which migrations have run — re-applies
one, skips another — after two migration files share a numeric prefix.

**Root cause:** Two files with the same prefix (e.g. two `00054_*.sql`) authored
on different branches. The CLI also rejects non-integer prefixes like
`00064a_`.

**Fix:** Plain integer prefixes only. **Check the highest existing number**
before adding a migration. If a collision already shipped, repair the
`schema_migrations` tracking table and rename to the lowest free integer.

**Rule:** One integer prefix per migration, globally unique, allocated by
checking the directory first. Never branch-author two migrations with the same
number.

### 18. Edge functions with `--no-verify-jwt` + a decode-only role check are forgeable

**Symptom:** A "service-role-only" edge function can be called by anyone who
crafts a JWT with `role: "service_role"` in the payload.

**Root cause:** `--no-verify-jwt` tells the gateway to skip signature
verification. If the function then "checks the role" by base64-decoding the JWT
payload, it is trusting **unsigned, attacker-controlled** data.

**Fix:** Deploy with the default `--verify-jwt` so the gateway validates the
signature before the request reaches your code. Inside the function, still
enforce the role — but now on a JWT whose signature is proven.

**Rule:** Never `--no-verify-jwt` on a function that makes trust decisions.
Decoding a JWT is not verifying it.

---

## How to use this on a new app

1. Copy this file into the new repo's `docs/`.
2. Work the **pre-flight checklist** before writing auth code.
3. When something breaks, find the matching numbered entry — the *Symptom*
   lines are written to be greppable against real error text.
4. When you hit a **new** class of bug, add it here in the same
   Symptom / Root cause / Fix / Rule shape. The playbook compounds.
