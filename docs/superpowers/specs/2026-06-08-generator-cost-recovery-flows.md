# Generator Cost-Recovery — Application Flows

**Date:** 2026-06-08 · **Status:** living · **Companions:** `-design.md` (spec), `-connections.md` (wiring), `-premortem.md`.

Every end-to-end flow the feature must cater for, with the layers each touches and the pre-mortem risk it guards. Use as a coverage checklist during build + QA.

---

## A. Entitlement & billing — per-seat (guards F6)

1. **Locked discovery** — user without a seat opens the generator report → `requireFeatureSeat()` redirects to `/generator-report/unlock`.
2. **Buy a seat (admin)** — owner/admin picks a target user → `POST /api/paystack/feature-seat` → Paystack checkout → success.
3. **Abandon / decline** — user cancels or card declines → no seat written, state clean, retryable.
4. **Duplicate webhook** — Paystack delivers `charge.success` twice → idempotent on `paystack_reference`, single grant.
5. **Double-buy guard** — buying a seat for a user who already holds one → 409, no charge.
6. **Assign / reassign** — admin assigns a free pooled seat to a user, or moves a seat from user X → Y.
7. **Release on removal** — a user is removed/deactivated from the org → their seat frees (`assigned_user_id → NULL`) back to the pool (D3).
8. **Seat exhaustion** — all seats assigned → assigning one more prompts a new purchase.
9. **Multi-org user** — same person in two orgs needs a seat per org (entitlement is org-scoped).
10. **Platform-owner bypass** — WM-Consulting org passes `has_feature_seat` unconditionally.
11. **Refund / chargeback** — `charge.refunded` / dispute → MVP: surface to admin, manual seat revoke (document; no auto-revoke v1).
12. **Billing visibility** — seats + invoices appear on the org billing page.

## B. Data setup & prerequisites (guards F8)

13. **Tenant register ready** — tenants exist with `shop_area_m2`, `shop_category`, and `generator_participation`.
14. **Category capture** — picker on tenants + import-parser column + **backfill** of existing tenants (no silent `NULL`).
15. **Participation capture** — each tenant set to **`shared` / `own` / `none`** (see Flow P below).
16. **Zones & generators** — create zones; add generators (size + cost) per zone.
17. **Settings** — enter `gcr.settings` (diesel, run-hours, recovery rate/years, kW/m² rates, board/cabling/control costs, contingency) or accept defaults.
18. **Assignment** — tenant → zone; `manual_kw_override` where applicable.
19. **Readiness check** — "Generate" disabled until every tenant has area + category + participation, and generator costs exist; gaps listed explicitly.
20. **Edit-and-reflect** — change an area/category/participation/cost/setting → report recomputes; any saved report flagged **outdated**.

## C. Report generation & output

21. **Generate** — compute model (`@esite/shared`) → render PDF (`@react-pdf`) → persist to `projects.reports` (kind `generator_cost_recovery`) → bytes to `reports` bucket.
22. **List / download** saved reports; **versioning** on re-generate (old versions retained).
23. **Outdated indicator** — data changed since last issue → saved report marked stale.
24. **Branding** — org/project logos + amber accent applied (frozen snapshot per issue).
25. **Degenerate cases** — zero tenants · **all tenants `own`/`none` → total active load 0 → no divide-by-zero** · zero capex · single shared tenant.
26. **Render-failure** — react-pdf React-18/19 trap + glyph crashes → graceful error, never a silent 500. Deploy-verify the render.

## D. Access control & multi-tenancy (guards F16 + isolation)

27. **Configure** (settings/zones/costs/assignment) → `ORG_WRITE_ROLES` (owner/admin/PM).
28. **View report** (shows cost) → `COST_VIEW_ROLES` (owner/admin/PM) **AND** the acting user holds a seat.
29. **Buy/assign seats** → owner/admin only.
30. **Cross-project isolation** — `user_has_project_access(project)`; **cross-org isolation** — RLS via `get_user_org_ids()`.
31. **Read-only (`client_viewer`)** — sees **no** cost figures, cannot generate.
32. **Sub-org users** — cross-org `project_members` resolve to the right effective role.

## E. Lifecycle & data integrity

33. **Delete tenant** → `gcr.tenant_assignments` cascades; a saved report (frozen snapshot) is unaffected.
34. **Delete zone with tenants** → `tenant_assignments.zone_id` SET NULL → those tenants drop out of apportionment cleanly.
35. **Delete project** → all `gcr.*` cascade.
36. **Remove generator from zone** → recompute.
37. **Migration/backfill** — existing tenants default `shop_category='standard'` + `participation='shared'`; settings row lazily created per project.

## F. Cross-cutting infra

38. **PowerSync impact** — `shop_category` + `generator_participation` added to `structure.nodes`/assignments: check sync rules / mobile schema even though MVP is web-only.
39. **Migration deploy-order** — anything the running code references is dropped/changed in its own migration applied just before the code that stops referencing it (esite lesson).
40. **Deploy-verify** the render on a throwaway project before "done".

## G. Deferred — communicate, don't silently omit (F17)

41. **Emailed tenant statements + scheduled reports** are **out of MVP** (no email/cron infra) → state this in-app so users don't expect them.

---

## Flow P — Tenant generator participation (the opt-out model) — NEW

The design fix for "tenants who don't sign up for generator". Replaces the binary `own_generator`. Every tenant is in exactly one state:

| State | Meaning | Loading kW | In apportionment | Counts as a tenant DB for board-mod capex |
|------|---------|-----------|------------------|-------------------------------------------|
| **`shared`** | On the building's standby generator (signed up) | `area × rate` (or override) | yes | yes |
| **`own`** | Provides their own generator | 0 | no | no |
| **`none`** | Opted out / not connected — no backup at all | 0 | **no** | **no** |

**Sub-flows:**
- **P1 Set participation** — on the Tenants screen, each tenant gets a 3-way control (Shared / Own / Not on generator). Default on import = `shared`; readiness forces an explicit value before generate.
- **P2 Opt-out excluded from load** — `none`/`own` contribute 0 to `totalActiveLoad`, so the **`shared` tenants' shares rise** (D11 default: remaining tenants absorb the opted-out portion).
- **P3 Opt-out excluded from capex** — `numTenantDBs` counts `shared` only, so an opted-out board doesn't inflate board-mod capex.
- **P4 Report transparency** — opted-out / own-gen tenants are **listed** in Appendix C as "Not on generator — R0" (not silently dropped), so all parties see why they're excluded.
- **P5 Join / leave the scheme** — flipping a tenant `none ↔ shared` recomputes load, apportionment, and capex; any saved report goes outdated.

**Open business rule (D11 — PROPOSED, pending WM):** when a tenant opts out, do the **remaining `shared` tenants absorb** the portion (default — natural pro-rata, encoded now), or does the **landlord/common-area** carry it? Applies to both opex (running) and capex (recovery). The alternative changes the apportionment denominator/formula.

**Test impact:** `none` is a **deliberate divergence from nexus** (which only models `own_generator`). The golden-master proves nexus parity for `shared`/`own`; **add dedicated unit tests** for `none` (→ R0, excluded from denominator *and* `numTenantDBs`, reconciliation `Σ shared monthly = monthly repayment` still holds). Confirm with WM/nexus source how opt-outs are handled today — we may be fixing a latent nexus gap (a recorded, intentional divergence).
