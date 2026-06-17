# Medium Voltage Inspection Templates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five Medium Voltage inspection templates to e-site, grouped under a "Medium Voltage" category, with three shared-platform fixes (field-keyed signatures, a Pass/Fail N/A control, default-value wiring) so every form is fully fillable and every applicable item persists.

**Architecture:** Three additive platform fixes to the shared inspections module (each tested, none regressing the existing templates), a `category` column for library grouping, five `schema_json` template definitions authored in-repo and validated against the Zod `templateSchema`, and an idempotent seed migration that loads them for the WM-Consulting org (auto-deploys via the deploy-migrations workflow).

**Tech Stack:** Next.js App Router, Supabase (Postgres migrations + RLS), Zod (`templateSchema`), React 18, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-16-mv-inspection-templates-design.md` (read its Part C for the per-template field lists — this plan references them).

**Repo facts:**
- Worktree: `/Users/spud/dev/e-site-mv-templates`, branch `feat/mv-inspection-templates` (deps installed).
- Migrations: `apps/edge-functions/supabase/migrations/`; **next free number = `00136`** (last is `00135_project_variations.sql`).
- Local stack (for verification): `cd apps/edge-functions && supabase start` (db 127.0.0.1:54322, postgres/postgres). Web: `cd apps/web && pnpm dev`.
- Tests: `packages/shared` and `apps/web` both run `vitest run` (auto-discovers `*.test.ts`). Typecheck: `cd apps/web && npx tsc --noEmit -p tsconfig.json`.
- WM-Consulting org id = `dddddddd-0000-0000-0000-000000000001` (magic string; used inline in the import script and migrations).

## File map

| File | Change |
|---|---|
| `apps/edge-functions/supabase/migrations/00136_inspections_signature_field_keying.sql` | NEW — add `section_id`,`field_id` to `inspections.signatures` |
| `apps/edge-functions/supabase/migrations/00137_inspections_template_category.sql` | NEW — add `category` to `inspections.templates` |
| `apps/edge-functions/supabase/migrations/00138_mv_inspection_templates_seed.sql` | NEW — seed 5 templates for WM org |
| `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/SignatureModal.tsx` | accept + POST `fieldId`,`sectionId` |
| `…/inspections/[inspectionId]/fields/SignatureField.tsx` | pass `field.field_id`,`sectionId` to modal |
| `apps/web/src/app/api/inspections/upload-signature/route.ts` | read + insert `section_id`,`field_id` |
| `…/inspections/[inspectionId]/fields/PassFailField.tsx` | add N/A button |
| `packages/shared/src/inspections/engine.ts` | `pass_fail` na handling + answered counter |
| `…/fields/TextField.tsx`,`NumberField.tsx`,`DropdownField.tsx`,`DateField.tsx` | default_value display fallback |
| `…/inspections/[inspectionId]/CaptureForm.tsx` | seed default_value responses on mount |
| `apps/web/src/actions/inspections-template.actions.ts` | select `category` in `listTemplatesAction` |
| `apps/web/src/app/(admin)/inspections/templates/page.tsx` | group by category heading |
| `packages/shared/src/inspections/mv-templates/*.json` (5) + `index.ts` | NEW — template definitions |
| `packages/shared/src/inspections/mv-templates/mv-templates.test.ts` | NEW — Zod + drift validation |

---

## Task 1: Migration — field-key the signatures table (A1 DB)

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00136_inspections_signature_field_keying.sql`

Current table (00066) has only `(inspection_id, role, …)` — no `section_id`/`field_id`. The engine already filters signatures by `field_id`+`section_id` (`engine.ts:314-317`), so persisting them makes required/per-field signatures work.

- [ ] **Step 1: Write the migration**

```sql
-- 00136_inspections_signature_field_keying.sql
-- Bind a captured signature to the specific signature FIELD that requested it.
-- Additive + nullable: existing role-keyed rows are untouched; the engine
-- (engine.ts) already filters signatures by (section_id, field_id), so this
-- closes the gap that made multi-signature forms collapse to one row and
-- required signatures permanently unsatisfiable.
ALTER TABLE inspections.signatures
  ADD COLUMN IF NOT EXISTS section_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS field_id   TEXT NULL;

-- One signature per (inspection, section, field) when field-keyed; legacy
-- role-keyed rows (field_id NULL) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS signatures_inspection_section_field_idx
  ON inspections.signatures (inspection_id, section_id, field_id)
  WHERE field_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply to the local stack and verify the columns exist**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -f apps/edge-functions/supabase/migrations/00136_inspections_signature_field_keying.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c \
  "select column_name from information_schema.columns where table_schema='inspections' and table_name='signatures' and column_name in ('section_id','field_id') order by 1;"
```
Expected: two rows — `field_id`, `section_id`.

- [ ] **Step 3: Commit**

```bash
cd /Users/spud/dev/e-site-mv-templates
git add apps/edge-functions/supabase/migrations/00136_inspections_signature_field_keying.sql
git commit -m "feat(inspections): field-key signatures (section_id, field_id)"
```

---

## Task 2: Thread field/section through the signature capture chain (A1 app)

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/SignatureModal.tsx`
- Modify: `…/inspections/[inspectionId]/fields/SignatureField.tsx`
- Modify: `apps/web/src/app/api/inspections/upload-signature/route.ts`

- [ ] **Step 1: SignatureModal — accept and POST fieldId/sectionId**

In `SignatureModal.tsx` props interface add (after `role`):
```tsx
  fieldId?: string
  sectionId?: string
```
In the FormData block (currently lines ~48-58), after `fd.append('role', role)` add:
```tsx
if (fieldId) fd.append('fieldId', fieldId)
if (sectionId) fd.append('sectionId', sectionId)
```

- [ ] **Step 2: SignatureField — pass field + section**

`SignatureField.tsx` destructures `RendererProps`; include `sectionId` and pass ids to the modal. Replace the `<SignatureModal … />` usage:
```tsx
export default function SignatureField({ field, sectionId, inspectionId, readOnly }: RendererProps) {
  // …existing state…
      {open && (
        <SignatureModal
          inspectionId={inspectionId}
          role="inspector"
          fieldId={field.field_id}
          sectionId={sectionId}
          onClose={() => setOpen(false)}
        />
      )}
```
(If `RendererProps` does not already include `sectionId`, add `sectionId: string` to it — check the props type used by `FieldRenderer`; it passes `sectionId` to photo capture already.)

- [ ] **Step 3: upload-signature route — read + insert the ids**

In `apps/web/src/app/api/inspections/upload-signature/route.ts`, where it reads FormData, add:
```ts
const fieldId = (form.get('fieldId') as string | null) || null
const sectionId = (form.get('sectionId') as string | null) || null
```
In the INSERT body (currently ~lines 65-83) add the two columns alongside `inspection_id`:
```ts
  inspection_id: inspectionId,
  section_id: sectionId,
  field_id: fieldId,
  role,
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/spud/dev/e-site-mv-templates/apps/web && npx tsc --noEmit -p tsconfig.json
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/spud/dev/e-site-mv-templates
git add "apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/SignatureModal.tsx" "apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/fields/SignatureField.tsx" apps/web/src/app/api/inspections/upload-signature/route.ts
git commit -m "feat(inspections): thread field_id/section_id through signature capture"
```

---

## Task 3: Engine — required/per-field signatures + N/A handling (A1 + A2 logic)

**Files:**
- Modify: `packages/shared/src/inspections/engine.ts`
- Test: `packages/shared/src/inspections/engine.test.ts`

The engine already filters signatures by `field_id`+`section_id` (`engine.ts:279-281, 314-317`). A2 needs `evaluateField`'s `pass_fail` branch to recognise N/A.

- [ ] **Step 1: Write failing tests** (append to `engine.test.ts`, matching its existing `describe`/`it` style)

```ts
describe('pass_fail N/A', () => {
  it('counts pass_state na as answered and not failing', () => {
    const field = { field_id: 'c1', label: 'Clause', type: 'pass_fail', required: true } as const
    const r = evaluateField(field as never, { value_bool: null, pass_state: 'na' } as never)
    expect(r.passState).toBe('na')
  })
})

describe('field-keyed signatures', () => {
  it('a required signature is satisfied only by a matching field+section signature', () => {
    // build a minimal template with one required signature field in section s1,
    // evaluate with attachments.signatures=[{section_id:'s1',field_id:'sig'}] → no missingRequired;
    // evaluate with a non-matching signature → missingRequired includes the field.
    // (Use the same evaluateInspection entry the other tests use.)
  })
})
```
Flesh out the signature test using the file's existing `evaluateInspection` fixtures (copy a passing fixture, add a `required: true` signature field, assert `missingRequired` membership toggles with the attachment's `field_id`).

- [ ] **Step 2: Run — fail**

```bash
cd /Users/spud/dev/e-site-mv-templates && npx vitest run packages/shared/src/inspections/engine.test.ts -t "N/A"
```
Expected: FAIL (`passState` is `not_checked`, not `na`).

- [ ] **Step 3: Implement** — in `engine.ts` `evaluateField` `pass_fail` case (currently lines 7-10), recognise an explicit na before the bool checks:

```ts
    case 'pass_fail':
      if (value.pass_state === 'na') return { passState: 'na' };
      if (value.value_bool === true) return { passState: 'pass' };
      if (value.value_bool === false) return { passState: 'fail', reason: value.fail_reason ?? undefined };
      return { passState: 'not_checked' };
```
Then ensure the "answered" predicate (the counter around `engine.ts:338-350` that keys off `value_bool` non-null) also treats `pass_state === 'na'` as answered. Locate that predicate and add `|| r.pass_state === 'na'` to the has-answer condition for `pass_fail` fields.

- [ ] **Step 4: Run — pass**

```bash
cd /Users/spud/dev/e-site-mv-templates && npx vitest run packages/shared/src/inspections/engine.test.ts
```
Expected: all pass (existing + new).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/inspections/engine.ts packages/shared/src/inspections/engine.test.ts
git commit -m "feat(inspections): engine recognises pass_fail N/A; field-keyed signature satisfaction tested"
```

---

## Task 4: PassFailField — N/A button (A2 UI)

**Files:**
- Modify: `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/fields/PassFailField.tsx`

- [ ] **Step 1: Add the N/A control.** The component reads `response?.value_bool` and renders Pass/Fail buttons writing `{value_bool, pass_state, fail_reason}`. Track an N/A state via `pass_state`:
- Compute `const isNa = response?.pass_state === 'na'`.
- Add a third button after Fail:
```tsx
<button
  type="button"
  disabled={readOnly}
  onClick={() => onChange({ value_bool: null, pass_state: 'na', fail_reason: null })}
  style={{ /* match existing button style; active when isNa */ }}
