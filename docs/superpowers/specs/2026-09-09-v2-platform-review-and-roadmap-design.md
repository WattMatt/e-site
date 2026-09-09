# E-Site v2 — platform review and 12-month roadmap (design)

**Date:** 2026-09-09
**Status:** Design, pending approval
**Detail:** [`2026-09-09-v2-platform-roadmap/`](2026-09-09-v2-platform-roadmap/) — sixteen sections, ~127 000 words, plus five market-research files
**Registries:** Appendix A ([`16-appendix-registries.md`](2026-09-09-v2-platform-roadmap/16-appendix-registries.md)) is the source of truth for every shared table, type and token

This document stands alone. It states what is wrong, what we learned from the best products in the
world, what v2 is, what ships when, what it costs and how we will know whether it worked. Everything
below is settled in the detailed sections; nothing here is a summary of an open question.

---

## 1. The problem, measured

E-Site is large and mostly unused. Against the live database on 9 September 2026:

| Signal | Value |
|---|---|
| Accounts | 36, of which 27 are in WM's own organisation |
| Signed in, last 7 / 30 days | 3 / 6 |
| Contractor accounts active in 30 days | **0 of 13**; four have never signed in at all |
| Client viewers, last sign-in | 8 July 2026 |
| Authentication events, July then August | 91 across 28 users, then **2 across 1 user** |
| Notifications sent, ever read | **964 / 57**, and 750 of the 964 are one type |
| RFIs with an assignee | **0 of 15** |
| Site-diary median lag, entry date to logged | **2 days**, maximum 14 |
| Snag photos, ever | **0** |
| Inspections completed | **0 of 18**; all still sit at `assigned` |
| Push tokens registered | **0** |

Five findings explain it, and each is evidenced in [§01](2026-09-09-v2-platform-roadmap/01-summary-and-current-state.md).

1. **Nothing is ever assigned, so nobody owes anything.** No route and no query anywhere in the
   monorepo reads work by assignee. `assigned_to` exists on RFIs and is null on every row.
2. **The notification firehose is unread.** One type is 78% of all volume, `read_at` has existed
   since the first migration and nothing has ever written it, and the only outbound engine that runs
   on a schedule is a churn nudge.
3. **Site capture has no installable phone surface.** The Expo app was never published, so zero
   people have it; the one uploader that matters opens a file picker rather than a camera.
4. **The modules that thrive are the ones WM must maintain for its own work** — tenant schedules,
   cable schedules, floor-plan sync, equipment and materials. Nothing gives a contractor or a client
   the same daily reason to open the app.
5. **Six of fourteen projects are empty shells**, each opening onto sixteen navigation entries and a
   cabinet of empty drawers.

The diagnosis is not that features are missing. It is that the product is organised around modules
rather than around anyone's day.

---

## 2. What the best products do

Five research streams covered field-first apps, enterprise platforms, work-OS tools, trade and South
African software, and AI-native construction startups. Ten patterns recur; [§02](2026-09-09-v2-platform-roadmap/02-competitive-synthesis.md)
carries all of them with the 25 specific mechanics worth stealing.

- **Ball-in-court is computed and never null.** Procore, Autodesk and Aconex derive who owes the next
  move from workflow state rather than asking a user to assign, and default the due date from a
  per-type "days to respond". Aconex can make a response requirement mandatory at mail-type level.
- **The front door is a personal inbox that can reach zero.** Basecamp's Hey!, Linear's Inbox,
  Procore's My Open Items. The activity firehose lives somewhere else on purpose.
- **Email is a participation channel, not a pointer.** Reply-by-email posts to the record, a recap
  arrives before the day starts, nothing is emailed that was already seen in-app, and the assignment
  mail always sends.
- **External parties never pay and never need an account.** PlanRadar, Dalux, Raken, Novade and
  Procore all give the network away and charge the buyer.
- **Capture removes decisions.** Voice fills the form, GPS or a QR decides where a photo goes,
  weather fills itself, and an end-of-day prompt arrives at a time the user chose.
- **The deliverable is a branded PDF nobody has to write** — scheduled, filtered per recipient,
  composed from structured events.
- **Compliance is enforced by gates, not reminders.** Simpro's red outstanding-readings strip;
  ServiceM8's mandatory forms.
- **Price the network, not the seat, and publish the price.** Billing surprise is the top complaint
  against every competitor in the set.

Three positions are defensible and unclaimed in South Africa, and they are E-Site's moat:

1. **No product links a SANS 10142-1 certificate to the installation data.** E-Site already holds the
   distribution-board register and cable schedule that certificate apps make electricians retype.
2. **No SA tool issues JBCC-compliant instructions or an electronically submitted site diary.** The
   practice note says a minute-book entry is not good practice, and email dominates by default.
