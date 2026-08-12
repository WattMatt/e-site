# Site Forms — Termination & Making Safe (design)

**Date:** 2026-08-12
**Status:** Design, pending approval
**Research:** `2026-08-12-termination-making-safe-research.md` (regulatory + precedent study, filed alongside this spec)

---

## 1. Purpose

Site electricians working on an existing installation need a per-board record of the work done to
terminate redundant circuits and make the board safe. Today that is paper, or nothing.

This module gives each project a **Forms** section. An electrician creates one form per existing
distribution board per isolation event, fills it in on a tablet at the board, signs it, and a
reviewer distributes a branded PDF to everyone on the project. The record stays on the project
permanently, filterable by board, so the history of every board is traceable for the life of the job.

The first (and initially only) form is **Termination and Making Safe**.

## 2. What this document is not

This form **is not a Certificate of Compliance and must never resemble one.**

Under the Electrical Installation Regulations, 2009, a CoC may only be issued by a registered person
(reg 9(1)) and may not be amended once issued (reg 9(5)). What we are building is a *works and safety
record* that feeds a supplementary CoC issued later under reg 7(4).

Every page of the generated PDF carries a fixed footer stating this. This is a hard requirement, not
a nicety — a document that reads as a CoC without being one is a professional liability for WM.

## 3. Scope

### In scope

- New `Forms` section per project, in the sidebar.
- One system-seeded form template: Termination and Making Safe, v1.0, 14 sections.
- Forms attach to an existing `structure.nodes` board, with a free-text fallback for boards not yet
  captured in the structure tree.
- Web capture UI (tablet-optimised), per-field photo evidence, drawn signatures.
- Submit-time validation gates that encode genuine legal constraints.
- Branded PDF report, versioned through the existing `projects.reports` pipeline.
- Explicit "Complete & distribute" with a recipient preview, then a branded email to all project
  members.
- A real shared branded email layout (the first in the codebase).
- RBAC gating and `docs/rbac-matrix.md` updates.

### Explicitly out of scope

| Not building | Why |
|---|---|
| Mobile (Expo) capture | Web/tablet chosen. The shared engine and gates are runtime-agnostic, so mobile stays cheap to add later. |
| The full 16-row SANS clause 8 test report | Clause 8 limits differ 2–3× between SANS editions and the licensed edition is unconfirmed. Shipping wrong acceptance limits on a legal document is worse than not shipping them. Section 8B is restricted to the tests a making-safe job actually performs. |
| A generic form *builder* UI | One template, seeded. A builder already exists for inspections; if forms need one later it can be lifted. |
| Migrating existing emails onto the new shared layout | Five live email flows; out of scope for this request. |
| A per-node forms panel on the tenant/board pages | The list page filtered by board covers the tracking requirement. Noted as follow-up. |
| Offline capture | Requires the mobile/PowerSync path. |

## 4. Architecture

### 4.1 Engine reuse

`packages/shared/src/inspections/{types,template-schema,engine}.ts` is a generic, Zod-validated,
runtime-agnostic form engine already shared by web and mobile. It supports every control this form
needs: `pass_fail`, `number`, `text`, `textarea`, `dropdown`, `multi_select`, `date`, `photo`,
`signature`, `file`, `header`, `computed`, `repeating_group`, plus `conditional_on`, `required`,
`unit`, `options`, `min_count`/`max_count`, `item_label_template` and `sans_ref`.

**We reuse it as-is.** `packages/shared/src/site-forms/` imports the engine from `../inspections/`
rather than moving or forking it. Moving the files would touch a live module for cosmetic reasons;
forking would leave two copies of the condition/evaluation logic to maintain. A future rename to a
neutral `forms-engine/` is possible but is not part of this work.

### 4.2 Why a new module rather than extending Inspections

The inspections *module* around that engine does not fit:

- It enforces verifier separation (`assigned → awaiting_verification → certified`); a site form is
  filled and signed by the electrician, then distributed.
- It sits behind a paid feature gate.
- Its `target_node_type` is constrained by a DB trigger to `cable_schedule.boards`/`.sources`. Our
  boards are `structure.nodes`.
- Five SECURITY DEFINER RLS helpers hardcode the inspection status machine. Adding a second lifecycle
  to them risks regressing a working module.

