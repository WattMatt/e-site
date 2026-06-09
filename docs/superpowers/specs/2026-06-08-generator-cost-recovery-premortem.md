# PRE-MORTEM ANALYSIS — Generator Cost-Recovery (Tenant Generator Report) as a paid extra in esite

**Plan / Project:** Clone the "Tenant Generator Report" generator cost-recovery engine from `engi-ops-nexus` into `esite` (ESITE.V1/esite) and sell it as a one-time paid unlock (R2 000 once-off).
**Pre-Mortem Date:** 2026-06-08
**Prospective Horizon:** 12 months (to ~2027-06-08)
**Method:** Gary Klein prospective hindsight — assume failure as fact, explain it.

**Failure Frame:**
> "It is June 2027. The generator cost-recovery paid extra in esite has *failed*. Either it never shipped, or it shipped and produced numbers customers couldn't trust, or it shipped correctly but nobody bought it / nobody could use it. Looking back, here is what went wrong."

---

## PLAN SUMMARY (Pre-Analysis Baseline)

**Objective (success = all three):**
1. **Technical:** esite orgs can define generator zones/costs/settings, assign tenants (with floor area + category) to zones, and generate a multi-page cost-recovery PDF whose methodology and numbers are *identical* to nexus.
2. **Commercial:** Orgs actually pay R2 000 to unlock it, and it produces output accurate enough to bill real tenants against.
3. **Operational:** It ships without derailing esite's other in-flight work (Paystack go-live, inspections, JBCC) and without creating an outsized support/accuracy liability.

**Key milestones:** Port calc engine → `packages/shared`; add `shop_category` to `structure.nodes`; build domain tables (zones, generator costs, settings, reports); rebuild PDF in `@react-pdf/renderer`; wire `generator_cost_recovery` feature key + paywall + Paystack unlock route; web-only manual-download MVP.

**Critical assumptions:**
- A1: The nexus generator-report formulas are the canonical, current, correct logic.
- A2: esite orgs have (or will capture) the input data — floor areas, tenant categories, generator kVA, costs, diesel price, run hours.
- A3: There is a paying segment in esite's base that values this at R2 000.
- A4: The existing per-**org** unlock mechanism can satisfy a "R2 000 per **user**" pricing intent.
- A5: `@react-pdf/renderer` can reproduce the nexus report (incl. its charts) at acceptable fidelity.
- A6: The methodology is legally/contractually acceptable for on-billing generator costs to SA tenants.
- A7: Paystack live-mode will be available to actually take payment.

