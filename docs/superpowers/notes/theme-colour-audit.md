# Theme colour-sweep audit (2026-06-26)

Scope check for Phase B of the light/dark theme. Generated via `rg` over `apps/web/src`.

## Totals
- **840** hardcoded hex/rgb/hsl occurrences across **212 files** (excluding `app/globals.css`).
- **~88** Tailwind literal colour classes (`bg-gray-*`, `text-white`, …) in `app/(admin)/inspections/templates/_builder/` alone (more elsewhere).

## Categories

### Exclude (fixed-format / semantic — NOT themeable)
- **PDF report generators** — `lib/reports/*` (interior, valuation, snag-visit, generator, inspection, components, theme), `lib/cable-schedule/export-pdf.ts`. ~**172** occurrences. These render fixed documents; like the `@media print` block they intentionally use fixed colours.
- **Charts / plots** — `components/mv/TccPlot.tsx` (data-series colours).
- **Canvas / annotation pen colours** — `app/(admin)/projects/[id]/floor-plans/[planId]/MarkupCanvas.tsx`, `components/attachments/FloorPlanAnnotator.tsx` (a markup colour is semantic and stays fixed in both themes).
- **Brand SVG** — `components/GoogleSignInButton.tsx`.
- The palette definitions themselves in `globals.css`.

### Known light-mode breakers (high value — convert first)
From the original design ([spec §7](../specs/2026-06-25-light-dark-theme-design.md)):
- `components/cloud-storage/CloudFolderPicker.tsx` — whole duplicate dark palette in hex.
- `components/ui/Button.tsx` — `#0D0B09`, `#6b1e1e`.
- `components/ui/FileUploadWithProgress.tsx` — `#4ade80`.
- `components/ui/PhotoPicker.tsx` — `#fca5a5`.
- `components/markup/ExportMarkupButton.tsx` — `#dc2626`.
- `app/(admin)/settings/ProfileSettingsForm.tsx` — `#34d399`.

### Long tail (genuine UI, themeable, but large)
~200 files of admin/feature UI with scattered hex/rgb and Tailwind literals — notably the inspection-template `_builder/*` (Tailwind `gray-*` etc.), cable schedule grid, diary forms, scan/tag page, auth layout, various inspection screens. Converting all of these is a substantial standalone refactor with many per-occurrence judgment calls.

## Recommendation
The theme **system** (Phase A) is complete and production-verified, and the core app already uses `var(--c-*)` widely. Suggest: convert the **known breakers** now (high value, low risk), exclude reports/charts/canvas/brand, and treat the ~200-file long tail as a **separate tracked cleanup**, not a blocker for shipping the theme.
