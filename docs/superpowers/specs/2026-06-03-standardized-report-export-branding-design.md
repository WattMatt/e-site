# Standardized PDF Report Export + Branding Foundation — Design

**Date:** 2026-06-03
**Status:** Design (brainstorm output). Implementation plan to follow via `writing-plans`.
**Backlog item:** #4 of a 6-item backlog. This is the *foundation* that #3 (inspection export) and #5 (snag report) build on. Brainstormed with HTML visual companion; mockups persisted under `.superpowers/brainstorm/`.

---

## 1. Problem & goal

Today E-Site produces documents three unrelated ways:

- **Cable Schedule** — `pdf-lib`, hand-positioned coordinates, branding (WM amber/dark) **hard-coded** in `apps/web/src/lib/cable-schedule/export-pdf.ts`; download-only, not saved.
- **Inspection Certificate** — `pdf-lib`, stored + versioned in the `inspection-certificates` bucket (`inspections.certificates`).
- **JBCC Notices** — `docxtemplater` + `pizzip`, `.docx` output.

There is no shared report engine, no configurable branding (`organisations.logo_url` exists but is an unused stub; `projects` has no logo), and no unified saved-artifact model.

**Goal:** a standardized, branded, **saved** PDF report engine that new reports plug into, plus logo/branding configuration in settings. The foundation ships as infrastructure (no real report kind), verified through a settings branding-preview render.

---

## 2. Decision log

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope / blast radius | **New reports on the new engine.** Existing cable-schedule + inspection-certificate PDFs left untouched; retrofit is a later, separate effort. |
| 2 | Branding cast | **Four logos:** ① issuer (org) · ② client/developer · ③ project mark · ④ contractor (sub-org). |
| 3 | Persistence | **Saved artifact** — unified `reports` table + bucket; versioned, shareable, handover-linkable. |
| 4 | Rendering | **`@react-pdf/renderer`** — pure Node, no Chromium. |
| 5 | Architecture | Shared engine in `packages/shared/src/reports/`; reports service; **branding snapshot** frozen per issue. |
| 6 | Settings home | ② + ③ + accent fold into the project **General** sub-page ("Branding" field-group); ① in Org Settings; ④ per sub-org. |
| 7 | Composition | **Issuer-led cover + "parties" strip** (②③④); shared interior primitives. |
| 8 | Pilot scope | **Pure infrastructure** — no real report kind ships; a non-persisted branding-preview render exercises the engine. |
| 9 | Permissions | Export gated to source-viewing roles; cost sections gated by `COST_VIEW_ROLES`; branding edits owner/admin/PM; download = access gate + signed URL. |

---

## 3. Rendering approach (decision 4)

`@react-pdf/renderer`, invoked server-side in a Node serverless function.

- **Why, over the alternatives:** runs in plain Node on Vercel (no ~50MB Chromium binary, no cold-start/function-size pain that Puppeteer brings); reports here are *structured* (cover → sections → photo grids → tables → signature), which react-pdf's flowable layout + auto-pagination handles well; report components live in the React/TS stack and are unit-testable. `pdf-lib` stays for the two existing PDFs but is too low-level to author new photo-rich reports.
- **Trade-off accepted:** react-pdf is a CSS *subset* (not real HTML/CSS), and the on-screen preview is via its own renderer, not 1:1 with a web page. Acceptable for structured reports.
- **New dependency:** `@react-pdf/renderer`. Preview rendered via the already-present `pdfjs-dist` viewer.

---

## 4. Architecture (decision 5)

### `packages/shared/src/reports/` — the engine (pure, no Next/Supabase coupling)