So: new tables, new lifecycle, new UI shell — same engine underneath.

### 4.3 Schema placement

Tables go in the existing **`field`** schema (which already holds snags — site field work).

This deliberately avoids creating a new Postgres schema, which would require a PostgREST `db_schema`
config PATCH via the Management API; without it REST returns `PGRST002` indefinitely with no
auto-recovery. Reusing an exposed schema needs only `NOTIFY pgrst, 'reload schema'`.

## 5. Data model

Migration **00179** (next free number; 00155–00158 and 00174 are gaps, 00178 is the current head).

### `field.form_templates`

`id`, `organisation_id` (NULL ⇒ system template), `template_key TEXT`, `version TEXT`, `name`,
`description`, `schema_json JSONB`, `is_active`, `created_by`, timestamps.

- Immutability trigger on `schema_json` — corrections ship as a new version row, mirroring
  `inspections.enforce_template_immutability`.
- Partial unique indexes for the org and system cases (system templates have a NULL
  `organisation_id`, so a plain unique constraint would not bite).

### `field.site_forms` — the instance

`id`, `organisation_id`, `project_id`, `template_row_id` FK, `form_no TEXT`, `node_id UUID NULL` FK
`structure.nodes ON DELETE SET NULL`, `board_ref TEXT`, `board_label TEXT`, `status`, `as_left_status`,
`created_by`, `submitted_by`/`submitted_at`, `distributed_by`/`distributed_at`,
`report_id` FK `projects.reports(id) ON DELETE SET NULL`, `void_reason`, timestamps.

- `status CHECK (status IN ('draft','submitted','distributed','void'))`.
- `as_left_status` is a **denormalised copy** of the §12 handover answer, written by the submit action
  so the list page can filter and colour by it without loading every form's responses. The response
  row remains the source of truth; the PDF renders from the response, never from this column.

- `CHECK (node_id IS NOT NULL OR NULLIF(TRIM(board_ref),'') IS NOT NULL)` — a form must identify its
  board one way or the other.
- `board_label` denormalises the *as-found* name from the nameplate, which routinely differs from the
  drawing and from `structure.nodes.name`. Both are kept.
- `node_id` is `ON DELETE SET NULL`, not `CASCADE`: deleting a board must never delete the safety
  record of having made it safe. `board_ref`/`board_label` preserve identification.
- `form_no` allocated from `field.form_number_seqs` (PK `(project_id, prefix, year)`) as
  `TMS-{project_code}-{year}-{seq}`, mirroring `inspections.allocate_coc_number`.

### `field.form_responses`

`form_id`, `section_id`, `field_id`, `value_bool | value_number | value_text | value_array TEXT[] |
value_json JSONB`, `pass_state`, `fail_reason`, `latest_responded_by`/`_at`.
`UNIQUE (form_id, section_id, field_id)`. Upserted on autosave.

Repeating groups flatten into sibling responses with synthetic ids (`group[0].sub`), reusing the
existing engine helpers.

### `field.form_response_history`

Append-only mirror written by an AFTER INSERT OR UPDATE trigger. One table, one trigger, one SELECT
policy — cheap, and for a safety record the difference between a document and a checkbox in an
incident enquiry. Rendered as an audit table in the PDF.

### `field.form_photos`

`form_id`, `section_id`, `field_id`, `storage_path`, `caption`, `gps_lat`/`gps_lng`, `taken_at`,
`width_px`/`height_px`, `file_size_bytes`, `sort_order`, `uploaded_by`.

### `field.form_signatures`

`form_id`, `block_id`, `signatory_name`, `signatory_role`, `registration_category`,
`registration_number`, `storage_path`, `signed_by`, `signed_at`.
`UNIQUE (form_id, block_id)`. `block_id ∈ (electrician, registered_person, supervisor, client_witness)`.

### Storage

Two new private buckets, both with **read and write** policies from day one (migration 00073 shipped
inspections read-only — a real bug we do not repeat):

- `site-form-photos` — 10 MB, jpeg/png/webp/heic
- `site-form-signatures` — 512 KB, png

Path convention `{project_id}/{form_id}/{section_id}/{field_id}/{ts}-{safeName}`, so
`(storage.foldername(name))[2]` is the form id — the segment every storage policy keys on.

