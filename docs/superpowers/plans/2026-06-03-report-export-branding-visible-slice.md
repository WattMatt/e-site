# Report Export + Branding — Visible Slice (PR-B engine + PR-D preview)

> **For agentic workers:** Execute with superpowers:subagent-driven-development. Steps use `- [ ]` tracking. This plan is design-level (file structure + interfaces + the locked composition + test expectations); implementer subagents write the react-pdf/TS code by following the cited existing patterns. Spec: [`../specs/2026-06-03-standardized-report-export-branding-design.md`](../specs/2026-06-03-standardized-report-export-branding-design.md).

**Goal:** A branded PDF cover, rendered through the real engine from a project's branding (including an uploaded logo), opened from **Project Settings → General → "Preview branding"**. This is the "see it in action" milestone.

**Scope:** PR-B (engine) + PR-D preview path only. **Deferred** (invisible without a real report kind): PR-C persistence (`reports.service`), PR-E `exportReportAction` + reports list.

**Deviation from spec (flagged):** the engine lives in `apps/web/src/lib/reports/`, not `packages/shared` — web-only consumer; keeps `@react-pdf/renderer` out of the mobile-shared package. Promote to `shared` later if ever shared.

**Tech:** `@react-pdf/renderer` server-side (`renderToBuffer`); a Next.js **Node-runtime** route handler streams the PDF; existing settings-form + storage-upload + `requireEffectiveRole` patterns.

