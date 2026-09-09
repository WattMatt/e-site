# E-Site v2 — detailed design sections

**Date:** 2026-09-09
**Status:** Design, pending approval
**Roadmap summary:** [`../2026-09-09-v2-platform-review-and-roadmap-design.md`](../2026-09-09-v2-platform-review-and-roadmap-design.md) — read that first; it stands alone.

This directory holds the full design. Sixteen sections, ~127 000 words, each written against the live
codebase and the 9 September 2026 production extract, then reconciled against a 53-ruling arbitration
ledger so that no two sections specify the same object differently.

## How to read it

**Appendix A is the source of truth for every shared registry.** The `projects.work_items` DDL, the
work-item types, the notification types and their tiers, the report kinds, the module tokens, the
new-object inventory by quarter, the routes, the working-day calendar and the vendor list all live
there. Every other section cites it rather than re-listing it. If a section and Appendix A ever
disagree, Appendix A wins and the section is wrong.

Ownership, settled during arbitration and not to be relitigated:

| Object | Owning section |
|---|---|
| `projects.work_items` | §03 |
| `public.notifications`, the inbound-email engine | §05 |
| Threads, instructions, the document register | §06 |
| The report engine | §07 |
| The Q4 schema | §08 |
| Roles, participation, pricing | §11 |
| The data model and the migration protocol | §12 |
| Capacity and migration-numbering policy | §13 |
| Q3/Q4 scheduling within that policy | §14 |
| The measurement contract, every headline target, risks, the business case | §15 |
| All shared registries and the new-object inventory | Appendix A |

## Sections

| # | Section | What it settles |
|---|---|---|
| [01](01-summary-and-current-state.md) | Executive summary and current-state review | What exists, what is used, and the five engagement findings |
| [02](02-competitive-synthesis.md) | What the best products do, and where E-Site can win | Ten winning patterns, 25 mechanics worth stealing, three defensible positions |
| [03](03-work-items.md) | Primitive 1 — work items, assignment, ball-in-court | The spine: a mirrored table, one assignee, a generated ball-in-court |
| [04](04-inbox-and-my-work.md) | Primitive 2 — Inbox, My Work, the project home | The front door, and the sidebar declutter |
| [05](05-notifications-and-digests.md) | Primitive 3 — notifications, digests, email participation | Urgency tiers, the 07:00 recap, reply-by-email |
| [06](06-threads-instructions-minutes.md) | Primitive 4 — threads, instructions, minutes | The conversation layer and the JBCC-compliant instruction register |
| [07](07-report-engine.md) | Primitive 5 — the report engine | One harness, periodic reports, register packs, scheduled distribution |
| [08](08-calendar-and-programme.md) | Primitive 6 — calendar, programme, tenant delivery | Dated objects, the lease-to-occupation tracker, procurement lead-times |
| [09](09-capture-and-phone.md) | The capture layer | Phone-first web, the day-end check-in, voice, location, QR |
| [10](10-ai-layer.md) | The AI layer | Chase agent, narrative drafting, and what is deliberately not built |
| [11](11-access-roles-pricing.md) | Access, external participation, pricing | Free external participants; four published bands |
| [12](12-data-model-and-migrations.md) | Data model, migrations, architecture | RLS, the numbering-race protocol, testing, backup and restore |
| [13](13-roadmap-q1-q2.md) | Roadmap — Q1 and Q2 | Capacity ledger, critical paths, cut orders, deliverables |
| [14](14-roadmap-q3-q4.md) | Roadmap — Q3 and Q4 | Deliverables, per-item schedules, what slips past twelve months |
| [15](15-metrics-risks-open-questions.md) | Metrics, risks, rollout, open questions | Eight metrics with measured baselines, the rollout waves, the business case |
| [16](16-appendix-registries.md) | **Appendix A — canonical registries** | Every shared registry, owned here |

## Market research

Five parallel research streams, September 2026, all cited with sources. The competitive synthesis in
§02 is drawn from these.

| File | Products covered |
|---|---|
| [01-field-first](research/01-field-first.md) | Fieldwire, PlanRadar, Dalux, Raken, CompanyCam, Novade |
| [02-enterprise](research/02-enterprise.md) | Procore, Autodesk Construction Cloud, Aconex, Buildertrend, ProjectSight |
| [03-work-os](research/03-work-os.md) | Linear, Asana, monday.com, Basecamp, Slack, Notion |
| [04-trade-and-sa-market](research/04-trade-and-sa-market.md) | Simpro, ServiceTitan, Tradify, ServiceM8, UK certificate apps, the SA market |
| [05-ai-next-gen](research/05-ai-next-gen.md) | Buildots, OpenSpace, Trunk Tools, Document Crunch, Procore Helix, Kojo |

## Working rules this spec inherits

These caused live incidents and are respected throughout. They are restated here because an
implementer who reads only one section still has to honour them.

- Migration numbers race between concurrent sessions, and `supabase db push` keys on the version
  **prefix** — a number already in `schema_migrations` makes it print "up to date", exit 0 and skip
  the file. **A green deploy is not evidence a migration ran.** Read the affected table back.
- `@react-pdf/renderer` silently draws the wrong glyph for non-WinAnsi characters; `pdf-lib` throws.
  Every payload string goes through `winAnsiSafe`.
- PostgREST emits `ON CONFLICT` only when `Prefer: resolution=merge-duplicates` arrives as a header.
  Re-read the row after any upsert.
- Every function in an exposed schema needs `REVOKE ... FROM PUBLIC` **and** an explicit `anon`
  revoke, verified with `has_function_privilege`.
- Never use `current_user` for authorisation inside a `SECURITY DEFINER` function.
- Page-level gating is not a gate. Server actions and `app/api/*` routes are directly invocable, so
  gate in the app **and** with RESTRICTIVE database policies.
- Creating a new schema requires the PostgREST `db_schema` PATCH or REST returns `PGRST002` forever.
- `docs/rbac-matrix.md` changes in the same PR as any route or endpoint; `CONFORMANCE.md` in the same
  PR as any auth change.
- Verify from the empty state a real user starts in, never from a deep link into seeded data.
