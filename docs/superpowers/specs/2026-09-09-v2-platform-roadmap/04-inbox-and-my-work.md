## Primitive 2 — Inbox, My Work and the new project home

### The front door today, and the precise reason it fails

**`/dashboard`.** All ten queries are keyed to the caller's organisation, never to the caller (`apps/web/src/app/(admin)/dashboard/page.tsx:22-108`); `user.id` is used only to find the oldest active membership (22-31). Nothing on the landing page is addressed to the person reading it. The KPI row (163-190) shows **Active Projects** (14, six of them empty shells), **Open Snags** (6, all on one demo project), **Awaiting Verification**, and behind an env flag **Active Orders** (2, dead since April). The "Action required" block (193-410) is org-wide SLA, not personal — `getAgingSnags` filters on `organisation_id` (`packages/shared/src/services/sla.service.ts:86-92`), as do the three inspection cards. The consequence is measurable: `getStaleDraftInspections` (`sla.service.ts:171-188`) selects `assigned`/`in_progress` inspections older than 14 days, which is **all 18 in production**. That card has shown 18 identically to 27 accounts for months and nobody has cleared one, because it belongs to nobody. Below sit Upcoming Deadlines (418-458), the same six snags again (461-489), and three quick actions — four when `NEXT_PUBLIC_PHASE_2_MARKETPLACE` is on (530-536) — that create work without assigning it.

**`/projects/[id]`.** Four KPI cards — Open Snags, Pending Sign-off, Closed Snags, Open RFIs (`apps/web/src/app/(admin)/projects/[id]/page.tsx:80-97`) — reading zero on thirteen of fourteen projects, then a Details panel (105-125), Recent Snags, Recent RFIs (hidden entirely when empty, line 156) and Team chips (181-216). **The two modules that are actually alive — tenant schedule, 265 rows in 30 days, and floor-plan versions, 201 — appear nowhere on it.** Neither page reads `assigned_to` on any table, so no user has ever been shown what they personally owe.

**The bell.** `NotificationCentre` fetches the newest 30 rows, unfiltered and untabbed (`apps/web/src/components/ui/NotificationCentre.tsx:39-47`); the only bulk verb is Mark all read (49-58) and the empty copy is "No notifications" (176). It is a firehose because `notifyEntityEvent` fans every event to the whole project roster minus the actor (`apps/web/src/lib/notify.ts:32-39`): 53 diary entries of type `diary_created` (`apps/web/src/lib/diary-email.ts:83`) across a ~14-person roster is the 750 of 964. 57 reads is the correct human response to a feed that cannot reach zero.

### (a) The Inbox — `/inbox`, the post-login landing for every authenticated person

**Decision: `/inbox` and `/my-work` live in a new shared `(work)` route group that sits beside `(admin)` and `(portal)`, gates on authentication only, and renders its own minimal shell.** Role decides what is *in* the list, never whether the page renders — see Appendix A(g) for the route table. There is exactly one Inbox implementation and every audience opens it: a WM engineer, a contractor foreman and a landlord's asset manager all land on the same route, the same component tree and the same query, differing only in what that query returns to them and which verbs the row exposes.

`(admin)/layout.tsx:29` (`if (ctx?.role === 'client_viewer') redirect('/portal')`, verified) and `(portal)/layout.tsx:22` (`if (ctx.role !== 'client_viewer') redirect('/dashboard')`, verified) are amended in the same PR as §11.5's portal gate re-cut, so that neither layout claims `/inbox` or `/my-work` and both bounce on the same per-project predicate. Three sections edit those two files in the same quarter and this is the single end state they all write to; §11.5's move from the org role onto `user_effective_project_role(project_id)` is the change that makes the `(work)` group safe, because a project-scoped client viewer must reach the Inbox without first satisfying an org-wide role test.

#### The store — the load-bearing decision

**Decision: the Inbox is a UNION of two halves with two different stores, because more than half of what qualifies as Priority is *state*, not an event.** Notifications are written once, at the moment something happens (`apps/web/src/lib/notifications.ts:26-56`; `apps/edge-functions/supabase/functions/send-notification/index.ts:89-100`). No row exists at the instant an item crosses its due date or a gate flips, and `public.notifications` carries only `entity_type`/`entity_id` with **no `project_id` and no link to ball-in-court** (`00001_initial_schema.sql:139-153`). An inbox built purely on that table can never show an overdue item and can never auto-clear one.

