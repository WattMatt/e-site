#!/usr/bin/env bash
#
# Canonical deploy commands for the Supabase Edge Functions.
#
# WHY THIS FILE EXISTS
# ────────────────────────────────────────────────────────────────────────────
# These functions are deployed BY HAND from a terminal. The GitHub workflow
# (.github/workflows/deploy-edge-functions.yml) is manual-dispatch only and its
# secrets are not bound, so it has never successfully run — the comment at the
# top of that file says so.
#
# Deploying by hand meant the flags lived only in whoever's shell history, and
# two things went wrong that way:
#
#   * `eft-invoice` was not in the workflow at all and sat on an April build for
#     five months. The repo had a service-role guard; the deployed bundle did
#     not. That was a live privilege escalation until 2026-09-11.
#   * `send-notification`, `payment-recovery-check` and `calculate-health-scores`
#     ran with `--no-verify-jwt`, which turned their role-claim check into
#     decoration: an unauthenticated caller could present a self-made
#     `{"role":"service_role"}` token and pass.
#
# So the flags are checked in, and `edge-function-jwt.contract.test.ts` asserts
# this file against the functions' own source. Deploy from here, not from memory.
#
# ⚠ --no-verify-jwt IS A SECURITY DECISION, NOT A CONVENIENCE FLAG.
# It tells the Supabase gateway not to verify the JWT signature. Any function
# whose only authorisation is `requireServiceRole` — which DECODES a role claim,
# it does not verify one — then accepts a forged token from anyone. Only a
# function that authorises by PROVING the caller holds a credential (see
# send-email) may carry it.
#
# USAGE
#   ./deploy.sh                 # deploy every function
#   ./deploy.sh eft-invoice …   # deploy only the named ones
#
# Requires SUPABASE_ACCESS_TOKEN in the environment.

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-cbskbnvvgcybmfikxgky}"
cd "$(dirname "$0")"

# slug:flags — an empty flags field means gateway JWT verification is ON.
FUNCTIONS=(
  # ── Gateway verifies the JWT. Required: these authorise by decoding a role
  #    claim, which is only meaningful if something verified the signature.
  "send-notification:"
  "eft-invoice:"
  "compliance-complete:"
  "cloud-sync-project:"
  "cloud-sync-cron:"
  "calculate-health-scores:"
  "payment-recovery-check:"
  "reengagement-check:"
  "conversion-prompt:"
  "onboarding-email-d0:"
  "onboarding-email-d1:"
  "onboarding-email-d3:"
  "onboarding-email-d7:"
  "onboarding-email-d14:"

  # send-email serves the PUBLIC data-subject-request type, and it is tempting to
  # conclude that it therefore needs --no-verify-jwt. It does NOT, and production
  # has run it with verification ON. A public caller reaches it with the ANON
  # key, which is a perfectly valid JWT, so the gateway is satisfied; the public
  # branch is then exempted at the application layer by PUBLIC_TYPES, and
  # `isVerifiedServiceRoleCaller` explicitly DENIES the anon key so it can never
  # reach an internal type. Setting the flag here would have flipped production
  # from verifying to not, widening exposure while looking like documentation.
  # Nothing needs the flag just because it has a public path.
  "send-email:"

  # ── No gateway verification, deliberately. One function, one reason.
  # paystack-webhook is a retired 410 stub. Paystack sends NO Authorization
  # header at all, so with verification on the gateway answers 401 and the
  # retirement notice never reaches whoever mis-pasted the URL. The whole
  # purpose of the stub is that message. It reads no input and touches nothing.
  "paystack-webhook:--no-verify-jwt"

  # ── No service-role guard; they authenticate their callers differently.
  "auth-email-hook:"
  "marketplace-payment:"
  "validate-inspection:"

  # notify-entity authorises by PROVING possession: it calls auth.getUser(),
  # which validates the token against GoTrue over the network, then checks that
  # the caller created the row it names. Under the rule above it is therefore
  # one of the few functions ALLOWED to carry --no-verify-jwt — and it was
  # deployed that way on 2026-06-24. It is still listed here without the flag,
  # for the send-email reason directly above: being allowed to carry it is not
  # a reason to. Its only caller is mobile, which holds a real user JWT, so the
  # gateway is satisfied either way; leaving verification ON means a garbage
  # token is refused at the edge instead of costing a GoTrue round-trip.
  # Production was flipped to verify_jwt=true on 2026-09-11 to match this line.
  "notify-entity:"
)

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be set}"

wanted=("$@")
deployed=0

for entry in "${FUNCTIONS[@]}"; do
  slug="${entry%%:*}"
  flags="${entry#*:}"

  if [ ${#wanted[@]} -gt 0 ]; then
    match=0
    for w in "${wanted[@]}"; do [ "$w" = "$slug" ] && match=1; done
    [ $match -eq 1 ] || continue
  fi

  echo "→ deploying ${slug} ${flags:-(gateway verifies JWT)}"
  # shellcheck disable=SC2086
  supabase functions deploy "$slug" --project-ref "$PROJECT_REF" $flags
  deployed=$((deployed + 1))
done

echo "done: ${deployed} function(s) deployed"

# RESOLVED 2026-09-11 — the note that used to sit here said `notify-entity` and
# `validate-coc` were deployed on this project with no source in this repository,
# so neither could be reviewed. Both were pulled out of their deployed bundles
# (`GET /v1/projects/{ref}/functions/{slug}/body`, ESZIP2.3) and read:
#
#   * notify-entity — guard is sound. It does NOT use the decode-only helper; it
#     calls auth.getUser() (a GoTrue round-trip, so the signature is really
#     checked) and then authorises per-entity. Not forgeable despite having run
#     with --no-verify-jwt. Source is now committed and it is listed above.
#
#   * validate-coc — DELETED from the project. It was the pre-rename version of
#     validate-inspection (da5741e, 2026-05-18) and was simply never removed
#     after the rename: zero callers in the monorepo, zero references in
#     cron.job. It had NO application-layer authorisation whatsoever, and ran
#     every request under the service role, so the public anon key was enough to
#     reach it — proven non-destructively with a nonexistent certificate_id,
#     which returned the handler's own 404 rather than the gateway's 401. With a
#     real id it would have DELETE-then-INSERTed that certificate's rows in
#     inspections.coc_validations and returned the inspection's rule results.
#     That is a bypass of the capability gate validate-inspection added — same
#     table, no check. Its source remains in git history at f54b2e0.
#
# The lesson worth keeping: BOTH were invisible to every test in this repo,
# because a test can only see the functions that HAVE a directory here. Nothing
# reconciles this list against what is actually deployed. `pnpm --filter web
# test edge-function-jwt` now asserts the direction it can check — every
# directory appears above — but the other direction still needs an eye on
# `GET /v1/projects/{ref}/functions` when something feels unaccounted for.