## 6. Lifecycle

```
draft ──(submit: all mandatory answered AND all hard gates pass)──▶ submitted
                                                                       │
                                                       (distribute: render PDF,
                                                        file report, email)
                                                                       ▼
                                                                 distributed
draft/submitted ──(void, reason required)──▶ void
```

- `draft` is the only writable state. Once submitted, responses freeze.
- **Distributed forms are never reopened.** Correcting a distributed form means voiding it with a
  reason (it stays on record, marked void) and issuing a new one. This mirrors the spirit of EIR
  reg 9(5) — a certificate is not amended, it is reissued.
- Re-distributing an already-distributed form is allowed and produces a **new report version** through
  the existing `projects.reports` supersede chain. The form stays `distributed`.

## 7. Submit-time hard gates

A pure, unit-tested function in `packages/shared/src/site-forms/gates.ts` takes the responses and
returns a list of blocking issues. Reused by the submit action, surfaced in the UI, and asserted in
tests. These encode legal constraints a paper form cannot enforce:

1. **As-left = Energised or Partially energised** requires an insulation-resistance reading ≥ 1,0 MΩ,
   or an explicit clause 8.6.8 NOTE 2 justification.
2. **Any test instrument past its calibration due date** blocks submission.
3. **Prove–test–prove incomplete** (§6.13 prove on known source → §6.15 test dead → §6.16 re-prove)
   blocks submission. This sequence is the entire safety argument of the form.
4. **Any C1 defect (immediate danger)** makes the EIR reg 9(3) fields mandatory — supply disconnected,
   chief inspector notified, notification reference. That is a statutory duty, not a choice.
5. **Registration scope checks:** specialised installation ⇒ master installation electrician only;
   more than one phase ⇒ not an "electrical tester for single phase"; contractor registration expiry
   before the date of work blocks submission.

Gate 5's message wording cites the EIR reg 1 definitions (binding), offering SANS Annex M as the
explanatory table (informative).

Section 6 (safe isolation) is answerable **in order only**. A checklist that can be back-filled after
the fact is worth nothing in an enquiry.

## 8. The form template

Seeded as a system template (`organisation_id IS NULL`), key `termination-and-making-safe`, v1.0, in
migration **00180** (schema and seed split, mirroring 00099/00100).

Source of truth is `packages/shared/src/site-forms/templates/termination-and-making-safe.json`. A
contract test asserts the seeded SQL and the file agree, so they cannot drift.

Fourteen sections:

| § | Section | Notes |
|---|---|---|
| 1 | Project & site identification | Prefilled from the E-Site project. Includes whether the original CoC was obtained before commencement — a commercial-risk field as much as a technical one. |
| 2 | DB identification | Includes **alternative/secondary supplies present** (generator/UPS/PV/bus-tie/landlord) — the most safety-critical field on the form. Also whether any part is above 1 kV (out of SANS 10142-1 scope) and whether the board is landlord sub-reticulation under cl. 7.16. |
| 2A | Existing earthing & bonding adequacy | Verified *before* the board is touched, plus pre-existing damage. On a revamp the contractor is routinely blamed for pre-existing defects; this section is the defence, and it must be answered before work starts. |
| 3 | Date, time & personnel | Registration category and number, plus the **registered person exercising general control** (EIR reg 5(4)), required even when the person on site is not themselves registered. |
| 4 | Scope of work | Including written authorisation to isolate and third-party permit references. |
| 5 | Circuits affected (repeating) | Per circuit: as-found vs as-verified description, conductor size, **action taken**, termination method, **clear break made**, labelled DEAD, borrowed-neutral check, per-row photo. "Taped up" is deliberately not an offered termination method. |
| 6 | Safe isolation checklist | identify → isolate → secure → prove–test–prove → discharge → sign. "Switch left off" is deliberately not an offered securing method (GMR reg 6(2)). |
| 6A | Lock & tag register (repeating) | Per isolation point, with **second-person verification** — the strongest single control on the form. |
| 7 | Test instruments (repeating) | Make/model/serial/calibration/CAT rating. |
| 8A | Proving dead | All L-N/L-E/N-E combinations. A non-zero N–E is the classic borrowed-neutral signature. |
| 8B | Electrical tests | **Restricted scope:** insulation resistance, earth continuity, bonding continuity, polarity. The full 16-row SANS test report is deferred. |
| 9 | Labelling & reinstatement | Including fire-barrier reinstatement, the most commonly missed item on a strip-out. |
| 10 | Photographic evidence | Named slots, matching WM house style, not a generic bucket. |
| 11 | Hazards & defects | Pre-work hazard sweep, plus a defect register graded C1/C2/C3/FI. C1 maps exactly onto the EIR reg 9(3) immediate-danger trigger. Includes extent/limitations of the record. |
| 12 | Handover status | Made safe / energised / left isolated / decommissioned, with conditional re-energisation checks and the responsible party on handover. |
| 13 | Declarations & sign-off | Electrician, registered person, WM supervisor, optional client witness — four separate blocks. Separating them is what makes liability legible. |

