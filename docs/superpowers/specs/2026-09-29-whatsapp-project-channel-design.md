# WhatsApp project channel — design (sub-project 2)

**Date:** 2026-09-29 · **Status:** design approved in session ("looks right"), awaiting spec review · **Owner:** Arno
**Builds on:** `2026-09-28-whatsapp-reply-to-act-design.md` (the "foundation", sub-project 1). Its §9 amendments still hold.

---

## 1. What changed and why

On 2026-09-29 the owner stated the real intent: **a WhatsApp channel per project that every member of that project can use, with access to items, drawings, documents and reports from E-Site.**

Meta's Groups API cannot deliver that literally ([Meta Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups), updated 2026-06-16):

- **At most 8 participants per group.** Most projects have more members than that.
- **Official Business Account (green tick) only.** Meta grants it at its discretion.
- **Invite-link join only.**
- **No interactive messages**, so no buttons.

Unofficial group automation drives WhatsApp Web against Meta's terms, and those numbers get banned. It is ruled out.

**Owner decision: "Both, B first."**
- **B.** A project channel run through E-Site. Every member talks to the E-Site number one-to-one; the "channel" is the project context inside that conversation and the record in E-Site. It has no member cap, needs no green tick, and keeps buttons.
- **A.** An official ≤8-person core-team group per project comes later, if and when E-Site gets OBA status (sub-project 5).

This reverses the v2 roadmap's §06 "no WhatsApp bridge" in spirit. It is the owner's call and is recorded here. The safeguard the roadmap cared about is kept: **everything posted through WhatsApp is recorded in E-Site, attributed and non-deletable** (redaction only).

### 1.1 Sub-projects

| # | Sub-project | Scope | Depends on |
|---|---|---|---|
| 1 | Foundation (built: branch `feat/whatsapp-reply-to-act`) | Linking + consent, outbox, webhook, act-as-user, item acknowledge / mark done / photo / note | — |
| **2** | **Project channel core (this spec)** | Current project, menu, my items / project items, post to project (diary or issue) | 1 |
| 3 | Drawings & documents | Request the current revision of a drawing or document as a PDF, RLS-scoped | 2 |
| 4 | Reports & schedules | On-demand legend cards, cable schedule PDF, snag visit report | 2, plus a server-side render path |
| 5 | Official core-team group | A ≤8-person Meta group per project | OBA approval |

Owner-selected capabilities for WhatsApp: items and status, drawings and documents, post to the project, reports and schedules. Sub-project 2 covers the first and third; 3 and 4 cover the others.

---

## 2. Behaviour

### 2.1 Current project

Each active link gets `current_project_id` and `current_project_at`. It is set by any of these:

1. **Typing a project name.**
   - Match case-insensitively against the names of projects the user is a member of (through RLS).
   - Exactly one match: switch, and reply "Now on **KINGSWALK**."
   - Several matches: list them to pick from.
   - No match: "No project called that. Type *menu* → Switch project."
   - A partial match (prefix or contains) always asks for confirmation.
2. **Menu → Switch project**, which lists the user's projects. There is a 10-row limit per list: past 10, the list shows the 9 most recently active plus "More… type the project name".
3. **Implicitly**, whenever the user acts on or is sent an item card, switching to that item's project.

The current project has no expiry, but every menu reply names it, so the user always knows which project they're addressing.

### 2.2 Menu

Typing `menu`, `hi`, `hello`, `help` or `start` (case-insensitive) opens it, and so does any text that is not a keyword when the user has no current item and no pending pick. It is an interactive list headed "{project}":

| Row | Action |
|---|---|
| My open items | Items on the current project where `ball_in_court_id = me` and the status is open. The first 10 by due date become a list; picking one re-sends that item's card. |
| Project open items | All open items on the current project that the user can see through RLS (`work_items_select`). First 10 by due date; picking one re-sends its card. |
| Post to {project} | Prompt: "Send the photo or message for {project}." The link's post state is armed (§2.3). |
| Switch project | §2.1 |

