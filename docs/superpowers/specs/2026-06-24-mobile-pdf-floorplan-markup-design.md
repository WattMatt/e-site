# Mobile PDF floor-plan markup — design

**Date:** 2026-06-24
**Branch:** `fix/rfi-email-all-members` (per user choice; change is self-contained in `apps/mobile/`)
**Mirrors:** web PDF markup on `feat/rfi-pdf-floorplan-markup` (PR #100)

## Problem

The web RFI "Attach floor plan" picker supports PDF floor plans: it rasterises a
chosen PDF page to an image and feeds it to the (image-only) annotator, storing
`AnnotationData.sourcePageIndex` so re-edit can re-rasterise the same page.

The Expo mobile picker is still image-only:

- `apps/mobile/src/components/attachments/FloorPlanAttachModal.tsx:64` filters with
  `/\.(png|jpe?g|webp|heic)$/i`, excluding PDFs.
- `:132-135` shows misleading empty-state copy ("No image floor plans / Upload a
  PNG or JPG…").

Goal: let mobile users attach + mark up PDF floor plans on an RFI, matching web.

## Decision: client-side native rasterisation

Use **`react-native-pdf-page-image`** (iOS PDFKit / Android PdfRenderer) to render a
PDF page to an image file on-device, then feed that image to the **existing,
unchanged** `react-native-skia` annotator. This mirrors web's architecture
(rasterise page → image annotator).

Rejected: a server-side Supabase edge function (Deno + wasm PDF engine). Cleaner
long-term but adds backend infra on the single prod Supabase, multi-MB wasm with
edge memory/cold-start risk, deploy round-trips, no offline PDF markup, and expands
scope to re-wiring web. Out of scope for "match web on mobile".

### Library notes / risk

- `react-native-pdf-page-image@0.2.1` exposes:
  - `open(uri) → { uri, pageCount }` — cheap page count for the picker.
  - `generate(uri, page, scale?) → { uri, width, height }` — renders one page to an
    image file URI.
  - `generateAllPages`, `close(uri)` — also available.
- It is a **legacy-bridge native module** (no `codegenConfig`), so it relies on
  RN 0.76's new-architecture **interop layer** (the app has `newArchEnabled: true`).
  This is the primary risk and is de-risked first (see Sequencing).
- Adding the module **invalidates the current dev-client build**; verification needs
  a rebuilt simulator/dev-client build (`expo prebuild` + `expo run:ios`).
- Native renderers want a **local file path**, not a tokenised remote URL, so signed
  PDF URLs are downloaded to the cache first.

## Components

### 1. `apps/mobile/src/lib/pdf-raster.ts` (new)

Mobile mirror of web's `apps/web/src/lib/pdf-raster.ts`. Same shape; returns a file
URI instead of a data URL.

```ts
export interface RasterisedPage { uri: string; width: number; height: number }
export interface LoadedPdf {
  numPages: number
  renderPage: (pageNum: number, scale?: number) => Promise<RasterisedPage>
  close: () => Promise<void>   // delete cached PDF + any temp page images
}
export function loadPdfForRaster(signedUrl: string): Promise<LoadedPdf>
export function isPdfPath(path: string): boolean   // /\.pdf$/i
export function isImagePath(path: string): boolean // /\.(png|jpe?g|webp|heic|svg)$/i
```

Implementation:
1. `FileSystem.downloadAsync(signedUrl, <cache file>.pdf)` → local file URI.
2. `PdfPageImage.open(localUri)` → `numPages = pageCount`.
3. `renderPage(n, scale = 2)` → `PdfPageImage.generate(localUri, n, scale)` →
   `{ uri, width, height }`. Scale 2 matches web.
4. `close()` → `PdfPageImage.close(localUri)` (best effort) + delete the cached PDF.

### 2. `apps/mobile/src/components/attachments/types.ts`

Add `sourcePageIndex?: number` to `AnnotationData`, mirroring web. JSONB round-trips
through `commit.ts` (stored as opaque `Json`) — no commit-layer change.

### 3. `apps/mobile/src/components/attachments/FloorPlanAttachModal.tsx` (main work)

Mirror `FloorPlanAttachDialog.tsx`:

- **List:** include PDFs — `isImagePath(file_path) || isPdfPath(file_path)`; drop the
  image-only regex. Sign each, tag `isPdf`.
- **Tiles:** PDF tiles show a "PDF" placeholder (the pattern already used in
  `AttachmentGallery`); image tiles keep the `<Image>` thumbnail.
- **Pick:**
  - image → open annotator directly with the signed URL (current behaviour).
  - PDF → `loadPdfForRaster(signedUrl)`; if `numPages === 1`, render page 1 and open
    the annotator; if `> 1`, show a "Page N" button grid (mirrors web — page
    thumbnails are an explicit non-goal: `generateAllPages` would render every page).
- **Active source** tracks `{ url, floorPlanId, name, pageIndex? }` where `url` is the
  rasterised page's local file URI for PDFs.
- **Save wrapper (`onStage`):** for PDF sources (pageIndex set), rewrite
  `annotationData` to `{ ...data, sourcePageIndex: pageIndex, baseImage: { ...data.baseImage, signedUrl: undefined } }`
  — exactly web's logic. Do not persist the transient rasterised file. (The annotator
  builds `annotationData` and sets `baseImage.signedUrl` to the local URI; this wrapper
  overwrites it. Annotator stays unchanged.)
- **Re-edit:** when `initial.annotationData.sourcePageIndex` is set, rasterise that
  page from `initial.sourceImageUrl` (the signed source PDF, provided by
  `AttachmentGallery.handleReEdit`) before opening the annotator — mirrors web's
  re-edit `useEffect`. Otherwise feed `initial.sourceImageUrl` directly (image case).
- **Loading / error:** "Preparing PDF…" state and inline error text, mirroring web.
- **Cleanup:** call `LoadedPdf.close()` (best effort) on unmount / when leaving the
  PDF source, to avoid cache-file bloat.
- **Empty-state copy fix:** "No floor plans found" / "Upload a floor plan (PDF, PNG or
  JPG) to this project from the web to mark it up here."

