# Document Preview — root cause, fix, and consistency plan

**Date:** 2026-06-16
**Trigger:** Equipment & Materials document preview opens but the PDF never loads (production).
**Status:** Phase 1 (CSP fix) implemented; Phase 2 (consistency hardening) planned.

## Root cause

The global CSP set `frame-src 'none'` ([next.config.ts](../../../apps/web/next.config.ts), added 2026-06-09 in #51). That directive makes the browser refuse to render **any** `<iframe>` content. Every in-app preview that embeds a document in an `<iframe>` therefore opens to a blank frame. The Equipment & Materials `DocumentPreviewModal` renders PDFs in an `<iframe>` ([DocumentPreviewModal.tsx:103](../../../apps/web/src/app/(admin)/projects/[id]/equipment-materials/_components/DocumentPreviewModal.tsx)); its `<img>` path for images was permitted by `img-src`, so images previewed and only PDFs were blank — the signature of this cause.

**Evidence:** the directive in the deployed config; the iframe render path; images working while PDFs don't; and that new-tab/`window.open` previews (not subject to the app CSP) kept working while in-app iframe previews did not.

## Full preview-surface map (audit — "leave nothing assumed")

Four surfaces embed a document in an `<iframe>` and were all silently broken by `frame-src 'none'`:

| Surface | File | Source |
|---|---|---|
| Equipment & Materials docs (reported) | `equipment-materials/_components/DocumentPreviewModal.tsx:103` | Supabase signed URL (node-order-documents / shop drawings) |
| GCR report viewer (saved + draft) | `generator-cost-recovery/ReportViewerModal.tsx:126` | signed URL + same-origin draft route |
| Inspection certificate page | `inspections/[inspectionId]/report/page.tsx` | signed URL |
| Public certificate share | `inspection/[shareToken]/page.tsx` | signed URL (anon) |

Image/lightbox surfaces (`<img>`) and new-tab/`window.open` surfaces were unaffected. Secondary fragility found during the audit (not the reported cause, addressed in Phase 2):
- **No shared preview component** — each iframe surface reinvents the viewer; none except `DocumentPreviewModal` has any load state, and **none can detect an iframe that fails to load**, so a blank preview is always silent.
- Two RSC signed-URL sites render an iframe without null-checking the signed URL (`report/page.tsx`, `[shareToken]/page.tsx`).
- Stored-object Content-Type is inherited from upload time; a mis-typed upload serves a PDF the iframe won't render.
- Inconsistent signed-URL TTLs (300s / 600s / 3600s) across features.

## Phase 1 — the fix (this PR)

Centralised the CSP into a tested module ([apps/web/src/lib/security/csp.ts](../../../apps/web/src/lib/security/csp.ts)) and corrected `frame-src`:
- **Production:** `frame-src 'self' https://*.supabase.co blob:` — same-origin (streaming/draft routes), Supabase signed URLs, blob URLs. Unblocks all four iframe surfaces at once. `X-Frame-Options: DENY` stays, so clickjacking protection is unchanged (we only permit what *we* embed).
- **Development:** additionally allows `http://127.0.0.1:* http://localhost:*` and drops `upgrade-insecure-requests`, so previews are testable against the local Supabase stack without weakening prod.
- **Regression guard:** `csp.test.ts` asserts `frame-src` never reverts to `'none'` and always permits the storage origin — the exact check that would have caught this on 2026-06-09.

## Phase 2 — consistency hardening (follow-up PR)

So the next feature with a preview requirement works the same way and can never fail silently:

1. **One shared `<DocumentPreview>` component.** Every feature (equipment docs, GCR, inspection certs, share page, future) renders through it. Single place for iframe vs img vs download-fallback, loading/error/empty states, and styling.
2. **Silent-failure detection.** The shared component wires iframe `onLoad`/`onError` + a load timeout; on failure it shows "Couldn't load preview — Download instead." A blank preview becomes impossible to ship unnoticed.
3. **Null-check the RSC iframe sites** so a missing/failed signed URL shows a message, not a blank frame.
4. **Standardise serving:** inline Content-Disposition for previews, correct Content-Type asserted at upload, one signed-URL TTL constant.
5. **Keep the CSP guard** (already added in Phase 1) as the structural backstop.

## Verification

- Phase 1: `csp.test.ts` RED (against `frame-src 'none'`) → GREEN (after fix); typecheck clean; live dev CSP header confirmed; real signed-URL PDF rendered in an `<iframe>` in a browser (GCR report viewer, same iframe+signed-URL mechanism as Equipment & Materials) — see PR description.