## 9. Web UI

| Route | Purpose |
|---|---|
| `/projects/[id]/forms` | List, filterable by board, template and status. Empty state carries the "+ New form" CTA. |
| `/projects/[id]/forms/new` | Template picker + board picker (structure node, with free-text fallback). |
| `/projects/[id]/forms/[formId]` | Capture. Sections, `FieldRenderer`, debounced autosave, per-field photos, signature pads, gate feedback. |
| `/projects/[id]/forms/[formId]` (panel) | Distribute: recipient preview then send. |
| `/api/projects/[id]/forms/[formId]/report` | Inline PDF preview, no persistence. |

Sidebar gets a `Forms` entry in `projectNav` (`components/layout/Sidebar.tsx`) before `Settings`.

Field rendering, photo capture and compression reuse the existing components and the
`compressImage`/orphan-safe upload helper. Uploads go browser → Storage directly, never through a
Vercel function (4.5 MB body cap), and roll back the storage object if the row insert fails.

**Reachability.** PR #159's lesson was that a feature verified by deep link can be unreachable in
practice. Every path is walked from the project's empty state during verification, not from a
pre-seeded URL.

## 10. PDF report

Three-layer split, mirroring the inspections renderer:

- `lib/reports/site-form-report-data.ts` — all I/O; role gate **before** any service-role fetch;
  photos, signatures and logos downloaded to `data:` URIs (React-PDF fetches URLs server-side with no
  timeout and fails silently).
- `lib/reports/site-form-report.tsx` — pure React-PDF tree, zero I/O. Fixed footer on every page
  carrying the non-CoC disclaimer.
- `lib/reports/render-site-form.ts` — buffer bridge.
- `lib/reports/file-site-form-report.ts` — version → upload to the `reports` bucket at
  `{org}/{project}/site-form-{formId}-v{n}.pdf` → insert `projects.reports` with `kind:'site_form'`,
  `source_table:'site_forms'` → supersede prior issued rows. Rolls back the uploaded object if the
  row insert fails.

Note the inverse rules that bite in this codebase: **PDFs need `data:` URIs and never signed URLs;
emails need signed URLs and never `data:` URIs.**

## 11. Email and branding

No transactional email in E-Site currently carries any branding — the per-project accent colour and
client/project logos exist but only ever reach the PDF.

- **New:** `packages/shared/src/email/layout.ts` exporting a genuine shared branded layout —
  accent colour resolved project → org → default, logo as a **7-day signed URL**, project line,
  footer. Runtime-agnostic so it unit-tests in `packages/shared`.
- **New:** `packages/shared/src/email/site-form-email.ts` — `renderSiteFormDistributedEmail(vars)`.
  Carries board, as-left status, the count of circuits left in a temporary state, key photo
  thumbnails, a deep link to the form page (not a signed file URL), and the non-CoC disclaimer.
- **New:** `apps/web/src/lib/site-form-email.ts` — resolves recipients, checks the toggle, renders,
  dispatches via the existing `notifyEntityEvent` → `send-email` edge function → Resend batch chain.
  Never throws.
- `project_settings.notify_form_email BOOLEAN NOT NULL DEFAULT true`, wired through the three mapper
  sites, the Zod schema, `getNotificationConfig`, and the settings UI.
- `notifications_type_check` re-declared with all 17 existing values **plus** `site_form_distributed`.
  The constraint is re-declared wholesale each time, so every value must be re-listed.