Client viewers get no **Post** row, matching their read-only role. Sub-projects 3 and 4 add *Drawings* and *Reports* rows.

**Re-sending an item card**
- Replies are inside the 24-hour service window, so the card is a free-form interactive message (body plus three reply buttons), not a template.
- The buttons carry the foundation's payloads (`ack:` / `done:`). The third button is `open:<itemId>`, which answers with the `/wa/<itemId>` link.
- The foundation's processor handles everything from there.

### 2.3 Posting to the project

**How a post starts.** Either way below, the message is **held**: `link.pending_post` stores the inbound ids and the project.
- **Explicitly**: the user picks **Post to {project}**, then sends a photo or text.
- **From an unmatched message**: a photo or text arrives with no item target (the foundation's `pick` case). The existing "Which item is this for?" list gains a **first row: "Post to {current project} (not an item)"**. If there is no current project, the row reads "Post to a project…" and leads to Switch project first.

**Bursts.** Further photos or text from the same user within 60 seconds join the same held post.

**The question.** After the held post's first message, E-Site asks once, with two reply buttons:

> "Post to **KINGSWALK** as… [📓 Diary] [⚠️ Raise an issue]"

The buttons carry `post:diary:<postId>` and `post:issue:<postId>`.

**📓 Diary**, via `whatsapp.wa_post_diary(p_user, p_project, p_body, p_inbound[])`, which acts as the user under RLS:
- Inserts `projects.site_diary_entries` with:
  - `entry_type = 'general'`, `entry_date = today (SAST)`, `created_by = p_user`;
  - `organisation_id` = the project's organisation;
  - `progress_notes` = the joined text, or "Photos sent via WhatsApp" when the post is photo-only.
- The insert is subject to the existing policy: org member, not a client viewer, project not payment-paused.
- Photos go to `projects.site_diary_attachments` (`kind = 'image'`), in the bucket and path convention the web diary form uses (`<org>/<project>/<entry>/<file>`). The edge uploads them; the function inserts the rows as the user.
- Reply: "📓 Added to today's KINGSWALK diary."
- **No diary email is sent (decision).** Diary notifications are sent by the web action (`notifyDiaryEntryAction`), not by a database trigger, and they were 750 of the 964 notifications in the baseline. A WhatsApp diary post is visible in the diary but does not mail the roster. The owner can reverse this later by having the worker call the existing `/api/diary/notify` path.

**⚠️ Raise an issue**, via `whatsapp.wa_post_issue(p_user, p_project, p_body, p_inbound[])`, which acts as the user:
- Inserts `projects.work_items` with:
  - `item_type = 'task'`, `origin = 'manual'`, `status = 'triage'`;
  - `title` = the first 120 characters of the text, or "Photo from site" when the post is photo-only;
  - `assignee_id` = `projects.resolve_triage_owner(project)`, falling back to `projects.resolve_project_pm(project)`;
  - `gatekeeper_id = p_user`. This follows the spine rule that the creator is a task's gatekeeper (Appendix A(b)), the same as `createWorkItemTaskAction`. The triage owner works it; marking it done hands the ball back to the foreman to confirm and close.
  - `created_by = p_user`.
- It is subject to the existing `work_items_insert` / `work_items_insert_gate` policies and the membership trigger.
- The full text goes to `work_item_notes` (via `whatsapp`), and the photos to `work_item_attachments`.
- The new item's `assigned` event enqueues the foundation's WhatsApp card to the triage owner, if they are linked and the project has WhatsApp on.
- Reply: "⚠️ Raised **TASK-14** on KINGSWALK — it's with {triage owner} to sort out."

**Expiry.** A held post not classified within 30 minutes expires. Its messages are recorded in `whatsapp.inbound` with the outcome `unmatched` / `post_expired`, and the next menu reply says "Your earlier post to KINGSWALK wasn't filed — send it again."

### 2.4 Access and safety

- Every list and every write runs through the foundation's act-as-user pattern (`whatsapp_actor` plus claims), so RLS decides what a person can see and do. Nothing on WhatsApp exceeds the web.
- Project lists come from `projects.projects` / `project_members` visible to the user, and item lists from `work_items_select`.
- A client viewer can list what RLS shows them (§ rbac-matrix `⁽ʷᵃ⁾`) but gets no Post row. The database would refuse anyway.
- Nothing here sends a business-initiated template. Every reply is inside the user's 24-hour window, so there is **no per-message cost**.

---

## 3. Data changes (one migration, number claimed at apply time)

- `whatsapp.phone_links` gains:
  - `current_project_id uuid REFERENCES projects.projects(id) ON DELETE SET NULL`
  - `current_project_at timestamptz`
  - `pending_post jsonb` (holding `{ post_id, project_id, inbound_ids[], started_at }`)
- New functions, owned by `whatsapp_actor` and executable only by `service_role`, following the foundation's pattern:
  - `wa_my_projects(p_user)`
  - `wa_find_projects(p_user, p_query)`
  - `wa_project_items(p_user, p_project, p_scope text)`, where `scope` is `'mine'` or `'project'`
  - `wa_post_diary(p_user, p_project, p_body text, p_photos jsonb, p_inbound uuid)`
  - `wa_post_issue(p_user, p_project, p_body text, p_photos jsonb, p_inbound uuid)`
- Grants for `whatsapp_actor`: INSERT on `projects.site_diary_entries` and `projects.site_diary_attachments`, and INSERT on `projects.work_items`. The existing permissive and restrictive policies are written `TO public` / `TO authenticated`, so they already apply to `whatsapp_actor` as a member of `authenticated`. **The plan must verify that by impersonation, not assume it.**
- A `@verify` block, and a dry-run assertion file covering:
  - a member lists only their own projects;
  - a MAMAILA-only item is invisible to the rbac-test fixture;
  - a client viewer cannot post;
  - a payment-paused project refuses a diary post;
  - an issue lands in triage, assigned to the triage owner, and enqueues their card.

## 4. Processor changes

In `_shared/whatsapp/processor.ts`, extended with no new edge function:

- Recognise the menu keywords and project names before the "free content" path.
- New payload kinds, added to `core.ts` and synced: `menu:<row>`, `proj:<projectId>`, `item:<itemId>` (re-send the card), `open:<itemId>`, `post:diary|issue:<postId>`.
- In the foundation's `pick` list, prepend the "Post to {project}" row.
- Hold, burst-merge and expire posts.
- Pure logic goes in `core.ts`: menu-keyword classification, project-name matching (exact, then prefix, then contains, case- and punctuation-insensitive), and post-burst windows. It is unit-tested in `@esite/shared`.

## 5. Testing

- **Pure:** keyword classifier, project-name matcher (fixtures with ≥2 similar names, e.g. "PNP FAERIE GLEN" / "PNP2"), and the payload codec round-trips for the new kinds.
- **Processor** (fake store and Meta, as in the foundation):
  - menu → my items → card re-sent with buttons;
  - a photo with no target → pick list whose first row is Post → Diary → `wa_post_diary` called with the held photos;
  - a burst of 3 photos → one post;
  - a post expires after 30 minutes;
  - a client viewer's menu has no Post row;
  - an ambiguous project name → pick list, never a guess.
- **SQL dry-runs** as in §3, each refusal mutation-proven (for example, dropping the client-viewer restrictive policy's effect by re-owning the function must turn "client viewer cannot post" red).
- **Suites:** `web`, `@esite/shared` and `@esite/db` all run before any push.

## 6. Open items

1. Whether WhatsApp diary posts should send the diary email (default: no, per §2.3).
2. **Resolved (measured 2026-09-29):** all 14 production projects resolve both `resolve_triage_owner` and `resolve_project_pm`, so nobody is left without an issue owner today. `wa_post_issue` still refuses with "No one is set to receive issues on {project}" if both return NULL. That is a guard, not a live case.
