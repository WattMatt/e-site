# 03 — Work-OS and productivity products: how the winners build a daily habit

Research date: 2026-09-09. Products: monday.com, Linear, Notion, Slack, Asana, Basecamp. Context: E-Site has 36 accounts / 3 weekly-active, 964 notifications sent / 57 read, RFIs never assigned, diary entries backfilled two days late, zero mobile installs. The team currently lives in Teams, monday.com, WhatsApp, email, Excel/Word and Dropbox.

---

## Per-product findings

### Linear

**Home/Inbox.** Two surfaces, both under the sidebar's first two slots. *Inbox* is the notification centre: you receive an item only for issues you are subscribed to, and subscription is automatic on create / assign / @mention ([docs/inbox](https://linear.app/docs/inbox)). Since 3 Sep 2026 Inbox has a **Priority** tab that "separates what needs your attention from what can wait, so something like a review blocking a release never gets buried"; Linear picks what counts by default, the user can override with a filter ([changelog 2026-09-03](https://linear.app/changelog/2026-09-03-priority-inbox)). Snooze hides an item until a chosen time and it reappears; issue/document/project reminders land in Inbox at the chosen time. *My Issues* is "a curated view that shows your most pertinent issues" in four tabs — assigned, created, subscribed, recent activity — with a "curated priority order" and `G then M` to reach it ([docs/my-issues](https://linear.app/docs/my-issues)). Deliberately left out: anything you are not subscribed to. There is no "all activity" firehose in Inbox; Pulse is a separate feed.

