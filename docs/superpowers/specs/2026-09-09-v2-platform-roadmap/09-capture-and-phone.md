## The capture layer — phone-first web, voice, location, QR and offline

Thirteen contractor accounts, zero sign-ins in thirty days. That is not an adoption problem; it is a capture problem. E-Site is a desktop application that happens to reflow, and every field affordance it has was built for a tablet on a bench, not a phone in one hand at a distribution board.

### Where capture stands today

| Capability | State today | Evidence |
|---|---|---|
| PWA | **None.** `apps/web/public/` holds one file, `pdf.worker.min.mjs`. No manifest, no service worker, no `serviceWorker` reference anywhere in `apps/web` | repo tree |
| Web push | **None.** `send-notification` posts only to the Expo push API against `public.push_tokens`, which holds zero rows | `apps/edge-functions/supabase/functions/send-notification/index.ts:18,102-137` |
| Microphone | **Blocked at the header:** `Permissions-Policy: camera=self, microphone=(), geolocation=self` | `apps/web/next.config.ts:148-149` |
| Geolocation | **Permitted by the header and called by nothing.** `navigator.geolocation` and `getCurrentPosition` appear nowhere in `apps/web`, `apps/mobile` or `packages` | repo-wide grep |
| Camera intent | `capture="environment"` on three inputs; **absent on five**, so a phone opens the photo library instead of the camera | present: `InlinePhotoCapture.tsx:137`, `PhotoField.tsx:126`, `FormPhotoStrip.tsx:302` · absent: below |
| GPS on photos | **Declared, read, rendered — and written by nothing.** `gps_lat`/`gps_lng` exist on two photo tables, are selected into the client, render as a caption fragment in both report builders and as a `📍` in the lightbox, yet no insert path supplies a coordinate | declared `00066_inspections_module.sql:150-151`, `00179_site_forms.sql:219-220` · read `useFieldPhotos.ts:108` · rendered `inspection-report-data.ts:313-314`, `site-form-report-data.ts:422-423`, `PhotoLightbox.tsx:183-185` · never written `useFieldPhotos.ts:168-175`, `lib/site-forms/upload.ts:92-105`, `lib/image/compress.ts:82-90`, `snags/new/page.tsx:97-104` · mobile declares the column only, `apps/mobile/src/lib/powersync/schema.ts:119-120` |
| Snag place | Free-text `location` plus optional `floor_plan_pin` (`{x, y, floorPlanId}`). **No `node_id`** — a snag cannot name its board. Site forms can, and keep `board_ref`/`board_label` so identity survives a board delete | `00004_field_schema.sql:10-31`, `packages/shared/src/schemas/snag.schema.ts:11-16` vs `00179_site_forms.sql:76-78,94-96` |
| Orphan-safe upload | Solved correctly three times — and **wrong a fourth** | correct: `lib/image/compress.ts:56-95`, `lib/site-forms/upload.ts:62-114`, `useFieldPhotos.ts:129-198` · wrong: `snags/new/page.tsx:91-105` |
| Compression | **Five copies of `compressImage`** in `apps/web` | `lib/image/compress.ts:17`, `useFieldPhotos.ts:30`, `settings/branding/BrandingForm.tsx:19`, `projects/[id]/settings/general/_BrandingFields.tsx:15`, `lib/qc-photos.ts:147` |
| `markup` photo type | Permitted since the schema shipped, written by nothing | `00004_field_schema.sql:45-46` vs repo-wide grep for `photo_type` writers |
| QR | Cable tags only, resolving to a read-only cable card | `export-pdf.ts:1216,1296`, `(scan)/site/tag/[text]/page.tsx:51,260` |
| Mobile offline | Real and well built — a non-synced SQLite queue with a five-retry cap and a three-state banner — but locked inside Expo/PowerSync | `apps/mobile/src/inspections/attachment-queue.ts:56-75,103,109-118`, `apps/mobile/src/inspections/upload-worker.ts:1-19`, `apps/mobile/src/components/SyncStatusBanner.tsx:11-27` |

Two rows deserve to be read twice. **Every photo caption in every inspection and site-form PDF has silently omitted its location since those modules shipped** — the columns, the query, the caption builder and the lightbox are all in place and correct; the coordinate simply never arrives. And `photo_type='markup'` has been a legal value with no writer for as long as the snag table has existed, which is the exact shape of the `closeout` deadlock that made snag sign-off impossible for a year.

**Two features are also missing an input entirely.** `projects.projects` holds `address`, `city` and `province` as free text and nothing geographic (`00002_projects_schema.sql:11-31`); no later migration adds a coordinate. Auto-weather — the single strongest reason a contractor tolerates a daily prompt — has nothing to query.

### (a) The phone shell, then the PWA — two quarters, in that order

**Decision: Q1 ships a responsive phone shell on the existing origin with no service worker; Q2 ships the manifest, the service worker, the install prompt and web push.** This adopts §13's sequencing verbatim (§13 Q1 item 10: *"No manifest and no service worker in Q1"*; §13 Q2 item 1). Putting an untested offline queue in front of the first contractors this platform has ever activated is a worse bet than a plain responsive page, and everything in (b), (c), (e) and (g) works without one.

**Q2 mechanics are owned by §05(h) and are not re-specified here:** `manifest.webmanifest`, `apps/web/public/sw.js`, VAPID key pairs per environment, `public.web_push_subscriptions` (Appendix A(f), Q2), the `send-web-push` function (Appendix A(g), Q2, **with** JWT verification), deactivation on 404/410, and the rule that permission is requested only after a user's first closed work item. Two edits belong to this section because they are middleware, not notifications:

