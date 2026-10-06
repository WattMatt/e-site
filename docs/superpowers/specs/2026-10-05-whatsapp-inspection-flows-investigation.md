# WhatsApp per-site reporting: investigation note

**Date:** 2026-10-05 · **Prompt:** E4 · **Status:** decisions locked, see the end.

## 1. The ask, separated into intents

1. A project's people act as one site "group" on WhatsApp.
2. Through WhatsApp they complete an inspection form.
3. They send photos that land on the right item of that form.
4. Submitting creates the real record and the PDF, confirms to the sender and tells the site.
5. Only active project members can do any of it, and an org must opt in.

## 2. What production holds (read 2026-10-05)

| Fact | Value |
|---|---|
| `origin/main` / ledger head | `c5af1754` / `00223` (214 rows) |
| `whatsapp.settings.sending_enabled` | `false` (platform kill switch) |
| Linked numbers / inbound / outbox | 1 / 7 / 0 |
| Inspections | 20, all `assigned` |
| Inspection responses, photos, signatures, ever | **0 / 0 / 0** |
| Site forms / form responses | 1 / 0 |

The assignees could write. All are active members, and the contractors' last sign-ins are June and July 2026. Nobody has completed an inspection on the web either. Field staff do not open the web app, which is the premise of this work.

## 3. What the shipped channel already does (#221, #223, #230, #233)

- **Reusable as is:** number linking, including passwordless externals; acting as the user under real RLS (`whatsapp_actor` + `act_as`); the idempotent inbound log with retries; media download with server-built paths; buttons and lists inside the 24-hour window; current-project context; the 30-minute held-state pattern; the outbox with quiet hours, daily cap and the platform switch.
- **Missing:** a per-org switch; sending a Flow; parsing a Flow reply (`nfm_reply`); any write path into `inspections.*`; a server-side PDF path; an outbound message other than an item template.
- **Sharp edges found:**
  - `whatsapp.inbound.raw` stores the parsed message, not Meta's JSON. Anything the parser drops, such as a Flow's `response_json`, is lost for good.
  - Photos in a held post download up to 30 minutes after arrival, not at receipt.
  - The processor calls `wa_rfi_respond`, which no migration defines. `wa_mark_done` never returns `needs_photo` or `needs_answer`, so the pending-done path is proven only by mocks.
  - `billing.has_feature` always passes the WM org, so it cannot be a default-OFF flag.
  - `inspections.user_can_write_responses` checks the org membership's `is_active` but not the project membership's. A deactivated project member keeps response writes on the web.

## 4. Platform facts that shape the design

- **Groups API:** at most 8 participants including the business number, needs an Official Business Account, and allows no interactive messages. A site has more than 7 people, so real groups are out.
- **Flows:** native forms in 1:1 chats. A completed Flow arrives on the normal message webhook as `interactive.nfm_reply` with `response_json` and our own `flow_token`, so no Flow endpoint is needed. Draft-mode Flows can be sent for testing. Sending needs a verified business.
- **Media:** download URLs expire 5 minutes after they are fetched.
- **Window:** free-form replies only within 24 hours of the person's last message. Anything else is an approved template.

## 5. Recommended shape

The site group is the E-Site project membership. One business number talks 1:1 to each member and fans messages out. WhatsApp carries the work; E-Site holds it and decides who may act.

- **Simple templates, as a Flow:** templates without repeating groups, cross-field conditions or file fields become a Flow generated from the template JSON. Each section is one screen.
- **Everything else, as a signed link:** signatures, file fields and long tables use a single-use, 15-minute link. The link signs the linked user into the normal web form, so there is no second form implementation.
- **Photos:** "photo for item 10" attaches to that field. The bytes are copied into Storage when the message arrives.
- **Submit:** reuses the web rules, checks completeness on the server, renders the PDF, confirms to the sender with the PDF, and sends a summary to the site's linked members.

## 6. Owner-only items (prepared, then stopped)

- Meta: business verification status for the production number, publishing the generated Flow on the WABA, and approving the new `esite_form_submitted` utility template.
- POPIA §72: inspection answers, photos and the PDF pass through Meta's servers outside South Africa.
- Cost from 1 Oct 2026: replies inside the window cost USD 0.0095 after 1,000 free per number per month. Each summary template costs USD 0.0095 per recipient.

## 7. Decisions (locked 2026-10-05)

| ID | Decision |
|---|---|
| D1 | Site group = project membership, 1:1 fan-out. Owner-locked in the prompt pack. |
| D2 | First template: **Miniature Substation Inspection Report v1.0**. It ties with the Pre-FAT/Post-FAT at 5 inspections each. It is the one assigned to a field contractor, and it exercises the Flow, a chat photo and a signed link. |
| D3 | Edge function = chat. Next.js (Node) = form domain, reached over an HMAC-signed internal route. Database = judge, through `wa_*` act-as functions plus an explicit `user_has_project_access` gate. |
| D4 | Endpoint-less Flow. The `flow_token` is bound to user, inspection and template row, expires after 24 hours, is accepted only from that user's linked number, and applies once. |
| D5 | Signed link = our own single-use 15-minute token behind a POST interstitial, so link scanners cannot burn it. It mints a normal session for the linked user. Client viewers and inactive members are refused. |
| D6 | Photos are stored as WhatsApp delivers them, with no re-encode. Meta's chat images are JPEG up to 5 MB, already under the web target. An allow-list and size cap apply, and dimensions are recorded. |
| D7 | A WhatsApp-origin submit is not filed to `projects.reports`. The `inspection` report kind is open-read, so an uncertified PDF filed there would reach client viewers. The PDF goes to the submitter, and certify still files the official copy. |
| D8 | `whatsapp.org_settings.forms_enabled` defaults to false and is set by that org's owner or admin. The platform `sending_enabled` stays the master switch. |
| D9 | Source is recorded as `via` on responses and photos and `submitted_via` on inspections. |