**Key dependencies (outside the build's control):** Paystack go-live; the nexus codebase as source of truth; the domain owner's (WM) availability to validate formulas; esite orgs entering prerequisite data; the SA power situation that drives demand.

---

## FAILURE MODE TAXONOMY

### EXECUTION FAILURES
| # | Failure Mode | Root Cause | Prob | Impact | Early Warning Signal |
|---|--------------|-----------|------|--------|----------------------|
| F1 | **Ported calc drifts from nexus** — apportionment, PMT, fuel-table interpolation, or contingency order differs → wrong R/tenant | Calc treated as code to translate, not financial IP to prove-equal via regression | H | H | First side-by-side test of a real project shows ≠ nexus totals |
| F2 | **PDF/chart rebuild underestimated** — multi-page layout (cover, glossary, ToC, Appendix A/B/C, Recharts charts) hard in `@react-pdf` | "Rebuild report" scoped as one task, not a sub-project; charts have no `@react-pdf` equivalent | H | M | PDF spike takes >2× estimate; charts can't render |
| F3 | **Data-model impedance** — nexus zones→generators tables vs esite `structure.nodes` generators; tenant↔zone, capacity, own-generator flag modeled inconsistently | Two domain models fused without an explicit mapping design | M | H | Schema review can't cleanly answer "where does a generator's kVA/cost live?" |
| F4 | **`shop_category` rollout incomplete** — column added but import parser / backfill / tenant UI / `packages/db` types not updated → null categories default to 0.03 silently → wrong loadings | Schema change not paired with parser + backfill + UI + types | M | H | Existing tenants show blank/forced category after migration |
| F5 | **Runtime-boundary break** — `@react-pdf` (Node-only) imported into edge/client, or calc placed in `apps/web` not `packages/shared` | Monorepo runtime boundaries not respected (render must run in Node) | M | M | Build/runtime error on report route; logic not unit-testable in isolation |

### ASSUMPTION FAILURES
| # | Failure Mode | Root Cause | Prob | Impact | Early Warning Signal |
|---|--------------|-----------|------|--------|----------------------|
| F6 | **"Per user" intent vs per-org infra** — `org_feature_unlocks` grants per-org; building per-org under-charges vs "per user", building per-seat is a new entitlement model (seat tracking, add/remove, who pays) | Pricing granularity set in isolation from entitlement data model | H | H | The unlock spec can't state, unambiguously, *what one R2 000 payment grants* |
| F7 | **Nobody pays R2 000** — value priced by analogy to JBCC, not validated; real buyers (property managers / large multi-tenant sites) are a thin slice of esite's contractor base | Supply-driven ("it exists, clone it") not demand-validated | M-H | H | No pre-commitments from any existing org when asked |
| F8 | **Prerequisite data absent → unusable** — orgs lack accurate areas/categories/gen costs; "I paid and it outputs garbage" | Cloned the report (last mile) without the data-capture workflow nexus had | M-H | H | Pilot org's tenant register has sparse `shop_area_m2`, no gen costs |
| F9 | **Charts can't be reproduced** — nexus's Recharts visuals have no `@react-pdf` path | Parity assumed without checking rendering stack | M | M | (see F2) |

### EXTERNAL SHOCK FAILURES
| # | Failure Mode | Root Cause | Prob | Impact | Early Warning Signal |
|---|--------------|-----------|------|--------|----------------------|
| F10 | **Cloned a stale/wrong nexus version** — last nexus commit 2026-03-02; real logic may have moved, or live in a branch/another app | Snapshot cloned without domain-owner confirmation it's canonical | M | H | WM can't confirm nexus `main` is the production formula set |
| F11 | **Paystack go-live slips** — unlock can't take live payment (pre-go-live per `docs/paystack-go-live-roadmap.md`) | Monetization depends on a still-incomplete billing integration | M | H | Go-live roadmap milestones unmet at feature-ready date |
| F12 | **Diesel / rand volatility** — point-in-time diesel & cost inputs go stale; users bill outdated rates | Cost inputs captured once, no freshness enforcement | M | M | Diesel price moves >10% with no settings update prompt |
| F13 | **Power-crisis demand swing (SA)** — grid *improves* → generator cost-recovery demand evaporates; or load-shedding *worsens* → run-hours/diesel shift so fast monthly settings are stale | Feature value tightly coupled to a volatile external (Eskom) | M | M-H | Eskom load-shedding stage trend (either direction) over a quarter |

### POLITICAL / ORGANIZATIONAL FAILURES
| # | Failure Mode | Root Cause | Prob | Impact | Early Warning Signal |
|---|--------------|-----------|------|--------|----------------------|
| F14 | **Key-person / single-builder risk** — formulas + build live in one head (Arno/WM); diverted to client work (or emigration) stalls it indefinitely | IP concentrated in one person + one repo; no second owner | M-H | H | Two consecutive weeks of zero progress; no one else can explain the PMT/tariff math |
| F15 | **Deprioritised against esite core** — inspections, JBCC, payment-recovery, Paystack go-live compete; a "nice-to-have" extra never finishes | Organisational capacity — too many simultaneous initiatives | M | M | Feature repeatedly bumped in planning |
| F16 | **Accuracy liability sours the brand** — once orgs bill tenants off it, any error → support load, trust damage, possible dispute | Selling a "we compute money you charge others" feature raises bar to near-accounting-grade | M | H | First customer query: "your report over/under-charged my tenant" |

### RESOURCE FAILURES
| # | Failure Mode | Root Cause | Prob | Impact | Early Warning Signal |
|---|--------------|-----------|------|--------|----------------------|
| F17 | **Email/cron debt forces scope creep** — customers expect emailed tenant statements + monthly scheduling (nexus has both); esite has *neither* | MVP scoped web-only, but customer/competitive expectation is distribution | M | M | First customer asks "how do I send this to my tenants automatically?" |
| F18 | **No QA budget for financial output** — correctness across many tenant/zone configs needs disciplined testing; under delivery pressure it's skipped | Testing treated as optional | M | H | No golden-master test file exists at code-complete |

### TIMING FAILURES
| # | Failure Mode | Root Cause | Prob | Impact | Early Warning Signal |
|---|--------------|-----------|------|--------|----------------------|
| F19 | **Blocks on Paystack go-live** — feature done but un-sellable until live payments exist | Dependency sequencing (feature ready before payment rails) | M | M | Code-complete while Paystack still in test mode |
| F20 | **Ships after demand peak** — 6–9 month build for a demand driver (load-shedding) that may be transient | Long build vs a possibly-transient driver | L-M | M | Grid stabilisation trend during the build |
| F21 | **Pilot feedback loop too slow** — no design partner, so wrongness is discovered only after public launch | No early customer in the loop | M | M | No named pilot org by build start |

**Total: 21 distinct failure modes across all 6 categories.**

---

## TOP 5 FAILURE MODES (Ranked by Probability × Impact)

### #1 — Ported calculation engine drifts from nexus (F1) — **CRITICAL**
**Probability:** High (~60%) without explicit guards. **Impact:** High — customers bill tenants on wrong figures; refunds, disputes, brand damage; this is *money other people are charged*.
**Root cause (5 Whys):** Wrong numbers → formulas re-implemented from reading code → not verified against known outputs → no golden-master cases captured from nexus → **the calc was seen as code to translate, not as financial IP whose equivalence to the source must be proven by regression.**
**Early warning signal:** First side-by-side run of a real nexus project in esite yields a different per-tenant total, % portion, or R/m².
**Warning threshold:** *Any* discrepancy > R0.01 on capital recovery or > 0.01% on apportionment on the first comparison.
**Prevention strategy:** Before porting, extract **golden-master fixtures** from nexus — for 3–5 real projects, capture inputs + every intermediate (loading kW per tenant, total capex, monthly repayment, diesel R/kWh, maintenance R/kWh, contingency, final tariff, each tenant's monthly + R/m²) and the final PDF tables. Port as pure functions in `packages/shared`; assert byte-for-byte numeric equality against fixtures in CI. Pin rounding rules explicitly.
**Prevention cost:** ~1–2 days to build fixtures + test harness. High ROI — turns "hope it matches" into "proven it matches."

### #2 — "Per user" pricing vs per-org entitlement infra (F6) — **CRITICAL / HIGH**
**Probability:** High (~70%) — the mismatch exists *today*, unresolved. **Impact:** High — either systematic under-charging (per-org built, "per user" intended) or a much larger build (per-seat entitlement) discovered mid-stream → rework.
**Root cause (5 Whys):** Billing wrong/rework → pricing intent ≠ entitlement granularity built → existing mechanism is per-org, reused as-is → plan said "copy Inspections unlock verbatim" (Inspections is per-org) → **pricing ("per user") was decided separately from the entitlement data model; nobody reconciled it against `org_feature_unlocks` being per-org.**
**Early warning signal:** The unlock spec cannot state in one sentence *what a single R2 000 payment grants* (the whole org? one named seat? N seats?).
**Warning threshold:** Spec review reaches the billing section without a definitive answer.
**Prevention strategy:** **Resolve before any billing code.** Two clean options:
- **(A) Per-org R2 000 (recommended for MVP):** mirrors existing infra verbatim, zero new billing surface; reconcile the wording to "R2 000 once-off per organisation." Lowest risk, ships fastest.
- **(B) Per-seat:** extend entitlement to track seats (`org_feature_seats` or similar), define add/remove/transfer semantics, who-can-buy, proration. Materially larger; only if commercially essential. *Note:* R2 000 **per user** is ~8× JBCC (R1 999/org) and could mean R20 000 for a 10-user org — sanity-check the intent against willingness-to-pay (ties to F7).
**Prevention cost:** Option A: ~0 (reuse). Option B: +3–5 days + ongoing billing-edge maintenance.

### #3 — Nobody pays R2 000 (demand / willingness-to-pay) (F7) — **HIGH**
**Probability:** Medium-High (~45%). **Impact:** High — commercial failure even if technically perfect.
**Root cause (5 Whys):** No sales → few esite orgs both manage multi-tenant generator billing *and* value it at R2 000 → the buyer is a narrow niche (property/asset managers, large malls), not the typical electrical contractor → built because it exists in nexus, not because esite demand was shown → **supply-driven cloning instead of demand-validated product.**
**Early warning signal:** When asked, *zero* existing esite orgs pre-commit or express intent to buy.
**Warning threshold:** < 2 named orgs willing to pre-purchase or pilot before build start.
**Prevention strategy:** **Pre-sell before building.** Take the nexus report (already exists) to 3–5 target esite orgs; ask for a soft commitment at R2 000. If ≥2 commit, build with confidence. If 0, either reprice, repackage (e.g., bundle into Professional tier), or shelve. Cheapest possible insurance against the most common failure mode.
**Prevention cost:** ~2–3 hours of customer conversations. Highest-leverage action in this whole pre-mortem.

### #4 — Prerequisite data absent → "I paid and it's garbage" (F8) — **HIGH**
**Probability:** Medium-High (~45%). **Impact:** High — paid feature is unusable, triggers refunds + F16 brand damage.
**Root cause (5 Whys):** Unusable after unlock → tenant areas/categories/generator costs not captured in esite → esite has area but no category and no generator-cost capture → nexus had a dedicated tenant-tracker + generator-costing workflow feeding the report → **cloned the report (last mile) without the data-entry funnel that makes inputs trustworthy.**
**Early warning signal:** A pilot org's tenant register has sparse `shop_area_m2`, no categories, and no place to enter generator/diesel costs.
**Warning threshold:** On the pilot project, < 90% of tenants have area + category, or generator costs can't be entered at all.
**Prevention strategy:** Scope the **input-capture UI** as a first-class part of the feature, not an afterthought: category picker on tenants, generator zone + cost entry, settings form (diesel, run-hours, recovery rate). Add a **readiness check** ("12 of 40 tenants missing area/category") before allowing report generation, so the failure is visible and self-serviceable, not silent.
**Prevention cost:** Significant but unavoidable — it *is* part of the feature. Estimate it explicitly in the build plan.

### #5 — PDF + charts rebuild underestimated (F2/F9) — **MEDIUM-HIGH**
**Probability:** High (~55%) of overrun. **Impact:** Medium — slips timeline / ships lower-fidelity, not catastrophic.
**Root cause (5 Whys):** Slips or looks poor → `@react-pdf` can't render nexus's SVG/Recharts layout directly → different rendering stacks, charts have no equivalent → "rebuild report" was a single line item → **report fidelity scoped as one task instead of a sub-project with its own layout + chart strategy.**
**Early warning signal:** The PDF spike exceeds 2× its estimate, or charts have no rendering path.
**Warning threshold:** > 2 days on the PDF without a paginating, table-correct draft.
**Prevention strategy:** De-risk with a **PDF spike first** (one Appendix table end-to-end in `@react-pdf` before committing). Decide charts explicitly: drop for MVP, or pre-render to static SVG/PNG server-side. Reuse the existing `lib/reports/inspection-report.tsx` patterns as the scaffold.
**Prevention cost:** ~1 day spike; saves multiples in rework.

---

## COMPOSITE FAILURE RISK ASSESSMENT
**Overall risk level:** **Medium-High.** The *technical* clone is very feasible (esite has tenants-with-area, generator nodes, the unlock machine, and a PDF stack). The risk concentration is **not** where it feels — it's in **correctness proof, entitlement-model clarity, and demand**, not in "can we build it."
**Primary risk concentration:** Split between **Assumption failures** (F6 entitlement, F7 demand, F8 data) and **Execution correctness** (F1 calc).
**Most surprising finding:** The biggest threats are commercial and definitional (will anyone pay? what does R2 000 buy? is the input data even there?), not engineering. The team's instinct will be to start coding the calc; the highest-leverage work is a 3-hour pre-sell and a one-sentence entitlement decision.
**Most overlooked assumption:** **A6 — that the methodology is legally acceptable for on-billing generator costs to SA tenants.** On-billing of electricity to tenants is regulated; if the output isn't defensible against a lease/municipal/NERSA challenge, customers can't actually use it to charge tenants. Validate with one property-management customer's lease + a quick regulatory check before relying on it.

---

## PRE-MORTEM ACTION LIST
*(Dates are phase-relative — set real dates against your calendar. Owner "Arno/WM" = founder/dev + domain owner.)*

| Action | Failure Mode(s) | Owner | Deadline | Risk Reduction |
|--------|-----------------|-------|----------|----------------|
| Pre-sell to 3–5 target orgs at R2 000; require ≥2 soft commits to proceed | F7, F8, F3-demand | Arno/WM | **Before build start (gate)** | H |
| Decide entitlement model in one sentence: **per-org (A)** vs per-seat (B); recommend A for MVP | F6 | Arno/WM | Before build start (gate) | H |
| Confirm nexus `main` is the canonical production formula set | F10, F1 | WM (domain owner) | Before build start | M-H |
| Extract golden-master fixtures from 3–5 real nexus projects (inputs + all intermediates + PDF tables) | F1, F18 | Arno/WM | Sprint 1, before porting | H |
| Validate on-billing methodology against one real lease + quick NERSA/municipal check | F16, A6 | WM + customer | Before launch | M-H |
| PDF spike: one Appendix table end-to-end in `@react-pdf`; decide charts (drop vs static-render) | F2, F9 | Arno | Sprint 1 | M |
| Design the data-model mapping (nexus zones/generators ↔ esite nodes) on one page before migrations | F3, F4 | Arno | Sprint 1 | M-H |
| Pair `shop_category` migration with parser + backfill + tenant UI + `packages/db` types in one PR | F4 | Arno | Sprint 2 | M |
| Build a "report readiness" check (missing area/category/cost) before allowing generation | F8, F16 | Arno | Sprint 3 | M |
| Confirm Paystack live-mode timeline; sequence launch *after* go-live | F11, F19 | Arno/WM | Pre-launch | M |
| Recruit 1 named pilot org to run a real recovery cycle before public launch | F21, F16, F8 | WM | Pre-launch | M-H |

**Hard gate:** Do not start the build until the first two actions (pre-sell ≥2, entitlement decided) are done. They cost hours and prevent the two highest-impact failures.

---

## ASSUMPTION VALIDATION REQUIRED
| Assumption | Validation Method | By When | Owner |
|------------|-------------------|---------|-------|
| A1/A10 nexus logic is canonical & correct | Domain owner confirms `main`; golden-master fixtures captured | Pre-build | WM |
| A3 ≥2 orgs will pay R2 000 | Pre-sell conversations | Pre-build (gate) | Arno/WM |
| A2 input data exists/will be entered | Inspect a pilot org's real tenant register | Pre-build | Arno |
| A4 "per user" is genuinely intended (vs per-org) | One explicit decision; sanity-check R2 000×seats vs WTP | Pre-build (gate) | Arno/WM |
| A5 `@react-pdf` reaches acceptable fidelity | PDF spike | Sprint 1 | Arno |
| A6 methodology is legal for on-billing | Lease review + regulatory check | Pre-launch | WM |
| A7 Paystack live payments available | Go-live roadmap status | Pre-launch | Arno/WM |

---

## EARLY WARNING DASHBOARD
| Signal | Warning Threshold | Response Trigger | Frequency | Owner |
|--------|-------------------|------------------|-----------|-------|
| Pre-sell commitments | < 2 by build start | Reprice / repackage / shelve | Once (gate) | Arno/WM |
| Golden-master test pass | Any numeric mismatch | Stop; fix calc before proceeding | Per CI run | Arno |
| Entitlement spec clarity | Can't state what R2 000 grants | Block billing code until decided | Spec review | Arno |
| PDF spike effort | > 2 days, no clean draft | Cut charts / simplify layout | Sprint 1 | Arno |
| Pilot data completeness | < 90% tenants have area+category | Build/strengthen capture UI | Pre-launch | Arno |
| Paystack go-live status | Test-mode at code-complete | Hold launch; don't sell in test mode | Monthly | Arno/WM |
| Eskom load-shedding trend | Sustained stage drop over a quarter | Re-test demand assumption | Quarterly | WM |
| Diesel price move | > 10% since last report run | Prompt users to update settings | Per report | (in-app) |

---

## PLAN MODIFICATIONS RECOMMENDED
1. **Add a hard pre-build gate:** ≥2 pre-sell commitments **and** a one-sentence entitlement decision before a line of code.
2. **Default the entitlement to per-org** (R2 000 once-off per organisation) for MVP — mirrors existing infra verbatim; only go per-seat if pre-sell proves it's needed.
3. **Promote "input capture + readiness check" to a first-class workstream** — the report is worthless without trustworthy inputs.
4. **Treat the calc as proven-equivalent IP** — golden-master fixtures + CI equality are non-negotiable, not optional QA.
5. **Run a PDF spike before committing** to the full report; decide charts explicitly (recommend: drop charts for MVP, ship the tables that carry the money).
6. **Sequence launch after Paystack go-live**; build can proceed in parallel but selling cannot precede live payments.
7. **Keep MVP web-only, manual download** (confirmed) — explicitly defer email statements + scheduled reports as a *fast-follow* once email/cron infra exists, and say so to pilot customers up front to manage expectations.
8. **Validate on-billing legality** with one real lease before customers charge tenants off it.

---

## WHAT THIS PLAN DOES WELL (Risk-Balanced View)
This is a **fundamentally sound** clone, and several things de-risk it materially:
- **The hardest infrastructure already exists in esite:** tenants with floor area, generator nodes, org/project scoping + RLS, a **production-ready paid-unlock mechanism** (copy verbatim), a `@react-pdf` report stack, and an RBAC model. You are not building monetization or multi-tenancy from scratch.
- **The source feature is real, complete, and battle-tested** in nexus — the formulas, defaults, and report structure are known, not speculative. This is a port, not an invention.
- **The calculation model is genuinely valuable IP** — apportioning generator capex + opex to tenants is a real, painful, billable problem for SA property managers, and few tools do it well.
- **The MVP scope is correctly conservative** (web-only, manual download), avoiding the email/cron rabbit-hole.
- **Mirroring the existing R250/R1 999 unlock pattern** means the billing path is low-risk and consistent with the product.

The plan's exposure is concentrated in a few cheap-to-test unknowns (demand, entitlement wording, input-data presence, calc equivalence) — exactly the kind a pre-mortem is meant to surface *before* they cost real money. Close those with a few hours of pre-sell + one decision + a fixtures harness, and the risk profile drops from Medium-High to Low-Medium.
```