| Priority criterion | Half | Why |
|---|---|---|
| Ball-in-court is me | **State** | The gate flips with a status write; nothing notifies the new holder a second time |
| An item assigned to me is due today or overdue | **State** | Crossing midnight writes no row anywhere |
| A signature, verification or approval waits on me | **State** | It *is* a status — Primitive 1's `answered` resolves BIC to `gatekeeper_id` |
| @mention of me | Event | One moment, Primitive 3 |
| An item I raised was answered, closed or rejected | Event | A transition |
| A workflow gate blocked a submission I own | Event | A transition |
| An item I assigned is untouched at 14 days | Event, minted by a scheduled sweep | Precedent `apps/edge-functions/supabase/functions/calculate-health-scores`. In Q1–Q2 it reaches the assigner as recap section 2 and as My Work's *Waiting on others* tab; from Q3 the chase sweep on §10.2's ladder is its only producer, per Appendix A(c) |

**Half A — state.** A query-time read over Primitive 1's spine: `projects.work_items WHERE ball_in_court_id = auth.uid() AND status IN ('triage','open','answered')`, served by Appendix A(a)'s `(ball_in_court_id, due_date)` partial index. Everything in this half is Priority by definition, which removes any per-row classification. Per-user dismissal state lives in its own table, because a derived row has no notification id to hang it on:

```sql
CREATE TABLE public.inbox_state (
  user_id       uuid NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
  work_item_id  uuid NOT NULL REFERENCES projects.work_items(id)  ON DELETE CASCADE,
  snoozed_until timestamptz,
  done_at       timestamptz,
  seen_at       timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, work_item_id)
);
```

Rows are written lazily — only when the user snoozes, opens or dismisses — so the table is a fraction of users × items, not the product. **Absence of a row means live and unread.** The key is typed rather than a polymorphic `(item_kind, item_id)` pair for the reason Primitive 1 gives for rejecting polymorphic source keys: an orphaned row in a personal inbox is an item you cannot open, which is the worst failure this primitive can have. A second derived kind costs one nullable FK column. The table is **never purged** — §12 §(f) rules that its rows die with their work item or their user through the `ON DELETE CASCADE` on both FKs above, because a dated purge would silently deflate the `done_at` half of §15's metric 5.

**Auto-done** is an `AFTER UPDATE` trigger on `projects.work_items`: when `ball_in_court_id` changes or `status` moves to `closed`/`void`, upsert `done_at = now()` for the **outgoing** holder, and delete any prior row for the **incoming** holder so an item that comes back resurfaces unread. Answering an RFI clears its row from your Inbox and opens it in the asker's, with no second gesture from anyone.

**Half B — events.** After §05, `public.notifications` carries strictly *things aimed at a person*, and this half is a read over it. **The columns are §05's, not this section's**, and this section adopts them rather than proposing a parallel set: `tier` (`immediate` | `held` | `recap`) in place of a `priority` boolean, `dedupe_key` in place of `group_key`, `seen_at` / `read_at` / `cleared_at` in place of `is_read` — which §05 drops, in its stated three-step sequence — plus `project_id` and `actor_id`. **`done_at` survives on `public.inbox_state` only**: the state half needs a per-user dismissal timestamp because a derived row has no notification id to hang one on, and the event half does not, because §05 already gives every row three server-written timestamps. That boundary is what makes §15's metric 5 a union across the two halves rather than one expression over one table — stated exactly under **Read model** below, because a headline target rests on it. `project_id` is not optional decoration — every project filter, every project mute and the recap's grouping key on it, and the table has carried only `entity_type`/`entity_id` since `00001_initial_schema.sql:139-153`. The type vocabulary and each type's tier are Appendix A(c)'s registry, reached by FK from `notifications.type`; nothing here re-declares `notifications_type_check`, because after Q1 that constraint does not exist.

**The consequence for this surface, stated, because it changes what the Other tab *is*.** Recap-tier events write `projects.activity` and **never** `public.notifications` (A(c)). So the Other tab is not a second notification list that needs its own roll-up key — **it is a view over the activity feed, and its project × day × type roll-up is the feed's own grouping**, maintained by the feed's triggers rather than by a `group_key` this section writes. The 750 `diary_created` rows are not rolled up after the fact; they stop being fanned out to fourteen personal inboxes at all.

