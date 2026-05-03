# Cloudflare Turnstile CAPTCHA setup

**Status:** code shipped (#9); Cloudflare keys + Supabase Auth config still needed before Turnstile becomes effective.

When `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset (current state), the widget is a no-op and forms work without the challenge. As soon as the key + Supabase secret land, the challenge appears on `/signup` and `/reset-password`.

## Arno setup steps

1. **Create a Turnstile widget** at https://dash.cloudflare.com/?to=/:account/turnstile.
   - Domain: `esite-lilac.vercel.app` (and `e-site.live` once DNS cuts over per ADR-004).
   - Widget mode: **Managed** (recommended) — Cloudflare picks invisible / interactive based on risk score.
   - Captures both **site key** (public) and **secret** (server-side).

2. **Add the site key to Vercel** as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` for production, preview, and development. Use the REST API direct (the CLI prompts non-skippably from non-TTY shells per Session 18 lessons):
   ```bash
   curl -sS -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
     -H "Content-Type: application/json" \
     "https://api.vercel.com/v10/projects/<projectId>/env" \
     -d '{"key":"NEXT_PUBLIC_TURNSTILE_SITE_KEY","value":"<site_key>","type":"plain","target":["production","preview","development"]}'
   ```

3. **PATCH the Supabase Auth config** to enable Turnstile server-side verification. Per ADR-005, **PATCH the FULL block** — never single fields.
   ```bash
   # 1. GET the current auth config
   curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     "https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/config/auth" > /tmp/auth.json

   # 2. Apply your changes (jq) — set captcha provider + secret
   jq '. + {
     "security_captcha_enabled": true,
     "security_captcha_provider": "turnstile",
     "security_captcha_secret": "<cloudflare_secret>"
   }' /tmp/auth.json > /tmp/auth-updated.json

   # 3. PATCH the full body back
   curl -sS -X PATCH -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     "https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/config/auth" \
     --data @/tmp/auth-updated.json
   ```

4. **Add the secret to `.secrets/supabase.md`** (gitignored) for rotation reference.

## What the code does

- `apps/web/src/components/CaptchaTurnstile.tsx` — wraps `@marsidev/react-turnstile`. Returns `null` when no site key is set so the form renders cleanly during the rollout window.
- `apps/web/src/app/(auth)/signup/page.tsx` — passes `captchaToken` to `supabase.auth.signUp({ options: { captchaToken } })`.
- `apps/web/src/app/(auth)/reset-password/page.tsx` — passes `captchaToken` to `supabase.auth.resetPasswordForEmail(email, { captchaToken })`.

When Turnstile is enabled in Supabase, the SDK rejects calls without a token. When disabled (current), Supabase ignores the token field, so the same client code is forward-compatible.

## Verification once enabled

- Hit `/signup` from a fresh browser → see the Turnstile widget render under the form
- Submit without the challenge → "Please complete the verification challenge."
- Submit with the challenge passed → signup proceeds normally
- Same flow on `/reset-password`
