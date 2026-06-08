# Medium-Voltage (Protection & Design Calcs) — Technical Integration Briefing

**Date:** 2026-06-02
**Status:** Pre-spec context pack. **This is NOT the spec.** Hand this to the session that writes `spec.md` so the design lands on the correct tech stack and data structures.
**Scope chosen by the product owner:** the MV function is primarily **protection & design calculations** — fault levels, protection discrimination/coordination, breaker & cable sizing studies.
**Depth requested:** guardrails **+ a data-model strawman** (a concrete starting point for the spec to refine, not a final design).

> How to use this doc: §0–§4 are *findings* (verified against the codebase — file refs given; treat as authoritative but re-confirm exact column names against the cited migrations before finalising). §5 is a **strawman proposal** (clearly my suggestion, open to change). §6 lists the decisions the spec MUST make. §7 is the spec-author's alignment checklist.

---

## 0. TL;DR — the six things that matter most

1. **You are NOT starting from scratch.** A mature electrical network model + a pure-TS calculation engine already exist. MV protection-calc is a *new calc layer on an existing graph*, not a greenfield module.
2. **There is ONE unified network graph**, not two. `structure.nodes` are the vertices (boards, transformers, RMUs, generators, tenant DBs); `cable_schedule.supplies` + `cable_schedule.cables` are the impedance-bearing edges between them. Migrations `00076/00077/00078/00082` already collapsed the old `cable_schedule.boards` into `structure.nodes`. Protection coordination is inherently a *whole-graph, source-to-load* analysis — and the whole graph is already here.
3. **The calc engine pattern is pure TypeScript in `packages/shared`, unit-tested with vitest** — see [cable-calc.service.ts](packages/shared/src/services/cable-calc.service.ts) (no DB access; plain inputs → plain outputs). It already does voltage-drop, derating, ampacity/utilisation, **cable sizing** (`requiredParallelSet`), a source-to-load **tree walk** (`computeCumulativeVdMap`), and a short-circuit **check**. Your fault-calc + coordination engine should be authored in exactly this shape.
4. **Reference data already has an extensible home and already includes MV.** `cable_schedule.sans_tables` / `sans_rows` / `sans_overrides` is a generic "table-of-tables" (JSONB) system with bundled defaults + per-project overrides. MV derating tables are already seeded (`00058_sans_mv_derating_tables.sql`). Protection-curve / device-library data should follow this same pattern.
5. **Study versioning already exists.** `cable_schedule.revisions` (DRAFT → ISSUED → SUPERSEDED, one DRAFT per project) already carries `fault_level_ka`. A fault study / protection study is a facet of a revision — reuse it; do not invent a parallel versioning scheme.
6. **What's genuinely missing (your green-field):** any *calculation* of fault current (today `fault_level_ka` is user-entered), any protection-device model, any Time-Current-Curve (TCC) representation, and any discrimination/coordination logic. That gap is the MV function.

---

## 1. Tech stack & monorepo shape (the target environment)

pnpm + Turborepo monorepo. `cd esite` (repo root) before any pnpm/turbo command; all package commands go through `pnpm --filter <pkg>`.

| Layer | Package | Stack (per manifests — confirm exact patch versions in `package.json`) |
|---|---|---|
| Web | `apps/web` | Next.js 15 (App Router), React 18.3, `@supabase/ssr` 0.5, react-hook-form 7.53 + `@hookform/resolvers` 3.9 + Zod 3.23 |
| Mobile | `apps/mobile` | Expo SDK 52, React Native 0.76, Expo Router 4, `@supabase/supabase-js` 2.45 |
| Edge / DB | `apps/edge-functions` | Supabase (Postgres + Deno edge); migrations in `apps/edge-functions/supabase/migrations/` |
| Shared logic | `packages/shared` | Zod schemas, pure services (incl. the cable calc engine), role constants. **This is where the MV calc engine belongs.** |
| DB types | `packages/db` | Generated Supabase types (`supabase gen types`), client helpers |

