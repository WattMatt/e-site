# 06 — Output & delivery tabs: Proposals, Schedule, Documents, Generation, Monthly Report

**Source:** read-only export of `origin/main` of `WattMatt/greencalc-sa` (the WM Solar web app). Paths are relative to `wmsolar-main/` and citations are `file:line`. No source was modified.
**Review date:** 2026-09-28.
**Scope:** the last five tabs of `src/pages/ProjectDetail.tsx`:

| Tab value | Trigger (ProjectDetail.tsx) | Content (ProjectDetail.tsx) | Root component | Tab-status logic |
|---|---|---|---|---|
| `proposals` | :1287-1290 "Proposals" | :1428-1430 | `ProposalManager` | "blocked" if no simulation, "complete" if any proposal (:1166-1175). The blocked status is **cosmetic only**; the tab stays clickable (`TabWithStatus` :90-120). The count query has **no `document_type` filter**, so monthly reports count as proposals (:1023-1034) |
| `schedule` | :1291-1294 | :1433-1435 | `ProjectGantt` (projectId, projectName) | "complete" if gantt task count > 0 (:1176-1181) |
| `documents` | :1295-1298 | :1437-1439 | `ProjectDocuments` | hard-coded "pending" (:1182-1185) |
| `generation` | :1299-1302 | :1441-1443 | `GenerationTab` | hard-coded "pending" (:1186-1189) |
| `monthly-report` | :1303-1306 | :1445-1447 | `MonthlyReportManager` | hard-coded "pending" (:1190-1193) |

The active tab is component state (`useState("overview")`, :712), not a URL parameter. There is no deep link to any of these tabs, and a reload returns to Overview.

Standalone routes in scope (`src/App.tsx`):
- `/projects/:projectId/proposal` → `ProposalWorkspace` (:87)
- `/portal/:token` → `ClientPortal` (:70). This is **public**: it sits outside the auth wrapper.
- `src/pages/ProposalBuilder.tsx` is **not routed** (its only reference is a file list in the code-review tool).

The document has five parts, each written against the same brief. Each part covers purpose, layout, a control inventory, calculations, the data model, external services, defects and security, upstream consumption and E-Site mapping:
- **Part A:** Proposals (including the proposal workspace, client portal, PDF/LaTeX pipelines and AI edge functions)
- **Part B:** Schedule (Gantt)
- **Part C:** Documents and the Handover checklist
- **Part D:** Generation
- **Part E:** Monthly report

---

## Executive summary (cross-cutting)

### 1. Security posture of these tabs is not fit to port as-is

Projects were org-scoped by `supabase/migrations/20260318090000_add_organizations_and_user_invites.sql`. **None of the child tables in these five tabs were**:
- Gantt, generation, source-guarantee, document, folder and checklist tables use `USING (true)`, or `auth.role()='authenticated'` with no project or org predicate.
- Several have **no `TO authenticated`** clause, so they are open to the **anon key**: `downtime_comments`, `downtime_slot_overrides`, `gantt_task_segments`, the document/checklist tables and the `project-documents` storage policies.
- The unused `report_configs` / `report_versions` tables also have anon CRUD.