**Per-recipient classification — a Q1 cost, stated.** The same event is Priority for the RFI raiser and feed-only for the other twelve roster members, and the current writer cannot express that: `NotifyArgs` takes `userIds: string[]` with one title and one type (`apps/web/src/lib/notifications.ts:12-24`) and the edge function maps that payload identically across users (`send-notification/index.ts:89-99`). `NotifyArgs.userIds` becomes `recipients: Array<{ userId: string; tier: NotificationTier; dedupeKey: string }>`; `send-notification` builds `inAppRows` from that array; `notifyEntityEvent` (`lib/notify.ts:32-39`) classifies the roster into ball-in-court holders versus FYI before dispatch, and the FYI side writes the feed instead of a notification. That touches **eleven `dispatchNotification` calls across five action files** (`rfi.actions.ts:86,163,219`; `qc.actions.ts:445`; `snag.actions.ts:107`; `inspections-certify.actions.ts:279,337`; `inspections.actions.ts:283,341,544,631`) and **five `notifyEntityEvent` calls** (`diary-email.ts:83`, `qc-email.ts:89`, `site-form-email.ts:340`, `snag-email.ts:86,241`). The two edge functions that INSERT into `public.notifications` directly — `eft-invoice`, `compliance-complete` — need only the one line §05's sequence already removes (`is_read: false` at `compliance-complete/index.ts:184`, verified): §05's `tier` default of `'held'` lands them in the Priority half addressed to their single recipient, which is correct for a billing or compliance event aimed at one person.

**RLS.** `public.inbox_state` takes an own-row policy — `USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())` — because it *is* the user's own dismissal state and nothing else reads it. That is the only client-writable surface in this primitive, and it is deliberate: the Inbox is never an audit source; the audit trail is Primitive 1's `work_item_events`. The event half is not client-writable at all — §05 drops `notifications_own`, adds three RESTRICTIVE write denials and revokes `INSERT, UPDATE, DELETE` from `authenticated` and `anon`, so every read-state write goes through its `SECURITY DEFINER` RPCs.

#### Behaviour

| Tab | Qualifies | Badge |
|---|---|---|
| **Priority** | The whole state half, plus every `public.notifications` row addressed to me that is not yet read or cleared — after §05 that table carries nothing else. `immediate` tier interrupts, `held` tier coalesces for five minutes first, and both land here. The qualifying types and their tiers are A(c)'s, not this section's: `mention`, `work_item_assigned`, `work_item_reassigned`, `ball_in_court_changed`, `rfi_response`, `rfi_closed`, `work_item_closed`, `approval_requested` | Yes — the only count that ever appears on the bell |
| **Other** | The project activity feed: diary posted by someone else, report issued, revision issued, cloud-sync completed, status change on an item I merely follow, project member added — every Recap-tier row in A(c) | No badge, no push, no email except the 07:00 recap |

**Ordering.** Priority sorts by urgency band — overdue, due today, blocking someone else, due this week — then newest within band, stable on (`created_at`, `id`) so a row never moves between loads. Other is strictly reverse-chronological and rolled up by the feed on project × day × type ("KINGSWALK — 4 diary entries, 2 reports issued"), expandable. That single rule is what makes zero reachable, and it now costs nothing at write time because the feed row was going to be written anyway.

**Snooze.** Snooze is a property of the state half and lives on `inbox_state.snoozed_until`. Every work item snoozes to This evening (17:00), Tomorrow 07:00, Monday 07:00, Next week, or a picked date — all **Africa/Johannesburg**, never the browser's zone, and never `sla.service.ts:72-74`'s UTC `todayIso()`. A snoozed item leaves the Inbox, appears under a Snoozed filter, and re-surfaces **unread, in Priority, in the band its due date then warrants** (snoozing past a due date resurfaces as overdue, not later). Snoozing never suppresses the item on My Work: hiding a notification does not hide the work. **The event half has no snooze and gains no column for one** — §05 revokes client writes on `public.notifications` outright — so an event row is triaged with **Clear** (`cleared_at`), which §05 defines as leaving the inbox while reappearing once in the next recap's unread section. Clearing is therefore not a black hole and does not need a snooze to be safe.

**Read model.** Three states on each half, with different storage, and the storage boundary is stated exactly here because a headline target rests on it.

- **State half.** Absence of an `inbox_state` row is unread; `seen_at` is read; `done_at` — written by the auto-done trigger above, or by `E` on the focused row — is archived and gone from the tab.
- **Event half.** §05's `seen_at` (rendered ≥1 s in an open inbox) → `read_at` (the item's target route rendered) → `cleared_at` (triaged out without opening), all three server-written through §05's RPCs.

**`done_at` is a column of `public.inbox_state` and of no other table in this programme.** §05's `ALTER TABLE public.notifications` adds `delivered_at`, `seen_at` and `cleared_at` and no fourth timestamp; §12 §(f)'s retention rule for that table keys on `read_at` **or** `cleared_at` for exactly that reason. No query, view, RPC or metric written against this primitive may select or write `notifications.done_at`, because there is no such column and none is being added.