3. **Tenant coordination at SA landlords is spreadsheets plus hired project managers.** Nothing links
   tenant to shop distribution board to certificate to occupation certificate.

We are deliberately not copying computer-vision progress tracking or 360-degree capture. Both need
BIM, a schedule, hardware and human verifiers, and the vendors that sell them still employ people to
check the output.

---

## 3. What v2 is

**E-Site v2 is the daily workspace for a project.** Everything on a project is a work item addressed
to one person with a date, every item has a conversation, and the reports write themselves from what
was captured during the day. That is what displaces monday.com, WhatsApp, Teams threads, emailed
trackers and Word reports at once, rather than one tool at a time.

Six primitives are built once and inherited by every module.

| # | Primitive | What it settles | Section |
|---|---|---|---|
| 1 | **Work items** | One assignee, a defaulted due date, a generated ball-in-court that is never null while an item is open, and a per-project triage queue for unowned inbound | [§03](2026-09-09-v2-platform-roadmap/03-work-items.md) |
| 2 | **Inbox and My Work** | A two-tab inbox that can reach zero, a cross-project list in four date buckets, and a project home of open-item counts | [§04](2026-09-09-v2-platform-roadmap/04-inbox-and-my-work.md) |
| 3 | **Notifications and email** | Urgency tiers held as data, presence-aware suppression, a 07:00 recap, and reply-by-email | [§05](2026-09-09-v2-platform-roadmap/05-notifications-and-digests.md) |
| 4 | **Threads and correspondence** | Mentions on any entity, plus numbered immutable contract instructions and a drawing register with transmittals | [§06](2026-09-09-v2-platform-roadmap/06-threads-instructions-minutes.md) |
| 5 | **The report engine** | One harness behind every PDF, periodic reports, register packs, scheduled distribution | [§07](2026-09-09-v2-platform-roadmap/07-report-engine.md) |
| 6 | **Calendar and programme** | Every dated object on one calendar, the tenant delivery tracker, procurement lead-times | [§08](2026-09-09-v2-platform-roadmap/08-calendar-and-programme.md) |

Two enablers sit under them. The **capture layer** ([§09](2026-09-09-v2-platform-roadmap/09-capture-and-phone.md))
makes the phone useful without an app-store install: a responsive shell in Q1, then an installable
progressive web app with push, a day-end check-in, voice-to-form and a location on every photo. The
**AI layer** ([§10](2026-09-09-v2-platform-roadmap/10-ai-layer.md)) removes chores and never makes
decisions: a chase agent that nudges the person who owes the answer, narrative drafting for reports a
human then edits, and voice extraction. Everything it produces is reviewable before it leaves.

**The work-item spine is a mirror, not a migration.** Live RFIs, snags, QC defects, inspections,
diary actions and forms keep their own tables and gain a mirrored row carrying assignee, due date and
ball-in-court. Nothing destructive touches production data to get the primitive.

---

## 4. Who pays, and who does not

The current model prices four tiers with user limits that are declared in code and read nowhere. No
one has ever bought a feature unlock and no money has ever moved through the marketplace. v2 replaces
it with four bands on active projects, published in rand, with every external participant free.

| Package | Active projects | Monthly incl. VAT |
|---|---|---|
| Free | 1 | R 0 |
| Practice Solo | up to 3 | R 2 450 |
| Practice | up to 12 | R 6 900 |
| Practice Unlimited | unlimited | R 12 900 |
| Archived project | — | R 0, read and export |
| **Every external participant** | — | **R 0** |

Contractors, client viewers, guests and email-only participants are never billable, so a
contractor's procurement department can never block adoption. Bands are evaluated at renewal only, so
a busy month never produces a surprise charge. Banding is also the only model the current billing
stack can actually charge: `billing.subscriptions` is unique per organisation with one fixed amount,
and Paystack plans carry no quantity dimension, so per-project pricing would need a new table, a
nightly recompute and a separate charging path. [§11](2026-09-09-v2-platform-roadmap/11-access-roles-pricing.md)
carries the full role model and the migration.

---

## 5. The twelve months

Four quarters, each with a theme, a falsifiable proving outcome and a cut order published before the
quarter starts.

### Q1, October to December 2026 — "Every day starts here"

The work-item spine with computed ball-in-court and a triage queue; RFIs, snags, QC defects,
inspections, diary actions and forms mirrored onto it; the Inbox and My Work as the post-login
landing for every role; the notification engine rebuilt with urgency tiers, presence-aware
suppression and always-fires rules; the 07:00 recap; module toggles and the sidebar declutter; a
phone-usable web shell; free contractor and watcher access; and metric instrumentation with an
October baseline.

**Proving outcome:** a foreman closes a snag on his phone, and the 07:00 recap is the first thing
E-Site does for him — arriving by email, on the device he already has, with nothing to install.

