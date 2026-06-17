# Medium Voltage Inspection Templates — Design

**Date:** 2026-06-16
**Status:** Approved design pending spec review → implementation plan
**Source forms:** `mv-handover-templates.json` (Watson Mattheus MV Handover & Protection Templates v1.0.0, derived from Princess Mkabayi / Project 612), provided by the user.
**Owner org:** Watson Mattheus Consulting (`dddddddd-0000-0000-0000-000000000001`).

## Goal

Add five Medium Voltage inspection forms to the e-site Inspections module, grouped under a "Medium Voltage" category, such that **(a) every form is fully fillable in the UI and (b) every applicable item persists to the database**. A coverage audit (2026-06-16, 5 templates × extract→adversarial-verify) confirmed all 124 source items are representable with zero hard data drops, but found four gaps that must be closed for (a) and (b) to be literally true. This design closes them.

**Key decisions (user-approved):**
- **Native field types only** — no new `matrix` field type; repeating matrices become `repeating_group` blocks / fixed scalar fields.
- **All five templates** — the three house QA forms + Protection Settings (record sheet) + Annex B (structure only, no SANS wording).
- **Signatures:** proper field-keyed fix (schema migration + thread-through), so Annex B's three statutory signatories persist distinctly and required signatures can be enforced.
- **Validation:** capture-only for v1 — no `pass_when` auto pass/fail on numeric readings (acceptance varies by project; avoids false fails). Thresholds are a future enhancement.

## How the inspection system works (established facts)

- A template is one row in `inspections.templates`; its entire sections→fields tree lives in `schema_json` (JSONB), validated by the shared Zod `templateSchema` (`packages/shared/src/inspections/template-schema.ts`). No relational section/field tables.
- 13 field types (`packages/shared/src/inspections/types.ts`): `pass_fail, number, text, textarea, dropdown, multi_select, date, photo, signature, file, header, computed, repeating_group`. No matrix/grid. `repeating_group` is single-level (scalar sub-fields only).
- Answers persist in `inspections.responses` (`value_bool/number/text/array/json`, `pass_state`, `fail_reason`), keyed `(inspection_id, section_id, field_id)` as text; `repeating_group` entries use synthetic ids `group[i].subfield`. Photos/signatures in their own tables.
- Gating: per-org `inspections` feature unlock with the WM bypass (`apps/web/src/lib/features.ts`). These ride that gate.
- Templates are authored as `schema_json` and inserted via builder/JSON-paste/server action/import script; **no template inserts currently exist in migrations**.

---

## Part A — Platform fixes (shared inspections module)

These touch certification-bearing shared code; each ships with unit tests and must not regress the existing 12 WM templates.

### A1. Field-keyed signatures (required for Annex B + cable cert)