**Consequently §15's metric 5 — inbox engagement — is a union over both halves, not one expression over one table**, and this section supplies both operands: numerator = `public.notifications` rows created that week with `read_at` **or** `cleared_at` set, **plus** `public.inbox_state` rows whose `done_at` fell in that week; denominator = notifications created that week **plus** work items that entered the caller's ball-in-court that week. §15 owns the definition and the target; this section owns the two stores it reads and the guarantee that the state half is never purged out from under it (§12 §(f)). The auto-done-without-read share is therefore a **success** signal — ball-in-court moving before anyone had to read about it — and not a leak, which is the whole reason the `done_at` operand is kept rather than dropped.

**Zero is a requirement.** Priority is bounded by what one person owes; `E` marks the focused row done on the state half and read on the event half. **The Other tab is not counted and has no bulk verb**, because it is the activity feed: no badge, no per-row state, no push, and the 07:00 recap is the only place it is ever pushed. That is what makes zero reachable — the 750 rows that made it unreachable are no longer written to a personal surface at all. If Priority cannot be emptied in one sitting on a Monday morning, a tier in A(c) is wrong and A(c) is where it is fixed.

### (b) My Work — `/my-work`, cross-project

Fed by exactly two fields on the work item — `assignee_id` and `due_date` — with no configuration, no saved views and no board. **Four groups, not five.** Precedence is first-match, top to bottom, so the bands cannot overlap:

| Group | Rule (all dates evaluated in Africa/Johannesburg) |
|---|---|
| Overdue | `due_date < today`, status not `closed`/`void` |
| Today | `due_date = today` |
| This week | `due_date` in the rolling next 7 days, **excluding today** |
| Later | `due_date` beyond that |

**Decision: there is no "No date" group.** `projects.work_items.due_date` is `NOT NULL` (Appendix A(a), property 2) with a `BEFORE INSERT` trigger computing it in working days against A(h)'s calendar, so an item without a target date cannot exist. The bucket every generic task tool carries — monday's *Without a date* — is exactly where work goes to die, and the schema forbids it. Items whose owner or date has not yet been decided sit in Primitive 1's **Triage** status and appear as a banner above the groups ("3 items on KINGSWALK need an owner or a date"), linking to that project's triage queue.

Three tabs above the groups: **Assigned to me** (default), **Raised by me**, **Waiting on others** — the last being every open item I assigned, so chasing stops being a WhatsApp activity. Items **never silently expire**; one untouched for 14 days escalates to the assigner — through the *Waiting on others* tab and recap section 2 in Q1–Q2, and through the chase ladder from Q3, whose types and cadence are A(c)'s. Today this page cannot exist: `field.snags` has `assigned_to` but no due date at all (`00004_field_schema.sql:10-31`), and `projects.rfis` has both (`00002_projects_schema.sql:91-93`) but `assigned_to` is NULL on all 15 live RFIs. My Work is only as good as Primitive 1's never-null ball-in-court; it consumes that field and adds nothing of its own.

### (c) The new project home

Replaces the four KPI cards with a module table — the Procore project-overview shape, the one enterprise pattern worth copying wholesale:

| Module | Open | Overdue | Due ≤7d | Later | In triage | Waiting on |
|---|---|---|---|---|---|---|

One row per **enabled** module (see (f)). **Open = Overdue + Due ≤7d + Later, exactly** — there is no unscheduled remainder, because `due_date` is `NOT NULL`. *In triage* is a subset of Open shown separately because it needs a decision rather than work; it is not a sixth disjoint bucket. Every cell is a link into My Work filtered to that project, module and band. *Waiting on* names the most common ball-in-court holder. Below it: **Recent activity**, ten rows, newest first, one line each — actor, verb, object, time, read from the same `projects.activity` feed the Inbox's Other tab renders. Nothing else.

| Deleted / moved | Disposition |
|---|---|
| Open Snags / Pending Sign-off / Closed Snags / Open RFIs cards (`projects/[id]/page.tsx:80-97`) | Deleted. Four zeros on thirteen of fourteen projects; snag counts are one module's slice of the module table |
| Details panel (105-125) | Deleted, not moved. All five facts already have an editable home behind a stricter gate: Client and Contact on `settings/client`, Start/End on `settings/dates`, Contract Value on `settings/contract`, which is `COST_VIEW_ROLES` for both view and edit (`settings/_components/SettingsTabs.tsx:47`) — narrower than the page's own `canSeeCost` render check |
| Recent Snags panel (128-152), Recent RFIs panel (156-178) | Deleted. Superseded by Recent activity |
| Team chips (181-216) | Deleted. `/projects/[id]/settings/members` already exists |
| Header `+ RFI` / `+ Snag` (74-76) | **Kept.** These are the header capture control (d) refers to; they gain the other enabled modules' create verbs |
| Dashboard: KPI row, Upcoming Deadlines, Open Snags panel, Marketplace panel, Quick actions | Deleted with the landing page. The *path* is retained — see the next row |
| Dashboard "Action required" org-wide SLA block (193-410) | Deleted. The org-wide overdue roll-up is superseded by ball-in-court; a management view over other people's work is out of scope for this primitive (see (e)) |
| `/dashboard` itself | **Retained permanently as a server redirect to `/inbox`** — the landing page changes, the path does not (A(g)). It appears 49 times outside tests, including `(auth)/auth/callback/route.ts:24`, the default `next` for every invite and recovery link and the exact surface of the PR #138 incident, so deleting the path would re-open a closed production incident. The load-bearing references repoint in the same PR — `middleware.ts:118,134,166`, the `requireRolePage` default (`lib/auth/require-role.ts:160,180`), `settings/layout.tsx:46`, and `GLOBAL_NAV` (`Sidebar.tsx:64-69`). `docs/rbac-matrix.md` gains `/inbox` and `/my-work` in that PR |

