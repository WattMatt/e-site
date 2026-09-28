# WhatsApp reply-to-act — design

**Date:** 2026-09-28 · **Status:** design approved in session, awaiting spec review · **Owner:** Arno
**Scope:** Two-way WhatsApp channel on the work-item spine (`00196`): outbound nudges, and replies that acknowledge an item, mark it done, or attach a photo or note to it.

---

## 1. Why, and how this squares with the v2 roadmap

The v2 roadmap (`2026-09-09-v2-platform-roadmap/`) rules out a **WhatsApp bridge** (§06). A bridge would mirror group chat into E-Site. The roadmap also demotes the WhatsApp groups in three steps (§15). This design does neither of those things. It is a **delivery and response channel** for work items, and it plays the same role as the reply-by-email planned for Q2:

- E-Site stays the record. Every message links to an item, and every reply becomes an item event, note or photo there.
- There are no DMs, no groups, no mirroring and no chat UI. §06's exclusion stands.
- Q1's success test is a foreman closing a snag with a photo without anyone chasing on WhatsApp. This channel shortens that path. It does not replace it.

**Decisions taken on 2026-09-28**

| Question | Decision |
|---|---|
| Purpose | Two-way reply-to-act |
| Meta account state | Nothing set up. Onboarding is step 0 and runs in parallel with the build |
| v1 actions | Acknowledge, Mark done, attach a photo or text reply to an item |
| Who can act | Existing users **and invited externals** |
| Outbound triggers | Assigned (or ball returns), due tomorrow, overdue |
| Provider and identity | Meta WhatsApp Cloud API direct; externals become passwordless E-Site accounts linked by phone |

**Not in v1, on purpose:** creating new items from WhatsApp, inbound "send anything" capture, languages other than English, group mirroring (excluded by §06), and message types other than work items (diary, forms, and so on).

---

## 2. Architecture

```
work_item_events ──trigger──▶ whatsapp.outbox ◀── cron sweep 06:30 (due tomorrow / overdue)
                                    │
                         whatsapp-send (edge fn) ──▶ Meta Cloud API ──▶ phone
                                                                         │ tap / photo / text
Meta ──webhook──▶ whatsapp-webhook (edge fn) ──▶ whatsapp.inbound (verbatim, append-only)
                                    │
                         whatsapp-process: sender → user, reply → work item
                                    │
                         wa_* SECURITY DEFINER functions (act AS the user, web-equivalent rules)
                                    │
                         projects.work_items / work_item_events / item photos
```

### 2.1 The new `whatsapp` schema

Creating it means adding `whatsapp` to PostgREST `db_schema` with a Management API PATCH, applied along with the migration. Without that PATCH, requests fail with PGRST002.

| Table | Purpose | Key columns |
|---|---|---|
| `phone_links` | user ↔ number | `user_id` → profiles, `phone_e164`, `status` (`pending_otp`/`pending_optin`/`active`/`undeliverable`/`opted_out`), `verified_at`, `consent_at`, `consent_text_version`, `invited_by`, `quiet_start`/`quiet_end` (default 18:00/06:30 Africa/Johannesburg), `active_item_id`, `active_item_at`. Partial unique index on `phone_e164` WHERE status IN (`pending_optin`,`active`). |
| `outbox` | one intended message | `id`, `user_id`, `work_item_id`, `trigger` (`assigned`/`due_tomorrow`/`overdue`/`otp`/`optin`/`confirm`/`refusal`), `idempotency_key` UNIQUE (`item:trigger:yyyy-mm-dd`), `template_name`, `payload`, `status` (`queued`/`held_quiet`/`sent`/`delivered`/`read`/`failed`/`suppressed`), `meta_message_id`, `error_code`, `error_text`, `attempts`, `send_after` |
| `inbound` | every webhook message, verbatim | `meta_message_id` UNIQUE, `from_e164`, `received_at`, `raw` jsonb, `kind` (`button`/`text`/`image`/`status`/`other`), `context_message_id`, `resolved_user_id`, `resolved_item_id`, `outcome` (`pending`/`applied`/`refused`/`unmatched`/`unknown_sender`/`duplicate`), `outcome_reason`, `processed_at`. Append-only: no UPDATE of `raw`, no DELETE. |
| `templates` | the approved-template registry | `name`, `language`, `version`, `category`, `status` (as reported by Meta) |