- **`apps/web/src/middleware.ts:178` must gain `webmanifest` and an explicit `/sw.js` exclusion.** The matcher today excludes `svg|png|jpg|jpeg|gif|webp|mjs|map|woff2?|json|ico` (verified at that line). `.webmanifest` is not in that list and neither is `.js`, so both files currently traverse the auth check and would be served an HTML redirect to an anonymous visitor — a service worker registration fails outright on that, and a manifest fetch fails silently.
- **CSP needs no change.** `default-src 'self'` already covers a same-origin worker and manifest (`apps/web/src/lib/security/csp.ts:23-24`).

**Cached (Q2):** the app shell, the three phone routes, and — stale-while-revalidate, scoped to the *current project only* — the node list, the user's open work items, the active inspection/form template JSON, and the twenty most recently opened floor-plan images. **Never cached:** the document library, cable-schedule grids, saved reports, anything under `/api/*` (already `no-store`, `apps/web/next.config.ts:172-176`), and any signed URL — they expire hourly and a cached 403 is worse than a spinner.

Read caching carries no write queue. Everything below the banner is the design for one, kept because it is correct and because the argument for cutting it should be re-readable, not because it is scheduled.

> **Designed, not scheduled.** The **offline write queue and the three `/api/capture/v1/*` routes are cut past twelve months.** The reason is the platform, not the design: iOS implements no Background Sync and Safari evicts script-writable storage after seven days without interaction, so the queue's value is a **bounded edge case** — a capture made out of range by a user who has already installed the app and will reopen it within a week — bought with a **versioned route surface** to maintain and a **failure mode that silently loses evidence** if any part of it is wrong. Q2 ships install, web push and read caching; capture-while-offline is not promised, because it does not exist. The design below is retained verbatim so that reviving it is an implementation, not a re-invention.

**Offline writes are limited to three verbs:** create a snag, add a photo to an existing record, submit the day-end check-in. Not site-form submission, inspection certification or snag sign-off — those carry server-evaluated legality gates, and a queue that appears to accept them would be forging a compliance record. The phone says so: *"Needs a connection — this one is a signed record."*

**The queue never replays a server-action request.** This is a hard rule, not a preference. `createDiaryEntryAction` is a server action (`apps/web/src/actions/diary.actions.ts:1,25`) whose POST carries a deploy-scoped action id — the same identifier class behind the PR #159 incident, where a loose id mapping invoked *export* while the caller thought it was invoking *complete*. A worker that stores a captured `fetch` and replays it after a deploy 404s at best and calls a different action at worst. Instead the three verbs are re-expressed as versioned route handlers — `POST /api/capture/v1/snag`, `/api/capture/v1/photo`, `/api/capture/v1/checkin` — each gated by `requireRoleAPI` **and** a RESTRICTIVE policy on its target table, each taking a client-generated `idempotency_key` (UUID) that is unique-indexed so a double-drain is a no-op. The queue stores `{route, version, payload, blob, idempotency_key, attempts, last_error}` in IndexedDB, never a serialised request. All three routes would land in `docs/rbac-matrix.md` in the same PR; none of them appears in Appendix A(g), which is the register of routes that ship.

**The honest iOS limits — the reason for the cut, stated in full.** WebKit implements no Background Sync, so a queued photo uploads when the app is *reopened*, not from a pocket. Safari evicts script-writable storage after seven days without interaction; a Home Screen install is exempt, which makes install a prerequisite rather than a nicety. `navigator.storage.persist()` is not granted. Web push needs iOS 16.4+, Home Screen installation *and* a gesture-triggered permission request. So: offline capture would unlock only once installed; the install coaching is a two-step Share-sheet illustration because `beforeinstallprompt` never fires on Safari; and the promise we would publish is **"captured on site, delivered when you next open E-Site"**, not "background sync". The queue is bounded at 50 items or 200 MB, past which capture blocks with a visible reason rather than dropping — the exact failure Dalux users report as reports lost out of range.

**Sync state.** One `SyncChip` in the tab bar with three states — *Synced* / *N waiting* / *Needs attention* — mirroring the mobile banner's logic (`SyncStatusBanner.tsx:11-27`) over queue depth and `navigator.onLine`. Each queued item also shows its own state on its own row, because a global chip hides *which* photo failed.

**Cost, restated as weeks against §13's published ledger.** §09 raised two corrections to that ledger, and both are stated here as week figures rather than absorbed: **+0.5 on the PWA/offline item** (a write queue is real work on top of §05's manifest, service worker and VAPID) and **+0.5 on the place migration** in (e). Together they are the 1.0 week §09 contributed to the pre-re-plan Q2 raw commitment. With the queue cut, **the +0.5 on the PWA/offline item is withdrawn with it**; what remains of that item in Q2 is install, web push and read caching, owned by §05, and capture carries no engineer-week line against it. The +0.5 on the place migration stands and travels with its item to Q4.

### (b) Phone information architecture: three tabs, no apology

**Decision: the phone shows Inbox, My Work and Capture. It does not attempt parity, and it says so.**

| Tab | Route | Contains | Reaches zero? |
|---|---|---|---|
| **Inbox** | `/inbox` (§04a; Appendix A(g)) | Ball-in-court items, today's due dates, @mentions, the check-in prompt | Yes, by design |
| **My Work** | `/my-work` (§04b; Appendix A(g)) | Everything assigned to you across projects, grouped by project | No |
| **Capture** | `/capture` (Appendix A(g)) — the one new route this section owns | Four full-width targets: Snag · Photo · Diary · Scan | n/a |

**Decision: these are three ordinary responsive routes inside the new `(work)` group, rendered from one component tree on both form factors.** The group placement is the load-bearing half of that sentence, not a filing detail: `(work)` is authentication-only with its own minimal shell (Appendix A(g)), so **a client viewer can reach these pages at all** — role decides what the list contains, never whether the page renders. Putting them in `(admin)` would have bounced exactly the audience the Inbox exists to serve. No `(work)` directory exists under `apps/web/src/app` today (verified: the groups present are `(admin)`, `(auth)`, `(legal)`, `(marketplace)`, `(portal)`, `(public)`, `(scan)`), so this is a new group beside them, not an edit to one.

