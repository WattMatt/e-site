# TOTP MFA setup

**Status:** code shipped (#10); Supabase config flag still needed before users can enroll.

When `mfa_totp_enroll_enabled = false` (current state), `supabase.auth.mfa.enroll({ factorType: 'totp' })` returns an error and the enrollment UI surfaces it cleanly. Flipping the flag enables enrollment for everyone.

## Arno setup steps

PATCH the FULL Supabase Auth config (per ADR-005, never single fields):

```bash
# 1. Snapshot current config
curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/config/auth" > /tmp/auth.json

# 2. Apply changes
jq '. + {
  "mfa_totp_enroll_enabled": true,
  "mfa_totp_verify_enabled": true,
  "mfa_max_enrolled_factors": 10
}' /tmp/auth.json > /tmp/auth-mfa.json

# 3. PATCH the full body
curl -sS -X PATCH -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/cbskbnvvgcybmfikxgky/config/auth" \
  --data @/tmp/auth-mfa.json
```

After flipping, users can self-enroll at `/settings/security/mfa`.

## Mandatory MFA for owner/admin (deferred)

The kickoff item #10 mentioned "for owner/admin roles". The current build:

- Allows ANY user to voluntarily enroll
- Forces the MFA challenge on next login if they HAVE enrolled (middleware reads `user.factors[].status === 'verified'` + `user.amr` to detect aal1 sessions)

It does NOT force enrollment for owner/admin. To enforce that, add a middleware redirect:

```typescript
// In apps/web/src/middleware.ts after the org check:
if (user && hasOrgAndIsOwnerOrAdmin && !hasVerifiedFactor) {
  // redirect to /settings/security/mfa
}
```

The risk of forcing immediately: if a current owner/admin can't access an authenticator app (e.g. lost phone), they'd lock themselves out. Soft-enforcing via banner first is safer; flip to hard-enforce after a month of voluntary enrollment.

## Manual test plan once enabled

1. `/settings/security/mfa` → "Enable two-factor authentication" → QR code renders
2. Scan with 1Password / Google Authenticator / Authy
3. Enter the 6-digit code → "Confirm and enable" → factor listed as verified
4. Sign out → sign in with password → middleware sees verified factor + aal1 session → redirects to `/verify-mfa`
5. Enter the current code → land on the original `?next` destination (default `/dashboard`)
6. `/settings/security/mfa` → "Disable" → confirm → factor removed