Unauthenticated or under-authorised edge functions add to the exposure:
- `compile-latex` is an open proxy that sends client financials to public `texlive.net`.
- `upload-generation-csv` accepts any user JWT, then writes to **any** project with the service role.
- The AI and PDF functions are listed `verify_jwt=false` in `supabase/config.toml` (see Part A for each one's own auth).

In E-Site every one of these must sit behind `user_has_project_access` plus a role gate, and an `@verify` block must prove the RLS behaviourally.

### 2. Two generations of report and PDF tooling coexist

The pipelines are pdfmake, PDFShift/HTML capture, `generate-pdf`, the client-side preview and print view, and the LaTeX → `compile-latex` → texlive.net route. The **live** proposal and monthly-report workspace (`ProposalWorkspaceInline`) uses **only the LaTeX pipeline**. The branding and template choosers are disabled, and colour, logo and company fallbacks are hard-coded to Watson Mattheus. See Part A for which pipelines are still reachable.

### 3. A "monthly report" is a `proposals` row with `document_type='monthly_report'`

It is edited in the proposal workspace. It stores **no report period, no data snapshot and no PDF**. Any hand-edit in the LaTeX editor silently freezes every section as static text (Part E, M1–M2). For E-Site this should become a `projects.reports` version with a period, a JSON metric snapshot and a stored PDF.

### 4. The Generation tab is the only source of truth for guarantee-vs-actual

Generation data is not linked to the simulation or proposal: `generation_records.expected_kwh` is never written, and the guarantee is typed by hand each month per source. The CSV import is additive and non-idempotent, books months into the UI-selected year, and double-counts on council import in some cases (Part D, G3–G5). The downtime and revenue maths is a hand-rolled heuristic:
- fixed 06:00–17:30 window
- 0.05% threshold
- flat per-slot expectation
- a single flat tariff rate

The heuristic is duplicated verbatim in two files.

### 5. The Schedule tab is a self-contained Gantt

It has tasks, milestones, dependencies, baselines, segments, import/export and critical path. Its date-save bug shifts dates by −1 day on each save in UTC+ zones. Its critical path treats every link as FS and ignores lag. Undo/redo, milestone editing and dependency editing are stubs (Part B). It overlaps E-Site's work-item spine only at the "due date" level.

### 6. Documents duplicates E-Site's documents module

The genuinely solar-specific piece is the **handover checklist** (template-driven requirements linked to files, with completion %). Its template sync, folder-name coupling and RLS need a redesign (Part C). The `dropbox-proxy` and `fetch-project-files` edge functions are unused or stubs.

### 7. What these tabs consume upstream

| Upstream source | What is used | Used by |
|---|---|---|
| Simulations (`project_simulations.results_json`, `sandbox_simulations`) | results | proposal financials, cover capacity |
| Tariff | `projects.tariff_id` → `tariff_rates` | proposal tables, Generation revenue (flat rate) |
| Project fields | project data | cover/admin |
| Tenants | tenant data | proposal load analysis |
| Organisation branding | branding | proposal and report covers (partly) |
| Generation tab | generation data | Monthly report, which depends on it entirely |
| — | Schedule and Documents consume only `projectId` | — |

Detailed defect lists with severities are at the end of each part: A (see its defects section), B, C, **G1–G20** (Generation) and **M1–M17** (Monthly report).

---

## Part A — Proposals tab

## Part A — Proposals tab

Source root: `wmsolar-main/`. All citations are `path:line` relative to that root. Read-only review; nothing was modified.

### A.0 Summary of what actually exists

The "Proposals" tab is a **LaTeX-source proposal editor**. The on-screen preview is a PDF compiled by **texlive.net**, a public third-party service, through the `compile-latex` edge function. The file `SwiftLaTeXEngine.ts` is misnamed: it never uses SwiftLaTeX. Beside that live path, the repo carries **four other rendering pipelines** that are mostly dead or disconnected:

| # | Pipeline | Entry point | Reachable from the Proposals tab? | Status |
|---|---|---|---|---|
| 1 | **LaTeX → texlive.net → pdf.js preview → "Export PDF" download** | `LaTeXWorkspace` (`src/components/proposals/latex/LaTeXWorkspace.tsx`) | **Yes (the only live output)** | Live |
| 2 | React HTML preview + "Print Preview" popup | `ProposalPreview.tsx` | Only through the **client portal** `/portal/:token` | Live, but reachable only via the portal (see A.3) |
| 3 | HTML string → `generate-pdf` edge fn → PDFShift | `lib/pdfshift/capturePreview.ts` `generateWYSIWYGPDF`, called from `ProposalExport.tsx` | No. `ProposalExport` is imported nowhere | **Dead** |
| 4 | pdfmake client-side PDF | `components/proposals/generateProposalPDF.ts` + `lib/pdfmake/*` | No. `generateProposalPDF.ts` and `lib/pdfmake/tables.ts` have no importers. `pdfmakeConfig` is used only by the floor-plan export | **Dead** |
| 5 | Print-optimised React view | `ProposalPrintView.tsx` | No importers | **Dead** |
| – | React section components (`sections/*`), charts (`charts/*`) | `sections/index.ts`, `charts/index.ts` | `sections/*`: no importer. `charts/*`: imported only by the dead `ProposalExport` | **Dead** |
| – | `src/pages/ProposalBuilder.tsx` | not in `App.tsx` routes | – | **Dead / unrouted.** It is a "Coming Soon" page holding a copy-able dev prompt (`ProposalBuilder.tsx:8-44,77`) |
| – | `VerificationChecklist.tsx`, `SignaturePanel.tsx`, `SimulationSelector.tsx` (proposals version) | – | `VerificationChecklist` and `SignaturePanel` have no importers. `proposals/SimulationSelector` is imported only by `floor-plan/FloorPlanMarkup.tsx` | **Dead in the proposal flow** |
| – | `hooks/useReportAnalytics.ts` | – | No importers | **Dead** (table `report_analytics` is never written) |

There are **two live builders for the same table**:

- **Builder 1 (in the tab):** `ProjectDetail` → Proposals tab → `ProposalManager` → `ProposalWorkspaceInline`.
- **Builder 2 (routed):** `/projects/:projectId/proposal` → `ProposalWorkspace`. You reach it from the Simulation tab → "Proposal" sub-tab → "Create Proposal" (`SimulationModes.tsx:106,252`). Its behaviour differs in small ways, listed in A.2.

**Critical finding: the proposal lifecycle cannot be completed in the UI.** Nothing in any live component writes `status`. The only status writer is the dead `SignaturePanel`. So every proposal stays `draft`. As a result:

- The **Share** button is permanently disabled. It requires `approved` or `sent` (`ShareLinkButton.tsx:90,95`).
- The **Client View** button never shows. It requires `share_token` plus sent, approved or accepted (`ProposalManager.tsx:123`).
- The client-portal **Sign** card never shows. It requires `sent` (`ClientPortal.tsx:157,260`).

The workflow only works if someone edits the database row directly.

---

### A.1 Proposals tab (`ProjectDetail.tsx` → `ProposalManager`)

**Purpose:** list the project's proposals (versions) and open the builder.

**Layout:**
- Header: title "Proposals" and a "Create Proposal" button.
- A card per proposal: icon, "Version N", status badge, created date, "Signed by X" if present.
- On the right of each card: "Client View" (conditional) and "Edit".
- Empty state: a dashed card with a CTA.

Choosing Create or Edit replaces the whole tab with `ProposalWorkspaceInline`. This is an in-place swap with no route change (`ProposalManager.tsx:60-68`).

Tab wiring and gating:
- The tab trigger is at `ProjectDetail.tsx:1287-1290`. The content is at `ProjectDetail.tsx:1428-1429`.
- The status pill reads **"blocked"** when the project has no simulation (`ProjectDetail.tsx:1166-1174`). This is cosmetic only: a Lock icon (`ProjectDetail.tsx:90-130`, line ~112). The tab is **not disabled**.
- `hasSimulations` comes from a query that fetches only the *latest* simulation (limit 1) and then sets `simulationCount = latestSimulation ? 1 : 0` (`ProjectDetail.tsx:988-1004,1100`).
- The "complete" status comes from a count over all `proposals` rows for the project, **including `document_type='monthly_report'`** (`ProjectDetail.tsx:1023-1034`). A project with only monthly reports therefore shows the Proposals tab as complete.
- The project page also reads the latest proposal's `branding` (`ProjectDetail.tsx:971-985`). This query is independent of the tab.

| Control | Type | What it's for (user terms) | Handler → effect (file:line) | Data read/written | Validation/disabled | Error & empty states |
|---|---|---|---|---|---|---|
| Proposals list | query | See all proposal versions | `useQuery ["project-proposals", projectId]` (`ProposalManager.tsx:19-32`) | READ `proposals.*` where `project_id=` and `document_type='proposal'`, ordered by `created_at desc` | – | Spinner while loading (`:70-76`). **No error UI**: a thrown error leaves the list empty and silent |
| Create Proposal (header) | Button | Start a new proposal | `handleCreate` sets `editingProposalId=null`, `isEditing=true` (`:50-53,85-88`) → mounts `ProposalWorkspaceInline` with `proposalId=null` | none until saved | always enabled, even without simulations | – |
| Create Proposal (empty-state card) | Button | Same | same (`:156-159`) | – | – | Shows "No proposals yet…" card (`:147-161`) |
| Status badge | Badge | Shows lifecycle state | `getStatusColor` (`:34-43`). Text is `status.replace("_"," ")`, which replaces only the first underscore | `proposals.status` | – | Unknown status falls back to the muted colour |
| "Signed by X" | text | Shows client acceptance | render (`:113-117`) | `proposals.client_signature` | – | hidden if null |
| Client View | Button | Open the client portal as the client sees it | `window.open('/portal/'+share_token,'_blank')` (`:123-131`) | `proposals.share_token`, `status` | **Rendered only if** `share_token` exists and status ∈ {sent, approved, accepted}. **Unreachable in practice** (see A.0) | – |
| Edit | Button | Open this version in the builder | `handleEdit(id)` (`:45-48,133-140`) | – | – | – |

There are no delete, duplicate, rename, status-change or "new version from this" controls. Each click on "Create Proposal" creates a brand-new row, with a fresh default state, and gives it `version = max+1`.

---

### A.2 Proposal builder — `ProposalWorkspaceInline` (the tab's builder)

File: `src/components/proposals/ProposalWorkspaceInline.tsx`. The same component is reused by `MonthlyReportManager` with `documentType='monthly_report'` (see Part covering monthly reports).

**Layout:** a full-height flex container sized `h-[calc(100vh-12rem)]` (`:594`), with three regions:
1. **Left: `ProposalSidebar`.** 320 px wide, collapsible to a 48 px icon rail.
2. **Top bar:**
   - Left side: Back arrow, title "Proposal Builder", version and status badges, project name.
   - Right side: "N versions" indicator, Export PDF, Export Excel, Share, and Save / Create Proposal.
3. **Main area: `LaTeXWorkspace`.** A resizable split: the LaTeX source editor on the left (45%) and the compiled PDF preview on the right (55%).
   - Empty state: "No Simulation Data – Select or create a simulation to preview the proposal" (`:731-740`).

**There is no simulation picker in this builder.** The code auto-selects the most recent `project_simulations` row (`:378-383`), and there is no way to choose another one or a sandbox. `SimulationSelector.tsx` exists but is not mounted. An existing proposal reloads its saved `simulation_id` or `sandbox_id` (`:283-289`). A new proposal can never pick a sandbox.

**Several editable fields have no UI.** `executiveSummary`, `customNotes`, `assumptions`, `disclaimers` and `verificationChecklist` exist as state (`:76-100`) and are saved, but **no input control exists for any of them** in the live builder. They can only be:
- loaded from an existing row, or
- left at defaults. `disclaimers` defaults to a hard-coded sentence (`:98-100`).

The Branding and Template sidebar tabs are disabled (below). So branding is only ever auto-copied from organisation settings.

#### Data loaded on mount

| Query key | Source | Purpose |
|---|---|---|
| `["project", projectId]` | `projects.*, tariff_plans(id,name)` (`:124-136`) | project name, location, area, connection, client name, tariff name |
| `["generation-available-periods"]` | `generation_readings.timestamp` (monthly_report only) (`:141-164`) | month/year pickers (monthly reports only) |
| `useMonthlyReportData` | (monthly only) (`:193-197`) | – |
| `["project-simulations"]` | `project_simulations.id,name,solar_capacity_kwp,battery_capacity_kwh,created_at,results_json` (`:199-211`) | source numbers |
| `["project-sandboxes"]` | `sandbox_simulations.id,name,scenario_a,created_at` where `cloned_from_project_id=` (`:213-235`) | sandbox numbers (only used when reopening a sandbox-based proposal) |
| `["project-tenants"]` | `project_tenants.*, shop_types(*), scada_imports(*)` (`:237-249`) | Load Analysis table. **Pulls full `scada_imports` rows, including raw data, just to list tenants** |
| `["proposal", currentProposalId]` | `proposals.*` (`:251-264`) | existing proposal |
| `["proposal-versions", projectId]` | `proposals.id,version,status,created_at` filtered by `document_type` (`:266-279`) | next version number and the "N versions" indicator |
| `useOrganizationBranding()` | `organization_members` → `organization_branding` by `org_id`, falling back to `user_id` (`hooks/useOrganizationBranding.ts:40-103`) | auto-fills branding on **new** proposals only (`:108-122`), and as a fallback per field on existing ones (`:292-302`) |

#### Top-bar control inventory

| Control | Type | What it's for | Handler → effect (file:line) | Data read/written | Validation/disabled | Error & empty states |
|---|---|---|---|---|---|---|
| Back (←) | Icon button | Return to the list | `onBack` → `ProposalManager.handleBack` (`:620`; `ProposalManager.tsx:55-58`) | – | – | **Unsaved changes are discarded silently.** There is no dirty-state guard |
| Title / badges | text | Shows version and status | `:625-633` | `proposals.version,status` | Badges only for saved proposals | – |
| Year / Month selects | Select ×2 | (monthly reports only) | `:636-667` | `generation_readings` | only when `documentType==='monthly_report'` | falls back to the current value if no periods exist |
| "N versions" | text + icon | Hints that there are other versions | `:672-677` | `proposal-versions` | shown if more than 1 | **Not clickable.** There is no version history browser or diff |
| Export PDF | Button | Download the compiled PDF | `handleExportPDF` (`:493-509`) → `downloadPdf(pdfBlobRef.current, "<project>-v<version>.pdf")` (`lib/latex/SwiftLaTeXEngine.ts:53-60`) | the in-memory blob from the last **Sync** compile. No DB or storage write | disabled if `!simulationData` or exporting (`:682`) | If nothing has compiled yet: toast "No compiled PDF available. Wait for compilation to finish." **The blob is from the last manual Sync, so it can be stale** relative to the editor text. The PDF is **never saved** to storage, `proposals`, or any documents table |
| Export Excel | Button | Download key numbers | `handleExportExcel` (`:511-543`) builds a 16-row CSV (`"Solar Proposal Export"`, project, version, capacities, generation, cost, savings, payback, ROI, plus NPV/IRR/LCOE if truthy) | none | disabled if `!simulationData` | Labelled "Excel" but produces **`.csv`**. No quoting or escaping, so a comma in the project name breaks the columns. Toast "Excel/CSV exported" |
| Share | Dialog trigger (`ShareLinkButton`) | Create or copy the client link | see A.2.4 | `proposals.share_token` | rendered only for a saved proposal (`:700-710`). **Disabled unless status is approved or sent. Always disabled in practice** | – |
| Save / Create Proposal | Button | Persist the proposal | `saveMutation` (`:431-491`). UPDATE when `currentProposalId` is set (`:435-453`), otherwise INSERT with `version: nextVersion, document_type` (`:455-476`), then set `currentProposalId` | WRITES `proposals`: `simulation_id`/`sandbox_id`, `verification_checklist`, `branding`, `executive_summary`, `custom_notes`, `assumptions`, `disclaimers`, **`simulation_snapshot` (the current live mapping, see A.2.6)**, `content_blocks`, `section_overrides`, `updated_at` | disabled while pending | Toast "Proposal created" or "Proposal saved". On error: "Failed to save proposal" (the label says "proposal" even for monthly reports). **No `status`, `prepared_by` or owner column is written. No `created_by`. No org id.** An accepted or sent proposal can still be edited and re-saved, and its `simulation_snapshot` overwritten |

#### A.2.1 Sidebar — `ProposalSidebar.tsx`

| Control | Type | What it's for | Handler → effect (file:line) | Data | Validation/disabled | Notes |
|---|---|---|---|---|---|---|
| Collapse (‹) | Icon button | Collapse the sidebar | `onToggleCollapse` (`:161`) | – | – | – |
| Expand (›) (collapsed rail) | Icon button | Expand | `:135-142` | – | – | – |
| Rail: Content icon | Icon button | Expand and show the Content tab | `:143-145` | – | – | – |
| Rail: Branding icon | Icon button | Expand and show the Branding tab | `:146-148` sets `activeTab="branding"` | – | **Back door:** the Branding trigger is disabled, but this sets the tab value programmatically, so `BrandingForm` renders and **is editable**. It is an unintended path | – |
| Rail: Template icon | Icon button | Expand and show the Template tab | `:149-151` | – | Same back door for `TemplateSelector` | Template choice has **no effect on the LaTeX output** |
| Tab "Content" | Tab | Toggle and reorder sections | `:169-172` | – | – | – |
| Tab "Branding" | Tab | Edit branding | `:173-176` | – | **`disabled`** (greyed, `cursor-not-allowed`) | Stub |
| Tab "Template" | Tab | Choose a visual template | `:177-180` | – | **`disabled`** | Stub |
| Section filter (cycling button) | Button | Filter the list: All → General → Proposal → Monthly Report | `:187-202` cycles `blockFilter` | local | – | Starts at `documentType`. The filter only hides rows. Hidden blocks keep their enabled state and still render |
| Section row (per block) | `ContentBlockToggle` | Include or exclude a section, reorder it, AI-write it | see below | `contentBlocks` state → saved to `proposals.content_blocks` | – | – |
| Drag handle / row drag | HTML5 DnD | Reorder sections | `handleDragStart/Over/Drop/End` (`:93-123`) | `order` field | – | **Bug:** the drop handler reorders only the *filtered* `sortedBlocks` and passes that subset to `onContentBlocksChange` (`:111-115`). **Blocks hidden by the filter are dropped from state**, so reordering under a filter deletes the other categories' blocks until reload |
| On/off Switch | Switch | Enable or disable a section | `handleBlockToggle` (`:86-91`; `ContentBlockToggle.tsx:95-100`) | `enabled` | disabled if `block.required`. **No block is `required`**, so even Cover and Signature can be turned off | – |
| Wand (✨) | Icon button | Generate AI narrative for the section | `ContentBlockToggle.tsx:72-93` → `handleGenerateNarrative` (`ProposalSidebar.tsx:125-130`) → parent `handleGenerateNarrative` (`ProposalWorkspaceInline.tsx:545-579`) → `supabase.functions.invoke('generate-proposal-narrative', {sectionType, projectData})` | Edge fn (Anthropic). Stored **only in React state `aiNarratives`** | Shown only for 5 blocks mapped in `NARRATIVE_SECTION_MAP` (`ProposalSidebar.tsx:24-30`): introduction→executive_summary, backgroundMethodology→tariff_details, tenderReturnData→engineering_specs, financialEstimates→payback_timeline, financialConclusion→investment_recommendation. Silently no-op if `!simulationData \|\| !project` (`:546`) | **STUB / broken:** the returned narrative is **never inserted into the LaTeX, never persisted, never shown**. The only visible effect is a toast plus a small wand icon "AI narrative generated" (`ContentBlockToggle.tsx:56-65`). Lost on reload. On error: toast "Failed to generate AI narrative". In Builder 2 (`ProposalWorkspace`) `onGenerateNarrative` is not passed, so the wand is not rendered at all |

The sidebar's `onExportPDF`, `onExportExcel`, `isExporting`, `proposal` and `project` props are accepted but **not used** (`:54-72`). There are no export buttons in the sidebar.

Content blocks (`types.ts:155-180`). Label, default enabled state, category and order:

| id | Label | Category | Default | LaTeX generator |
|---|---|---|---|---|
| cover | Cover Page | general | on (0) | `snippets.coverPage` |
| tableOfContents | Table of Contents | general | on (1) | `snippets.tableOfContents` |
| adminDetails | Administrative Details | proposal | on (2) | `snippets.administrativeDetails` |
| introduction | Introduction | proposal | on (3) | `snippets.introduction` |
| backgroundMethodology | Background & Methodology | proposal | on (4) | `snippets.backgroundMethodology` |
| tenderReturnData | Tender Return Data | proposal | on (5) | `snippets.tenderReturnData` |
| loadAnalysis | Load Analysis | proposal | on (6) | `snippets.loadAnalysis` |
| financialEstimates | Financial Estimates | proposal | on (7) | `snippets.financialEstimates` |
| financialConclusion | Financial Conclusion | proposal | on (8) | `snippets.financialConclusion` |
| cashflowTable | Project Cash Flows | proposal | on (9) | `snippets.cashflowTable` |
| terms | Terms & Conditions | proposal | on (10) | `snippets.termsAndConditions` |
| executiveSummary, dailyLog, operationalDowntime, financialYield, performanceLog | monthly-report blocks | monthly_report | on (2..6) | `monthlyReportSnippets.*` |
| signature | Signature Block | general | on (99) | `snippets.signatureBlock` |

In Builder 1, cross-category blocks start **disabled** (`ProposalWorkspaceInline.tsx:56-63`). Saved blocks are merged over the defaults (`:312-321`).

**In Builder 2 (`pages/ProposalWorkspace.tsx:44`) the raw `DEFAULT_CONTENT_BLOCKS` are used.** All five monthly-report blocks are `enabled:true`, and their `order` values 2..6 collide with the proposal blocks. So a new proposal created from the Simulation-tab route **interleaves monthly-report placeholder sections into the proposal PDF**. The sidebar filter defaults to "proposal", so the user cannot see why. Builder 2 also replaces the saved `content_blocks` wholesale instead of merging (`ProposalWorkspace.tsx:241-243`).

#### A.2.2 BrandingForm (reachable only through the rail back door)

`BrandingForm.tsx`. Its fields:
- `company_name` (Input `:61-67`)
- `logo_url` (free-text URL, with an `<img>` preview that hides itself on error, `:72-89`)
- `primary_color` (colour picker plus hex text, `:100-113`)
- `secondary_color` (`:119-132`)
- `contact_email` (`:144-151`)
- `contact_phone` (`:158-164`)
- `website` (`:173-179`)
- `address` (Textarea `:187-194`)

Every field calls `update(field, value)` (`:18-20`), which sets an empty value to `null`. There is **no validation** (no URL, email or hex check). There is no logo upload, even though the org-level `branding` bucket exists. The "From Settings" badge needs an `autoPopulated` prop that is **never passed** (`ProposalSidebar.tsx:230-234`). The "Set up in Settings" link goes to `/settings` (`:46-54`).

**Effect on output:** none in LaTeX. The preamble hard-codes the colour `titleblue` RGB 23,109,177 and has the comment "branding/template influence disabled for now" (`lib/latex/templates/proposalTemplate.ts:89-90`). The logo is a TikZ box with the letters "WM" (`proposalTemplate.ts:166-176`, `snippets.ts:88-96`). Only `company_name`, `address` and `contact_phone` appear, on the cover (`snippets.ts:45-47`). Branding *is* used by the client portal header, footer and `ProposalPreview`.

#### A.2.3 TemplateSelector (back door only)

`templates/TemplateSelector.tsx:29-85` offers four buttons: **modern**, **classic**, **premium** and **minimal**. Their definitions are in `templates/types.ts:93-218`. Each holds colours, typography and layout tokens. `onSelect` sets `selectedTemplate`, which is **never persisted** (there is no column) and **never consumed** by LaTeX. It would affect only `ProposalPreview` (portal), and the portal always uses the default `"modern"` (`ProposalPreview.tsx:24`).

#### A.2.4 ShareLinkButton dialog

`ShareLinkButton.tsx`.

| Control | Type | What it's for | Handler → effect | Data | Validation/disabled | Error/empty |
|---|---|---|---|---|---|---|
| Share | Dialog trigger | Open the share dialog | `:94-99` | – | `disabled={!canShare}`, where `canShare = status==='approved'\|\|'sent'` (`:90`) | Always disabled today |
| Generate Share Link | Button | Create a portal token | `generateToken` (`:40-63`): a 16-byte `crypto.getRandomValues` hex token (128-bit), then `UPDATE proposals SET share_token` | WRITE `proposals.share_token` | disabled while generating | toast "Failed to generate share link". The DB function `generate_share_token()` (migration `20251215032330…:9-16`) is **unused** |
| Link field | read-only Input | Shows `${origin}/portal/${token}` | `:115-119` | – | – | – |
| Copy | Icon button | Copy the link | `copyToClipboard` (`:65-76`) | clipboard | – | toast "Failed to copy link" |
| Client email | Input (email) | Recipient for Gmail | `:132-137` | local only | **Not validated. Interpolated raw (unencoded) into the Gmail URL `to=` parameter** (`:85`) | – |
| Open Gmail | Button | Draft an email in the browser's Gmail | `handleGmailShare` (`:78-88`) opens `mail.google.com/mail/?view=cm&…` | – | – | **No server-side email is sent and nothing is logged.** Works only for Gmail users |
| – | – | – | – | – | – | There is no revoke or regenerate control once a token exists, no expiry, and no view tracking |

The dialog text states the risk plainly: "This link allows anyone with access to view and sign the proposal" (`:145-148`).

#### A.2.5 LaTeX workspace — editor and preview

`latex/LaTeXWorkspace.tsx`, `latex/LaTeXEditor.tsx`, `latex/PDFPreview.tsx`.

**Source generation:** `assembleSource()` (`LaTeXWorkspace.tsx:16-41`) builds the document:
- the preamble (`generatePreamble`),
- then `\begin{document}`,
- then each **enabled** block, sorted by `order`, wrapped in `%%-- BEGIN:<id> --%%` … `%%-- END:<id> --%%` delimiters (`types.ts:259-261`),
- then `\end{document}`.

The source is regenerated whenever `templateData` changes (`:71-85`).

**Override persistence:** on *any* manual keystroke, `handleSourceChange` parses **every** delimited section and stores **all** of them as overrides (`:97-106`). It also stores inter-section text as `__prefix__<id>` keys (`:108-158`). These go to `proposals.section_overrides` on the next Save.

Consequences:
- **One keystroke anywhere freezes every section.** After that, simulation, tenant or branding changes never flow into any section again. There is no "reset section to generated" control.
- **Preamble edits and text after the last section are not persisted.** Only the text between sections is captured.
- Overrides for blocks that were later disabled stay stored.

**Compile:** manual only, through **Sync** (`:191-195`). `compileLatex(src)` (`lib/latex/SwiftLaTeXEngine.ts:19-51`) calls the `compile-latex` edge function. The result is ignored if the source changed in the meantime (`:168`). A successful compile sets `pdfData` and calls `onPdfReady(blob)` (Export PDF uses this blob). The client-side check treats a `Blob` as a PDF if `type==='application/pdf' || size>100` (`SwiftLaTeXEngine.ts:27`). A large error blob would be mis-classified as a PDF.

| Control (editor) | Type | Purpose | Handler (file:line) | Notes |
|---|---|---|---|---|
| Source textarea | textarea with overlay highlighting | Edit raw LaTeX | `handleChange` (`LaTeXEditor.tsx:265-273`). With folded sections, `reconstructSource` diff-maps the edit back to the full source (`:113-197`) | Keydown capture stops Radix from swallowing keys (`:213-221,275-277`) |
| Tab key | keyboard | Insert 2 spaces | `:278-295` | – |
| Wrap | toggle button | Word wrap | `:387-396` | uses a mirror div to measure line heights (`:321-359,420-446`) |
| "N lines" | text | Line count | `:397-399` | – |
| **Sync** | Button (pulses when stale) | Compile and refresh the preview | `onSync` → `handleSync` (`:400-415`; `LaTeXWorkspace.tsx:191-195`) | disabled while compiling. **No auto-compile**, so the preview can be stale |
| Fold chevrons (gutter) | buttons | Collapse or expand a section (and the preamble, `_prologue`) | `toggleSection` (`:256-263,477-488`) | – |
| Right-click → Enable/Disable Word Wrap | context menu | – | `:577-580` | – |
| Right-click → Collapse/Expand All Sections | context menu | – | `:581-593` | – |
| Right-click → `\newpage`, `\pagebreak`, `\clearpage` | context menu | Insert a page break at the cursor | `insertAtCursor` (`:298-319,595-604`) | – |

| Control (preview) | Type | Purpose | Handler (file:line) | Notes |
|---|---|---|---|---|
| ◀ / ▶ | Buttons | Previous/next page | `PDFPreview.tsx:228-242` | – |
| Page number input | text | Jump to a page | `handlePageInputCommit` (`:179-186,231-238`) | Invalid input reverts |
| Zoom out / in | Buttons | Change zoom by ±25% (range 25–500%) | `:112-120,248-250` | – |
| Fit to width | Button | Reset zoom | `:122,251` | – |
| Ctrl/⌘ + wheel | gesture | Zoom by ±10% | `:125-142` | – |
| Left/middle-drag | gesture | Pan | `:145-177` | – |
| States | – | – | "Compiling LaTeX…" (`:188-195`); **Compilation Error** panel with the raw texlive log (`:197-209`); "Click Sync to compile and preview PDF" (`:211-218`) | The pdf.js worker loads from **cdnjs** (`:7`) |

#### A.2.6 Simulation → `SimulationData` mapping (the source of every number)

`ProposalWorkspaceInline.tsx:334-375` (duplicated at `pages/ProposalWorkspace.tsx:257-298`).

For a **profile simulation**, it reads `project_simulations.results_json` (`results`):

| `SimulationData` field | Source | Fallback |
|---|---|---|
| solarCapacity | `solar_capacity_kwp` | 0 |
| batteryCapacity | `battery_capacity_kwh` | 0 |
| batteryPower | `results.batteryPower` | 0 |
| annualSolarGeneration | `results.annualSolarGeneration` | **`kWp × 1600`** |
| annualGridImport / Export | `results.annualGridImport/Export` | 0 |
| annualSavings | `results.annualSavings` | 0 |
| paybackYears | `results.paybackYears` | 0 |
| roiPercentage | `results.roiPercentage` | 0 |
| systemCost | `results.systemCost` | **`kWp × 12000`** (R/kWp) |
| tariffName | `projects.tariff_plans.name` | `results.tariffName` |
| location | `projects.location` | – |
| npv, irr, lcoe, yearlyProjections | `results.*` | undefined |
| mirr, equipmentSpecs, demandSavingKva, sensitivityResults, selfConsumptionRate, gridIndependence, co2Avoided | **never mapped** | undefined |

**Critical data-contract defect.** The two writers of `results_json` do **not** write most of these keys:
- `useAutoSave.ts:117-153` writes `totalDailySolar`, `totalGridImport` (daily), `annualSavings`, `systemCost`, `paybackYears`, `roi`, plus configuration.
- `SavedSimulations.tsx:193-221` spreads `SimulationResult` = {totalDailyLoad, totalDailySolar, totalGridImport, totalSolarUsed, annualSavings, systemCost, paybackYears, roi, peakDemand, newPeakDemand} (`SavedSimulations.tsx:32-43`) plus configuration.

So in practice:
- `annualSolarGeneration` always equals **kWp × 1600**. The simulated yield is ignored.
- `roiPercentage` is always **0**. The key is `roi`, not `roiPercentage`.
- Grid import and export are **0**.
- NPV, IRR, LCOE, MIRR and `yearlyProjections` are **undefined**. The advanced engine's `yearlyProjections` (`AdvancedSimulationTypes.ts:414`) is never persisted.
- The **Project Cash Flows section therefore always prints "Detailed yearly projections are not available"**, and every IRR, MIRR, NPV and LCOE cell in Financial Estimates prints **0.00**.

For a **sandbox** (reopen only), the values are hard-coded:
- `annualSolarGeneration = kWp×1600`
- `annualSavings = kWp×1600×2.5` (implied R2.50/kWh)
- **`paybackYears = 5`**
- **`roiPercentage = 300`**
- `systemCost = kWp×12000`

(`:357-374`)

`simulation_snapshot` is **re-captured from the live simulation on every Save** (`:447`). It is not frozen at "send" time.

---

### A.3 Client portal — `/portal/:token` (`src/pages/ClientPortal.tsx`)

This is a public route, outside `ProtectedRoute` (`App.tsx:70`).

**Layout:**
- Branded header, coloured with `branding.secondary_color`: logo, company name, "Proposal for <project>", and a Version badge in the primary colour.
- A two-thirds column with `ProposalPreview`.
- A one-third sidebar holding the Status card, the Sign card (conditional) and the Contact card.
- A footer with the company name and the year.

**Data (all run with the anon key unless the viewer is logged in):**

| Query | Code | Effective RLS for an anonymous visitor |
|---|---|---|
| proposal by token | `proposals.select('*').eq('share_token', token).single()` (`:25-40`) | Allowed. But **any** row is readable anyway (see A.7) |
| project | `projects.select('*').eq('id', project_id)` (`:43-56`) | **Denied.** `projects` SELECT is `TO authenticated` only (`migrations/20251215032623…:8-11`). Result: `project=null`, so the header reads "Proposal for " (blank), the site page is empty, and there is no map, area or connection size |
| tenants | `project_tenants.*, shop_types(*), scada_imports(shop_name, area_sqm, load_profile_weekday, load_profile_weekend, date_range_start, date_range_end, detected_interval_minutes)` (`:59-72`) | `project_tenants` and `shop_types` are **open to anon** ("Anyone can view", `20251205041711…:76,81`). `scada_imports` is authenticated-only, so the embedded object is null |
| shop types | `shop_types.*` (`:75-82`) | open |

**Portal control inventory:**

| Control | Type | What it's for | Handler → effect (file:line) | Data | Validation/disabled | Error & empty states |
|---|---|---|---|---|---|---|
| (page load) | – | – | – | – | – | Spinner "Loading proposal..." (`:127-136`). On an error or missing row: card "Proposal Not Found — This proposal link is invalid or has expired" (`:138-152`). **Tokens never expire**, so the wording is misleading |
| Status card | display | Shows the state | `:218-257` | `status`, `client_signature`, `client_signed_at` | – | accepted → green tick, "Signed by X" plus date. sent → "Awaiting Your Signature". Otherwise the raw status string |
| "Your Full Name" | Input | Typed-name e-signature | `setClientName` (`:273-279`) | – | Must be non-blank | – |
| "I have reviewed… agree…" | Checkbox | Consent | `:282-291` | **not stored** | required | – |
| **Sign & Accept Proposal** | Button | Accept the proposal | `handleSign` (`:113-125`) → `signMutation` (`:85-111`): `UPDATE proposals SET client_signature=name, client_signed_at=now(), status='accepted' WHERE id=… AND share_token=token` | WRITE `proposals.client_signature, client_signed_at, status` | disabled if name is empty, the box is unticked, or signing is in progress (`:299`). The whole card shows only when `status==='sent'` (`:157,260`) | toast "Proposal signed successfully!" or "Failed to sign proposal". **Bug:** `setIsSigning(false)` runs after `await mutateAsync()`, so on a rejected mutation the button stays in its spinner state (`:122-124`). **No identity capture:** no email, OTP, IP, user agent, document hash, or copy of the text that was agreed. **No notification** to the proposer |
| Email link | `mailto:` | Contact the proposer | `:324-331` | `branding.contact_email` | shown if present | – |
| Phone link | `tel:` | Contact the proposer | `:332-339` | `branding.contact_phone` | – | – |
| **Decline** | – | – | **Does not exist.** `rejected` is in the enum but nothing sets it | – | – | – |

The portal renders **`ProposalPreview`**. This is a *different document* from the LaTeX PDF the proposer edited. It ignores `content_blocks` and `section_overrides`, and it uses different financial assumptions (see A.5). **The client sees different numbers and a different structure from the PDF the proposer exported.**

The portal passes only `{version, status, branding, executive_summary, assumptions, disclaimers}` (`ClientPortal.tsx:160-167`). As a result:
- `prepared_by`, `approved_by`, `client_signature`, `custom_notes` and `verification_checklist` are **never shown** in the portal preview.
- The Signatures block is always blank, even after acceptance.

#### A.3.1 `ProposalPreview` (portal document)

`ProposalPreview.tsx`. It paginates the document into pages. The page list is built at `:82-102`:

1. Cover & Summary
2. Site Overview
3. System Design (only if `showSystemDesign` is set **and** a `pv_layouts.pv_arrays` row exists. The portal never passes `showSystemDesign`, so this page never appears)
4. Load Analysis (only if `tenants && shopTypes`)
5. System Specification
6. Financial Analysis
7. Terms & Signatures

| Control | Type | Purpose | Handler | Notes |
|---|---|---|---|---|
| Previous / Next | Buttons | Page navigation | `:539-547,577-585` | disabled at the ends |
| Page number chips | buttons | Jump to a page | `:551-564` | – |
| **Print Preview** | Button | Open all pages in a printable popup | `openPrintPreview` (`:125-423`). `window.open('')` + `document.write` of an HTML string. **Only 5 pages** (cover, site, specs, financial, terms; `:344-348`). Load and design pages are omitted, but the header still says "Page n of totalPages" with the 7-page count | **XSS sink:** `executive_summary`, `assumptions`, `disclaimers`, `prepared_by`, `approved_by`, `client_signature`, `project.name`, `company_name` and the `logo_url` attribute are interpolated **unescaped** (`:137-140,187,309,313,320-332`) into a same-origin `about:blank` window. Popup blocked → `alert(...)` (`:127-129`) |
| In the popup: 🖨️ Print / Close | buttons | `window.print()` / `window.close()` | `:412-417` | – |
| Show Years 11-25 / Show Less | Button | Expand the projection table | `:882-901` | – |
| Location map | `ProposalLocationMap` | Satellite map of the site | `ProposalLocationMap.tsx:22-78`: fetches the Mapbox token from the `get-mapbox-token` edge fn (no auth); style `satellite-streets-v12`, zoom 15, non-interactive, custom marker | Placeholder "Coordinates not set" if lat/lng are missing (`:81-91`). Always the placeholder for anonymous visitors, because `project` is null |
| Load Analysis | `LoadProfileChart` | Tenant load profile chart | `:724-730`. Default coordinates are **Cape Town (-33.9249, 18.4241)** when the project has none | Owned by another part (load profile) |

---

### A.4 Builder 2 — routed `ProposalWorkspace` (`/projects/:projectId/proposal[?id=]`)

`pages/ProposalWorkspace.tsx` is functionally a near-copy of A.2. The differences:
- It is full-screen (`h-screen`). Back navigates to `/projects/:id` (`:500`).
- A new proposal is created then `navigate(...?id=<new>, {replace:true})` (`:395`).
- **There are no Export PDF or Export Excel buttons.** `handleExportPDF` and `handleExportExcel` exist (`:410-460`) but are passed only to the sidebar, which never renders them. **Dead handlers.**
- There is no AI narrative wand (no `onGenerateNarrative` prop, `:477-492`).
- `proposalVersions` is **not filtered by `document_type`** (`:194-207`), so monthly reports take up proposal version numbers.
- The INSERT omits `document_type` and relies on the DB default `'proposal'` (`:377-391`).
- Content blocks are the raw defaults, with monthly-report blocks enabled (see A.2.1).
- It has no monthly-report support.

---

### A.5 (a) Sections produced, per output path, and their content source

#### Path 1 — LaTeX (live), `lib/latex/templates/snippets.ts`

**Preamble** (`proposalTemplate.ts:87-211`):
- A4 article, 11pt, Carlito font, margins 25.4/25.4/25.4 mm, top 40 mm.
- Colour `titleblue` = RGB 23,109,177 (hard-coded).
- Fancy header: project name, "SOLAR PV INSTALLATION → Financial Analysis", `\today`, "Rev 00N" (the version padded to 3 digits), and a TikZ "WM" logo.
- **Footer prints the literal placeholders `[DOCUMENT_NUMBER_PLACEHOLDER]`, `[PRINT_DATE_PLACEHOLDER]` and `[FILE_PATH_PLACEHOLDER]` on every page** (`:190-196`).

| Section | Generator (file:line) | Content & source |
|---|---|---|
| Cover | `coverPage` (`snippets.ts:36-114`) | Blue sidebar. Project name (`projects.name`). "SOLAR PV INSTALLATION / Financial Analysis". "`solarCapacity` kW_AC" (the kWp value is labelled **kW AC**). "PREPARED BY": `branding.company_name` or the **hard-coded "WATSON MATTHEUS CONSULTING ELECTRICAL ENGINEERS (PTY) LTD"**; `branding.address` or the **hard-coded "141 Witch-Hazel Avenue, Highveld Techno Park, Building 1A"**; `branding.contact_phone` or **"(012) 665 3487"**; Contact: `proposal.prepared_by` or **"Mr Arno Mattheus"** (`:45-48`). Date `\today`. Revision |
| Table of Contents | `tableOfContents` (`:118-132`) | `\tableofcontents`. **Needs two LaTeX passes.** texlive.net's latexcgi runs latexmk, which is expected to handle this. Not verified |
| Administrative Details | `administrativeDetails` (`:136-143`) | `projects.location` or `simulation.location`; `projects.client_name` |
| Introduction | `introduction` (`:147-154`) | Boilerplate plus `solarCapacity` ("kWp AC") and `batteryCapacity`. Fixed claim: "installed on all possible roofs" |
| Background & Methodology | `backgroundMethodology` (`:158-234`) | The TOU tariff table puts **the single `yearlyProjections[0].energyRate` into every cell** (Peak, Standard, Off-peak, high and low season, blended) (`:193-196`). Demand rate from `yearlyProjections[0].demandRate`. Hard-coded prose and inputs: cost of capital 9%, CPI 6%, electricity inflation 10%, duration 20 yr, adjusted discount rate 15%, LCOE cost of capital 9%, MIRR finance rate 9%, MIRR reinvestment rate 10%. Insurance comes from year 1 `insurance`. Replacement cost is the first year with `replacementCost>0`. Its breakdown is labelled "10% On Solar Module Cost / 50% On Inverter Cost / 40% On Battery Cost" but computed as **×0.265 / ×0.569 / ×0.166** (`:165-169,228-230`). Labels and maths disagree. Because `yearlyProjections` is never present, every rate prints **R0.0000** |
| Tender Return Data | `tenderReturnData` (`:238-289`) | Project cost = `systemCost`. O&M = 3 × year-1 O&M. **Hard-coded rand lines:** Health & Safety Consultant 45,000; Water Points 90,000; CCTV 60,000; Generator Integration 0; MV Switch Gear 100,000; Professional Fees 530,000; Project Management Fees 158,091; Project Contingency 149,241. "Total Capital cost" = `systemCost`, which does **not** equal the listed lines. Foreign-exchange share = 45% × cost. Energy yield in year 1. kVA saving (`demandSavingKva`, never mapped, so 0). Lifespan yield = Σ `yearlyProjections.energyYield`, or `baseYield × 20` (no degradation). Degradation printed as 1.50% in year 1 and 0.50% after (stated, never used). Panel count, area (= panels × **2.7 m²**), lifespan 20. kWp DC = panelW×count/1000 or **AC × 1.33**. kWp AC. Module efficiency |
| Load Analysis | `loadAnalysis` (`:293-318`) | Table rows: `project_tenants.name`, `shop_types.name`, `area_sqm`, monthly kWh = `monthly_kwh_override` or `shop_types.kwh_per_sqm_month × area`. It **does not filter `include_in_load_profile`/`is_virtual`**, and SCADA data is ignored. "No tenant data available." when there are no tenants |
| Financial Estimates | `financialEstimates` (`:322-445`) | Yield under load-shedding stages 0–8 (see A.6), a Stage 0 metrics table, and tables for stages 1–4 and 5–8. Closing line: "NPV … 9.00%" |
| Financial Conclusion | `financialConclusion` (`:449-473`) | **Hard-coded "Stage 2" baseline.** Initial yield, IRR, MIRR, payback in "X years and Y months" |
| Project Cash Flows | `cashflowTable` (`:477-553`) | Landscape. **9 longtables (stages 0–8) × N years.** Subsections hard-numbered "7.1"–"7.9" (`:509`). If `yearlyProjections` is empty, prints "Detailed yearly projections are not available for this simulation." **This is always the case today** (A.2.6) |
| Terms & Conditions | `termsAndConditions` (`:557-572`) | `proposals.assumptions` or "Standard industry assumptions apply."; `disclaimers` or the default sentence; `custom_notes` |
| Authorization | `signatureBlock` (`:576-590`) | Blank lines for "Prepared by" and "Client Acceptance". **Does not print** `prepared_by` or `client_signature` even when set |
| Monthly blocks | `monthlyReportSnippets.ts` | Only if enabled. Placeholders when there is no monthly data (covered in the monthly-report part) |

Escaping: `esc()` (`snippets.ts:8-13`) escapes `\ & % $ # _ { } ~ ^`. The address fallback injects raw `\\`. Newlines in user text are not converted. `%` inside numbers is written as `\\%`.

#### Path 2 — `ProposalPreview` (portal) and its print popup

| Page | Content & source |
|---|---|
| Cover & Summary (`:621-665`) | Hero "Solar Installation Proposal", `project.name`, today's date. Metrics: `solarCapacity` kWp, `annualSavings`, `paybackYears` ("Payback Period"), `roiPercentage` labelled **"25-Year ROI"** (always 0% today). Executive summary = `proposal.executive_summary` or a templated sentence |
| Site Overview (`:668-701`) | Mapbox map; `projects.location`, `total_area_sqm`, `connection_size_kva`, `simulation.tariffName` ("Standard" fallback); coordinates |
| System Design (`:704-714`) | `<FloorPlanMarkup projectId readOnly />` (from the PV Layout tab). Not reachable in the portal |
| Load Analysis (`:717-733`) | `LoadProfileChart(tenants, shopTypes, connectionSizeKva, lat, lng)` |
| System Specification (`:736-779`) | kWp; battery kWh and kW; annual generation; specific yield = generation ÷ kWp (**always 1600**, see A.2.6); energy flow: generation, grid import, grid export |
| Financial Analysis (`:782-934`) | System cost, annual savings, payback = **first projection year where cumulative ≥ cost (integer)**, falling back to `paybackYears`. The ROI card shows `projection[24].roi`. The cover's payback and ROI come from different sources, so **the same document shows two different payback figures**. A 25-year table (first 10 rows, expandable). A 25-year summary: total generation, total savings, "Net Profit" |
| Terms & Signatures (`:937-1065`) | Assumptions: `assumptions` or "• 0.5% annual panel degradation • 8% annual tariff escalation • Standard weather conditions". Disclaimers. Custom notes. Verification badges. Three signature lines (Prepared / Approved / Client) |

The print popup (`:125-423`) re-implements five of these pages as HTML strings with slightly different content. For example, the site map is replaced by "📍 location" text, and the table shows 15 rows.

#### Paths 3–5 (dead, listed for completeness)

- **`capturePreview.generateProposalHTML`** (`lib/pdfshift/capturePreview.ts:24-1080`). `pageCount = 6` (`:89`). Pages: Cover (`:587`), Site (`:651`, with a Mapbox **static image** URL that embeds the token in the HTML, `:325-334`), Visual Analysis with inline SVG payback/donut/monthly charts (`:93-300,730`), Load Analysis (`:811`), Specs, Financial, Terms (`:1027-1042`). The logo is fetched and inlined (`:304`). Sent to `generate-pdf` with A4, margin 0 (`:1082-1144`).
- **`lib/pdfshift/templates/proposal.ts`**: Cover, Executive Summary, Site Overview, System Specification, Visual Analysis, 25-Year Projection, Assumptions, Disclaimers (`:48-209`). No HTML escaping of interpolated fields (e.g. `:70`).
- **`generateProposalPDF.ts`** (pdfmake): Cover metrics (`:203`), Executive Summary (`:220`), Site Overview (`:236`), System Specification (`:265`), Visual Analysis (`:307`), 25-Year Projection (`:337`), Assumptions / Disclaimers / signatures "Prepared By" and "Client Signature" (`:381-419`).
- **`ProposalPrintView.tsx`**: hero, site, tenant summary, energy performance, financial, assumptions, disclaimers (`:209-493`).
- **`sections/*`**: Cover, SiteOverview, LoadAnalysis, EquipmentSpecs (inverter power fallback **kWp × 0.8**, `EquipmentSpecsSection.tsx:30`), FinancialSummary, CashflowTable (own 20-year generator, see A.6), Terms, Signature, PageWrapper.
- **`charts/*`** (Recharts, exposing refs to capture images): `PaybackChart`; `EnergyFlowDonut` (self-consumption = gen − export, `EnergyFlowDonut.tsx:38`); `MonthlyGenerationChart`, which uses fixed **monthly factors Jan 1.15, Feb 1.10, Mar 1.00, Apr 0.85, May 0.70, Jun 0.65, Jul 0.68, Aug 0.80, Sep 0.90, Oct 1.00, Nov 1.08, Dec 1.12**, normalised (`MonthlyGenerationChart.tsx:23-64`).

---

### A.6 (b) Calculations and business rules (with constants)

**Load-shedding yield factors** (`snippets.ts:28`), where index = stage 0…8:
`[1.0, 0.9287, 0.8348, 0.7363, 0.6270, 0.5389, 0.5134, 0.4476, 0.3829]`
Stage yield = `annualSolarGeneration × factor[stage]` (`:30-32`).

**Per-stage metrics** (`financialEstimates.stageMetrics`, `snippets.ts:330-343`). Let `cost = systemCost`, `yld = baseYield × f`, `dcCap = panelW×count/1000 || AC×1.33`:

| Metric | Formula | Defect |
|---|---|---|
| ZAR/kWh (1st year) | `cost / yld` | This is capex per first-year kWh, not a tariff or LCOE. The label is misleading |
| ZAR/Wp (DC) | `cost / (dcCap×1000) × 1000` = `cost/dcCap` | **Unit error: this is R/kW, labelled R/Wp. It is 1000× too large** |
| ZAR/Wp (AC) | `cost / (acCap×1000) × 1000` | same unit error |
| LCOE | `lcoe / f` | a linear scaling approximation (source LCOE is always undefined, so 0) |
| Initial yield % | `annualSavings / cost × 100 × f` | – |
| IRR % | `irr × f` | **Not a valid transform.** IRR does not scale linearly with yield |
| MIRR % | `mirr × f` | `mirr` is never mapped, so always 0 |
| Payback (yr) | `paybackYears / f` | simple-payback approximation only |
| NPV | `npv × f` | **Invalid.** NPV = PV(savings) − capex does not scale by f. It also flips sign behaviour |

**Financial Conclusion** (`:449-473`): the same formulas at **f = factor[2] = 0.8348**. Payback is shown as `floor(p)` years and `round((p−floor)×12)` months.

**Cash-flow table** (`cashflowTable`, `snippets.ts:486-540`). For each stage f, and each `yearlyProjections` row y:
- `yield = y.energyYield×f`
- `energyIncome = y.energyIncome×f`
- `demandSaving = y.demandSavingKva×f`
- `demandIncome = y.demandIncome×f`
- `totalIncome = energyIncome + demandIncome`
- `net = totalIncome − y.oAndM − y.insurance − y.replacementCost`
- Discount factor `= 1/1.09^year`. The **9% rate is hard-coded**, and it is printed but never multiplied into anything.
- Year-0 row = −`systemCost`.
- The totals row sums yield, energy income, demand income and total income. **Net cash-flow total and NPV are not computed.** There is also no cumulative column, even though `YearlyProjection.cumulativeCashflow` exists.

**Portal / print-preview / dead pipelines, 25-year projection** (`ProposalPreview.tsx:53-79`; identical in `ProposalExport.tsx:45-65`, `capturePreview.ts:62-71`, `pdfshift/templates/proposal.ts:209-215`, `generateProposalPDF.ts:23-30`, `ProposalPrintView.tsx:59-60`). Annual degradation `d = 0.005` and tariff escalation `e = 0.08` are **hard-coded**. For year n = 1…25:
- `savings_n = annualSavings × (1−d)^(n−1) × (1+e)^(n−1)`
- `generation_n = annualSolarGeneration × (1−d)^(n−1)`
- `cumulative_n = Σ savings`
- `ROI_n = (cumulative_n − systemCost)/systemCost × 100`
- Payback year = the first n with `cumulative_n ≥ systemCost`.

This model has **no O&M, insurance, replacement, financing or discounting**. Its "Net Profit" = `cumulative_25 − systemCost`.

**It conflicts with the LaTeX document.** LaTeX states 10% escalation, 20 years, 9% cost of capital, 1.5%/0.5% degradation. The portal uses 8%, 25 years, no discounting, 0.5%. **The client portal and the exported PDF therefore disagree on escalation, horizon, degradation, payback and ROI.**

**Dead `CashflowTableSection.generateBasicProjection`** (`sections/CashflowTableSection.tsx:251-298`):
- 20 years; degradation 0.5%; escalation 8%; CPI 6% applied to O&M and insurance.
- `baseRate = annualSavings/annualSolarGeneration`
- O&M = 1% of cost; insurance = 1% of cost; year-10 replacement = **12% of cost** ("battery replacement").
- `net = income − O&M − insurance − replacement`; cumulative starts at −cost.

**Edge-function narrative maths** (`generate-proposal-narrative/index.ts`). It ignores the actual system cost:
- System cost = **kWp × 12,000** (`:133,150,188`)
- 25-year return = `annualSavings×25 − kWp×12000` (no escalation or degradation, `:137,192`)
- Annual yield = kWp×1600 (`:108,122`)
- CO₂ = **kWp × 1.2 t/yr**; trees = CO₂×45 (`:161-163`)
- Conservative sizing = kWp×0.7, aggressive = kWp×1.4 (`:93-94`)
- DC/AC default 1.3; inverter AC = kWp/1.3 (`:80,174`)
- Payback defaults to 5 when missing (`:52`)

The client passes `dcAcRatio: equipmentSpecs?.tiltAngle ? undefined : 1.3` (`ProposalWorkspaceInline.tsx:559`). This is a nonsensical condition that always yields 1.3.

**Verification checklist rules (dead component)** (`VerificationChecklist.tsx:39-76`):
- coordinates verified ⇐ `projects.latitude && longitude`
- data source = 'actual' if any tenant has `scada_import_id` or raw data, otherwise 'estimated'
- tariff confirmed ⇐ `projects.tariff_id`
- specs validated ⇐ `solarCapacity>0`

It auto-ticks and never un-ticks. "Complete" = all four (`:78-82`). **It gates nothing.** Nothing in the live flow requires verification before sharing or sending. The `verification_completed_at/_by` columns are never written.

**Versioning rule:** `nextVersion = max(version)+1` for the project (Builder 1 filters by `document_type`; Builder 2 does not). This is computed **client-side**, with no unique constraint on `(project_id, document_type, version)`. Two concurrent creates produce duplicate version numbers. "Save" mutates the row in place, so there is no immutable revision history.

---

### A.7 (c) Data model

**`public.proposals`** (`migrations/20251215031323…:2-56`, plus `share_token` `20251215032330…:2-3`, `content_blocks` `20260216125343…`, `section_overrides` `20260216130635…`, `document_type` `20260218090049…`). Types are at `integrations/supabase/types.ts` (proposals Row).

| Column | Type / default | Written by (live) | Notes |
|---|---|---|---|
| id | uuid PK | DB | – |
| project_id | uuid NOT NULL → projects ON DELETE CASCADE | builder insert | index `idx_proposals_project_id` |
| simulation_id | uuid → project_simulations ON DELETE SET NULL | save | – |
| sandbox_id | uuid → sandbox_simulations ON DELETE SET NULL | save | – |
| version | int NOT NULL default 1 | insert (`max+1`) | no uniqueness |
| status | text default 'draft', CHECK ∈ {draft, pending_review, approved, sent, accepted, rejected} | **only the portal sign flow (→accepted)** | index `idx_proposals_status` |
| verification_checklist | jsonb NOT NULL default `{site_coordinates_verified:false, consumption_data_source:null, tariff_rates_confirmed:false, system_specs_validated:false}` | save (never edited) | – |
| verification_completed_at / _by | timestamptz / text | never | – |
| branding | jsonb default `{company_name, logo_url, primary_color:#22c55e, secondary_color:#0f172a, contact_email, contact_phone, website, address}` | save | `ProposalBranding` (`types.ts:10-19`) |
| executive_summary, custom_notes, assumptions | text | save (no UI) | – |
| disclaimers | text, DB default is a longer sentence than the client default | save | – |
| prepared_by/_at, reviewed_by/_at, approved_by/_at | text / timestamptz | **never (dead SignaturePanel)** | Free-text names, not user ids |
| client_signature / client_signed_at | text / timestamptz | portal | Typed name only |
| simulation_snapshot | jsonb | save | `SimulationData` (`types.ts:80-115`) |
| content_blocks | jsonb | save | `ContentBlock[]` = `{id,label,description,enabled,order,category}` (`types.ts:141-149`) |
| section_overrides | jsonb | save | `Record<blockId, latexString>` plus `__prefix__<blockId>` keys (`LaTeXWorkspace.tsx:153-158`) |
| share_token | text UNIQUE, index | ShareLinkButton | 32 hex chars (128-bit). No expiry or revoke columns |
| document_type | text NOT NULL default 'proposal' | insert (Builder 1) | 'proposal' \| 'monthly_report' (shared table) |
| created_at / updated_at | timestamptz, trigger `update_proposals_updated_at` | DB and save | – |

Nested JSON shapes:
- `YearlyProjection` (`types.ts:23-40`): year, energyYield, energyIndex, energyRate, energyIncome, demandSavingKva, demandIndex, demandRate, demandIncome, totalIncome, insurance, oAndM, totalCost, replacementCost, netCashflow, cumulativeCashflow.
- `SensitivityResults` (`:42-55`) and `EquipmentSpecs` (`:57-78`): defined but never populated.

**Status lifecycle as designed** (dead `SignaturePanel.tsx:18-51`):

```
draft --prepare--> pending_review --review--> (still pending_review) --approve--> approved --send--> sent --client sign--> accepted
```

Reviewing does not change status. `rejected` has no writer anywhere. **Live reality: draft → (manual DB edit) → sent → accepted (portal).**

**`public.organization_branding`** (`20260119124248…:2-16`; `org_id` added in `20260318090000…:30-32`):
- Columns: id, user_id (UNIQUE), org_id, company_name, logo_url, primary_color (default #3b82f6), secondary_color (#1e40af), contact_email, contact_phone, website, address, timestamps.
- RLS: own rows plus org members can view; org admins can update (`20260318090000…:133-150`).
- Public **`branding`** storage bucket; users write under their own `<uid>/` folder (`20260119124248…:46-67`).
- Read-only here through `useOrganizationBranding`. It appends `?t=<now>` to `logo_url` on every load (`useOrganizationBranding.ts:83-85`), and that cache-busted URL is then **saved into `proposals.branding.logo_url`**.

**`public.report_analytics`** (`20251216064510…:2-29`): user_id, event_type, report_config_id → `report_configs`, metadata, created_at. RLS is owner-only. **Nothing writes it**: `useReportAnalytics` has no importers. The related tables `report_configs` and `report_versions` (`20251216055957…`) have fully open "Anyone can …" RLS and are not used by proposals.

**Storage buckets touched:**
- `report-infographics` (public read; authenticated write; `20260103045350…`). It is written by `useInfographicGeneration` at `${projectId}/${kWp}-${kWh}-${savings}-${type}.png` from `SavedSimulations` after a simulation save. **It is never read by any proposal renderer. Write-only.**
- `tour-assets` (public; `20251215155612…`). Written by `generate-tour-infographic` with the service role.
- `branding` (see above).
- **Proposal PDFs are never stored anywhere.**

**`schema-dump.sql`** (the replication target `lyctmmqndqegptzkajhz`) contains **no RLS or policies at all** (0 `CREATE POLICY`). A database built from it would expose every table.

---

### A.8 (d) External services and keys

| Service | Used by | Endpoint / model | Secret (env) | Auth on our side | Notes |
|---|---|---|---|---|---|
| **texlive.net latexcgi** (public, third-party, no SLA) | `compile-latex` | `POST https://texlive.net/cgi-bin/latexcgi` with `filecontents[]`, `filename[]=document.tex`, `engine=pdflatex`, `return=pdf` (`compile-latex/index.ts:21-30`) | none | **none** (`verify_jwt=false`, no in-function check) | **The whole proposal, including client name, location, financials and tenants, is sent to a third party on every Sync.** No size limit, timeout or retry. Errors come back as HTTP 200 with a JSON log. A server exception gives 500 with the message |
| **Anthropic** | `generate-proposal-narrative` (and `enhance-tour-content`) | `https://api.anthropic.com/v1/messages`, `claude-sonnet-4-20250514`, max_tokens 4096, forced tool `generate_narrative` {narrative, keyHighlights[]} (`:207-243`) | `ANTHROPIC_API_KEY` | **none** | 11 section prompts (`:39-200`). An unknown `sectionType` silently uses `executive_summary` (`:202`). A missing `projectData` throws a TypeError → 500. Upstream 429 → 429. No input validation, rate limit or caller identity. CORS `*` |
| **PDFShift** | `generate-pdf` (called only by dead `capturePreview` and by the sandbox `DraftReportDialog`) | `POST https://api.pdfshift.io/v3/convert/pdf` with `source: html`, `use_print:true`, `delay:500` (`generate-pdf/index.ts:36-50`) | `PDFSHIFT_API_KEY` (Basic `api:<key>`) | **none** | Returns base64 JSON. PDFShift's `source` also accepts a **URL**, so this is an open, credit-burning HTML/URL-to-PDF proxy. The upstream error body is echoed to the caller |
| **Google Gemini** (image) | `generate-report-infographic`, `generate-tour-infographic` | `generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=…` (`generate-report-infographic/index.ts:76-93`) | `GEMINI_API_KEY` (in the **URL query string**) | **none** | Experimental model id. 2 retries at 1 s. 403 is mapped to 402. Not used by the proposal renderers |
| Supabase service role | `generate-tour-infographic` | uploads to `tour-assets` with `upsert:true` at a **caller-chosen path** `infographics/${path}.png` or `${tourId}/step-N.png` (`generate-tour-infographic/index.ts:39,154-176,242-256`) | `SUPABASE_SERVICE_ROLE_KEY` | **none** | Anonymous callers can overwrite or plant public images |
| **Mapbox** | `ProposalLocationMap` (portal); dead `capturePreview` static map | GL style `satellite-streets-v12`; Static Images API | `MAPBOX_ACCESS_TOKEN` served by the `get-mapbox-token` edge fn | **none** (`verify_jwt=false`, returns the token to anyone) | The token should be URL-restricted |
| cdnjs | `PDFPreview` pdf.js worker (`PDFPreview.tsx:7`) | `pdf.worker.min.mjs` | – | – | Runtime CDN dependency |
| Gmail web compose | ShareLinkButton | `mail.google.com/mail/?view=cm…` | – | – | Not an integration; opens a browser tab |

`config.toml` sets `verify_jwt = false` for `generate-proposal-narrative` (`:48`), `generate-pdf` (`:72`), `compile-latex` (`:75`), `generate-report-infographic` (`:39`), `generate-tour-infographic` (`:33`), `enhance-tour-content` (`:36`) and `get-mapbox-token` (`:12`). **None of these functions performs its own auth check**: none reads the `Authorization` header or calls `getUser`. All return `Access-Control-Allow-Origin: *`.

---

### A.9 (e) Defects, gaps, hard-coded values, security

#### Security — the client portal and share token (highest severity)

1. **The `proposals` table is fully open to the anonymous role.** `"Anyone can view/insert/update/delete proposals"` all use `USING (true)` (`20251215031323…:62-65`), and no later migration drops them. The token policies (`20251215032330…:19-29`) are extra permissive OR clauses, so they restrict nothing. With the public anon key (shipped in the JS bundle):
   - **Read every proposal of every organisation**, including all `share_token`s, financial snapshots, client names and branding. The token's secrecy is meaningless.
   - **Sign or accept any proposal** as anyone, change `status`, rewrite financial figures or `section_overrides`, **delete** proposals, or insert rows into any project.
   - The token-scoped UPDATE policy has `WITH CHECK (share_token IS NOT NULL)` and does not limit columns. Even if the open policies were removed, a token holder could still edit any column of a `sent` proposal (numbers, text, status) — not just sign it.
2. **Stored XSS affecting the app origin.** `ProposalPreview.openPrintPreview` writes unescaped proposal fields into a `window.open('')` popup (`ProposalPreview.tsx:133-421`). That popup is same-origin with the app. Combined with #1, an anonymous attacker can plant `<img onerror=…>` in `executive_summary`. When a logged-in staff member opens the portal and clicks Print Preview, the script can read the Supabase session from `localStorage` and act as that user. (The dead `pdfshift/templates/*` and `capturePreview` HTML builders have the same unescaped interpolation.)
3. **A token holder sees other data.** Anonymous visitors can read `project_tenants` and `shop_types` for **all** projects, not just this one ("Anyone can view", `20251205041711…:76-83`). `pv_layouts` is also anon-readable (`20251213073801…:22`). The portal's own `projects` read is blocked for anonymous visitors, so the portal is **functionally degraded**: blank project name, no map, no site data. For logged-in viewers, `projects` is readable across organisations ("Authenticated users can view projects" `USING (true)` survives the org migration).
4. **Signature has no identity or evidentiary value.**
   - It is a typed name only. There is no email or OTP verification, and no IP, user-agent or timestamp beyond `client_signed_at`.
   - There is no hash or snapshot of the text that was accepted, and the consent checkbox is not stored.
   - The row stays editable afterwards (Save overwrites `simulation_snapshot`; the anon UPDATE allows anything).
   - The portal shows a different document (`ProposalPreview`) from the PDF the proposer produced. **The client cannot see what they are signing.**
5. **Share tokens:**
   - Generation is 128-bit from `crypto.getRandomValues` (acceptable).
   - There is **no expiry, revoke or rotate, view log or single-use flag**.
   - The message says "invalid or has expired", but expiry does not exist.
   - The token appears in a path segment (fine), and the list page's Client View button opens it.
6. **Unauthenticated edge functions can be abused for cost.** `generate-proposal-narrative` (Anthropic Sonnet, up to 4,096 output tokens per call), `enhance-tour-content` (Anthropic), `generate-report-infographic` and `generate-tour-infographic` (Gemini image), `generate-pdf` (PDFShift credits; also accepts arbitrary HTML/URL) and `compile-latex` (texlive.net relay) can be called by anyone with the public anon key, or even without it via the function URL. They have no JWT check, no rate limit, no per-org quota and no payload limits. `generate-tour-infographic` additionally lets anonymous callers **write or overwrite files in a public bucket using the service role**. `get-mapbox-token` hands out the Mapbox token to anyone.
7. **Data egress to texlive.net.** Every Sync ships the full proposal (client name, financials, tenant list) to a free public compile service outside the company's control. This is a POPIA / confidentiality concern.
8. There is **no tenancy or ownership on `proposals`**: no `org_id` and no `created_by`. It depends on `projects` visibility, which is itself open to all authenticated users.

#### Functional defects

9. **The status workflow is unreachable.** No live UI changes `status`. Share, Client View and portal Sign are therefore dead in practice (A.0).
10. **The AI narrative is a stub.** It is generated, then discarded: never rendered in LaTeX, never saved (`ProposalWorkspaceInline.tsx:568-571`; `templateData` has no narrative field, `:419-428`).
11. **The simulation data contract is broken.** The proposal expects keys that simulations never save (A.2.6). Generation is always kWp×1600, ROI 0, grid flows 0, NPV/IRR/LCOE/MIRR 0, and the cash-flow section always reads "not available".
12. There is **no simulation picker** in either builder (the first simulation is auto-selected). Sandbox proposals use fabricated metrics (payback 5, ROI 300%, R2.50/kWh).
13. There are **no inputs for** executive summary, assumptions, disclaimers, custom notes or the verification checklist. The Branding and Template tabs are disabled but reachable through the collapsed-rail back door. Template choice is not persisted and has no LaTeX effect.
14. **The first manual edit freezes all LaTeX sections** as overrides. Preamble edits are lost on reload. There is no reset-to-generated control.
15. **Export PDF uses the last *synced* blob** (possibly stale). PDFs are never stored or versioned, and never written to the project documents or to `projects.reports`-equivalent storage.
16. The "Excel" export is an unescaped CSV. The Builder 2 export handlers are dead (not rendered).
17. **Reordering while a section filter is on drops the hidden blocks** (`ProposalSidebar.tsx:111-115`).
18. **Builder 2 includes monthly-report sections** in new proposals (it uses the raw `DEFAULT_CONTENT_BLOCKS`), and it counts monthly reports in proposal versioning.
19. The project tab's "complete" count includes monthly reports. The "blocked" status does not block anything.
20. Version numbers are client-computed with no uniqueness (race), and there is no immutable history. "N versions" is non-interactive. An accepted proposal can still be edited and re-saved.
21. The portal hides prepared, approved and client signature names and custom notes (the prop subset at `ClientPortal.tsx:160-167`). It shows two different payback values on one document, and "25-Year ROI" = `roiPercentage` (always 0) on the cover versus the computed ROI on the Financial page.
22. The portal sign button spinner sticks on error (`ClientPortal.tsx:122-124`). There is no Decline or Reject action and no notification to the proposer on sign.
23. **Financial maths errors** (A.6):
    - R/Wp is 1000× too large.
    - IRR, MIRR and NPV are scaled linearly by the load-shedding factor.
    - Replacement-cost labels (10/50/40%) disagree with the multipliers (26.5/56.9/16.6%).
    - The TOU table repeats one rate in every cell.
    - The tender-data rand lines are hard-coded and do not sum to "Total Capital cost".
    - The discount factor is printed but unused.
    - The cash-flow totals omit net and NPV.
    - The cover labels DC kWp as "kW AC".
24. **Hard-coded identity:** the cover falls back to Watson Mattheus's company name, address, phone and "Mr Arno Mattheus" (`snippets.ts:45-48`), and there is a "WM" TikZ logo in the header and cover. Footer placeholders print literally on every page.
25. Other hard-coded constants:
    - LaTeX: cost of capital 9%, CPI 6%, escalation 10%, discount 15%, MIRR 9% and 10%, lifespan 20, degradation 1.5% and 0.5% (text only), panel area 2.7 m², DC/AC 1.33, FX 45%, Stage 2 baseline, load-shedding factors.
    - Portal and dead pipelines: 0.5% degradation, 8% escalation, 25 years.
    - Fallbacks: 1600 kWh/kWp, R12,000/kWp.
    - Narrative function: CO₂ 1.2 t/kWp, 45 trees/t, sizing 0.7×/1.4×.
    - Monthly factors (dead charts). Default map at Cape Town. Branding default colours differ: #22c55e/#0f172a for proposals versus #3b82f6/#1e40af for organisations.
26. The Load Analysis LaTeX ignores `include_in_load_profile` and `is_virtual` and all SCADA data. The builder fetches full `scada_imports(*)` rows (heavy) only to list names.
27. The cache-busted `logo_url?t=…` from org branding gets persisted into the proposal's branding.
28. **Dead code** to delete, or to treat as reference only: `ProposalBuilder.tsx` (unrouted), `ProposalExport.tsx`, `ProposalPrintView.tsx`, `generateProposalPDF.ts`, `lib/pdfmake/tables.ts`, `sections/*`, `charts/*` (only used by the dead ProposalExport), `VerificationChecklist.tsx`, `SignaturePanel.tsx`, `useReportAnalytics.ts`, and `generateLatexSource()` (`proposalTemplate.ts:214-234`, unused; the workspace has its own `assembleSource`). The `report-infographics` output is never consumed.

---

### A.10 (f) What the tab consumes from upstream tabs

| Upstream tab / source | Table / field | Used for |
|---|---|---|
| Project details | `projects.name, location, client_name, total_area_sqm, connection_size_kva, latitude, longitude, tariff_id` | cover, header, admin details, narrative prompt, portal site page, map |
| Tariffs | `projects.tariff_id → tariff_plans.name` (FK `20260218102530…`) | `tariffName` only. **No TOU rates are read.** Tariff tables in LaTeX come from `yearlyProjections[0].energyRate/demandRate`, which never exist |
| Simulation (Profile Builder / auto-save / saved simulations) | `project_simulations.solar_capacity_kwp, battery_capacity_kwh, results_json.{annualSavings, systemCost, paybackYears}` (plus expected-but-absent keys `annualSolarGeneration, annualGridImport/Export, roiPercentage, batteryPower, npv, irr, lcoe, yearlyProjections, tariffName`) | every number (A.2.6) |
| Sandbox | `sandbox_simulations.scenario_a.solarCapacity, batteryCapacity` where `cloned_from_project_id` | reopened sandbox proposals only; the other metrics are fabricated |
| Tenants / load profiles | `project_tenants.name, area_sqm, monthly_kwh_override, shop_types.name, kwh_per_sqm_month, scada_imports(*)` | LaTeX Load Analysis; portal `LoadProfileChart` |
| PV Layout | `pv_layouts.pv_arrays` (existence) + `FloorPlanMarkup` | portal "System Design" page (never enabled in the portal) |
| Costs | only `results_json.systemCost`. `results_json.systemCosts` (the breakdown) is **ignored** | tender data uses hard-coded line items instead |
| Branding (Settings) | `organization_branding` (org, else user) | new-proposal branding defaults; portal header and footer |
| Generation readings | `generation_readings.timestamp` | monthly-report mode only |
| Equipment specs (panel model, wattage, count, inverter, tilt) | none; `equipmentSpecs` is never populated | LaTeX conditional rows (panel count, area, efficiency) never print |

**Mapping to E-Site:**
- The LaTeX-over-texlive.net preview/export path is the only live renderer. It should be replaced by E-Site's report generation writing to `projects.reports`.
- The share/portal/sign flow must be rebuilt: token-scoped server access, no anonymous table grants, a frozen document snapshot plus hash, and signer identity via an emailed OTP.
- The status workflow must be implemented (it currently does not exist in the live code).
- The simulation → proposal data contract must be defined explicitly, because today it silently falls back to constants.

## Part B — Schedule (Gantt) tab

> Scope: the `schedule` tab of `src/pages/ProjectDetail.tsx` and everything it reaches. Every file listed in the brief was read in full. Source root: `wmsolar-main/`. `docs/APP_SPEC.md` and a root `CLAUDE.md` do **not exist** in this checkout (only `docs/CSV_EXTRACTION_SPECIFICATION.md`), so nothing below comes from design docs. Every statement comes from the code.

### B.0 File abbreviations used in citations

| Abbrev | File | Lines |
|---|---|---|
| PD | `src/pages/ProjectDetail.tsx` | — |
| PG | `src/components/gantt/ProjectGantt.tsx` | 585 |
| GC | `src/components/gantt/GanttChart.tsx` | 1181 |
| TB | `src/components/gantt/GanttToolbar.tsx` | 639 |
| TF | `src/components/gantt/TaskForm.tsx` | 309 |
| MF | `src/components/gantt/MilestoneForm.tsx` | 191 |
| BS | `src/components/gantt/BaselineSelector.tsx` | 71 |
| BAB | `src/components/gantt/BulkActionsBar.tsx` | 123 |
| CL | `src/components/gantt/ColorLegend.tsx` | 106 |
| DDL | `src/components/gantt/DependencyDragLine.tsx` | 73 |
| DTS | `src/components/gantt/DependencyTypeSelector.tsx` | 114 |
| GSG | `src/components/gantt/GettingStartedGuide.tsx` | 113 |
| ISD | `src/components/gantt/ImportScheduleDialog.tsx` | 332 |
| KSM | `src/components/gantt/KeyboardShortcutsModal.tsx` | 58 |
| OC | `src/components/gantt/OnboardingChecklist.tsx` | 111 |
| PP | `src/components/gantt/ProgressPanel.tsx` | 101 |
| RWV | `src/components/gantt/ResourceWorkloadView.tsx` | 209 |
| TGH | `src/components/gantt/TaskGroupHeader.tsx` | 106 |
| uGT | `src/hooks/useGanttTasks.ts` | 203 |
| uGD | `src/hooks/useGanttDependencies.ts` | 126 |
| uGM | `src/hooks/useGanttMilestones.ts` | 115 |
| uGB | `src/hooks/useGanttBaselines.ts` | 116 |
| uGS | `src/hooks/useGanttTaskSegments.ts` | 70 |
| uDrag | `src/hooks/useGanttDrag.ts` | 135 |
| uDep | `src/hooks/useDependencyDrag.ts` | 107 |
| uTR | `src/hooks/useTaskReorder.ts` | 91 (**unused — dead code**) |
| uUR | `src/hooks/useUndoRedo.ts` | 55 |
| uKS | `src/hooks/useKeyboardShortcuts.ts` | 169 |
| uOP | `src/hooks/useOnboardingProgress.ts` | 132 |
| uFP | `src/hooks/useFilterPresets.ts` | 100 |
| uCel | `src/hooks/useCelebration.ts` | 119 |
| CP | `src/lib/criticalPath.ts` | 185 |
| GX | `src/lib/ganttExport.ts` | 256 |
| GI | `src/lib/ganttImport.ts` | 311 |
| ICS | `src/lib/calendarExport.ts` | 112 |
| T | `src/types/gantt.ts` | 176 |
| M1 | `supabase/migrations/20260201164844_1c959604-….sql` (5 tables, enums, RLS) | 194 |
| M2 | `supabase/migrations/20260209135553_ab05b7ec-….sql` (segments) | 28 |
| SD | `schema-dump.sql` (alternate schema, see B.4.4) | 724 |

Third-party libraries this feature depends on (`package.json`): `date-fns ^3.6.0`, `xlsx ^0.18.5` (SheetJS), `html-to-image ^1.11.13`, `jspdf ^4.0.0`, `canvas-confetti ^1.9.4`, TanStack Query (`new QueryClient()` with defaults, `src/App.tsx:44`), react-hook-form + zod, shadcn/Radix UI, `sonner` toasts, `lucide-react` icons.

---

### B.1 Entry point, component tree, and state ownership

**Entry.** In the tab strip, `PD:1291-1294` renders a tab trigger labelled "Schedule" (CalendarDays icon) with a status dot. `PD:1433-1435` renders `<ProjectGantt projectId={id!} projectName={project.name} />`. **Those two values are the only data the tab takes from the rest of the app** (see B.8).

**Tab status dot.** `PD:1036-1048` runs a separate count query: `gantt_tasks` `select('id', {count:'exact', head:true}).eq('project_id', id)`, query key `["project-gantt-tasks-count", id]`. `PD:1176-1180` shows "complete" with the tooltip "`N task(s) scheduled`" when count > 0. Otherwise it shows "pending" with "Create project schedule". **No gantt mutation invalidates this key**, so the dot can be stale until the query refetches (TanStack defaults: on mount or window focus).

**Tree:**
```
ProjectGantt (PG)                     ← owns all UI state + all data hooks
├─ [tasks.length === 0] GettingStartedGuide (GSG) + TaskForm + MilestoneForm + ImportScheduleDialog
└─ [tasks.length > 0]
   ├─ Header: "Project Schedule" + [Add Milestone] [Add Task]
   ├─ GanttToolbar (TB) → BaselineSelector (BS), Save-Preset Dialog, Save-Baseline Dialog
   ├─ OnboardingChecklist (OC)        (conditional)
   ├─ BulkActionsBar (BAB)            (when ≥1 selected)
   ├─ Sidebar (lg: 1/4): ProgressPanel (PP), ColorLegend (CL), [Show/Hide Workload], ResourceWorkloadView (RWV)
   ├─ Main (lg: 3/4): GanttChart (GC) → TaskGroupHeader (TGH), DependencyDragLine (DDL)
   │                  + ImportScheduleDialog (ISD) (JSX-nested inside the chart column, PG:528-534)
   ├─ TaskForm (TF)  (create/edit)
   ├─ MilestoneForm (MF)  (create only in practice)
   ├─ KeyboardShortcutsModal (KSM)
   └─ DependencyTypeSelector (DTS)
```

**State owned by PG (all in memory; reset whenever the tab unmounts, since Radix `TabsContent` unmounts an inactive tab):**

| State | Init | Line |
|---|---|---|
| `config: GanttChartConfig` | `DEFAULT_CHART_CONFIG` = `{viewMode:'week', groupBy:'category_owner', chartView:'gantt', showDependencies:true, showMilestones:true, showBaseline:null, showWeekends:true, showToday:true, splitView:true}` | PG:63, T:157-167 |
| `filters: GanttFilters` | `{search:'', status:[], owners:[], colors:[], dateRange:{start:null,end:null}}` | PG:64, T:170-176 |
| `selectedTasks: Set<string>` | empty | PG:65 |
| `editingTask` | null | PG:66 |
| `isTaskFormOpen` / `isMilestoneFormOpen` / `isKeyboardShortcutsOpen` / `showWorkloadView` / `isImportDialogOpen` | false | PG:67-72 |
| `pendingDependency {predecessorId, successorId}` | null | PG:71 |
| `searchInputRef` | ref, used by Ctrl+F | PG:74 |

Chart-local state in GC: `viewOffset` (**declared, never used**, GC:62), `collapsedGroups: Set<string>` (GC:63), `dragReorderTaskId` (GC:64).

**Loading.** `isLoading = tasks || deps || milestones loading` (PG:79). While loading, PG shows a skeleton card (PG:325-337). Baselines and segments do not gate loading.

**Error state: none.** No hook's `error` is read by PG. If the tasks query fails, `tasks` defaults to `[]` (uGT:11), so the user sees the **empty "Create Your Project Schedule" guide instead of an error**. That is a misleading empty state.

**Filtering pipeline** (PG:82-119). A task is kept only if it passes every active filter:
1. `search`: case-insensitive substring of `name` only.
2. `status[]`: task.status ∈ list.
3. `owners[]`: task.owner is non-null and in the list.
4. `colors[]`: task.color is non-null and in the list.
5. `dateRange`: applied only if BOTH start and end are set. The task is kept if it overlaps the range (`!(taskEnd < start || taskStart > end)`). **No UI ever sets `dateRange`**, so it is reachable only through a stored preset that carries one, and no UI can create such a preset.

`filteredTasks` goes to GC (the chart, critical path and selection). **Unfiltered `tasks`** go to PP, RWV, TB exports, baseline creation and ColorLegend's `usedColors`. So the sidebar statistics, the exports and the baselines always cover every task, while the chart shows only the filtered set.

---

### B.2 Views, dialogs and control inventories

#### B.2.1 Empty state — `GettingStartedGuide` (rendered when `tasks.length === 0`, PG:340-369)

Purpose: onboarding for a project with no tasks. Layout: a dashed card with a CalendarDays icon, the title "Create Your Project Schedule", and the copy "Plan your solar installation timeline with tasks, milestones, and dependencies. Track progress and identify critical path items." (GSG:28-32). Below it, three tip cards ("Break Down Your Work", "Mark Key Dates", "Link Dependencies", GSG:59-107). The dialogs are passed in as children (GSG:110).

| Control | Type | What it's for (user terms) | Handler → effect | Data read/written | Validation/disabled | Error & empty states |
|---|---|---|---|---|---|---|
| Create First Task | Button (lg) | Start the schedule by hand | `onCreateTask` → `setIsTaskFormOpen(true)` (PG:343, GSG:36) | Opens TF (create mode) | — | — |
| Add a Milestone | Button outline | Add a key date first | `setIsMilestoneFormOpen(true)` (PG:344, GSG:41) | Opens MF | — | **Defect:** the created milestone is invisible. The page stays on this guide because the gate is `tasks.length === 0` (PG:340), and milestones only render in GC |
| Import from Excel | Button outline | Import a contractor schedule | `setIsImportDialogOpen(true)` (PG:345, GSG:45-52) | Opens ISD | Shown only if `onImportSchedule` is passed (it always is) | — |

Props `isTaskFormOpen`/`isMilestoneFormOpen` are declared (GSG:11-12) and never used.

#### B.2.2 Main header (PG:374-390)

| Control | Type | Purpose | Handler → effect | Data | Validation | States |
|---|---|---|---|---|---|---|
| "Project Schedule" title | Static | — | — | — | — | — |
| Add Milestone | Button outline sm, Flag icon | Create a milestone | `setIsMilestoneFormOpen(true)` (PG:381) | → MF → `gantt_milestones` insert | — | — |
| Add Task | Button sm, Plus icon | Create a task | `setEditingTask(null); setIsTaskFormOpen(true)` (PG:385) | → TF → `gantt_tasks` insert | — | — |

#### B.2.3 `GanttToolbar` (TB) — one horizontal wrap bar (TB:176)

| Control | Type | Purpose | Handler → effect (file:line) | Data | Validation/disabled | Error/empty |
|---|---|---|---|---|---|---|
| Day | Segmented button | Zoom to days | `onConfigChange({...config, viewMode:'day'})` TB:179-187 | `DAY_WIDTH.day = 40px` GC:40 | Highlighted when active | — |
| Week | Segmented button | Zoom to weeks (default) | TB:188-196 | 20px/day | — | — |
| Month | Segmented button | Zoom to months | TB:197-205 | 8px/day | — | — |
| Search tasks… | Text input (w-40) | Find a task by name | `onFiltersChange({...filters, search})` TB:212-218. PG then calls `completeStep('use_filters')` if any filter is non-empty (PG:397-402) | Client-side only | Ctrl+F focuses it (PG:320) | No "no results" message. The chart is simply empty (see GC empty) |
| × (clear search) | Icon button, shown when search is non-empty | Clear the search | `search:''` TB:219-228 | — | — | — |
| Filters | Popover trigger with a count badge | Open the filters | TB:232-243. Badge = count of truthy among [search, status, owners, colors, dateRange] (TB:95-101). Note: search counts toward the badge | — | — | — |
| ↳ Clear all | Ghost button (shown if count > 0) | Reset every filter | `onFiltersChange(DEFAULT_FILTERS)` TB:171-173, 248-252 | — | — | — |
| ↳ Status chips ×3 (not started / in progress / completed) | Toggle badges | Filter by status | Toggle membership in `filters.status` TB:256-275 | — | Multi-select | Label shows `status.replace('_',' ')` |
| ↳ Owner chips | Toggle badges | Filter by owner (holds "Zone" for imported tasks) | Toggle membership in `filters.owners` TB:278-299 | Options = distinct non-null `owner` across ALL tasks (PG:122-124) | Section hidden if there are no owners | — |
| ↳ Color swatches ×8 | Toggle buttons | Filter by bar colour | Toggle membership in `filters.colors` TB:302-322 | Options = fixed `TASK_COLORS` (8 presets, T:145-154), **not the colours actually in use** | — | Imported tasks use a 20-colour palette (GI:17-22). 12 of those colours are **not filterable** here |
| ↳ Saved Presets list | Buttons (name) + trash | Re-apply or delete a saved filter set | Apply: `onApplyFilterPreset(id)` → PG:234-240 replaces filters and completes step `use_filters`. Delete: `onDeleteFilterPreset(id)` TB:329-349 | localStorage (uFP) | Hidden when there are no presets | Delete has no confirmation |
| ↳ Save as Preset | Button (shown only if the preset handler exists AND count > 0) | Save the current filters | Opens the Save Filter Preset dialog TB:354-364 | — | — | — |
| Save Filter Preset dialog: Preset Name | Text input | Name the preset | TB:584-589 | — | Empty/whitespace → `toast.error('Please enter a preset name')` TB:161-164 | — |
| ↳ Save Preset | Button | Persist the preset | `onSaveFilterPreset(name)` → PG:242-245 `createPreset(name, filters)` + `completeStep('use_filters')`. Then `toast.success('Filter preset saved')` TB:160-169 | localStorage `gantt-filter-presets-<projectId>` | Duplicate names allowed | — |
| ↳ Cancel | Button | — | closes TB:592 | — | — | — |
| Dependencies | Toggle button | Show or hide dependency arrows | `showDependencies` toggle TB:372-380 | GC:1101 | — | — |
| Milestones | Toggle button | Show or hide the milestone row | `showMilestones` toggle TB:382-390. PG passes `[]` to GC when off (PG:488) | — | — | Also hides milestones from the timeline range calculation |
| Split Bars | Toggle button | For multi-segment (imported) tasks: ON = all segments on one row; OFF = one row per segment, sorted by start date | `splitView` toggle TB:392-400 | Effect only in `category_owner` grouping (GC:194-203) | — | No effect in the other groupings, and no visual hint of that |
| Group ▾ | Dropdown with a badge showing the raw enum (e.g. "category_owner") | Choose how rows are grouped | TB:405-461 | — | Active item gets `bg-primary/10` | — |
| ↳ No Grouping / By Status / By Owner / By Color / By Category / By Category & Zone | Menu items | Set `groupBy` to `none`/`status`/`owner`/`color`/`category`/`category_owner` | TB:418-459 | Category = `description` column; Zone = `owner` column (GC:173-177, 213-214) | — | **Defect B7-D4:** status/owner/color/category groupings misalign the rows (see GC) |
| ⌨ (keyboard) | Icon button | Show the shortcuts | `onOpenKeyboardShortcuts` → KSM TB:464-473 | — | — | — |
| Compare: [baseline select] + "Comparing ×" badge | Select + badge (**BaselineSelector**; renders nothing if there are 0 baselines, BS:22-24) | Overlay a saved baseline as ghost bars | `onSelect(id \| null)` → `config.showBaseline` (TB:478-482, BS:33-35). The × badge sets null (BS:57-68) | Triggers `useBaselineTasks(id)` → `gantt_baseline_tasks` select `eq baseline_id` (uGB:100-116) | Options: "No comparison" + each baseline (name + `created_at` formatted `MMM d, yyyy`) | If the selected baseline is deleted, `config.showBaseline` still holds the stale id. The query returns [] and no ghosts show |
| Baselines ▾ | Dropdown | Manage baselines | TB:485-520 | — | — | — |
| ↳ Save Current as Baseline | Menu item | Snapshot the current plan | Opens the Save Baseline dialog TB:494-497 | — | — | — |
| ↳ [baseline name] rows | Menu item + trash icon | List/delete baselines | **Clicking the name does nothing** (no onClick). Trash → `onDeleteBaseline(id)` → `deleteBaseline.mutate(id)` (PG:406, TB:501-515) | `gantt_baselines` delete (cascades to `gantt_baseline_tasks`) | **No confirmation** | Toast "Baseline deleted" / "Failed to delete baseline: …" (uGB:78-86) |
| Save Baseline dialog: Baseline Name | Input | Name it | TB:610-617 | — | Blank → `toast.error('Please enter a baseline name')` TB:104-107 | — |
| ↳ Description (optional) | Input | Notes | TB:618-625 | — | — | — |
| ↳ Save Baseline | Button, label "Saving..." while busy | Create the snapshot | `onSaveBaseline(name, desc)` → PG:222-225 `createBaseline.mutateAsync({name, description, tasks})` (ALL tasks, unfiltered) → `completeStep('save_baseline')` | Insert `gantt_baselines`, then bulk insert `gantt_baseline_tasks` (uGB:25-57) | Disabled while saving | On error: toast from the hook. **The dialog stays open, but a baseline row may already exist with no tasks** (two non-transactional inserts) |
| ↳ Cancel | Button | — | TB:628 | — | — | — |
| Import | Button outline (Upload icon) | Import Excel | `onOpenImport` → ISD (TB:523-528, PG:416) | — | — | — |
| Export ▾ | Dropdown | Download the schedule | TB:531-573 | — | — | — |
| ↳ Export as Image › PNG (High Quality) | Sub-menu item | Picture of the chart | `exportToImage('gantt-chart-container','png',projectName)` TB:142-149, GX:66-96 | DOM capture | — | Toast success, or "Failed to export image" |
| ↳ Export as Image › JPEG (Smaller Size) | Sub-menu item | Same, as JPEG q0.95 | GX:85-89 | — | — | same |
| ↳ Export as PDF | Menu item | Single-page A4 landscape PDF of the chart | `exportToPDF` TB:151-158, GX:99-163 | DOM capture | — | "Failed to export PDF" |
| ↳ Export to Excel | Menu item | Tabular workbook | `exportToExcel(tasks, milestones, dependencies, projectName)` TB:124-131, GX:8-63 | ALL tasks | — | "Failed to export Excel" |
| ↳ Export to Word | Menu item | HTML report saved as `.doc` | `exportToWord` TB:133-140, GX:166-256 | ALL tasks + milestones | — | "Failed to export Word document" |
| ↳ Export to Calendar (.ics) | Menu item | Calendar feed file | `downloadICS` TB:119-122, ICS:96-112 | ALL tasks + milestones | — | Always toasts "Calendar exported" (no try/catch) |

Toolbar gaps: there are **no toggles for `showWeekends` or `showToday`** (the config fields exist, T:94-95, and are always true). There is no date-range filter UI. `chartView` (`'gantt'|'workload'|'calendar'`, T:7, T:90) is **never read anywhere**, so there is no calendar view. There are no undo/redo buttons. Unused imports: `Select`, `Eye`, `EyeOff`, `MoreVertical`, `useRef`, `GroupByMode` (TB:1-42).

#### B.2.4 `OnboardingChecklist` (PG:421-431)

Shown only if `!dismissed && !complete && tasks.length > 0`. It is a card titled "Getting Started" with a progress bar showing `completed/total`, and six steps (uOP:12-49), each with a check or circle icon and strike-through when done.

| Step id | Title | Completed by |
|---|---|---|
| `create_task` | Create your first task | Task create (PG:130), import (PG:290) |
| `add_milestone` | Add a milestone | Milestone create (PG:186) |
| `create_dependency` | Link tasks with dependencies | Dependency create, fired **before** the insert succeeds (PG:519, PG:578) |
| `assign_owner` | Assign task owners | Create or update with a non-empty owner (PG:131-133, 174-176), import (PG:291) |
| `save_baseline` | Save a baseline | After baseline create succeeds (PG:224) |
| `use_filters` | Try filtering tasks | Any non-empty filter, legend click, preset apply or save (PG:399-401, 460, 238, 244) |

| Control | Type | Purpose | Handler → effect | Data | Notes |
|---|---|---|---|---|---|
| × | Icon button | Hide the checklist permanently for this project and browser | `dismissOnboarding` (uOP:105-108) | localStorage `gantt-onboarding-progress-<projectId>` = `{steps:{id:bool}, dismissed:true}` | No way to bring it back except clearing localStorage |
| Reset (complete state) | Button | Restart the checklist | `resetOnboarding` (uOP:110-115) | same key | **Unreachable.** The "All done!" state (OC:28-59) never renders because PG hides the component when `isComplete` (PG:421) |

`Checkbox` is imported and unused (OC:4).

#### B.2.5 `BulkActionsBar` (rendered when `selectedTasks.size > 0`, PG:434-443)

| Control | Type | Purpose | Handler → effect | Data written | Validation | States |
|---|---|---|---|---|---|---|
| "N selected" | Badge | — | — | — | — | — |
| Select all (N) | Ghost button (shown if selected < total filtered) | Select every visible task | `handleSelectAll` PG:202-208. Toggles: if `selected.size === filtered.length` it clears, otherwise it selects all filtered | — | — | Selection can still include tasks hidden by a later filter (selection is not pruned when filters change) |
| Clear | Ghost button | Deselect | `setSelectedTasks(new Set())` PG:439 | — | — | — |
| Set status | Select (Not Started/In Progress/Completed) | Change status of all selected | `onBulkUpdate({status})` → PG:211-214 → `bulkUpdateTasks` → `UPDATE gantt_tasks SET status WHERE id IN (...)` (uGT:115-136). Then clears the selection | `status` | — | Toast "Updated N tasks" / "Failed to update tasks: …". **Progress is not synced, and no celebration fires** |
| Set color | Select (Default + 8 presets) | Recolour | `{color: value==='default' ? null : value}` BAB:59 | `color` | — | — |
| Set progress | Select 0/25/50/75/100% | Set % complete | `{progress: parseInt(v)}` BAB:83 | `progress` | — | Status is not synced (100% leaves "not started") |
| (bulk owner) | — | — | The prop type allows `owner` (BAB:14) but **there is no control**. Bulk-assign is missing | — | — | — |
| Delete | Destructive button → AlertDialog "Delete N tasks?" / "This action cannot be undone. All selected tasks and their dependencies will be permanently deleted." → Delete Tasks | Hard-delete the selection | `handleBulkDelete` PG:216-219 → `DELETE gantt_tasks WHERE id IN (...)` (uGT:138-157) | Cascades: dependencies, segments, **and the task's rows in every baseline** (M1:25-26, 57; M2:5) | Confirmation dialog | Toast "Deleted N tasks". The copy does not mention that baseline history is also destroyed |

#### B.2.6 Sidebar

**ProgressPanel** (PG:449). This is a read-only card titled "Schedule Progress". The formulas are in B.3.4.

| Element | Content | Line |
|---|---|---|
| Overall Completion % + bar | `round(completed / total × 100)` (count-based) | PP:17-37 |
| 3 tiles | Not Started / In Progress / Completed counts | PP:40-62 |
| Average Progress badge | `round(mean(progress))` | PP:65-68 |
| Duration badge | "`N days`" = earliest start → latest end inclusive, calendar days | PP:71-77 |
| Critical Path badge (shown if > 0) | "`N tasks`" on the critical path (computed on ALL tasks) | PP:80-90 |
| Footer | "`N total tasks • M dependencies`" | PP:93-97 |

**ColorLegend** (PG:452-465). It renders only if a used colour matches one of the 8 `TASK_COLORS` (CL:22-26).

| Control | Type | Purpose | Handler → effect | Notes |
|---|---|---|---|---|
| Colour row (swatch + name) | Button per used preset colour | Toggle a colour filter | `onFilterColor(color)` → PG:455-461 toggles `filters.colors` and completes `use_filters` | Imported zone colours outside the preset list never appear |
| Clear Color Filter | Outline button (shown if any colour is active) | Reset the colour filter | PG:463 | — |

The `compact` variant (CL:28-63) is never used.

**Show/Hide Workload** (PG:468-476). This outline button toggles `showWorkloadView`, which mounts **ResourceWorkloadView** below it (PG:478-480):
- Empty state: if there are no tasks at all, it shows "No task assignments yet / Assign owners to tasks to see workload distribution" (RWV:87-97). This is effectively unreachable because PG only renders when tasks > 0. With all tasks unassigned, it shows only the "Unassigned" block.
- Per owner, sorted by task count descending: owner name, an amber ⚠ tooltip "`N day(s) with 3+ concurrent tasks`" if there are overloaded days, a "completed/total tasks" badge, a completion bar, up to 5 task pills (colour-tinted, strike-through if completed, tooltip with dates and progress), and "+N more" (RWV:108-177).
- Unassigned: a destructive badge with the count, up to 5 dashed pills, and "+N more" (RWV:180-205).
- Read-only. There are no click handlers. The `startDate`/`endDate` props (RWV:13-14) are unused. `totalDays` is computed (RWV:62) but never displayed.

#### B.2.7 `GanttChart` (GC) — the main chart

Layout (GC:394-1180) is a Card with id `gantt-chart-container`, which the image and PDF exports capture:
1. A controls strip (GC:399-423).
2. A split body. On the left, a fixed **256px (w-64)** task list with a 60px "Task Name" header. On the right, a horizontally scrolling timeline with a 60px time header (not sticky vertically, since the page scrolls), task rows 40px high, a milestone row, and an SVG dependency overlay.

Constants (GC:36-41): `ROW_HEIGHT 40`, `HEADER_HEIGHT 60`, `TASK_BAR_HEIGHT 28`, `BASELINE_BAR_HEIGHT 8`, `DAY_WIDTH {day:40, week:20, month:8}`, `DRAG_HANDLE_WIDTH 8`. Bar minimum width: 20px (8px for segments). Label shown only if the bar width is > 60px.

| Control / interaction | Type | Purpose (user terms) | Handler → effect | Data | Validation/disabled | Error/empty |
|---|---|---|---|---|---|---|
| Today | Ghost button | Scroll to today | `scrollLeft = (today − chartStart)·dayWidth − viewport/2` GC:387-392, 401-403 | — | — | If today is outside the chart range, it scrolls to the clamp edge |
| ‹ / › | Icon buttons | Pan ±200px (smooth) | `scrollBy` GC:406-421 | — | — | — |
| Group header row (category / zone / status / owner / colour / category) | Clickable row (TGH) with a chevron, icon, label and count badge | Collapse/expand the group | `toggleGroup(key)` GC:289-299, TGH:90 | In-memory `collapsedGroups`, lost on remount | — | Labels for an empty key: "Uncategorized" (category, level 0), "Unassigned" (zone/owner), "No Color", "No Value" (GC:500, TGH:61-79) |
| Row click (left list) | Row | Edit the task | `onEditTask(task)` → PG:228-231 opens TF in edit mode (GC:479, 515, 566) | — | — | — |
| Row checkbox | Checkbox | Select for bulk actions | `onSelectTask(id, checked)` (GC:481-485 etc.). The click does not bubble to the row | In memory | — | Selected rows get `bg-primary/10` |
| Row progress badge | Badge "`progress%`" coloured by status | Glance at status | — | — | — | Colours: not_started muted, in_progress primary, completed green (GC:381-385) |
| Row drag handle (GripVertical, shown on hover) + HTML5 drag-and-drop of the row | Native DnD | Reorder tasks | `onDrop` splices the dragged id before the target in `tasks` (the **filtered** list) and calls `onReorderTasks(orderedIds)` → `reorderTasks` writes `sort_order = index` for each id **one UPDATE per task, sequentially** (GC:516-537, 567-588; uGT:159-189) | `gantt_tasks.sort_order` | **Only in `none` and the status/owner/color/category groupings. Not available in the default `category_owner` mode** (no `draggable` attr, GC:471-493). Cross-group drops are allowed and ignore the grouping | Toast "Failed to reorder tasks: …". A partial failure leaves a half-renumbered order |
| Time header cells | Static | Scale | Day: `d` + `EEE`, weekend and today tinted. Week: `MMM d` + `Week w`, width 7·20px. Month: `MMMM yyyy` (GC:302-350) | — | — | Month-view header defect, see B.7 |
| Today line | Vertical 2px line | "Now" marker | `left = (today − start)·dayWidth` GC:637-645 | — | `config.showToday` (always true) | Can fall outside the drawn range |
| Weekend shading | Grey columns | See weekends | GC:884-899 | — | **Only in day view AND only in non-`category_owner` modes** (it is inside the flat branch) | Not drawn in the default view |
| Baseline ghost bar | Dashed 8px bar at the bottom of the row, tooltip "Baseline dates" | Compare the plan against the baseline | `getBaselinePosition(taskId)` GC:277-286, 677-698, 902-923 | `gantt_baseline_tasks` start/end matched on `task_id` | Only when a baseline is selected and the snapshot contains the task | Tasks added after the baseline show no ghost. Tasks deleted since the baseline are gone from it (cascade) |
| Task bar | Coloured rounded bar (`task.color` or theme primary), a translucent overlay covering the incomplete `100−progress %` from the right, name label | Visualise dates and progress | — | `start_date`, `end_date`, `progress`, `color` | — | Critical tasks: `ring-1 ring-destructive` (red outline) |
| Bar click | Click | Edit the task | `!isDragging && onEditTask(task)` (GC:707, 945) | — | — | Probable defect: the click that ends a drag also opens the editor (B.7) |
| Bar left 8px edge drag | Mouse drag | Change the start date | `startDrag(task,'resize-start',x)` GC:755-770, 947-961 → uDrag | `start_date` | Start is clamped to ≤ end−1 day (uDrag:62-68) | — |
| Bar right 8px edge drag | Mouse drag | Change the end date | `'resize-end'` | `end_date` | End is clamped to ≥ start+1 day (uDrag:69-75) | — |
| Bar middle drag | Mouse drag | Move the task in time | `'move'`: both dates shift by the same delta | both | — | — |
| Esc during drag | Key | Cancel the drag | `cancelDrag()` + `cancelDependencyDrag()` (GC:105-110) | — | — | — |
| Drag commit | Mouse up (window listener) | Save the new dates | `endDrag` → if changed, `onUpdateTask(id,{start_date?, end_date?})` (uDrag:87-108) → PG:495-515 `updateTask.mutate` | `UPDATE gantt_tasks` (uGT:60-92) | **No optimistic update**, so the bar snaps back to the old dates until the server responds. No dependency constraints are checked and successors are not moved | Toast "Failed to update task: …" |
| Dependency dots (left = start, right = end) | 16px circles shown on bar hover (always visible while a link drag is active) | Draw a link from one task to another | mousedown → `startDependencyDrag(taskId, 'start'\|'end', x, y)` (GC:783-820, 987-1024) | — | — | — |
| Link drag line | SVG cubic curve, primary colour, with start/end circles (DDL) | Visual feedback | `updateDependencyDrag(x,y)` from the window mousemove, coordinates relative to the scroll container minus the header (GC:85-93) | — | `isValid` is hard-coded `true` (GC:1170), so an invalid target is never shown | — |
| Drop on another task's dot | mouseup on a dot | Create the dependency | `endDependencyDrag(targetId, point)` (uDep:53-92). The same task is rejected silently. Because PG always supplies `onRequestDependencyType`, this **always opens the DependencyTypeSelector** with predecessor = the drag source and successor = the target. **The dot that was grabbed and the dot that was dropped on are ignored** (the automatic FS/SS/FF/SF inference in uDep:77-90 is unreachable) | — | — | Released anywhere else: the window mouseup cancels (GC:100-102) |
| Right-click bar → Edit Task | Context menu item | Edit | `onEditTask(task)` GC:849-852, 1041-1044 | — | — | — |
| Right-click bar → Delete Task | Context menu item (destructive) | Delete one task | `onDeleteTask(id)` → PG:516 `deleteTask.mutate` → `DELETE gantt_tasks WHERE id` (uGT:94-113) | Cascade as in bulk delete | **No confirmation** | Toast "Task deleted" / error |
| Bar hover tooltip | Tooltip | Details | Name; dates `MMM d – MMM d, yyyy` (or "Segment i: …" lines for split tasks); "Progress: N%"; "Zone: X" (category_owner) or "Owner: X" (other modes); "On Critical Path" in red (GC:825-845, 1027-1037) | — | — | — |
| Segmented bars (category_owner + splitView ON, task has ≥1 segment row) | Multiple bars on one row. The label is on the first segment only | Show split work periods | GC:710-738 | `gantt_task_segments` | **No drag, no resize, no dependency dots on segmented bars.** Only click-to-edit and the context menu | — |
| Cascade rows (category_owner + splitView OFF, task has >1 segment) | One row per segment, sorted by segment start within its zone | Show split work periods as a staircase | `expandTaskRows` GC:194-203, sorting GC:245-266 | — | Rows are bars that act on the whole task (a drag of a segment row moves the **whole task's** dates using the segment's pixel offset; `getDragPreview` renders the task's dates) | Confusing. See B.7 |
| Milestone row | Dashed-top row below the tasks; Flag icon (24px) at the date, coloured `milestone.color` or primary | See key dates | GC:1062-1098 | `gantt_milestones` | Hidden by the Milestones toggle | **No click, no drag, no edit, no delete.** Tooltip shows name, `MMM d, yyyy` and description |
| Dependency arrows | SVG dashed polyline (right-angle "Z" through midX) with an arrowhead | See links | GC:1101-1161 | `gantt_task_dependencies` | Toggle | **Always drawn predecessor-END → successor-START regardless of type.** Uses whole-task dates (not segments). Skipped if either task is filtered out. No click-to-delete |
| Chart range | — | — | start = `startOfWeek(min(all task + milestone dates)) − 7 days`; end = `max(dates)` **with no trailing padding** (GC:126-153) | — | If there are no tasks: `startOfWeek(today)` → today+30 | — |
| Empty (all filtered out) | — | — | The chart renders with the default 30-day range, no rows, and no "no matches" message | — | — | — |

Unused imports and dead code in GC: `Link`, `Unlink`, `ChevronDown`, `isSameMonth`, `GroupByMode`, `DragMode` import, `viewOffset` state, and the `onDeleteDependency` prop (received, never called).

#### B.2.8 `TaskForm` (TF) — create/edit dialog

Title: "Create Task"/"Edit Task". Description copy is at TF:95-98. Zod schema TF:20-32.

| Field | Type | Purpose | Default (create) | Validation | Persisted to |
|---|---|---|---|---|---|
| Task Name | Input | — | `''` | `min(1)` → "Task name is required" | `name` |
| Description | Textarea (2 rows) | Free notes. **Also the "Category" for grouping** (imported tasks store the category here) | `''` | none | `description` (`''` → null) |
| Start Date | Popover calendar button (`MMM d, yyyy`) | — | today (local) | `z.date()` | `start_date` |
| End Date | Popover calendar button | — | today + 7 | `end_date ≥ start_date` → "End date must be after start date" (the message is wrong: equal dates are allowed) | `end_date` |
| Status | Select (Not Started/In Progress/Completed) | — | not_started | enum | `status` |
| Owner | Input "Assignee name" | Free-text assignee. **Also the "Zone"** for grouping | `''` | none | `owner` (`''` → null) |
| Progress: N% | Slider 0–100, step 5 | — | 0 | 0–100 | `progress` |
| Color | 9 round buttons (Default = theme primary, + 8 presets) | Bar colour | null | nullable string | `color` |
| Cancel | Button | Close | — | — | — |
| Create Task / Update Task ("Saving..." while pending) | Submit | Save | — | Disabled while pending | see below |

Submit paths:
- **Create** → PG:127-134 → `createTask.mutateAsync(formData)` → uGT:26-58. Insert with `sort_order = max(sort_order)+1` computed **client-side** from the cached list (race-prone). Dates formatted with `format(d,'yyyy-MM-dd')` (local, correct). Toast "Task created". Then the dialog closes and the steps `create_task` (+ `assign_owner` if an owner was given) complete.
- **Edit** → PG:137-180 → `updateTask.mutateAsync` with dates via **`toISOString().split('T')[0]`** (PG:147-148). ⚠ **Timezone defect (B7-D1):** in any UTC+ zone (South Africa, UTC+2) a date picked or loaded as local midnight serialises to the *previous* UTC day. **Every save of the edit form moves the start and end one day earlier.** If the status went from not-completed to completed: when every other task is already complete and there is at least one other task, fire `celebrateAllComplete()` (3 s of confetti) + toast "🎉 All tasks completed! Amazing work!". Otherwise fire `celebrateSubtle()` + "✅ "<name>" completed!".
- No status↔progress coupling. There is no delete button in the form (delete lives only in the context menu and bulk actions).

#### B.2.9 `MilestoneForm` (MF)

Fields: Milestone Name (required, "Milestone name is required"), Date (popover calendar, `MMMM d, yyyy`, default today), Description (optional), Color (Default + 8 presets). Buttons: Cancel, and "Add Milestone" ("Saving..."). Submit → PG:183-187 → `createMilestone.mutateAsync` → insert `gantt_milestones` (date via `format`, correct) → toast "Milestone created" → `completeStep('add_milestone')`.

**Stub:** MF supports edit mode (`milestone` prop, "Edit Milestone"/"Update Milestone", MF:27, 45-61, 72, 183), and uGM exposes `updateMilestone`/`deleteMilestone` (uGM:54-104). **PG never passes a milestone and never calls update or delete** (PG:53 destructures them and does not use them). **Milestones cannot be edited or deleted in the UI.**

#### B.2.10 `DependencyTypeSelector` (DTS)

Opens when `pendingDependency` is set (PG:566-582). Title "Create Dependency", description `Link "<pred>" → "<succ>"`. A radio group of 4 cards (DTS:17-42):

| Value | Label | Copy |
|---|---|---|
| finish_to_start | Finish to Start (FS) | "Task B cannot start until Task A finishes" |
| start_to_start | Start to Start (SS) | "Task B cannot start until Task A starts" |
| finish_to_finish | Finish to Finish (FF) | "Task B cannot finish until Task A finishes" |
| start_to_finish | Start to Finish (SF) | "Task B cannot finish until Task A starts" |

Default FS, reset to FS after each confirm. **Create Link** → `createDependency.mutate({predecessorId, successorId, dependencyType})` → insert `gantt_task_dependencies` (uGD:36-66) → toast "Dependency created" / "Failed to create dependency: …" (e.g. the UNIQUE violation on a duplicate pair). `completeStep('create_dependency')` fires regardless of the outcome. **No lag field. No cycle check. No reverse-pair check** (A→B and B→A are both allowed and create a cycle). **Cancel** discards.

**Missing: editing or deleting a dependency.** `updateDependency` and `deleteDependency` exist (uGD:68-115), but no UI calls them. A link can only disappear by deleting one of its tasks.

#### B.2.11 `ImportScheduleDialog` (ISD)

Title "Import Schedule from Excel". Description "Upload your solar PV project schedule Excel file. Tasks will be grouped by Zone." Two states:

| Control | Type | Purpose | Handler → effect | Data | Validation | Error/empty |
|---|---|---|---|---|---|---|
| Drop zone | Click / drag-and-drop area ("Drag & drop or click to upload", ".xlsx, .xls, .xlsm"). Shows a spinner and "Parsing schedule..." while parsing | Choose a file | Click → hidden `<input type=file accept=".xlsx,.xls,.xlsm">`. Drop → extension check → `processFile` (ISD:35-87) | Reads the file client-side | Drop: an extension outside xlsx/xls/xlsm → toast "Please upload an Excel file (.xlsx, .xls, .xlsm)". The picker relies on `accept` only | Parser throw → toast "Failed to parse file: <msg>". Each parse warning → `toast.warning` **and** a red Alert |
| Summary badges | Badges | Show what was found | filename, `N tasks`, `N zones`, `N categories`, "Dates detected" / "No dates found" (ISD:174-191) | — | — | — |
| Errors alert | Destructive alert, one line per error | — | ISD:194-201 | — | — | — |
| Import Mode | Radio: "Append to existing (N tasks)" / "Replace all existing tasks" (red) | Choose how to merge | ISD:204-226 | — | Shown only if the project already has tasks. **Default Append** | — |
| Preview table | Scrollable (300px): rows grouped by zone header (zone colour dot + "zone (N tasks)"); columns: colour dot, Task Name, Category, Days, Start, End, Segments ("1" or "N split" badge), Progress (mini bar + %) | Check before importing | ISD:229-294 | — | — | Fragment keys missing (`<>` in map, ISD:246). React key warning only |
| Choose different file | Ghost button | Reset | ISD:297-306 | — | — | Re-selecting the same file in the picker does not fire `change` (input value is never reset) |
| Cancel | Button | Close and clear | ISD:105-111 | — | — | — |
| Import N Tasks ("Importing...") | Button | Commit | `onImport(tasks, mode)` → PG:248-292 | see B.5.1 | Disabled if there is no result, 0 tasks, or an import is in progress | Success toast "Imported N tasks". Failure toast "Import failed: <msg>". **Partial imports are left in place** |

#### B.2.12 `KeyboardShortcutsModal` + shortcut engine

The modal lists shortcuts grouped as Tasks (n, m, Delete, Backspace), Edit (z, y), Selection (a, Escape) and View (+, −, f) (KSM:13-18). Keys are formatted as ⌘/Ctrl, ⌥/Alt, ⇧, Esc, Del, ⌫ (uKS:55-84).

Engine (uKS:17-52): a global `window` keydown listener while the tab is mounted. It is ignored when the target is an INPUT, TEXTAREA or contentEditable. It is **not** ignored inside open dialogs on buttons or selects. Matching requires an exact modifier match: `ctrl` means Ctrl **or** ⌘; a missing flag means the modifier must be up. It calls `preventDefault` and runs the **first** match.

| Keys | Action | Handler | Behaviour / defect |
|---|---|---|---|
| N | New task | PG:301 | Opens TF create |
| M | New milestone | PG:302 | Opens MF |
| Delete / Backspace | Delete selected | PG:303-307 → `handleBulkDelete` | **Deletes the selection with NO confirmation** (bypasses the bulk-delete AlertDialog) |
| Ctrl/⌘+Z | Undo | PG:308 | **No-op** (see B.6.3) |
| Ctrl/⌘+Shift+Z, Ctrl/⌘+Y | Redo | PG:309 | **No-op** |
| Ctrl/⌘+A | Select all filtered (toggle) | PG:310 | Overrides the browser's select-all while the tab is open |
| Esc | Clear selection | PG:311 | Also cancels drags (GC:105-110) |
| Ctrl/⌘ + "+" | Zoom in (month→week→day) | PG:312-315 | On US/UK layouts "+" needs Shift, and the matcher requires Shift to be up, so this is **effectively unreachable**. Ctrl+= is not mapped |
| Ctrl/⌘ + "−" | Zoom out (day→week→month) | PG:316-319 | Works, and overrides browser zoom-out |
| Ctrl/⌘+F | Focus search | PG:320 | Overrides browser find |

---

### B.3 Calculations and business rules

#### B.3.1 Date model and time zone
- The DB stores `DATE` (no time, no zone) for task, segment, baseline and milestone dates (M1:11-12, 37, 59-60; M2:6-7).
- The client parses with `parseISO('yyyy-MM-dd')`, which gives **local** midnight. It writes with `format(d,'yyyy-MM-dd')` (local) on create, drag, milestones and import, but with `toISOString().split('T')[0]` (UTC) on **task edit** (PG:147-148). The result is a one-day backwards drift per edit in UTC+ zones (B7-D1).
- Import builds dates with `new Date(year, month, day)` (local, GI:145), serialises with `format` (GI:286-292), then PG re-parses with `new Date('yyyy-MM-dd')` (**UTC** midnight, PG:265-266) and re-formats locally in `createTask` (uGT:37-38). That round trip is correct in UTC+ zones but would shift a day earlier in UTC− zones.
- **All durations are inclusive calendar days**: `differenceInDays(end, start) + 1` (CP:32, GX:23, GC:284, 357, RWV:61). **There are no working days, no weekends excluded, no holidays, and no calendars.** Weekends are purely a visual tint (day view, flat modes only). Week start = date-fns default (Sunday). The week number `w` is locale week-of-year.

#### B.3.2 Critical path (`CP:20-103`, used at GC:156-158 on **filtered** tasks and at PP via `getScheduleStats` on **all** tasks)

Algorithm (CPM on a relative time axis):
1. Node per task: `duration = max(1, differenceInDays(end,start)+1)`. Actual calendar start dates are **ignored**.
2. Edges from every dependency whose two ends are both in the task set. **`dependency_type` is ignored**: every link is treated as Finish-to-Start. **There is no lag** (no column exists). Comment at CP:47.
3. Topological sort (Kahn, CP:109-143). If there is **any cycle, the function returns `[]`** (no critical path, no warning).
4. Forward pass: `ES = 0` for a task with no predecessors, otherwise `max(EF of predecessors)`. `EF = ES + duration`.
5. `projectEnd = max(EF)`.
6. Backward pass: `LF = projectEnd` for a task with no successors, otherwise `min(LS of successors)`. `LS = LF − duration`. `slack = LS − ES`.
7. Critical = `|slack| < 0.001`.

Consequences to carry into the rebuild spec:
- Independent tasks all get ES=0. With no dependencies, only the longest task(s) are "critical", whatever their real dates. A task scheduled late in the calendar is never considered late.
- SS/FF/SF links behave like FS links, which produces wrong criticality.
- Float is computed but **never shown**. Only a boolean ring and the count in PP are surfaced.
- With filters active, GC's rings describe the sub-network of visible tasks while PP's count describes all tasks, so the two can disagree.

#### B.3.3 Dependency semantics
- The four types are stored (enum, M1:3) and chosen in DTS. Beyond storage and export labels, **no scheduling logic uses them**: there is no auto-scheduling, no constraint validation on drag or edit, and no successor shifting. Arrows are always drawn end→start.
- DB: `UNIQUE(predecessor_id, successor_id)` (M1:29). There is no CHECK that `predecessor ≠ successor` (only a client-side check in uDep:65), no same-project check, and no cycle check.

#### B.3.4 Progress and roll-up (PP + CP:148-185)
- `status` and `progress` are **independent** fields. No roll-up or coupling exists anywhere except import (`progress ≥ 100 → completed; > 0 → in_progress; else not_started`, PG:260).
- Overall Completion = `round(100 × count(status='completed') / count(tasks))`.
- Average Progress = `round(Σ progress / n)`, **unweighted** by duration.
- Project Duration = `(max end − min start) + 1` calendar days (milestones excluded).
- There are no group/category/zone roll-ups (group headers show counts only), no earned value, and no parent/summary tasks (the model is flat).

#### B.3.5 Baseline variance
- A snapshot contains `task_id`, `name`, `start_date`, `end_date` for **every task at save time** (uGB:40-55). Progress, status, owner, milestones and dependencies are **not** snapshotted.
- "Variance" is **visual only**: a dashed ghost bar under the live bar (GC:277-286). **No slip days, no start/finish variance numbers, no report, and no export of the baseline.**
- `gantt_baseline_tasks.task_id` has `ON DELETE CASCADE` (M1:57). **Deleting a live task silently removes it from every historical baseline**, so a baseline cannot show scope that was removed.

#### B.3.6 Resource workload (RWV:29-80)
- Groups tasks by the free-text `owner` (the "zone" for imported tasks). For each owner: task count, completed count, completion % = `completed/total × 100`, and `dailyLoad[date] = number of that owner's tasks spanning that calendar day` (weekends and completed tasks included).
- **Overloaded day = dailyLoad > 2** (hard-coded, RWV:74-75). There are no capacity, hours or effort fields.

#### B.3.7 Drag maths (uDrag:47-85)
- `deltaDays = round((clientX − startX) / dayWidth)`, so snap granularity is 1 day in every zoom level (8px per day in month view).
- move: start+Δ, end+Δ. resize-start: start+Δ, and if `≥ originalEnd` then `originalEnd − 1`. resize-end: end+Δ, and if `≤ originalStart` then `originalStart + 1`.
- Consequence: **a 1-day task (start = end) cannot be made by dragging**, and a resize of a 1-day task immediately produces 2 days. The form does allow start = end. The rules are inconsistent.

#### B.3.8 Reorder logic
- Default order is `sort_order ASC` from the DB (uGT:18). New tasks get `max+1`. Import appends in file order.
- Drag-to-reorder (GC:526-537) computes the new order over the **filtered** list and rewrites `sort_order = 0..n−1` for those ids only (uGT:159-189). Hidden tasks keep their old numbers, so the **orders collide** and the result depends on the DB's tie ordering.
- In `category_owner` mode, rows are ordered by first appearance of the category, then zone, then `sort_order` (GC:205-274). In cascade mode the segment rows are re-sorted by start date.
- `useTaskReorder` (uTR) is an unused alternative implementation.

#### B.3.9 Segments (split tasks)
- Segments are created **only by Excel import**, and only when a row has ≥ 2 non-contiguous runs of filled day cells (PG:274-282). A single run produces no segment rows; the task dates are used instead.
- The task's own `start_date`/`end_date` span the first segment start to the last segment end (GI:271-272).
- Segments **cannot be viewed as data, edited, added or removed** in the UI. Dragging or editing a segmented task changes only the task row. **The segments keep their old dates** and continue to render (category_owner/split mode draws segments *instead of* the task bar, so the edit appears to do nothing).
- Segments are ignored by: critical path, arrows, baseline, workload, every export, ProgressPanel, and all non-`category_owner` groupings.
- Segment query: `gantt_task_segments WHERE task_id IN (all task ids) ORDER BY start_date` (uGS:9-24). The query key is `['gantt-task-segments', projectId]` and does not include the id list.

#### B.3.10 Hard-coded values
`TASK_COLORS` (8, T:145-154); `ZONE_COLORS` (20, GI:17-22); pixel constants (GC:36-41); overload threshold 2 (RWV:75); undo history 50 (uUR:4, dead); timeline pad −7 days before (GC:145), 0 after (GC:146); empty-chart range 30 days (GC:129-133); default new-task span 7 days (TF:51); progress slider step 5 (TF:253); bulk progress presets 0/25/50/75/100 (BAB:88-92); import `DATA_START_COL = 6` (col G), header rows 0 and 2, data from row 3 (GI:155, 201); ICS PRODID "-//Solar Pro//Gantt Schedule//EN" and UID domain `@solarpro` (ICS:15, 23, 44); fake organiser domain `@example.com` (ICS:35); PDF A4 landscape with 10mm margins (GX:122-143); image pixelRatio 2, JPEG quality 0.95 (GX:80-89).

---

### B.4 Data model

#### B.4.1 Enums (M1:2-3)
- `gantt_task_status`: `not_started | in_progress | completed`
- `gantt_dependency_type`: `finish_to_start | start_to_start | finish_to_finish | start_to_finish`

#### B.4.2 Tables

| Table | Columns (type, null, default) | Keys / constraints | Cascade |
|---|---|---|---|
| `gantt_tasks` (M1:6-20) | `id uuid PK default gen_random_uuid()`; `project_id uuid NOT NULL`; `name text NOT NULL`; `description text` (used as **Category**); `start_date date NOT NULL`; `end_date date NOT NULL`; `status gantt_task_status NOT NULL default 'not_started'`; `owner text` (used as **Owner/Zone**, free text, no FK to users); `progress int NOT NULL default 0 CHECK 0..100`; `sort_order int NOT NULL default 0`; `color text` (hex string, unvalidated); `created_at`, `updated_at timestamptz NOT NULL default now()` | FK `project_id → projects(id) ON DELETE CASCADE`. **No CHECK `end_date ≥ start_date`** | Deleting a project deletes its tasks |
| `gantt_task_dependencies` (M1:23-30) | `id`; `predecessor_id uuid NOT NULL`; `successor_id uuid NOT NULL`; `dependency_type NOT NULL default 'finish_to_start'`; `created_at` | FKs to `gantt_tasks ON DELETE CASCADE`; `UNIQUE(predecessor_id, successor_id)`. **No project_id, no lag column, no self-link CHECK** | Deleted with either task |
| `gantt_milestones` (M1:33-42) | `id`; `project_id NOT NULL`; `name NOT NULL`; `date date NOT NULL`; `description`; `color`; `created_at`, `updated_at` | FK `projects ON DELETE CASCADE` | — |
| `gantt_baselines` (M1:45-51) | `id`; `project_id NOT NULL`; `name NOT NULL`; `description`; `created_at` | FK `projects ON DELETE CASCADE`. No `created_by` | — |
| `gantt_baseline_tasks` (M1:54-62) | `id`; `baseline_id NOT NULL`; `task_id NOT NULL`; `name NOT NULL`; `start_date`, `end_date date NOT NULL`; `created_at` | FK `baseline_id → gantt_baselines ON DELETE CASCADE`; FK `task_id → gantt_tasks ON DELETE CASCADE` (**destroys history**) | — |
| `gantt_task_segments` (M2:3-9) | `id`; `task_id NOT NULL`; `start_date`, `end_date date NOT NULL`; `created_at` | FK `task_id → gantt_tasks ON DELETE CASCADE`. No overlap/order constraint | — |

Triggers: `update_gantt_tasks_updated_at` and `update_gantt_milestones_updated_at` → `public.update_updated_at_column()` (M1:177-185). Indexes: tasks(project_id), tasks(status), deps(predecessor), deps(successor), milestones(project_id), baselines(project_id), baseline_tasks(baseline_id) (M1:188-194), segments(task_id) (M2:28).

`types.ts` includes `gantt_task_segments` (line 432) and `gantt_tasks` (464), but uGS still casts `as any` (uGS:14-18, 38-40, 51-54). That cast is a leftover.

#### B.4.3 RLS (M1:65-174, M2:12-25)
- All six tables have RLS enabled, and **every policy is `USING (true)` / `WITH CHECK (true)`**.
- The five M1 tables grant `TO authenticated`: **any signed-in user, in any organisation, can SELECT, INSERT, UPDATE or DELETE any project's schedule.**
- The **M2 segment policies have no `TO` clause, so they apply to PUBLIC, including `anon`**: anyone holding the public anon key can read, insert, update or delete every segment of every project without signing in.
- UPDATE policies have no `WITH CHECK`, so a row can be re-pointed to another `project_id`.
- This is weaker than the parent table. `projects` became org-scoped in `20260318090000_add_organizations_and_user_invites.sql:153-185` (`org_id = get_user_org_id(auth.uid())`), and **no gantt policy was ever updated to follow it** (only M1 and M2 mention gantt).
- The dependencies query leans on RLS being open: it fetches all task ids of the project and then filters dependencies client-side (uGD:13-31).

#### B.4.4 Schema-drift warning
`schema-dump.sql` ("FULL SCHEMA DUMP for target Supabase instance", SD:1-3) recreates the gantt tables (SD:367-432) **without** the `ON DELETE CASCADE` clauses, the `progress` CHECK, the `UNIQUE(pred, succ)`, the triggers, and **any RLS at all** (the file contains zero `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY`). On an instance built from that dump:
- Deleting a task that has dependencies, segments or baseline rows fails with an FK violation.
- The tables are wide open.

Which instance is live must be confirmed. It is not knowable from the source.

---

### B.5 Import and export formats

#### B.5.1 Excel import (GI:161-311 + PG:248-292)

**Accepted:** `.xlsx`, `.xls`, `.xlsm` via SheetJS `XLSX.read(buffer, {type:'array', cellDates:false})`. **Only the first sheet** is read.

**Required layout** (a contractor-style bar chart with day columns):

| Row (0-based) / Col | Meaning |
|---|---|
| Row 0, col G (idx 6) onward | **Month headers**, read by *formatted* text (`cell.w`). Accepted forms: Excel date serial (1 < n < 100000, epoch 1899-12-30), a JS Date, `Month-YY`, `Month/YYYY`, `Mon-YY` (regex `^([A-Za-z]+)\s*[-/]\s*(\d{2,4})$`; a 2-digit year gets +2000), or a bare month name (no year). A header needs to appear only at the first column of each month. Scanning covers up to `max(row0 length, 200)` columns (GI:185) |
| Row 1 | Ignored (typically weekday letters) |
| Row 2, col G onward | **Day-of-month numbers** 1–31 (raw values). Non-numeric cells are skipped |
| Rows ≥ 3 | Tasks |
| Col A (0) | **Category**, sticky: it applies to the following rows until the next non-empty A. A new category **resets the zone to ''**. Default "General" |
| Col B (1) | **Zone**, sticky until the next non-empty B or a new category |
| Col C (2) | **Task name**. A row without one is skipped (it can still set the category or zone) |
| Col D (3) | Days scheduled: `max(Number(D) \|\| 1, 1)`. **Shown in the preview, never stored** |
| Col E (4) | Ignored |
| Col F (5) | Progress: if > 1 it is a percentage (rounded), otherwise a fraction ×100. Clamped 0–100. Non-numeric → 0 |
| Cols G+ | Any non-null, non-'' cell = an **active day** for that task |

**Date resolution** (GI:95-153):
- Year comes from the most recent month header that has a year. A yearless month that is numerically earlier than the current month adds a year.
- A day number lower than the previous day in the same month advances the month (with year rollover).
- If no header has a year, the error is "No year information found in any month header. Expected format like "August-25" or "September-2025"." A yearless header before any year gives "Month header '<v>' has no year. Expected format like 'August-25'." (Reported once.)

**Segments:** consecutive active dates with a gap ≤ 1 calendar day join one segment. A larger gap starts a new segment. A task with no active cells is **skipped** and counted: "N task(s) skipped — no start date found in the schedule columns."

**Colour:** one per zone from the 20-colour palette, in order of first appearance. The empty zone '' also gets a colour. Other errors: "No sheets found in workbook", "Sheet has too few rows (need at least 4)", "No tasks could be parsed from the file. Please check the format."

**Commit** (PG:248-292):
1. If mode = replace and tasks exist: delete their segments, then **bulk-delete all existing tasks**. This cascades to their dependencies and their rows in **all baselines**.
2. For each parsed task, **sequentially** `await createTask.mutateAsync(...)` with the mapping `name=taskName`, `description=category`, `owner=zone`, `progress`, `color=zone colour`, and status derived from progress. **Each insert fires its own "Task created" toast** (N toasts).
3. Collect segments for tasks with more than one segment, then one bulk insert into `gantt_task_segments`.
4. Mark the `create_task` and `assign_owner` steps done.

Failure modes:
- It is not transactional. A mid-way failure leaves some tasks inserted, and in replace mode the old tasks are already gone.
- `sort_order` for each insert is computed from the hook's cached `tasks` (uGT:29), so it can repeat. The local `maxOrder` in PG:255 is computed and never used.
- `daysScheduled` is discarded.
- No de-duplication on append: importing twice doubles every task.
- Dependencies and milestones cannot be imported.

**Dependency risk:** `xlsx@0.18.5` is the last npm-published SheetJS and carries known advisories (prototype pollution CVE-2023-30533, fixed 0.19.3; ReDoS CVE-2024-22363, fixed 0.20.2). The file is parsed in the user's browser.

#### B.5.2 Excel export (GX:8-63)
File `<projectName with non-alphanumerics→_>_schedule.xlsx`. Sheets:
- **Tasks**: `#`, `Task Name`, `Description`, `Start Date` (yyyy-MM-dd), `End Date`, `Duration (Days)` (inclusive), `Status` (first `_`→space), `Progress (%)`, `Owner`, `Color`.
- **Milestones** (only if any exist): `#`, `Milestone Name`, `Date`, `Description`.
- **Dependencies** (only if any exist): `#`, `Predecessor` (name, or the id if the task is missing), `Successor`, `Type` (all `_`→space).

Not included: segments, baselines, critical flag, float, category/zone as named columns. **The export is not round-trippable with the import format.**

#### B.5.3 Image and PDF (GX:66-163)
- `html-to-image` captures the `#gantt-chart-container` DOM node (white background, 2× pixel ratio). Because the timeline is an `overflow-x-auto` element, the capture is limited to what is **currently rendered in the viewport width**, so long schedules are cut off (probable; not verified by running).
- PDF: A4 landscape, one page only. The title is "`<project> - Project Schedule`" at 16pt and "`Generated: <MMMM d, yyyy>`" at 10pt. The image is fitted with 10mm margins and offset +15mm. It is not paginated, so a large chart becomes unreadably small. Files are `…_schedule.png|jpeg|pdf`.

#### B.5.4 Word (GX:166-256)
- An HTML document saved with MIME `application/msword` and the extension `.doc`. It contains an H1 project name, "Project Schedule Report - Generated <date>", a Tasks table (`#`, Task Name, Start, End as `MMM d, yyyy`, Status, Progress, Owner or "-"), and a Milestones table.
- **Values are interpolated unescaped** into HTML (GX:176-241), so a task name containing markup renders as markup.
- Not included: description, dependencies, baselines.

#### B.5.5 ICS (ICS:7-112)
- `VCALENDAR` with `X-WR-CALNAME:<project> Schedule`.
- Each task becomes an all-day `VEVENT`: `UID task-<id>@solarpro`, `DTSTART;VALUE=DATE`, `DTEND;VALUE=DATE` = end + 1 (exclusive, correct), `SUMMARY`, optional `DESCRIPTION`, optional `ORGANIZER;CN=<owner>:mailto:<owner-no-spaces>@example.com` (**fabricated address**), `STATUS` (`COMPLETED`/`IN-PROCESS`/`NEEDS-ACTION`: these are **VTODO values, invalid on VEVENT**), and a non-standard `X-PROGRESS`.
- Each milestone becomes an all-day event with `SUMMARY:🎯 <name>`, `TRANSP:TRANSPARENT`, and no DTEND.
- `DTSTAMP` formats **local** time with a literal `Z` (wrong for non-UTC users).
- No 75-octet line folding. Escapes `\ ; , \n`.
- The file is `<project with non-alnum→->-schedule.ics`. It is a one-off download, not a subscribable feed.

---

### B.6 Persistence outside the database

#### B.6.1 localStorage
| Key | Content | Owner |
|---|---|---|
| `gantt-onboarding-progress-<projectId>` | `{"steps":{"create_task":bool,…6},"dismissed":bool}` | uOP:3, 56-93 |
| `gantt-filter-presets-<projectId>` | `[{id: crypto.randomUUID(), name, filters:{search,status[],owners[],colors[],dateRange:{start,end}}}]`. Dates are revived with `new Date()` on apply | uFP:4, 10-85 |

Both are per browser and per project. They are not shared with teammates and do not follow the user across devices. There is no size guard. Parse failures are logged to the console and swallowed. Minor race: `completeStep` can fire before the load effect runs and then be overwritten by it. `updatePreset`, `activePresetId` and `clearActivePreset` exist but are unused, so no UI marks the "active" preset.

#### B.6.2 In-memory only (lost on tab switch or reload)
Zoom level, grouping, toggles, selected baseline, filters, selection and collapsed groups.

#### B.6.3 Undo/redo — non-functional
- `useUndoRedo` keeps two in-memory stacks of `UndoAction` (T:134-142), max 50 (uUR:4-55).
- **`pushAction` is never called anywhere** (PG:59 destructures it and leaves it unused), so both stacks are always empty.
- Even if something were pushed, `undo()` and `redo()` only *return* the action. **Nothing applies an inverse mutation to the DB.**
- `canUndo`/`canRedo` are unused, and there are no undo/redo buttons.
- Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z are advertised in the shortcuts modal and do nothing.
- It is not persisted, and it never reaches the DB.

---

### B.7 Defects, gaps and security (severity: C critical, H high, M medium, L low)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| D1 | **C** | Editing a task through the form shifts start and end one day earlier on every save in UTC+ zones (South Africa). This is silent schedule corruption | PG:147-148 `toISOString().split('T')[0]` vs local `parseISO` TF:65-66 |
| S1 | **C** | Segment table open to **anonymous** users (policies lack `TO authenticated`) | M2:15-25 |
| S2 | **C** | All gantt tables are cross-tenant read/write for any signed-in user (`USING(true)`), although `projects` is org-scoped | M1:71-174; org migration 20260318090000:153-185 |
| S3 | H | UPDATE policies lack `WITH CHECK`, so a row can be moved to any project; no DB check `end ≥ start`; no self-link or same-project check on dependencies | M1:82-85, 103-106 |
| D2 | H | Deleting a task (single, bulk, keyboard, import-replace) erases it from all saved baselines, so baselines cannot record removed scope | M1:57 |
| D3 | H | Delete/Backspace hard-deletes the selected tasks with no confirmation; the context-menu delete has no confirmation either | PG:303-307, GC:854-860 |
| D4 | H | Groupings status/owner/color/category: the left list is grouped with header rows and collapsible, but the right timeline stays a flat `tasks.map`, so **names and bars do not line up** and collapsing hides only names | GC:495-554 vs GC:868-1059 |
| D5 | H | Critical path ignores the dependency type and calendar dates, has no lag, and silently returns nothing on any cycle; cycles are not prevented | CP:47-63; uGD:36-66 |
| D6 | H | Milestones cannot be edited or deleted; dependencies cannot be edited or deleted; segments cannot be edited | PG:53 (unused update/delete); uGD:68-115 unused; GC `onDeleteDependency` never invoked |
| D7 | H | Import is non-transactional, and replace deletes before inserting; a failure mid-way loses data. It shows N "Task created" toasts, `sort_order` can repeat, and appending twice duplicates | PG:248-292, uGT:29, 51-54 |
| D8 | M | Undo/redo advertised but inert | B.6.3 |
| D9 | M | Milestone-only project: milestones are created but never shown (the empty guide persists) | PG:340 |
| D10 | M | Query errors are shown as the empty guide ("Create Your Project Schedule") | PG:79, 340; uGT:11 |
| D11 | M | Segmented tasks: bars have no drag, edits do not update segments, and cascade rows drag the whole task using the segment offset; segments are ignored by CP, arrows, exports and non-category_owner views | GC:194-203, 657-738; B.3.9 |
| D12 | M | Month-view header: the first month is drawn from the 1st of the month while the chart starts at `startDate`, so the header is offset from the bars by `(startDate − monthStart)` days | GC:329-349 vs GC:356 |
| D13 | M | Drag has no optimistic update, so the bar snaps back until the server responds; the click at the end of a drag probably opens the edit dialog; resize cannot produce a 1-day task | uDrag:87-108; GC:707/945; uDrag:65-74 |
| D14 | M | Reorder operates on the filtered subset and renumbers 0..n−1, which collides with hidden tasks; it uses N sequential UPDATEs; reorder is unavailable in the default grouping | GC:526-537, uGT:159-189, GC:471 |
| D15 | M | Image/PDF export captures only the visible viewport; the PDF is a single unpaginated page | GX:66-163 |
| D16 | M | ICS invalid STATUS values on VEVENT, fake `@example.com` organiser, DTSTAMP local time marked Z, no line folding | ICS:35-36, 79 |
| D17 | M | `xlsx@0.18.5` known CVEs; the parser processes user files | package.json:77 |
| D18 | M | Arrows always drawn end→start regardless of type; the dependency drag line `isValid` is hard-coded true; the dot grabbed and the dot dropped on are ignored | GC:1122-1142, 1170; uDep:71-75 |
| D19 | M | Imported zone colours (12 of 20) are not filterable and not shown in the legend; group-by-color labels them "No Color"; the TaskForm shows no colour selected for them | GI:17-22 vs T:145-154; CL:22; TGH:72-73 |
| D20 | M | Overloaded field semantics: `owner` is "Owner" in the form and exports but "Zone" in the import and category_owner tooltip; `description` is both free-text notes and the grouping "Category". One control does two jobs (design issue, not a bug) | PG:264-268, GC:173-177, 213-214, 842, 1034 |
| D21 | L | Weekend shading absent in the default grouping and in week/month views; no `showWeekends`/`showToday` toggles; timeline has no trailing padding (today line can fall outside) | GC:884; T:94-95; GC:146 |
| D22 | L | Ctrl+"+" zoom unreachable on common layouts; Ctrl+A/F/− override browser defaults; shortcuts fire while dialogs are focused (non-input) | uKS:33-37 |
| D23 | L | TaskGroupHeader height is `py-2` (content-driven, ≈37px), but the timeline spacer rows are fixed 40px, so rows drift in category_owner mode (probable; needs visual confirmation) | TGH:84-90 vs GC:653 |
| D24 | L | `.in('id'/'task_id'/'predecessor_id', [...])` with hundreds of UUIDs risks exceeding URL length limits on large imports | uGS:17, uGD:28, uGT:122/143 |
| D25 | L | Celebration and completion toasts are client-only flourishes; `completeStep('create_dependency')` fires even if the insert fails | PG:155-172, 519, 578 |
| D26 | L | The tab status count query is never invalidated by gantt mutations | PD:1036-1048 |
| D27 | L | Word export interpolates unescaped user text into HTML | GX:176-241 |
| D28 | L | Dead code: `useTaskReorder`, `celebrate()`, ColorLegend `compact`, OnboardingChecklist complete state and Reset, `chartView`, `dateRange` filter, `updatePreset`, `updateDependency`, `viewOffset`, and many unused imports | see above |
| D29 | L | Baseline delete has no confirmation; a stale compared-baseline id stays set after deletion; baseline create is two non-atomic inserts | TB:504-513; uGB:25-57 |
| D30 | L | No roles or permission gating in the UI: any viewer who can open the project can edit, delete and import | PG (no role checks) |

---

### B.8 Upstream consumption and the E-Site mapping

#### B.8.1 What the tab consumes from the rest of WM Solar
Only `projectId` and `project.name` (PD:1434). It reads **nothing** from the proposal, simulation, PV layout, tariff, equipment, generation or document tabs. The schedule is never seeded from the designed system (for example array size, inverter count or equipment delivery). The solar flavour is only copy: the GettingStartedGuide text, the import dialog description "solar PV project schedule", and the milestone placeholder "Equipment Delivery".

The only thing that flows back out is the `gantt_tasks` count used for the tab status dot (PD:1036-1048, 1176-1180). No other module (reports, monthly report, documents) reads the gantt tables. A repo-wide `grep gantt` finds references only in this feature and PD.

#### B.8.2 Overlap with the E-Site work-item spine

E-Site already has a typed work-item spine (`projects.work_items` with a type registry, `ref` allocation, `due` dates computed from project defaults and the public-holiday calendar, assignee as a real user id, gatekeeper close/reopen/void with reasons, an append-only event feed), plus project documents, versioned `projects.reports` PDFs, and email notifications.

| WM Solar schedule concept | E-Site equivalent | Recommendation / what would be lost or duplicated |
|---|---|---|
| Task `end_date` | Work-item due date | Overlap. Keeping both creates **two task lists with two due dates** for the same activity |
| Task `start_date`, duration, bar | None (work items are open→closed with a due date, not a planned span) | Lost if schedule rows were forced into work items. A Gantt needs its own planned-span entity |
| `status` (3 values) + `progress %` | Work-item states (triage/open/closed/void) with gatekeeper close; no % | Different semantics. A schedule activity at 60% is not a work item "open vs closed". Do not reuse the status enum |
| `owner` free text | Assignee = user id, ball-in-court | E-Site is stronger. The rebuild should use real user or company references. **Free-text "zone" must become its own field** (see D20) |
| Dependencies FS/SS/FF/SF (+ missing lag), critical path | None | Solar-specific value. It is lost unless rebuilt. Rebuild properly: type-aware CPM on working days with lag, cycle rejection, displayed float |
| Baselines | None | Solar-specific value. Rebuild with immutable snapshots (no cascade from live tasks), including progress, and with numeric variance |
| Milestones | Could be a work-item type (dated, closable) or a schedule row with zero duration | Decide once. Duplicating them in both places repeats the pattern above |
| Segments (split work) | None | Needed only for contractor bar-chart import fidelity. Model as child date ranges owned by the activity and editable |
| Excel import (contractor bar chart) | None | Keep. It is the main way a real schedule enters |
| Exports (PNG/PDF/XLSX/.doc/ICS) | `projects.reports` versioned PDFs, documents store | Replace the ad-hoc client PDF with an E-Site report kind (server-rendered, paginated, versioned, access-gated). Keep XLSX. Drop `.doc`. ICS is optional (fix the D16 issues if kept) |
| Working days | E-Site holiday calendar (public holidays table used by due-date maths) | **Gain.** WM Solar uses calendar days only. The rebuild should compute durations and float on E-Site's working-day calendar |
| Notifications / reminders | E-Site email + events | Gain. WM Solar has none (no alerts for slipping or overdue tasks) |
| Access control | E-Site project roles + RLS helpers + `requireRole*` | Gain. WM Solar is open (S1–S3). The paid add-on must be gated per project *and* by role, and every table needs project-scoped RLS |

**Suggested shape (for the assembly step, not a decision):**
- Keep schedule activities as their own table in the Solar add-on schema: planned span, progress, zone, category, dependency graph, baselines, segments.
- Optionally let an activity **spawn or link** a work item when it needs a person to act and a gatekeeper to close it (for example "grid-connection application submitted"). The work item's due date is then derived from the activity's finish date, one-way, so the two never compete as sources of truth.
- Mirroring every Gantt bar into work items would flood the inbox with hundreds of day-level bars from an imported bar chart. That is the main duplication risk.

#### B.8.3 Things the rebuild must decide (not inferable from the source)
1. Whether "zone" and "category" become first-class fields (recommended) rather than reusing owner and description.
2. Working-day calendar per project (weekends, SA public holidays) versus calendar days.
3. Whether dragging should auto-shift successors (auto-scheduling) or only warn on violations.
4. Baseline immutability and retention (no cascade from live tasks).
5. Which instance's schema is live (migrations vs `schema-dump.sql`, B.4.4). This affects whether deletes currently work at all.
6. The import template contract. The parser encodes one specific contractor layout (month row 0, day row 2, data from col G). Real sample files should be collected to confirm that layout before rebuilding.


## Part C — Documents tab & Handover checklist

> Source root: `wmsolar-main/`. Every claim cites `file:line`. Read-only review; nothing was modified.
> Note on the brief: `CLAUDE.md` and `docs/APP_SPEC.md` **do not exist** in this source root (only `docs/CSV_EXTRACTION_SPECIFICATION.md`). `supabase/config.toml` does **not** list `dropbox-proxy` or `fetch-project-files` (so both default to `verify_jwt = true`); only `fetch-github-files` is `verify_jwt = false` (`supabase/config.toml:54-55`).

### C.0 Scope and entry point

| Item | Location |
|---|---|
| Tab trigger "Documents" (FolderOpen icon) | `src/pages/ProjectDetail.tsx:1295-1298` |
| Tab status badge — hard-coded `"pending"`, tooltip "Manage project documents"; never reflects checklist progress | `src/pages/ProjectDetail.tsx:1182-1185` |
| Tab content `<ProjectDocuments projectId={id!} />` | `src/pages/ProjectDetail.tsx:1437-1438` |
| Main component (767 lines) | `src/components/projects/ProjectDocuments.tsx` |
| Only child component (483 lines) | `src/components/projects/HandoverChecklist.tsx` (imported `ProjectDocuments.tsx:33`) |
| Template admin (reached via "Manage Template") | `src/components/settings/ChecklistTemplatesCard.tsx` (408 lines), mounted `src/pages/Settings.tsx:316-318` under `?tab=templates` |
| Migrations (only 5 touch these tables) | `20260210061040_…sql`, `20260210062036_…sql`, `20260210062929_…sql`, `20260210064935_…sql`, `20260210065454_…sql` |

Every other import is a shadcn/ui primitive, `lucide-react`, `date-fns`, `sonner` or the Supabase browser client. **No other component, hook, service or edge function is reached from this tab.** In particular:

- **There is no Dropbox, Google Drive or cloud integration in the Documents tab.** `dropbox-proxy` is referenced nowhere in `src/` (repo-wide grep for "dropbox" hits only the function itself). `fetch-project-files` is referenced only as a *file name* in a hard-coded tree in the code-review tool (`src/components/code-review/ProjectFileBrowser.tsx:208`), never invoked. Both are documented in C.6 for completeness because the brief named them.
- There is no preview pane, no versioning, no search/sort/filter, no sharing, no email, no report export, no audit trail.

---

### C.1 View: ProjectDocuments (the tab body)

**Purpose.** A flat, per-project file store: folders (one level, no nesting) holding uploaded files, with a special folder "Handover Documentation" that renders the Handover Checklist instead of a file list.

**Lifecycle.**
1. On mount / `projectId` change → `fetchData()` (`ProjectDocuments.tsx:127-129`).
2. `fetchData` sets `isLoading=true` (full-card spinner replaces the whole tab, `:587-595`), selects documents (`id, name, file_path, file_size, mime_type, folder_id, created_at, updated_at`, newest first) and folders (`id, name, color, sort_order`, by `sort_order`) in parallel (`:147-158`).
3. **Auto-seed:** if the project has **zero** folders, inserts `Uncategorized` (sort 0) and `Handover Documentation` (sort 1) (`:131-142`, `:166-183`). Insert errors are not checked. Seeding is not idempotent: two concurrent first loads (two tabs/users) create duplicate folder pairs (no unique constraint, see C.9).
4. After every load all folders are forced open (`:190-192`) — any collapse the user did is lost after every mutation.
5. Every mutation calls `fetchData()` again → spinner flash → `HandoverChecklist` unmounts and remounts → template sync re-runs.

**Layout (top to bottom).**
- Hidden `<input type="file" multiple>` (`:600-606`) — no `accept`, so any file type.
- Toolbar (`:609-645`): normal mode = Upload Files · New Folder · Manage Folders (toggle) · Select Multiple (only if `documents.length > 1`); multi-select mode = Cancel · Move (n).
- Folder sections, one bordered collapsible block per folder in `sort_order` (`:648-651`). Header: chevron, colour dot, folder icon, name, count badge; Handover folder adds an upload icon; Manage-Folders mode adds rename/delete icons (`:509-558`). Body: document rows (`renderDocRow`, `:417-493`) or, for the Handover folder, `<HandoverChecklist>` (`:561-571`).
- Synthetic "Uncategorized" section for `folder_id IS NULL` documents — **only rendered if no folder literally named `Uncategorized` exists** (`:652-655`). Because auto-seed always creates such a folder, this section is effectively never rendered (see defect D1).
- Empty-state card "No documents yet" (`:658-666`) — only when there are zero documents **and zero folders**; unreachable after auto-seed succeeds.

**Control inventory — toolbar and folder headers**

| Control | Type | What it's for (user terms) | Handler → effect (file:line) | Data read/written | Validation / disabled | Error & empty states |
|---|---|---|---|---|---|---|
| Upload Files | Button → hidden file input | Upload one or more files to the project | `:625` sets `uploadTargetFolderId=null`, clicks input → `handleUpload` `:202-239` | INSERT `project_documents(project_id,name,folder_id=null)` → storage upload `project-documents/{projectId}/{docId}/{file.name}` → UPDATE `file_path,file_size,mime_type` | Disabled while `isUploading`; spinner icon (`:625-626`). No size/type limit client-side | Toast "Uploaded N file(s)" / "Failed to upload files". **Uploaded files get `folder_id=null` and are then invisible (D1).** |
| New Folder | Button → Dialog | Create a folder | `:629` opens dialog; Create → `handleCreateFolder` `:257-271` | INSERT `project_document_folders(project_id,name,sort_order=folders.length)` | Create disabled if name blank (`:680`); Enter submits (`:676`); trimmed. No uniqueness, no length limit | Toast "Folder created" / "Failed to create folder" |
| Manage Folders | Toggle button | Reveal rename/delete icons on folder headers | `:632-637` toggles `isManageFoldersMode` | none | — | — |
| Select Multiple | Button | Enter multi-select to batch-move | `:638-642` | none | Shown only if `documents.length > 1` (counts hidden docs too) | — |
| Cancel (multi-select) | Button | Leave multi-select | `:612-614` clears selection | none | — | — |
| Move (n) | Button → Dialog | Move selected docs to a folder | `:615-621` opens Batch Move dialog | see Batch Move | Disabled when 0 selected | — |
| Folder header (click) | Button | Expand/collapse folder | `toggleFolder` `:399-403` | none (state only, reset on every reload) | — | — |
| Folder drop target | Drag target | Move a dragged document into this folder | `handleDragOver/Drop` `:383-391` → `handleMoveDocToFolder` `:347-359` | UPDATE `project_documents.folder_id` | Only for internal drags (`draggedDocId` set by `renderDocRow`). **OS file drops are accepted (`preventDefault`) and silently ignored** — no drag-drop upload | Toast "Document moved" / "Failed to move document" |
| Upload icon (Handover header only) | Icon button | Upload straight into Handover folder | `:520-532` sets target = handover folder id, clicks input | as Upload, with `folder_id` = handover folder | **Not** disabled during an upload in progress | as Upload |
| Rename folder (pencil, Manage mode) | Icon → Dialog | Rename folder | `:535-545` → `handleRenameFolder` `:273-287` | UPDATE `project_document_folders.name` | Rename disabled if blank (`:695`). Applies to Uncategorized and Handover too — renaming Handover **removes the checklist view** (D3) | Toast "Folder renamed" / "Failed to rename folder" |
| Delete folder (trash, Manage mode) | Icon → AlertDialog | Delete folder, keep docs | `:546-555` → `handleDeleteFolder` `:289-307` | UPDATE docs `folder_id=null` (error unchecked) then DELETE folder (FK is also `ON DELETE SET NULL`) | Confirm copy "Documents … moved to Uncategorized" (`:705`) — **false**: they go to `null`, which is hidden (D1). Allowed on Handover folder | Toast "Folder deleted" / "Failed to delete folder" |

**Control inventory — document row (non-Handover folders)** (`renderDocRow`, `:417-493`)

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error & empty |
|---|---|---|---|---|---|---|
| Row | Draggable div | Drag to another folder | `:423-425` `handleDragStart/End` | — | Uses React state only, no `dataTransfer.setData` → drag may not start in Firefox | — |
| Checkbox | Checkbox (multi-select mode only) | Select for batch move | `toggleSelection` `:393-397` | — | — | — |
| File icon | Display | Type by MIME | `getFileIcon` `:70-79` (image / pdf / spreadsheet-excel-csv / zip-archive / other) | `mime_type` | — | Null MIME → generic icon |
| Name + "size • dd MMM yyyy" | Display | — | `:434-438`, `formatFileSize` `:63-68` | `name, file_size, created_at` | — | Null/0 size → "—" |
| ⋮ menu trigger | Icon button | Row actions | `:440-445` | — | **`opacity-0 group-hover:opacity-100` → invisible on touch devices; unreachable on tablets** | — |
| Download | Menu item | Open/download file | `handleDownload` `:242-254` | `storage.createSignedUrl(file_path, 60)` then `window.open(url,'_blank')` | Returns silently if `file_path` null (ghost rows) | Toast "Failed to download file". Opens inline (browser previews PDF/images); filename is the **original** upload name, not the renamed one. `window.open` after `await` can be popup-blocked (Safari) |
| Rename | Menu item → Dialog | Rename display name | `:450-456` → `handleRenameDoc` `:310-324` | UPDATE `project_documents.name` only (storage key unchanged) | Disabled if blank (`:724`); no extension protection | Toast "Document renamed" / "Failed to rename document" |
| Move to Folder › Uncategorized | Submenu item | Remove folder assignment | `:463-468` → `handleMoveDocToFolder(id,null)` | UPDATE `folder_id=null` | Disabled if already null | **Moves doc to invisible null bucket (D1).** Also appears **alongside** the seeded folder named "Uncategorized" → two identically-named targets |
| Move to Folder › {folder} | Submenu items | Move | `:470-479` | UPDATE `folder_id` | Disabled for current folder | Toast |
| Delete | Menu item → AlertDialog | Permanently delete | `:484-489` → `handleDeleteDoc` `:326-344` | `storage.remove([file_path])` (**result ignored**) then DELETE `project_documents` (links cascade) | Confirm dialog | Toast "Document deleted" / "Failed to delete document". If DB delete fails after storage removal → row with dead file_path |

**Dialogs** — New Folder (`:671-683`), Rename Folder (`:686-698`), Delete Folder (`:701-712`), Rename Document (`:715-727`), Delete Document (`:730-741`), Batch Move (`:744-764`: Select with "Uncategorized" (=null) + every folder; default `'uncategorized'`, state **not** reset between openings; Move button never disabled; handler `handleBatchMove` `:361-378` does one `UPDATE … IN (ids)`; toast "Moved N document(s)").

---

### C.2 View: HandoverChecklist (renders inside the "Handover Documentation" folder)

**Purpose.** Evidence tracker for solar PV handover: a list of required deliverables ("requirements") on the left, the Handover folder's files on the right; the user drags files onto requirements to mark them fulfilled. Progress bar = % of requirements with ≥1 linked file.

**How it is selected.** A folder is the handover folder iff `folder.name === 'Handover Documentation'` — exact, case-sensitive string (`ProjectDocuments.tsx:59`, `:405-407`). Any folder with that name renders a checklist (two such folders → two identical checklists over the same project rows).

**Props** (`HandoverChecklist.tsx:45-51`): `projectId`, `folderDocuments` (docs in *this* folder only), `onRefresh` (**never called**), `onDownload`, `onUpload`.

**Load** (`fetchChecklist`, `:98-145`): (1) `syncTemplates()`; (2) select `handover_checklist_items(id,label,sort_order,template_id)` by `sort_order`; (3) select `checklist_document_links(id,checklist_item_id,document_id)` for those items; (4) resolve each link's name/path **only against `folderDocuments`** — a linked doc not in this folder shows "Unknown file" with no path (download then no-ops). Errors are only `console.error`ed — no user-visible error state (`:140-142`). `isLoading` is set but **never rendered** (no spinner, no empty state for zero requirements).

⚠ `fetchChecklist` is a `useCallback` depending on `folderDocuments`, which the parent recreates with `.filter()` on every render (`ProjectDocuments.tsx:411-414`), so the effect at `:185-187` **re-runs (and re-syncs templates) on every parent re-render** — e.g. opening any dialog, toggling a folder, entering Manage mode. Concurrent runs of `syncTemplates` can insert duplicate template-backed rows (no unique constraint). Migration `20260210064935` (a one-off dedupe of label duplicates) is evidence duplicates already happened.

**Template sync** (`syncTemplates`, `:148-183`) — the "template application" semantics:
1. Look up the group **by name** `'Solar PV Handover'` (`:150-154`) — not by its seeded fixed id `a0000000-0000-0000-0000-000000000001` (`20260210065454:19-20`). Renaming that group (no UI for it, but RLS allows it) silently stops all syncing. **Any other template group created in Settings is never applied to any project.**
2. Load all templates in that group; load all `template_id`s already on this project's items.
3. Insert every template not yet represented (label, template_id, template sort_order). Insert errors ignored.
4. Additive only: template label edits are never propagated (no edit UI exists anyway); template removal is not propagated; project-level deletion of a template-backed requirement is **undone on the next load** (the template id is no longer present → re-inserted). There is no tombstone.

**Layout.** Progress row "X of Y requirements fulfilled · NN%" + bar (`:292-303`); resizable split (min height 400 px): left 35 % "Requirements", right 65 % "Files" (`:306-463`); Remove-Requirement AlertDialog (`:466-479`).

**Control inventory**

| Control | Type | What it's for | Handler → effect | Data | Validation / disabled | Error & empty |
|---|---|---|---|---|---|---|
| Progress bar + counter | Display | Completion % | `:286-288` `round(items with ≥1 link / items × 100)`, 0 if no items | derived | — | "0 of 0 … 0%" when no items |
| Manage Template | Ghost button | Edit the global template | `:313-320` `navigate('/settings?tab=templates')` | — | No role check | Leaves the project page |
| Requirement row | Drop target | Assign a file by dropping it | `:326-334` → `handleDrop` `:271-278` reads `dataTransfer 'text/plain'` → `handleAssignFile` `:190-207` | INSERT `checklist_document_links(checklist_item_id, document_id)` | Duplicate → 23505 → toast.info "File already assigned to this requirement" | Toast "File assigned" / "Failed to assign file". Drops from non-handover folder rows carry no `text/plain` → nothing here, but the event bubbles to the folder and **moves** that doc into the Handover folder |
| Status circle | Display | Fulfilled indicator | `:336-342` check if ≥1 link | — | — | Empty circle + hint "Drag files here to assign" (`:380-384`) |
| Remove requirement (trash) | Icon → AlertDialog | Delete a requirement | `:344-352` → `handleDeleteRequirement` `:245-259` | DELETE `handover_checklist_items` (links cascade) | **Class `opacity-0 group-hover:opacity-100` with no `group` ancestor → permanently invisible** (still clickable if you find it). Template-backed items **reappear on next load** | Toast "Requirement removed" / "Failed to remove requirement" |
| Linked file name | Link button | Open the evidence file | `:360-365` → `onDownload` (parent signed-URL) | storage signed URL | No-op if doc not in folder ("Unknown file") | — |
| Unlink | Icon button (hover) | Remove the file from the requirement | `:366-374` → `handleUnlink` `:210-221` | DELETE `checklist_document_links` by id | No confirm; no success toast | Toast "Failed to unlink file" |
| Add Requirement | Ghost button → inline input | Add a project-only requirement | `:404-406` → input `:392-399` → `handleAddRequirement` `:224-242` | INSERT `handover_checklist_items(project_id,label,sort_order=items.length)` (template_id null) | Add disabled if blank; Enter submits; Cancel clears | Toast "Requirement added" / "Failed to add requirement". `sort_order` can collide with template sort orders |
| Files › Upload | Ghost button | Upload into Handover folder | `:420-422` → parent `onUpload` (`ProjectDocuments.tsx:567-570`) | as Upload | Not disabled during upload | Empty state "No files uploaded yet / Upload files then drag them to requirements" (`:425-430`) |
| File row | Draggable (`dataTransfer text/plain = docId`, effect `link`) | Drag onto a requirement | `handleFileDragStart` `:280-283` | — | — | — |
| File Download | Icon button | Download | `:448-455` → `onDownload` | signed URL | — | — |

**Missing in the handover view (gaps, not bugs):** handover files **cannot be renamed, deleted, moved or multi-selected** (the right pane has Download only; `renderDocRow` is not used; the parent's drag-to-folder relies on `draggedDocId`, which these rows never set). No reorder of requirements (the grip icon is on files, `:440`). No required/optional flag, no "not applicable", no due date, no reviewer sign-off, no per-item notes, no export/report of the checklist, no click-to-assign alternative to drag (touch devices cannot assign at all).

---

### C.3 View: ChecklistTemplatesCard (Settings › Templates)

Global (not per-org, not per-project) template editor. Two levels in one card.

| Control | Type | Handler → effect | Data | Notes / defects |
|---|---|---|---|---|
| New template name + Create Template | Input + button | `handleAddGroup` `ChecklistTemplatesCard.tsx:96-109` | INSERT `checklist_template_groups(name)` | Groups other than "Solar PV Handover" are **never applied** to projects (dead feature). No description input |
| Group row (click) | Table row | `openGroup` `:175-178` → `fetchItems` `:75-85` | SELECT templates by group | Shows name, description, item count (`:45-72`) |
| Group trash | Icon → confirm | `handleDeleteGroup` `:112-124` | DELETE group (cascades to templates) | **Fails with FK 23503 once any project has synced**, because `handover_checklist_items.template_id` references templates with no `ON DELETE` clause (`20260210062929:36-37`). Confirm copy "Existing project checklists are not affected" (`:393`) is misleading |
| Back arrow | Icon | `goBack` `:180-185` | — | — |
| Add requirement input + Add | Input + button | `handleAddItem` `:127-145` | INSERT `checklist_templates(label, category='Solar PV' hard-coded, sort_order=items.length, group_id)` | Appears in every project on next open (additive sync) |
| Item trash | Icon → confirm | `handleDeleteItem` `:148-161` | DELETE template | **Same FK failure** as above once synced anywhere → toast "Failed to remove item" |
| Loading / empty | Rows | `:236-247`, `:336-347` | — | "Loading...", "No items yet", "No templates yet" |

No edit/rename of groups or items, no reorder, no role gate (Settings route is only behind `ProtectedRoute`, `src/App.tsx:46,75,89`), no org scoping.

Seeded content — group `Solar PV Handover` (`20260210065454:19-20`) with 16 items (`20260210062929:17-33`), sort 0–15: COC Certificate; As-Built Drawings; Commissioning Report; O&M Manual; Warranty Documentation; Grid Connection Agreement; Grid Tie Certificate; Meter Installation Certificate; Performance Test Report; Structural Engineering Certificate; Electrical Single Line Diagram; Site Handover Certificate; Training Completion Certificate; Insurance Documentation; Environmental Compliance Certificate; Safety File.

---

### C.4 (a) Business rules

1. **Folders are flat** (no `parent_id`). Default pair seeded on first open when a project has zero folders: `Uncategorized` (0), `Handover Documentation` (1) (`ProjectDocuments.tsx:131-142`). New folders get `sort_order = current count` (`:262`); no reorder UI. `color` defaults to `#3b82f6` in the DB (`20260210061040:7`) and has no UI to change it, so every folder shows the same blue dot.
2. **"Uncategorized" has two meanings**: a real folder row and `folder_id IS NULL`. The null bucket is only displayed when no real folder is named `Uncategorized` (`:652-655`).
3. **Handover folder identity = exact name** `Handover Documentation`.
4. **Completion % = fulfilled / total × 100, rounded**; fulfilled = at least one linked document, regardless of which document, its type, or whether that file still resolves (`HandoverChecklist.tsx:286-288`). Every requirement weighs equally; nothing is "required" vs optional; 100 % triggers nothing.
5. **Template application** = additive, name-matched group, re-run on every render of the checklist; project deletions of template items do not stick (C.2).
6. **Links are many-to-many** (a requirement may have many files; a file may evidence many requirements), unique per pair (`20260210062929:40-46`).
7. **Storage path convention**: bucket `project-documents`, key `{projectId}/{documentId}/{originalFileName}` (`ProjectDocuments.tsx:214`). The document id segment makes duplicate filenames safe. The raw filename is not sanitised — characters Supabase Storage rejects cause the upload to fail and leave a ghost row (see D5). Rename never touches the key.
8. **Upload is a 3-step non-transactional sequence** per file: insert row → upload object → update row with path/size/MIME (`:207-227`). Files are processed sequentially; the first failure aborts the rest, earlier files remain.

### C.5 (b) Data model

| Table | Columns (type) | Keys / cascades | RLS |
|---|---|---|---|
| `project_document_folders` (`20260210061040:3-11`) | id uuid PK; project_id uuid NN; name text NN; color text default '#3b82f6'; sort_order int default 0; created_at, updated_at timestamptz | project_id → projects **ON DELETE CASCADE** | 4 policies `USING (true)` / `WITH CHECK (true)`, no `TO` role → **anon included** (`:15-18`) |
| `project_documents` (`:21-32`) | id uuid PK; project_id uuid NN; folder_id uuid; name text NN; file_path text; file_size bigint; mime_type text; uploaded_by uuid (**never written by this tab**); created_at, updated_at | project_id → projects CASCADE; folder_id → folders **ON DELETE SET NULL** | same open policies (`:36-39`) |
| `handover_checklist_items` (`20260210062036:3-10` + `20260210062929:36-37,58`) | id uuid PK; project_id uuid NN; label text NN; sort_order int NN default 0; template_id uuid; created_at | project_id → projects CASCADE; template_id → checklist_templates **no ON DELETE (RESTRICT)**; index on project_id (`:22`). The original `document_id` column was migrated into links and dropped | open policies (`20260210062036:16-19`) |
| `checklist_document_links` (`20260210062929:40-46`) | id uuid PK; checklist_item_id uuid NN; document_id uuid NN; created_at | both FKs **ON DELETE CASCADE**; `UNIQUE(checklist_item_id, document_id)` | `FOR ALL USING (true) WITH CHECK (true)` (`:50-51`) |
| `checklist_templates` (`20260210062929:3-9` + `20260210065454:23-29`) | id uuid PK; label text NN; category text NN default 'Solar PV' (unused by UI logic); sort_order int NN; created_at; group_id uuid NN | group_id → groups **ON DELETE CASCADE** | `FOR ALL USING (true) WITH CHECK (true)` (`:13-14`) |
| `checklist_template_groups` (`20260210065454:3-8`) | id uuid PK; name text NN; description text; created_at | — | SELECT public; `FOR ALL TO authenticated USING(true)` (`:12-16`) |

- No `updated_at` triggers exist for these tables (the migration defines none); rename/move never bumps `updated_at`, which the UI does not show anyway.
- No `org_id` on any of these tables. Projects became org-scoped on 2026-03-18 (`20260318090000_add_organizations_and_user_invites.sql:35-36,153-185`) but documents and checklist rows were not.
- No unique constraints on folder name per project, on `(project_id, template_id)`, or on `(project_id, label)`.
- **Storage bucket** `project-documents`, `public = false`, no `file_size_limit`, no `allowed_mime_types` (`20260210061040:42`). Four `storage.objects` policies keyed only on `bucket_id = 'project-documents'` (`:45-48`) — despite being *named* "Authenticated users can …", they have **no `TO authenticated`**, so the anon role may SELECT/INSERT/UPDATE/DELETE every object. Effective size cap = the Supabase project's global upload limit (not set in repo).
- **Orphan storage objects** arise when: a project is deleted (DB cascade, no storage cleanup); `storage.remove` fails silently during document delete; `replicate-to-external` copies rows but not objects (below). **Orphan rows** (file_path NULL) arise when the upload step fails after the insert.
- `schema-dump.sql` (a hand-written DDL for a second instance, `schema-dump.sql:1-4`) diverges: no `ON DELETE` clauses (`:496-520`, `:634-650`), `file_size integer` not bigint, **no UNIQUE on links** — so on that instance duplicate links are possible and the 23505 handling is dead. `replicate-to-external` (`supabase/functions/replicate-to-external/index.ts:14-15,41-42,52-53`) upserts all these tables to `TARGET_SUPABASE_URL` using service-role keys (`:93-96`) but copies **no storage objects**, so every `file_path` on the target is dangling.

### C.6 (c) External services, keys, edge functions

**None are used by the Documents tab.** Everything goes browser → Supabase (PostgREST + Storage) with the user's session / anon key.

`supabase/functions/dropbox-proxy/index.ts` (51 lines) — **dead code (no caller).**
- Accepts POST JSON `{ action, path = "", access_token }` (`:13`). Only `action = "list_folder"` (`:15-20`); requires `access_token` (`:22-27`).
- Calls `https://api.dropboxapi.com/2/files/list_folder` with `Bearer {access_token}`, `recursive:false, limit:100` (`:29-36`); returns Dropbox's body and status verbatim (`:38-43`). No pagination (`list_folder/continue` never called).
- **Token model: the caller's own Dropbox token, supplied from the browser in the request body.** No Dropbox app key/secret, no OAuth flow, no token storage, no env secrets. Anyone holding a token could call Dropbox directly; the proxy only works around CORS.
- Auth: not in `config.toml`, so gateway `verify_jwt` defaults to true; the public anon key satisfies it — effectively unauthenticated. No own auth check.
- SSRF: none (host fixed; `path` is only a Dropbox path argument). Path traversal: n/a. CORS `*` (`:1-5`). Error bodies echo `err.message` (`:45-48`).

`supabase/functions/fetch-project-files/index.ts` (71 lines) — **stub, dead code.** Accepts `{ filePaths: string[] }` (`:20-27`) and returns placeholder text per path (`:49`) — reads no file, no GitHub, no storage. Reads `VITE_SUPABASE_PROJECT_ID` with hard-coded fallback `"zhhcwtftckdwfoactkea"` (`:31`) but never uses it. "Sanitises" by stripping `..` and a leading `/` (`:45`) — irrelevant since nothing is read. CORS `*`. Not in `config.toml` → `verify_jwt` defaults true (the brief's premise that it is `false` is incorrect).

`fetch-github-files` (`verify_jwt = false`, `config.toml:54-55`) — belongs to the code-review tool, not reachable from Documents; out of scope.

No Google integration exists in this tab.

### C.7 (d) Defects, gaps, hard-coded values, security

**Critical / security**
- **S1 — Every document in every project is world-readable and world-writable.** Table policies are `USING (true)` with no role on all four document/checklist tables and templates (`20260210061040:15-18,36-39`; `20260210062036:16-19`; `20260210062929:13-14,50-51`). Storage policies are bucket-only with no role (`20260210061040:45-48`). The anon key ships in the browser bundle, so an unauthenticated caller can list every project's documents, mint signed URLs / download every file, overwrite objects, and delete everything — across all organisations. `ProtectedRoute` (`src/App.tsx:46`) is UI-only.
- **S2 — No org / project-membership scoping** anywhere; templates are global and editable by any signed-in user (and via RLS by anon).
- S3 — Storage key has no org segment and contains the raw user filename.

**High — data appears lost**
- **D1 — Uploaded files vanish.** Toolbar "Upload Files" uses `folder_id = null` (`ProjectDocuments.tsx:625`, `:209`); the null bucket is hidden whenever a folder named "Uncategorized" exists (`:652-655`), which auto-seed guarantees (`:133-135`). Same for Move › Uncategorized (`:464`), batch move default (`:109`, `:363`), and folder delete (`:292-295`, whose confirm text promises "moved to Uncategorized", `:705`). Files are stored and counted (`documents.length`) but cannot be seen, downloaded, moved or deleted in the UI. Only files uploaded via the Handover-folder buttons are visible.
- **D2 — Handover files are stuck**: no rename/delete/move/select in the handover pane (C.2).
- **D3 — Handover feature keyed on a mutable name**: renaming or deleting "Handover Documentation" removes the checklist (and, on delete, hides its files via D1); it is never re-seeded because folders.length > 0.
- **D4 — Template-backed requirements cannot be removed** (resurrected by sync, `HandoverChecklist.tsx:170-181`), and the remove button is invisible (`:347`, no `group` ancestor).
- **D5 — Non-atomic upload** (`ProjectDocuments.tsx:207-227`): failure after insert leaves a ghost row (size "—", download silently does nothing); partial multi-file failure reports only "Failed to upload files". No client size/type check.
- **D6 — Template deletion blocked by FK** once synced (`20260210062929:36-37`); Settings says the opposite.
- **D7 — Re-sync storm / duplicates**: `fetchChecklist` re-runs on every parent render (C.2); plus parent `fetchData` remounts the child after every mutation. No unique `(project_id, template_id)`.

**Medium / UX**
- D8 Row action menu invisible on touch (hover-only, `:442`); requirement assignment is drag-only → **the checklist is unusable on tablets/phones**.
- D9 OS drag-and-drop onto a folder is swallowed silently (`:383-391`).
- D10 Every mutation shows a full-tab spinner and re-expands all folders (`:145`, `:190-192`).
- D11 Duplicate "Uncategorized" targets in Move menus (`:463-479`, `:753-756`).
- D12 Download: 60 s signed URL; inline, original filename; possible popup block (`:245-249`).
- D13 Linked docs resolved only within the Handover folder → "Unknown file" if not found (`HandoverChecklist.tsx:128-133`); still counted as fulfilled.
- D14 Errors in the checklist load are console-only; `isLoading` unrendered; `onRefresh` prop unused.
- D15 `uploaded_by` never set; no audit of who uploaded/linked/removed.
- D16 Documents tab status is hard-coded "pending" (`ProjectDetail.tsx:1182-1185`).
- D17 Concurrent first-open seeds duplicate folders (`:131-142`, no unique constraint).

**Hard-coded values**: `'Handover Documentation'` (`ProjectDocuments.tsx:59`); `'Uncategorized'` (`:135`, `:653`); `'Solar PV Handover'` group name (`HandoverChecklist.tsx:153`); group id `a0000000-0000-0000-0000-000000000001` (`20260210065454:20`); category `'Solar PV'` (`ChecklistTemplatesCard.tsx:134`); signed-URL TTL 60 s (`ProjectDocuments.tsx:247`); bucket `project-documents`; `/settings?tab=templates` (`HandoverChecklist.tsx:317`); Dropbox `limit: 100` (`dropbox-proxy/index.ts:35`); project ref fallback `zhhcwtftckdwfoactkea` (`fetch-project-files/index.ts:31`).

**Stubs / dead code**: `dropbox-proxy` (no caller), `fetch-project-files` (placeholder output), non-"Solar PV Handover" template groups (never applied), `HandoverChecklist` `onRefresh` prop, `DocumentFolder.color` (no editor), `checklist_templates.category` (never read for logic), empty-state card (unreachable after seed).

### C.8 (e) Upstream / downstream

- **Consumes:** only `projectId` from the route (`ProjectDetail.tsx:1438`) and the global handover template. No simulation, proposal, tariff or schedule data is read.
- **Produces:** nothing consumed by other tabs. Repo-wide grep shows `project_documents`, the folders, checklist items and links are referenced only by `ProjectDocuments.tsx`, `HandoverChecklist.tsx`, `ChecklistTemplatesCard.tsx`, `types.ts` and `replicate-to-external`. Proposals, the monthly report and generation tabs do **not** attach or read documents; the checklist does not feed any report or PDF. (`uploaded_by` is written in `SchematicsTab.tsx:167,215`, but that is a different table.)
- Side channel: `replicate-to-external` mirrors the rows (not the files) to another Supabase instance.

### C.9 (f) Mapping onto E-Site

**Duplicate of what E-Site already has — do not rebuild:** folder CRUD, upload/download, rename/move/delete, storage bucket + signed URLs, cloud sync (E-Site's Dropbox cloud-sync is far more capable than a dead list-folder proxy). The Solar add-on should use E-Site's documents module for every file and add **no** new bucket and **no** `project_documents` clone. Drop `dropbox-proxy` and `fetch-project-files` entirely.

**Genuinely solar-specific — worth porting, redesigned:** the **Handover checklist**: a template of required handover deliverables → per-project requirements → many-to-many evidence links to documents → completion %. Recommended shape for the rebuild (fixing D3/D4/D6/D7/D13):
- Template groups/items scoped per **organisation** (not global), gated to owner/admin, with edit and reorder; a group chosen explicitly per project (or by project type), keyed by **id**, never by name.
- Per-project items: `UNIQUE (project_id, template_item_id)`; `template_item_id` FK `ON DELETE SET NULL`; a removal is a soft flag (`is_removed` / `not_applicable` with reason) so sync never resurrects it; sync is an explicit, idempotent server action, not a render side-effect.
- Add `is_required`, `not_applicable`, reviewer/approved-by + timestamp, notes; completion % = satisfied required items (N/A excluded); surface it as the tab status and in a handover report/PDF using E-Site's existing report + email machinery.
- Links reference E-Site document ids from **any** folder (not a magic folder), with click-to-assign as well as drag (touch). Record `linked_by/linked_at`. Consider pinning the linked document **version/revision**: if E-Site's cloud sync can swap the underlying file of a document row, evidence attached to a handover item would silently change — decide whether links follow the latest revision or freeze the one reviewed.
- RLS on every new table through E-Site's project-access helpers (with role-aware write gates and a SELECT policy that is not narrower than intended), unlike the `USING (true)` model here.

Seed content worth carrying over: the 16 Solar PV handover items listed in C.3.


## Part D — Generation tab

**Mount point:** `src/pages/ProjectDetail.tsx:1441-1443` → `<GenerationTab projectId={id!} />`. Tab trigger `ProjectDetail.tsx:1299-1302` (icon TrendingUp, label "Generation"). Tab status is hard-coded `"pending"` with tooltip "Track plant generation performance" (`ProjectDetail.tsx:1186-1189`) — it never reflects whether any data exists. The active tab is React state only (`ProjectDetail.tsx:712`), not in the URL, so a reload returns to Overview and no deep link to this tab exists.

**Purpose (user terms):** after a plant is commissioned, track what it actually generated each month against the contractual yield guarantee. Also compare against the council/utility meter ("Council Demand"), estimate energy lost to downtime, value the result in Rand, and log a comment for each day. This tab is also the only data source for the Monthly Report tab (Part E).

**Files:** `src/components/projects/generation/` — `GenerationTab.tsx` (155), `GenerationDataCard.tsx` (372), `GuaranteedGenerationCard.tsx` (121), `SourceGuaranteesDialog.tsx` (277), `CSVPreviewDialog.tsx` (306), `LifetimePerformanceChart.tsx` (186), `PerformanceChart.tsx` (583), `PerformanceSummaryTable.tsx` (729), `DowntimeSlotCell.tsx` (83), `DowntimeCommentCell.tsx` (193), `generationUtils.ts` (47), `csvUtils.ts` (122), `index.ts`. Plus `src/hooks/useGenerationReadings.ts` (46) and edge fn `supabase/functions/upload-generation-csv/index.ts` (367).

**Dead code in this folder (flag):**
- `ActualGenerationCard.tsx` (314 lines) and `BuildingLoadCard.tsx` (322 lines) are imported by nothing. Only `csvUtils.ts` imports them, and `csvUtils.ts` is used only by those two files. They are earlier single-purpose versions of `GenerationDataCard`. Do not port them.
- `csvUtils.parseCSVFiles` is dead: the live path uses the column-mapping `CSVPreviewDialog`.
- The `upload-generation-csv` edge function has **no caller in `src/`** (the only reference is `supabase/config.toml:78`). It is an external/API ingestion endpoint; see its dedicated section below.

### D.1 Layout

Top to bottom (`GenerationTab.tsx:95-153`):
1. **Period bar:** Month select + Year select (`:97-121`).
2. **Lifetime Performance Overview:** a card that renders only if at least one `generation_records` row exists (`LifetimePerformanceChart.tsx:77`).
3. **Three-card grid** (`lg:grid-cols-3`, `:125-149`):
   - "Actual Generation (kWh)": `GenerationDataCard dataType="solar"`
   - "Guaranteed Generation (kWh)": `GuaranteedGenerationCard`
   - "Council Demand (kWh)": `GenerationDataCard dataType="council"`
4. **System Performance — {Month Year}:** the interval chart (`PerformanceChart`).
5. **System Summary — {Month Year}:** a four-sub-tab table (`PerformanceSummaryTable`) with Production, Down Time, Revenue and Performance.

### D.2 Control inventory

#### D.2.1 Period bar (`GenerationTab.tsx`)

| Control | Type | What it's for | Handler → effect | Data read/written | Validation/disabled | Error & empty states |
|---|---|---|---|---|---|---|
| Month | Select (Jan–Dec) | Choose the month to view and enter | `setSelectedMonth` `:100`; re-keys every month-scoped query | Reads `generation_records` (project, year, month) via `maybeSingle` `:64-77` | Defaults to the **previous calendar month** (`getPreviousMonth` `:41-50`; January rolls to December of the prior year) | Query error is thrown into react-query and never surfaced. With no record every card shows "—" |
| Year | Select | Choose the year | `setSelectedYear` `:110` | same | Options are hard-coded to **current year −2 … +2** (`:59`). Data older than 2 years cannot be selected here (Lifetime chart still shows it) | — |

`refetch()` (`:90-93`) invalidates only `["generation-record",…]` and `["generation-readings",…]`. It does **not** invalidate `["generation-lifetime", projectId]`, `["source-guarantees",…]` or `["chart-source-guarantees",…]`. After a CSV import or a guarantee edit, the Lifetime chart, the Production/Performance guarantees and the chart source names stay stale until those queries refetch on their own (window focus or remount). **Defect.**

#### D.2.2 Actual Generation / Council Demand card (`GenerationDataCard.tsx`, one component, `dataType` switches the target column)

`dataType="solar"` writes `actual_kwh` and `source`. `dataType="council"` writes `building_load_kwh` (`:22-27`).

| Control | Type | What it's for | Handler → effect | Data read/written | Validation/disabled | Error & empty states |
|---|---|---|---|---|---|---|
| Big number | Display | Month total kWh | `currentValue` `:26`, rendered `:352-356` (en-ZA, 2dp) | `generation_records.actual_kwh` / `.building_load_kwh` | — | "—" when null |
| "Source: …" | Display (solar only) | Where the total came from: `manual`, `csv:N`, `csv-api` or a label | `:357-361` | `generation_records.source` | — | Hidden when null |
| **Reset** | Ghost button (only when the value ≠ null) | Wipe this month's figure for this meter type | `handleReset` `:261-300` | (1) UPSERT `generation_records` {kwhField: null, source: null for solar}. (2) UPDATE `generation_daily_records` SET kwhField=null for (project, year, month). (3) UPDATE `generation_readings` SET kwhField=null where timestamp in [month start, month end 23:59:59] | **No confirmation dialog** (the guarantee reset has one). Irreversible | toast.error(message). ⚠ Rows are **nulled, not deleted**. `generation_readings` rows keep their `source`, so reading sources still show up in the guarantee-link dropdown and the chart source list. ⚠ Solar reset nulls `actual_kwh` for **every source** in the month, so per-source removal is impossible |
| **CSV** | Outline button → hidden `<input type=file accept=.csv multiple>` | Import meter interval data | `handleCSVUpload` `:234-250`: reads **only `files[0]`**, splits it into lines, opens `CSVPreviewDialog` | — (client-side read) | `multiple` is allowed, but files 2..n are **silently ignored**. `pendingFileCount = files.length`, so the `csv:N` counter over-counts (`:243`, `:93`). **Defect** | toast.error on read failure |
| **Save** | Button, shown only when `hasEdit` | Save a manually typed monthly total | `handleSave` `:37-62` → UPSERT `generation_records` on (project_id, month, year) with `actual_kwh`+`source:'manual'` (solar) or `building_load_kwh` (council) | `generation_records` | **DEAD / unreachable.** `value` is only ever set to `null` (`:29`, `:55`, `:230`, `:295`) and no `<Input>` is rendered, so `hasEdit` (`:302`) is always false. **There is no manual-entry path in the UI.** Flag as a stub | — |

**CSV import commit — `saveCSVTotals` (`:64-232`)**, run after the mapping dialog returns `totals` (month→kWh), `dailyTotals` (YYYY-MM-DD→kWh) and `readings` ({timestamp, kwh}[]):

1. **Monthly (additive):** read the existing `generation_records` for the listed months **of the tab's selected `year`** (`:66-71`). Write `newTotal = existing + csvSum` (`:80`) and batch-upsert on (project_id, month, year) (`:99-104`). For solar, set `source = "csv:" + (prevCount + fileCount)` (`:90-94`).
   - ⚠ Each month's year comes from the **tab's year selector**, not the CSV. A CSV spanning Dec 2025–Jan 2026 imported while 2026 is selected books December 2025's energy into **December 2026**.
   - ⚠ **Not idempotent.** Re-importing the same file doubles the monthly total (and the daily total, step 2). There is no dedupe and no "replace" option in the UI.
2. **Daily (additive):** read `generation_daily_records` for the date keys, add, and upsert on (project_id, date) (`:107-138`). The year and month here come from the CSV dateKey, which is correct, so monthly and daily totals can disagree about the year.
3. **Raw readings** in batches of 500 (`:141-197`). `sourceLabel` = the file name without `.csv` (`:142`), so **the file name is the meter/source identity**. Renaming a file creates a new "source".
   - **Solar:** upsert on (project_id, timestamp, source) with `actual_kwh = kwh`, `building_load_kwh = null`. Idempotent per file name.
   - **Council:** for each batch, SELECT existing readings **by timestamp for any source** (`:170-174`), then write `actual_kwh = existing.actual_kwh`, `building_load_kwh = existing.building_load_kwh + kwh`, `source = council file name`. ⚠ Because the lookup ignores source, a council row copies a *solar* row's `actual_kwh` into a new row under the council source name. The council source then counts as a solar source (`PerformanceSummaryTable.tsx:180-187` selects sources with `actual_kwh>0`) and **double-counts solar energy** unless a guarantee row with `meter_type='council'` names it. The auto-created guarantee in step 4 does, via `source_label`, which is the only thing that saves this. ⚠ Council re-import is additive (not idempotent).
   - Timestamp matching normalises fractional seconds, `Z` and offsets (`:163-164`).
4. **Auto-create guarantee placeholder:** for each affected month, if no `generation_source_guarantees` row has `source_label = file name` (fallback "csv" or "Council Supply"), insert one with `guaranteed_kwh 0` and `meter_type 'solar'|'council'` (`:199-227`). This uses the tab `year` (same cross-year defect as step 1). N+1 queries.
5. toast "Added X kWh from N file(s)" and `onDataChanged()`.

There is **no transaction**. A failure mid-way (for example in batch 3 of the readings) leaves the monthly and daily totals already incremented. A retry then double-counts.

#### D.2.3 CSV column-mapping dialog (`CSVPreviewDialog.tsx`, title "Map CSV Columns")

| Control | Type | What it's for | Handler → effect | Data | Validation/disabled | Error & empty states |
|---|---|---|---|---|---|---|
| Column header (one per column) | DropdownMenu trigger | Tell the importer what each column holds | Opens the menu `:213-236` | — | Header row = row 0, or row 1 if line 0 contains "pnpscada" or "scada" (case-insensitive) (`:88-91`). Data starts at row 1 or 2 | Nothing renders if the file has fewer than 2 lines |
| → Date | Menu item | Mark the date (or datetime) column | `assignRole(i,'date')` `:120-130`: only one column per role; reassigning removes it from the previous column | — | Required for Parse | — |
| → Value (kWh / kW) | Menu item | Mark the energy/power column | `assignRole(i,'value')` | — | Required | — |
| → Time | Menu item | Mark a separate time column (optional) | `assignRole(i,'time')` | — | Optional. Needed to detect the interval | — |
| → Clear | Menu item (only if the column has a role) | Remove the role | `clearRole` `:132-138` | — | — | — |
| Role badge | Display | Shows Date/Value/Time | `getRoleBadge` `:187-193` | — | — | — |
| Preview grid | Table | Visual check, up to 100 rows | `previewRows` `:100` | — | Highlight colours per role | — |
| "Values are in kW (convert to kWh using time interval)" | Checkbox, default **checked** | Power vs energy readings | `setIsKw` `:259-267` | — | — | ⚠ Default kW. If the user leaves it on for a kWh export, energy is halved (30-min) or scaled by the detected interval |
| Rows [start] to [stop] of N | Two number inputs | Scroll the preview window | `setStartRow/stopRow` `:268-294` | — | **Preview only**: the comment at `:96` confirms these do **not** limit what is imported. A user who narrows the range expecting a partial import gets the whole file. **Misleading control** | — |
| Cancel | Button | Abort | `onClose` | — | — | — |
| Parse → / "Parse (select columns)" / "Saving..." | Primary button | Parse and commit | `handleParse` `:140-185` → `onParsed(...)` → parent `saveCSVTotals` | see D.2.2 | Disabled until Date and Value are mapped | The dialog **always closes in `finally`** (`:181-184`), even on failure; the error surfaces only as the parent toast |

**Parsing rules (`CSVPreviewDialog.tsx`):**
- Lines split on `\n` with blanks dropped. Columns split on a **plain `,`**: no quote-aware CSV parsing, so a quoted value containing a comma shifts every column. Quotes are stripped per cell (`strip` `:40-42`). Semicolon- or tab-delimited files do not work.
- **Date:** `YYYY[-/]M[-/]D` is tried first, then `D[-/]M[-/]YYYY` (`:44-56`). `MM/DD/YYYY` (US) is **misread as DD/MM** with no warning. Rows whose date does not parse are silently skipped.
- **Time:** `H:MM[:SS]`, from the time column or else from inside the date string (`:58-67`). With no time found the timestamp becomes `T00:00:00`, so every reading of a day collides onto midnight and the upsert keeps only the last one per (timestamp, source).
- **Interval** (kW mode): the difference between the **first two data rows' time column** (`:149-157`). The default is 0.5 h when there is no time column, the difference ≤ 0, or the times span midnight. A file with a gap or an out-of-order first pair gets the wrong interval for the **whole file**. Where the datetime sits in one combined column and no Time role is mapped, the interval is always 0.5 h.
- `kwh = isKw ? raw × intervalHours : raw` (`:168`). NaN values are skipped. **Negative values are accepted** (export or reverse flow gets summed in).
- Timezone: timestamps are built as naive local strings `YYYY-MM-DDTHH:MM:SS`. The `timestamptz` column (`generation_readings.timestamp`) interprets them in the DB session zone (UTC on Supabase). The app reads them back with a regex (not `Date`), so wall-clock digits round-trip. Anything that converts through `Date` (the chart's `parseLocal` strips the offset, so it is fine) must keep the naive-wall-clock convention. **Rebuild note:** store an explicit site timezone.

#### D.2.4 Guaranteed Generation card (`GuaranteedGenerationCard.tsx`)

| Control | Type | What it's for | Handler → effect | Data | Validation/disabled | Error & empty states |
|---|---|---|---|---|---|---|
| Big number | Display | The month's guaranteed kWh (sum of the source guarantees) | `:101-105` | `generation_records.guaranteed_kwh` | — | "—" when null |
| **Reset** | Ghost button → AlertDialog "Reset Guarantee Data" (only when the value ≠ null) | Clear all guarantees for the month | `handleReset` `:24-52`: DELETE `generation_source_guarantees` for (project, month, year); UPDATE `generation_records.guaranteed_kwh = null` | both tables | Confirm dialog; disabled while running | toast.error. ⚠ Also deletes the **auto-created council placeholder rows**, which are what stop council sources being counted as solar (D.2.2 step 3) |
| **Edit** | Outline button | Open the per-source guarantee editor | `setDialogOpen(true)` | — | Always enabled | — |

#### D.2.5 "Guaranteed Generation Sources" dialog (`SourceGuaranteesDialog.tsx`)

On open, it loads `generation_source_guarantees` for (project, month, year) ordered by `created_at` (`:47-72`) and the distinct `generation_readings.source` values for the month (`:74-96`). The latter is a **non-paginated SELECT of every reading row in the month** just to find distinct sources; at 30-min × several sources this exceeds PostgREST's default 1000-row cap, so **late-alphabet or later-timestamp sources can be missing** from the dropdown. **Defect.**

| Control | Type | What it's for | Handler → effect | Data | Validation/disabled | Error & empty states |
|---|---|---|---|---|---|---|
| Source label (per row) | Text input | Human name, e.g. "Inverter 1" or "Tie-In 2" | `updateRow(i,'source_label')` | → `source_label` | All labels must be non-blank at save (`:126-131`) | toast "All source labels must be filled in" |
| kWh (per row) | Number input | Guaranteed kWh for this source this month | `updateRow(i,'guaranteed_kwh')` (blank→0, parseFloat) | → `guaranteed_kwh` | No min: **negative allowed**, NaN possible | Shows "" when 0 |
| "Link to CSV source" (per row) | Select (only if any reading sources exist) | Tie this guarantee to an uploaded meter file | `updateRow(i,'reading_source')`, "— None —" clears | → `reading_source` | A source already used by another row is disabled (`:186`, `:235`) | — |
| (no control) meter_type | — | Solar vs council | Preserved from load, default 'solar' (`:63`, `:151`) | → `meter_type` | **Cannot be edited in the UI.** A new row is always solar; only the CSV auto-insert creates council rows | — |
| Delete (trash, per row) | Icon button | Remove the row | `removeRow` | — (applied at Save) | — | — |
| **+ Add Source** | Button | Add a row | `addRow` | — | — | — |
| Total: X kWh | Display | Sum of all rows (**including council-type rows**) | `:122` | — | — | — |
| **Save** | Button | Persist | `handleSave` `:124-183`: (1) DELETE all rows for (project, month, year), (2) INSERT the current rows, (3) UPSERT `generation_records.guaranteed_kwh = total || null` | `generation_source_guarantees`, `generation_records` | Disabled while saving | toast.error. ⚠ **Delete-then-insert is not atomic**: an insert failure (for example two rows with the same label violating UNIQUE(project, month, year, source_label)) leaves the month with **zero guarantees** already deleted. ⚠ The total includes council `meter_type` rows, so a non-zero council guarantee inflates the solar yield guarantee used by Production, Revenue and the Monthly Report |

There is **no "copy guarantees from previous month"** or annual guarantee schedule. The guarantee must be re-entered every month, per source.

#### D.2.6 Lifetime Performance Overview (`LifetimePerformanceChart.tsx`)

| Control | Type | What it's for | Handler → effect | Data | Validation | Empty |
|---|---|---|---|---|---|---|
| Year filter | Select: "All" + distinct years | Restrict the chart and table to one year | `setYearFilter` `:83-93` | `generation_records` (month, year, actual_kwh, guaranteed_kwh) for the project, ordered year, month `:28-40` | — | Whole card hidden when there are no records `:77` |
| Composed chart | Recharts bars (Guaranteed blue, Actual yellow) + dashed Cumulative % line on a right axis fixed 0–120% | Month-by-month tracking vs guarantee | `:96-143` | — | ⚠ Y-axis capped at 120%, so over-performance above that is clipped | — |
| Transposed table | Rows Guarantee / Production / Monthly % / Cumulative % × month columns | Exact numbers | `:145-182` | — | — | — |

**Formulas (`:47-73`):** `monthPct = actual/guaranteed×100` (0 if guaranteed=0), `cumPct = Σactual/Σguaranteed×100` running across the filtered months, both rounded to 1 dp. Null is treated as 0. Months with no row are **absent, not zero**, so gaps are invisible. The `monthPct` series is computed but **not plotted**, only tabled.

#### D.2.7 System Performance chart (`PerformanceChart.tsx`)

It reads readings through `useGenerationReadings` (paginated 1000/page over `generation_readings` for the month, `useGenerationReadings.ts:16-45`, disabled in the "monthly" timeframe) and the source guarantees (`:73-85`) for display names.

| Control | Type | What it's for | Handler → effect | Validation | Error/empty |
|---|---|---|---|---|---|
| **Sources** | Toggle button | Split solar into one stacked series per meter file | `setShowSources` `:364-371` | — | — |
| **Building** | Toggle button | **Stack** Council Demand on top of solar (the label is misleading: it does not show or hide building load) | `setStackBars` `:372-379` | — | — |
| **kWh / kW** | Toggle button | Show energy or average power | `setDisplayUnit` `:380-387`. kW divisor: 30min 0.5, hourly 1, daily 24, monthly days×24 (`:255-257`) | — | — |
| All Hours / Sun Hours | ToggleGroup | Restrict to 06:00–17:30 | `setHoursFilter` `:388-391`. `isSunHour`: 360 ≤ minute-of-day ≤ 1050 (`:60-64`) | — | — |
| Timeframe | Select: 30 Min / Hourly / Daily (default) / Monthly | Aggregation | `setTimeframe` `:392-402`. Monthly uses `generation_records` totals only (`:161-167`) | — | — |
| From / To | Date inputs | Zoom into a date range within the month | `setDateStart/End` `:405-427`, clamped by min/max; reset on month change (`:49-53`) | min/max enforce ordering | — |
| ◀ / ▶ | Icon buttons | Page the date window by its own length | `:429-464` (uses `toISOString`, so dates can shift by one day in negative-UTC-offset browsers; SA is UTC+2, so OK) | Disabled at month edges | — |
| Legend items (custom, under the chart) | Clickable spans + tooltip showing the raw source name | Hide/show a series | `setHiddenSeries` toggles `:536-574` | — | — |
| Recharts `<Legend>` | — | — | `{false && <Legend …/>}` `:480` — **dead code** | — | — |
| Empty state | — | — | "Upload CSV data to see the performance chart" when no series > 0 (`:468-471`) | — | — |

**Guarantee line (`:58`, `:242-253`):** `dailyGuarantee = guaranteed_kwh / daysInMonth`. Hourly = daily / (24 or 11.5 sun-hours). 30-min = daily / (48 or **23** sun-hour intervals). Monthly = the monthly guarantee. This is a flat line: the guarantee is spread **uniformly across all hours including night** in "All Hours" mode, which is physically meaningless for PV. **Inconsistency:** the chart uses 23 sun-hour slots while the summary table uses 24 (`(1050−360)/30+1`).

The Y-axis max is computed from the whole-month buckets ×1.05 (`:270-327`), so the scale does not jump while paging.

#### D.2.8 System Summary table (`PerformanceSummaryTable.tsx`), four sub-tabs as plain buttons (`:433-448`)

Data sources: `downtime_comments` for the month (`:56-72`); distinct past comments for the project (`:75-87`, non-paginated, feeds autocomplete); `downtime_slot_overrides` for the month (`:90-106`); readings (shared cache); `generation_source_guarantees` (`:123-135`); tariff rate (`:138-167`); `monthData.guaranteed_kwh` from the parent.

| Sub-tab / control | Type | What it's for | Handler → effect | Data | Validation | Error/empty |
|---|---|---|---|---|---|---|
| **Production** | Table: Days · Yield Guarantee · Metered Generation · Down Time kWh (06:00–17:30) · Theoretical Generation · Surplus/Deficit + Total footer | Daily performance vs guarantee | `:452-496` | computed | — | Rows always 1..daysInMonth with zeros; negative surplus in red |
| **Down Time** | Table: Days · total Lost Production (kWh), then per source {Lost Production kWh, 30-Min Intervals (editable)} · Comment | Log and adjust downtime | `:499-596` | — | Header text says **"06:00–18:00"** while the calculation window is 06:00–17:30: **label inconsistency**. The column is labelled "30-Min Intervals" even when the detected interval is 15 or 60 min | — |
| ↳ ▲ / ▼ (per day × source) | Tiny icon buttons (`DowntimeSlotCell`) | Manually correct the number of downtime slots | `handleClick(±1)` → `persist` UPSERT `downtime_slot_overrides` on (project_id, year, month, day, reading_source) `DowntimeSlotCell.tsx:34-56` | `downtime_slot_overrides.slot_override` | Floor 0, no ceiling | ⚠ **No error handling**: the supabase error is ignored and the UI shows the optimistic value. ⚠ **No way to remove an override** and revert to the calculated value (no DELETE path). The override is shown bold/primary. Every click is a DB write (no debounce) |
| ↳ Comment (per day) | Text input with ghost-text autocomplete + ▼ popover of past comments (`DowntimeCommentCell`) | Explain the downtime ("Grid outage", "Inverter 2 fault") | Blur, or Enter/Tab accepting a suggestion → `save` `DowntimeCommentCell.tsx:45-68`: blank → DELETE the row; else UPSERT on (project_id, year, month, day) | `downtime_comments.comment` | Trimmed. Case-insensitive prefix match for suggestions. ↑/↓ cycle, Esc resets | ⚠ Errors ignored. ⚠ **One comment per day, not per source.** ⚠ **Stale-state bug:** `useState(initialValue)` is never re-synced, and cells are keyed by `row.day`, so after switching month the inputs keep the **previous month's text** and `lastSaved` ref. If comments load after first render the cell shows empty |
| **Revenue** | Table: Days · Yield Guarantee (R) · Metered Generation (R) · Down Time (R) · Theoretical Gen (R) · Guaranteed Gen Actual (R) | Rand value of each | `:599-653` | tariff rate | `overProd`/`totalOverProd` computed but **unused** (`:615`, `:633`) | ⚠ With no tariff or no energy rate, rate = 0 and every cell reads "R 0.00" with **no warning** |
| **Performance** | Table per source: {Yield Guarantee, Metered Gen}, colour-coded | Per-meter daily performance | `:656-725` | — | Colour bands: ratio >1 green, >0.95 yellow, >0.5 red, **≤0.5 grey (muted)**. The worst performance gets the most neutral colour: **inverted severity** | — |

### D.3 Calculations & business rules (formulas)

All from `PerformanceSummaryTable.tsx:171-392`. This logic is **duplicated verbatim** in `src/utils/monthlyReportData.ts:139-393` for the Monthly Report; the two copies must be kept in lock-step, and any rebuild should have one shared implementation.

1. **Solar source set.** A source is any `generation_readings.source` with at least one row where `actual_kwh > 0` (`:180-187`), minus every source named by a `meter_type='council'` guarantee (by `reading_source` or `source_label`) (`:190-204`).
2. **Guarantee per source (3-tier fallback)** (`:207-247`):
   - (a) Explicit: a solar guarantee row with `reading_source` ∈ set → `guaranteeMap[reading_source] = guaranteed_kwh`, display name = `source_label`.
   - (b) Only if (a) mapped zero: a row whose `source_label` equals a source name.
   - (c) Only if both mapped zero: **evenly split** Σ(solar guarantees) across all solar sources. The display names are assigned by array index, so the pairing is arbitrary.
   - Partial mapping is not mixed: if even one row maps under (a), every unmapped source gets guarantee 0.
3. **Daily per-source guarantee** = `guarantee / daysInMonth` (a flat daily share; ignores seasonality within the month and days of partial commissioning).
4. **Interval detection** = the timestamp difference between the first two readings of the month across all sources (`:256-263`). Accepted if 0 < Δ ≤ 2 h, else 0.5 h. Two sources sharing a timestamp → Δ = 0 → default 0.5 h.
5. **Sun window** = 06:00 (360 min) to 17:30 (1050 min) inclusive. `sunHourSlots = (1050−360)/(interval×60) + 1` → 24 at 30-min, 47 at 15-min, 12.5 at 60-min (a non-integer at 60 min, while the loop visits 12 slots). The window is **hard-coded** and ignores latitude and season (SA winter sunrise is around 07:00, so 06:00–07:00 slots are flagged as downtime every winter morning unless the meter shows > threshold).
6. **Per-slot expected energy** `perSlotEnergy = (sourceGuarantee/daysInMonth)/sunHourSlots`: a **flat** expectation, so a zero reading at 06:00 is valued the same as one at noon.
7. **Downtime slot test:** `actual < perSlotEnergy × 0.0005` (0.05% threshold, effectively "zero") (`:320`). A **missing reading counts as 0**, so data gaps are booked as downtime. A slot counts only if at least one **adjacent** slot is also below threshold (`:325-339`), so isolated single zeros are ignored.
8. **Downtime energy** per counted slot = `perSlotEnergy − actual` (`:335`).
9. **Overrides** (`:344-366`): for a (day, source) with an override `n`, set `downtimeSlots = n` and `downtimeEnergy = n × perSlotEnergy`, adjusting the day totals by the delta.
10. **Daily rows:** `metered = Σ actual_kwh (solar sources only)`. `theoretical = metered + downtimeEnergy`. `yieldGuarantee = generation_records.guaranteed_kwh / days` (**the monthly record total, not Σ source guarantees**; these differ when council rows carry kWh). `surplusDeficit = metered − yieldGuarantee` (`:368-385`).
11. **Revenue:** every kWh column × a **single flat rate** (`:138-167`, `:620-625`). "Guaranteed Gen Actual (R)" = (metered − guarantee) × rate. **Rate lookup:** `projects.tariff_id` → `tariff_rates` WHERE `tariff_plan_id = tariff_id AND charge='energy'`. The first row with tou='all' & season='all' is taken, else tou='all' & season high/low (**whichever comes first, so the high/low season choice is arbitrary**), else the first row. Unit starting with "c" → /100 (default unit assumed c/kWh). ⚠ **TOU, seasonality, VAT, demand/network charges and escalation are all ignored**, so the Rand figures for a TOU customer are materially wrong.
12. **Performance colour** ratio = actual/guarantee per source/day (see D.2.8).

**Not computed anywhere (gaps an expert would expect):** Performance Ratio (PR = E_ac / (G_poa × P_stc)); specific yield (kWh/kWp); irradiance-normalised or weather-corrected guarantee; availability %; degradation-adjusted guarantee; year-to-date totals; self-consumption vs export; CO₂. Nothing links actual generation to the simulation's predicted monthly yield (`generation_records.expected_kwh` exists in the schema but **nothing writes or reads it**).

### D.4 Data model (generation)

| Table | Columns | Keys / constraints | RLS (as migrated) | Written by |
|---|---|---|---|---|
| `generation_records` (mig `20260210073125`, +`building_load_kwh` `20260210073913`) | id, project_id → projects ON DELETE CASCADE, month int CHECK 1–12, year int, actual_kwh numeric, guaranteed_kwh numeric, **expected_kwh numeric (unused)**, building_load_kwh numeric, source text DEFAULT 'manual', created_at, updated_at (trigger) | UNIQUE(project_id, month, year) | SELECT/INSERT/UPDATE/DELETE `auth.role()='authenticated'`: **any signed-in user, any project** | GenerationDataCard, SourceGuaranteesDialog, GuaranteedGenerationCard, upload-generation-csv |
| `generation_daily_records` (`20260211083806`) | id, project_id FK CASCADE, date date, year, month, actual_kwh, building_load_kwh, source, created_at | UNIQUE INDEX (project_id, date) | authenticated-any | GenerationDataCard, edge fn. **Read by nothing in the UI** (write-only table) |
| `generation_readings` (`20260211085115`, index changed `20260211132111`) | id, project_id FK CASCADE, timestamp timestamptz, actual_kwh, building_load_kwh, source text DEFAULT 'csv', created_at | UNIQUE INDEX (project_id, timestamp, source) | authenticated-any | GenerationDataCard, edge fn |
| `generation_source_guarantees` (`20260211125117`, +meter_type `20260213124453`, +reading_source `20260213130753`) | id, project_id FK CASCADE, month, year, source_label text NOT NULL, guaranteed_kwh numeric NOT NULL DEFAULT 0, meter_type text NOT NULL DEFAULT 'solar' (no CHECK), reading_source text, created_at, updated_at | UNIQUE(project_id, month, year, source_label) | authenticated-any | SourceGuaranteesDialog, GenerationDataCard, edge fn |
| `downtime_comments` (`20260216053225`) | id, **project_id TEXT (no FK)**, year, month, day, comment text NOT NULL DEFAULT '', created_at | UNIQUE(project_id, year, month, day) | **`USING (true)` for all four verbs: readable and writable by the anon key** | DowntimeCommentCell |
| `downtime_slot_overrides` (`20260216053639`) | id, **project_id text (no FK)**, year, month, day, reading_source text, slot_override int, created_at | UNIQUE(project_id, year, month, day, reading_source) | **`USING (true)`, anon read/write** | DowntimeSlotCell |

Neither `downtime_*` table has `updated_at` or an author column, so there is no audit trail of who changed a downtime figure that feeds a contractual guarantee claim. They have no FK, so rows are orphaned when a project is deleted.

The org-scoping migration `20260318090000_add_organizations_and_user_invites.sql` scoped `projects` to organisations **but did not touch any generation/downtime table**. Any authenticated user of any organisation can read or overwrite any project's generation, guarantees and (via the anon key) downtime data by project UUID.

### D.5 Edge function `upload-generation-csv` (unrouted in the UI; external ingestion API)

`supabase/config.toml:78-79` sets `verify_jwt = false`. The function does its own auth (`index.ts:54-82`) and accepts any one of:
- (a) the service-role key as the bearer,
- (b) a static API key from env **`Monthly_Generation_Upload`**,
- (c) **any valid user JWT** (`auth.getClaims`).

It then writes with the **service-role client, bypassing RLS** (`:85`).

- **Security (critical):** there is **no check that the caller has access to `project_id`** (`:115-126` only checks that the project exists). Any user of any tenant or organisation can inject or overwrite generation data into any project. Static-API-key comparison is not constant-time. CORS is `*`.
- **Body:** `{project_id, year?, type:'solar'|'council', source_label?, csv_content, date_col, value_col, time_col=-1, is_kw=true, mode='accumulate'|'replace'}`. The column indices are 0-based and supplied by the caller (no header mapping). There is no size limit on `csv_content` beyond the platform body limit.
- **Parsing:** the same as `CSVPreviewDialog` (ported, `:9-44`), same naive comma split and same interval rule.
- **Year handling:** monthly rows use `year || current calendar year` (`:220`), so a CSV for last December posted in January without `year` lands in **the current year**. Daily rows use the CSV's own year (`:276`).
- **`mode='replace'`:** **DELETEs the whole `generation_records` row** for the month (`:221-229`), which also destroys `guaranteed_kwh`, the other meter type's kWh and `expected_kwh`, then inserts only this type's kWh. **Data-loss defect.** It also deletes daily rows per date.
- **`mode='accumulate'`:** the read-modify-write is not atomic (race) and overwrites `source` with this label, even for a council upload.
- **Readings** use plain `insert` in 500-row batches (`:321-324`). A duplicate (project, timestamp, source) makes the **whole batch fail**, and the **error is not checked**, so the response still says `success:true` with `readings_count` = rows attempted. **No insert/update/delete result in the function is error-checked** (`:223-347`).
- It auto-inserts a guarantee placeholder (guaranteed_kwh 0) per month for `source_label || 'csv-api'`.
- **Response:** `{success, months_affected, total_kwh_added, readings_count, daily_records}`. Errors → 500 with `err.message` (leaks internals).

### D.6 External services & keys (generation)

No third-party service in the UI path. The edge fn uses env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` and `Monthly_Generation_Upload` (custom static bearer key). The implied external integration is a SCADA/portal exporter (PnP SCADA format detection: a first line containing "pnpscada"/"scada").

### D.7 Upstream dependencies (what Generation consumes)

- `projects.tariff_id` → `tariff_rates` (Tariff tab) for the Revenue sub-tab only.
- **Nothing from the Simulation, PV Layout or Proposal tabs.** The guarantee is typed in by hand, `expected_kwh` is never populated from the simulation, and installed kWp is not referenced, so no specific yield or PR can be derived. A rebuild should seed the monthly guarantee schedule from the accepted proposal's simulation (monthly P50 or P90 × degradation) and let the user override it.

### D.8 Defects / gaps / hard-coded values (generation), consolidated

| # | Severity | Finding | Evidence |
|---|---|---|---|
| G1 | **Critical (security)** | Any authenticated user can write any project's generation data through the service-role edge function (no project authorisation) | `upload-generation-csv/index.ts:73-85,115-126` |
| G2 | **Critical (security)** | `downtime_comments` / `downtime_slot_overrides` are anon read/write (`USING (true)`); the generation tables are any-authenticated with no org scoping, and the org migration skipped them | migrations `20260216053225`, `20260216053639`, `20260210073125` etc. |
| G3 | High (data) | CSV import is additive and not idempotent; re-import doubles monthly and daily totals (and council readings) | `GenerationDataCard.tsx:80,121,186` |
| G4 | High (data) | Monthly totals are booked to the **tab's selected year**, not the CSV's year | `GenerationDataCard.tsx:66-71,83-88` |
| G5 | High (data) | The council import copies an existing solar `actual_kwh` into a new council-source row, which is double-counted as solar unless a council guarantee row exists | `GenerationDataCard.tsx:170-188`; `PerformanceSummaryTable.tsx:180-204` |
| G6 | High (data) | Edge fn `replace` mode deletes the whole monthly record (guarantee included); readings-insert errors are swallowed while `success:true` is returned | `upload-generation-csv/index.ts:221-240,321-324` |
| G7 | High (UX) | The manual monthly-total Save is unreachable (no input rendered) | `GenerationDataCard.tsx:29,302,340-344` |
| G8 | Medium | Only the first of multiple selected files is imported; the `csv:N` counter over-counts | `GenerationDataCard.tsx:239-243` |
| G9 | Medium | The guarantee save is delete-then-insert (non-atomic); the total includes council rows | `SourceGuaranteesDialog.tsx:122,136-158` |
| G10 | Medium | The comment cell does not re-sync on month change (stale text shown) | `DowntimeCommentCell.tsx:26,31` |
| G11 | Medium | Slot overrides cannot be cleared; write errors are ignored | `DowntimeSlotCell.tsx:34-48` |
| G12 | Medium | The distinct reading-source lookup is not paginated (1000-row cap) | `SourceGuaranteesDialog.tsx:80-85` |
| G13 | Medium | Revenue uses one flat energy rate (TOU and season ignored; arbitrary high/low pick); a silent R0 when no tariff | `PerformanceSummaryTable.tsx:138-167` |
| G14 | Medium | Hard-coded sun window 06:00–17:30, 0.05% threshold, flat per-slot expectation, missing data = downtime | `PerformanceSummaryTable.tsx:264,299-341` |
| G15 | Low | Label mismatch "06:00–18:00" vs 17:30; "30-Min Intervals" regardless of the interval; the chart uses 23 sun slots vs the table's 24 | `PerformanceSummaryTable.tsx:461,506,520`; `PerformanceChart.tsx:242` |
| G16 | Low | The Performance colour scale greys out the worst performers | `PerformanceSummaryTable.tsx:689-694` |
| G17 | Low | Lifetime chart / source-guarantee queries not invalidated after edits | `GenerationTab.tsx:90-93` |
| G18 | Low | Reset has no confirmation and nulls rather than deletes; the year select is limited to ±2 years | `GenerationDataCard.tsx:261-300`; `GenerationTab.tsx:59` |
| G19 | Low | Dead: `ActualGenerationCard`, `BuildingLoadCard`, `csvUtils`, Recharts Legend, `overProd`; `generation_daily_records` is write-only; `expected_kwh` is unused | as cited |
| G20 | Low | CSV parser is not quote-aware, treats US dates as DD/MM, defaults kW, and "Rows from/to" is preview-only | `CSVPreviewDialog.tsx` |

---

## Part E — Monthly report tab

**Mount point:** `ProjectDetail.tsx:1445-1447` → `<MonthlyReportManager projectId={id!} />`. Tab trigger `:1303-1306` (FileText, "Monthly Report"). The status is hard-coded "pending", tooltip "Manage monthly reports" (`:1190-1193`).

**Purpose:** produce a monthly O&M/performance report PDF for a client: an executive summary, a daily performance log, operational downtime with comments, a Rand financial yield and a per-source performance log, all computed from the Generation tab data for a chosen month. It can be versioned and shared through the same client portal as proposals.

**Architecture (important for the rebuild):** a monthly report is **a row in `public.proposals` with `document_type='monthly_report'`** (column added by `supabase/migrations/20260218090049_…sql`). It is edited in **the same `ProposalWorkspaceInline` component as proposals**, with `documentType="monthly_report"`. PDF output comes **only** from the LaTeX pipeline: client-generated `.tex` → edge fn `compile-latex` → **texlive.net** → PDF blob. The legacy `report_configs` / `report_versions` / `report_analytics` tables are **not used by this tab at all**. `report_configs`/`report_versions` have zero `src/` references, and `useReportAnalytics` (`src/hooks/useReportAnalytics.ts`) has **zero consumers**. They appear only in `replicate-to-external` (`supabase/functions/replicate-to-external/index.ts:49-51`). All three are dead as far as this product is concerned.

### E.1 List view (`MonthlyReportManager.tsx`)

The layout is a header with the title "Monthly Reports", subtitle and **Create Monthly Report** button, then a card list sorted by `created_at DESC`.

Data: `proposals` WHERE project_id AND document_type='monthly_report' ORDER BY created_at DESC (`:19-32`).

| Control | Type | What it's for | Handler → effect | Data | Validation/disabled | Error & empty states |
|---|---|---|---|---|---|---|
| **Create Monthly Report** (header) | Button | Start a new report | `handleCreate` `:50-53` → `isEditing=true, editingProposalId=null` → renders `ProposalWorkspaceInline` (`:60-69`) | none until saved | — | — |
| Card: "Version {n}" + status badge + created date + "Signed by {client_signature}" | Display | Identify the report | `:95-121`. Status colours `:34-43` (approved/accepted green, sent blue, pending_review amber, rejected red, else muted) | `proposals.version, status, created_at, client_signature` | — | ⚠ **The card shows no report month/year**: there is nowhere to store it (see E.4). Reports are distinguishable only by version number and creation date |
| **Client View** | Outline button (only if `share_token` exists AND status ∈ sent/approved/accepted) | Open the client-portal page | `window.open('/portal/'+share_token,'_blank')` `:124-133` | — | — | — |
| **Edit** | Secondary button | Open the report in the workspace | `handleEdit(id)` `:45-48` | — | — | — |
| Empty state | Dashed card "No monthly reports yet" + a second **Create Monthly Report** button | — | `:147-162` | — | — | Loading spinner `:71-77`. **Query error is not rendered** (react-query error ignored) |

There is **no delete, duplicate, status change or download control** on the list. Nothing in this tab moves a report from draft to sent, approved or accepted; the status changes only through `ShareLinkButton` / client portal (Part A).

### E.2 Workspace (`ProposalWorkspaceInline.tsx` with `documentType='monthly_report'`)

The component is shared with proposals; Part A documents it exhaustively. Only monthly-report behaviour and deltas are listed here.

**Layout:** a left `ProposalSidebar` (w-80, collapsible to a 12-px icon rail); a top bar (Back ←, title "Monthly Report", v{n} + status badges, project name, **Year and Month selects**, version count, Export PDF, Export Excel, Share, Save); main area `LaTeXWorkspace`, a resizable split with the LaTeX source editor (45%) and the PDF preview (55%) (`:593-745`).

**Data loaded on open:**
- `projects` + `tariff_plans(id,name)` (`:124-136`)
- `generation_readings.timestamp` for the whole project to build available periods (`:141-164`)
- `useMonthlyReportData` (`:193-197`) → `computeMonthlyReportData` (E.3)
- `project_simulations` (`:199-211`) and `sandbox_simulations` (`:213-235`), which feed cover capacity
- `project_tenants` + `shop_types` + `scada_imports` (`:237-249`), unused by the monthly blocks
- the existing proposal row (`:251-264`)
- all version numbers for (project, document_type) (`:266-279`)
- org branding (`useOrganizationBranding`)

| Control | Type | What it's for | Handler → effect | Data read/written | Validation/disabled | Error & empty states |
|---|---|---|---|---|---|---|
| ← Back | Icon button | Return to the list | `onBack` (`:620`) → `MonthlyReportManager.handleBack` | — | **No unsaved-changes guard**: edits are lost silently | — |
| **Year** | Select | Report year | `setReportYear` `:638-649`. Options = years having readings, else the current value | drives `useMonthlyReportData` | — | — |
| **Month** | Select | Report month | `setReportMonth` `:650-665`. Options = months with readings in the selected year | same | ⚠ Changing the Year does **not** reset the Month, so a month with no data can stay selected. The default is the previous month; an effect snaps to the **latest available period** if the current one has no readings (`:181-190`) | ⚠ **The available-periods query is not paginated** (`:144-148`): PostgREST returns only the first ~1000 readings (≈ 20 days at 30-min × 1 source), so **only the earliest month(s) of data appear** in the pickers and the "latest" auto-select picks the earliest month. **High-severity defect** once a project has more than a few weeks of data. ⚠ **The chosen month/year is never persisted** (no column; E.4) |
| Sidebar collapse ◀ / ▶ and rail icons | Icon buttons | Space | `setSidebarCollapsed` | — | — | — |
| Sidebar tabs: Content / ~~Branding~~ / ~~Template~~ | Tabs | — | `ProposalSidebar.tsx:167-181` | — | **Branding and Template tabs are `disabled`** (stubs); `BrandingForm` / `TemplateSelector` are unreachable | — |
| Section filter (cycling button: Monthly Report → All Sections → General → Proposal → …) | Button | Filter the section list | `ProposalSidebar.tsx:187-202`. Initial = `documentType` | — | — | — |
| Section toggle (per block) | Switch in `ContentBlockToggle` | Include/exclude a report section | `handleBlockToggle` → `setContentBlocks` → regenerates the LaTeX (`LaTeXWorkspace.tsx:71-85`) | → `proposals.content_blocks` on Save | Cross-category blocks start disabled (`:56-63`) | — |
| Section drag-reorder | HTML5 drag | Change section order | `handleDrop` `ProposalSidebar.tsx:104-118` | → `content_blocks[].order` | ⚠ **Defect:** it reorders the *filtered* list and passes only those blocks to `onContentBlocksChange`, so **every block outside the current filter (cover, TOC, signature and all proposal blocks) is dropped from state** after one drag in the default "Monthly Report" filter. The next Save persists the truncated list; on reload the merge (`:312-321`) resurrects them with **default enabled=true**. **High** | — |
| "Generate AI narrative" (per block) | Button in `ContentBlockToggle` | LLM text | Only blocks in `NARRATIVE_SECTION_MAP` (`ProposalSidebar.tsx:24-30`: introduction, backgroundMethodology, tenderReturnData, financialEstimates, financialConclusion) | edge fn `generate-proposal-narrative` | **None of the monthly-report blocks are in the map**, so no AI button appears on monthly sections. In addition, `aiNarratives` state is **never fed into `templateData`**, so generated narratives never reach the LaTeX/PDF (true for proposals too; see Part A) | toast |
| LaTeX editor | Code textarea with section folding, word-wrap toggle, **Sync** button | Hand-edit the report source | `LaTeXWorkspace.handleSourceChange` `:88-159` | → `proposals.section_overrides` (JSON map blockId→LaTeX, plus `__prefix__{id}` keys for text between sections) on Save | Compiles **only on Sync** (`:190-195`) | ⚠⚠ **Freeze defect:** on *any* manual keystroke the handler stores **every** section's current text as an override (`:97-106`, comment: "Save ALL section content as overrides… no comparison with generated content"). From then on `assembleSource` uses the override instead of regenerating (`:26-28`), so **the data-driven monthly tables stop updating when the month changes or data is corrected**. After one edit, choosing a different month still shows the old month's numbers. There is no "reset section to generated" control in the workspace (Part A to confirm in LaTeXEditor). **Critical for a monthly-report product** |
| **Sync** (in editor) | Button | Compile to PDF | `compile(source)` → `compileLatex` → `supabase.functions.invoke('compile-latex')` (`SwiftLaTeXEngine.ts:19-51`) | edge fn → texlive.net | Disabled while compiling | Error "Compilation failed" + log in the preview panel |
| PDF preview: ◀ page ▶, page input, zoom −/+, fit-width, wheel / pointer pan | Viewer controls | Read the PDF | `PDFPreview.tsx:129-251` | — | — | Shows the compile log on error |
| **Export PDF** | Outline button | Download the compiled PDF | `handleExportPDF` `:493-509` → `downloadPdf(pdfBlobRef.current, "{project}-v{n}.pdf")` | local download only (**not stored** in Storage or `projects.reports`) | ⚠ **Disabled when `!simulationData`** (`:682`), yet the monthly preview renders **without** a simulation using a zero fallback (`:413-417`). A project with **no simulation cannot export a monthly report**. **Defect** | toast "No compiled PDF available…" if Sync has not run. ⚠ It exports the **last compiled** blob, which can be stale versus unsynced edits or a month change. The filename has no month |
| **Export Excel** | Outline button | CSV of the *simulation* financials | `handleExportExcel` `:511-543` | local CSV | Disabled when no simulation | ⚠ For a monthly report it exports **proposal financials (system cost, payback, ROI)**, not the monthly performance data. **Wrong content** for this document type |
| **Share** (`ShareLinkButton`) | Button/popover | Generate a portal link | see Part A | `proposals.share_token`, `status` | Only after first save | — |
| **Save** / "Create Proposal" | Primary button | Persist | `saveMutation` `:431-491`. Insert (first save) or update `proposals` | `proposals` columns: simulation_id / sandbox_id, verification_checklist, branding, executive_summary, custom_notes, assumptions, disclaimers, simulation_snapshot, content_blocks, section_overrides, version (insert only), document_type (insert only) | Disabled while pending | ⚠ The button label reads **"Create Proposal"** and the error toast reads **"Failed to save proposal"** even for monthly reports (`:489`, `:717`). ⚠ `version = max(existing)+1`, computed client-side (race; no UNIQUE(project_id, document_type, version) seen). **Save never snapshots `monthlyReportData`**; `simulation_snapshot` stores the *simulation*, not the month's figures |

**What a saved monthly report actually contains:** configuration (sections, order, branding, text overrides) plus a simulation snapshot. It does **not** contain the report month, the computed figures or the PDF. Reopening it recomputes from live Generation data for whatever month the pickers default to. The only way numbers get "frozen" is the accidental override behaviour. **The version history is therefore not an audit record of what the client received.** In E-Site the report should be a `projects.reports` version with the rendered PDF, the period and a JSON snapshot of the metrics.

### E.3 Data pipeline — `computeMonthlyReportData` (`src/utils/monthlyReportData.ts`)

The hook is `useMonthlyReportData(projectId, month, year)` (`src/hooks/useMonthlyReportData.ts:4-10`), query key `["monthly-report-data", projectId, year, month]`, enabled when projectId is truthy and month/year > 0. It is **not invalidated** by Generation-tab edits (different key), so an open report can be stale.

The function runs six parallel reads (`:76-110`):
1. `generation_readings` for the month, paginated 1000/page (`fetchAllReadings` `:398-422`)
2. `generation_source_guarantees` (project, month, year)
3. `downtime_comments` (project, year, month)
4. `downtime_slot_overrides` (project, year, month)
5. tariff rate (`fetchTariffRate` `:424-446`, the same flat-rate logic as D.3 §11)
6. `generation_records` (actual_kwh, guaranteed_kwh)

⚠ Errors on reads 2–6 are **ignored** (`.data ?? []`), so a failed guarantee fetch silently yields an all-zero guarantee report.

The computation (`:139-393`) is a **verbatim copy** of D.3 steps 1–10 (same 3-tier guarantee fallback, 06:00–17:30 window, 0.05% threshold, consecutive-slot rule, overrides, `yieldGuarantee = generation_records.guaranteed_kwh / days`).

Output (`MonthlyReportData`, `:27-56`): `{month, year, totalDays, dailyRows[], totals, sourceLabels (display names), sourceDayMap (key "day-rawSource"), sourceTotals (key rawSource), sourceDisplayNames (rawSource→label, only for sources with a mapped guarantee), comments (day→text), tariffRate, monthlyGuarantee, monthlyActual}`.

`monthlyActual` is returned but **not used by any snippet**. Building/council load is fetched but **never used** in the report.

### E.4 Data model (monthly report)

`public.proposals` (types at `src/integrations/supabase/types.ts`, proposals Row). The columns relevant here are: id, project_id, **document_type text NOT NULL DEFAULT 'proposal'** (`20260218090049`), version int, status text (`draft|pending_review|approved|sent|accepted|rejected` per `src/components/proposals/types.ts` `Proposal.status`), content_blocks jsonb (`20260216125343`), section_overrides jsonb (`20260216130635`), branding jsonb, simulation_id, sandbox_id, simulation_snapshot jsonb, verification_checklist jsonb, executive_summary, custom_notes, assumptions, disclaimers, prepared_by/at, reviewed_by/at, approved_by/at, verification_completed_*, client_signature, client_signed_at, share_token, created_at, updated_at.

- **Missing:** `report_period_month`, `report_period_year`, a data snapshot, a PDF storage path, `sent_at` or recipients.
- `content_blocks` JSON shape: `[{id, label, description, enabled, required?, order, category:'general'|'proposal'|'monthly_report'}]`.
- `section_overrides` shape: `{[blockId]: latexString, ["__prefix__"+blockId]: latexString}`.
- RLS on `proposals` and portal access are covered in Part A.

Dead tables for this tab: `report_configs` (proposal_id FK, name, template, segments jsonb, branding jsonb; RLS **`USING(true)` anon full CRUD**, migration `20251216055957`), `report_versions` (report_config_id FK, version, snapshot jsonb, generated_by, notes; **anon SELECT/INSERT/DELETE**) and `report_analytics` (user_id, event_type, report_config_id, metadata; own-row RLS, `20251216064510`). Recommend **not porting** them. If they remain in the source DB, the anon-CRUD policies on `report_configs`/`report_versions` are an open write surface.

### E.5 Every section produced in a monthly-report PDF and its source

The default enabled set is general + monthly_report blocks, in order: Cover (0), Table of Contents (1), Executive Summary (2), Daily Performance Log (3), Operational Downtime (4), Financial Yield (5), Performance Log (6), Signature (99). Proposal blocks are present but disabled (`ProposalWorkspaceInline.tsx:56-63`; `types.ts` DEFAULT_CONTENT_BLOCKS). Generated by `generateBlockContent` (`src/lib/latex/templates/proposalTemplate.ts:30-84`).

**Preamble and header/footer, every page** (`proposalTemplate.ts:87-211`):
- A4, carlito font, header colour `titleblue` **hard-coded RGB 23,109,177** ("branding/template influence disabled for now", `:89-90`).
- Header: project name / "SOLAR PV INSTALLATION → **Financial Analysis**" (**wrong title for a monthly report**), `\today`, "Rev {version 3-digit}", and a **hard-coded TikZ "WM" logo box**.
- Footer: `[DOCUMENT\_NUMBER\_PLACEHOLDER]`, `[PRINT\_DATE\_PLACEHOLDER]` and `[FILE\_PATH\_PLACEHOLDER]` are **printed literally**; nothing substitutes them.

| # | Section (block id) | Content | Data source | Defects |
|---|---|---|---|---|
| 1 | Cover (`cover`) → `snippets.coverPage` `snippets.ts:36-117` | Project name, "SOLAR PV INSTALLATION", "**Financial Analysis**", "{solarCapacity} kW_AC", prepared-by block (company, address, tel, contact), WM logo, DATE `\today`, REVISION Rev nnn | `project.name`; `simulation.solarCapacity` (first project simulation auto-selected `:378-383`, else 0); `branding.company_name/address/contact_phone` with **hard-coded fallbacks "WATSON MATTHEUS CONSULTING ELECTRICAL ENGINEERS (PTY) LTD", "141 Witch-Hazel Avenue…", "(012) 665 3487"**; contact = `proposal.prepared_by` or "**Mr Arno Mattheus**" | Wrong document title; **no report month on the cover**; capacity from the *proposal simulation*, not as-built; "kW AC" labelled from the kWp field |
| 2 | Table of Contents (`tableOfContents`) | LaTeX TOC with a blue sidebar | auto | — |
| 3 | Executive Summary (`executiveSummary`) → `monthlyReportSnippets.executiveSummary` `:30-107` | (a) **Installed Equipment** table (Modules / Inverters ×2: manufacturer, spec, qty, total power, combined DC/AC). (b) **Monthly Energy Generation (Month Year)**: Actual Production vs Guarantee with variance %; Theoretical Production vs Guarantee with variance %. (c) **Yearly Energy Generation (Year)**: Thus Far / Total rows for actual and theoretical | (a) **always literal placeholders** `[MODULE\_MFR]`, `[INV\_SPEC\_1]`, `[DC\_POWER]`… **never populated even with data** (PV Layout / equipment data are not wired). (b) `totals.meteredGeneration`, `totals.yieldGuarantee`, `totals.theoreticalGeneration`; variance = `(actual−guarantee)/guarantee×100` (`fmtPct` `:20-24`, "—" if guarantee 0). (c) ⚠ **"Year – Thus Far" and "Year – Total" both print the single month's figures**, with no YTD aggregation: **factually wrong** | Placeholders print into the client PDF; YTD wrong |
| 4 | Daily Performance Log (`dailyLog`) → `dailyPerformanceLog` `:184-215` | Longtable per day: Day · Yield Guarantee · Metered · Down Time · Theoretical · **Realised Cons.** · Surplus/Deficit + Total | `dailyRows[]`, `totals` | ⚠ The "Realised Cons." column **repeats metered generation** (`:186` uses `meteredGeneration` twice); building consumption is never shown |
| 5 | Operational Downtime (`operationalDowntime`) → `operationalDowntime` `:251-305` | Per day: total downtime **slots** · slots per source · comment (escaped) + Total | `dailyRows[i].downtimeSlots`, `sourceDayMap`, `sourceTotals`, `comments` | ⚠ Columns iterate `sourceDisplayNames`, which holds **only sources with a mapped guarantee**, so unmapped sources are **omitted**. If no guarantees are mapped, the whole section falls back to the **placeholder with fake "Tie-In 1 / Tie-In 2" columns and zeros** (`:260-262`, `:307-333`), even though real downtime exists. The section shows slot counts only, no kWh lost |
| 6 | Financial Yield Report (`financialYield`) → `financialYieldReport` `:337-367` | Per day, in Rand: Yield Guarantee · Metered Gen · Down Time Loss · Theoretical Gen · Surplus/Deficit + Total | `dailyRows × tariffRate` | Flat-rate (D.3 §11); **no rate or tariff name is stated in the PDF**; R 0.00 everywhere silently when there is no tariff |
| 7 | Performance Log (`performanceLog`) → `performanceLog` `:410-478` | Per day × source: Guarantee | Metered, cell colour green >1.0 / yellow ≥0.95 / red ≥0.50 / grey <0.50 + Totals | `sourceDayMap`, `sourceTotals`, `sourceDisplayNames` | The same source-omission defect as §5; the worst performers are grey; a colour key is not printed. ⚠ **The placeholder variant is broken LaTeX**: `performanceLogPlaceholder` joins rows with `"\\n"` (`:484`), emitting the literal control sequence `\n` → *Undefined control sequence*, so **compile fails** whenever the placeholder is used (no data or no mapped guarantee) |
| 8 | Signature (`signature`) → `snippets.signatureBlock` `snippets.ts:576-590` | "Authorization": Prepared by / Client Acceptance lines, Name, Date | none (blank lines) | Titled for proposal acceptance, not report sign-off |

Placeholder variants (no data yet): `executiveSummaryPlaceholder` `:110-180`, `dailyPerformanceLogPlaceholder` `:217-247` (always 31 rows), `operationalDowntimePlaceholder` `:307-333`, `financialYieldReportPlaceholder` `:369-397` and `performanceLogPlaceholder` `:480-507` (broken, see above).

**Every report metric (definitive list):**

| Metric | Formula | Unit |
|---|---|---|
| Daily Yield Guarantee | `generation_records.guaranteed_kwh / daysInMonth` | kWh |
| Daily Metered Generation | Σ `generation_readings.actual_kwh` for solar sources on that day | kWh |
| Daily Down Time (energy) | Σ over sources and qualifying slots of `(perSlotEnergy − actual)`, or `override × perSlotEnergy` | kWh |
| Daily Down Time (slots) | count of qualifying below-threshold slots (or override) per source, summed | count |
| Daily Theoretical Generation | metered + downtime energy | kWh |
| Daily Surplus/Deficit | metered − daily yield guarantee | kWh |
| Monthly totals | Σ of the daily values | kWh / count |
| Actual variance % | (Σmetered − Σguarantee)/Σguarantee × 100 | % |
| Theoretical variance % | (Σtheoretical − Σguarantee)/Σguarantee × 100 | % |
| "Yearly" actual / theoretical | = the monthly values (bug) | kWh |
| Financial columns | each kWh metric × flat `tariffRate` (R/kWh) | R |
| Per-source daily guarantee | sourceGuarantee / daysInMonth (3-tier mapping) | kWh |
| Per-source metered | Σ actual for that source per day | kWh |
| Performance colour | per-source actual / guarantee: >1, ≥0.95, ≥0.5, <0.5 | band |

### E.6 External services & keys (monthly report)

- **`compile-latex` edge fn** (`supabase/functions/compile-latex/index.ts`): `verify_jwt=false` (`config.toml:75-76`) and **no auth in code**. It forwards any `source` string to **`https://texlive.net/cgi-bin/latexcgi`** (a free public third-party service, pdflatex, `:21-30`) and returns the PDF or a JSON log with HTTP 200.
  - (a) **An open, unauthenticated compile proxy** anyone can abuse.
  - (b) **Client financial and performance data leaves to a third party** with no DPA (POPIA concern).
  - (c) No timeout, size limit or retry; a texlive.net outage or rate-limit breaks every report.
  - (d) LaTeX injection: user text is escaped via `esc()` in snippets, but the editor lets users type arbitrary TeX (e.g. `\input`, and `\write18` is normally disabled on texlive.net). This is a server-side concern for any self-hosted replacement.
- The file name `SwiftLaTeXEngine.ts` is a misnomer: no SwiftLaTeX/WASM engine is used, compilation is remote.
- No LLM is used by the monthly-report path (the AI narrative button is absent for monthly blocks).
- No email: the report is never sent. The share link must be copied manually (Part A).

### E.7 Upstream consumption

- **Generation tab (Part D):** everything numeric: readings, source guarantees, monthly guarantee, downtime comments and overrides.
- **Tariff tab:** `projects.tariff_id` → `tariff_rates` energy rate.
- **Simulation tab:** `project_simulations` (first/latest auto-selected) → only the cover's kW figure, and the Export PDF/Excel enablement.
- **Org settings:** `organization_branding` via `useOrganizationBranding` → cover company/address/phone when set (the logo and colours are ignored by LaTeX).
- **Not consumed but should be:** PV Layout / equipment (installed-equipment table), as-built capacity, irradiance (for PR), the previous months (for YTD).

### E.8 Defects / gaps (monthly report), consolidated

| # | Severity | Finding | Evidence |
|---|---|---|---|
| M1 | **Critical** | Any editor keystroke freezes **all** sections as static overrides; month changes and data corrections no longer flow into the report | `LaTeXWorkspace.tsx:97-106,26-28` |
| M2 | **Critical** | The report period (month/year) is not persisted; saved versions do not snapshot figures or the PDF, so there is no record of what the client received | `ProposalWorkspaceInline.tsx:69-74,431-478`; proposals schema |
| M3 | High | The available-periods query is unpaginated (1000-row cap), so the pickers only show the earliest month(s) and the auto-select picks the wrong month | `ProposalWorkspaceInline.tsx:141-164,181-190` |
| M4 | High | Executive Summary equipment table is always unfilled placeholders; "Yearly" rows duplicate the month | `monthlyReportSnippets.ts:57-64,95-103` |
| M5 | High | Downtime and Performance sections drop sources without a mapped guarantee, or render fake Tie-In placeholders | `monthlyReportSnippets.ts:254-262,411-416` |
| M6 | High | `performanceLogPlaceholder` emits `\n` → LaTeX compile failure | `monthlyReportSnippets.ts:484` |
| M7 | High | Export PDF is disabled without a simulation, although the monthly report does not need one; Export Excel exports proposal financials | `ProposalWorkspaceInline.tsx:511-543,682,695` |
| M8 | High | Sidebar drag-reorder drops every block outside the active filter | `ProposalSidebar.tsx:104-118` |
| M9 | **Critical (security/privacy)** | `compile-latex` is unauthenticated and ships client data to public texlive.net | `compile-latex/index.ts`; `config.toml:75` |
| M10 | Medium | "Realised Cons." column = metered generation; council/building load is never reported | `monthlyReportSnippets.ts:186,212` |
| M11 | Medium | Header and cover say "Financial Analysis"; hard-coded WM logo, colour and company fallbacks; literal footer placeholders | `proposalTemplate.ts:89-90,150-197`; `snippets.ts:45-49` |
| M12 | Medium | Read errors in `computeMonthlyReportData` are swallowed (silent zeros); the report query is not invalidated by Generation edits | `monthlyReportData.ts:112-117`; `useMonthlyReportData.ts` |
| M13 | Medium | The logic is duplicated with `PerformanceSummaryTable` (drift risk) | `monthlyReportData.ts:139` vs `PerformanceSummaryTable.tsx:171` |
| M14 | Low | Save label "Create Proposal" and toast "Failed to save proposal" for monthly reports; no unsaved-changes guard on Back; the list card shows no period and has no delete | `ProposalWorkspaceInline.tsx:489,717`; `MonthlyReportManager.tsx` |
| M15 | Low | Branding and Template sidebar tabs are disabled stubs; AI narratives never reach the document | `ProposalSidebar.tsx:173-180`; `ProposalWorkspaceInline.tsx:66,411-429` |
| M16 | Low | `ProjectDetail` "proposals" count and latest-proposal branding query mix proposals and monthly reports (no `document_type` filter) | `ProjectDetail.tsx:970-984,1023-1034` |
| M17 | Info | `report_configs` / `report_versions` / `report_analytics` / `useReportAnalytics` are dead; `report_configs` and `report_versions` have anon CRUD RLS | migrations `20251216055957`, `20251216064510` |

### E.9 Mapping notes for E-Site

- Replace "monthly report = a proposals row + a LaTeX editor" with an **E-Site `projects.reports` version** of a new kind (e.g. `solar_monthly_performance`) with these fields:
  - `period_start` / `period_end`
  - a JSON `summary` = the full `MonthlyReportData` snapshot (daily rows, per-source, comments, rate, guarantee basis)
  - the rendered PDF in storage
  - `note`, author, and supersede chain
  
  This fixes M1, M2 and the audit gap together.
- Render server-side with the product's existing PDF stack (not a public LaTeX service). Mind E-Site's documented WinAnsi pitfalls for `—`, `→`, `✓` and `≥`; the current snippets use `—` in `fmtPct`.
- Make the computation a single shared, unit-tested module used by both the Generation tab and the report (M13). Paginate every readings query (M3, G12).
- Distribution: use E-Site email plus the existing share/portal model instead of manually copied tokens.
- Gating: generation data and downtime overrides feed a **contractual guarantee claim**, so writes need role gates (ORG_WRITE_ROLES-style), an author, a timestamp and an append-only history. The current anon-writable downtime tables (G2) must not be carried over.
