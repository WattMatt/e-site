# Mobile PDF floor-plan markup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let mobile users attach + mark up PDF floor plans on an RFI, matching the web picker.

**Architecture:** Rasterise a chosen PDF page to an image on-device (iOS PDFKit / Android PdfRenderer via `react-native-pdf-page-image`), then feed that image to the existing, unchanged `react-native-skia` annotator. Store `AnnotationData.sourcePageIndex` so re-edit re-rasterises the same page. Mirrors the web implementation (which uses pdfjs in the browser).

**Tech Stack:** Expo SDK 52 / React Native 0.76 (new architecture), `react-native-pdf-page-image`, `expo-file-system`, `@shopify/react-native-skia`, vitest (pure-logic unit tests), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-06-24-mobile-pdf-floorplan-markup-design.md`
**Branch:** `fix/rfi-email-all-members` (change is self-contained in `apps/mobile/`).

---

## File Structure

- **Create** `apps/mobile/src/lib/pdf-raster.ts` — on-device PDF rasteriser + path helpers + the `withPdfSource` save transform. Native imports are **lazy** (inside `loadPdfForRaster`) so the pure helpers import cleanly under plain-node vitest.
- **Create** `apps/mobile/src/__tests__/pdf-raster.test.ts` — vitest unit tests for `isPdfPath` / `isImagePath` / `withPdfSource` (pure functions only).
- **Modify** `apps/mobile/src/components/attachments/types.ts` — add `sourcePageIndex?: number` to `AnnotationData`.
- **Modify** `apps/mobile/src/components/attachments/FloorPlanAttachModal.tsx` — list PDFs, page picker, rasterise on pick, store `sourcePageIndex`, PDF re-edit, loading/error/cleanup, empty-state copy.
- **Add dependency** `react-native-pdf-page-image` to `apps/mobile/package.json`.
- **Unchanged:** `FloorPlanAnnotator.tsx`, `commit.ts`, `AttachmentGallery.tsx`.

---

## Task 1: De-risk the native module (install, prebuild, boot)

The library is a legacy-bridge native module (no `codegenConfig`), so it relies on RN 0.76's new-architecture **interop layer**. Adding it invalidates the current dev-client build. Validate it links and the app boots *before* writing any consuming code.

**Files:**
- Modify: `apps/mobile/package.json` (dependency added by the package manager)

- [ ] **Step 1: Install the dependency**

Run from the repo root:
```bash
pnpm --filter mobile add react-native-pdf-page-image
```
Expected: `react-native-pdf-page-image` appears under `dependencies` in `apps/mobile/package.json` and resolves in `apps/mobile/node_modules`.

- [ ] **Step 2: Prebuild + build + launch the iOS dev client**

Run from the repo root:
```bash
pnpm --filter mobile ios
```
(That runs `expo run:ios`, which prebuilds the native project, runs `pod install`, builds, and launches the simulator.)
Expected: the app **builds and boots** in the simulator without a redbox/crash. Booting with the module autolinked confirms the new-arch interop layer accepts it.

- [ ] **Step 3: STOP-and-reassess gate**

If Step 2 fails to build or the app crashes on boot because of this module, STOP. Do not proceed to UI work. Reassess the library (fallback candidate: `react-native-pdf-thumbnail`, which exposes `generate(filePath, page, quality)` / `generateAllPages`) and update the spec before continuing. This is the two-strike guard for the native risk.

- [ ] **Step 4: Commit the dependency**

```bash
git add apps/mobile/package.json pnpm-lock.yaml
git commit -m "build(mobile): add react-native-pdf-page-image for PDF floor-plan rasterisation"
```

---

## Task 2: PDF raster module + pure-logic tests (TDD)

**Files:**
- Create: `apps/mobile/src/lib/pdf-raster.ts`
- Test: `apps/mobile/src/__tests__/pdf-raster.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/__tests__/pdf-raster.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isPdfPath, isImagePath, withPdfSource } from '../lib/pdf-raster'
import type { AnnotationData } from '../components/attachments/types'

describe('isPdfPath / isImagePath', () => {
  it('detects PDFs (case-insensitive)', () => {
    expect(isPdfPath('plans/level-1.pdf')).toBe(true)
    expect(isPdfPath('plans/LEVEL-1.PDF')).toBe(true)
    expect(isPdfPath('plans/level-1.png')).toBe(false)
  })

  it('detects annotator-loadable images', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'heic', 'svg']) {
      expect(isImagePath(`plan.${ext}`)).toBe(true)
    }
    expect(isImagePath('plan.pdf')).toBe(false)
  })
})