- **Engines:** Node `>=22 <25`, pnpm `>=9`. TypeScript 5.5, strict.
- **Turborepo tasks:** `build`, `test` (vitest), `type-check` (`tsc --noEmit`), `lint`. Run via `turbo run <task> --filter <pkg>`.
- **Layering rule (important for a calc-heavy feature):** engineering formulas → `packages/shared` pure services (testable, reused by web + mobile + export). DB reads/writes + auth gating → `apps/web/src/actions/*.actions.ts` (server actions) and `apps/web/src/app/api/**` (route handlers). UI → `apps/web/src/app/(admin)/...`. Mobile consumes the same `packages/shared` services.

---

## 2. The electrical domain as it exists today (what MV builds on)

### 2.1 One graph across two schemas — division of labour

```
                       ┌──────────────────────────── cable_schedule schema ───────────────────────────┐
  structure.nodes      │  sources            supplies (EDGES)        cables                 revisions   │
  (VERTICES)           │  (true origins:     from_node_id  ───┐      (N per supply:          (STUDY      │
   • boards            │   UTILITY/PV/        from_source_id ──┤→     size, cores, Cu/Al,      VERSION:   │
   • transformers      │   STANDBY)          to_node_id (NN)  │      ohm_per_km,              DRAFT→      │
     (mini_sub)        │      │              voltage_v        │      reactance_ohm_per_km,    ISSUED→     │
   • RMUs              │      └──────────────►(230..33000 V)  │      short_circuit_1s_ka)     SUPERSEDED) │
   • generators        │                     design_load_a   │           │                   fault_level │
   • main/sub boards   │                                     ▼           ▼                   _ka          │
   • tenant DBs        │                              structure.nodes  terminations, cable_tags, cost_lines│
   parent_node_id ▲    │                                                                                  │
   (containment tree)  │  sans_tables / sans_rows / sans_overrides  (reference data, incl. MV derating)   │
                       └──────────────────────────────────────────────────────────────────────────────┘
```

- **Vertices = `structure.nodes`.** Every physical node. `kind ∈ {tenant_db, main_board, common_area_board, common_area_lighting, rmu, mini_sub, generator, custom, sub_board}` ([00116_anchor_sub_boards.sql](apps/edge-functions/supabase/migrations/00116_anchor_sub_boards.sql)). Electrical facet columns already present: `voltage_v`, `rating_kva`, `breaker_rating_a`, `section` (NORMAL|EMERGENCY|MIXED), `pole_config`. Containment via `parent_node_id` (adjacency list; cycle-guarded by trigger `structure.nodes_prevent_cycle()`).
- **Edges = `cable_schedule.supplies`** (logical feed) **+ `cable_schedule.cables`** (physical conductors, 1..N parallel per supply). After `00082`, a supply's origin is **XOR**: exactly one of `from_node_id` (→ `structure.nodes`) or `from_source_id` (→ `cable_schedule.sources`); destination `to_node_id` is NOT NULL → `structure.nodes`.
- **The cable layer carries the impedance the fault calc needs:** `cables.ohm_per_km`, `cables.reactance_ohm_per_km`, `cables.short_circuit_1s_ka` ([00051_cable_schedule_core.sql](apps/edge-functions/supabase/migrations/00051_cable_schedule_core.sql)).
- **MV is already a first-class voltage.** `supplies.voltage_v` CHECK = `(230, 400, 525, 1000, 3300, 6600, 11000, 22000, 33000)` — 11/22/33 kV added in `00054` ([00054_cable_schedule_c12_editable.sql:38](apps/edge-functions/supabase/migrations/00054_cable_schedule_c12_editable.sql)).

> Key consequence for the spec: **do not build a separate MV network model.** The MV reticulation (incomer → MV switchgear/RMU → transformer) and the LV reticulation (transformer → main board → sub-boards → tenant DBs) are the *same* connected graph already. Discrimination grading must run across that whole graph, MV through LV.

