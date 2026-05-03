# Google OAuth setup

**Status:** code shipped (#12); Google Cloud OAuth client + Supabase provider config still needed before the button does anything useful.

`<GoogleSignInButton>` renders only when `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === 'true'`. Until that env var is set, /login and /signup look exactly as they do today.

## Arno setup steps

1. **Create OAuth client at Google Cloud Console**
   - Go to https://console.cloud.google.com → APIs & Services → Credentials
   - Create OAuth client ID, type "Web application"
   - Authorised JavaScript origins: `https://esite-lilac.vercel.app` (and `e-site.live` once DNS cuts over per ADR-004)
   - Authorised redirect URIs: `https://cbskbnvvgcybmfikxgky.supabase.co/auth/v1/callback`
   - Save → captures `client_id` + `client_secret`

2. **Configure Supabase Auth provider** (PATCH the FULL block, never single fields — ADR-005):
   ```bash
   curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     "https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/config/auth" > /tmp/auth.json

   jq '. + {
     "external_google_enabled": true,
     "external_google_client_id": "<client_id>",
     "external_google_secret": "<client_secret>"
   }' /tmp/auth.json > /tmp/auth-google.json

   curl -sS -X PATCH -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     "https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/config/auth" \
     --data @/tmp/auth-google.json
   ```

3. **Set `NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED=true` on Vercel** (production + preview + development) via REST API direct (CLI prompts non-skippably from non-TTY shells per Session 18):
   ```bash
   curl -sS -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
     -H "Content-Type: application/json" \
     "https://api.vercel.com/v10/projects/<projectId>/env" \
     -d '{"key":"NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED","value":"true","type":"plain","target":["production","preview","development"]}'
   ```

4. **Persist the client_secret in `.secrets/supabase.md`** for rotation.

## What the code does

- `apps/web/src/components/GoogleSignInButton.tsx` — wraps `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams: { access_type: 'offline', prompt: 'consent' } } })`. The `access_type='offline'` + `prompt='consent'` combo asks Google for a refresh token + always shows the consent screen (rather than auto-bypassing for re-auth).
- The redirectTo carries `?from=oauth_google` so `/auth/callback`'s 'login' audit row picks up `metadata.method='oauth_google'`.
- Hidden under the env-flag so the rollout is a flag-flip on Vercel + Supabase, not a code change.

## Manual test plan once enabled

1. /login → "Continue with Google" → consent screen → callback → /dashboard
2. auth_events row written: event_type='login', metadata.method='oauth_google'
3. /signup → "Continue with Google" → consent → /onboarding (since `next=/onboarding` for signup)
4. Existing email user signs in via Google with same email → Supabase links the accounts (default behaviour); profile remains intact