- `branding/resolve-branding.ts` — **pure** function `(org, project, contractorOrg?) → ResolvedBranding`. Returns logo references, accent colour, party names, with fallback/precedence applied. Logo *bytes/URLs* are passed in by the caller (app layer fetches from Supabase) so the engine stays deterministic and testable.
- `primitives/` — react-pdf components reused by every kind: `Cover`, `RunningHeader`, `RunningFooter`, `Section`, `Table`, `PhotoGrid`, `SignatureBlock`, plus `theme.ts` (fonts, spacing, accent application).
- `kinds/` — the report-kind registry. The foundation ships **one** kind, `BrandingPreview` (sample cover + a lorem section, "PREVIEW" watermark), used by the settings preview and the engine tests. Real kinds (#3 inspection, #5 snag) are added later as pure additions.
- `render-report.ts` — `(definition, data, resolvedBranding) → Uint8Array` (PDF bytes).

> **Bundling:** the engine is a **sub-path export** (`@esite/shared/reports`), **not** re-exported from the main `@esite/shared` barrel — so `apps/mobile` never pulls `@react-pdf/renderer` into its bundle. This mirrors the existing `@esite/shared/placeholder-fill` sub-path treatment.

### `packages/shared/src/services/reports.service.ts` — persistence (injected `SupabaseClient`)

Mirrors `project-settings.service`: upload PDF to the `reports` bucket, insert/supersede the `reports` row, list, signed-URL fetch, revoke. Persistence only (no rendering) → unit-testable against a mocked client.

### `apps/web` — the integration layer (thin orchestration)

- **Server actions:**
  - `previewBrandingAction(projectId)` — RBAC gate → fetch org/project/sample branding (incl. logo bytes) → render the `BrandingPreview` kind → return bytes (not persisted).
  - `exportReportAction(kind, sourceId)` — RBAC gate → gather data → resolve branding (fetch logo bytes) → render (engine) → persist (reports service). (No real `kind` exists yet; this is the entry point #3/#5 use.)
- **Branding settings actions** — logo upload + accent edit for org / project / sub-org. Service-key write **plus** an explicit `requireEffectiveRole(...owner/admin/PM)` gate (per the repo's recurring service-role-write lesson).

---

## 5. Branding model (decisions 2, 6, 7)

### Logo roles & data sources

| Role | Source | Status |
|------|--------|--------|
| ① Issuer (your org) | `organisations.logo_url` | column exists (stub) |
| ② Client / Developer | `projects.client_logo_url` | **new** |
| ③ Project / Development mark | `projects.project_logo_url` | **new** |
| ④ Contractor | sub-org's `organisations.logo_url` | exists; **resolved per-report** |

- **④ is not a fixed project field** — it is resolved at export time from the sub-org that owns the work the report is about (e.g. an inspection done by Bob's Building carries Bob's logo automatically).
- **Accent colour:** `report_accent_color` added to both `projects` (per-project override) and `organisations` (org default). Precedence: project → org → E-Site amber (`#E69500`).
- **Fallback / graceful degradation:** missing ②/③/④ are simply omitted from the parties strip (a gap in a 3-up strip reads as intentional). ① falls back to an org-name wordmark if no logo. This is *why* composition B was chosen over a paired letterhead.

### Composition (decision 7)

- **Cover:** issuer (①) leads alone at top under an accent rule; title block; a labelled "prepared for / with" **parties strip** holding ② client, ③ project mark, ④ contractor.
- **Interior page (shared by all kinds):** running header (small ① + report title + page n/N); `Section` headings; `Table` rows (e.g. pass/fail); `PhotoGrid`; `SignatureBlock`; footer (④ contractor + generated-date + version stamp).

### Settings UX (decision 6)

- **Project → General sub-page** gains a **"Branding" field-group:** ② + ③ upload tiles + accent colour + a compact "Preview" action (renders `previewBrandingAction`). ① and ④ shown as inherited/read-only with links to their homes.
- **Org Settings** → ① issuer logo + default accent.
- **Sub-organisation editor** (`/settings/sub-organizations`) → ④ each contractor's logo.
- Uploads reuse the existing `compressImage` helper + Supabase Storage upload pattern.

---

## 6. Data model & migrations (decision 3)

**Migration `00117`** (next in sequence):

- `projects.projects` — add `client_logo_url text`, `project_logo_url text`, `report_accent_color text` (all nullable).
- `public.organisations` — add `report_accent_color text` (nullable). (`logo_url` already present.)
- **New table `projects.reports`** — placed in the existing, already-exposed `projects` schema to avoid the new-schema PostgREST config-PATCH gotcha:

  | column | notes |
  |--------|-------|
  | `id uuid pk`, `organisation_id`, `project_id` | scope; `project_id` FK → `projects.projects` ON DELETE CASCADE |
  | `kind text` | `inspection` \| `snag` \| `handover` \| … (free text + app-level registry; no real kind yet) |
  | `source_table text`, `source_id uuid` | provenance (what it was generated from) |
  | `title text`, `storage_path text`, `mime_type text`, `size_bytes int` | the artifact |
  | `status text` | CHECK `('draft','issued','superseded','revoked')` |
  | `version int`, `superseded_by uuid` | re-issue chain (mirrors `inspections.certificates`) |
  | `branding_snapshot jsonb` | resolved logos (paths) + accent + names, frozen at issue |
  | `generated_by uuid`, `generated_at timestamptz`, `created_at timestamptz` | audit |

  Indexes: `(project_id)`, `(project_id, kind)`, `(source_table, source_id)`. RLS: read = `user_has_project_access(project_id)`; insert/update via service-role (actions enforce the role gate).

- **Storage buckets** (+ RLS):
  - `report-logos` — uploaded brand assets; paths `{org_id}/…` (org) and `{org_id}/{project_id}/…` (project); read = org/project members; write = settings-write roles via gated service-role action; MIME = raster images (see Risks re SVG).
  - `reports` — generated PDFs; path `{org_id}/{project_id}/{report_id}.pdf`; read = project access; write = service-role.

- **PostgREST:** columns + a table in the *existing* `projects` schema need only `NOTIFY pgrst, 'reload schema'` (no config PATCH — no new schema created). Buckets need no PostgREST change.
- **Deploy path:** migration auto-applies via `.github/workflows/deploy-migrations.yml` on merge to `main`.
- **Types:** `projects.reports` read via the service client; regen `packages/db/src/types.ts` or read via cast, consistent with existing practice.

---

## 7. Lifecycle (decision 3)

- **Export** → `issued`, `version = 1`. **Re-issue** from the same source → new row, `version + 1`, prior row set `superseded` + `superseded_by`. **Revoke** → `revoked`. (Same shape as `inspections.certificates`.)
- **`branding_snapshot`** freezes the resolved logos/accent/names at issue time, so a re-download of an older version never silently re-brands after a logo swap.
- **Download** = access gate → short-lived signed URL (as inspection certificates do today).
- **Handover/Documents linking** is deferred to #3; the row is link-ready (`source_table`/`source_id` now, a `handover_document_id` later).

---

## 8. Permissions (decision 9)

- **Export / preview** — `requireEffectiveRole` to roles that can view the source (mirrors the source page's own gate).
- **Cost sections** — any block touching `contract_value`/rates rendered only when the requester is in `COST_VIEW_ROLES` (owner/admin/PM); the engine takes a `canViewCost` flag and omits those blocks otherwise — a `client_viewer` export simply has no cost data by construction.
- **Branding upload / edit** — owner/admin/PM (existing settings-write roles), service-key + explicit role gate.
- **Download** — project-access gate + signed URL.
- Update `docs/rbac-matrix.md` in the same PR for the new branding action / any new route.

---

## 9. Testing & verification

Goal-driven: every unit has a verifiable check.

- **`resolve-branding`** (pure) — precedence, accent fallback, contractor resolution, each logo missing.
- **`render-report`** — produces non-empty valid PDF bytes for `BrandingPreview` with/without each logo; `canViewCost = false` omits cost blocks.
- **Primitives** — snapshot the react-pdf element tree.
- **Reports service** — mocked storage + db: insert, supersede chain, signed URL, revoke.
- **Settings actions** — role-gated upload (allow PM, deny `client_viewer`), file-type/size validation.
- **End-to-end verification surface under "pure infra":** the **settings branding preview** renders a sample branded cover through the real engine — the one user-visible render — proving engine + branding + resolution work before #3 exists.

---

## 10. Report-kind extension contract (for #3 / #5)

A new kind is a pure addition providing:
1. an **app-layer data-gatherer** (RBAC + fetch + `canViewCost`),
2. a react-pdf **`Document`** assembled from shared primitives,
3. **registration** in `kinds/`.

Engine, persistence, branding, and lifecycle are inherited. This interface is documented so #3 and #5 add a kind without touching the foundation.

---

## 11. Out of scope / deferred

- Real report kinds — #3 inspection export, #5 snag report (own specs).
- Retrofitting the cable-schedule / inspection-certificate PDFs onto the engine.
- Handover/Documents wiring of the `reports` row (#3).
- Multiple contractors on one report (single contractor resolved per report; revisit if a real case appears).
- Emailing reports (#5's "send with images").

---

## 12. Risks & mitigations

- **react-pdf SVG support is partial.** Logos are often SVG. Mitigation: accept raster (PNG/JPEG/WebP); rasterize SVG on upload, or restrict uploads to raster for v1. Flag for the plan.
- **Font embedding** — react-pdf needs fonts registered explicitly for brand-consistent typography; register the app font in `theme.ts`.
- **react-pdf CSS-subset limits** for unusually complex layouts — mitigated by the structured-primitives approach; revisit if a future kind needs richer layout.
- **Logo bytes in the engine** — keep fetching in the app layer (signed URLs → bytes) and pass in, so the engine stays pure/deterministic and CI tests need no network.