**Locked composition (from the brainstorm mockups):** issuer-led cover — ① issuer logo top-left beneath a 3px accent rule; kicker ("ELECTRICAL INSPECTION") + bold title + "Project — Phase · date"; a light "PREPARED FOR / WITH" **parties strip** holding ② client, ③ project mark, ④ contractor as three side-by-side logo slots (omit any that's missing); footer with a generated/version stamp. Sample body = a few lorem lines under a faint diagonal **"PREVIEW"** watermark. Accent precedence: project `report_accent_color` → org `report_accent_color` → `#E69500`.

---

## Existing patterns to follow (implementers: read these first)

- **Settings General form + project update:** `apps/web/src/app/(admin)/projects/[id]/settings/general/` (`GeneralForm.tsx`, `page.tsx`) + the project update server action it calls. Match the react-hook-form + `StickySaveBar` + `useDirtyForm` pattern.
- **Image upload + compression:** `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/fields/useFieldPhotos.ts` (`compressImage`) + the `POST /api/inspections/upload-photo` route → adapt for logos (bucket `report-logos`, path `{org_id}/{project_id}/...`).
- **Role gating:** `requireEffectiveRole` / `requireRolePage` / `requireRoleAPI` from `@/lib/auth/require-role`; `ORG_WRITE_ROLES` from `@esite/shared`. Service-role writes use `createServiceClient()`; `projects`-schema access via `(supabase as any).schema('projects')` (types not regen'd — PR-A).
- **DB (live, from PR-A `00117`):** `projects.projects.{client_logo_url, project_logo_url, report_accent_color}`, `public.organisations.{logo_url, report_accent_color}`, buckets `report-logos` (raster, 5 MiB) + `reports`.
- **Web tests:** `apps/web/vitest.config.ts`; action tests use the `vi.hoisted(() => ({...}))` mock pattern (see `inspections.actions.test.ts`).

---

## Task 1: Install the renderer

- [ ] **Step 1:** `pnpm --filter web add @react-pdf/renderer`
- [ ] **Step 2:** verify it resolves: `pnpm --filter web list @react-pdf/renderer` shows a version. Commit `package.json` + lockfile: `git add apps/web/package.json pnpm-lock.yaml && git commit -m "build(web): add @react-pdf/renderer for report engine"`.

## Task 2: Engine — theme + pure branding resolver (TDD)

**Files:** Create `apps/web/src/lib/reports/theme.ts`, `apps/web/src/lib/reports/branding.ts`, `apps/web/src/lib/reports/branding.test.ts`.

- [ ] **Step 1 (test first):** write `branding.test.ts` for a pure `resolveBranding(input)`:
  - accent precedence: project hex wins; falls back to org hex; falls back to `#E69500`.
  - parties array excludes any logo whose `src` is null/undefined (so missing ②/③/④ are dropped).
  - issuer falls back to `{ wordmark: org.name }` when `org.logo_url` is null.
- [ ] **Step 2:** run the test, confirm it fails (module missing).
- [ ] **Step 3:** implement `theme.ts` (accent resolver + spacing/size tokens + register a font if needed) and `branding.ts`:
  - `interface BrandingInput { org: {name; logoSrc?: string|null; accent?: string|null}; project: {name; clientLogoSrc?; projectMarkSrc?; accent?: string|null; subtitle?: string}; contractor?: {name; logoSrc?: string|null} | null; title: string; kicker: string; date: string }`
  - `interface ResolvedBranding { accent: string; issuer: {logoSrc?: string; wordmark?: string}; parties: Array<{label: string; logoSrc: string}>; title; kicker; projectLine; footerStamp }`
  - `resolveBranding` is **pure** — it takes already-resolved logo `src`s (URLs) and returns the normalized shape with fallbacks/precedence applied. No Supabase, no async.
- [ ] **Step 4:** run tests → green. **Step 5:** commit.

## Task 3: Engine — react-pdf components + render (TDD)

**Files:** Create `apps/web/src/lib/reports/components.tsx`, `apps/web/src/lib/reports/branding-preview.tsx`, `apps/web/src/lib/reports/render.ts`, `apps/web/src/lib/reports/render.test.ts`.

- [ ] **Step 1 (test first):** `render.test.ts` — `renderBrandingPreview(resolved)` returns a Buffer whose first 5 bytes are `%PDF-`; assert it renders both with a full `parties` array and with an empty one (no throw). Mock/remote images: pass `logoSrc` as a `data:` URI in the test so no network.
- [ ] **Step 2:** run → fails.
- [ ] **Step 3:** implement:
  - `components.tsx` — react-pdf primitives (`Document` is assembled in branding-preview): `Cover` (the locked composition: accent rule, issuer logo/wordmark, kicker/title/projectLine, parties strip via `<Image>` per party, footer stamp), `Watermark` ("PREVIEW" diagonal, low opacity), `PreviewBody` (lorem lines). Use `StyleSheet.create`; accent applied from `resolved.accent`. `<Image src={logoSrc} />` for logos.
  - `branding-preview.tsx` — `BrandingPreviewDocument({ resolved })` = `<Document><Page size="A4">…Cover + Watermark + PreviewBody…</Page></Document>`.
  - `render.ts` — `export async function renderBrandingPreview(resolved): Promise<Buffer> { return renderToBuffer(<BrandingPreviewDocument resolved={resolved}/>) }` (import `renderToBuffer` from `@react-pdf/renderer`).
- [ ] **Step 4:** tests → green. **Step 5:** commit.

## Task 4: Branding write actions (TDD)

**Files:** Create `apps/web/src/actions/branding.actions.ts`, `apps/web/src/actions/branding.actions.test.ts`.

- [ ] **Step 1 (test first):** assert `requireEffectiveRole(... ORG_WRITE_ROLES)` is enforced — a `project_manager` is allowed, a `client_viewer` is rejected — for both `uploadProjectLogoAction` and `updateProjectAccentAction`; assert the project column is set on success. Use the `vi.hoisted` mock pattern; mock `createServiceClient`, the storage upload, and `requireEffectiveRole`.
- [ ] **Step 2:** run → fails.
- [ ] **Step 3:** implement `branding.actions.ts` (`'use server'`):
  - `uploadProjectLogoAction(projectId, slot: 'client'|'project', file)` — resolve project→org, `guardProjectAccess` + `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)`, upload (service client) to `report-logos` at `{org_id}/{project_id}/{slot}-logo.{ext}`, set `projects.projects.{client_logo_url|project_logo_url}` to the storage path; `revalidatePath`.
  - `updateProjectAccentAction(projectId, hex)` — same gate; validate `^#[0-9A-Fa-f]{6}$`; set `report_accent_color`.
- [ ] **Step 4:** tests → green. **Step 5:** commit.

## Task 5: Preview route + settings UI

**Files:** Create `apps/web/src/app/api/projects/[id]/branding-preview/route.ts`; create `apps/web/src/app/(admin)/projects/[id]/settings/general/_BrandingFields.tsx` and wire it into the General page/form.

- [ ] **Step 1:** route handler (GET, `export const runtime = 'nodejs'`): `requireRoleAPI`-style access gate for the project; fetch project + org (+ a sample contractor name); for each stored logo path, create a short-lived **signed URL** from `report-logos` (service client); call `resolveBranding(...)` then `renderBrandingPreview(...)`; return the Buffer with `Content-Type: application/pdf` + `Content-Disposition: inline`.
- [ ] **Step 2:** `_BrandingFields.tsx` (client): two upload tiles (client ②, project mark ③) using `compressImage` + `uploadProjectLogoAction`; an accent color input bound to `updateProjectAccentAction`; a **"Preview branding"** button that opens `/api/projects/${id}/branding-preview` in a new tab. Render inherited ① (org) and ④ (per-report) as read-only notes. Wire into the General settings page beneath the existing fields (a "Branding" sub-heading), following the existing layout.
- [ ] **Step 3:** `pnpm --filter web type-check` clean; commit.

## Task 6: See it in action (browser verification)

- [ ] **Step 1:** start the dev server (preview_start).
- [ ] **Step 2:** navigate to a project's `…/settings/general`, upload a client logo, set an accent, click **Preview branding**.
- [ ] **Step 3:** confirm the branded cover PDF renders (issuer-led + parties strip + accent + the uploaded logo); capture a screenshot. Check `preview_console_logs` / server logs for errors; fix source and re-verify if needed.

## Task 7: One full push

- [ ] **Step 1:** final `pnpm --filter web type-check` + `pnpm --filter web test` green.
- [ ] **Step 2:** push the branch over the gh-token HTTPS remote and (optionally) open a PR — **only on the user's go-ahead.**

---

## Verification (the milestone)
Dev server → `/projects/[id]/settings/general` → upload client logo + accent → **Preview branding** → branded cover PDF opens (issuer-led, parties strip, accent, real logo). Screenshot captured. Then push.