The redirect and the rebuilt project home ship in **different quarters and that is deliberate**: `/dashboard` → `/inbox` lands with the Inbox itself in Q1, and this project home is Q2 (§13 owns both placements), so no user meets the old KPI cards as their landing page in the interval — they meet them only by opening a project, from an Inbox that already tells them what they owe.

### (d) What each audience lands on

| Audience | Lands on | Sees |
|---|---|---|
| WM engineer / PM | `/inbox` in `(work)` | Priority (approvals, answers owed, overdue items they hold), then My Work across all projects |
| Contractor site staff | `/inbox` in `(work)` | The same route, the same shell, the same code. Priority is dominated by snags assigned to them, RFI answers received, diary check-in due. One tap to My Work; capture lives in the project header, not a dashboard |
| Client / developer | `/inbox` in `(work)` | The same route with a **portal-scoped action set**: Priority filtered to items where they are ball-in-court — approvals and acknowledgements — with the two writes a client viewer holds, **acknowledge** and **comment on a thread**, and no others. Cost-bearing items are withheld by the read gate inside §12's `inbox_for_user`, not by hiding a button |

There is no second Inbox rendered inside `(portal)`. A copy would be two components, two queries and two role filters to keep in step, and the first divergence between them is a client viewer either seeing an item they should not or missing one they hold. **`/portal` keeps what only it can do**: "Since your last visit" (issued reports, closed snags, diary summary) and the site list — the browse-and-catch-up surface, as against `/inbox`, which is the act-on-what-I-owe surface. The portal remains view-only otherwise.

That rebuild is overdue on the evidence. The portal home today is a bare list of sites (`(portal)/portal/page.tsx:12-46`) and the per-project page is five static facts (`portal/[projectId]/page.tsx:13-19`) behind eleven fixed tabs (`components/portal/PortalProjectNav.tsx:12-24`, rendered from `portal/[projectId]/layout.tsx:40`); four client viewers have not signed in since 8 July, which is what a page with no personal content earns. The staff landing route moves from `/dashboard` to `/inbox`, and the client viewer's landing route moves from `/portal` to the same `/inbox` — with `/portal` one click away and still theirs.

### (e) Interaction model and empty states

**Keyboard** (shared by both surfaces): `j`/`k` or `↑`/`↓` move; `Enter` opens the peek panel; `E` done; `H` snooze (then `1` evening, `2` tomorrow, `3` Monday); `A` assign; `D` due date; `U` unread; `G` `I` Inbox, `G` `M` My Work; `/` **filter the current list**; `Cmd/Ctrl+K` command menu; `Esc` closes. All are listed in a `?` overlay, act on the focused row with no confirmation dialog, and are undoable for 10 seconds by toast. `/` filters what is already loaded — it is not a search box and does not query anything the list did not already fetch. **The binding is repurposed, not removed**, and that is a decision taken here rather than a gap: the exclusions table below rules that no search surface ships, and `/` is the one key a user will reach for expecting one, so it is bound to the nearest honest behaviour rather than left dark or pointed at a product that does not exist.

**Pointer.** A row click opens a right-hand **peek panel** (item, thread, actions) instead of navigating, so triage never loses list position; the title remains a real link for middle-click. Hover reveals done/snooze/assign. On touch: swipe left = done, swipe right = snooze, long-press = select.