>
  N/A
</button>
```
- Update the active-styling branches so Pass is active when `v === true && !isNa`, Fail when `v === false`, N/A when `isNa`. Hide the fail-reason input when `isNa`.

- [ ] **Step 2: Typecheck**

```bash
cd /Users/spud/dev/e-site-mv-templates/apps/web && npx tsc --noEmit -p tsconfig.json
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/fields/PassFailField.tsx"
git commit -m "feat(inspections): N/A option on Pass/Fail fields"
```

---

## Task 5: Wire default_value into the fill UI (A3)

**Files:**
- Modify: `…/fields/TextField.tsx`, `NumberField.tsx`, `DropdownField.tsx`, `DateField.tsx`
- Modify: `…/inspections/[inspectionId]/CaptureForm.tsx`

- [ ] **Step 1: Display fallback** — in each widget, fall back to `field.default_value` when there is no response yet:
- `TextField.tsx:31` and `:38`: `value={response?.value_text ?? (field.default_value != null ? String(field.default_value) : '')}`
- `NumberField.tsx:50`: `value={response?.value_number ?? (typeof field.default_value === 'number' ? field.default_value : '')}`
- `DropdownField.tsx:29` (single): `response?.value_text ?? (field.default_value != null ? String(field.default_value) : '')`
- `DateField.tsx:28`: `value={response?.value_text ?? (field.default_value != null ? String(field.default_value) : '')}`

- [ ] **Step 2: Persist defaults on mount** — in `CaptureForm.tsx`, add a `useEffect` (runs once) that, for every field with a `default_value` and no existing response, calls `updateResponse(section_id, field_id, …)` with the typed value so the default is autosaved into `inspections.responses`. Walk `template.sections[].fields[]` and `subsections[].fields[]`; map `default_value` to `value_text`/`value_number`/`value_bool` by `typeof`. Guard so it only seeds fields absent from `responses`.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/spud/dev/e-site-mv-templates/apps/web && npx tsc --noEmit -p tsconfig.json
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/"
git commit -m "feat(inspections): default_value shown in fill UI and seeded to responses"
```