No viewport-selected shell. A client-side `matchMedia` switch flashes the desktop layout on first paint and ships both trees in one bundle; a user-agent sniff in middleware breaks static optimisation; a CSS-only switch mounts both. The tab bar is a single element shown below 768 px and the desktop sidebar is hidden above it, both by media query. Touch behaviour (≥44 px targets, swipe-to-done, no hover-only affordance) is specified once in §04 and inherited.

Desk-shaped modules — cable schedule, tenant schedule, BOQ, valuations, JBCC, report generation, settings, template builder — render one card on a phone: the record's headline facts, a copy-link button, and "Open on a computer". Pretending a 1,200-column cable grid works at 390 px is how field tools earn the "clunky" reviews Fieldwire and PlanRadar collect.

**Cost: 1.0 engineer-week in Q1 — §13 Q1 item 10, which is the responsive shell and nothing else.** That item is sized 1.0 for this work alone; the four repairs in (g) are no longer booked against it and are §13 Q1 item 14. It is also re-sequenced by §13 to depend on **item 5 only** — the `(work)` group's shell, its 375 px breakpoints and its touch targets are the Inbox's, and My Work is three tabs inside that same shell — so it starts at in-window week 7.5 rather than waiting on item 6.

### (c) The day-end check-in — aimed at the two-day lag

Fifty-three diary entries carry a median two-day gap between `entry_date` and `created_at`, up to fourteen. The cause is visible in the form: `AddDiaryEntryForm.tsx` is an eight-field panel behind a "+ Add Entry" button, requiring free-typed progress notes, with weather as seven hardcoded strings defaulting to empty (`:11,39`) and `workers_on_site` a text box run through `parseInt` (`:75`). Nobody fills that at 16:30 on a phone, so they fill it on Thursday for Tuesday — and a diary written two days late is worth much less in a delay claim.

**Decision: a scheduled prompt at a user-chosen time, and a check-in completable in three taps. This lands in Q2, not Q1.** It is the last link on Q1's serial chain and the only cut that shortens it, so moving it buys path float in the shortest quarter and takes Open-Meteo — and its POPIA question — out of the quarter with the least room to answer one. It arrives in Q2 alongside install and web push, which is also when the prompt has a second channel.

- **Prompt.** Email at launch, web push once installed — both inside Q2 — at a per-user time (default 15:30 **SAST — South Africa is one time zone, so this is a constant, not a per-project setting**), only to `contractor`/`project_manager` roles on projects with activity in the last seven days. *"KINGSWALK — what happened on site today?"*, deep-linked into the check-in pre-scoped to that project and today.
- **Auto-weather.** Fetched server-side for the project's coordinates, pre-filled as an editable chip with conditions, min/max and rainfall — what a delay claim actually needs, replacing the hardcoded list. A check-in submitted the next morning reads yesterday's **reanalysis actuals**, not a stale forecast.
- **Labour count.** A stepper seeded with yesterday's number, not an empty field.
- **One-tap no-work-today.** A first-class answer writing `workers_on_site = 0` with a reason chip (rain / no access / public holiday / materials). A day with nothing on it is evidence; a gap in the diary is not.
- **The check-in *is* the diary** — it writes `projects.site_diary_entries` directly. Back-dating stays possible but is visibly stamped, so a late entry reads as late.

**The coordinates that do not exist yet.** `projects.projects` gains `latitude NUMERIC(9,6)` and `longitude NUMERIC(9,6)` in **Q2, with this item** (Appendix A(f) carries them in the Q2 column adds; they are the only place columns that do not travel to Q4 with (e), because the check-in cannot ship without them). They are geocoded once at project creation from `address`/`city`/`province` via Open-Meteo's free geocoding endpoint, with a manual pin override on project settings. For the fourteen existing projects the migration geocodes what resolves and leaves the rest NULL; a project without coordinates shows "Set site location" on its settings page and its check-in simply omits the weather chip. **We never invent a coordinate from a province name** — a wrong rainfall figure on a delay record is worse than a blank one.