**Accessibility — WCAG 2.2 AA is the bar on every new surface this programme builds**, and it is a requirement rather than an aspiration: the Inbox, My Work, the project home, the rebuilt portal, the peek panel, the settings tabs and the phone shell. Concretely: 4.5:1 contrast on text and 3:1 on UI boundaries, state indicators and focus rings; a **visible focus indicator** on every interactive element, never `outline: none` without a replacement; **everything operable from the keyboard**, including each swipe verb, which is a shortcut to a button and never the only route to it; **no hover-only affordance anywhere**, which is already this section's rule and is now also the standard's; and target size — WCAG 2.2's 24 px is the floor, while **≥44 px stays the house standard**, because this ships phone-first to people on site wearing gloves. The `?` overlay that lists every binding is also the discoverability obligation. It is enforced rather than aspired to: **§12 §(h) test 6** runs an automated `axe-core` pass over `/inbox`, `/my-work`, the capture routes and `/portal/[projectId]` as a build step, failing the build on any serious or critical violation; focus trapping and focus restore on the peek panel are checked by hand, because no automated pass catches those.

**Empty states.** Four distinct cases, never one generic string, each naming exactly one next action:

| Case | Copy | CTA |
|---|---|---|
| Inbox cleared | "Inbox zero. 3 items are snoozed until tomorrow." | View snoozed |
| New user, nothing assigned yet | "You're on KINGSWALK. Nothing is assigned to you yet — start with today's site diary." | Log today's diary |
| My Work, nothing assigned on a project | "No work is assigned to you on KINGSWALK." | Raise an RFI (`/rfis/new?projectId=`, already linked at `projects/[id]/page.tsx:74`) · See the team |
| Project home, module empty | "No open items in Cable Schedule." | Open module |

The second case is the activation metric — *first work item closed in a new user's first session*, §15 metric 7, whose numerator is **any** closed work item and not only a seeded first-run one — and it must not route to an empty list. It points at the diary, which is alive (31 entries in 30 days) and closes a work item in one screen.

"No notifications" (`NotificationCentre.tsx:176`) is deleted.

**Out of scope, by decision.** Two exclusions belong in this section rather than in a roadmap, because a reader of the front door will otherwise expect to find both:

| Excluded | Decision and reason |
|---|---|
| **A search surface** | **No search surface ships in the twelve months.** This is an exclusion by decision, not a deferral: a credible search spans twelve schemas with three different RLS models, and every record a person owes already reaches them through the Inbox, My Work, the activity feed, or a register's own filters. The consequence for the keyboard map is decided in the same breath rather than left implicit: **`/` is repurposed to filtering the current list, and no key is bound to search.** §06's "search is scoped within a project" constraint and §10.6's photo-tag "drives search" claim are both read against this row and neither implies a search product |
| **An org-wide management view over other people's work** | Deleted with the dashboard's "Action required" block (see (c)). Ball-in-court supersedes an org-wide overdue roll-up, and a view over other people's work is a different primitive from a personal front door |

### (f) Sidebar rework — per-project module toggles

`projectNav()` is a hardcoded sixteen-entry array shown identically on every project (`components/layout/Sidebar.tsx:73-88`, verified); only Medium Voltage is conditional (155-156) and JBCC/MV merely get a padlock badge (173-174). The unlock check behind those badges is **per-organisation**, not per-project, and WM's org bypasses every gate unconditionally (`lib/features.ts:10-12,28-40`) — so WM staff see all sixteen modules on all fourteen projects, six of which have never held a row. **The toggle is therefore the only thing that will actually declutter WM's own projects.**

**Decision: module enablement is per-project state on `projects.project_settings`**, already 1:1 with projects and auto-created by trigger (`00101_project_settings.sql:12-51`; `00103_project_settings_backfill_and_autocreate.sql:19-30`).

```sql
ALTER TABLE projects.project_settings
  ADD COLUMN enabled_modules text[] NOT NULL
    DEFAULT ARRAY[ /* the five Default-ON tokens of Appendix A(e), verbatim */ ]::text[],
  ADD CONSTRAINT project_settings_modules_known CHECK (
    enabled_modules <@ ARRAY[ /* all ten tokens of Appendix A(e), verbatim */ ]::text[]);
```

The **column default carries the default-ON set**, not `'{}'`. `ensure_project_settings_row()` inserts only `(project_id, organisation_id)`, so a `'{}'` default would silently ship every project created after this migration with zero modules; putting the set in the column default means the trigger function needs no change and the default lives in one readable place. The `<@` CHECK exists because an unconstrained `text[]` turns a typo (`tenant-schedule`) into a silently disabled module.

**The ten tokens, each token's default state and each token's write-entry table are Appendix A(e)'s and are not re-listed here** — the same ten are exported from `@esite/shared` so `requireModule()`, the settings UI and the DB cannot drift. **The enforcement is §12 §(h) test 7**, and the claim is made in that test's own terms: set equality **in both directions across four places at once** — Appendix A(e), the token array exported from `@esite/shared` that `requireModule()` and the settings UI both read, the `project_settings_modules_known` `<@` array CHECK parsed out of the migration whose DDL this subsection carries, and the set of write-entry tables carrying the RESTRICTIVE module gate. A token in code and not in A(e), a token in A(e) and not in the CHECK, or a gated write-entry table whose token is unregistered each fails the build naming the file and line. That test did not exist before this pass; it is added in §12 §(h) precisely so this paragraph and §06 §4.9's ruling that `instructions` and `transmittals` cannot be declared as tokens are enforceable rather than merely asserted.