**RLS:**
- `phone_links`: a user reads their own row. Org owners and admins read rows for users in their org.
- `outbox`: readable by anyone who can read the work item. This backs the per-item delivery log.
- `inbound`: owners and admins only.
- Nobody writes any of these through PostgREST. Only the service role and the `wa_*` functions write.

### 2.2 Edge functions

All three are deployed through `apps/edge-functions/deploy.sh`, with flags checked in. After deploying, read `verify_jwt` and the version back from the Management API.

| Function | JWT at gateway | Auth |
|---|---|---|
| `whatsapp-webhook` | **OFF** (Meta cannot send one) | `GET`: `hub.verify_token` compared to the edge secret `WHATSAPP_VERIFY_TOKEN`. `POST`: `X-Hub-Signature-256` HMAC over the **raw body** with `WHATSAPP_APP_SECRET`, compared in constant time. An unsigned or mismatched request gets a 401 before anything is parsed. |
| `whatsapp-send` | ON (cron and trigger via `net.http_post`) | service role, same shape as the existing cron jobs |
| `whatsapp-process` | ON | service role. Invoked by the webhook, forwarding the caller's Authorization per PR #153, and by a 1-minute cron as a backstop |

`whatsapp-webhook` only verifies, inserts into `inbound` (`ON CONFLICT (meta_message_id) DO NOTHING`, which makes Meta's retries idempotent) and returns 200. All processing happens in `whatsapp-process`, so a processing crash can never lose a message. Status callbacks (sent/delivered/read/failed) update `outbox` by `meta_message_id`.

**Secrets:** `WHATSAPP_TOKEN` (system-user permanent token), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`. None of them is ever compared with `SUPABASE_SERVICE_ROLE_KEY` (see the credential-shapes lesson).

### 2.3 Acting as the user: one rule set

`whatsapp-process` never writes to `projects.*` with raw service-role authority. It resolves the sender to a `user_id` and calls one of these:

- `whatsapp.wa_acknowledge(p_user uuid, p_item uuid, p_inbound uuid)`
- `whatsapp.wa_mark_done(p_user uuid, p_item uuid, p_inbound uuid)`
- `whatsapp.wa_attach_photo(p_user uuid, p_item uuid, p_storage_path text, p_inbound uuid, p_role text)`
- `whatsapp.wa_add_note(p_user uuid, p_item uuid, p_body text, p_inbound uuid)`

Each one is SECURITY DEFINER, `SET search_path = ''`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, then `GRANT EXECUTE … TO service_role`. Each re-evaluates, **for `p_user` explicitly** (never `current_user` and never `auth.uid()`), everything the matching web action enforces:

- `user_has_project_access(project, p_user)`, and `user_effective_project_role` not null and not `client_viewer`. Client viewers are refused in v1.
- That the item is visible to them: assignee, ball-in-court, gatekeeper or write role, as in `work_items_update`.
- The status transition. This is the same logic `advanceWorkItemStatusAction` uses. For the assignee, `open → answered` passes the ball to the gatekeeper. **Only the gatekeeper closes.**
- For evidence-required types (snag), `wa_mark_done` refuses unless a `closeout` photo from this user exists on the item. The process step handles that refusal as a prompt (§4.3), not a failure.

The implementation should move the transition rules into one SQL function that both the web action and `wa_mark_done` call. If that turns out to be too invasive for the spine, the fallback is a **parity contract test** (§7) that fails when the two drift apart.

Every write stamps `source = 'whatsapp'` and `inbound_id` in the event's detail, so the record shows how each action arrived.

---

## 3. Identity, consent, externals

### 3.1 Existing users
1. In **Settings → Notifications → WhatsApp**, the user enters a number, normalised to E.164 with ZA as the default country.
2. E-Site sends the Meta **authentication** template with a 6-digit code. The code is valid for 10 minutes, allows 5 attempts, and at most 3 codes are sent per hour.
3. The user enters the code on the web page. The link becomes `active` with `verified_at`, `consent_at` and `consent_text_version`. Entering the code proves they hold the number and records their consent together.

### 3.2 Invited externals
Who can invite: `ORG_WRITE_ROLES` on the project (owner/admin/PM), using a new **Add by WhatsApp** action on the project's people page and on the item assign picker.

1. The PM enters the name, the number and the company (optional).
2. If the number already belongs to an `active` or `pending_optin` link, E-Site offers **"Add <existing name> to this project"**. It never creates a duplicate account.
3. Otherwise, `inviteWhatsAppExternalAction` does the following in the service path:
   - Creates an auth user through the admin API with **no password**. It uses an internal, undeliverable placeholder email of the form `wa+<uuid>@invalid.e-site.live`, which is never mailed (the rbac-test lesson). `profiles.full_name` and `phone` are set, and so are `app_metadata.provisioned_via = 'whatsapp'` and `invited_by`.
   - Inserts `project_members (role='contractor', is_active=true)` on **this project only**.
   - Creates `phone_links (status='pending_optin', invited_by)`.
   - Queues the **opt-in** template: *"Watson Mattheus has invited you to receive and respond to site items for {project} via E-Site. Reply STOP at any time. [Yes, I agree] [No thanks]"*.
4. **Only a Yes tap activates the link.** The tap proves the number reaches that person and records consent at that moment. A **No thanks** tap sets `opted_out` and tells the PM.
5. While the link is pending, the external can be assigned items, because they are a real project member and the spine's assignee trigger is satisfied. **Nothing is delivered**, and the PM sees "Awaiting WhatsApp opt-in" on the person and the item.

**Claiming the account:** an external can later add a real email under *Settings* and verify it through the existing auth-email-hook flow, which turns the placeholder into a normal account. That flow is out of v1 scope. The placeholder domain makes these accounts easy to find.

**Admin visibility:** `/settings/users` marks WhatsApp-provisioned users with "Invited via WhatsApp by {PM}, {date}", and they can be removed there like anyone else.

### 3.3 Revocation and opt-out
- A message of `STOP`, `UNSUBSCRIBE`, `OPT OUT` or `STOPP` (any case) sets the link to `opted_out` right away, sends one confirmation, and suppresses everything afterwards. `START` re-opts in with a fresh `consent_at`. Meta policy and POPIA s69 both require this.
- Removing a project membership, or setting `is_active=false`, stops actions on that project immediately, because every `wa_*` call re-checks access. Outbound messages for that project's items are suppressed at send time (`suppressed`, reason `no_access`).
- Deactivating the org membership has the same effect on every project in the org.

### 3.4 Unknown senders
A message from an unlinked number is stored in `inbound` (`outcome='unknown_sender'`) and gets **one** reply per 24 hours: *"This number isn't linked to E-Site. Ask your project manager to add you."* No action is ever taken on it.

---

## 4. Messages

### 4.1 Outbound triggers
| Trigger | Source | Recipient |
|---|---|---|
| `assigned` | `work_item_events` AFTER INSERT trigger: `created` with an assignee, `reassigned`, or any event where `ball_in_court_id` changes to a new person | the new ball-in-court holder, unless they caused the event themselves |
| `due_tomorrow` | 06:30 SAST cron over open items with `due_date = today + 1` | ball-in-court holder |
| `overdue` | same cron: `due_date < today`. Sent on the first overdue day, then at most every 3 days | ball-in-court holder |

The trigger only inserts an `outbox` row when `project_settings.notify_whatsapp` is true, the recipient has an `active` link, and the platform flag `whatsapp_sending_enabled` is on. Items in `closed` or `void` never generate messages.

### 4.2 Template (utility category)

> **{ref}** · {project}
> {title}
> Due {due_date_human}{overdue_suffix}
> [image header: first item photo, when there is one]
> Buttons: **[Acknowledge] [Mark done] [Open in E-Site]**

The quick-reply button payloads are `ack:{item_id}:{outbox_id}` and `done:{item_id}:{outbox_id}`. *Open in E-Site* is a URL button pointing at `/projects/{project}/items/{ref}`. That route is supplied by the Inbox work (Q1 item 5). Until it exists, the button points at the module's own item page.

Sending an outbound message sets the recipient's `phone_links.active_item_id` and `active_item_at`.

### 4.3 Resolving a reply to an item, strictest rule first
1. **Button payload.** The payload names the item. If the `outbox_id` is stale (the item has moved on since that card was sent), the action is still attempted and the rules decide whether it succeeds.
2. **Swipe-reply context.** `context.id` is matched to `outbox.meta_message_id`, which gives the item.
3. **Bare photo or text** with an active item less than 24 hours old: attach to it, then reply *"📎 Attached to {ref} — [Wrong item]"*. Tapping **Wrong item** within 15 minutes sends a list message of the user's open items (up to 10). Choosing one moves the attachment, done as a redaction on the first item plus a copy on the chosen one, never a deletion (§06). Choosing none redacts it.
4. **No active item:** reply with the same open-items list. **Nothing is attached by guesswork.**

**Mark done on an evidence-required type with no close-out photo:** reply *"Send the close-out photo for {ref} to finish."* and set a pending-done flag on the link that expires after 30 minutes. The next photo from that user is stored as `closeout`, and then `wa_mark_done` runs again.

Several photos in one burst (within 60 seconds) are grouped and confirmed in a single message.

### 4.4 Effects
| Action | Effect |
|---|---|
| Acknowledge | Appends an `acknowledged` event. The verb CHECK is widened in the migration, and the `@verify` block of `00196` is updated in the same PR if it names the CHECK. Status is unchanged |
| Mark done | Same transition as the web action. Refusals are sent back in plain language, e.g. *"Only the site gatekeeper can close RFI-12."* or *"SNAG-14 is already closed."* |
| Photo | Downloaded from Meta **immediately** (media URLs expire), compressed to 2048 px JPEG q0.85, and stored in the item type's existing photo storage under the item's own org/project path. The path is **never** taken from the message. Snag photos go to `field.snag_photos` as `evidence`, or `closeout` during the Mark done flow. Other types use the attachment table they already have, or else a generic work-item attachment table added by this migration |
| Text | A work-item note/event `note_added` with the body verbatim, labelled "via WhatsApp". Once threads (Q2) exist, these notes move into the item's thread |

### 4.5 Volume and cost controls
- **Quiet hours** are 18:00–06:30 SAST by default and can be changed per user. A message triggered during quiet hours gets `send_after` set to the end of the window.
- **Daily cap:** 8 item messages per person per SAST day. Anything over the cap folds into one *"You have {n} more items waiting — open E-Site"* message.
- The idempotency key (`item:trigger:date`) stops the same item and trigger being sent twice on one day.
- **Replies inside the 24-hour service window** are free-form session messages and cost nothing per template. Only business-initiated templates are billed. The expected load is 1–3 templates per active person per day. Meta's current ZA utility rate is to be confirmed at onboarding and recorded in `templates`.

---

## 5. Failure handling

- **Inbound:** the raw message is stored first and processed afterwards. Duplicate `meta_message_id`s are dropped. A row whose processing throws stays `pending` and the 1-minute cron retries it up to 5 times, after which it is marked `refused` with the error. **Every refused, unmatched or unknown row gets a reply to the sender**, so nothing is silently dropped.
- **Outbound:**
  - Transient errors (5xx, rate limits) are retried with exponential backoff, up to 5 attempts.
  - Permanent recipient errors (not on WhatsApp, blocked, re-engagement required) mark the link `undeliverable`. The PM sees a badge on the person, and the user sees a banner in Settings.
  - Template or policy errors (paused, rejected, quality downgraded) send an alert email to WM admins and fall back to email notification for recipients who have a deliverable email address. Externals with placeholder emails get no fallback, and the PM badge says so.
- **Kill switches:** the per-project `project_settings.notify_whatsapp` (default **false**), and the platform flag `whatsapp_sending_enabled`, stored in a settings row and read at send time. The platform flag stops all sending within one cron tick, with no deploy.

---

## 6. Diagnostics (in the first deploy)

- **The per-item WhatsApp log** on each item page shows every outbox row (trigger, recipient, status, error) and every inbound row that resolved to the item (kind, outcome, reason). Anyone who can read the item can see it.
- **Settings → WhatsApp** (owner/admin) shows:
  - linked numbers by status;
  - pending opt-ins older than 48 hours;
  - undeliverable numbers;
  - the last 7 days' sent/delivered/read/failed counts and template-message count (the cost proxy);
  - template approval status;
  - inbound outcomes by reason.
- **Structured logs** in all three functions carry `inbound_id`/`outbox_id` and the reason code. A question like "my reply did nothing" can be answered from `whatsapp.inbound` alone.
- `docs/rbac-matrix.md` gets these rows: the invite action, both settings pages, the item WhatsApp log, and the three edge functions.

---

## 7. Testing

Each test must be able to fail, and the refusal tests are mutation-proven.

| Area | Test |
|---|---|
| Webhook auth | Valid, tampered-body, wrong-secret and missing-header requests, plus the GET verify handshake. Mutation: skipping the HMAC compare must turn at least 3 tests red |
| Idempotency | The same `meta_message_id` posted twice gives one `inbound` row and one effect |
| Resolution | Fixtures always have **≥2 open items** for the user, because with one item every match looks right. Cases: button, stale button, swipe-reply, bare photo with an active item, bare photo with an expired active item, **Wrong item** move, unknown sender, burst grouping |
| Acting as user (SQL, rolled back, impersonating real roles) | Assignee Mark done on an RFI gives `answered` with the ball on the gatekeeper, not `closed`. Gatekeeper Mark done gives `closed`. Removed member, `is_active=false` member, client viewer, and an external on another project are all **refused**. Snag Mark done without a close-out photo is refused. Every positive path is mutation-tested too (the #186 lesson) |
| Parity | A contract test lists every transition rule in `advanceWorkItemStatusAction` and fails if `wa_mark_done` lacks one. If the rules are shared (§2.3), it asserts both call the same function instead |
| Grants | `has_function_privilege('anon'/'authenticated', wa_*, 'EXECUTE')` is false. `@verify` directives cover every table, policy, function, grant and the verb CHECK |
| Outbox | Idempotency key, quiet-hour hold, daily cap fold, and suppression on lost access, all under a fixed clock |
| Consent | Pending opt-in delivers nothing. STOP suppresses the next queued message. START restores delivery |
| End to end, before Meta approves | A **fake Meta server** (a local Deno handler) records outbound calls and posts signed webhooks, so development and CI never depend on Meta |
| Migration suites | `web`, `@esite/shared` **and** `@esite/db` (`test:ci`) before any push |

---

## 8. Rollout

**Step 0: Meta onboarding (WM, starts day one, 1–3 weeks of calendar time)**
1. Create the Meta Business Manager for Watson Mattheus and complete business verification (CIPC documents, the same pack as the Paystack KYC).
2. Get a **new number**, a SIM that has never been registered on WhatsApp. The existing support number stays on the Business app.
3. In the WhatsApp Manager, add the number, set the display name to "E-Site by Watson Mattheus" (subject to approval), and set up two-step PIN.
4. Create a system user with a permanent token scoped to `whatsapp_business_messaging` and `whatsapp_business_management`, and store it as an edge secret.
5. Submit the templates: `esite_otp` (authentication), `esite_optin`, `esite_item_assigned`, `esite_item_due_tomorrow`, `esite_item_overdue` (utility).
6. Add a payment method and record the ZA per-message rates.
7. Point the webhook at `https://cbskbnvvgcybmfikxgky.supabase.co/functions/v1/whatsapp-webhook` and subscribe to `messages`.

**Build order:** migration → edge functions (fake Meta) → web settings and invite UI → per-item log → switch to real Meta credentials.

**Stages**
1. WM staff only, on one project, with `notify_whatsapp` on.
2. One live project with its contractor foremen invited (the owner chooses which project).
3. After that, opt-in per project.

**Success measure:** a snag assigned to a contractor foreman is closed with a close-out photo sent over WhatsApp, the item leaves the PM's "waiting on others" list, and nobody posts in the site group to chase it.

**Deploy cost:** one migration (claim the number **at apply time**, after checking the ledger, `origin/main` and open-PR filenames), three edge-function deploys, the PostgREST `db_schema` PATCH, one cron schedule, and one Vercel deploy. Every step is verified by reading back the deployed state, not by a green workflow.

---

## 9. Plan-time amendments (2026-09-28, from reading the code)

Where this section disagrees with §§1–8, **this section wins**.

1. **The spine is empty and has no UI.** Production has 0 `projects.work_items`, the snag/RFI/inspection mirrors ship in item 3 ([#193](https://github.com/WattMatt/e-site/pull/193), unapplied), and no web page renders a work item. The owner chose to build on the spine now and gate go-live on #193. So the plan also builds a minimal item page (`/projects/[id]/items/[ref]`) and a `/wa/[itemId]` redirect as the "Open in E-Site" target.
2. **Mark done must act through the source module for mirrored items.** #193's `map_source_status` projects status FROM the source (snag `resolved` → `answered`, `signed_off` → `closed`; RFI `responded` → `answered`), so a spine-side status write on a mirror is overwritten by the next source write. Mark done therefore dispatches on type:
   - **manual `task`:** a spine transition.
   - **`snag`:** `resolved` when the assignee has sent a close-out photo, `signed_off` when the gatekeeper does.
   - **`rfi`:** Mark done prompts for the answer, and the next text becomes an `rfi_responses` row with status `responded`.
   - **All other types:** a link out to E-Site.
   Snag and RFI are Phase 2 of the plan, after #193 applies.
3. **"Act as the user" means RLS evaluates, not a mirror of RLS.** The `wa_*` functions are SECURITY DEFINER but **owned by a dedicated `whatsapp_actor` role**: NOLOGIN, no BYPASSRLS, and a member of `authenticated`. Each one sets `request.jwt.claims` to the user first. The table's real policies, `auth.uid()`-based helpers and the transition guard then run exactly as they do for that user on the web. There is no hand-copied rule set to drift, so §2.3's parity contract test is replaced by behavioural impersonation assertions and a mutation that re-owns the function to `postgres`.
4. **Two edge functions, not three.** The contract suite forbids rebuilding function-to-function auth, and Meta's webhook carries no JWT to forward. The functions are:
   - `whatsapp-webhook` (`--no-verify-jwt`, HMAC): stores the message and processes it inline with `EdgeRuntime.waitUntil`.
   - `whatsapp-worker` (gateway JWT plus `requireServiceRole`): drains the outbox and retries stuck inbound rows. A per-minute cron runs it, and web actions kick it for OTP and opt-in sends.
5. **"Wrong item" redacts and does not move.** Tapping it redacts the note or attachment and replies "Removed from {ref}; swipe-reply on the right card to attach it there." Moving across projects would need a storage copy and re-binding, with no benefit over a re-send.
6. **No image header and no re-compression.** A template image header must always carry an image, so the cards are text with three buttons. WhatsApp already compresses photos, so the edge stores the received JPEG as-is.
7. **Personal linking lives on `/settings/account`**, which is reachable by every signed-in user. The admin view is `/settings/whatsapp` (`OWNER_ADMIN`).
8. **Placeholder emails for externals** are `wa-<uuid>@wa.e-site.live`. It is a domain we control that has no MX record. `auth-email-hook` refuses to send to it, so the platform mailer can never bounce off it.
9. **Pure logic has one source.** `packages/shared/src/whatsapp/core.ts` (no imports) is canonical. A sync script copies it to `apps/edge-functions/supabase/functions/_shared/whatsapp/core.ts`, and a contract test asserts the two are byte-identical.
10. **The fold message is a sixth template**, `esite_items_waiting`, because a daily-cap overflow is business-initiated.
11. **No per-recipient email fallback.** WhatsApp is additive: every existing `notify_*_email` sender keeps running whether or not WhatsApp delivers, so a fallback would send the same person the same email twice. Policy errors surface on Settings → WhatsApp and at the admin alert address instead.
12. **Removal is stricter on WhatsApp than on the web.** The spine lets an item's assignee keep acting after they lose project membership (the `assignee_id = auth.uid()` arm). The `wa_*` functions additionally require an effective project role, which is what §3.3 promised.

## 10. Open items for the owner
1. Which live project goes first in stage 2.
2. The WM admin email address that receives template or policy alerts.
3. Whether client viewers should ever act via WhatsApp. In v1 they are refused, which matches the `00161` write block.