### Q2, January to March 2027 — "One conversation per project"

Threads and mentions on every entity with a separate activity feed; reply-by-email; contract
instructions as numbered, immutable, receipt-acknowledged correspondence; the document version store
and the Dropbox sync rewrite behind it; the project home rebuild; the day-end diary check-in with
auto-weather; and the installable progressive web app with web push and quiet hours.

**Proving outcome:** a March dispute is answerable from E-Site alone — who was instructed, when,
against which drawing revision, and acknowledged by whom.

### Q3, April to June 2027 — "Reports write themselves"

The report engine harness with the seven live filers ported onto it; the weekly project report; the
RFI register and snag list by round; scheduled distribution with per-recipient filtering and guest
links; the chase agent with its escalation ladder; the client portal consolidated into three
surfaces; voice-to-form with the AI schema; the transmittal issue flow; and the drawing register
surface arriving from Q2.

**Proving outcome:** in June, every weekly pack on the five live projects issues on its scheduled
date without anyone pressing a button, and no project report is authored in Word.

### Q4, July to September 2027 — "Planning and control"

The programme calendar with milestones, lookahead and a subscribable feed; the tenant delivery
tracker from lease to occupation certificate with a landlord view; procurement lead-times against
beneficial-occupation dates with a late-order digest; the monthly client report with narrative
drafting; valuations activated; the portfolio view with response-time metrics; auto-location and QR
board labels; and the published pricing cutover.

**Proving outcome:** a landlord opens the monthly pack and sees which shops will not hand over on
time, with the reason.

### What deliberately slips past twelve months

Meeting minutes, email-to-item, photo pre-classification, the offline write queue, plan markup, the
public safety-observation board, site-forms v1.2 with device-bound signing, the daily site report,
cited structured question-answering, the post-handover asset register, and several report packs.
Each is retained in its designing section behind a banner, so a later quarter picks it up rather than
redesigning it. **Search is excluded by decision, not deferred.** Native app-store publication stays
out; the Expo app is parked, still buildable, and revived only on evidence.

---

## 6. Can it be built?

The honest answer required re-planning. The first pass committed roughly 94.5 engineer-weeks against
74.2 available, a nineteen-week overrun concentrated in Q3. After arbitration:

| Quarter | Committed | Available | Float on total | Longest serial chain |
|---|---|---|---|---|
| Q1 | 17.0 | 18.8 | 1.8 | 11.5 weeks, 0.5 float |
| Q2 | 14.0 | 15.0 | 1.0 | 7.5 weeks, 1.9 gross / 0.4 free |
| Q3 | 19.75 | 20.2 | 0.45 | 10.5 weeks, 2.1 gross / 0.1 free |
| Q4 | 19.5 | 20.2 | 0.7 | 10.0 weeks, 2.6 gross / 0.35 free |
| **Year** | **70.25** | **74.2** | **3.95** | — |

Capacity deducts South African public holidays on one method across all four quarters.

**The binding constraint is the chain, not the total.** Q1's critical path is 11.5 strictly serial
engineer-weeks walked by one person. A cut that is not on the path does not shorten the quarter, so
Q1's cut order is published as two lists: path cuts and total-only cuts. This is why the diary
check-in moved to Q2 — it was the last link on the chain and the only cut that shortened it.

**The whole plan is conditional on one thing, and it is a gate rather than a question: funding for a
contract engineer, at R110 000 per month from 14 September 2026.** At Arno's 0.6 FTE alone, Q1 is
about six in-window engineer-weeks, which buys the spine and the notification engine and nothing
else. The correct response to a funding failure is to re-plan, not to run this plan at a third of
capacity. *This document is dated 9 September 2026 and the gate date has passed without a recorded
answer, so it is now an immediate item.*

### Cost and the commercial case

| Item | Amount |
|---|---|
| Contract engineer, pre-window plus four quarters | R 1 397 000 |
| Arno's time, costed | R 864 000 |
| Legal, POPIA operator agreements and the client data annexe | R 45 000 |
| **Total** | **R 2 306 000** |
| Per delivered engineer-week | R 32 826 |
| Break-even | R 192 167 per month, or 32 Practice organisations |
| Internal saving inside the window | R 342 000 to R 456 000, 14.8% to 19.8% |
| First full year, after the monday.com cancellation | R 423 000 to R 537 000, 18% to 23% |

Committed AI running cost is about R11 per active project per month, roughly R55 across the five live
projects. The programme does not pay for itself on internal saving alone; metric 8 below is the part
that has to work.

---

## 7. How we will know

Eight metrics, each with a definition, a baseline measured on 9 September 2026 and a target per
quarter. [§15](2026-09-09-v2-platform-roadmap/15-metrics-risks-open-questions.md) carries the exact
definitions and the instrumentation.