The check-in **inserts one row into `public.notification_types`** for `diary_checkin_due` (Appendix A(c): Q2, Held tier, contractor/PM on active projects, at the user's chosen time). It does not re-declare a CHECK: Q1 item 4 retires `notifications_type_check` and replaces it with an FK against that table, and this item now lands in Q2, after it. That ordering is no longer a race to be reconciled — it is a dependency, and the migration that adds the type fails loudly against a missing table rather than silently against a stale constraint.

**Cost:** 1.0 engineer-week in Q2, including the geocode step — **§13 Q2 item 12**, which is Q1's former item 11 moved whole. **Recurring: Open-Meteo Commercial at €29/month (~R580), first needed in Q2 with this item** (Appendix A(i)). Their free tier is explicitly non-commercial and E-Site is sold software, so we pay for the licence rather than the volume — 14 projects × ~30 days is ~420 calls a month, inside any tier. **Open-Meteo transmits coordinates only — never a name, never a person, never a device id — so it is not an operator under POPIA §21 and no operator agreement is required.** That position is **recorded in writing** in the vendor register rather than assumed, because "we thought it processed nothing" is not a defence and the cost of writing it down once is a paragraph. §13's "no new third-party service" line is superseded by Appendix A(i), which is the register.

**Target (§15 metric 3):** the same-day diary rate is **instrumented in Q1 with its baseline published**, and reaches **≥60% by end of Q2** — the quarter the check-in ships. Q1 cannot move a number whose mechanism arrives in Q2, and publishing a baseline is the honest Q1 deliverable.

### (d) Voice-to-form — the control, not the extraction

**Decision: hold-to-talk fills the fields of the form in front of you, shows what it extracted, and saves nothing until you tap Save. This ships in Q3, with the `ai` schema.** Voice was previously drawn against Q2, which forced §10's instrumentation to exist a quarter before its schema; scheduling it into Q3 resolves that by moving the work, not by pulling a schema forward. §10.5 owns the extraction, the lexicon and the model; this section owns the control, the permission and the confirmation surface, and the two must not both specify the mapping.

First change is a header: `microphone=()` (verified at `apps/web/next.config.ts:149`) becomes `microphone=self`, in Q3, in the same PR as the control — not earlier, because an open microphone permission with no consumer is a widened attack surface bought for nothing. Audio posts to `POST /api/capture/transcribe` (Appendix A(g), Q3, `requireRoleAPI`, same-origin audio, discarded on return), so `connect-src` is untouched (`lib/security/csp.ts:29`).

Hold the mic on the check-in, the snag form or a QC entry; speak; release. **Every call goes through §10.1's gateway and lands in `ai.runs`** with `feature='voice'`, the model, tokens and an `outcome` of `accepted` / `edited` / `rejected` — which is also how this section's own quality bar (*fewer than 15% of extracted fields changed before Save*) becomes measurable rather than asserted. The `ai` schema is new in Q3 and carries three obligations that are not optional and are enumerated in Appendix A(f): the Management-API `db_schema` PATCH, a complete GRANT block, and the `config.toml` edit. A missing PATCH returns `PGRST002` across the entire REST API, which is how voice would take the platform down rather than merely fail.

Three hard rules. **Confirm before save** — the extraction renders as filled fields with a "heard as" line beneath each, and Save is the user's tap. **Audio is discarded once extraction returns**; we store values and a `captured_by='voice'` flag, not a recording, because a recording is discoverable and a diary is a legal document. **Unmatched speech lands verbatim in free text, never invented into a structured value** — inventing a plausible board name onto a safety record is the same class of error as the email that defaulted a null `as_left_status` to "made safe". Audio never leaves our origin from the browser; it does leave our server for a third-party STT, so **the STT endpoint must be a zero-retention tier under a signed operator agreement**. The vendor is unnamed today and is named by 30 November 2026 against two hard criteria — a zero-retention tier and an SA or EU processing region — with a POPIA §21 operator agreement and a §72 equivalent-protection undertaking signed **before the first call**. Appendix A(i) is the register; §15 open question 9 is the deadline.

Applied to diary, snag and QC only. Site forms and inspections are excluded: they are signed instruments with per-field regulatory meaning, and voice-filling 121 required answers is where a wrong extraction becomes a false SANS record.

**Cost:** 1.0 engineer-week for the control, the header change and the confirmation surface, inside **§14's Q3.9 line, *Voice-to-form and the `ai` schema*, 2.0**; the extraction sits in §10's half of it. **Recurring: reconciled to §10.5 and Appendix A(i)** — ~R0.11/minute STT plus a Haiku 4.5 mapping call. At ten times current volume (300 check-ins a month at 45 seconds) that is ~225 minutes ≈ R25 of STT plus roughly R15 of mapping: **under R50 a month**, still the cheapest high-leverage item in the programme.

### (e) Every capture carries a where

**Decision: no photo or snag is stored without a resolved place, enforced in the database by a constraint that cannot be satisfied by doing nothing. This lands in Q4.** It is the one capture item with no dependent above it — the check-in, the camera fixes and the QR labels all work without it — so it is the item that absorbs a quarter's move without breaking a chain.

**Appendix A(f) owns the column inventory.** It carries the place columns in the Q4 adds on **four tables** — `field.snags`, `field.snag_photos`, `projects.qc_entry_photos`, `field.form_photos` — with the `NOT VALID` place CHECK. `inspections.photos` is deliberately outside that set: it already holds `gps_lat`/`gps_lng` typed `NUMERIC(9,6)` (`00066_inspections_module.sql:150-151`) and an inspection photo inherits its place from the inspection it belongs to, so the invariant this section states covers snags, snag photos, QC photos and form photos. `projects.projects.latitude`/`longitude` ship a quarter earlier, in Q2 with (c).

What is unique to this section is the shape of the columns and the constraint, not the list. `ADD COLUMN IF NOT EXISTS` throughout, matching the house pattern at `00120_snag_site_visits.sql:61-62,77`:

```sql
-- Full set: field.snags, field.snag_photos, projects.qc_entry_photos
ALTER TABLE field.snags ADD COLUMN IF NOT EXISTS node_id UUID
  REFERENCES structure.nodes(id) ON DELETE SET NULL;
ALTER TABLE field.snags ADD COLUMN IF NOT EXISTS place_label     TEXT;
ALTER TABLE field.snags ADD COLUMN IF NOT EXISTS floor_plan_pin  JSONB;  -- already present on field.snags
ALTER TABLE field.snags ADD COLUMN IF NOT EXISTS gps_lat         NUMERIC(9,6);
ALTER TABLE field.snags ADD COLUMN IF NOT EXISTS gps_lng         NUMERIC(9,6);
ALTER TABLE field.snags ADD COLUMN IF NOT EXISTS gps_accuracy_m  NUMERIC;
ALTER TABLE field.snags ADD COLUMN IF NOT EXISTS place_source    TEXT
  CHECK (place_source IN ('qr','sticky','plan_pin','picker','gps'));

-- Partial set: field.form_photos already holds gps_lat/gps_lng
-- (00179_site_forms.sql:219-220, plain NUMERIC). It gets only what it lacks,
-- plus a type correction so the four tables agree:
ALTER TABLE field.form_photos ADD COLUMN IF NOT EXISTS node_id UUID
  REFERENCES structure.nodes(id) ON DELETE SET NULL;
ALTER TABLE field.form_photos ADD COLUMN IF NOT EXISTS place_label    TEXT;
ALTER TABLE field.form_photos ADD COLUMN IF NOT EXISTS floor_plan_pin JSONB;
ALTER TABLE field.form_photos ADD COLUMN IF NOT EXISTS gps_accuracy_m NUMERIC;
ALTER TABLE field.form_photos ADD COLUMN IF NOT EXISTS place_source   TEXT
  CHECK (place_source IN ('qr','sticky','plan_pin','picker','gps'));
ALTER TABLE field.form_photos ALTER COLUMN gps_lat TYPE NUMERIC(9,6);
ALTER TABLE field.form_photos ALTER COLUMN gps_lng TYPE NUMERIC(9,6);

-- After backfilling place_label on legacy rows, per table:
ALTER TABLE field.snags ADD CONSTRAINT place_present CHECK (
  node_id IS NOT NULL
  OR NULLIF(TRIM(place_label), '') IS NOT NULL
  OR (floor_plan_pin ? 'floorPlanId' AND floor_plan_pin ? 'x' AND floor_plan_pin ? 'y')
  OR (gps_lat IS NOT NULL AND gps_lng IS NOT NULL)
) NOT VALID;
```

Three details carry the design.

**`NOT VALID` is deliberate and is never validated.** It is the Postgres idiom that exempts existing rows while enforcing every insert and update from the moment it lands — exactly the semantics wanted, and the only honest one, because legacy rows genuinely have no place to record. A `DEFAULT 'inherited'` escape would have made the constraint satisfiable by omitting the column, which is a comment dressed as a guard: the same shape as the defects this section catalogues.

**`place_label TEXT` is the fallback disjunct, written at capture time** — the board code plus tenant name, or the plan name, or the formatted coordinate. This copies `00179_site_forms.sql:76-78,94-96` (`board_ref`/`board_label` beside `node_id`, with the comment *"deleting a board must not delete the record of having made it safe"*), and it is load-bearing rather than decorative: `ON DELETE SET NULL` fires an UPDATE that must satisfy the table's CHECKs, so without a text fallback, deleting a board whose only recorded place was that node would raise a check violation and **block the delete**. `hardDeleteTenantAction` (`apps/web/src/actions/tenant-delete.actions.ts:1-12`) hard-deletes tenant boards today; the invariant is therefore stated as *the place is recorded as text even when the node it pointed at is later deleted*.

**`projects.site_diary_entries` is deliberately outside the CHECK.** A diary entry is a day on a project, not a point in a building; none of the five resolution steps apply and forcing a coordinate onto it is theatre. It gets `gps_lat`/`gps_lng`/`gps_accuracy_m` as optional corroboration that someone was on site when they said they were, and nothing more.

**Resolution order, best first, because GPS is nearly useless where the work is** — a tenant DB in a service corridor has no sky view:

| # | Source | `place_source` | Taps |
|---|---|---|---|
| 1 | The QR scan that opened the screen names the node | `qr` | 0 |
| 2 | The node used within the last 20 minutes, offered as a chip: *"Still at DB-14?"* | `sticky` | 1 |
| 3 | A pin dropped on the current floor plan | `plan_pin` | 2 |
| 4 | Searchable node picker on `code` and `shop_name` (`00074_structure_schema_nodes.sql:40-49`) | `picker` | 2–3 |
| 5 | GPS, captured silently in parallel and stored *alongside* whichever won | `gps` | 0 |

GPS is corroboration by default and the sole answer only when nothing else resolves, in which case the accuracy radius is shown rather than hidden. This finally populates the two columns the PDFs have printed blanks from since those modules shipped, and gives snags the board link site forms already have — which is what lets a board's QR say "3 open snags". Step 1 depends on (f), which lands in the same quarter; steps 2–5 do not.

⚠ Re-check `max(version)` in `schema_migrations` **and** `origin/main` immediately before applying, announce the number to peer sessions, and read every altered table back afterwards. A green *Deploy DB Migrations* proves nothing: `db push` keys on the version prefix and prints "up to date" over a skipped file. Migration numbers are claimed at merge, never in this document (Appendix A(f)).

**Cost: 1.0 engineer-week in Q4** — the migration across four tables, the backfill, the resolution ladder and the override control. That figure is the item §13 published as its **Q2 item 9**, **plus the +0.5 correction** this section raised: the item was sized on the assumption that two columns are copied, and it is four tables, a type correction, a backfill and a five-step ladder. The correction travels with the item to Q4, where §14 carries it as **Auto-location on capture · M 1.0**, rather than being written off.

### (f) QR: a label per board, and a public board for everyone else

**Board labels (members), Q4.** The Avery L7173 sheet renderer exists (`apps/web/src/lib/cable-schedule/export-avery-labels.ts:14-50`) and the tag QR already encodes an app URL (`export-pdf.ts:1296`). Generalise it to a per-project sheet of `structure.nodes`, each label carrying the board `code`, tenant name and a QR to **`/site/board/[nodeId]`** — the ruled path, in the `(scan)` group (Appendix A(g)), a sibling of the existing resolver and reusing its auth-preserving redirect (`(scan)/site/tag/[text]/page.tsx:51`, which puts the scanned path in `?next=` so the user lands where they scanned rather than on `/site`; verified the only existing scan route). **§02 mechanic 17 is corrected to this path** and now cites it. It is a second code space keyed on `structure.nodes.id`: the existing `(scan)/site/tag/[text]` route resolves a `cable_schedule.cable_tags` row — a *cable* identifier — and conflating the two breaks both lookups. The page opens with the board's identity, then three gloved-thumb targets — **New snag here · Add photo here · Open board** — above its open snags, forms, inspections (`NodeInspectionsPanel` already mounts on the tag page, `:260`) and legend card. Anything captured from here is `place_source='qr'`.

**A board label is an identifier, not an index.** The QR resolves one node by id; the board code and tenant name printed beside it are for a human reading a sticker in a plant room. Neither the label, nor `place_label`, nor a markup row feeds a search index — **there is no search in this programme**, excluded by decision rather than deferred, and nothing in this section should be read as building toward one.

One URL defect is fixed in the same PR: `export-pdf.ts:1216` falls back to `https://app.e-site.live` when `NEXT_PUBLIC_SITE_URL` is unset — a hostname with no DNS record, so a mis-configured build prints a sheet of stickers that resolve nowhere. It becomes a hard failure at render time instead of a silent dead link. Separately, `packages/shared/src/services/qr.service.ts` — which defaults to `https://app.esite.co.za`, a domain we do not own — **is deleted rather than fixed**: it is re-exported at `services/index.ts:18` and imported by nothing in `apps/web`, `apps/mobile` or `packages`. A shared-constant refactor into dead code is work that buys nothing.

> **Designed, not scheduled.** The **public safety-observation board is cut past twelve months.** The reason is not the design, which is below and is sound: it is a **new unauthenticated write surface** — the highest-risk category this platform builds — **for an audience with no measured demand**. Nothing in the production evidence shows a labourer, shopfitter or centre manager trying and failing to reach us; the demand is inferred from a competitor's fence QR. A new anonymous write path is worth building when someone is measurably blocked by its absence. Accordingly, **`/observe/[token]` is not created and `PUBLIC_PATHS` in `apps/web/src/middleware.ts:5-20` is not amended** (Appendix A(g) records both as unchanged), and `field.public_observations` is not in Appendix A(f)'s table inventory.

**Public safety board (non-members) — the retained design.** A single A3 QR on the site board opening `/observe/[token]`, unauthenticated: photo, one sentence, optional name, submit, receive a reference number. This is Dalux's fence QR, and it is the only capture surface a labourer, a shopfitter or a centre manager will ever use.

The security posture is stated once and has no second reading. **`anon` holds no grant on `field.public_observations` at all** — `REVOKE ALL ON field.public_observations FROM anon, authenticated`, no `anon` RLS policy, no PostgREST path. An anon INSERT grant plus an edge function is not defence in depth; it is a bypass with a wrapper, and this platform has already shipped that shape twice (`/api/tenant-schedule/commit` writing with the service role behind a visibility-only check, and the role-blind read on every saved report). The only writer is an edge function that verifies the project token, checks a rate limit, caps payload size, and then writes **with the service role** — the posture `allocate_form_no` arrived at after its fix (`00179_site_forms.sql:314-326`).

| Concern | Decision |
|---|---|
| Rate limiting | `field.observation_rate_limits (token, ip_hash, window_start, count)`, upserted by the function under the service role; 5 submissions per IP-hash per hour, 50 per token per day, both returning a plain "try again later" page |
| Photo upload | A `public-observations` bucket, private, no `anon` policy. The function issues a short-lived signed upload URL into a `quarantine/<token>/` prefix and moves the object to `accepted/<observation_id>/` when a PM promotes it; unpromoted objects are swept after 30 days |
| EXIF | Already stripped for free — the canvas re-encode in `lib/image/compress.ts:25-39` discards all metadata, so this is an existing property to assert in a test, not new work |
| Triage | A PM promotes an observation to a snag or discards it. Until promoted it appears in the Inbox explicitly labelled untrusted, and it **never** inserts into `field.snags` |
| Tokens | Per-project, rotatable from project settings; rotation invalidates the printed sheet, which is the point |
| Place rule | Public observations are **exempt from (e)** — they land in `field.public_observations`, outside the four tables the CHECK covers. An anonymous observer is not asked to name a board, and GPS is optional |

Were it ever built, three files change alongside the code, all in the same PR: `PUBLIC_PATHS` in `apps/web/src/middleware.ts:5-20` gains `/observe` (without it an anonymous visitor is redirected to `/login` and the QR is dead on arrival), `docs/rbac-matrix.md` gains both routes, and `CONFORMANCE.md` records a new unauthenticated write surface. Every new function gets `REVOKE ... FROM PUBLIC` **and** an explicit revoke for `anon` — Supabase's `ALTER DEFAULT PRIVILEGES` grants `anon` directly at creation — verified with `has_function_privilege('anon', oid, 'EXECUTE')`, never by reading `proacl`.

**Cost:** board labels, the `/site/board/[nodeId]` page, the `export-pdf.ts:1216` fix and the `qr.service.ts` deletion are 0.5 engineer-weeks in Q4 — §14's Q4 line **QR board labels · S 0.5**, moved there from §13's former Q2 item 10. The public observation board carries no line in any quarter.

### (g) Camera and markup

**`capture="environment"` is added to all five inputs that lack it**, in Q1, so every capture path opens the camera the way inspections and forms already do:

| File:line | Surface |
|---|---|
| `projects/[id]/snags/visits/[visitId]/VisitDetail.tsx:581-582` | Add-snag-on-visit evidence field — **the reachable one** |
| `projects/[id]/snags/new/page.tsx:215` | Raise Snag |
| `snags/[id]/SnagPhotoUploader.tsx:119-120` | Evidence / close-out on an existing snag |
| `projects/[id]/diary/AddDiaryEntryForm.tsx:309-311` | Diary attachments |
| `components/diary/DiaryAttachmentStrip.tsx:159-161` | Diary attachment strip |

`VisitDetail` is listed first deliberately. PR #159 established that `/projects/[id]/snags` defaults to the by-visit lens, so that form is the snag-creation route a real user reaches; fixing only the library-visible files would reproduce the exact reachability failure #159 was raised to correct. The two diary inputs stay on the Q1 list even though (c) moves to Q2: the diary form is used today, badly, and a camera that opens a photo library is a defect independent of the check-in.

**The fourth orphan bug is fixed in the same item.** `snags/new/page.tsx:91-105` uploads the raw camera file and **never checks the `snag_photos` insert result** (`:97-104`), so a failed insert strands the storage object while the user sees success — the same class as the `photo_type:'defect'` bug that filled the bucket with orphans. That path is routed through the shared `uploadSnagPhoto` helper (`lib/image/compress.ts:56-95`), which compresses, uploads, inserts, and removes the object on insert failure.

**Compression de-duplicates to one import, not four.** The five copies are `lib/image/compress.ts:17` (canonical), `useFieldPhotos.ts:30`, `settings/branding/BrandingForm.tsx:19`, `projects/[id]/settings/general/_BrandingFields.tsx:15` and `lib/qc-photos.ts:147`. They are near-identical but not byte-identical — `compress.ts:14-15` hoists `MAX_WIDTH`/`QUALITY` to module scope where the clones inline them, and the comments differ. **The stated reason for the clones is already void:** `lib/image/compress.ts:5-7` declares itself dependency-free and side-effect-free *precisely* so importing it into a client component costs nothing beyond those few lines, which is the bundle-coupling argument the branding forms and `qc-photos.ts:140-146` were written against. All four import it. `downscaleImageBlob` (`qc-photos.ts:78`) **stays separate and is not a clone**: it targets a longest-edge ceiling because markups can be portrait or landscape, and re-encodes to PNG because a markup is line art over a plan (`qc-photos.ts:69-77`). Output MIME is asserted jpeg/png/webp before insert: `createImageBitmap` cannot decode HEIC outside Safari, `compressImage` then silently returns the original (`compress.ts:40-44`), and no PDF renderer can embed it.

**Delete stays two-tap and grows a real target.** The two-step confirmation at `InlinePhotoCapture.tsx:77-114` exists because `window.confirm` is silently suppressed in Safari — the interaction is kept and must not be reverted to a native confirm. The control as built is a 22 px circle pinned 2 px from the thumbnail corner (`:94-96`), which contradicts the phone-first premise and §04's ≥44 px target. **Decision: the idle `×` keeps its small visual footprint inside a ≥44 px padded hit area on touch viewports, and the armed state expands to a labelled "Tap to delete" pill** — the idle affordance stays visually quiet, the destructive one is unmissable.

> **Designed, not scheduled.** **`<PhotoMarkup>` and the first `markup` writer are cut past twelve months.** This section ranked it second in its own cut order and the ranking holds: an arrow drawn on a photo is a clarity improvement on evidence that is already legible, and it competes for Q3 against the report engine, which is the quarter's whole theme. The consequence is stated rather than hidden: **`photo_type='markup'` remains a legal value with no writer**, exactly as it has been since `00004_field_schema.sql:45-46` shipped, and that is now a known and accepted gap rather than an undiscovered one.

**The retained markup design.** `MarkupCanvas` (floor plans) and `QcMarkupDialog` (QC) already prove the interaction; a shared `<PhotoMarkup>` offers arrow, rectangle, freehand and text at fat-finger stroke width, flattens to PNG, and stores the result as a **second** row with `photo_type='markup'`, leaving the original untouched. The contract test guarding `photo_type` literals would be extended, **with the component and not before**, to assert a writer exists for *every* value in the CHECK set — the absence of one is precisely what hid the `closeout` deadlock. Extending that test while `markup` has no writer would fail the build on a defect nobody is scheduled to fix, which is a broken build, not a guard. Bytes continue to go browser → Storage, never through a Vercel function (`useFieldPhotos.ts:86-91`).

**Cost: camera attributes, the `snags/new` fix, the compression de-duplication and the delete target together are 0.5 engineer-weeks in Q1 — §13 Q1 item 14, *Capture-path corrections*, a numbered item of its own and no longer booked inside item 10.** These four touch five files that have nothing to do with the `(work)` shell and depend on nothing, which is why §13 splits them out and front-loads them: item 14 is the one item in Arno's lane that can be walked in week one while everything else is still gated. `<PhotoMarkup>` carries no line in any quarter.

### POPIA: what we capture, why, and what we never build

GPS, a prompted daily check-in and third-party processing are the three places a South African client's legal review stops. The position is stated in the product, not only in a policy page. **Appendix A(i) is the vendor register — cost, first-needed quarter and POPIA status per processor — and is not re-listed here.** What follows is the capture-specific position.

- **Location is corroboration of a work record, never employee tracking.** A coordinate is stored against the *artefact* — a photo, a snag — never against a person, never on a schedule, never in the background, and there is no query, report or export in this specification that returns "where was this user". Building one is out of scope by decision, not by omission.
- **Consent is asked once, in context.** The first time a capture would attach a coordinate, a one-line notice explains what is stored and why, with a decline that still saves the capture (falling back to the picker). An organisation-level switch turns location capture off entirely for all its members; the (e) constraint is still satisfied, by node or plan pin or `place_label`.
- **Retention follows the project record.** Coordinates live and die with the artefact they annotate; there is no separate location store to age out.
- **Two vendors, two different answers, both written down.** **Open-Meteo (Q2) receives coordinates only and no personal information, so it is not an operator and no operator agreement is required** — that conclusion is recorded in writing in the register rather than assumed. **The speech-to-text vendor (Q3) receives site speech that names people**, so it is an operator: a §21 agreement and a §72 equivalent-protection undertaking are signed before the first call, on a zero-retention tier, in an SA or EU region. Audio is not retained by us and must not be retained by them.
- **Public observers** would be told at the point of submission what is collected (photo, text, optional name, timestamp, IP hash for rate limiting), that it is visible to the project team, and that it is deleted after 30 days if not promoted; the IP hash is salted per token and never joined to anything. That obligation travels with the cut design in (f) — no anonymous submission surface exists inside the twelve months, so no such notice ships.

### (h) The Expo app: parked, still checked, revived only on evidence

**Decision: `apps/mobile` is frozen at 2.0.0, never published, and kept honest about what "parked" guarantees.**

It was never in a store and holds zero push tokens, so nothing is lost by parking it and a great deal is lost by maintaining two capture stacks with a three-person team. It stays in the monorepo because deleting it discards the two designs the retained web-queue design copies: the non-synced attachment queue with its five-retry cap and status column (`apps/mobile/src/inspections/attachment-queue.ts:56-75,109-118`, `upload-worker.ts:1-19`) and the three-state sync banner (`SyncStatusBanner.tsx:11-27`). The *patterns* port; the *code* does not — it is React Native, `expo-file-system` and PowerSync throughout.

What CI actually does, stated exactly: **`pnpm lint` and `pnpm type-check` run over `apps/mobile`** (`.github/workflows/ci.yml:34-38`; turbo fans out to the workspace's own `lint` and `type-check` scripts, `apps/mobile/package.json:9-11`). **Unit tests do not** — CI runs `pnpm test:ci` (`ci.yml:61-62`) and `apps/mobile` declares no `test:ci` script, only `test`. **No binary is built by anything**, because an Expo app is built by EAS, a paid remote service no workflow invokes. Revival therefore includes re-establishing an EAS build and a store presence from zero, and that is part of its cost, not a footnote to it.

Revival requires all three, measured: (1) installed-PWA weekly active contractors exceed 60% of active contractor accounts **and** a named capability the PWA cannot deliver is blocking them — true background upload and BLE test-instrument capture are the only candidates; (2) that gap costs more than one FTE-month per quarter in workarounds; (3) a paying customer asks for a store presence in writing. Absent all three, the next commit to that tree is its deletion.

**This carries no engineer-week line.** It is a decision taken at the end of Q4 against three measurements the programme already produces, not a work item; pricing it would put a number in the ledger for reading a dashboard.

### Sequencing and the capacity reconciliation

The capture layer holds no independent budget. Every line below sits inside a quarter's committed total, named by its §13 or §14 item where one exists.

| Quarter | Capture items | Engineer-weeks | Ledger line |
|---|---|---|---|
| **Q1 · Every day starts here** | Three responsive routes in the new `(work)` group and the tab bar (b) | 1.0 | §13 Q1 item 10, the shell alone — depends on item 5 only, starts week 7.5 |
| | `capture="environment"` on five inputs; `snags/new` routed through `uploadSnagPhoto`; four `compressImage` clones deleted; delete target padded to ≥44 px (g) | 0.5 | §13 Q1 item 14, *Capture-path corrections* — its own numbered item, depends on nothing |
| | **No manifest, no service worker, no offline queue — and no new edge function** | — | §13 Q1 item 10, explicit |
| | **Q1 capture total** | **1.5** | across two §13 items, not one |
| **Q2 · One conversation per project** | Day-end check-in, auto-weather, no-work-today, project geocode, `diary_checkin_due` row (c) | 1.0 | §13 Q2 item 12 — Q1's former item 11, moved whole |
| | Middleware matcher gains `.webmanifest` and `/sw.js`; read caching scope (a) | — | inside §13 Q2 item 1, §05's install-and-web-push line |
| | **Q2 capture total** | **1.0** | |
| **Q3 · Reports write themselves** | Hold-to-talk control, `microphone=self`, confirmation surface, `POST /api/capture/transcribe` (d) | 1.0 | inside §14's Q3.9, *Voice-to-form and the `ai` schema*, 2.0 |
| | **Q3 capture total** | **1.0** | |
| **Q4 · Planning and control** | Place migration on four tables, backfill, resolution ladder, override control (e) | 1.0 | §14 Q4, *Auto-location on capture · M 1.0* |
| | Board QR labels, `/site/board/[nodeId]`, `export-pdf.ts:1216` fix, `qr.service.ts` deleted (f) | 0.5 | §14 Q4, *QR board labels · S 0.5* |
| | Expo delete-or-revive decision against the three tests (h) | — | a decision, not a line |
| | **Q4 capture total** | **1.5** | |
| **Cut past twelve months** | Offline write queue and the three `/api/capture/v1/*` routes (a) · `<PhotoMarkup>` and the first `markup` writer (g) · public safety-observation board (f) | — | each retained behind its banner, in its own subsection |

**The reconciliation.** This section raised exactly two corrections to §13's published ledger and neither is absorbed silently: **+0.5 on the PWA/offline item**, because a write queue is real work on top of §05's manifest, service worker and VAPID; and **+0.5 on the place migration**, because it is four tables, a type correction, a backfill and a five-step ladder rather than two copied columns. The first is **withdrawn with the queue it priced**, which is cut. The second **stands and travels with its item to Q4**, where the place migration is carried at 1.0.

**A third correction was owed in the other direction, and §13 has taken it.** Q1's 1.5 was previously written against a single 1.0 line — (b)'s shell and (g)'s four repairs both cited item 10 — which put 1.5 weeks of work into a 1.0 item in a lane with no float. **(b) and (g) are two items, not one:** the shell is item 10 and the repairs are item 14. Q1's capture total does not change; what changes is that it is now booked where it is actually spent, and the two are genuinely separable — the shell is gated on the Inbox and cannot start before week 7.5, while the repairs touch five files that depend on nothing and are walked in week one.

Capture therefore draws 1.5 in Q1, 1.0 in Q2, 1.0 in Q3 and 1.5 in Q4 — 5.0 weeks across the year, all inside quarters that now fit. Three consequences reach other sections rather than being buried here: §15 metric 3's Q1 target is **"instrumented, baseline published"** with ≥60% at Q2, because the check-in moved; the **voice-and-GPS exit criterion moves to Q4**, the first quarter in which both halves are true; and Q1 introduces **no new edge function from this section**, so no Q1 capture deliverable waits on the workflow-scoped token that `deploy-edge-functions.yml` still needs.

If a quarter runs short, the cut order inside capture is **QR board labels first** (Q4, 0.5 — the labels are a convenience over a picker that already works), then nothing. The check-in, the camera fixes and the place migration are not cuttable: they are the reason a contractor opens the application at all.