**Notification philosophy.** Desktop, mobile and Slack are real-time; email is a **digest by default**, "sent with time delays based on urgency, and only sent if you haven't already read the Linear inbox notification" ([docs/notifications](https://linear.app/docs/notifications)). Notification types are grouped (you cannot pick "only status changes"), which keeps the settings page small. Due-date notifications fire when near and when past due ([docs/due-dates](https://linear.app/docs/due-dates)). Project/initiative updates go through **Pulse**, delivered as a daily or weekly summary to Inbox "around 6:00 AM in your local time"; admins set a workspace default of weekly-Monday, every-weekday or never ([docs/pulse](https://linear.app/docs/pulse)).

**Assignment.** "Issues in Linear are assigned to a single person at a time, giving teams clear ownership and responsibility"; an agent can be delegated to while the human "remains responsible" ([docs/assigning-issues](https://linear.app/docs/assigning-issues)). Overdue is surfaced via SLA states — Low risk (>1 week), Medium (within 1 week), High (within 1 day), Breached, Achieved, Failed — filterable in any view ([docs/sla](https://linear.app/docs/sla)). Unassigned inbound work does not float: it lands in the team's **Triage** queue, which has its own responsible person ([docs/triage](https://linear.app/docs/triage)).

**Email.** Digest-first (above). No reply-by-email; email is a pointer back to Inbox.

**Mobile.** Native Swift/Kotlin apps; scoped to Inbox (read, snooze, delete, comment), My Issues, favourites, team triage queues, "screenshot to triage in a few simple taps", real-time push plus a per-user **notification schedule** ("Available 24/7. Or just 9-5") ([linear.app/mobile](https://linear.app/mobile)). Doc editing only arrived on mobile in July 2026 ([changelog](https://linear.app/changelog/2026-07-30-coding-sessions-on-mobile)) — four years after launch; parity was never the goal.

**Onboarding.** The onboarding checklist is itself a set of issues in the new workspace; the command menu is shown before the workspace is populated; activation event = "first issue completed and resolved", inside the first session ([Supademo teardown](https://supademo.com/user-flow-examples/linear); [Start Guide](https://linear.app/docs/start-guide)).

**Quality principles.** The Linear Method: "Build for the creators… keeping individuals productive is more important than generating perfect reports"; opinionated software with "one really good way of doing things"; n-week cycles where unfinished work rolls forward automatically; "write issues not user stories"; "write a changelog" ([method/introduction](https://linear.app/method/introduction), [Figma interview](https://www.figma.com/blog/the-linear-method-opinionated-software/)). Karri Saarinen: commit to quality at leadership level, small teams, no design→dev handoff ([Figma](https://www.figma.com/blog/karri-saarinens-10-rules-for-crafting-products-that-stand-out/)); no PMs, no A/B tests, decisions by taste ([Lenny](https://www.lennysnewsletter.com/p/how-linear-builds-product)). Weekly changelog cadence is visible on the changelog itself.

### Asana

**Home/Inbox.** *My Tasks* = every task assigned to you, default sections Today / Upcoming / Later; automatic promotion between sections was replaced by user-defined **Rules** ("due date is approaching → Upcoming", "due today → Today"), which run between midnight and 1 am ([Inside Asana](https://asana.com/inside-asana/customize-my-tasks); [forum](https://forum.asana.com/t/auto-promote-in-my-task-not-promoting-tasks-with-due-date-in-the-past/36421)). *Inbox* filters: by person, assigned to you, @mentions, tasks you assigned to others, unread — but **not by project** ([asana.com/features/inbox](https://asana.com/features/project-management/inbox)). *Home* is a widget dashboard (upcoming tasks, recent projects, completion stats, drafts) ([Home](https://asana.com/features/project-management/home)).

**Notifications.** Per-type email/browser/push toggles, quiet hours and days, per-project defaults. The **Daily Summary** consolidates "Tasks Starting & Due Today" into one Inbox item (Dec 2020) and an email of new assignments plus upcoming due dates; overdue tasks were added in Mar 2021 after a forum request ([forum](https://forum.asana.com/t/new-daily-summary-inbox-notification/102655), [overdue request](https://forum.asana.com/t/include-overdue-tasks-in-daily-summary/47709)).

**Assignment.** Published rationale for **one assignee**: "Having only one assignee per task ensures that there's never a sense of 'who's responsible?'… With two assignees one person may think the other has the ball" — modelled on Apple's DRI; split work with subtasks, not co-assignees ([Why one assignee?](https://asana.com/resources/why-one-assignee)).

**Email participation.** Forward any mail to `x@mail.asana.com` → task in My Tasks (subject = title, body = description). Reply to a notification email → comment; add an address in **To:** → reassigns the task; in **CC:** → adds a collaborator ([asana-email-tips](https://asana.com/resources/asana-email-tips)).

**Mobile.** Scoped to My Tasks, Inbox, projects, search, quick add with voice and image capture; desktop app adds Pomodoro timers and notification snooze ([apps](https://asana.com/features/project-management/mobile-desktop-apps)).

**Complaints.** "I often get 4 emails for a single thing: one when my designer uploads a file, one when he comments and @s me, one when he changes status, one when the task moves column… we are getting bombarded, which causes them to ignore them" ([forum 2020](https://forum.asana.com/t/email-notifications-too-many/80078); same in [2023](https://forum.asana.com/t/way-too-many-email-notifications-going-to-my-team-despite-adjustments-in-the-notification-tab/579459)). The mirror complaint also exists — a Dec 2024 "Don't batch notifications" thread — proof that batching must be per-user, not global. Capterra reviewers cite feature/notification overwhelm ([Capterra](https://www.capterra.com/p/184581/Asana-PM/reviews/)).

### monday.com

**Home/Inbox.** *My Work* lists everything assigned to you across the account in six date buckets — Past dates, Today, This week, Next week, Later, Without a date — with counts per bucket, a "hide done" toggle, and a hard rule that items **not updated in the last four months drop out** ([support: My Work](https://support.monday.com/hc/en-us/articles/360019300579-My-Work); [mobile My Work](https://support.monday.com/hc/en-us/articles/360019159959-Mobile-app-My-Work)). The bell is a chronological feed; the Updates feed is a second inbox for @mentions ([Notifications explained](https://support.monday.com/hc/en-us/articles/360001292545-Notifications-explained)).

**Notifications.** "By default, all email notifications are turned on for each new account"; triggers are assignment and @mention plus anything an automation emits; per-board overrides and a per-board daily digest exist but are opt-in ([Email notifications](https://support.monday.com/hc/en-us/articles/115005319529-Email-notifications); [Trouble on Monday](https://troubleonmonday.com/thread/monday-com-notifications-alerts/)). A monday consultant on the official community: "teams add notifications for everything… people stop paying attention… important updates get buried alongside routine ones" ([community](https://community.monday.com/ask-the-com/post/are-too-many-notifications-making-monday-com-less-helpful-OkBBE1eer9KK3Eo)).

**Assignment.** A People column can hold several people; no DRI rule. Overdue = "Past dates" bucket; escalation only via automations you build yourself.

**Complaints (G2/Capterra/Trustpilot/Reddit).** Notification overload and automations "generating more alerts than the team wants" ([Cloudwards](https://www.cloudwards.net/monday-com-review/), [Kiolo](https://kiolo.com/en/blog/monday-com-http-monday-com-reviews/)); boards with 100+ items and 15 columns become visually dense and lag ([G2 Learn](https://learn.g2.com/monday-review)); pricing — a **3-seat minimum** then blocks of 3/5/10/15/20 (a team of 6 pays for 10), features gated by tier, auto-renewal without notice; Trustpilot 2.7/5 across 3,300+ reviews with billing in "nearly every negative review" ([Plutio](https://www.plutio.com/freelancer-magazine/still-using-monday), [Trustpilot](https://www.trustpilot.com/review/www.monday.com)). Reddit threads go as far as "avoid this software at all costs" ([Product Hunt/Reddit roundup](https://www.producthunt.com/products/monday-com/reviews)).

### Basecamp

**Home/Inbox.** *Hey!* is "the catch-all Basecamp inbox": @mentions, to-dos assigned to you, **to-dos you assigned that someone completed**, message and comment notifications — "a single inbox for nearly every kind of Basecamp notification" (Jason Fried, [SvN 2015](https://signalvnoise.com/posts/3955-a-preview-of-whats-new-in-basecamp-3)). It is deliberately narrow — only things aimed at you personally — so it stays small enough to clear; everything else is on the Activity page ([Activity](https://3.basecamp-help.com/article/92-the-latest-activity)). *Lineup* is a rolling 13-week timeline (6 weeks back, today centred, 6 ahead) of projects with avatars on current ones ([Lineup](https://3.basecamp-help.com/article/668-lineup)).

**Notification philosophy.** Three levels — account, project, thread. Account scope is binary: "Notify me about everything" or "Only when someone Pings or @mentions me." Assignment reminders are opt-in: "the day before a due date and each day after until it's completed." Email bundles Pings that arrive within a few minutes, and **you are not emailed if you are active in Basecamp when it fires**. Auto-subscriptions are explicit: assign a to-do → notified on comments and when checked off ([Notification settings](https://3.basecamp-help.com/article/86-how-notifications-work)). Company principle: *It Doesn't Have to Be Crazy at Work* — "chaos shouldn't be the natural state at work" ([books](https://basecamp.com/books/calm)); the 37signals communication guide favours long-form async over real-time chat ([guide](https://basecamp.com/guides/how-we-communicate)).

**Assignment.** To-dos allow multiple assignees (a known contrast with Asana/Linear), but the "Can you do this for me?" view shows all work you assigned to others and "Basecamp will automatically let you know whenever someone finishes something you asked them to do — you no longer have to nag" ([SvN 2015](https://signalvnoise.com/posts/3955-a-preview-of-whats-new-in-basecamp-3)).

**Email.** "Adoptional": "anyone can participate in a Basecamp project without ever having to do anything other than replying to an occasional email" (same post). Reply above the line → comment posted. **Email Forwards** turn an inbound email into a project item you can comment on internally and reply to the original sender from; forwarding notifies nobody until you add people ([Forwards](https://3.basecamp-help.com/article/58-forwards)). Two scheduled reports: a **Daily Recap** at 7 am covering the previous 24 h (clientside activity first, then new items, then discussions; pinned projects on top) and a "my assignments" report ([SvN](https://signalvnoise.com/svn3/two-new-email-reports-in-basecamp/); [Basecamp 2 help](https://2.basecamp-help.com/article/228-your-email-notifications)). **Automatic Check-ins** ask a recurring question daily/weekly/monthly via push, in-app or email and post the answers as threads; 37signals asks "What did you work on today?" every weekday at 16:30 ([Check-ins](https://3.basecamp-help.com/article/50-automatic-check-ins); [DHH](https://world.hey.com/dhh/how-do-you-know-what-people-have-been-working-on-48b8986d)).

**Mobile.** Full-parity native apps ("all the same features as the browser") with snooze ([apps](https://basecamp.com/apps)). Product process: Shape Up — six-week cycles, appetite instead of estimates, cooldown ([Shape Up](https://basecamp.com/shapeup/0.3-chapter-01)).

### Slack

**Home/Inbox.** *Activity* consolidates DMs, mentions, thread replies, reactions and app notifications; filters can be saved as tabs (DMs, Mentions, Threads, Channels, Reactions, Apps, Reminders, VIP); bulk actions; keyboard ↑/↓, Enter to reply, C to clear, R to mark read ([help](https://slack.com/help/articles/46751260742035-Introducing-the-new-Activity-view-in-Slack)). Slack's stated model: "Get oriented in **Today**. Triage in **Activity**. Act with Slackbot." Pilot data: 80% of users return to Activity repeatedly; 60% triage DMs from inside it ([Slack blog](https://slack.com/blog/news/slack-activity-triage-for-notifications)). *Later* has In progress / Archived / Completed tabs and reminders ([help](https://slack.com/help/articles/13453851074067-Save-it-for-%22Later%22)); it was built because users were already marking messages unread to save them ([Berman](https://kristenberman.substack.com/p/slack-save-for-later-and-huddles)). The 2023 redesign put notifications "deeper within these views, so you can decide when you want to be heads-down" ([blog](https://slack.com/blog/productivity/a-redesigned-slack-built-for-focus)).

**Notification philosophy.** The 2017 "Should we send a notification?" flowchart: muted channel → prefs → DND (with sender override) → **active on desktop?** → which channel. Default mobile push waits 1 minute after screen lock or 10 minutes of idle; Everything vs Mentions & DMs with per-channel exceptions; notification schedule; VIP bypass ([configure](https://slack.com/help/articles/201355156-Configure-your-Slack-notifications)). Former notifications lead Liza Gurtin reframed the question from "when should we notify?" to "when does the user want their attention drawn to Slack?" ([Courier](https://www.courier.com/blog/slack-notifications-flowchart-strategy)). Sophie Alpert's rebuttal: the logic is complex but collapses to a few questions if you pick the right lens ([sophiebits](https://sophiebits.com/2024/10/30/everyone-is-wrong-about-that-slack-flowchart)).

### Notion

**Home/Inbox.** Inbox = revisions on pages you created, @mentions, assignments; filters Unread only / Archived / All workspace updates; per-page level (All updates / All comments / Replies & @mentions); collapse by page; "Lock inbox pane open" ([help](https://www.notion.com/help/updates-and-notifications)). On mobile, a Home tab (May 2026) puts home, chats, meetings and inbox one swipe apart ([release](https://www.notion.com/releases/2026-05-04)).

**Notifications.** Only three triggers: someone @mentions or replies to you, you are added to a Person property, or a reminder you set. **If the app is open you get a badge only**; push/email only when it is not, unless "Always send email notifications" is on; email also offers workspace digests ([settings](https://www.notion.com/help/notification-settings)). Reminders push within five minutes on mobile.

**Onboarding.** A Getting Started page that is a live checklist ("Type / for slash commands"), contextual tooltips, and a curated template list per persona ([Appcues](https://goodux.appcues.com/blog/notions-lightweight-onboarding)); the commonly cited aha proxy is the second page created ([Appcues aha guide](https://www.appcues.com/blog/aha-moment-examples)).

---

## The anatomy of a daily habit

1. **One personal inbox, scoped to "aimed at you", that can reach zero.** Basecamp Hey! (only @mentions, assignments, completions of what you assigned); Linear Inbox (subscribed issues only). Everything else lives in a separate Activity/Pulse feed you visit on purpose.
2. **A "Today" list generated from assignment + date, not from a board.** monday My Work (Past/Today/This week/…), Asana My Tasks, Slack Today. Best: **Linear My Issues** — four tabs, curated order, no configuration.
3. **Priority above chronology.** Linear's Priority tab and Slack's saved Activity views split "needs me" from "FYI". Best: **Linear** (system chooses the default, user can override).
4. **Single owner per work item, published as a rule.** Asana's DRI essay and Linear's "single person at a time". Best: **Asana** (the rationale is the product doc).
5. **Assign → automatic follow-up.** Basecamp notifies the assigner when the thing is done and reminds the assignee "the day before and each day after until it's completed". Best: **Basecamp**.
6. **Suppress when present, batch when absent.** Basecamp: no email if you're in the app; Notion: badge only while open; Slack: push waits for desktop inactivity; Linear: email digest only for unread inbox items. Best: **Linear** (digest delay keyed to urgency).
7. **A scheduled recap that arrives before the day starts.** Basecamp Daily Recap at 07:00, Linear Pulse ~06:00 local, Asana daily summary. Best: **Basecamp** (client activity first, then new items, then discussions).
8. **Email as a full participation channel, not just a pointer.** Asana reply-to-comment / To:-to-reassign / CC-to-follow; Basecamp "adoptional". Best: **Basecamp** for reach, **Asana** for mechanics.
9. **Snooze/Later as first-class state.** Linear snooze + reminders, Slack Later (In progress/Archived/Completed). Best: **Slack** (built from observed behaviour).
10. **Phone = capture + inbox, native push with a schedule.** Linear: native, inbox-first, screenshot-to-triage, "9-5" schedule; Asana: voice/image capture. Best: **Linear**.
11. **Onboarding that is the product doing its job.** Linear's checklist is a list of issues; Notion's is a page. Best: **Linear** (activation = first issue closed, in-session).
12. **Recurring prompts replace status meetings.** Basecamp Automatic Check-ins: a scheduled question, answered by push/email, posted as a thread. Best: **Basecamp**.

## Anti-patterns to avoid

- **Everything on by default** (monday: all email on for new accounts; Asana: four emails for one event). Result: "people stop paying attention" — exactly E-Site's 57/964.
- **Inbox that mirrors the activity log.** The bell as a firehose (monday) is not an inbox; without a "for me" filter it cannot reach zero.
- **Multi-assignee and unassigned-by-default.** "One person may think the other has the ball" (Asana). E-Site's never-assigned RFIs are this failure.
- **Per-type toggle sprawl** as the only remedy. Linear groups types; Basecamp offers two scopes. Users don't tune 40 checkboxes.
- **Global batching decisions.** Asana has threads demanding both fewer and un-batched emails. Batching must be per-user, urgency-aware.
- **Mobile parity as the goal.** Zero installs says the app must earn a slot on the phone with one job (capture, inbox), not replicate the web.
- **Board/column sprawl** (monday 100+ items × 15 columns) and **per-seat pricing with minimums** — the team's stated reasons for leaving.
- **Silent expiry** (monday drops items not updated in 4 months from My Work) — hides stale work instead of escalating it.

## Concrete lessons for E-Site

Focus areas: a Today/Inbox, a universal work-item primitive, threads with @mentions, a digest engine, phone-first web.

1. **[Linear]** Ship one `Inbox` with a Priority tab and an Other tab; Priority = assigned-to-me, @mention, due-today/overdue, awaiting-my-approval; Other = FYI. Default chosen by the system.
2. **[Linear / monday]** Ship `My Work` grouped Overdue / Today / This week / Later / No date, across all projects, fed purely by `assignee_id` + `due_at` on the universal work item.
3. **[Asana]** Make every work item (RFI, snag, inspection, diary action, form, order line) carry exactly one `assignee_id`; RFIs cannot be *sent* unassigned — a Linear-style per-project **Triage** queue with a named triage owner catches unowned inbound.
4. **[Basecamp]** Assigner auto-subscribes: when a snag/RFI you raised is closed, you get one Inbox item — no more nagging, no "did they do it?".
5. **[Basecamp]** Assignment reminders: opt-in, "day before due and every day after until done", not a burst at assignment time.
6. **[Basecamp / Notion]** Presence-aware delivery: no push/email for anything the user has already seen in-app; badge only while the tab is open.
7. **[Linear]** Digest engine keyed to urgency: overdue/blocking → immediate push; comment/status → held ≤2 h and sent only if still unread; FYI → daily recap only. One setting per user: `immediate | digest | recap-only`.
8. **[Basecamp]** A 07:00 SAST Daily Recap per user: client/contractor-facing activity first, then new items assigned to you, then discussions you're in, then a "still overdue" footer; skipped entirely if empty.
9. **[Basecamp / Asana]** Reply-by-email into threads (reply above the line → comment on the item), with `To:` reassign and `CC:` add-follower semantics, so contractors on WhatsApp/email can participate without logging in ("adoptional").
10. **[Basecamp]** Email-to-item: a per-project address (`kingswalk@in.e-site.live`) that turns a forwarded consultant email into a work item nobody is notified about until someone assigns it.
11. **[Basecamp]** Automatic Check-in for the site diary: push at 15:30 "What happened on site today?" answered from the phone with photos → posted as the diary entry. This attacks the two-day backfill directly.
12. **[Linear / Slack]** Snooze and Later on every Inbox item, with a re-surface time; the Inbox must be clearable to zero in one sitting, keyboard `↑↓ / Enter / C`.
13. **[Linear]** Phone-first PWA scoped to Inbox + My Work + capture (photo/voice → snag/diary/RFI); no board views on mobile; web push with a per-user quiet schedule ("9-5 only"), and a native wrapper only if store push proves necessary.
14. **[Linear / Notion]** Onboarding = five real work items assigned to the new user in their first project ("Assign this RFI", "Close this snag with a photo"); activation metric = first item closed in session one.
15. **[Slack / Linear]** Publish a one-page "How E-Site notifies you" (the flowchart, simplified à la Sophie Alpert) and a weekly changelog; opinionated defaults, at most two notification scopes ("everything" vs "only what's aimed at me").
16. **[monday — avoid]** Never drop stale items silently; an item untouched for 14 days escalates to the assigner's Inbox instead. Never gate roles or seats: contractors/clients are free email participants.