The five existing duplicated `baseEmailTemplate` copies are left untouched.

### Recipient preview

`previewFormRecipientsAction(projectId)` returns the resolved names and addresses so the reviewer sees
exactly who will receive the form before sending. This is a direct response to a documented incident
class: `project_notification_recipients()` resolves 12 real wmeng.co.za people for any WM-Consulting
project, and a mistaken send goes company-wide.

## 12. RBAC

| Capability | Roles |
|---|---|
| Create, fill, submit a form | `FORMS_FIELD_ROLES` — all roles except `client_viewer` (electricians are typically `contractor`) |
| Distribute, void, re-distribute | `ORG_WRITE_ROLES` (owner/admin/project_manager) |
| Manage templates | `OWNER_ADMIN` |
| Read | Project members. `client_viewer` sees `distributed` forms only. |

`FORMS_FIELD_ROLES` is added to `packages/shared/src/types/index.ts` alongside the existing groups;
role strings are never hardcoded at call sites.

Gating uses `requireEffectiveRole(supabase, projectId, roles)` so per-project promotion is honoured.

RLS mirrors the inspections helper pattern with three SECURITY DEFINER functions
(`user_can_write_form`, `user_has_form_read`, `user_can_manage_form`), keeping policies to one-liners.
**Every UPDATE policy gets a matching `WITH CHECK` from day one** — migration 00067 had to retrofit
this for inspections to prevent org/project hopping.

`docs/rbac-matrix.md` is updated in the same PR: a page-routes row, an API-routes row, and an actions
table with footnotes.

## 13. Testing

**Shared package**
- Template validates against the existing Zod `templateSchema`.
- Every hard gate: passing case and blocking case.
- Email render: subject, HTML escaping, disclaimer present, and an assertion that image sources are
  signed URLs, never `data:`.

**Web**
- Role-gate tests per action, exercising the real gate for each of the seven roles.
- PDF render regression, including hostile-unicode fixtures (Ω, →, embedded newlines).
- Contract tests, mirroring the snag `photo_type` test that caught a live bug: the seeded template
  JSON matches the file, and every `status` / `block_id` literal in app code is in the DB CHECK set.
  Comments are stripped before scanning, since a literal in a doc comment previously produced a false
  positive.

**Verification before production**
- Applied and verified against a **throwaway project with `notify_form_email = false`**, so no live
  email reaches the 12 real recipients.
- Verified as the `rbac-test` contractor fixture (fill/submit allowed, distribute denied) and as a
  throwaway probe-admin (distribute allowed), then the probe deleted to zero residue.
- The full journey walked from the project's empty state.
- Re-read every settings row after writing it. A `.upsert()` on `project_settings` has twice reported
  success while leaving the value unchanged — PostgREST only performs an upsert when
  `Prefer: resolution=merge-duplicates` arrives as an HTTP **header**. This gates outbound email, so
  it is verified by re-read, not by absence of error.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Wrong SANS acceptance limits on a legal document | §8B restricted to making-safe tests; full test report deferred until the licensed edition is confirmed. Limits stored with the template version, not as constants. |
| The form reads as a CoC | Fixed disclaimer footer on every PDF page and in the email; `deliverable_type` is not `coc`; no CoC number is ever allocated by this module. |
| A test send reaches all 12 real WM recipients | Recipient preview before send; verification runs in a throwaway project with the toggle off. |
| 14 sections is a long form on a tablet | Conditional visibility hides most fields; sections are individually collapsible; autosave is per field, so no work is ever lost. |
| Touching the live inspections module | We do not. New tables, new helpers, new UI; the engine is imported, not modified. |

## 15. Follow-ups (not in this work)

- Per-node forms panel on the board/tenant pages.
- Mobile capture with offline queueing.
- Auto-carry of §2/§5/§7/§8 into a CoC test report — the commercial argument for the module.
- Migrating the five existing email templates onto the shared branded layout.
- Renaming the shared engine to a neutral `forms-engine/`.
- Two SANS unit errors in the existing `lv-coc.json` template (RCD trip time in ms where SANS uses mA;
  a per-circuit max Zs, which SANS does not tabulate). Tracked separately.
