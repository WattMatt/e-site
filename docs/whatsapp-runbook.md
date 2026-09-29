# WhatsApp reply-to-act — deploy runbook

Spec: `docs/superpowers/specs/2026-09-28-whatsapp-reply-to-act-design.md` (§9 amendments win).
Plan: `docs/superpowers/plans/2026-09-28-whatsapp-reply-to-act.md`.

Deploy **Phase 1 dark**, with `whatsapp.settings.sending_enabled = false` (the migration default) and `projects.project_settings.notify_whatsapp = false` everywhere (the column default). Nothing is sent until the owner turns both on.

> **Rule: verify each step by reading the deployed state back.** A green workflow, a 200, or a merge is not evidence. `db push` keys on the version prefix and skips a file whose number is already in the ledger, and still exits 0.

---

## 1. Claim the migration number immediately before applying

Check all three places. A number checked at write time can be taken before merge.

```bash
# (a) the ledger head
scripts/db/mgmt-api.sh  # source it, then:
mgmt_query "SELECT max(version) FROM supabase_migrations.schema_migrations"
```

```bash
# (b) origin/main
git fetch origin && git ls-tree --name-only origin/main apps/edge-functions/supabase/migrations/ | tail -5
```

```bash
# (c) migration filenames claimed by open PRs
gh pr list --state open --json number,files --jq '.[] | "\(.number) \(.files[].path)"' | grep supabase/migrations
```

If anything holds `00207` or higher, rename the file to the next free number:

```bash
git mv apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql apps/edge-functions/supabase/migrations/<N>_whatsapp_reply_to_act.sql
```

Then update every `00207` in the file header comments and in `scripts/db/assert-whatsapp-*.sql`'s run lines. Re-run all three dry-runs against the renamed file:

```bash
for f in schema actor enqueue; do scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/<N>_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-$f.sql; done
```

Expected: 19 + 23 + 13 green.

## 2. Apply the migration

Merging to `main` runs `.github/workflows/deploy-migrations.yml` (`db push`, then `scripts/verify-migration-applied.ts`). Afterwards:

```bash
node --experimental-strip-types scripts/verify-migration-applied.ts --file <N>_whatsapp_reply_to_act.sql
```

Expected: all 57 checkable directives green. Then read the tables back yourself:

```sql
SELECT sending_enabled FROM whatsapp.settings;                          -- false
SELECT count(*) FILTER (WHERE notify_whatsapp) FROM projects.project_settings;  -- 0
SELECT jobname, schedule FROM cron.job WHERE jobname = 'whatsapp-due-sweep';    -- 30 4 * * *
```

## 3. PostgREST schema PATCH (this migration creates a schema)

Without this, REST returns `PGRST002` indefinitely. Use the Management API with the keychain PAT:

1. `GET /v1/projects/cbskbnvvgcybmfikxgky/postgrest` and copy `db_schema` verbatim.
2. `PATCH` it with the same list plus `,whatsapp`. Send only `db_schema`.
3. `GET` twice and confirm `whatsapp` is present both times.

Probes:
- `GET https://cbskbnvvgcybmfikxgky.supabase.co/rest/v1/phone_links?select=id` with `Accept-Profile: whatsapp` and the **anon** key must be refused (401/403, or an empty result under RLS), and must **not** return `PGRST002`.
- The same call with the **service role** key → `200 []`.

## 4. Edge secrets

```bash
supabase secrets set --project-ref cbskbnvvgcybmfikxgky \
  WHATSAPP_TOKEN=pending WHATSAPP_PHONE_NUMBER_ID=pending \
  WHATSAPP_APP_SECRET=pending WHATSAPP_VERIFY_TOKEN="$(openssl rand -hex 24)" \
  APP_URL=https://www.e-site.live
```

Until Meta onboarding completes, the Meta values stay `pending`. The webhook then refuses every POST (HMAC over a `pending` secret never matches a real Meta signature), and the worker suppresses everything because sending is off. Keep the verify token; step 10 needs it.

## 5. Deploy the two functions

```bash
cd apps/edge-functions && SUPABASE_ACCESS_TOKEN=<pat> ./deploy.sh
```

`deploy.sh` carries the flags: `whatsapp-webhook:--no-verify-jwt` and `whatsapp-worker:` (verified). Read them back:

- `GET /v1/projects/cbskbnvvgcybmfikxgky/functions/whatsapp-webhook`: `verify_jwt: false`.
- `GET …/functions/whatsapp-worker`: `verify_jwt: true`.
- Pull each bundle (`GET …/functions/{slug}/body`) and confirm the needles `verifyMetaSignature` (webhook) and `requireServiceRole` (worker) are present. **Verify the deployed artefact, not the repo.**

## 6. The per-minute worker cron

This goes through the Management API SQL endpoint, not the migration, because it carries the legacy `eyJ…` service-role JWT inline, like the existing jobs. Never use the runtime `sb_secret_…` key here.

```sql
SELECT cron.schedule('whatsapp-worker', '* * * * *', $$
  SELECT net.http_post(
    url := 'https://cbskbnvvgcybmfikxgky.supabase.co/functions/v1/whatsapp-worker',
    headers := jsonb_build_object('Authorization', 'Bearer <LEGACY eyJ… SERVICE ROLE JWT>', 'Content-Type', 'application/json'),
    body := '{"reason":"cron"}'::jsonb) $$);
```