**Always on, not toggleable:** A(e)'s always-on list, which this section cites rather than repeats. **Documents** earns two sentences because it is the one entry on that list which is not simply already in the nav. The route exists (`(admin)/projects/[id]/documents/page.tsx`, verified) and is absent from `projectNav` (`Sidebar.tsx:73-88`, verified), so it is unreachable from the nav today; it is added as an always-on nav entry. **It is also the drawing-and-document register surface itself, not a page beside it** — the Q2 version store (`tenants.document_versions` and the `revision_label` column adds, a hard prerequisite gated on the cloud-sync rewrite, per A(f)'s Q2 inventory) and the Q3 register surface that §13 moves beside the transmittal issue flow it feeds (revision labels rendered, the version delete guards, the transmitted-versus-latest column) both land **on this route**. A second documents page would split one corpus across two surfaces, which is the failure this whole section exists to stop.

**Three global surfaces sit outside the per-project toggle entirely, are org-level, and are unchanged by the programme** — listed here so the declutter is not mistaken for having removed them: `/inspections/templates` (a `GLOBAL_NAV` entry, `Sidebar.tsx:67`), the versioned inspection-template family with its `enforce_template_immutability` trigger, which is a **different engine** from the site-form templates; `/settings/integrations`, the cloud-storage mapping every drawing and document deliverable depends on; and `/settings/health`, org churn scores, which §14's project-health computation does not replace.

**Marketplace is not a per-project token and A(e) governs its disposition.** The evidence is this section's: orders key on `contractor_org_id` (`dashboard/page.tsx:63-74`), and the nav appears twice — the `GLOBAL_NAV` row (`Sidebar.tsx:68`, verified) and the in-project Workspace block (`Sidebar.tsx:20,178-187`, verified) behind `NEXT_PUBLIC_PHASE_2_MARKETPLACE`. Per A(e) both nav entries are deleted and `(admin)/marketplace` redirects to `/inbox` while the flag is off; the tables, the seven `(marketplace)` pages and the two April orders are untouched.

**Where the setting lives:** a new `/projects/[id]/settings/modules` tab alongside the **fifteen** existing ones (`settings/_components/SettingsTabs.tsx:42-58`, verified), adopting that file's exact shape — `viewRoles: ALL`, `editRoles: ORG_WRITE` (owner, admin, project_manager).

**Composition with paid entitlements — decision: `access = enabled_modules contains the module AND the existing entitlement gate passes`, never OR.** JBCC is a per-**org** R1999 unlock via `has_feature` (`lib/features.ts:28-40`); Medium Voltage is a per-**user** R2000/year subscription plus accepted disclaimer via `user_has_mv_access` (`lib/mv-access.ts:22-31`, migration `00131_mv_user_subscription.sql`). `requireModule()` calls `hasFeature`/`hasMvAccess` **after** the toggle check and never in place of it, so a project_manager flipping `jbcc` on cannot manufacture an entitlement. The RESTRICTIVE DB policy tests only the toggle; `has_feature`/`user_has_mv_access` remain the separate, unchanged gate.

**Enforcement is three layers, because hiding a nav item is not a gate.** There is presently **no `layout.tsx` under `apps/web/src/app/(admin)/projects/[id]/`** — every module page gates itself, and server actions and `app/api/*` routes sit outside any layout regardless.

1. A new project layout resolves `enabled_modules` once and renders a disabled segment **read-only with a permanent banner** — "This module is off for this project", with a re-enable control shown only to `ORG_WRITE_ROLES`. `notFound()` is reserved for a disabled module whose tables hold **zero rows**. This keeps the stated rule true: disabling a module must never make an existing signed record unreachable, and there is no expiry cliff.
2. `requireModule(projectId, module)` at the top of every server action and route handler belonging to that module, alongside the existing role guard.
3. A **RESTRICTIVE** `INSERT`/`UPDATE`/`DELETE` policy on the **write-entry table** of each module, calling `projects.project_module_enabled(p_project_id uuid, p_module text)`. Children are covered by their existing FK cascade rather than by fifty separate policies. This policy set is the fourth operand of test 7 above, so a gate added to a table A(e) does not name fails the build.