### Unchanged

- `FloorPlanAnnotator.tsx` — loads the rasterised page's file URI via `useImage` like
  any image; existing shape-rescale-on-resize logic handles dimension changes on
  re-edit.
- `commit.ts` / `AttachmentGallery.tsx` — `annotation_data` is opaque JSONB, so
  `sourcePageIndex` round-trips; re-edit already signs the source floor plan's
  `file_path` (the PDF) and passes its URL as `sourceImageUrl`.

## Known limitation (consistent with web)

A PDF markup whose **source floor plan was deleted** can't be re-edited: we drop the
rasterised image from the scene graph, and re-edit relies on the source PDF still
existing. `AttachmentGallery.handleReEdit` already shows "Source floor plan is no
longer accessible." for this case. Same behaviour as web — acceptable.

## Sequencing (diagnostics-first)

1. **De-risk the native module before any UI.** Install `react-native-pdf-page-image`,
   `expo prebuild`, rebuild the iOS dev client, and smoke-test `open()` + `generate()`
   on a real PDF (a throwaway screen or log). If it doesn't work under the new-arch
   interop layer, we find out here — not after building the UI.
2. `pdf-raster.ts` module + `isPdfPath`/`isImagePath`.
3. `types.ts` — add `sourcePageIndex?`.
4. `FloorPlanAttachModal.tsx` — list PDFs, page picker, rasterise on pick, store
   `sourcePageIndex`, PDF re-edit, loading/error/cleanup, empty-state copy.
5. Verify on the simulator (below).

## Verification

On the iOS simulator with a multi-page PDF floor plan uploaded to a project:

1. The attach-floor-plan picker lists the PDF plan (with a PDF tile).
2. Single-page PDF: picking opens straight into the annotator on the rendered page.
3. Multi-page PDF: picking shows the "Page N" grid; choosing a page renders it.
4. Marking up + Save stages a markup attachment (PNG snapshot) on the RFI.
5. The saved markup persists; the gallery shows it with the MARKUP badge.
6. Re-editing the saved PDF markup re-rasterises the **same** page and reopens the
   annotator with the prior shapes.
7. `type-check` and `lint` pass for `apps/mobile`.
