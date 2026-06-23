# Project Settings — top-down improvement proposal (all 15 tabs)

**Date:** 2026-06-21
**Status:** Proposal — pending approval; build in phases after sign-off
**Branch:** `feat/settings-tabs-improvements` (off `main`)
**Scope:** Audit + proposed field additions / fixes for every project-settings tab, plus a phased build roadmap. No code changed yet.

Tabs are listed top-down in the nav order (`SettingsTabs.tsx`). Each entry: current fields → proposed change. New DB columns target `projects.projects` unless noted as `project_settings`.

---

## 1. General  *(refine — approved scope: Project type only)*
- **Current:** name, description, code, status (planning/active/on_hold/completed/cancelled), branding (logos, accent).
- **Add:** `project_type` — select, nullable, CHECK enum: `commercial, residential, retail, industrial, civil, mixed_use, healthcare, education, electrical_mv, other`.
- **Deferred (noted, not now):** external/client reference; tags (`text[]`, needs a project-list filter to be worth it).

## 2. Site  *(expand)*
- **Current:** street address (textarea), city, province (9 SA provinces).
- **Add:** `suburb` (text) · `postal_code` (text) · `country` (text, default `ZA`) · `gps_lat` + `gps_lng` (numeric, optional, with a small map-pin helper) · `erf_number` (text — erf/stand) · `gross_site_area_m2` (numeric).
- **Why:** construction projects need a precise, geocodable location + erf + extent; today it's three loose fields.

## 3. Dates  *(expand + consolidate)*
- **Current:** start_date, end_date (real date pickers).
- **Add:** `commencement_date` (possession) · `site_handover_date` · `defects_liability_months` (int) · `final_completion_date` · `milestones` (repeatable: name + date — new `project_milestones` table).
- **Consolidate:** move Contract's `contract_signed_date` + `practical_completion_date` display here as one project timeline (single source; Contract keeps the legal/value fields).

## 4. Client  *(expand — restructure)*
- **Current:** client_name, client_contact (one free-text textarea).
- **Replace with structured:** `client_legal_name` · `client_reg_no` · `client_vat_no` · `client_primary_contact_name` · `client_primary_email` · `client_primary_phone` · `client_billing_address` (textarea).
- **Migration note:** keep `client_contact` readable during transition (backfill into the new fields where parseable; don't drop until verified).

## 5. Contract  *(refine + integrity fix)*
- **Current:** contract_type, contract_value, currency, retention_pct, contract_signed_date, practical_completion_date.
- **Add (project_settings):** `payment_terms_days` (int) · `ld_penalty_per_day` (numeric) · `performance_guarantee_pct` (numeric) · `advance_payment_pct` (numeric) · `retention_release_pc_pct` + `retention_release_final_pct` (split) · `vat_rate_pct` (numeric, replaces hard-coded VAT).
- **Fix 1 (integrity):** the tab does two parallel non-transactional writes (`projects` + `project_settings`). Wrap in **one server action** that writes both (or fails both) — today a partial failure splits the figures.
- **Fix 2 (UX):** `contract_signed_date` / `practical_completion_date` are free-text `YYYY-MM-DD` regex inputs; switch to the same date picker the Dates tab uses.

## 6. Rates  *(mature — polish)*
- BOQ import + line rates; feature-complete. Light: a BOQ revision label/notes field on import; surface "last imported by/when".

## 7. Valuations  *(mature — polish)*
- Progress valuations + certify; feature-complete. Light: optional `valuation_due_date` per valuation + a reminder surface.

## 8. Variations  *(mature — polish)*
- Variation orders; feature-complete. Light: VO auto-numbering scheme (e.g. `VO-001`) instead of free codes.

## 9. Members  *(refine)*
- **Current:** member list + project role (PM/contractor/inspector/supplier/client-viewer), add/remove, bulk + sub-org add.
- **Add:** invite-by-email directly from this tab (today you add existing org members only) · optional per-member note/scope.

## 10. JBCC parties  *(refine; candidate to unify — see cross-cutting)*
- **Current:** party role, name, company, email, phone, address.
- **Add:** `appointment_date` · `registration_no` (professional/entity reg, e.g. principal-agent reg).

## 11. Operational  *(refine)*
- **Current:** working days, holiday calendar (country code), builders-holiday, extra holidays, RFI defaults (priority/assignee/due-days), units, date format.
- **Add (project_settings):** `working_hours_start` + `working_hours_end` (time) · `shift_pattern` (select: single/double/continuous) · `site_safety_contact` (text or link to a contact).

## 12. Contacts  *(refine; candidate to unify — see cross-cutting)*
- **Current:** name, role, company, email, phone (per-row add/edit/delete).
- **Add:** `category` (select: client, consultant, contractor, supplier, authority, other) · `is_primary` flag.

## 13. Integrations  *(stub — build out)*
- **Current:** two email toggles (RFI, inspection).
- **Build:** a per-event **notification matrix** (event × role/recipient) · outbound `webhooks` · calendar (ICS) feed · accounting export (Sage/Xero) · Slack/Teams. Start with the notification matrix (highest value, no third-party deps).

## 14. Danger  *(stub — build)*
- **Current:** Archive (disabled stub), Transfer ownership (disabled stub), Delete (real).
- **Build:** make **Archive** real (soft-archive `projects.archived_at`, hide from active lists, restorable) and **Transfer ownership** real (reassign org owner / project lead with confirm).

## 15. History  *(mature — polish)*
- Audit log + restore; feature-complete. Light: filter by field/user + CSV export.

---

## Cross-cutting fixes (apply across tabs)
1. **Contract save is non-transactional** — single action writing `projects` + `project_settings` atomically. *(integrity)*
2. **People live in four places** (Members, Contacts, JBCC parties, Client contact). Contacts & JBCC parties are near-identical — unify behind one "contacts" model with a `category` (JBCC becomes a category/filter). *(de-dupe)*
3. **Dates fragmented** across Dates + Contract — one project timeline (see tab 3/5).
4. **Inconsistent date inputs** — standardise every date on the real picker.
5. **Site has no geolocation** — structured lat/lng + erf + extent (tab 2).

## Phased build roadmap (the process)
Each phase = brainstorm → spec → TDD → PR → deploy (the established loop). One PR per phase (per tab where a migration is involved).

- **Phase A — Quick wins (low risk):** General `project_type`; Contract transactional-save fix + date pickers. *(no/▽small schema)*
- **Phase B — Field expansion (schema migrations, per tab):** Site → Client (restructure + backfill) → Dates (consolidate + new fields) → Contract terms → Operational → Members → JBCC → Contacts.
- **Phase C — IA rationalisation:** unify Contacts + JBCC behind `category`; consolidate the split dates.
- **Phase D — Build the stubs:** Integrations notification matrix; Danger archive + transfer.
- **Phase E — Polish:** Rates / Valuations / Variations / History light touches.

## Open questions for sign-off
- Approve the field set per tab, or trim any (esp. Client restructure + Dates consolidation, which are the biggest changes)?
- Phase B ordering — keep Site-first, or front-load Client/Contract (higher business value)?
- Contacts ⇄ JBCC unify now (Phase C) or leave as two tabs?