describe('withPdfSource', () => {
  const base: AnnotationData = {
    version: 1,
    canvas: { width: 100, height: 80 },
    baseImage: { naturalWidth: 200, naturalHeight: 160, signedUrl: 'file:///tmp/page.png' },
    shapes: [],
  }

  it('stamps the source page and drops the transient rasterised image', () => {
    const out = withPdfSource(base, 3)
    expect(out.sourcePageIndex).toBe(3)
    expect(out.baseImage.signedUrl).toBeUndefined()
    expect(out.baseImage.naturalWidth).toBe(200) // natural dims preserved
    expect(out.shapes).toBe(base.shapes)          // shapes preserved
  })

  it('does not mutate the input', () => {
    withPdfSource(base, 1)
    expect(base.sourcePageIndex).toBeUndefined()
    expect(base.baseImage.signedUrl).toBe('file:///tmp/page.png')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from the repo root:
```bash
cd apps/mobile && pnpm vitest run src/__tests__/pdf-raster.test.ts
```
Expected: FAIL — cannot resolve `../lib/pdf-raster` (module not created yet).

- [ ] **Step 3: Create the raster module**

Create `apps/mobile/src/lib/pdf-raster.ts`:
```ts
/**
 * On-device PDF rasteriser — renders a PDF page to an image file so the
 * (image-only) Skia annotator can mark up PDF floor plans. Mobile mirror of
 * apps/web/src/lib/pdf-raster.ts (browser/pdfjs); here we use
 * react-native-pdf-page-image (iOS PDFKit / Android PdfRenderer).
 *
 * Native deps are imported lazily inside loadPdfForRaster so the pure helpers
 * below stay importable under plain-node vitest.
 */
import type { AnnotationData } from '../components/attachments/types'

export interface RasterisedPage {
  uri: string
  width: number
  height: number
}

export interface LoadedPdf {
  numPages: number
  /** Rasterise a 1-based page to an image file URI at the given scale (default 2×). */
  renderPage: (pageNum: number, scale?: number) => Promise<RasterisedPage>
  /** Best-effort cleanup of the downloaded PDF + any temp page images. */
  close: () => Promise<void>
}

/** True if a floor-plan file path / name points at a PDF. */
export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path)
}

/** True if a floor-plan file path is an image the Skia annotator can load directly. */
export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|heic|svg)$/i.test(path)
}

/**
 * For a PDF-rasterised markup: stamp the 1-based source page and drop the
 * transient rasterised image from the scene graph (re-edit re-rasterises from
 * the source PDF — we don't persist the large rasterised image). Mirrors the
 * web dialog's save logic.
 */
export function withPdfSource(data: AnnotationData, pageIndex: number): AnnotationData {
  return {
    ...data,
    sourcePageIndex: pageIndex,
    baseImage: { ...data.baseImage, signedUrl: undefined },
  }
}

/** Download a (signed) PDF URL and prepare it for page rasterisation. */
export async function loadPdfForRaster(signedUrl: string): Promise<LoadedPdf> {
  const FileSystem = await import('expo-file-system')
  const { default: PdfPageImage } = await import('react-native-pdf-page-image')

  // Native renderers want a local file path, not a tokenised remote URL.
  const localPath = `${FileSystem.cacheDirectory}floorplan-${Date.now()}.pdf`
  const { uri: localUri } = await FileSystem.downloadAsync(signedUrl, localPath)

  const { pageCount } = await PdfPageImage.open(localUri)

  return {
    numPages: pageCount,
    async renderPage(pageNum, scale = 2) {
      const { uri, width, height } = await PdfPageImage.generate(localUri, pageNum, scale)
      return { uri, width, height }
    },
    async close() {
      try { await PdfPageImage.close(localUri) } catch { /* best effort */ }
      try { await FileSystem.deleteAsync(localUri, { idempotent: true }) } catch { /* best effort */ }
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd apps/mobile && pnpm vitest run src/__tests__/pdf-raster.test.ts
```
Expected: PASS (all 4 tests).

- [ ] **Step 5: (Recommended) native smoke-test open() + generate()**

This exercises the real native path (download → `open` → `generate`, and whether the module accepts a `file://` URI) before the UI depends on it. Temporarily add to `apps/mobile/app/_layout.tsx` inside the root component body, replacing `<PASTE_SIGNED_PDF_URL>` with a signed URL of a real PDF floor plan (grab one from the web app's network tab or Supabase Storage):
```ts
import { useEffect } from 'react'
import { loadPdfForRaster } from '../src/lib/pdf-raster'
// ...inside the component:
useEffect(() => {
  if (!__DEV__) return
  ;(async () => {
    try {
      const pdf = await loadPdfForRaster('<PASTE_SIGNED_PDF_URL>')
      console.log('[pdf-smoke] numPages', pdf.numPages)
      const page = await pdf.renderPage(1)
      console.log('[pdf-smoke] page1', page)
      await pdf.close()
    } catch (e) {
      console.warn('[pdf-smoke] failed', e)
    }
  })()
}, [])
```
Expected (Metro logs): `[pdf-smoke] numPages <N>` and `[pdf-smoke] page1 { uri: 'file://…', width: …, height: … }`. If `generate` throws on the `file://` scheme, change `localUri` usages in `loadPdfForRaster` to strip the prefix (`localUri.replace('file://', '')`) and re-run. **Remove this temporary block before committing.**

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/pdf-raster.ts apps/mobile/src/__tests__/pdf-raster.test.ts
git commit -m "feat(mobile): on-device PDF floor-plan rasteriser + helpers"
```

---

## Task 3: Add `sourcePageIndex` to the mobile annotation type

**Files:**
- Modify: `apps/mobile/src/components/attachments/types.ts:10-15`

- [ ] **Step 1: Add the field**

In `apps/mobile/src/components/attachments/types.ts`, change the `AnnotationData` interface from:
```ts
export interface AnnotationData {
  version: 1
  canvas: { width: number; height: number }
  baseImage: { naturalWidth: number; naturalHeight: number; signedUrl?: string }
  shapes: AnnotationShape[]
}
```
to:
```ts
export interface AnnotationData {
  version: 1
  canvas: { width: number; height: number }
  baseImage: { naturalWidth: number; naturalHeight: number; signedUrl?: string }
  shapes: AnnotationShape[]
  /**
   * For PDF-sourced markups: the 1-based page that was rasterised. Lets re-edit
   * re-rasterise the same page from the source PDF (we don't persist the large
   * rasterised image in JSONB). Absent for image-sourced markups. Mirrors web.
   */
  sourcePageIndex?: number
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
pnpm --filter mobile type-check
```
Expected: PASS (no new errors). The `pdf-raster.ts` test from Task 2 already references this field, so this also keeps the type consistent.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/attachments/types.ts
git commit -m "feat(mobile): add AnnotationData.sourcePageIndex (PDF page provenance)"
```

---

## Task 4: Wire PDFs into the attach-floor-plan modal

Rewrite `FloorPlanAttachModal.tsx` to mirror the web `FloorPlanAttachDialog.tsx`: list PDFs, page picker for multi-page, rasterise on pick, store `sourcePageIndex`, PDF re-edit, loading/error/cleanup, and corrected empty-state copy. The Skia annotator is unchanged (it loads the rasterised file URI like any image).

**Files:**
- Modify: `apps/mobile/src/components/attachments/FloorPlanAttachModal.tsx` (full rewrite)

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `apps/mobile/src/components/attachments/FloorPlanAttachModal.tsx` with:
```tsx
import { useEffect, useRef, useState } from 'react'
import {
  View, Text, Image, TouchableOpacity, ScrollView,
  ActivityIndicator, Modal, StyleSheet, useWindowDimensions,
} from 'react-native'
import type { TypedSupabaseClient } from '@esite/db'
import { colors, fontSize, fontWeight, radius, spacing } from '../../theme'
import { FloorPlanAnnotator } from './FloorPlanAnnotator'
import {
  loadPdfForRaster, isPdfPath, isImagePath, withPdfSource, type LoadedPdf,
} from '../../lib/pdf-raster'
import type { AnnotationData, StagedAttachment } from './types'

interface FloorPlan {
  id: string
  name: string
  level: string | null
  file_path: string
  signedUrl?: string
  isPdf?: boolean
}

// What gets fed to the (image-only) annotator: an image URL or a rasterised
// PDF-page file URI, plus the page it came from (for PDF re-edit).
interface AnnotatorSource {
  url: string
  floorPlanId: string | null
  name: string
  pageIndex?: number
}

interface Props {
  visible: boolean
  projectId: string
  client: TypedSupabaseClient
  onClose: () => void
  onStage: (staged: Extract<StagedAttachment, { kind: 'annotation' }>) => void
  // If supplied, opens the annotator straight into re-edit mode.
  initial?: {
    sourceFloorPlanId: string | null
    sourceImageUrl: string
    floorPlanName: string
    annotationData: AnnotationData
  }
}

const planLabel = (p: { name: string; level: string | null }) =>
  `${p.name}${p.level ? ` · ${p.level}` : ''}`

export function FloorPlanAttachModal({
  visible, projectId, client, onClose, onStage, initial,
}: Props) {
  const [plans, setPlans] = useState<FloorPlan[]>([])
  const [loading, setLoading] = useState(!initial)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<FloorPlan | null>(null)
  const [pdfPages, setPdfPages] = useState<number | null>(null) // >1 → show page picker
  const [preparing, setPreparing] = useState(false)
  const [annotatorSource, setAnnotatorSource] = useState<AnnotatorSource | null>(null)
  const pdfRef = useRef<LoadedPdf | null>(null)
  const { width: winW } = useWindowDimensions()

  const columns = winW >= 1024 ? 4 : winW >= 700 ? 3 : 2
  // 2*list padding + (columns-1)*gap = total gutter
  const cardWidth = Math.floor((winW - 2 * spacing.lg - (columns - 1) * spacing.md) / columns)

  // ── Re-edit: prepare the source (rasterise the stored PDF page if any) ──
  useEffect(() => {
    if (!visible || !initial) return
    let cancelled = false
    ;(async () => {
      const pageIndex = initial.annotationData.sourcePageIndex
      if (pageIndex) {
        try {
          setPreparing(true)
          const pdf = await loadPdfForRaster(initial.sourceImageUrl)
          pdfRef.current = pdf
          const { uri } = await pdf.renderPage(pageIndex)
          if (!cancelled) {
            setAnnotatorSource({ url: uri, floorPlanId: initial.sourceFloorPlanId, name: initial.floorPlanName, pageIndex })
          }
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load PDF page')
        } finally {
          if (!cancelled) setPreparing(false)
        }
      } else {
        setAnnotatorSource({ url: initial.sourceImageUrl, floorPlanId: initial.sourceFloorPlanId, name: initial.floorPlanName })
      }
    })()
    return () => { cancelled = true }
  }, [visible, initial])

  // ── List floor plans (images + PDFs) ──
  useEffect(() => {
    if (!visible || initial) return
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      const { data, error } = await client
        .schema('tenants')
        .from('floor_plans')
        .select('id, name, level, file_path')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (error) { setError(error.message); setLoading(false); return }
      const rows = (data ?? []) as FloorPlan[]

      // Annotatable plans: images AND PDFs (rasterised on pick).
      const supported = rows.filter(r => isImagePath(r.file_path) || isPdfPath(r.file_path))
      const signed = await Promise.all(
        supported.map(async r => {
          const { data: s } = await client.storage.from('drawings').createSignedUrl(r.file_path, 60 * 60)
          return { ...r, signedUrl: s?.signedUrl, isPdf: isPdfPath(r.file_path) }
        }),
      )
      if (!cancelled) { setPlans(signed); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [visible, initial, projectId, client])

  // Best-effort cache cleanup when the modal unmounts.
  useEffect(() => () => { pdfRef.current?.close() }, [])

  async function handlePick(plan: FloorPlan) {
    if (!plan.signedUrl) return
    setError(null)
    if (!plan.isPdf) {
      setAnnotatorSource({ url: plan.signedUrl, floorPlanId: plan.id, name: planLabel(plan) })
      return
    }
    // PDF — load the document, then rasterise (single page) or offer a page picker.
    setPicked(plan)
    setPreparing(true)
    try {
      const pdf = await loadPdfForRaster(plan.signedUrl)
      pdfRef.current = pdf
      if (pdf.numPages === 1) {
        const { uri } = await pdf.renderPage(1)
        setAnnotatorSource({ url: uri, floorPlanId: plan.id, name: planLabel(plan), pageIndex: 1 })
      } else {
        setPdfPages(pdf.numPages)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open PDF floor plan')
    } finally {
      setPreparing(false)
    }
  }

  async function handlePagePick(pageNum: number) {
    if (!pdfRef.current || !picked) return
    setPreparing(true)
    try {
      const { uri } = await pdfRef.current.renderPage(pageNum)
      setAnnotatorSource({ url: uri, floorPlanId: picked.id, name: planLabel(picked), pageIndex: pageNum })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to render PDF page')
    } finally {
      setPreparing(false)
    }
  }

  function resetPicker() {
    setAnnotatorSource(null)
    setPicked(null)
    setPdfPages(null)
    pdfRef.current?.close()
    pdfRef.current = null
  }

  if (!visible) return null

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {annotatorSource ? (
          <FloorPlanAnnotator
            floorPlanName={annotatorSource.name}
            sourceImageUrl={annotatorSource.url}
            sourceFloorPlanId={annotatorSource.floorPlanId}
            initialAnnotation={initial?.annotationData}
            onCancel={() => {
              if (initial) { pdfRef.current?.close(); onClose() }
              else resetPicker()
            }}
            onSave={({ uri, annotationData, fileName }) => {
              // For PDF sources, record the page and drop the (transient)
              // rasterised image — re-edit re-rasterises from the source PDF.
              const finalData = annotatorSource.pageIndex
                ? withPdfSource(annotationData, annotatorSource.pageIndex)
                : annotationData
              onStage({
                kind: 'annotation',
                id: Math.random().toString(36).slice(2, 10),
                uri,
                mimeType: 'image/png',
                fileName,
                sourceFloorPlanId: annotatorSource.floorPlanId,
                annotationData: finalData,
              })
              pdfRef.current?.close()
              setPicked(null)
              onClose()
            }}
          />
        ) : (
          <>
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose}>
                <Text style={styles.backText}>← Cancel</Text>
              </TouchableOpacity>
              <Text style={styles.headerTitle}>
                {pdfPages && pdfPages > 1 ? 'Pick a page' : 'Pick a floor plan'}
              </Text>
              <View style={{ width: 60 }} />
            </View>

            <ScrollView contentContainerStyle={styles.list}>
              {(loading || preparing) && (
                <ActivityIndicator color={colors.amber} style={{ marginTop: spacing.xl }} />
              )}
              {error && <Text style={styles.error}>{error}</Text>}

              {/* Multi-page PDF — page picker */}
              {!preparing && pdfPages && pdfPages > 1 && (
                <View style={styles.pageGrid}>
                  {Array.from({ length: pdfPages }, (_, idx) => idx + 1).map(n => (
                    <TouchableOpacity key={n} style={styles.pageBtn} onPress={() => handlePagePick(n)}>
                      <Text style={styles.pageBtnText}>Page {n}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Empty state */}
              {!loading && !preparing && !pdfPages && !error && plans.length === 0 && (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No floor plans found</Text>
                  <Text style={styles.emptyDesc}>
                    Upload a floor plan (PDF, PNG or JPG) to this project from the web to mark it up here.
                  </Text>
                </View>
              )}

              {/* Plan grid */}
              {!loading && !preparing && !pdfPages && plans.length > 0 && (
                <View style={styles.grid}>
                  {plans.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => handlePick(p)}
                      style={[styles.card, { width: cardWidth }]}
                    >
                      {p.isPdf ? (
                        <View style={[styles.cardThumb, styles.thumbPlaceholder]}>
                          <Text style={styles.pdfBadge}>PDF</Text>
                        </View>
                      ) : p.signedUrl ? (
                        <Image source={{ uri: p.signedUrl }} style={styles.cardThumb} />
                      ) : (
                        <View style={[styles.cardThumb, styles.thumbPlaceholder]} />
                      )}
                      <View style={styles.cardBody}>
                        <Text style={styles.cardName} numberOfLines={1}>{p.name}</Text>
                        {p.level && <Text style={styles.cardLevel}>{p.level}</Text>}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </ScrollView>
          </>
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: 56, paddingBottom: spacing.lg,
    borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  backText: { color: colors.textMid, fontSize: fontSize.bodyLg },
  headerTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  list: { padding: spacing.lg },
  error: { color: colors.red, fontSize: fontSize.body, marginVertical: spacing.lg },
  empty: {
    padding: spacing.xl, alignItems: 'center',
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.lg,
  },
  emptyTitle: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text, marginBottom: spacing.sm },
  emptyDesc: { fontSize: fontSize.body, color: colors.textMid, textAlign: 'center', lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden',
  },
  cardThumb: { width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.surface },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  pdfBadge: {
    color: colors.textMid, fontSize: fontSize.md, fontWeight: fontWeight.bold, letterSpacing: 1,
  },
  cardBody: { padding: spacing.sm },
  cardName: { fontSize: fontSize.body, fontWeight: fontWeight.semibold, color: colors.text },
  cardLevel: { fontSize: fontSize.caption, color: colors.textDim, marginTop: 2 },
  pageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  pageBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.panel, minWidth: 96, alignItems: 'center',
  },
  pageBtnText: { color: colors.text, fontSize: fontSize.body, fontWeight: fontWeight.semibold },
})
```

- [ ] **Step 2: Type-check + lint**

Run:
```bash
pnpm --filter mobile type-check && pnpm --filter mobile lint
```
Expected: PASS. If TypeScript reports no types for `react-native-pdf-page-image`, create `apps/mobile/src/types/react-native-pdf-page-image.d.ts` with:
```ts
declare module 'react-native-pdf-page-image' {
  export interface PdfInfo { uri: string; pageCount: number }
  export interface PageImage { uri: string; width: number; height: number }
  const PdfPageImage: {
    open(uri: string): Promise<PdfInfo>
    generate(uri: string, page: number, scale?: number): Promise<PageImage>
    generateAllPages(uri: string, scale?: number): Promise<PageImage[]>
    close(uri: string): Promise<void>
  }
  export default PdfPageImage
}
```
and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/attachments/FloorPlanAttachModal.tsx
# include the .d.ts only if you created it in Step 2:
git add apps/mobile/src/types/react-native-pdf-page-image.d.ts 2>/dev/null || true
git commit -m "feat(mobile): attach + mark up PDF floor plans on RFIs"
```

---

## Task 5: Verify on the simulator

**Files:** none (manual verification)

**Pre-req:** an iOS simulator dev build from Task 1, and a project with at least one **multi-page PDF** floor plan and (ideally) one **single-page PDF** uploaded via the web Floor Plans page.

- [ ] **Step 1: List shows PDFs**

Open an RFI → Attach floor plan. Confirm PDF plans appear with a "PDF" tile alongside image plans. If the project has no plans, confirm the empty state reads "No floor plans found / Upload a floor plan (PDF, PNG or JPG)…".

- [ ] **Step 2: Single-page PDF opens directly**

Pick a single-page PDF. Confirm "Preparing…" shows briefly, then the annotator opens on the rendered page.

- [ ] **Step 3: Multi-page PDF shows the page picker**

Pick a multi-page PDF. Confirm the header shows "Pick a page" and a "Page 1 … Page N" grid appears. Tap a page; confirm the annotator opens on that page.

- [ ] **Step 4: Mark up + save**

Draw a few annotations and tap Save. Confirm the markup is staged and, after committing the RFI, appears in the gallery with the MARKUP badge.

- [ ] **Step 5: Re-edit a saved PDF markup**

Tap the ✎ edit button on the saved PDF markup. Confirm it re-rasterises the **same** page and reopens the annotator with the prior shapes intact. Add a shape, save, and confirm the update persists.

- [ ] **Step 6: Image plans still work**

Pick an image (PNG/JPG) plan, mark up, save — confirm the original image path is unaffected (regression check).

- [ ] **Step 7: Final checks**

Run:
```bash
pnpm --filter mobile type-check && pnpm --filter mobile lint && (cd apps/mobile && pnpm vitest run src/__tests__/pdf-raster.test.ts)
```
Expected: all PASS.

---

## Self-Review

**Spec coverage:**
- Include PDFs in the list → Task 4 Step 1 (list effect filter). ✓
- Fix empty-state copy → Task 4 Step 1 (empty state). ✓
- Page picker for multi-page → Task 4 Step 1 (page grid). ✓
- Store `sourcePageIndex` → Task 3 (type) + Task 4 (`withPdfSource` in `onSave`). ✓
- Handle re-edit → Task 4 Step 1 (re-edit effect rasterises stored page). ✓
- Client-side native rasterisation lib → Task 1 + Task 2 (`loadPdfForRaster`). ✓
- Skia annotator unchanged → confirmed (no task touches it). ✓
- De-risk native module before UI → Task 1 + Task 2 Step 5. ✓
- Known limitation (deleted source plan) → unchanged `AttachmentGallery.handleReEdit` already guards it; no task needed. ✓
- Verify on simulator → Task 5. ✓

**Type consistency:** `loadPdfForRaster`/`isPdfPath`/`isImagePath`/`withPdfSource`/`LoadedPdf`/`RasterisedPage` defined in Task 2 are used with identical names/signatures in Task 4. `sourcePageIndex` (Task 3) matches usage in Task 2 test and Task 4. `RasterisedPage.uri` (not `dataUrl`, unlike web) used consistently. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the only intentional placeholder is `<PASTE_SIGNED_PDF_URL>` in the removable Task 2 Step 5 smoke test, which the engineer fills with a real URL. ✓