### 2.2 `cable_schedule` schema (study, edges, reference)

Tables (verify exact columns against `00051`, `00054`, `00055`, `00064`, `00076`, `00078`, `00082`):
- **`revisions`** — the study version. `status DRAFT|ISSUED|SUPERSEDED` (unique partial index: one DRAFT per project), `code` ("Rev 0"…), `issued_at/by`, `change_notes`, and **`fault_level_ka`** (today: the source prospective fault current, *hand-entered*). Children CASCADE from a revision.
- **`sources`** — true network origins only now (`UTILITY, PV, STANDBY`; `RMU`/`MINISUB` were migrated out to `structure.nodes`). Has `rating_kva`, `voltage_v`.
- **`supplies`** — edges (see §2.1). `voltage_v` (incl. MV), `design_load_a`, `section`, origin XOR check.
- **`cables`** — physical conductors. Physical (`size_mm2`, `cores 3|3+E|4`, `conductor CU|AL`, `insulation PVC|XLPE|PILC`, `armour`), dual length workflow (`measured_length_*` Designer vs `confirmed_length_*` Site/Verifier, `length_status UNMEASURED|MEASURED|CONFIRMED|DISCREPANCY`), installation/derating inputs (`installation_method`, `depth_mm`, `thermal_resistivity_kmw`) + cached derate factors, **electrical (`ohm_per_km`, `reactance_ohm_per_km`)**, **`short_circuit_1s_ka`**, cost columns.
- **`terminations`** (gland+lug per FROM/TO end), **`cable_tags`** (QR site tags), **`cost_lines`** (per-revision per-size rates).
- **SANS reference** (`sans_tables` + `sans_rows` + `sans_overrides`) — see §2.4.

### 2.3 Typing & access (cable_schedule is the friendly path)

- **`cable_schedule` IS in the generated types** (`packages/db/src/types.ts`) because `00051` predates type-gen → you can query/write it with the normal typed client: `supabase.schema('cable_schedule').from('cables')…`.
- **`structure` reads work via the typed client too**, but **`structure` *writes* from web code use a raw PostgREST fetch with the `Content-Profile: structure` header** — the supabase-js `.schema('structure').insert()` path silently drops service-role auth and RLS then denies. If MV writes touch `structure.nodes`, follow that raw-fetch convention (grep existing `Content-Profile` usages). Writes confined to `cable_schedule` avoid this.
- Schemas added *after* type-gen (e.g. `projects`, `inspections`) are reached via `(supabase as any).schema('…')` casts. If you add a brand-new MV schema you inherit this cast + a mandatory PostgREST config PATCH (see §4) — another reason to prefer extending `cable_schedule`.

### 2.4 Reference-data system (already MV-aware)

