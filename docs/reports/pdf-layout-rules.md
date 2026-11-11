# PDF report layout rules

Every react-pdf report (QC, snag, site form, inspection, and any new one) follows these rules.
They exist because of **QC Report 1, Steyns house 2269 (issued 2026-11-06)**: 40 photos, 6 pages, 12.1 MB.

| What the reader saw | Cause |
|---|---|
| Photos 3–5 of "Underfloor Heating" missing; photos 1–2 printed over the page footer | The photo grid was one `flexWrap: 'wrap'` row. react-pdf lays out a wrapped flex line once and does not move it at a page break, so the row straddling the page bottom was drawn from 646 pt to 1,158 pt on an 842 pt page. The images were in the file; they were not on the paper. |
| Each photo showed a thin horizontal strip (the DB legend, the top row of breakers, the socket itself gone) | `objectFit: 'cover'` in a 216 × 100 pt box. The originals are 1536 × 2048 portrait phone photos, so about 35 % of each photo was kept and 65 % was cut away. |
| 12.1 MB for 6 pages | Camera originals were base64'd straight into the PDF. |
| 76 pt side margins and ~100 pt of empty paper above the footer | The body added its own padding (36/28/48 pt) on top of the page's (40/48 pt). |

The same patterns were in the snag report (whose whole card was also `wrap={false}`, so a snag with more photos than a page holds was clipped) and the site-form report.

## The rules

1. **Photos go through `ReportPhotoGrid`** (`apps/web/src/lib/reports/photo-grid.tsx`). No report draws a photo `<Image>` itself. Logos, signatures and annexure thumbnails are the only other `<Image>` uses, each in a bounded box.
2. **No `flexWrap` in anything that paginates.** Chunk items into explicit rows instead. `flexWrap` is acceptable only for a handful of small inline items inside an unbreakable block (badges in a header row).
3. **Unbreakable units are small, and they sit directly in the page flow.** A photo row (frame + caption), a table row, a comment line, a signature block: `wrap={false}`. A card, a section, or a grid: never unbreakable — anything unbreakable that is taller than the space left on a page is clipped without an error. And never wrap photo rows in a *breakable* `<View>` either (a card, a section, a grid container): when react-pdf splits such a parent across a page it fixes the parent's height and lays it out again, which squeezed 180 pt frames to 16–35 pt at a page foot and threw other rows ~29 million pt down the page (found while fixing this, on the Steyns data). `ReportPhotoGrid`, `Section`, the QC entry and the snag card all return fragments; a card's bottom rule or a section's gap is its own trailing unit.
4. **A heading travels with its first content.** Put it inside the first unbreakable row (`lead` on `ReportPhotoGrid`). Only when the heading's text is long (more than `MAX_LEAD_CHARS`) does it become ordinary breakable text before the grid.
5. **Photos are shown whole.** A fixed frame per grid (2-up 180 pt, 3-up 160 pt) with `objectFit: 'contain'`; the frame's grey shows on the short side. Never `'cover'`.
6. **Photos are downscaled before they are embedded.** `photoToReportDataUri` / `toReportJpeg`: EXIF rotation applied, long edge 1,400 px, JPEG q72, at most four decodes at a time. Logos and signatures keep their PNG bytes (transparency).
7. **Margins come from one place.** Body pages use `pageStyles.page` (40 pt sides, 48 pt top and bottom); the running footer sits at the same 40 pt sides. A body container adds no padding of its own.
8. **Text drawn by react-pdf is WinAnsi** (`toWinAnsiSafe`); a `✓` or `→` prints as a different glyph without an error.

## How the rules are enforced

- `pdf-layout.render.test.ts` renders the QC, snag, site-form and inspection reports with real-shaped photos (1536 × 2048 portrait, 2048 × 1536 landscape — not 1 × 1 PNGs, which have no aspect ratio) and reads where each image is **drawn** (`pdf-layout-audit.ts`). It fails when an image is outside the printable area, overlaps another, is stretched, or does not fill its frame (squeezed). Against the previous renderers it reported 15+ faults on the QC fixture alone.
- `pdf-layout-rules.contract.test.ts` fails on `objectFit: 'cover'`, on a photo `<Image>` outside the grid, on `flexWrap` in the grid, and on a photo bucket passed to a raw base64 helper.
- A text-layer assertion ("the PDF contains Photo 5") is **not** evidence of layout: a photo drawn below the paper edge still passes it.

## Adding a new report

Use `ReportPhotoGrid` with `PHOTO_GRID_2UP` (evidence that must be legible) or `PHOTO_GRID_3UP` (dense records), load photos with `photoToReportDataUri`, and add the report to `pdf-layout.render.test.ts`.