**The token → write-entry-table mapping is A(e)'s third column and is not repeated here.** What this section adds is the migration evidence behind each one, which A(e) does not carry: `projects.qc_reports` (`00172:57`), `cable_schedule.revisions` (`00051:47`), `structure.node_orders` (`00083:50`), `projects.handover_checklist` (`00002:182`), `field.site_forms` (`00179:69`), `projects.jbcc_notices` (`00099:15`), `cable_schedule.mv_study_settings` (`00128:23`) and `cable_schedule.fault_sources` (`00128:50`), `gcr.zones` (`00124:43`); `inspections.inspections` and `structure.nodes` are their modules' entry tables directly. Two of those choices are not obvious and the reason is recorded so they are not re-litigated: **Medium Voltage** is gated through `mv_study_settings` joined to the project's `cable_schedule.revisions`, because it keys on `revision_id` and not `project_id`; **Generator Cost-Recovery** is gated on `gcr.zones` and not `gcr.settings`, which is a defaults row.

`projects.project_module_enabled` is `SECURITY DEFINER`, `STABLE`, `PARALLEL SAFE`; it must not use `current_user` for the decision (that resolves to the function owner), must `REVOKE ALL FROM PUBLIC` **and** explicitly revoke `anon` — Supabase's `ALTER DEFAULT PRIVILEGES` grants `anon` directly — verified with `has_function_privilege('anon', oid, 'EXECUTE')`, never by reading `proacl`. **Per-row cost, stated:** a `WITH CHECK` runs per row, so the tenant-schedule commit path — hundreds of `structure.nodes` inserts in one call — pays one extra index probe per row against a fourteen-row, fully-cached table, on top of the org-based RLS check it already pays. That is the measured cost and it is accepted. Ten tables plus one function is one reviewable migration; if review splits it, the five default-ON modules ship first and the five default-OFF ones follow in the next release train.

**PortalProjectNav is filtered by the same array.** Its eleven fixed tabs (`PortalProjectNav.tsx:12-24`) include Generator Recovery and Handover, both default-OFF; `enabled_modules` is resolved in `(portal)/portal/[projectId]/layout.tsx` and passed to the component, with the same server-side banner/`notFound()` treatment as the admin side. Without this the declutter fails on exactly the audience that has not signed in since 8 July.

**Migrating existing projects.** The column default handles new projects; existing rows are then corrected from evidence — a module is enabled if the project holds at least one row in its evidence source above, **unioned with the default-ON set**, so nobody loses a module they use. `docs/rbac-matrix.md` and `CONFORMANCE.md` are updated in the same PR. Verification: read `enabled_modules` back for all 14 projects after applying, because `db push` keys on the version prefix and a green workflow is not evidence the file ran.

### (g) Replacing monday.com's My Work

| | monday My Work | E-Site My Work |
|---|---|---|
| Buckets | Past dates / Today / This week / Next week / Later / Without a date | Overdue / Today / This week (rolling 7) / Later |
| Undated work | A permanent "Without a date" bucket | Does not exist — `due_date` is `NOT NULL`; undecided items sit in Triage with a named owner |
| Stale items | Silently dropped after 4 months | Escalated to the assigner at 14 days, never dropped |
| Owner | People column, several people allowed | Exactly one assignee; ball-in-court computed and never null while the item is live |
| Reach | Paid seats, 3-seat minimum, blocks of 3/5/10 | Every contractor and client participates free |
| Domain link | A row is a row | A row is an RFI, a snag, a CoC gate, a board on the register |

Two things must be true for the team to close monday. First, **a plain `task` work-item kind with no module behind it**, so a monday board row has somewhere to land; without it My Work is only as broad as the modules and the team keeps a second list. It is registered in Q1 with the primitive (Appendix A(b): `task`, Q1, sourceless, +5 working days on the office calendar, assignee and gatekeeper both the creator). Second, the migration is a one-time export of open monday items into that kind, per project, assignee and due date preserved; done items are not migrated, and any item arriving without a date takes the working-day default rather than creating the bucket the schema refuses to have.

**Cost and timing, stated plainly.** My Work replaces monday's *task tracking* in Q1, but not its **timeline and board views**, which arrive with the calendar and programme primitive in Q4. The decision is therefore to keep monday seats for programme only through Q1–Q3 and **cancel at the end of Q4** — not to declare victory in Q1 and force the team back into a tool they have half-left. **The full board export is taken and archived at the end of Q2, while the data is still live**, not at cancellation: an export pulled from an account in its final month is an export taken under time pressure from a tool nobody has opened in a quarter, and the one thing that cannot be recovered afterwards is the history. Taking it at the end of Q2 — the point at which threads have proved and the team has stopped opening monday daily — separates the archive from the cancellation, so the cancellation date can move without putting the record at risk.