`cable_schedule.sans_tables` (metadata: `code`, `title`, `standard`, `columns` JSONB) + `sans_rows` (`row_data` JSONB keyed to the table's column keys) + `sans_overrides` (per-project `(project_id, table_code)` override library). Bundled defaults are world-readable; overrides are org-scoped. Seeded tables include cable current ratings + the four LV derating tables, **plus MV derating tables** (`00056`–`00059`). The lookup layer is [sans-lookup.service.ts](packages/shared/src/services/sans-lookup.service.ts) (override → bundled fallback).

> Use this exact pattern for protection reference data (device curve libraries, fault-calc constants, standard breaker frames). A new `sans_tables` code + rows, or an analogous companion table, keeps you consistent and gives you the per-project-override mechanism for free.

### 2.5 The calc engine (your template)

[cable-calc.service.ts](packages/shared/src/services/cable-calc.service.ts) — pure functions, no DB, fully unit-tested ([cable-calc.service.test.ts](packages/shared/src/services/cable-calc.service.test.ts)). Already implements:

- `voltDropPctSingle` / `voltDropPctForSupply` — VD%, incl. parallel-cable combination.
- **`computeCumulativeVdMap(supplies, cables, mode)`** — walks the supply tree from each source-rooted edge down to every leaf, accumulating VD% per node, with a cycle guard. **This traversal is the direct structural precedent for a fault-impedance propagation walk** (accumulate series impedance source→node instead of VD%).
- `deratedRating` / `utilisationPct` — ampacity after the 4 SANS derate factors.
- **`requiredParallelSet(designLoadA, ratingForN, maxN)`** — smallest N parallel cables to carry a load = existing **cable-sizing** logic to extend for MV.
- **`shortCircuitCheck(cable1sRatingKa, faultLevelKa)`** — compares a cable's 1 s SC rating to the (currently hand-entered) fault level. This is a *check*, not a *calculation* — your engine will compute the `faultLevelKa` it consumes.
- Companion services: [cable-structure.service.ts](packages/shared/src/services/cable-structure.service.ts) (builds the topology tree) and [cable-diff.service.ts](packages/shared/src/services/cable-diff.service.ts) (revision diffing).

The service header notes it "mirrors the workbook formulas (§5 of the spec)" and references §6/§15.6/§15.7 — there is an existing section-numbered cable-schedule spec/workbook. **Write the MV spec in the same sectioned style and cross-reference it.**

### 2.6 What does NOT exist yet — the MV green-field

Verified absent anywhere in the repo:
- **Fault-level *calculation*.** No impedance summation, no source/transformer/cable Z network reduction, no X/R, no per-unit, no symmetrical-components, no peak (i_p) or RMS break current. `revisions.fault_level_ka` is *only* user-entered.
- **Protection-device model.** No relays/fuses/breakers, no ratings/settings, no curve references.
- **Time-Current Curves (TCC).** No curve representation (parametric IEC or digitised).
- **Discrimination / coordination.** No upstream-vs-downstream grading, no margin checks, no selectivity verdicts.
- **Protection/design study reporting.** No PDF/export of a fault or coordination study (the cable ExportMenu covers the schedule, not protection).

---

## 3. The integration surface — how any new function plugs in

End-to-end pattern (use **inspections** and **project-settings** as the canonical exemplars):

1. **Migration** — `apps/edge-functions/supabase/migrations/00NNN_name.sql`. UUID PKs (`gen_random_uuid()`), FKs with explicit `ON DELETE`, `updated_at` trigger → `public.set_updated_at()`, RLS policies, and end with `NOTIFY pgrst, 'reload schema';`. New SECURITY DEFINER functions must `REVOKE EXECUTE … FROM PUBLIC` and grant only `authenticated`/`service_role`.
2. **`packages/shared`** — Zod schema (`src/schemas/<feat>.schema.ts`, mirrors DB CHECKs), a service (`src/services/<feat>.service.ts`) that validates then reads/writes, a snake_case↔camelCase mapper (`_<feat>-mappers.ts`), and a pure calc service for any math. Export from `src/index.ts`. Role-group constants (`OWNER_ADMIN`, `ORG_WRITE_ROLES`, `COST_VIEW_ROLES`) live in `src/types`.
3. **`packages/db`** — if the new tables aren't in generated types, either add them via `pnpm db:gen-types` or cast `(supabase as any).schema('…')`. (`cable_schedule` is already typed.)
4. **Server actions** — `apps/web/src/actions/<feat>.actions.ts`, **`'use server'` at top** (⚠ such files may export **only async functions** — no Zod schemas/consts/objects; types are erased so they're fine). Each action: resolve entity → org → **role-gate** → call shared service → `revalidateTag`/`revalidatePath`. Return a discriminated union `{ data } | { error }`.
5. **RBAC gating** (`apps/web/src/lib/auth/require-role.ts`): `requireRole(supabase, orgId, roles)` (primitive), `requireEffectiveRole(supabase, projectId, roles)` (per-project effective role — org admins/PM auto-pass, others via `project_members`), `requireRoleAPI(roles, orgId?)` (route handlers), `requireRolePage(roles)` (server components, auto-redirect). Never hardcode role arrays — import the constants.
6. **Web routes/UI** — under `apps/web/src/app/(admin)/projects/[id]/…` (routes use `[id]`, not `[projectId]`). For a multi-tab workspace reuse the settings-shell pattern: `layout.tsx` + tabs + `UnsavedChangesGuard` + `StickySaveBar` + `useDirtyForm`. UI uses `Card/CardHeader/CardBody`, badge variants `default|ghost|info|warning|success|danger`, CSS-var theming.
7. **Mobile** — `apps/mobile` (Expo Router) consumes the same `packages/shared` services; RLS does the auth (no duplicated gate logic).
8. **Realtime** — services expose a `subscribe(client, id, cb)` returning a `RealtimeChannel`.
9. **Tests** — vitest. Pure calc → unit tests (the highest-value, easiest win for a formula engine). Services → mocked-client tests; integration behind `RUN_INTEGRATION_TESTS`. ⚠ Mock with `vi.hoisted(() => ({...}))` when the SUT imports modules at load (`next/cache`), to dodge the TDZ hoisting trap.
10. **Docs/process** — **every new route/endpoint must be added to [docs/rbac-matrix.md](docs/rbac-matrix.md) in the same PR.** Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`.
11. **Deploy** — merging a migration under `apps/edge-functions/supabase/migrations/**` to `main` auto-triggers `.github/workflows/deploy-migrations.yml`. ⚠ Management-API raw-SQL applies do NOT write a `schema_migrations` row (ledger drift) — prefer the workflow; if you apply manually, record the version.

---

## 4. Critical gotchas the spec must respect

- **New schema ⇒ PostgREST config PATCH.** `CREATE SCHEMA` (or `DROP SCHEMA`) requires PATCHing the project's PostgREST `db_schema` via the Supabase Management API, or REST returns `PGRST002` indefinitely. **Extending `cable_schedule` avoids this entirely** — one more reason to prefer it over a new `medium_voltage` schema. (Adding a column/table to an existing exposed schema only needs `NOTIFY pgrst, 'reload schema'`.)
- **`structure` writes need `Content-Profile: structure` raw fetch** (see §2.3). Keep MV writes in `cable_schedule` where possible.
- **`'use server'` files: async functions only.** Put Zod schemas/constants in `packages/shared` or a non-`'use server'` module.
- **SECURITY DEFINER default grant is `PUBLIC` — lock it down.** A role-sensitive definer left public is an enumeration oracle (this bit the project once, fixed in `00113`).
- **`supabase gen types` can't see triggers** — trigger-filled NOT-NULL columns get hand-patched to optional in `types.ts`; re-apply after regen or give them a `DEFAULT ''`.
- **Revisions are immutable once ISSUED** (app-enforced) — a fault/coordination study attached to a revision inherits that lifecycle; design the write paths to refuse edits on ISSUED/SUPERSEDED revisions.
- **`public.profiles` RLS returns only the caller's own row to the cookie client** — any UI that shows *other* users' names must resolve them via `createServiceClient()` after a role gate (recurring trap).

---

## 5. Data-model strawman for MV Protection & Design Calcs  *(PROPOSAL — for the spec to refine)*

### 5.1 Architectural decision (recommended)

- **Calc engine → new pure-TS services in `packages/shared/src/services/`** (e.g. `fault-calc.service.ts`, `protection-coordination.service.ts`, plus extensions to the existing sizing helpers). Authored like `cable-calc.service.ts`: plain inputs → plain outputs, no DB, exhaustive vitest coverage. The network-reduction walk mirrors `computeCumulativeVdMap`.
- **Persisted study data → extend the `cable_schedule` schema.** Protection devices, device settings, computed fault results, and discrimination verdicts are facets of an electrical *study revision*, which already lives there. Reuse `revisions` for versioning and the SANS reference system for curve/device libraries.
- **Intrinsic node electrical attributes → `structure.nodes` facets** (transformers/sources are nodes). Some already exist (`rating_kva`, `voltage_v`, `breaker_rating_a`). New ones (e.g. transformer `%Z`, vector group) attach to the node.
- **Web UI → extend the `projects/[id]/cables/[revisionId]` workspace** with a Protection/Coordination view (reuse `StructurePanel` topology + add a TCC plot + a discrimination table), or a sibling `projects/[id]/protection` route reusing the same shell.

**Rejected alternatives:** (a) a separate `medium_voltage` schema — duplicates the network/revision/reference machinery, forces a PostgREST PATCH + cross-schema SECURITY-DEFINER joins, and *severs* the MV calc from the LV graph that discrimination must grade through. (b) calc in Postgres/edge functions — breaks the established testable pure-TS pattern and the web+mobile+export reuse.

### 5.2 Inputs already present — reuse, don't recreate

| Need | Already in the model |
|---|---|
| Network topology (vertices + edges) | `structure.nodes` + `cable_schedule.supplies` (`from_node_id`/`from_source_id`/`to_node_id`) |
| Series impedance per edge | `cable_schedule.cables.ohm_per_km`, `reactance_ohm_per_km`, plus length workflow |
| Cable withstand | `cable_schedule.cables.short_circuit_1s_ka` |
| Source rating/voltage | `cable_schedule.sources.rating_kva` / `voltage_v` |
| Transformer/generator rating | `structure.nodes.rating_kva`, `voltage_v` (mini_sub / generator kinds) |
| Existing (assumed) fault level | `cable_schedule.revisions.fault_level_ka` (make this *computed* — §5.6) |
| Study versioning + lifecycle | `cable_schedule.revisions` (DRAFT/ISSUED/SUPERSEDED) |
| Reference data + per-project override | `cable_schedule.sans_tables/rows/overrides` (MV derating already seeded) |

### 5.3 New reference data (via the `sans_*` pattern)

- Protection-device library (standard relay/fuse/MCCB/ACB families with frame sizes and parametric IEC curve constants), and fault-calc constants (e.g. voltage factor `c`, IEC 60909 correction factors). Model as new `sans_tables` codes + `sans_rows`, so per-project overrides work for free.

### 5.4 New tables (proposed — names/columns illustrative)

- **`cable_schedule.source_impedances`** *(or node facet)* — per source/transformer fault-supply data the calc needs but the model lacks: utility fault MVA or `R+jX`, transformer `%Z` + `X/R` + vector group, generator subtransient `X″d`. (Transformer/source are nodes/sources today — attach to `structure.nodes` facet columns or a thin companion keyed by `node_id`/`source_id`. Spec to decide where.)
- **`cable_schedule.protection_devices`** — one row per protected point. `revision_id`, `node_id` (the device's board/node) and/or `supply_id` (the feeder it protects), `device_role` (incomer/feeder/transformer/sub-circuit), `device_type` (relay|MCCB|ACB|fuse|RMU-fuse), `manufacturer`, `model`, `frame_rating_a`, `curve_ref` (→ device-library table), `settings` JSONB (pickup, TMS/time-band, instantaneous, etc.), `created_by`, timestamps.
- **`cable_schedule.fault_results`** — *computed + cached* per `(revision_id, node_id)`: three-phase `ik_3ph_ka`, line-ground `ik_1ph_ka` (and ph-ph if in scope), `xr_ratio`, peak `ip_ka`, and `min`/`max` variants. Treat as engine output cached for display/report (or compute on read — spec to decide persistence).
- **`cable_schedule.discrimination_checks`** — *computed* per upstream/downstream device pair: `upstream_device_id`, `downstream_device_id`, `margin_ms` / `margin_a`, `verdict` (ok|marginal|fails), `at_fault_ka`. Drives the coordination table + colouring.

> Keep cross-schema references as plain UUIDs resolved by SECURITY-DEFINER helpers (the codebase convention — see `structure.node_order_project_id()`), not hard cross-schema FKs.

### 5.5 New calc-engine modules (`packages/shared`)

- **`fault-calc.service.ts`** — network reduction: build series/parallel impedance from source through transformers and cables to each node (mirror `computeCumulativeVdMap`'s rooted tree walk, summing complex Z), apply IEC 60909 voltage factor + corrections, output `ik`, `X/R`, `ip` per node. Pure, vitest-tested against worked examples.
- **`protection-coordination.service.ts`** — evaluate device TCC pairs at relevant fault levels, compute grading margins, return discrimination verdicts. Parametric IEC curve evaluation (`t = TMS·k/((I/Is)^α−1)`) lives here.
- **Extend sizing** — generalise `requiredParallelSet` / `shortCircuitCheck` so cable + breaker sizing accounts for the *computed* fault level and adiabatic withstand (`I²t`), not a hand-entered number.

### 5.6 Make `fault_level_ka` computed (keep override)

Today it's a manual assumption. The MV function should *compute* prospective fault current from the network and write it back (or supersede it with the per-node `fault_results`), while allowing an explicit engineer override (with provenance) for design assumptions. Spec to define the override/provenance semantics.

### 5.7 Web surface

Extend the cables workspace (`apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/`): reuse `StructurePanel` (topology) + grid; add a **Protection** tab (device register form per node), a **Fault study** view (per-node `ik`/`X/R`/`ip`), a **Coordination** view (TCC plot + discrimination table with margin colouring). Reuse `Card`, badge tones, `StickySaveBar`, `UnsavedChangesGuard`. Add a protection-study export to the existing `ExportMenu` if reporting is in scope.

### 5.8 Standards to declare in the spec

State explicitly which standards the engine implements and to what fidelity: **IEC 60909** (short-circuit currents), **IEC 60364 / SANS 10142-1** (LV), relevant **SANS** MV reticulation/cable standards (the SANS reference tables already cite SANS 1507/1339), and the protection-curve standard (**IEC 60255** characteristics). The spec should pin formulas + worked examples so the vitest suite can assert them (the cable engine's doc-comment-formula style is the model).

---

## 6. Decisions the spec.md MUST make

1. **Scope boundary** — which of {fault-level calc, protection-device register, TCC plotting, discrimination/coordination, breaker+cable sizing, study reporting/PDF} are in v1 vs deferred?
2. **Fault types & cases** — 3-phase only, or also line-ground / phase-phase? Min and max fault (for sizing vs for sensitivity)? Which IEC 60909 corrections?
3. **Compute vs assume `fault_level_ka`** — adopt computed-with-override (recommended), and define override provenance.
4. **Voltage classification** — keep MV/LV implicit in `voltage_v`, or add an explicit class/band? (Affects which derating/standard tables apply and UI grouping.)
5. **Protection-device data source** — manual entry only, or a seeded manufacturer/standard library (via `sans_*`)? Curve representation: parametric IEC constants vs digitised points?
6. **Home confirmation** — extend `cable_schedule` (recommended) vs new schema. If new schema: budget for the PostgREST PATCH + cross-schema helper pattern.
7. **Transformer/source impedance home** — node facet columns on `structure.nodes` vs a `cable_schedule` companion table.
8. **Persistence of results** — cache `fault_results`/`discrimination_checks` in tables vs compute-on-read. (Caching aids reporting + ISSUED-revision snapshots.)
9. **Mobile scope** — web-only first (likely), or mobile read of study results?
10. **Reporting** — is a coordination/fault study report (PDF) in scope, and does it extend the existing cable `ExportMenu`?
11. **Relationship to `shortCircuitCheck`** — does the new engine supersede or feed the existing cable check?

---

## 7. Spec-author alignment checklist

Make sure `spec.md` contains, and ties each to the codebase:

- [ ] **Data model** expressed as a delta on `cable_schedule` + `structure.nodes` (reuse table in §5.2), not a fresh model. List every new column/table + the migration number it will land in.
- [ ] **RLS + RBAC** for every new table/route, using `user_has_project_access` / `user_effective_project_role` and the role constants; plus the `docs/rbac-matrix.md` rows.
- [ ] **Calc engine** specified as pure functions with **formulas + worked numeric examples** (so vitest can assert), authored in `packages/shared` like `cable-calc.service.ts`.
- [ ] **Reference data** plan via `sans_tables`/`sans_rows` (+ overrides), naming the table codes.
- [ ] **Revision/lifecycle** semantics: how a study attaches to a `revision`, behaviour on ISSUED/SUPERSEDED, and the `fault_level_ka` compute/override rule.
- [ ] **Server actions** list (`*.actions.ts`), each with its role gate, and **route handlers** for any heavy/streaming compute or export.
- [ ] **Web surface** mapped to the cables workspace shell (tabs/components to add or reuse).
- [ ] **Migration + deploy** note: extend `cable_schedule` (no PostgREST PATCH) or new schema (PATCH required); land via `deploy-migrations.yml`.
- [ ] **Gotchas** acknowledged: `'use server'` export limits, SECURITY DEFINER grant lockdown, `Content-Profile` for any `structure` writes, `vi.hoisted` for mocks.
- [ ] **Standards** declared (§5.8) with the implemented subset and fidelity.
- [ ] **Test plan**: unit (calc), service (mocked), integration (RUN_INTEGRATION_TESTS), and a smoke test à la `scripts/db/smoke-test-anchor-sub-boards.sh`.

---

## Appendix — key file references

| Concern | File |
|---|---|
| Network vertices + node kinds + containment | [00116_anchor_sub_boards.sql](apps/edge-functions/supabase/migrations/00116_anchor_sub_boards.sql), `00074/00075` (structure nodes + RLS) |
| Cable schema core (revisions, sources, supplies, cables, terminations, tags, cost_lines) | [00051_cable_schedule_core.sql](apps/edge-functions/supabase/migrations/00051_cable_schedule_core.sql) |
| MV voltages added | [00054_cable_schedule_c12_editable.sql](apps/edge-functions/supabase/migrations/00054_cable_schedule_c12_editable.sql) |
| Supplies unique (from,to) | `00055_cable_schedule_supplies_unique_from_to.sql` |
| Boards → nodes re-point (READ THESE for the unified-graph history) | `00076_supplies_node_fks.sql`, `00078_repoint_to_nodes.sql`, [00082_drop_legacy_cable_board_structures.sql](apps/edge-functions/supabase/migrations/00082_drop_legacy_cable_board_structures.sql) |
| SANS reference + MV derating | `00053_sans_reference_library.sql`, `00056`–`00059`, `00064_cables_grouping_arrangement.sql` |
| Calc engine (TEMPLATE) | [cable-calc.service.ts](packages/shared/src/services/cable-calc.service.ts) + [.test.ts](packages/shared/src/services/cable-calc.service.test.ts) |
| Topology + diff services | [cable-structure.service.ts](packages/shared/src/services/cable-structure.service.ts), [cable-diff.service.ts](packages/shared/src/services/cable-diff.service.ts) |
| SANS lookup | [sans-lookup.service.ts](packages/shared/src/services/sans-lookup.service.ts) |
| RBAC helpers | [require-role.ts](apps/web/src/lib/auth/require-role.ts) |
| Cables web workspace (extend here) | `apps/web/src/app/(admin)/projects/[id]/cables/[revisionId]/` |
| Cable ingress (parse/commit) | `apps/web/src/app/api/cable-schedule/parse/route.ts`, `.../commit/route.ts` |
| RBAC matrix (update with new routes) | [docs/rbac-matrix.md](docs/rbac-matrix.md) |
| Migration deploy | `.github/workflows/deploy-migrations.yml` |