---

## Task 6: Category column + library grouping (Part B)

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00137_inspections_template_category.sql`
- Modify: `apps/web/src/actions/inspections-template.actions.ts` (`listTemplatesAction` select + `TemplateRow`)
- Modify: `apps/web/src/app/(admin)/inspections/templates/page.tsx`

- [ ] **Step 1: Migration**

```sql
-- 00137_inspections_template_category.sql
-- Optional discipline grouping for the templates library (e.g. 'medium_voltage').
ALTER TABLE inspections.templates ADD COLUMN IF NOT EXISTS category TEXT NULL;
CREATE INDEX IF NOT EXISTS templates_category_idx ON inspections.templates (category);
NOTIFY pgrst, 'reload schema';
```
Apply:
```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f apps/edge-functions/supabase/migrations/00137_inspections_template_category.sql
```

- [ ] **Step 2: Select category** — in `listTemplatesAction` (`inspections-template.actions.ts:54-56`) add `category` to the `.select(...)` column list, and add `category: string | null` to the `TemplateRow` type used by the page.

- [ ] **Step 3: Group by category** — in `templates/page.tsx`, wrap the existing template_id grouping in an outer group-by-`category`. Render a category heading (display name from a small map: `medium_voltage → 'Medium Voltage'`, fallback humanised; `null → 'General'`), then the existing per-family `<Card>` loop inside each category. Order categories with named ones first, "General" last.

- [ ] **Step 4: Typecheck + commit**

```bash
cd /Users/spud/dev/e-site-mv-templates/apps/web && npx tsc --noEmit -p tsconfig.json
cd /Users/spud/dev/e-site-mv-templates
git add apps/edge-functions/supabase/migrations/00137_inspections_template_category.sql apps/web/src/actions/inspections-template.actions.ts "apps/web/src/app/(admin)/inspections/templates/page.tsx"
git commit -m "feat(inspections): category column + Medium Voltage library grouping"
```

---

## Task 7: Author the five template definitions + validation test (Part C)

**Files:**
- Create: `packages/shared/src/inspections/mv-templates/mv-phasing-test-record.json`
- Create: `…/mv-megger-insulation-test.json`
- Create: `…/mv-cable-test-certificate.json`
- Create: `…/mv-protection-settings-summary.json`
- Create: `…/mv-safety-report-annex-b.json`
- Create: `…/index.ts` (exports `MV_TEMPLATES: Template[]`)
- Test: `…/mv-templates.test.ts`

Author each JSON as a full `schema_json` document per the **spec Part C field lists**, obeying the Zod `templateSchema` (`packages/shared/src/inspections/template-schema.ts`): kebab `template_id`, semver `version` "1.0", `applies_to_node_types`, `node_subtypes` (`['mv_switchgear']` etc.), `deliverable_type`, `sections[].fields[]`; every `repeating_group` has non-empty scalar `fields[]` + `item_label_template` + `min_count`; dropdowns carry `options`; defaults via `default_value`; guidance via `help_text`/`header`.

Worked example — `mv-cable-test-certificate.json` (author the other four the same way from their spec field lists):
```json
{
  "template_id": "mv-cable-test-certificate",
  "name": "MV Cable Test Certificate (VLF)",
  "version": "1.0",
  "applies_to_node_types": ["source", "any"],
  "node_subtypes": ["mv_switchgear"],
  "sans_reference": "SANS 1507 / SANS 97 / SANS 0198",
  "deliverable_type": "inspection_only",
  "sections": [
    { "section_id": "contractor", "title": "Contractor", "fields": [
      { "field_id": "contractor_name", "label": "Contractor name", "type": "text" },
      { "field_id": "vat_no", "label": "VAT No", "type": "text" },
      { "field_id": "contractor_no", "label": "Contractor No", "type": "text" },
      { "field_id": "address", "label": "Address", "type": "textarea" },
      { "field_id": "email", "label": "Email", "type": "text" },
      { "field_id": "cell", "label": "Cell", "type": "text" }
    ]},
    { "section_id": "test_details", "title": "Test details", "fields": [
      { "field_id": "test_date", "label": "Date", "type": "date" },
      { "field_id": "order_no", "label": "Order No", "type": "text" },
      { "field_id": "res_charge_no", "label": "R.E.S / Charge No", "type": "text" },
      { "field_id": "cable_between", "label": "Cable between (A) and (B)", "type": "text" },
      { "field_id": "test_method", "label": "Test method", "type": "dropdown", "options": ["VLF","DC HV"], "default_value": "VLF" },
      { "field_id": "instrument_used", "label": "Instrument used", "type": "text", "help_text": "e.g. HVA30 VLF & DC HV Test System" },
      { "field_id": "serial_no", "label": "Instrument serial No", "type": "text" },
      { "field_id": "calibration_expires", "label": "Calibration expires", "type": "date" },
      { "field_id": "location_of_test", "label": "Location of test", "type": "text" },
      { "field_id": "cable_type_insulation", "label": "Cable type & insulation", "type": "text", "help_text": "e.g. XLPE 50mm² Al" },
      { "field_id": "insulation_resistance_ohms", "label": "Insulation resistance", "type": "number", "unit": "Ω" },
      { "field_id": "rated_voltage", "label": "Rated test voltage", "type": "text", "help_text": "e.g. 22 kV rms, 0.1 Hz" },
      { "field_id": "duration_min", "label": "Duration", "type": "number", "unit": "min" }
    ]},
    { "section_id": "results", "title": "Results", "fields": [
      { "field_id": "test_phase_to_earth", "label": "Test phase ↔ earth", "type": "pass_fail" },
      { "field_id": "test_phase_to_phase", "label": "Test phase ↔ phase", "type": "pass_fail" },
      { "field_id": "test_completed_successfully", "label": "Test completed successfully", "type": "pass_fail", "help_text": "Acceptance is typically a % of the relevant SANS test value — confirm against the current edition of SANS 1507 / 97 / 0198." }
    ]},
    { "section_id": "sign_off", "title": "Sign-off", "fields": [
      { "field_id": "signature", "label": "Signature", "type": "signature" }
    ]}
  ]
}
```

`index.ts`:
```ts
import phasing from './mv-phasing-test-record.json'
import megger from './mv-megger-insulation-test.json'
import cable from './mv-cable-test-certificate.json'
import protection from './mv-protection-settings-summary.json'
import annexB from './mv-safety-report-annex-b.json'
import type { Template } from '../types'
export const MV_TEMPLATES = [phasing, megger, cable, protection, annexB] as unknown as Template[]
```
(Requires `resolveJsonModule` — already enabled in the package per its existing JSON loaders.)

- [ ] **Step 1: Author the five JSON files + index.ts** per the spec field lists and the worked example.

- [ ] **Step 2: Write the validation test** (`mv-templates.test.ts`, matching `template-schema.test.ts` style):

```ts
import { describe, it, expect } from 'vitest'
import { templateSchema } from '../template-schema'
import { MV_TEMPLATES } from './index'

