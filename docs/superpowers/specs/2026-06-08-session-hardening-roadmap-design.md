# Session Hardening Roadmap — design spec

**Date:** 2026-06-08
**Origin:** Pre-mortem on this session's prod changes (tenant hard-delete, the Equipment & Materials merge Phases 1–3, the Part A fixes, and the PR #46 kind-filter fix). This spec turns the pre-mortem action list into a sequenced, independently-shippable roadmap.
**Status:** design locked (D1–D3). Execution: per-phase plan → subagent-driven build → verify (type-check + tests + build) → publish (PR/merge + migration via the deploy workflow + Vercel confirm) → next phase.

---

## Decisions (locked 2026-06-08)

| ID | Decision |
|----|----------|
| D1 | Tenant-delete safety: **type-to-confirm + audit log now** (Phase 1); **recycle bin (reversible delete)** as a later phase (Phase 5). |
| D2 | **Stand up a separate staging/preview DB** (Phase 4) so preview deploys stop sharing the prod database. |
| D3 | Process hardening in-scope: **fix the mobile TS2786** so CI "green = green", and **wire the FK + trigger smoke tests into CI** (Phase 2). |

## Pre-mortem risks retired (reference)

| # | Risk | Phase |
|---|------|-------|
| 1 | Wrong-tenant delete, irreversible, no trace **(CRITICAL)** | 1 (trace+friction), 5 (reversible) |
| 2 | Destructive testing on preview hits prod **(CRITICAL)** | 4 |
| 3 | Latent render-only bug in the unified tab | 0 |
| 4 | Kind-filter "load-broad, render-unfiltered" pattern recurs | 0 |
| 5 | Red CI normalized → a real regression ships | 2 |
| 6 | FK-behaviour smoke rots out of CI (sleeper) | 2 |
| 9 | Dead old-tab components break live type-imports | 3 |

## Phases

### Phase 0 — Sweep & merge
- Merge **PR #46** (the tenant-document kind-filter fix).
- **Audit** other web list/render components for the same bug class as `TenantDocumentList` (receives a discriminator prop — `kind`/`category`/`type` — but renders a broader dataset without filtering by it). Fix any real instances found.
- Deploy-verify the unified Equipment & Materials tab renders.

### Phase 1 — Delete safety net (CRITICAL #1, immediate)
- A minimal append-only **`audit_log`** table (`organisation_id`, `project_id`, `actor_id`, `action`, `entity_type`, `entity_id`, `summary jsonb`, `created_at`; RLS read = owner/admin; inserts via the service-role action). *Reconcile against any existing audit infra found in Phase-1 grounding before creating it.*
- `hardDeleteTenantAction` writes an `audit_log` row (`action='tenant.hard_delete'`, `summary` = the destruction counts) as part of the delete.
- `TenantDeleteModal` gains **type-to-confirm**: the danger button stays disabled until the user types the exact board code.

### Phase 2 — CI means something (#5, #6)
- **Mobile TS2786:** align the mobile app's React types so `pnpm type-check` is green across all workspaces (mobile stays React 18; likely a `@types/react` dedupe / tsconfig `paths` fix, mirroring the PR-#38 web approach — confirm the exact cause first).
- **CI smoke:** add a step to `.github/workflows/ci.yml` running `smoke-test-tenant-hard-delete.sh` + `smoke-test-equipment-order-trigger.sh` (catalog-read / transactional-rollback — safe), reusing the deploy workflow's `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` secrets.
- **Landing:** the `ci.yml` edit needs the `workflow` push scope — land via the GitHub web editor or `gh auth refresh -s workflow`.

### Phase 3 — Remove the dead-code landmine (#9)
- Relocate the shared types (`OrderDoc`, `ShopDrawing`, `ShopDrawingStatus`) out of the old `materials/_components/*` into a neutral `equipment-materials/_lib/order-types.ts`; update imports in `gather-unified-boards.ts`, `page.tsx`, `UnifiedDocSlot.tsx`, `UnifiedShopDrawingList.tsx`.
- Delete the genuinely-dead runtime components (`materials/_components/OrderRow.tsx`, `equipment-schedule/_components/EquipmentTable.tsx`, and `OrderDocSlot.tsx` / `ShopDrawingList.tsx` once only their relocated types were keeping them alive) after grep-confirming zero remaining runtime importers.
- Verify the old routes still redirect; build green.

### Phase 4 — Staging DB (CRITICAL #2) — human-in-loop: Supabase
- Investigate Supabase branching vs a second project; wire the **preview-scope** env vars (Vercel) to the staging DB; document "destructive testing → staging, never preview-on-prod."
- The actual provision is a paid/dashboard action — prepared by me, **go/no-go by Arno**.

### Phase 5 — Recycle bin (reversible delete; depends on 1, and on 4 for safe live testing)
- A new node **status `deleted`** on `structure.nodes` (reuses the existing decommissioned-style status filtering — *not* an invasive new soft-delete column across every read) + `deleted_at` / `deleted_by`.
- "Move to recycle bin" = set `status='deleted'` (hidden from default reads). A **"Deleted tenants"** view → **Restore** (status back to active).
- The current cascade becomes a separate **"Purge permanently"** (still type-to-confirm + audit). Optional purge-after-N-days job (deferred unless wanted).
- Reversible by design, so safe to verify anywhere; the live purge path is verified on staging once Phase 4 lands.

## Cross-cutting — early-warning dashboard
Sentry already covers runtime errors on the new routes; the Phase-1 `audit_log` is the deletion trail. A short `docs/` monitoring note lists the signals to watch (unexpected tenant-count drop, Sentry on `equipment-materials`/tenant-delete, the FK-smoke CI step going red).

## Human-in-the-loop touchpoints
1. **Phase 2** — `ci.yml` edit needs the `workflow` push scope.
2. **Phase 4** — Supabase staging branch is a paid/dashboard action.

## Out of scope
- Cable-schedule / JBCC module rewrites; the Paystack go-live (separate track); a full RBAC re-audit (the existing model stands).

## Sequencing note
Phases 0–3 are fully autonomous. Phase 4 gates on Arno's Supabase go-ahead; while it is pending, Phase 5 (reversible delete) can still be built and unit-verified — and once the recycle bin exists, deletes are reversible, which itself softens the test-on-prod risk. Order adapts if Phase 4 blocks.