**Problem:** `inspections.signatures` (migration 00066:165-175) is keyed only by `(inspection_id, role)`; `SignatureField.tsx` hardcodes `role='inspector'` and never forwards `field_id`/`section_id`. So multiple signature fields collapse into one row (Annex B's 3 signatories are indistinguishable), per-field signatures don't persist for the cable certificate, and `engine.ts` filters required signatures by a `field_id` that can never match → required signatures are permanently unsatisfiable.

**Fix:**
1. Migration: add nullable `field_id TEXT` and `section_id TEXT` to `inspections.signatures`; new uniqueness `(inspection_id, section_id, field_id)` where field_id is not null (keep the legacy `(inspection_id, role)` path working — additive, existing rows unaffected).
2. Thread `field.field_id` + `sectionId` through `SignatureField.tsx` → `SignatureModal.tsx` → `/api/.../upload-signature` route → insert.
3. `engine.ts`: satisfy/required-signature evaluation filters by `(section_id, field_id)` so a required signature is met only when that field's signature exists.
4. Keep `role` for backward compatibility (default 'inspector' when no field context).

**Tests:** a field signature persists with its `field_id`; two signature fields in one template don't collide; a `required` signature gates `overallResult` only when absent.

### A2. Pass/Fail N/A control (required for Annex B checklist)

**Problem:** `PassFailField.tsx` renders only Pass/Fail; the DB CHECK and engine already accept `pass_state='na'`. Annex B's SANS checklist relies on N/A → currently un-enterable.

**Fix:** add a third **N/A** button to `PassFailField` → writes `pass_state='na'`, `value_bool=null`, clears `fail_reason`. Confirm `engine.ts` treats `na` as non-failing (it does). Ensure the report renderer shows "N/A". Always offer N/A (no per-field flag needed for v1).

**Tests:** selecting N/A persists `pass_state='na'`; engine does not count `na` as a fail; report shows N/A.

### A3. Wire `default_value` into the fill UI

**Problem:** no fill widget reads `field.default_value` (grep: 0 hits); every intended default (P122, SI, VLF, "0.1 Hz", "Medium voltage", "Contractor", "QA/QC file") renders blank and persists nothing unless typed.

**Fix:** in `TextField`, `NumberField`, `DropdownField` (and `DateField` if any date default is used), initialise the input from `field.default_value` when no response exists yet, and persist that value on first autosave so it lands in the DB (satisfying "all applicable items in the database"). Read-only views show the default too.

**Tests:** a field with `default_value` shows it, and a saved instance has the default in `responses` even if untouched.

---

## Part B — "Medium Voltage" grouping

- Migration: add nullable `category TEXT` (+ index) to `inspections.templates`.
- Templates library page (`apps/web/src/app/(admin)/inspections/templates/page.tsx`): group rows by `category` heading, then by family as today. Uncategorised rows render under a "General" heading (no behaviour change for existing templates).
- Set `category = 'medium_voltage'` (display "Medium Voltage") on the five new templates.

---

## Part C — The five templates (`schema_json`)

**Authoring conventions applied to all (from the audit):**
- Every `repeating_group` has an explicit wrapper field with `item_label_template` and `min_count`.
- Source engineering guidance becomes `help_text`/`header` (not placeholders — no widget renders placeholder): phasing `expectedPattern`, protection `notes` + setting-field meanings, megger test-param notes + conditions prompt, cable acceptance note + `standardsReferences`, Annex B `ipNote`, and **Annex B's binding `declares` statement shown as a header above the signatures**.
- No duplicate identity fields: drop standalone sign-off `name`/`role` text fields — the `signature` widget already captures signatory name/title/registration.
- Controlled vocabularies are dropdowns: protection curve `[SI,VI,EI,DT]`, cable `test_method [VLF, DC HV]`, Annex B `phase_rotation [R,W,B; R,B,W]`. Keep `ctr` ("400/1") and `cable_size` ("185mm") as text.
- Defaults via `default_value` (now wired): relay `P122`, curve `SI`, `test_method VLF`, megger cable `frequency 0.1 Hz`, phasing `unit_no "Medium voltage"`.

### 1. `mv-phasing-test-record` (deliverable_type `inspection_only`)
- **Details** section: text — `res_charge_no`, `area`, `unit_no` (default "Medium voltage"), `contractor`, `project_title`.
- **Phasing tests** section: `repeating_group` **`equipment_item`** (`min_count:1`, `item_label_template:'{{equipment_description}}'`) with sub-fields: `equipment_description` (text); the 9 phase-pair readings as `number` unit kV — `red_red, red_blue, red_white, white_white, white_blue, white_red, blue_blue, blue_red, blue_white`; `tested_by` (text); `date` (date). Section `help_text` = the `expectedPattern` (like→like ≈ 0 kV; cross-phase ≈ line voltage).
- **Sign-off** section: `signature` (contractor); `copies_to` (text). (No name/role text fields.)

### 2. `mv-megger-insulation-test` (deliverable_type `inspection_only`)
- **Details** section: text fields + `conditions_note` (textarea, help_text = the conditions prompt).
- **MV Busbar** section (fixed rows): `test_voltage` (number kV), `duration` (number min), `busbar_reading_unit` (dropdown `[GΩ, MΩ]`), then 6 `number` readings — `red_white, red_blue, white_blue, red_earth, white_earth, blue_earth`; `tested_by` (text), `date` (date). help_text = test-param note.
- **MV Cable** section: `repeating_group` **`cable`** (`min_count:0`, `item_label_template:'{{cable_id}}'`) with `cable_id` (text), `voltage` (number kV), `duration` (number min), `frequency` (text default "0.1 Hz"), `cable_reading_unit` (dropdown `[GΩ, MΩ]`), 4 `number` readings — `red_white, red_blue, white_blue, rwb_earth`; `tested_by`, `date`.
- **Sign-off**: `signature`.

### 3. `mv-cable-test-certificate` (deliverable_type `inspection_only`)
- **Contractor** section: text — `contractor_name, vat_no, contractor_no, address, email, cell`.
- **Test details** section: `date` (date), `order_no` (text), `res_charge_no` (text), `cable_between` (text), `test_method` (dropdown `[VLF, DC HV]`, default VLF), `instrument_used` (text, help_text example "HVA30 VLF"), `serial_no` (text), `calibration_expires` (date), `location_of_test` (text), `cable_type_insulation` (text, help_text example "XLPE 50mm² Al"), `insulation_resistance_ohms` (number, unit Ω), `rated_voltage` (text, e.g. "22 kV rms, 0.1 Hz"), `duration_min` (number, unit min).
- **Results** section: `pass_fail` — `test_phase_to_earth`, `test_phase_to_phase`, `test_completed_successfully`. Section help_text = `standardsReferences` + acceptance note (% of SANS value).
- **Sign-off**: `signature`.

### 4. `mv-protection-settings-summary` (deliverable_type `inspection_only`, record sheet)
- **Network** section: `voltage_kv` (number kV), `fault_level_ka` (number kA), `default_relay` (text default P122), `default_curve` (dropdown `[SI,VI,EI,DT]`, default SI). help_text = the engineering `notes` (high-set blank where not applied; pick-ups are primary amps; verify Panel-5).
- **Relay settings** section: `repeating_group` **`relay_feeder`** (`min_count:1`, `item_label_template:'Panel {{panel}} — {{feeder}}'`) with `panel` (text), `feeder` (text), `relay` (text default P122), `cable_size` (text), `ctr` (text), then the three stages as scalar sub-fields: `oc_lowset_curve` (dropdown `[SI,VI,EI,DT]`), `oc_lowset_pu` (number, unit A), `oc_lowset_tm` (number); `oc_highset_curve/oc_highset_pu/oc_highset_tm`; `ef_curve/ef_pu/ef_tm`. help_text on each carries the setting-field meaning (curve / pick-up primary amps / time multiplier).

### 5. `mv-safety-report-annex-b` (deliverable_type `coc`)
- **Declaration** section: a `header` field showing the `declares` statement ("Design approved per SANS 10142-2 and installation safe for operation as intended."); `registered_person_signature` (signature — captures name/title/ECSA reg), `ecsa_reg_no` (text), `physical_address` (text), `telephone` (text), `cellular` (text); `contractor_signature` (signature), `contractor_name`, `business_registration`, `eir_registration_no`, `telephone_c`, `cellular_c` (text). help_text = `ipNote` ("issue on the official SANS Annex B blank; data capture only").
- **Installation details** section: `installation_name`, `gps_coordinates`, `municipality`, `supply_authority` (text); `voltage_kv` (number kV), `fault_level_ka` (number kA); `sld_description` (textarea).
- **Inspection checklist** section: `repeating_group` **`checklist_item`** (`min_count:0`, `item_label_template:'{{clause_ref}}'`) with `clause_ref` (text), `result` (pass_fail, **N/A enabled**), `comment` (text). No SANS wording.
- **Test results** section: `earth_resistance_ohm` (number Ω) + `earth_instrument` (text); `insulation_resistance` (number) + `insulation_instrument` (text); `continuity` (pass_fail); `phase_rotation` (dropdown `[R,W,B; R,B,W]`).
- **Acceptance** section: `accepted_by_signature` (signature); `acceptance_date` (date).

---

## Part D — Delivery

- Canonical template definitions kept **in-repo** (one JSON/TS file each, under `apps/web/src/lib/inspections/mv-templates/` or similar), with a **Vitest test validating each against `templateSchema`** so they can never drift out of loadability.
- **Seed migration** inserts the five into `inspections.templates` for the WM org with `category='medium_voltage'`, idempotent (`ON CONFLICT DO NOTHING` on the partial unique index). Auto-deploys via the existing deploy-migrations workflow (consistent with how the WM org's enterprise subscription was seeded in 00133). To avoid SQL/JSON drift, a test asserts the migration's embedded `schema_json` parses and validates against `templateSchema`.

## Part E — Verification

- Unit: all five validate against `templateSchema`; platform-fix tests (A1 signature keying, A2 N/A, A3 default_value).
- Live (local stack): the five appear under a "Medium Voltage" heading in the Templates library; each opens in the builder and renders fully in the fill UI; a phasing instance and an Annex B instance are filled and saved; DB shows all responses, **three distinct Annex B signatures**, an N/A checklist answer, and seeded defaults; the engine evaluates a required signature correctly.

## Out of scope

- Auto-validation thresholds (`pass_when`) — v1 is capture-only.
- A `matrix`/grid field type — repeating blocks instead.
- Reproducing SANS Annex B checklist wording — clause-ref only (IP).
- Promoting templates to system scope — WM-org-scoped for now.

## Risks

- Part A changes touch shared, certification-bearing code; mitigated by additive-only schema changes (nullable columns), full unit tests, and a regression check that the existing 12 WM templates still validate/render.
- The signature migration must remain backward-compatible with existing role-keyed rows.