describe('MV templates validate against templateSchema', () => {
  for (const t of MV_TEMPLATES) {
    it(`${t.template_id} is a valid template`, () => {
      expect(() => templateSchema.parse(t)).not.toThrow()
    })
  }
  it('there are exactly five MV templates with unique ids', () => {
    const ids = MV_TEMPLATES.map((t) => t.template_id)
    expect(ids).toHaveLength(5)
    expect(new Set(ids).size).toBe(5)
  })
})
```

- [ ] **Step 3: Run — pass**

```bash
cd /Users/spud/dev/e-site-mv-templates && npx vitest run packages/shared/src/inspections/mv-templates/mv-templates.test.ts
```
Expected: 6 pass. Fix any template that fails `templateSchema.parse` until green.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/inspections/mv-templates/
git commit -m "feat(inspections): five MV template definitions + schema-validation test"
```

---

## Task 8: Seed migration for the five templates (Part D)

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00138_mv_inspection_templates_seed.sql`
- Test: extend `…/mv-templates/mv-templates.test.ts` with a drift check

- [ ] **Step 1: Generate the seed SQL from the in-repo JSON** — write the migration with one idempotent INSERT per template for the WM org, embedding the exact `schema_json` from the JSON files and setting `category='medium_voltage'`. Pattern per template:

```sql
-- 00138_mv_inspection_templates_seed.sql
-- Seed the 5 Medium Voltage inspection templates for Watson Mattheus Consulting.
-- Idempotent: ON CONFLICT on the org-scoped partial unique index.
INSERT INTO inspections.templates
  (organisation_id, template_id, version, name, applies_to_node_types, node_subtypes,
   sans_reference, deliverable_type, schema_json, category, is_active)
VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'mv-cable-test-certificate', '1.0',
   'MV Cable Test Certificate (VLF)', ARRAY['source','any'], ARRAY['mv_switchgear'],
   'SANS 1507 / SANS 97 / SANS 0198', 'inspection_only',
   $json${ ...exact schema_json from mv-cable-test-certificate.json... }$json$::jsonb,
   'medium_voltage', true)
ON CONFLICT (organisation_id, template_id, version) DO NOTHING;
-- …repeat the VALUES+ON CONFLICT block for the other four templates…
NOTIFY pgrst, 'reload schema';
```
Use the `$json$…$json$` dollar-quote so the embedded JSON needs no escaping. The `schema_json` for each MUST be byte-identical to its JSON file (the drift test enforces this).

- [ ] **Step 2: Drift test** — append to `mv-templates.test.ts`: read the migration file, extract each `$json$…$json$` block, `JSON.parse` it, assert it `templateSchema.parse`s AND deep-equals the corresponding `MV_TEMPLATES` entry. (Use `node:fs` to read `apps/edge-functions/supabase/migrations/00138_mv_inspection_templates_seed.sql` via a relative path from the test; assert all five present.)

- [ ] **Step 3: Apply locally + verify rows**

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f apps/edge-functions/supabase/migrations/00138_mv_inspection_templates_seed.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c \
  "select template_id, category from inspections.templates where category='medium_voltage' order by template_id;"
```
Expected: five rows, all `medium_voltage`. Re-run the migration once — expect no duplicates (idempotent).

