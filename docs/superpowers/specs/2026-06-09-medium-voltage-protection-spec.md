# Medium-Voltage Protection & Design Calc — Spec v1

**Date:** 2026-06-09
**Status:** SPEC (drives the implementation plan). Supersedes the 2026-06-02 *briefing* (a pre-spec context pack) and reconciles the standalone **MV Protection Studio** sandbox (verified, 246 vitest tests) into e-site's existing unified electrical graph.
**Architecture decision (owner-confirmed):** **unified-graph native** — the verified Z-bus engine becomes a pure `packages/shared` calc core, fed from `structure.nodes` + `cable_schedule.supplies/cables`, persisting to `cable_schedule`, reusing `revisions` (DRAFT→ISSUED→SUPERSEDED) and the `sans_*` reference system. **No separate MV network model.**
**Governance:** every output is stamped *"sandbox — not for issue"* and the engine is **verified, not yet independently validated**. Issue is gated (§9). Access is paid (§10).

> Column names, helpers and migration numbers below are **verified against the actual migrations** (not the 2026-06-02 briefing, whose strawman names were illustrative). Corrections to that briefing are flagged ⚠.

---

## 0. The 11 decisions (briefing §6 — answered)

| # | Decision | Answer (v1) |
|---|---|---|
| 1 | Scope boundary | Fault-level **calc**, protection-device **register**, **TCC** plotting, **discrimination/coordination**, breaker+cable **sizing duties**. Reporting/PDF **deferred** to v2 (CSV/JSON export ships). |
| 2 | Fault types & cases | **3-phase Ik3 (max+min)**, **SLG Ik1 (max+min, resistive)**, **peak ip**, **X/R**. Phase-phase derived (`≈ (√3/2)·Ik3`), not in-engine. IEC 60909 c-factor once; K_T/K_G=1 (documented, conservative). |
| 3 | Compute vs assume `fault_level_ka` | **Computed-with-override.** Engine writes per-node `fault_results`; `revisions.fault_level_ka` becomes the *source* prospective value (computed, with an explicit engineer override + provenance). |
| 4 | Voltage classification | Keep implicit in `voltage_v` (MV = ≥1000 V via the existing `supplies.voltage_v` CHECK incl. 11/22/33 kV). No new class column. |
| 5 | Protection-device data source | **Seeded library via `sans_*`** (IEC 60255 curve constants + standard frames) **+ manual entry**. Curves are **parametric IEC** (not digitised points). |
| 6 | Home | **Extend `cable_schedule`** (no PostgREST PATCH; reuses revision/graph/reference machinery). |
| 7 | Transformer/source impedance home | **A `cable_schedule` companion table keyed by node_id XOR source_id** (`fault_sources`, §5.2) — not free columns on `structure.nodes` (keeps electrical-study facets out of the shared topology table and inside the revision's CASCADE). |
| 8 | Persistence of results | **Cache** `fault_results` + `discrimination_checks` (per revision) — needed for ISSUED snapshots + reporting; recompute on input change. |
| 9 | Mobile | **Web-only v1**; mobile read of results deferred (services are pure → trivial later). |
| 10 | Reporting | CSV/JSON export v1 (extend `ExportMenu`); PDF deferred. |
| 11 | Relationship to `shortCircuitCheck` | The new engine **computes** the `fault_level_ka` that the existing `shortCircuitCheck()` consumes — it **feeds**, not replaces, the cable check, and adds adiabatic I²t + breaker duties. |

---

## 1. Scope

**In v1:** per-node fault levels (Ik3 max/min, Ik1 max/min, X/R, ip) over the **whole connected graph** (MV through LV, meshed rings supported); a protection-device register; parametric IEC/IEEE TCC; discrimination/coordination grading with margins + verdicts; breaker breaking/making/asymmetrical duty + cable adiabatic withstand; CSV/JSON export.
**Deferred to v2:** PDF study report; mobile; phase-phase as a first-class output; digitised (point) curves; auto device-selection.

---

## 2. Architecture — unified graph + Z-bus engine (the reconciliation)

### 2.1 Why Z-bus, not the radial walk
The briefing suggested mirroring `computeCumulativeVdMap` (a **radial tree-walk** that accumulates a quantity source→leaf and **breaks rings** with a cycle guard). That is correct for volt-drop but **wrong for MV fault levels**: a ring or any meshed/multi-source network divides fault current through parallel paths — you cannot sum series Z down a tree. The sandbox already solves this with **nodal Z-bus analysis** (build the complex bus-admittance matrix `Y`, invert to `Z`, `Ik3 = c·I_base/|Z_kk|`), which handles **meshed rings, multiple infeeds, and cross-voltage** exactly. **v1 uses the Z-bus engine as the fault-calc core.** `buildStructureTree`'s ring detection is retained for **topology/UI** (and to label ring members), not for the fault math.

### 2.2 Layering (matches e-site)
- **`packages/shared` pure services** — all engineering math (Z-bus, zero-seq, coordination, sizing, curves). Plain inputs → plain outputs, no DB, exhaustive vitest. Authored like `cable-calc.service.ts`; reused by web (+ mobile/export later).
- **`apps/web/src/actions/*.actions.ts`** — `'use server'` async-only; resolve revision→project→role-gate→call shared service→`revalidateTag`→`{data}|{error}`. Refuse writes on ISSUED/SUPERSEDED.
- **`apps/web/src/app/api/medium-voltage/**`** — route handlers for heavy compute (full network solve) to dodge action timeouts.
- **UI** — sibling route folders under the cables revision workspace (§8).

### 2.3 The data flow
`structure.nodes + cable_schedule.{sources,supplies,cables} + new fault_sources facets`
→ **adapter** (`buildMvNetwork`, §4) → per-unit `MvNetwork` (buses/branches/infeeds/machines/inverters/earthing)
→ **`mv-fault.service`** (Z-bus) → per-node `{ik3Max,ik3Min,ik1Max,ik1Min,xr,ip}` → cache in `cable_schedule.fault_results`
→ **`mv-coordination.service`** over the device register → `discrimination_checks`
→ UI (Fault / Coordination tabs) + export.

---

## 3. Engine modules (`packages/shared/src/services/`)

Ported from the verified sandbox (TS↔Python parity to 1e-10; 246 tests). Each is pure + vitest-tested with **formulas + worked numeric examples** in the doc-comments (cable-calc style).

- **`mv-complex.ts`** — `Cx`, complex ops, `matInvert` (Gauss-Jordan, partial pivoting, **scale-relative** singularity tolerance).
- **`mv-fault.service.ts`** — positive-seq Z-bus: `buildZbus(net,{includeMotors})`, `faultsForNetwork(net)` → per-bus `ik3Max/ik3Min/xr/ip`. Sources are shunts-to-reference: grid infeed (`c·U²/S″k` with X/R), synchronous generators (x″d), induction motors (locked-rotor) — machines in **max**, motors excluded from **min**. **IBR/inverters** are current-limited injections distributed by the transfer impedance `|Z_kj|/|Z_kk|` (added to Ik3 max + √2 peak, no DC; excluded from min + Ik1).
  Formula: `Ik3 = c·I_base/|Z_kk|`; `ip = κ(X/R)·√2·Ik3` (machines) `+ √2·I_inv` (IBR, no DC).
- **`mv-zeroseq.service.ts`** — symmetrical-component SLG: builds the zero-sequence network from transformer **vector groups** (`classifyVectorGroup` — a low-Z shunt requires an earthed star **+ delta** return; YNy/Yyn → open), NER `3·Z_N`, zig-zag earthing transformers; `Ik1 = 3c/|2·Z1_kk + Z0_kk + 3·R_F|`. Reports **max** (c_max, bolted) and **min** (c_min, motors-excluded, + assumed `R_F`); flags **unearthed** buses with the capacitive `I_c = √3·ω·C0·Uₙ`.
- **`mv-protection-curves.ts`** — IEC 60255 IDMT (SI/VI/EI/LTI) + IEEE C37.112 (MI/VI/EI) + definite-time. `t = TMS·k/((I/Is)^α − 1)`.
- **`mv-coordination.service.ts`** — `deviceTime` (incl. **high-set 50**: `min(IDMT, instTimeS)` above `instMultiple·pickup`), `tccSeries`, `gradePair`, `coordinateStudy` → margins + `ok|marginal|fails`.
- **`mv-sizing.service.ts`** — `breakerBreakingCapacityCheck` (Ik3 max), `makingCapacityCheck` (ip vs 2.5×breaking), `asymmetricalBreakingCheck` (DC at contact separation; flags X/R > ~14.1), `adiabaticWithstand` (I²t = k²S², validity > 5 s, `K_FACTORS` Cu/Al × XLPE/PVC). The adiabatic check **feeds and extends** the existing `shortCircuitCheck`.

Exports added to `packages/shared/src/index.ts`. Zod schemas in `src/schemas/mv-protection.schema.ts` (mirror DB CHECKs); snake↔camel mapper `_mv-protection-mappers.ts`.

---

## 4. The graph → engine adapter (`mv-network.service.ts`, pure)

`buildMvNetwork(input): MvNetwork` maps the e-site graph to the engine's per-unit network. Input is the same `{sources, nodes, supplies, cables}` triple `buildStructureTree` consumes, **plus** the new `fault_sources` facets and a study-settings row.

| Engine concept | e-site source | Notes |
|---|---|---|
| Bus | `structure.nodes` (+ implicit source bus) | `voltage_v` → base kV (defaults if null) |
| Line branch | `supplies` + its `cables` | `Z = (ohm_per_km + j·x_per_km)·L/1000 / N_parallel`; `L` = `activeLengthM` (design/as-built/worst); `N` = parallel cable count ⚠ **reactance col is `x_per_km`** |
| Transformer branch | `supplies` whose end is a `mini_sub` node | needs **new** `uk%`, `X/R`, vector group, earthing (§5.2) |
| Grid infeed | `sources.type ∈ (UTILITY, COUNCIL_RMU)` | needs **new** fault-MVA (S″k) or R+jX + X/R (§5.2) ⚠ col is `sources.type`, values `COUNCIL_RMU/UTILITY/PV/STANDBY` |
| Generator (machine) | `structure.nodes.kind='generator'` | `rating_kva` present; needs **new** x″d, X/R |
| Inverter (IBR) | `sources.type='PV'` or a node facet | current-limited; needs **new** rated VA + limit factor |
| Earthing / NER | **new** facet | per earthed winding |
| Cable withstand | SANS lookup `short_circuit_1s` | ⚠ **not** a `cables` column — via `lookupCableProperties` |

The adapter is pure and unit-tested with a fixture graph; it is the only place that knows both shapes.

---

## 5. Data-model delta (extend `cable_schedule`)

All new tables: `id UUID PK DEFAULT gen_random_uuid()`, `organisation_id` + (where project-scoped) resolve `project_id` via a SECURITY-DEFINER helper; `updated_at` trigger → `public.set_updated_at()`; RLS `USING (public.user_has_project_access(project_id))` (+ `WITH CHECK` on writes); each migration ends `NOTIFY pgrst, 'reload schema';`. **No new schema** (avoids the PostgREST `db_schema` PATCH). Cross-schema refs to `structure.nodes` are **plain UUIDs** resolved by definer helpers, **not** FKs (codebase convention).

### 5.1 Study settings — `cable_schedule.mv_study_settings`
One row per revision (the MV study facet of a revision). `revision_id` (UNIQUE, FK→revisions CASCADE), `base_mva` (default 100), `c_max` (1.1), `c_min` (1.0), `ef_fault_resistance_ohm` (0), `frequency_hz` (50). Reuses the revision lifecycle — **no parallel versioning**.

### 5.2 Fault-source impedances — `cable_schedule.fault_sources`  *(the green-field)*
The source/transformer/generator/earthing data the model lacks. Keyed by **node_id XOR source_id** (mirrors the `supplies` origin XOR). Columns:
`revision_id` FK→revisions CASCADE · `node_id` UUID (→structure.nodes, nullable) · `source_id` UUID (→sources, nullable) · CHECK exactly one set · `role` (`utility|transformer|generator|inverter`) · utility: `ssc_mva`, `xr_ratio`, `z0_over_z1` · transformer: `uk_pct`, `pkr_w`, `s_rated_va`, `vector_group`, `z0_over_z1`, `hv_earthing`/`lv_earthing` (`solid|resistance|reactance` + `ner_ohm`) · generator: `xd_pct`, `xr_ratio` · inverter: `s_rated_va`, `current_limit_factor` (1.2). All nullable per role; Zod validates per `role`.

### 5.3 Protection devices — `cable_schedule.protection_devices`
`revision_id` · `node_id` and/or `supply_id` (the protected point) · `device_role` (`incomer|feeder|transformer|sub_circuit`) · `device_type` (`relay|MCCB|ACB|fuse|RMU_fuse`) · `manufacturer` · `model` · `frame_rating_a` · `curve_ref` (→ sans device-library code) · `settings` JSONB (`std`, `curve`, `pickup_a`, `tms`/`td`, `dt_s`, `inst_multiple`, `inst_time_s`) · `created_by` · timestamps.

### 5.4 Computed caches
- **`cable_schedule.fault_results`** — UNIQUE `(revision_id, node_id)`: `ik3_max_ka`, `ik3_min_ka`, `ik1_max_ka`, `ik1_min_ka`, `xr_ratio`, `ip_ka`, `ic_amps` (unearthed), `basis`, `computed_at`.
- **`cable_schedule.discrimination_checks`** — `(revision_id, upstream_device_id, downstream_device_id, at_fault_a)`: `t_up_s`, `t_down_s`, `margin_ms`, `verdict` (`ok|marginal|fails`).

### 5.5 Migrations (from **00124**)
`00124_mv_study_and_fault_sources.sql` (5.1 + 5.2) · `00125_mv_devices_and_results.sql` (5.3 + 5.4 + definer `cable_schedule.*_project_id` resolvers + RLS) · `00126_sans_protection_curve_library.sql` (§6 seed). Deploy via `.github/workflows/deploy-migrations.yml`.

---

## 6. Reference data (`sans_*`)
New `sans_tables` codes (+ `sans_rows`), so per-project overrides work for free:
- **`PROTECTION_IEC_CURVES`** — IEC 60255 / IEEE C37.112 constants (`k`, `α`, `c`) per characteristic.
- **`PROTECTION_DEVICE_LIBRARY`** — standard relay/fuse/MCCB families, frame ratings, default `curve_ref`.
- **`FAULT_CALC_CONSTANTS`** — voltage factor `c` by voltage band; κ bounds.
Looked up through the existing `sans-lookup.service.ts` pattern (override → bundled fallback).

---

## 7. Server actions + route handlers + RBAC
`apps/web/src/actions/mv-protection.actions.ts` (`'use server'`, async-only; Zod/consts live in `packages/shared`). Each: resolve revision→project → `requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)` → shared service → `revalidateTag` → `{data}|{error}`; **refuse writes on ISSUED/SUPERSEDED**.
- `upsertFaultSource`, `upsertProtectionDevice`, `upsertMvStudySettings`
- `overrideFaultLevel` (computed-with-override + provenance — decision #3)
- `issueMvStudy(revisionId)` — the **gated** transition (§9)
- **Heavy compute** route handler `apps/web/src/app/api/medium-voltage/study/route.ts` (`requireRoleAPI(ORG_WRITE_ROLES)`) — runs the full Z-bus + coordination solve, writes the caches, streams progress.
- **RBAC:** import role constants from `@esite/shared` (`ORG_WRITE_ROLES`, `COST_VIEW_ROLES`); never hardcode. Add **every** new route to `docs/rbac-matrix.md` in the same PR.

---

## 8. Web surface (extend the cables revision workspace)
Base: `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/`. ⚠ The shell is **header `<Link>` nav + sibling route folders** (no tab-bar component, no `useDirtyForm` hook). Add sibling routes + header links:
- `…/[revisionId]/protection/page.tsx` — device register (form per protected node), reuse `StructurePanel` topology.
- `…/[revisionId]/fault/page.tsx` — per-node Ik3 max/min, X/R, ip, Ik1 max/min, + the breaking/making/asym + I²t verdicts. `KpiCard` tiles (`variant` ok/warning/danger), `Badge` verdicts.
- `…/[revisionId]/coordination/page.tsx` — log-log TCC plot (port the sandbox `TccPlot`) + discrimination table coloured `success|warning|danger`.
Reuse `Card`/`CardHeader`/`CardBody`, `Badge` (`default|success|warning|danger|info|ghost`), `StickySaveBar` + `UnsavedChangesGuard` (`isDirty` prop) from `settings/_components/`. Extend `ExportMenu` with a protection-study CSV/JSON (carry the governance header). The **"sandbox — not for issue"** + IBR-approximation notices render on every protection view until §9 passes.

---

## 9. Study lifecycle + gated-issue
A protection study is a **facet of a `revision`** — reuse its DRAFT→ISSUED→SUPERSEDED lifecycle (immutable once ISSUED, app-enforced). `issueMvStudy(revisionId)` transitions only when **all** gate conditions pass (server-side, never UI-only); a failure names what's missing:
- **GATE-1** Named Pr.Eng approver (ECSA reg + name; resolve via `createServiceClient()` after the role gate).
- **GATE-2** "Curve constants & ranges re-validated vs manual rev ___" (rev string required).
- **GATE-3** "Source data confirmed" (utility/transformer/generator impedances confirmed).
- **GATE-4** "Validation pack completed & signed" (the verified≠validated bright line).
On pass, freeze a snapshot (graph + devices + `fault_results` + `discrimination_checks` + gate evidence) onto the revision. Until live, the sandbox notice stays on every output, export, and print.

---

## 10. Access entitlement (paid) — per-user annual R2000 (Paystack)
**Owner decision:** MV is paid at **R2000 / year, per individual user**, sell-now behind a **forced non-validation disclaimer**.

> ⚠ **Platform deviation (flagged, owner-confirmed).** e-site's existing paid features are **per-organisation, one-time lifetime** unlocks (`billing.org_feature_unlocks` + `has_feature`; JBCC R1,999, Inspections R250). **Per-user + annual-recurring is net-new** and adds a second billing pattern to maintain. It is isolated from the existing per-org system below so it does not entangle it. (The platform-consistent alternative would be a R2000 one-time per-org unlock — a sibling of JBCC — which reuses everything; recorded here as the lower-cost option if reconsidered.)

- **Entitlement:** new `billing.user_mv_subscriptions` (per-user): `user_id` UNIQUE, `status` (`active|past_due|expired|pending`), `current_period_end`, `disclaimer_accepted_at`, `paystack_customer_code`, `paystack_subscription_code`, `last_event_id`. RLS select-own; **service-role writes only** (webhook). Helper `public.user_has_mv_access(uid)` (active + not expired + disclaimer set) — per-user analogue of `has_feature`.
- **Paystack:** a R2000/yr **Plan** (`amount 200000`, `currency 'ZAR'`, `interval annually`); reuse the existing Paystack client + webhook infra. `startMvSubscription()` initialises the subscription; a **new branch** in `/api/paystack/webhook` (matched on the MV plan/metadata) writes the per-user entitlement (signature-verified raw body, idempotent on event id). Owner action: create the Plan on the Paystack dashboard → set `PAYSTACK_PLAN_MV_ANNUAL`.
- **Disclaimer (sell-now):** mandatory acceptance in the MV unlock page — *"not validated; you validate every study per SANS 10142 / ECSA"* → records `disclaimer_accepted_at`. **Access = active sub AND disclaimer.**
- **Gate:** `requireMvAccess(userId)` in the MV section layout + every MV action/route — server-side, orthogonal to RBAC (needs project role **and** MV entitlement). **Access ≠ issue:** this gates *use*; §9 gates *issue*; the disclaimer mitigates but does not remove the unvalidated-tool risk, and outputs stay "not for issue" until §9.

---

## 11. Gotchas (acknowledged)
`'use server'` async-only (Zod/consts in shared) · SECURITY DEFINER → `REVOKE EXECUTE FROM PUBLIC`, grant `authenticated`/`service_role` · any `structure` **writes** need the `Content-Profile: structure` raw fetch (keep MV writes in `cable_schedule`) · `supabase gen types` can't see triggers → re-patch trigger-filled NOT-NULL cols optional · `vi.hoisted` mocks for `next/cache` · revisions immutable on ISSUED · resolve other users' names via `createServiceClient()` after a role gate · webhook signature on the **raw** body + idempotency · Paystack minor units (R2000 = 200000 ZAR cents).

## 12. Standards
IEC 60909 (short-circuit, equivalent-voltage-source, c-factor once — documented ≤c_max source-bus conservatism); IEC 60255-151 / IEEE C37.112 (relay characteristics); IEC 62271-100 (breaking/making/asymmetrical duty); symmetrical-component SLG; IEC 60949 / SANS 10142-1 (adiabatic withstand, k-factors); IEC 60076-5 (transformer through-fault — overlay, not in-engine). **Verified, not yet independently validated** — external cross-check (ETAP/PowerFactory on ≥3 real networks) + Pr.Eng sign-off is the GATE-4 prerequisite.

## 13. Test plan
Port the **246** sandbox unit tests into `packages/shared` (highest-value, lowest-risk). Add: adapter tests (fixture graph → MvNetwork), service tests against a mocked Supabase client (`vi.hoisted`), one integration test behind `RUN_INTEGRATION_TESTS`, a DB smoke test (à la `scripts/db/smoke-test-anchor-sub-boards.sh`), and the **Princess-612** real-settings reproduction as the regression anchor. Coordination + paywall e2e mirror `10-jbcc-paywall.spec.ts`.

## 14. Phased delivery (each a reviewable PR)
1. **Engine lift** — `packages/shared` pure services + 246 tests (no DB; safe). *(start here)*
2. **Adapter** — `buildMvNetwork` graph→engine + fixture tests.
3. **Migrations** — 00124/00125/00126 (facets, devices, results, sans seed) + RLS + definer resolvers.
4. **Actions + route handler + RBAC** + `rbac-matrix.md`.
5. **Web** — protection / fault / coordination routes in the cables workspace + export.
6. **Gated-issue** (§9).
7. **Paywall** (§10) + Paystack plan wiring.

## Appendix — sandbox → e-site mapping
`MvNetwork.buses` → `structure.nodes` · `branches(line)` → `supplies`+`cables` (`ohm_per_km`,`x_per_km`,length,parallel) · `branches(transformer)` → `supplies` to `mini_sub` + `fault_sources(transformer)` · `infeeds` → `sources(UTILITY/COUNCIL_RMU)` + `fault_sources(utility)` · `machines` → `nodes(generator)` + `fault_sources(generator)` · `inverters` → `sources(PV)`/facet + `fault_sources(inverter)` · `earthingTransformers`/NER → `fault_sources.*_earthing` · `MvStudy.devices` → `protection_devices` · results → `fault_results`/`discrimination_checks` · versioning → `revisions` (no parallel scheme).