Verify:
- `SELECT jobname FROM cron.job WHERE jobname LIKE 'whatsapp%'` returns 2 rows.
- After one minute, the latest `cron.job_run_details` row for the job is `succeeded`.
- The function log shows `{"drained":{"sent":0,"held":0,"suppressed":0,"failed":0,"retried":0},"retried":0}`.

## 7. Vercel

Merging to `main` deploys `/settings/account` (WhatsApp panel), `/settings/whatsapp`, `/wa/[itemId]` and `/projects/[id]/items/[ref]`. Read the production deployment for the merge commit from the GitHub deployments API (state `success`).

## 8. Unauthenticated probes

| Request | Expected |
|---|---|
| `GET https://www.e-site.live/wa/<any uuid>` | 307 → `/login?next=%2Fwa%2F<uuid>` |
| `GET https://www.e-site.live/settings/whatsapp` | 307 → login |
| `POST …/functions/v1/whatsapp-webhook` with no `X-Hub-Signature-256` | 401 |
| `GET …/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1` | 403 |
| `POST …/functions/v1/whatsapp-worker` with the anon key | 403 (`service_role required`) |

**Phase 1 is deployed dark once 1–8 are green.**

---

## 9. Meta onboarding and templates (WM, starts day one, 1–3 weeks of calendar time)

1. Create a Meta Business Manager for the business that operates E-Site and complete **business verification** (CIPC documents, the same pack as the Paystack KYC).
2. Get the number: an office landline (voice-call verification) or a virtual number; no cellphone needed. Build and test on Meta's free test number in the meantime. The existing support number stays on the Business app.
3. In WhatsApp Manager, add the number (a landline is verified by **voice call**; or keep using the test number for now), set the display name to "E-Site" (subject to approval), and set a two-step PIN.
4. Create a **system user** with a permanent token scoped to `whatsapp_business_messaging` and `whatsapp_business_management`. It becomes `WHATSAPP_TOKEN`. The phone number ID becomes `WHATSAPP_PHONE_NUMBER_ID`, and the app secret becomes `WHATSAPP_APP_SECRET`.
5. Add a payment method and record the ZA per-message rates.
6. Submit these templates, language `en`. The parameter order must match `apps/edge-functions/supabase/functions/_shared/whatsapp/templates.ts`:

| Name | Category | Body | Buttons |
|---|---|---|---|
| `esite_otp` | AUTHENTICATION | Meta's fixed OTP body: `{{1}} is your verification code.` | Copy code |
| `esite_optin` | UTILITY | `{{1}} has invited you to receive and respond to site items for {{2}} on WhatsApp via E-Site. Your replies, photos and notes will be recorded on those items. Reply STOP at any time.` | Quick reply "Yes, I agree"; Quick reply "No thanks" |
| `esite_item_assigned` | UTILITY | `*{{1}}* · {{2}}` / `{{3}}` / `Due {{4}}` | Quick reply "Acknowledge"; Quick reply "Mark done"; URL "Open in E-Site" → `https://www.e-site.live/wa/{{1}}` |
| `esite_item_due_tomorrow` | UTILITY | `Due tomorrow — *{{1}}* · {{2}}` / `{{3}}` / `Due {{4}}` | same three |
| `esite_item_overdue` | UTILITY | `Overdue {{5}} days — *{{1}}* · {{2}}` / `{{3}}` / `Was due {{4}}` | same three |
| `esite_items_waiting` | UTILITY | `You have {{1}} more E-Site items waiting for you today.` | URL "Open E-Site" → `https://www.e-site.live/dashboard` |

After approval, record it in the database:

```sql
UPDATE whatsapp.templates SET status = 'approved', updated_at = now() WHERE name = '<name>';
```

## 10. Webhook subscription

In the Meta App dashboard, go to WhatsApp → Configuration:
- Callback URL: `https://cbskbnvvgcybmfikxgky.supabase.co/functions/v1/whatsapp-webhook`
- Verify token: the value from step 4.
- Subscribe to the `messages` field.

Meta performs the GET handshake at this point; it must succeed. Then replace the `pending` secrets with the real ones (step 4), then redeploy both functions so they pick up the secrets.

## 11. Rollback

| Lever | Effect |
|---|---|
| Settings → WhatsApp → untick "Sending enabled" | Stops every outbound message within one cron tick. No deploy. |
| `projects.project_settings.notify_whatsapp = false` for a project | Stops enqueueing for that project. |
| `SELECT cron.unschedule('whatsapp-worker')` | Stops sending AND stops inbound retries. The webhook still stores every message verbatim. |
| Meta App dashboard → unsubscribe webhook | Stops inbound entirely. |

The schema can stay in place: it is inert while every `notify_whatsapp` is false.

## 12. Go-live (owner-gated, needs Meta approval and #193 applied)

See plan Task 25. Stage 1: WM staff on one project. Stage 2: one live project with invited foremen. Success measure: a snag assigned to a foreman is closed with a close-out photo over WhatsApp, leaves the PM's waiting list, and nobody chases it in a site group.