- [ ] **Step 4: Run the test + commit**

```bash
cd /Users/spud/dev/e-site-mv-templates && npx vitest run packages/shared/src/inspections/mv-templates/mv-templates.test.ts
git add apps/edge-functions/supabase/migrations/00138_mv_inspection_templates_seed.sql packages/shared/src/inspections/mv-templates/mv-templates.test.ts
git commit -m "feat(inspections): seed 5 MV templates (WM org, Medium Voltage category) + drift test"
```

---

## Task 9: Full gates + live verification

- [ ] **Step 1: Gates**

```bash
cd /Users/spud/dev/e-site-mv-templates/apps/web && npx tsc --noEmit -p tsconfig.json && npx vitest run && npx next lint --file "src/app/(admin)/projects/[id]/inspections/[inspectionId]/fields/PassFailField.tsx"
cd /Users/spud/dev/e-site-mv-templates && npx vitest run packages/shared
```
Expected: all green.

- [ ] **Step 2: Live (local stack + dev server, real browser)** — log in (WM org bypasses the inspections gate):
1. `/inspections/templates` → the five appear under a **"Medium Voltage"** heading.
2. Open each → builder renders all sections/fields.
3. Create an inspection from `mv-phasing-test-record` on the smoke project → fill the repeating equipment block (defaults visible) → save → confirm `inspections.responses` rows persisted (incl. seeded defaults).
4. Create one from `mv-safety-report-annex-b` → sign all **three** signature fields → confirm `inspections.signatures` has **three rows with distinct `field_id`** → set a checklist item to **N/A** → confirm `responses.pass_state='na'` persisted.

- [ ] **Step 3: Commit any fixes found during verification, then proceed to PR.**

---

## Self-review (run before PR)
- Spec Part A1 → Tasks 1-3; A2 → Tasks 3-4; A3 → Task 5; Part B → Task 6; Part C → Task 7; Part D → Task 8; Part E → Task 9. All covered.
- No `frame-src`/preview overlap (separate feature).
- `pass_state='na'` carried consistently: PassFailField writes it (T4), engine reads it (T3).
- Signature ids: column names `section_id`/`field_id` consistent across migration (T1), route (T2), engine (existing).
