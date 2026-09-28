# E-Site Solar — Open Decisions (owner)

Each decision has a **proposed default** that will be built unless changed. **P0** = needed before Phase 1 starts.

| ID | P0? | Question | Proposed default | Why it matters |
|---|---|---|---|---|
| D-01 | ✅ | Pricing model and amount: per-project one-time, per-project annual, org-wide subscription, or both? | Per-project one-time unlock (price TBD by owner) **plus** optional org annual subscription later | Drives tables, Paystack flows, sidebar lock. Also resolve Pro R999 vs R1,499 inconsistency first |
| D-02 | ✅ | What happens after a refund/chargeback? | Read-only (data and reports stay visible, no edits/runs) | Avoids destroying client work |
| D-03 | ✅ | Who maintains the tariff library, and who may read it? | Platform tariff admins = WM-Consulting owner/admin (new `is_platform_tariff_admin()`); read by any org with ≥ 1 Solar entitlement | Reference data is shared across all customers |
| D-04 | ✅ | Can contractors/inspectors see Solar technical tabs (no money)? | Yes: Site, Load (kW/kWh only), Layout, Yield; money in separate tables gated to COST_VIEW_ROLES | Shapes RLS and table split |
| D-05 | ✅ | Insurance: WM computes capex × rate × 12. Is the input a monthly or annual %? | Annual % of capex, no ×12, default 0.5 % | WM figures overstated insurance 12× |
| D-06 | | Load archetype shapes and W/m² densities per category — use GCR densities, WM shop types, or a WM-supplied table? | Seed from GCR densities + 8 archetypes; owner reviews | Synthesised load quality |
| D-07 | ✅ | Financial defaults: discount rate, escalation path, O&M, CPI | 11 % / 9 %→7 %→CPI+1 % / R150/kWp/yr / 5 % | Every IRR/NPV |
| D-08 | | External providers: geocoding (Google vs Mapbox), satellite imagery (Mapbox static + licence/attribution), Solcast licence | Keep the web app's providers, all server-side: Mapbox/Google geocoding, Mapbox static satellite, GSA + PVGIS for resource; Solcast only for the 7-day operations forecast and only if the licence is commercial | Cost and licensing |
| D-09 | | Default export limit and hosting-capacity warning threshold | Warn when PV AC > 75 % of transformer kVA (NRS 097-2-3 simplified); export limit defaults to NMD | Grid-connection advice |
| D-10 | | Support landlord/private resale tariffs (embedded networks) in v1? | Yes, via project tariff override | Most WM malls are resale sites |
| D-11 | | Row-spacing rule and near-shading method | No inter-row shading 09:00–15:00 on 21 June; obstruction horizon shading on beam | Layout counts and yield |
| D-12 | ✅ | When should Operations (generation, monthly reports, handover, forecast) ship? | Phase 7, after the design workflow ships (it is a web feature, so it is in scope) | Sequencing |
| D-13 | — | ~~Keep a 3D preview?~~ | **Resolved:** carried (web feature) | — |
| D-14 | | Model load-shedding avoided-cost value? | Optional separate line, not in base IRR | Credibility of headline IRR |
| D-15 | | Finance models in v1: cash, debt, PPA, lease? | Cash + debt in v1; PPA in v1.1; lease later | Proposal types |
| D-16 | | Tax: include Section 12B and company tax? VAT treatment? | Toggle, default off; results excl. VAT | Commercial clients' real returns |
| D-17 | | AI-written proposal narrative? | Optional, server-side, saved as editable text | Cost, review burden |
| D-18 | | Client access to proposals: E-Site portal login or public token link? Allow a question thread? | Public expiring token link (no login) + portal listing for existing client users; questions via email reply | Client friction vs control |
| D-19 | ✅* | Validation references (PVsyst reports, real bills + meter data); PAN/OND import? | Owner supplies 2–3 PVsyst reports and 3–5 bills; PAN/OND import in P4 if cheap | Engine acceptance |
| D-20 | | Schedule tasks: store as E-Site work items (type `solar_task`, visible in My Work) or as Solar-only rows? | Work items + Gantt side table | Tasks show up across E-Site |
| D-21 | — | ~~Drop the Schematics editor?~~ | **Resolved:** carried (web feature) | — |
| D-22 | ✅ | New `solar` + `tariffs` schemas (needs PostgREST PATCH) or tables in `projects`? | New schemas (clean boundaries, entitlement RLS) | Migration/ops risk |
| D-23 | | Meter readings: Postgres table (partitioned) or Parquet in Storage + aggregates? | Postgres, decided by the P3 volume test | Cost/performance |
| D-24 | ✅ | Contain the live WM Solar exposure now (rotate keys/token, JWT on, drop anon policies), and who does it? | Yes, this week, as a separate task from E-Site | Live client data exposed |
| D-25 | ✅ | Which Supabase project is WM Solar production, and should existing data migrate into E-Site? | Migrate only meter raw files and signed proposals (as PDFs); re-run studies in E-Site | Phase 8 scope |