| # | Metric | Baseline | Q1 | Q2 | Q3 | Q4 |
|---|---|---|---|---|---|---|
| 1 | Weekly active users / accounts | 3 of ≤35 | 35% | 50% | 60% | 65% |
| 2a | Contractor accounts active weekly, frozen cohort | **0 of 13** | 6 | 9 | 11 | ≥10 for 8 straight weeks |
| 3 | Diary entries logged same day | ≤50% | instrumented | 60% | 80% | 85% |
| 4 | Median working days to answer an RFI | censored, ≤5 of 15 ever answered | ≤7 | ≤5 | ≤4 | ≤3 |
| 5 | Inbox engagement | unmeasurable; 5.9% is the pathology | 35% | 50% | 60% | 70% |
| 6 | Report schedules per active project | 0 | instrumented | instrumented | ≥3 on every project | ≥3 sustained |
| 7 | Activation, first item closed in first session | not measurable | 35% | 45% | 55% | ≥60% |
| 8 | **Signed paying organisations** | **0** | instrumented | 0 | 1 letter of intent | **2 paying** |

Three baselines are bounds rather than points, and the spec says so rather than inventing a number.
Metric 5 in particular has no honest pre-release value: nothing has ever written `read_at`, so the
5.9% read rate is the pathology, not a baseline.

### Rollout

KINGSWALK is the pilot — the only project dense across every living module. Snags move there or stay
dead. The beachhead is Siyaya Power, who raised 11 of the 15 RFIs, and the contractor who wrote 36 of
the 53 diary entries; one query settles whether they are the same person before any visit is booked.
Wave 1 is a single on-site session leaving one daily obligation, the end-of-day check-in, and it ends
with the recap landing on the foreman's phone. There is no install in Q1 because there is nothing to
install; the install is a Q2 follow-up visit. WM staff live with the same inbox one release before
they ask contractors to open it. Client viewers activate in Q3, with the portal rebuild, because
activating a cohort against a surface that does not exist teaches them the invitation was premature.

### The risks that matter

| Risk | Mitigation |
|---|---|
| Contractors still do not adopt | Email participation without login; one obligation, not a module; free forever; metric 2a reviewed weekly, three flat weeks trigger a site visit rather than a feature |
| The notification rebuild loses a critical alert | Two-week shadow run writing what it *would* send to a diff table while the old path keeps sending; safety-gated escalations exempt from quiet hours and mute |
| Reply-by-email is spoofed | DKIM alignment, envelope-sender match and live project access, all three required; per-recipient tokens; a per-project kill switch |
| The migration damages live data | The spine is a mirror; no destructive write to live RFI or snag rows; pre-migration snapshots on all eight destructive migrations |
| An AI draft issues something wrong to a client | Nothing is issued unreviewed; drafting is a chore-remover, never a decision-maker |
| The team is too small | The gate above, plus a published cut order per quarter decided in the first week of the quarter's last month |

---

## 8. Decisions needed from Arno

| # | Question | By |
|---|---|---|
| 1 | **Contract engineer funding** — the go/no-go gate | **Immediately; the date has passed** |
| 2 | Three deploy prerequisites: confirm the two repository secrets by reading them, obtain a `workflow`-scoped token or nominate an editor, and delete or restore the `generate-report` step that names a function with no directory | Before the engineer starts |
| 3 | WM's organisation record still has no registration number, so the required field cannot prefill on any site form | Immediately |
| 4 | Which Siyaya foreman is the pilot author, and does their principal endorse it | 15 October 2026 |
| 5 | Inbound mail transport, Cloudflare or Resend. The hostname is fixed now because it is the irreversible half | Q1 week 1 |
| 6 | monday.com contract term, renewal date and annual value | 31 October 2026 |
| 7 | Name the speech-to-text vendor. Zero retention and an SA or EU region are pass/fail | 30 November 2026 |
| 8 | Who sells, to whom, through what motion — metric 8 stays at zero by omission otherwise | 31 January 2027 |

A dated obligation rather than a question: the POPIA operator agreements with every foreign processor
and the client data annexe are signed before 1 April 2027, ahead of the first client data reaching a
foreign operator. They are priced as a legal fee and deliberately kept off the engineer-week ledger,
because charging them there makes them look optional the first time a quarter runs tight.

---

## 9. Provenance

Fifteen sections were drafted in parallel against the live codebase and the production extract, each
adversarially critiqued and revised. Three whole-document sweeps then found 58 contradictions and 46
gaps, which an arbitration pass resolved into 53 rulings, a canonical registry appendix and the
capacity re-plan above. Two further verification rounds closed the residue. Every claim about current
behaviour is cited to a file and line; every claim about production is cited to a measured query.
