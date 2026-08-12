# Site Forms — Termination & Making Safe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-project Forms section where site electricians record termination and making-safe work per existing distribution board, and a reviewer distributes a branded PDF to all project members.

**Architecture:** New tables in the existing `field` schema targeting `structure.nodes`, reusing the inspections form engine unmodified. Lifecycle is `draft → submitted → distributed`, with `void` for corrections. PDF via `@react-pdf/renderer` through the existing `projects.reports` versioning pipeline; email via a new shared branded layout through the existing `notifyEntityEvent` → `send-email` → Resend chain.

**Tech Stack:** Next.js 15 (App Router, server actions), Supabase Postgres + RLS + Storage, `@react-pdf/renderer`, Zod, Vitest, pnpm + Turborepo.

**Spec:** `docs/superpowers/specs/2026-08-12-site-forms-termination-making-safe-design.md`
**Research:** `docs/superpowers/specs/2026-08-12-termination-making-safe-research.md`

---

## Verified facts (do not re-derive; do not assume beyond these)

| Fact | Evidence |
|---|---|
| Next free migration numbers: **00179**, **00180** | `ls` of migrations dir; head is `00178_snag_visit_completion.sql`; gaps at 00155–00158, 00174 are permanent |
| `field` schema has `ALTER DEFAULT PRIVILEGES` for **tables and sequences** → new tables inherit `anon=r`, `authenticated=arwd`, `service_role=all` | `pg_default_acl` query against prod, 2026-08-12 |
| `field` schema has **no** default ACL for **functions** → helper functions need explicit `GRANT EXECUTE` | same query; contrast `inspections` which has `f authenticated=X` |
| `field` schema USAGE already granted to `anon`, `authenticated`, `service_role` | `pg_namespace.nspacl` |
| No PostgREST config PATCH needed (schema already exposed); `NOTIFY pgrst, 'reload schema'` suffices | `00120_snag_site_visits.sql:5` |
| `notifications_type_check` currently holds exactly **17** values, re-declared wholesale each time | `00178_snag_visit_completion.sql` §2, read in full |
| `public.set_updated_at()` exists and is what every `field` table already uses (`snags`, `snag_visits`, `cables`, …) | `pg_proc` + `pg_trigger` query against prod, 2026-08-12 |
| `public.get_user_org_ids()` → `uuid[]`, so `= ANY (...)` is the correct call form | same query |
| `public.user_is_client_viewer(org_id uuid)` → `boolean` | same query |
| `public.user_has_project_access(_project_id uuid)` → `boolean` | same query |
| `public.user_effective_project_role(p_project_id, p_user_id DEFAULT auth.uid())` — safe to call with one argument | same query |
| **`projects.reports.kind` has no CHECK constraint** — only `status` and `version` are constrained. `kind='site_form'` needs no migration. | `pg_constraint` query against prod, 2026-08-12 |

The 17 existing notification types, which **must all be re-listed** in 00179:
`snag_status_changed`, `rfi_assigned`, `rfi_closed`, `rfi_response`, `grn_recorded`,
`inspection_assigned`, `inspection_awaiting_verification`, `inspection_certified`,
`inspection_re_inspect_required`, `inspection_revoked`, `inspection_abandoned`,
`qc_issued`, `rfi_created`, `snag_created`, `diary_created`, `qc_comment`, `snag_visit_completed`

> ⚠ **Before writing migration 00179**, re-run `ls apps/edge-functions/supabase/migrations | sort | tail -3`. A concurrent session is fixing SANS unit errors in `lv-coc.json` and may have claimed 00179. If so, shift to the next free pair.

---

## File structure

### New — shared package
| File | Responsibility |
|---|---|
| `packages/shared/src/site-forms/types.ts` | Form instance/response/signature types. Re-exports the engine types from `../inspections/types` — does not redefine them. |
| `packages/shared/src/site-forms/gates.ts` | Pure submit-gate evaluation. No I/O. |
| `packages/shared/src/site-forms/gates.test.ts` | One passing + one blocking case per gate. |
| `packages/shared/src/site-forms/templates/termination-and-making-safe.json` | The 14-section template. Source of truth. |
| `packages/shared/src/site-forms/template.test.ts` | Validates the JSON against the existing `templateSchema`. |
| `packages/shared/src/site-forms/index.ts` | Barrel. |
| `packages/shared/src/email/layout.ts` | **New shared branded email layout.** Accent + logo + footer. |
| `packages/shared/src/email/layout.test.ts` | Asserts branding applied, HTML escaped, no `data:` image sources. |
| `packages/shared/src/email/site-form-email.ts` | `renderSiteFormDistributedEmail(vars)`. |
| `packages/shared/src/email/site-form-email.test.ts` | Subject, disclaimer present, signed-URL assertion. |

### New — web
| File | Responsibility |
|---|---|
| `apps/web/src/actions/site-forms.actions.ts` | Lifecycle: list, create, upsert response, submit, void. |
| `apps/web/src/actions/site-forms-distribute.actions.ts` | Recipient preview, distribute, re-distribute. |
| `apps/web/src/lib/site-forms/upload.ts` | Orphan-safe photo + signature upload with compression. |
| `apps/web/src/lib/site-form-email.ts` | Recipient resolution + dispatch. Never throws. |
| `apps/web/src/lib/reports/site-form-report-data.ts` | All I/O for the PDF. Role gate before service-role fetch. |
| `apps/web/src/lib/reports/site-form-report.tsx` | Pure React-PDF tree. Fixed non-CoC footer. |
| `apps/web/src/lib/reports/render-site-form.ts` | Buffer bridge. |
| `apps/web/src/lib/reports/file-site-form-report.ts` | Version → upload → `projects.reports` insert → supersede. |
| `apps/web/src/app/(admin)/projects/[id]/forms/page.tsx` | List, filterable. Empty state carries the CTA. |
| `apps/web/src/app/(admin)/projects/[id]/forms/new/page.tsx` + `NewFormForm.tsx` | Template + board picker. |
| `apps/web/src/app/(admin)/projects/[id]/forms/[formId]/page.tsx` | Server shell. |
| `apps/web/src/app/(admin)/projects/[id]/forms/[formId]/CaptureForm.tsx` | Client capture, autosave, gate display. |
| `apps/web/src/app/(admin)/projects/[id]/forms/[formId]/SignaturePad.tsx` | Canvas signature capture. |
| `apps/web/src/app/(admin)/projects/[id]/forms/[formId]/DistributePanel.tsx` | Recipient preview + send. |
| `apps/web/src/app/api/projects/[id]/forms/[formId]/report/route.ts` | Inline PDF preview, no persistence. |

### Modified
| File | Change |
|---|---|
| `packages/shared/src/types/index.ts` | Add `FORMS_FIELD_ROLES`. |
| `packages/shared/src/index.ts` | Export `site-forms` + new email modules. |
| `packages/shared/src/schemas/project-settings.schema.ts` | `notifyFormEmail`. |
| `packages/shared/src/services/_project-settings-mappers.ts` | Row type, camel map, patch map — **three sites**. |
| `packages/shared/src/services/project-settings.service.ts` | `getNotificationConfig` returns `formEmail`. |
| `apps/web/src/components/layout/Sidebar.tsx` | `Forms` entry in `projectNav`. |
| `apps/web/src/app/(admin)/projects/[id]/settings/integrations/IntegrationsPanel.tsx` | Toggle. |
| `docs/rbac-matrix.md` | Page route, API route, actions table. |

---

## Phase 0 — Database foundations

### Task 1: Migration 00179 — schema, RLS, storage, settings

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00179_site_forms.sql`

- [ ] **Step 1: Confirm the migration number is still free**

Run: `ls apps/edge-functions/supabase/migrations | sort | tail -3`
Expected: head is `00178_snag_visit_completion.sql`. If `00179` exists, use `00181`/`00182` and note it in the PR body.

- [ ] **Step 2: Write the migration**

Key constraints this migration must satisfy, each of which has bitten this codebase before:
- Every `UPDATE` policy gets a matching `WITH CHECK` (retrofitted for inspections in 00067 to stop org/project hopping).
- Storage policies cover **read *and* write** (00073 shipped inspections read-only — a real bug).
- `notifications_type_check` re-lists all 17 existing values plus the new one.
- Helper functions get explicit `GRANT EXECUTE` (the `field` schema has no function default ACL).
- Trailing `NOTIFY pgrst, 'reload schema';`.

```sql
-- 00179_site_forms.sql
-- Site Forms module: per-board termination & making-safe records.
-- The `field` schema is already exposed to PostgREST and already carries
-- ALTER DEFAULT PRIVILEGES for TABLES and SEQUENCES (verified against prod
-- 2026-08-12), so new tables inherit anon=SELECT / authenticated=SELECT,
-- INSERT,UPDATE,DELETE / service_role=ALL automatically. It has NO default
-- ACL for FUNCTIONS, so the helpers below are granted explicitly.
-- No PostgREST config PATCH is required -- a trailing NOTIFY suffices.

BEGIN;

-- ─── 1. Templates ────────────────────────────────────────────────────────────
CREATE TABLE field.form_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID REFERENCES public.organisations(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  schema_json JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN field.form_templates.organisation_id IS
  'NULL = system template, available to every organisation.';

-- Partial unique indexes: a plain UNIQUE would not bite for system templates,
-- because NULL organisation_id never equals itself.
CREATE UNIQUE INDEX form_templates_org_key_version_idx
  ON field.form_templates (organisation_id, template_key, version)
  WHERE organisation_id IS NOT NULL;
CREATE UNIQUE INDEX form_templates_system_key_version_idx
  ON field.form_templates (template_key, version)
  WHERE organisation_id IS NULL;

-- schema_json is immutable; corrections ship as a new version row.
CREATE OR REPLACE FUNCTION field.enforce_form_template_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.schema_json IS DISTINCT FROM OLD.schema_json THEN
    RAISE EXCEPTION 'schema_json is immutable; insert a new row with a bumped version instead';
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_form_template_immutability
  BEFORE UPDATE ON field.form_templates
  FOR EACH ROW EXECUTE FUNCTION field.enforce_form_template_immutability();

-- ─── 2. Form instances ───────────────────────────────────────────────────────
CREATE TABLE field.site_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES public.organisations(id),
  project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  template_row_id UUID NOT NULL REFERENCES field.form_templates(id),
  form_no TEXT,
  -- ON DELETE SET NULL, never CASCADE: deleting a board must not delete the
  -- record of having made it safe. board_ref/board_label preserve identity.
  node_id UUID REFERENCES structure.nodes(id) ON DELETE SET NULL,
  board_ref TEXT,
  board_label TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','distributed','void')),
  as_left_status TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  submitted_by UUID REFERENCES public.profiles(id),
  submitted_at TIMESTAMPTZ,
  distributed_by UUID REFERENCES public.profiles(id),
  distributed_at TIMESTAMPTZ,
  report_id UUID REFERENCES projects.reports(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A form must identify its board one way or the other.
  CONSTRAINT site_forms_board_identified CHECK (
    node_id IS NOT NULL OR NULLIF(TRIM(board_ref), '') IS NOT NULL
  ),
  CONSTRAINT site_forms_submitted_consistent CHECK (
    submitted_by IS NULL OR submitted_at IS NOT NULL
  ),
  CONSTRAINT site_forms_distributed_consistent CHECK (
    distributed_by IS NULL OR distributed_at IS NOT NULL
  ),
  CONSTRAINT site_forms_void_reason_required CHECK (
    status <> 'void' OR NULLIF(TRIM(void_reason), '') IS NOT NULL
  )
);

CREATE INDEX site_forms_project_status_idx ON field.site_forms (project_id, status);
CREATE INDEX site_forms_node_idx ON field.site_forms (node_id) WHERE node_id IS NOT NULL;

-- ─── 3. Form numbering ───────────────────────────────────────────────────────
CREATE TABLE field.form_number_seqs (
  project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL,
  year INT NOT NULL,
  last_no INT NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, prefix, year)
);

CREATE OR REPLACE FUNCTION field.allocate_form_no(p_form_id UUID, p_prefix TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'field','projects','public' AS $fn$
DECLARE
  v_project UUID; v_code TEXT; v_year INT; v_next INT;
BEGIN
  SELECT sf.project_id INTO v_project FROM field.site_forms sf WHERE sf.id = p_form_id;
  IF v_project IS NULL THEN RAISE EXCEPTION 'Unknown form %', p_form_id; END IF;

  SELECT p.code INTO v_code FROM projects.projects p WHERE p.id = v_project;
  v_year := EXTRACT(YEAR FROM now())::INT;

  INSERT INTO field.form_number_seqs (project_id, prefix, year, last_no)
  VALUES (v_project, p_prefix, v_year, 1)
  ON CONFLICT (project_id, prefix, year)
  DO UPDATE SET last_no = field.form_number_seqs.last_no + 1
  RETURNING last_no INTO v_next;

  RETURN p_prefix || '-' || COALESCE(v_code, 'PROJ') || '-' || v_year::TEXT
         || '-' || LPAD(v_next::TEXT, 4, '0');
END $fn$;

-- ─── 4. Responses + append-only history ──────────────────────────────────────
CREATE TABLE field.form_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES field.site_forms(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  value_bool BOOLEAN,
  value_number NUMERIC,
  value_text TEXT,
  value_array TEXT[],
  value_json JSONB,
  pass_state TEXT CHECK (pass_state IN ('pass','fail','na','not_checked')),
  fail_reason TEXT,
  latest_responded_by UUID REFERENCES public.profiles(id),
  latest_responded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (form_id, section_id, field_id)
);
CREATE INDEX form_responses_form_idx ON field.form_responses (form_id);

CREATE TABLE field.form_response_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES field.site_forms(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  value_bool BOOLEAN,
  value_number NUMERIC,
  value_text TEXT,
  value_array TEXT[],
  value_json JSONB,
  pass_state TEXT,
  fail_reason TEXT,
  responded_by UUID REFERENCES public.profiles(id),
  responded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX form_response_history_form_idx ON field.form_response_history (form_id, responded_at);

CREATE OR REPLACE FUNCTION field.append_form_response_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'field','public' AS $fn$
BEGIN
  INSERT INTO field.form_response_history (
    form_id, section_id, field_id, value_bool, value_number, value_text,
    value_array, value_json, pass_state, fail_reason, responded_by, responded_at)
  VALUES (NEW.form_id, NEW.section_id, NEW.field_id, NEW.value_bool, NEW.value_number,
          NEW.value_text, NEW.value_array, NEW.value_json, NEW.pass_state,
          NEW.fail_reason, NEW.latest_responded_by, NEW.latest_responded_at);
  RETURN NEW;
END $fn$;

CREATE TRIGGER trg_append_form_response_history
  AFTER INSERT OR UPDATE ON field.form_responses
  FOR EACH ROW EXECUTE FUNCTION field.append_form_response_history();

-- ─── 5. Photos + signatures ──────────────────────────────────────────────────
CREATE TABLE field.form_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES field.site_forms(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  caption TEXT,
  gps_lat NUMERIC, gps_lng NUMERIC,
  taken_at TIMESTAMPTZ,
  width_px INT, height_px INT, file_size_bytes INT,
  sort_order INT NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX form_photos_form_field_idx ON field.form_photos (form_id, section_id, field_id);

CREATE TABLE field.form_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES field.site_forms(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL
    CHECK (block_id IN ('electrician','registered_person','supervisor','client_witness')),
  signatory_name TEXT NOT NULL,
  signatory_role TEXT,
  registration_category TEXT,
  registration_number TEXT,
  storage_path TEXT NOT NULL,
  signed_by UUID REFERENCES public.profiles(id),
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (form_id, block_id)
);

-- ─── 6. Access helpers (SECURITY DEFINER, keeps policies one-liners) ─────────
CREATE OR REPLACE FUNCTION field.user_has_form_read(p_form_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'field','public' SET row_security TO 'off' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM field.site_forms f
    WHERE f.id = p_form_id
      AND public.user_has_project_access(f.project_id)
      AND (NOT public.user_is_client_viewer(f.organisation_id) OR f.status = 'distributed')
  )
$fn$;

CREATE OR REPLACE FUNCTION field.user_can_write_form(p_form_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'field','public' SET row_security TO 'off' AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM field.site_forms f
    WHERE f.id = p_form_id
      AND f.status = 'draft'                              -- the write window
      AND public.user_has_project_access(f.project_id)
      AND NOT public.user_is_client_viewer(f.organisation_id)
  )
$fn$;

CREATE OR REPLACE FUNCTION field.user_can_manage_form(p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off' AS $fn$
  SELECT public.user_effective_project_role(p_project_id)
         IN ('owner','admin','project_manager')
$fn$;

-- field has no default ACL for FUNCTIONS (verified against prod), so grant here.
GRANT EXECUTE ON FUNCTION field.user_has_form_read(UUID)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION field.user_can_write_form(UUID)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION field.user_can_manage_form(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION field.allocate_form_no(UUID, TEXT) TO service_role;

-- ─── 7. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE field.form_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.site_forms            ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.form_responses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.form_response_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.form_photos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.form_signatures       ENABLE ROW LEVEL SECURITY;
ALTER TABLE field.form_number_seqs      ENABLE ROW LEVEL SECURITY;

-- Templates: readable by any authenticated user in the owning org, or if system.
CREATE POLICY form_templates_select ON field.form_templates
  FOR SELECT TO authenticated
  USING (organisation_id IS NULL OR organisation_id = ANY (public.get_user_org_ids()));

-- Template writes are owner/admin only and go through the service role in
-- practice; no INSERT/UPDATE/DELETE policy is granted to authenticated.

CREATE POLICY site_forms_select ON field.site_forms
  FOR SELECT TO authenticated
  USING (
    public.user_has_project_access(project_id)
    AND (NOT public.user_is_client_viewer(organisation_id) OR status = 'distributed')
  );

CREATE POLICY site_forms_insert ON field.site_forms
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
  );

-- Field workers may edit their own draft; managers may act on any state
-- (submit/distribute/void). WITH CHECK present from day one -- migration 00067
-- had to retrofit this for inspections to stop org/project hopping.
CREATE POLICY site_forms_update ON field.site_forms
  FOR UPDATE TO authenticated
  USING (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
    AND (status = 'draft' OR field.user_can_manage_form(project_id))
  )
  WITH CHECK (
    public.user_has_project_access(project_id)
    AND NOT public.user_is_client_viewer(organisation_id)
  );

CREATE POLICY site_forms_delete ON field.site_forms
  FOR DELETE TO authenticated
  USING (status = 'draft' AND field.user_can_manage_form(project_id));

-- Child tables derive access from the parent form (the node_circuits pattern).
CREATE POLICY form_responses_select ON field.form_responses
  FOR SELECT TO authenticated USING (field.user_has_form_read(form_id));
CREATE POLICY form_responses_insert ON field.form_responses
  FOR INSERT TO authenticated WITH CHECK (field.user_can_write_form(form_id));
CREATE POLICY form_responses_update ON field.form_responses
  FOR UPDATE TO authenticated
  USING (field.user_can_write_form(form_id))
  WITH CHECK (field.user_can_write_form(form_id));
CREATE POLICY form_responses_delete ON field.form_responses
  FOR DELETE TO authenticated USING (field.user_can_write_form(form_id));

CREATE POLICY form_response_history_select ON field.form_response_history
  FOR SELECT TO authenticated USING (field.user_has_form_read(form_id));
-- History is written only by the trigger (SECURITY DEFINER); no write policy.

CREATE POLICY form_photos_select ON field.form_photos
  FOR SELECT TO authenticated USING (field.user_has_form_read(form_id));
CREATE POLICY form_photos_insert ON field.form_photos
  FOR INSERT TO authenticated WITH CHECK (field.user_can_write_form(form_id));
CREATE POLICY form_photos_update ON field.form_photos
  FOR UPDATE TO authenticated
  USING (field.user_can_write_form(form_id))
  WITH CHECK (field.user_can_write_form(form_id));
CREATE POLICY form_photos_delete ON field.form_photos
  FOR DELETE TO authenticated USING (field.user_can_write_form(form_id));

CREATE POLICY form_signatures_select ON field.form_signatures
  FOR SELECT TO authenticated USING (field.user_has_form_read(form_id));
CREATE POLICY form_signatures_insert ON field.form_signatures
  FOR INSERT TO authenticated WITH CHECK (field.user_can_write_form(form_id));
CREATE POLICY form_signatures_update ON field.form_signatures
  FOR UPDATE TO authenticated
  USING (field.user_can_write_form(form_id))
  WITH CHECK (field.user_can_write_form(form_id));
CREATE POLICY form_signatures_delete ON field.form_signatures
  FOR DELETE TO authenticated USING (field.user_can_write_form(form_id));

-- Sequence table is service-role only; no policy granted to authenticated.

-- ─── 8. Storage buckets + policies (read AND write, per the 00073 lesson) ────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('site-form-photos', 'site-form-photos', false, 10485760,
   ARRAY['image/jpeg','image/png','image/webp','image/heic']),
  ('site-form-signatures', 'site-form-signatures', false, 524288,
   ARRAY['image/png'])
ON CONFLICT (id) DO NOTHING;

-- Path convention {project_id}/{form_id}/{section_id}/{field_id}/{ts}-{name},
-- so foldername()[2] is the form id. Every policy below keys on that.
CREATE POLICY site_form_photos_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'site-form-photos'
         AND field.user_has_form_read(((storage.foldername(name))[2])::uuid));
CREATE POLICY site_form_photos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-form-photos'
         AND field.user_can_write_form(((storage.foldername(name))[2])::uuid));
CREATE POLICY site_form_photos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'site-form-photos'
         AND field.user_can_write_form(((storage.foldername(name))[2])::uuid));

CREATE POLICY site_form_sigs_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'site-form-signatures'
         AND field.user_has_form_read(((storage.foldername(name))[2])::uuid));
CREATE POLICY site_form_sigs_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'site-form-signatures'
         AND field.user_can_write_form(((storage.foldername(name))[2])::uuid));
CREATE POLICY site_form_sigs_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'site-form-signatures'
         AND field.user_can_write_form(((storage.foldername(name))[2])::uuid));

-- ─── 9. Notification type ────────────────────────────────────────────────────
-- Re-declared wholesale each time (00066 -> 00072 -> 00173 -> 00176 -> 00178),
-- so every existing value must be re-listed here, not appended.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'snag_status_changed','rfi_assigned','rfi_closed','rfi_response','grn_recorded',
    'inspection_assigned','inspection_awaiting_verification','inspection_certified',
    'inspection_re_inspect_required','inspection_revoked','inspection_abandoned',
    'qc_issued','rfi_created','snag_created','diary_created','qc_comment',
    'snag_visit_completed',
    -- new (00179): site form distributed to the project team
    'site_form_distributed'
  )
);

-- ─── 10. Per-project email toggle ────────────────────────────────────────────
ALTER TABLE projects.project_settings
  ADD COLUMN IF NOT EXISTS notify_form_email BOOLEAN NOT NULL DEFAULT true;

-- ─── 11. updated_at triggers ─────────────────────────────────────────────────
CREATE TRIGGER trg_site_forms_updated_at BEFORE UPDATE ON field.site_forms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_form_templates_updated_at BEFORE UPDATE ON field.form_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 3: Sanity-check the SQL parses**

Every helper this migration calls was verified against production on 2026-08-12 and is listed in the
verified-facts table above — `set_updated_at`, `get_user_org_ids`, `user_is_client_viewer`,
`user_has_project_access`, `user_effective_project_role`. Do not re-derive them; do not substitute
alternatives. If any call fails at apply time, stop and report rather than guessing at a replacement.

- [ ] **Step 4: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00179_site_forms.sql
git commit -m "feat(forms): add site-forms schema, RLS, storage and notification type"
```

> **Do not apply this migration to production yet.** It is applied in Phase 5 after the code that uses it is merged, following the repo's normal order.

---

### Task 2: Wire `notify_form_email` through the settings layer

**Files:**
- Modify: `packages/shared/src/services/_project-settings-mappers.ts` (three sites: row type, camel map, patch map)
- Modify: `packages/shared/src/schemas/project-settings.schema.ts`
- Modify: `packages/shared/src/services/project-settings.service.ts` (`getNotificationConfig`)
- Test: `packages/shared/src/services/project-settings.service.test.ts`

- [ ] **Step 1: Read the three mapper sites before editing**

Run: `grep -n "notify_qc_email\|qcEmail" packages/shared/src/services/_project-settings-mappers.ts packages/shared/src/schemas/project-settings.schema.ts packages/shared/src/services/project-settings.service.ts`

`notify_qc_email` is the most recently added toggle — mirror it exactly at every site it appears. Missing one of the three mapper sites is the failure mode here: the column persists but never reaches the app.

- [ ] **Step 2: Write the failing test**

```ts
it('returns formEmail from notification config, defaulting to true', async () => {
  const client = mockClientReturning({ notify_form_email: false })
  const cfg = await projectSettingsService.getNotificationConfig(client, PROJECT_ID)
  expect(cfg.formEmail).toBe(false)
})

it('defaults formEmail to true when no settings row exists', async () => {
  const client = mockClientReturning(null)
  const cfg = await projectSettingsService.getNotificationConfig(client, PROJECT_ID)
  expect(cfg.formEmail).toBe(true)
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `pnpm --filter @esite/shared test project-settings`
Expected: FAIL — `cfg.formEmail` is `undefined`.

- [ ] **Step 4: Add `notify_form_email` / `notifyFormEmail` / `formEmail` at all four sites**

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm --filter @esite/shared test project-settings`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src
git commit -m "feat(forms): wire notify_form_email through project settings"
```

---

### Task 3: Add `FORMS_FIELD_ROLES`

**Files:**
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Add the constant next to `SNAG_FIELD_ROLES`**

```ts
/**
 * Roles that may create, fill and submit a site form. Site electricians are
 * typically `contractor`, so this must be wider than ORG_WRITE_ROLES.
 * Distribution and voiding remain ORG_WRITE_ROLES.
 */
export const FORMS_FIELD_ROLES: readonly OrgRole[] = ORG_ROLES.filter(
  (r) => r !== 'client_viewer',
)
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @esite/shared type-check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/index.ts
git commit -m "feat(forms): add FORMS_FIELD_ROLES role group"
```

---

## Phase 1 — Template and gates

### Task 4: Author the template JSON

**Files:**
- Create: `packages/shared/src/site-forms/templates/termination-and-making-safe.json`
- Create: `packages/shared/src/site-forms/template.test.ts`

The full field specification is in the research document, §4.2, sections 1 through 13. Build it verbatim from there, with these deviations already decided in the spec:

- Section 8B is **restricted** to: insulation resistance (≥ 1,0 MΩ, test voltage ≥ 500 V), earth continuity conductor resistance, bonding continuity (≤ 0,2 Ω), and polarity. Omit the other twelve SANS rows.
- `deliverable_type` is `"inspection_only"`, never `"coc"`.
- No field anywhere may be labelled or described as a Certificate of Compliance.

- [ ] **Step 1: Write the failing test first**

```ts
import { describe, it, expect } from 'vitest'
import { templateSchema } from '../inspections/template-schema'
import template from './templates/termination-and-making-safe.json'

describe('termination-and-making-safe template', () => {
  it('validates against the shared template schema', () => {
    const result = templateSchema.safeParse(template)
    if (!result.success) console.error(JSON.stringify(result.error.issues, null, 2))
    expect(result.success).toBe(true)
  })

  it('is not a CoC deliverable', () => {
    expect((template as { deliverable_type?: string }).deliverable_type).toBe('inspection_only')
  })

  it('has all fourteen sections', () => {
    const ids = (template as { sections: { section_id: string }[] }).sections.map(s => s.section_id)
    expect(ids).toEqual([
      'project_site', 'db_identification', 'earthing_adequacy', 'personnel',
      'scope_of_work', 'circuits_affected', 'safe_isolation', 'lock_register',
      'test_instruments', 'proving_dead', 'electrical_tests', 'labelling_reinstatement',
      'photographic_evidence', 'hazards_defects', 'handover_status', 'declarations',
    ])
  })

  it('carries the alternative-supplies field, the most safety-critical on the form', () => {
    const db = (template as any).sections.find((s: any) => s.section_id === 'db_identification')
    const alt = db.fields.find((f: any) => f.field_id === 'alternative_supplies')
    expect(alt).toBeDefined()
    expect(alt.type).toBe('multi_select')
    expect(alt.required).toBe(true)
  })

  it('does not offer non-compliant termination methods', () => {
    const json = JSON.stringify(template).toLowerCase()
    expect(json).not.toContain('taped up')      // not compliant with 5.2.1 / 6.3.7
    expect(json).not.toContain('switch left off') // not a securing method, GMR reg 6(2)
  })
})
```

> Note: the section list above has 16 entries because §2A, §6A, §8A and §8B are modelled as their
> own sections in the engine (which has no sub-section concept for repeating groups). The document
> still presents as 14 numbered sections. Keep the ids exactly as listed.

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @esite/shared test site-forms/template`
Expected: FAIL — module not found.

- [ ] **Step 3: Author the JSON**

Work section by section against research §4.2. Every field carries `field_id` (snake_case),
`label`, `type`, and where applicable `required`, `unit`, `options`, `conditional_on`, `help_text`,
`sans_ref`. Repeating groups (`circuits_affected`, `lock_register`, `test_instruments`, and the
defect register) use `fields[]` + `item_label_template`.

- [ ] **Step 4: Run the test until it passes**

Run: `pnpm --filter @esite/shared test site-forms/template`
Expected: PASS, all five cases.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/site-forms
git commit -m "feat(forms): add termination and making safe template"
```

---

### Task 5: Submit gates

**Files:**
- Create: `packages/shared/src/site-forms/gates.ts`
- Create: `packages/shared/src/site-forms/gates.test.ts`

- [ ] **Step 1: Write the failing tests — one passing and one blocking case per gate**

```ts
import { describe, it, expect } from 'vitest'
import { evaluateSubmitGates, type GateInput } from './gates'

const base: GateInput = {
  responses: {}, instruments: [], defects: [], workDate: '2026-08-12',
}

describe('gate: energising requires an insulation-resistance reading', () => {
  it('blocks energising with no IR reading and no 8.6.8 NOTE 2 justification', () => {
    const issues = evaluateSubmitGates({
      ...base,
      responses: { 'handover_status:as_left_status': 'energised_returned_to_service' },
    })
    expect(issues.map(i => i.code)).toContain('ir_required_before_energising')
  })

  it('allows energising with an IR reading of 1,0 MΩ or more', () => {
    const issues = evaluateSubmitGates({
      ...base,
      responses: {
        'handover_status:as_left_status': 'energised_returned_to_service',
        'electrical_tests:insulation_resistance': 2.5,
      },
    })
    expect(issues.map(i => i.code)).not.toContain('ir_required_before_energising')
  })

  it('allows energising below 1,0 MΩ only with an explicit 8.6.8 NOTE 2 justification', () => {
    const issues = evaluateSubmitGates({
      ...base,
      responses: {
        'handover_status:as_left_status': 'energised_returned_to_service',
        'electrical_tests:insulation_resistance': 0.4,
        'electrical_tests:ir_note2_justification': 'Circuit could not be isolated; tested live per 8.6.8 NOTE 2.',
      },
    })
    expect(issues.map(i => i.code)).not.toContain('ir_required_before_energising')
  })
})

describe('gate: instrument calibration', () => {
  it('blocks when an instrument is past its calibration due date', () => {
    const issues = evaluateSubmitGates({
      ...base,
      instruments: [{ label: 'Fluke 1663', calibrationDue: '2026-01-01' }],
    })
    expect(issues.map(i => i.code)).toContain('instrument_out_of_calibration')
  })

  it('passes when calibration is current', () => {
    const issues = evaluateSubmitGates({
      ...base,
      instruments: [{ label: 'Fluke 1663', calibrationDue: '2027-01-01' }],
    })
    expect(issues.map(i => i.code)).not.toContain('instrument_out_of_calibration')
  })
})

describe('gate: prove-test-prove', () => {
  it('blocks when the re-prove step is missing', () => {
    const issues = evaluateSubmitGates({
      ...base,
      responses: {
        'safe_isolation:indicator_proved_before': 'pass',
        'safe_isolation:tested_dead': 'pass',
      },
    })
    expect(issues.map(i => i.code)).toContain('prove_test_prove_incomplete')
  })

  it('passes when all three steps are recorded', () => {
    const issues = evaluateSubmitGates({
      ...base,
      responses: {
        'safe_isolation:indicator_proved_before': 'pass',
        'safe_isolation:tested_dead': 'pass',
        'safe_isolation:indicator_proved_after': 'pass',
      },
    })
    expect(issues.map(i => i.code)).not.toContain('prove_test_prove_incomplete')
  })
})

describe('gate: C1 immediate danger triggers EIR reg 9(3) duties', () => {
  it('blocks when a C1 defect exists without disconnection and notification', () => {
    const issues = evaluateSubmitGates({ ...base, defects: [{ classification: 'C1' }] })
    expect(issues.map(i => i.code)).toContain('c1_requires_reg_9_3')
  })

  it('passes when both reg 9(3) duties are recorded', () => {
    const issues = evaluateSubmitGates({
      ...base,
      defects: [{ classification: 'C1' }],
      responses: {
        'hazards_defects:supply_disconnected': 'pass',
        'hazards_defects:chief_inspector_notified': true,
      },
    })
    expect(issues.map(i => i.code)).not.toContain('c1_requires_reg_9_3')
  })
})

describe('gate: registration scope', () => {
  it('blocks a specialised installation without a master installation electrician', () => {
    const issues = evaluateSubmitGates({
      ...base,
      responses: {
        'db_identification:specialised_installation': true,
        'personnel:registered_person_category': 'installation_electrician',
      },
    })
    expect(issues.map(i => i.code)).toContain('specialised_requires_mie')
  })

  it('blocks a single-phase tester on a multi-phase installation', () => {
    const issues = evaluateSubmitGates({
      ...base,
      responses: {
        'db_identification:phases': '3',
        'personnel:registered_person_category': 'electrical_tester_single_phase',
      },
    })
    expect(issues.map(i => i.code)).toContain('tester_scope_exceeded')
  })

  it('blocks when contractor registration expired before the date of work', () => {
    const issues = evaluateSubmitGates({
      ...base,
      workDate: '2026-08-12',
      responses: { 'personnel:contractor_registration_expiry': '2026-06-30' },
    })
    expect(issues.map(i => i.code)).toContain('contractor_registration_expired')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @esite/shared test site-forms/gates`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `gates.ts`**

Pure function, no I/O, no date-of-today dependency (`workDate` is passed in so tests are
deterministic). Signature:

```ts
export interface GateIssue { code: string; message: string; sectionId: string }
export interface GateInput {
  responses: Record<string, unknown>          // keyed `${sectionId}:${fieldId}`
  instruments: { label: string; calibrationDue: string | null }[]
  defects: { classification: string }[]
  workDate: string                            // ISO date
}
export function evaluateSubmitGates(input: GateInput): GateIssue[]
```

Each message cites the binding authority — EIR reg 1 definitions for the registration-scope gates
(SANS Annex M is informative and must not be quoted as binding), EIR reg 9(3) for C1, SANS 8.6.8
NOTE 2 for the IR exception.

- [ ] **Step 4: Run until green**

Run: `pnpm --filter @esite/shared test site-forms/gates`
Expected: PASS, all 13 cases.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/site-forms
git commit -m "feat(forms): add submit gates encoding EIR and SANS constraints"
```

---

### Task 6: Migration 00180 — seed the template, plus a drift contract test

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00180_site_forms_template_seed.sql`
- Create: `apps/web/src/lib/site-forms/template-seed.contract.test.ts`

- [ ] **Step 1: Write the failing contract test**

This mirrors the snag `photo_type` contract test, which caught a live bug. It parses the JSON out of
the migration and asserts it is byte-identical to the shared file, so the two cannot drift.

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import template from '@esite/shared/site-forms/templates/termination-and-making-safe.json'

const MIGRATION = join(
  process.cwd(), '..', '..',
  'apps/edge-functions/supabase/migrations/00180_site_forms_template_seed.sql',
)

describe('seeded template matches the shared source of truth', () => {
  it('has identical schema_json', () => {
    const sql = readFileSync(MIGRATION, 'utf8')
    const m = sql.match(/\$seed\$([\s\S]*?)\$seed\$/)
    expect(m, 'migration must wrap the JSON in a $seed$ dollar-quoted block').toBeTruthy()
    expect(JSON.parse(m![1])).toEqual(template)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter web test template-seed.contract`
Expected: FAIL — migration file does not exist.

- [ ] **Step 3: Write the seed migration**

```sql
-- 00180_site_forms_template_seed.sql
-- Seeds the Termination & Making Safe system template (organisation_id NULL).
-- The JSON below is generated from
--   packages/shared/src/site-forms/templates/termination-and-making-safe.json
-- and a contract test asserts the two never drift. Edit the .json, then
-- regenerate this block -- never hand-edit the SQL.

BEGIN;

INSERT INTO field.form_templates
  (organisation_id, template_key, version, name, description, schema_json, is_active)
VALUES (
  NULL,
  'termination-and-making-safe',
  '1.0',
  'Termination and Making Safe',
  'Per-board record of termination and making-safe work on an existing installation. '
  || 'This is a works and safety record, not a Certificate of Compliance.',
  $seed$<<<PASTE THE EXACT CONTENTS OF termination-and-making-safe.json HERE>>>$seed$::jsonb,
  true
)
ON CONFLICT DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
```

Generate the block mechanically rather than by hand:

```bash
node -e "
const fs=require('fs');
const j=fs.readFileSync('packages/shared/src/site-forms/templates/termination-and-making-safe.json','utf8');
if (j.includes('\$seed\$')) { console.error('JSON contains the dollar-quote delimiter'); process.exit(1); }
const p='apps/edge-functions/supabase/migrations/00180_site_forms_template_seed.sql';
fs.writeFileSync(p, fs.readFileSync(p,'utf8').replace(/\\\$seed\\\$[\s\S]*?\\\$seed\\\$', '\$seed\$'+j.trim()+'\$seed\$'));
"
```

- [ ] **Step 4: Run the contract test until green**

Run: `pnpm --filter web test template-seed.contract`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00180_site_forms_template_seed.sql apps/web/src/lib/site-forms
git commit -m "feat(forms): seed the termination and making safe template"
```

---

## Phase 2 — Server actions

### Task 7: Lifecycle actions

**Files:**
- Create: `apps/web/src/actions/site-forms.actions.ts`
- Create: `apps/web/src/actions/site-forms.actions.test.ts`

Follow the house skeleton exactly: `'use server'`, cookie client, role gate, write, best-effort
notify, `revalidatePath`, return. Local guard helper:

```ts
async function guardProject(projectId: string, roles: readonly OrgRole[] = ORG_WRITE_ROLES) {
  const supabase = (await createClient()) as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' as const }
  const gate = await requireEffectiveRole(supabase, projectId, roles)
  if (!gate.ok) return { error: gate.error }
  return { supabase, userId: user.id, role: gate.role }
}
```

Actions and their gates:

| Action | Gate |
|---|---|
| `listProjectFormsAction(projectId, filters)` | any project role (RLS narrows) |
| `listFormTemplatesAction(orgId)` | `FORMS_FIELD_ROLES` |
| `createSiteFormAction(input)` | `FORMS_FIELD_ROLES` |
| `upsertFormResponseAction(input)` | `FORMS_FIELD_ROLES` |
| `submitSiteFormAction(formId, projectId)` | `FORMS_FIELD_ROLES` |
| `voidSiteFormAction(formId, projectId, reason)` | `ORG_WRITE_ROLES` |

`createSiteFormAction` must resolve `board_label` from `structure.nodes` when `node_id` is supplied,
and require a non-blank `board_ref` otherwise (mirroring the DB CHECK so the user gets a real error
rather than a constraint violation). It allocates `form_no` via
`field.allocate_form_no(id, 'TMS')` using the service client.

`submitSiteFormAction` must, in order: load responses → run `evaluateSubmitGates` → return the issue
list unchanged if non-empty (do not partially submit) → denormalise `as_left_status` → flip status to
`submitted` and stamp `submitted_by`/`submitted_at`.

- [ ] **Step 1: Write failing gate tests covering all seven roles per action**

Assert that `client_viewer` is refused on every write action, and that `contractor` is **allowed** to
create/fill/submit but **refused** on `voidSiteFormAction`. That contractor split is the whole point
of `FORMS_FIELD_ROLES` and is the regression most likely to be introduced later.

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter web test site-forms.actions`

- [ ] **Step 3: Implement the actions**

- [ ] **Step 4: Run until green**

Run: `pnpm --filter web test site-forms.actions`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/site-forms.actions.ts apps/web/src/actions/site-forms.actions.test.ts
git commit -m "feat(forms): add site form lifecycle actions"
```

---

### Task 8: Photo and signature upload helper

**Files:**
- Create: `apps/web/src/lib/site-forms/upload.ts`
- Create: `apps/web/src/lib/site-forms/upload.test.ts`

Reuse `compressImage` from `apps/web/src/lib/image/compress.ts` — do not write a second copy.

Both functions must be **orphan-safe**: if the row insert fails after the object upload succeeds,
remove the object. PR #158 shipped this bug in the snag module and stranded storage objects in
production; the fix is the reason `uploadSnagPhoto` exists in that shape.

```ts
export async function uploadFormPhoto(supabase, opts: {
  projectId: string; formId: string; sectionId: string; fieldId: string
  file: File; sortOrder: number
}): Promise<{ id: string } | { error: string }>

export async function uploadFormSignature(supabase, opts: {
  projectId: string; formId: string; blockId: SignatureBlockId
  pngBlob: Blob; signatoryName: string; signatoryRole?: string
  registrationCategory?: string; registrationNumber?: string
}): Promise<{ id: string } | { error: string }>
```

Path: `${projectId}/${formId}/${sectionId}/${fieldId}/${Date.now()}-${sortOrder}.${ext}`.
Signatures use `${projectId}/${formId}/signatures/${blockId}/${Date.now()}.png` — note the
**form id must remain segment 2**, or every storage policy silently denies.

- [ ] **Step 1: Write a failing test asserting the object is removed when the row insert fails**

- [ ] **Step 2: Run and confirm failure** — `pnpm --filter web test site-forms/upload`

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run until green**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/site-forms
git commit -m "feat(forms): add orphan-safe photo and signature upload"
```

---

## Phase 3 — Web UI

### Task 9: List page and sidebar entry

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/forms/page.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx:71-89`

- [ ] **Step 1: Add the sidebar entry** to `projectNav`, before `Settings`:

```ts
{ href: `/projects/${id}/forms`, label: 'Forms', Icon: FileText, exact: false },
```

Import `FileText` from `lucide-react` alongside the existing icons.

- [ ] **Step 2: Build the list page**

Columns: form no., board (node code + as-found label, or the free-text ref), template, status badge,
as-left status, created by, date. Filters: board, status, template.

**The empty state must carry the "+ New form" call to action.** PR #159's post-mortem: the snag
module was verified by deep-linking to a seeded record, which proved the page worked and entirely
missed that no user could reach it. Build the empty state first, and walk to it from the project
overview during verification.

Status badge variants: `draft` → `ghost`, `submitted` → `info`, `distributed` → `success`,
`void` → `danger`.

- [ ] **Step 3: Verify the route renders and the sidebar links to it**

Run: `pnpm --filter web dev`, open `/projects/<id>/forms`, confirm the empty state and CTA.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(admin\)/projects/\[id\]/forms apps/web/src/components/layout/Sidebar.tsx
git commit -m "feat(forms): add project forms list and sidebar entry"
```

---

### Task 10: New-form page with board picker

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/forms/new/page.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/forms/new/NewFormForm.tsx`

Board picker loads via `listNodes(client, projectId)` from `@esite/shared/structure`, grouped by
`kind` using the label/order maps in
`apps/web/src/app/(admin)/projects/[id]/equipment-materials/_lib/gather-unified-boards.ts`.

Below the picker, a "Board not in the list yet" disclosure reveals a free-text `board_ref` input.
Exactly one of the two must be provided; the form blocks submission otherwise with a plain-language
message, not a database error.

- [ ] **Step 1: Build the page and client form**
- [ ] **Step 2: Verify creation lands on the capture page with a `form_no` allocated**
- [ ] **Step 3: Commit**

```bash
git commit -am "feat(forms): add new form page with structure-node board picker"
```

---

### Task 11: Capture page

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/forms/[formId]/page.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/forms/[formId]/CaptureForm.tsx`

Reuse the inspections field renderer and its `fields/*` components directly. They are near-generic —
only the schema name and bucket are module-specific, and both are passed in.

Requirements:
- Debounced autosave, 800 ms, keyed `${sectionId}:${fieldId}` in a `useRef<Map>` of timers, with a
  per-field saving indicator. Copy the pattern from the inspections `CaptureForm`.
- Sections collapsible; §6 (`safe_isolation`) renders **in order and locks ahead** — a later step is
  disabled until the preceding one is answered. A back-fillable isolation checklist is worthless in
  an enquiry, and this is the control that prevents it.
- A persistent gate panel showing outstanding `GateIssue`s, with the submit button disabled while any
  remain. Each issue deep-links to its section.
- Read-only rendering for any status other than `draft`.

- [ ] **Step 1: Build the server shell** (loads form, template, responses, photos, signatures)
- [ ] **Step 2: Build the client capture form**
- [ ] **Step 3: Verify autosave persists and the §6 sequence lock holds**
- [ ] **Step 4: Commit**

```bash
git commit -am "feat(forms): add form capture page with autosave and isolation sequence lock"
```

---

### Task 12: Signature pad

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/forms/[formId]/SignaturePad.tsx`

Canvas capture with pointer events (works for finger, stylus and mouse), a Clear control, and
inputs for name, role, registration category and registration number. Exports a PNG blob to
`uploadFormSignature`.

Use a two-step inline confirm for Clear rather than `window.confirm` — Safari silently suppresses it,
which cost real debugging time in this codebase before.

- [ ] **Step 1: Build the component**
- [ ] **Step 2: Verify a signature round-trips to storage and renders back on reload**
- [ ] **Step 3: Commit**

```bash
git commit -am "feat(forms): add signature capture"
```

---

## Phase 4 — PDF report

### Task 13: Report data gatherer

**Files:**
- Create: `apps/web/src/lib/reports/site-form-report-data.ts`

Mirror `snag-visit-report-data.ts`. Non-negotiables:
- **Role gate before any service-role fetch.** The cookie client establishes access; only then does
  the service client run.
- Photos, signatures and logos are downloaded to **`data:` URIs**. React-PDF fetches URLs
  server-side with no timeout and fails silently, so a signed URL produces a blank image and no error.
- Profile names come from the service client (`public.profiles` RLS returns only your own row).
- Cap photos per field at 24, as the inspections gatherer does.

- [ ] **Step 1: Implement**
- [ ] **Step 2: Commit** — `git commit -am "feat(forms): gather site form report data"`

---

### Task 14: React-PDF document

**Files:**
- Create: `apps/web/src/lib/reports/site-form-report.tsx`
- Create: `apps/web/src/lib/reports/render-site-form.ts`
- Create: `apps/web/src/lib/reports/site-form-report.test.tsx`

Reuse `Cover` and `pageStyles` from `./components` and `resolveBranding` from `./branding`.

**Every page carries a fixed footer with the non-CoC disclaimer:**

> This is a record of termination and making-safe work. It is not a Certificate of Compliance.
> A Certificate of Compliance in the form of Annexure 1 to the Electrical Installation Regulations,
> 2009, accompanied by the SANS 10142-1 test report, must be issued by a registered person for the
> altered part of the installation.

Document order: cover → summary (board, as-left status, circuits left in a temporary state) →
sections in template order → photographic evidence → defect register → declarations with embedded
signature images → response audit history.

- [ ] **Step 1: Write the failing render test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { renderSiteFormReport } from './render-site-form'
import { fixtureData, fixtureBranding } from './__fixtures__/site-form'

describe('site form report', () => {
  it('renders a non-empty PDF buffer', async () => {
    const buf = await renderSiteFormReport(fixtureData, fixtureBranding)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.byteLength).toBeGreaterThan(1000)
  })

  it('survives hostile unicode in payload strings', async () => {
    const hostile = {
      ...fixtureData,
      boardLabel: 'DB-1 Ω → 2,5 mm²\nsecond line\ttabbed',
      scopeDescription: '→ Ω ± ° μ « » — – ‘ ’ “ ”',
    }
    const buf = await renderSiteFormReport(hostile, fixtureBranding)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('includes the non-CoC disclaimer', async () => {
    const buf = await renderSiteFormReport(fixtureData, fixtureBranding)
    expect(buf.toString('latin1')).toContain('not a Certificate of Compliance')
  })
})
```

> The hostile-unicode case guards the class of bug that made the cable-schedule PDF pack throw on
> every render for two months: `pdf-lib`'s standard Helvetica is WinAnsi-only and `Ω`/`→` crashed it.
> React-PDF handles these, but the fixture keeps that guarantee honest if the renderer ever changes.

- [ ] **Step 2: Run and confirm failure** — `pnpm --filter web test site-form-report`
- [ ] **Step 3: Implement the document and the buffer bridge**
- [ ] **Step 4: Run until green**
- [ ] **Step 5: Commit** — `git commit -am "feat(forms): render branded site form PDF"`

---

### Task 15: File the report and add the preview route

**Files:**
- Create: `apps/web/src/lib/reports/file-site-form-report.ts`
- Create: `apps/web/src/app/api/projects/[id]/forms/[formId]/report/route.ts`

`generateAndFileSiteFormReport(formId, projectId)`:
1. Gather + render.
2. Find the prior `status='issued'` row for `(source_table='site_forms', source_id=formId)`,
   ordered by version desc → `newVersion = prior.version + 1`, else 1.
3. Upload to bucket `reports` at `{orgId}/{projectId}/site-form-{formId}-v{n}.pdf`, `upsert: false`.
4. Insert `projects.reports` with `kind:'site_form'`, `source_table:'site_forms'`,
   `source_id: formId`, `status:'issued'`, `version`, `branding_snapshot` (with `data:` URIs
   **stripped** — keep accent, wordmark, kicker, project line only). **Remove the uploaded object if
   the insert fails.**
5. Supersede all other issued rows for that source in one statement.

Preview route: `runtime = 'nodejs'`, auth check only (the real gate is inside the gatherer),
`Content-Type: application/pdf`, `Cache-Control: no-store`, inline disposition, no persistence.

- [ ] **Step 1: Implement both**
- [ ] **Step 2: Verify the preview route returns a PDF for a draft form**
- [ ] **Step 3: Commit** — `git commit -am "feat(forms): file versioned site form reports and add preview route"`

---

## Phase 5 — Email, branding and distribution

### Task 16: Shared branded email layout

**Files:**
- Create: `packages/shared/src/email/layout.ts`
- Create: `packages/shared/src/email/layout.test.ts`

This is the first genuinely branded transactional email in the codebase. Five private
`baseEmailTemplate` copies already exist; **leave them alone** — migrating them is out of scope.

```ts
export interface BrandedEmailOptions {
  accentColor: string          // resolved project -> org -> default '#E69500'
  logoUrl: string | null       // SIGNED URL, 7-day TTL. Never a data: URI.
  projectName: string
  title: string
  contentHtml: string
  siteUrl: string
  footerNote?: string
}
export function renderBrandedEmail(o: BrandedEmailOptions): string
export function escapeHtml(s: string): string
```

Keep the existing dark-card palette (bg `#0F172A`, card `#1E293B`, border `#334155`, text `#E2E8F0`)
so it sits alongside the current emails, but drive the CTA and header rule from `accentColor`, and
render the logo above the title when present.

- [ ] **Step 1: Write the failing tests**

```ts
it('applies the accent colour to the header rule and CTA', () => {
  const html = renderBrandedEmail({ ...base, accentColor: '#E69500' })
  expect(html).toContain('#E69500')
})

it('renders the logo when supplied', () => {
  const html = renderBrandedEmail({ ...base, logoUrl: 'https://x.supabase.co/storage/v1/signed/logo.png?token=abc' })
  expect(html).toContain('<img')
  expect(html).toContain('signed/logo.png')
})

it('never emits a data: image source', () => {
  // Gmail and most webmail clients strip data: in <img src>, so inlined bytes
  // render as broken images. Signed URLs only.
  const html = renderBrandedEmail({ ...base, logoUrl: 'data:image/png;base64,AAAA' })
  expect(html).not.toContain('data:image')
})

it('escapes HTML in the project name and title', () => {
  const html = renderBrandedEmail({ ...base, projectName: '<script>x</script>', title: 'a & b' })
  expect(html).not.toContain('<script>')
  expect(html).toContain('a &amp; b')
})
```

- [ ] **Step 2: Run and confirm failure** — `pnpm --filter @esite/shared test email/layout`
- [ ] **Step 3: Implement** — reject any `logoUrl` starting with `data:` by treating it as absent
- [ ] **Step 4: Run until green**
- [ ] **Step 5: Commit** — `git commit -am "feat(email): add shared branded email layout"`

---

### Task 17: Site-form email template

**Files:**
- Create: `packages/shared/src/email/site-form-email.ts`
- Create: `packages/shared/src/email/site-form-email.test.ts`
- Modify: `packages/shared/src/index.ts` (export both new email modules and `site-forms`)

Content: board identification, as-left status, count of circuits left in a temporary state, top
defects with their C1/C2/C3/FI grades, up to four photo thumbnails as **7-day signed URLs**, a deep
link to the form page (`/projects/{projectId}/forms/{formId}` — **not** a signed file URL, which
expires and cannot be re-shared), and the non-CoC disclaimer in the footer.

Subject: `{formNo} — {boardLabel} made safe — {projectName}`, adjusted for the as-left status.

- [ ] **Step 1: Write the failing tests** — subject shape, disclaimer present, no `data:` sources,
      C1 defects visually flagged, deep link points at the form page not storage
- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run until green**
- [ ] **Step 5: Commit** — `git commit -am "feat(email): add site form distributed email"`

---

### Task 18: Distribution — recipient preview, dispatch, UI

**Files:**
- Create: `apps/web/src/lib/site-form-email.ts`
- Create: `apps/web/src/actions/site-forms-distribute.actions.ts`
- Create: `apps/web/src/app/(admin)/projects/[id]/forms/[formId]/DistributePanel.tsx`

`previewFormRecipientsAction(projectId)` — gated `ORG_WRITE_ROLES` — returns `{ name, email }[]` from
`resolveProjectRecipients`, plus the current `notify_form_email` value.

**This preview is the safety control for the whole feature.** `project_notification_recipients()`
resolves 12 real wmeng.co.za people for any WM-Consulting project. The reviewer sees the exact list
and the count before anything is sent.

`distributeSiteFormAction(formId, projectId)` — gated `ORG_WRITE_ROLES`:
1. Guard the form belongs to the project.
2. Require `status = 'submitted'` or `'distributed'` (re-distribution allowed).
3. `generateAndFileSiteFormReport` → `reportId`.
4. Stamp `status='distributed'`, `distributed_by`, `distributed_at`, `report_id`.
5. `notifySiteFormDistributed(...)` — best-effort, never throws, never blocks the stamp.

If step 3 fails, return the error and do **not** stamp. If step 5 fails, the form is still
distributed and the report still filed; surface a warning, not a failure.

`DistributePanel`: shows the recipient list and count, a two-step confirm
("Distribute" → "Confirm — email N recipients?" with a 4-second timeout, matching the snag visit
pattern), and a warning banner when `notify_form_email` is false explaining that the report will be
filed but no email sent.

- [ ] **Step 1: Write failing gate tests** — `contractor` refused, `project_manager` allowed,
      `client_viewer` refused; distribution refused on a `draft` form
- [ ] **Step 2: Run and confirm failure**
- [ ] **Step 3: Implement all three files**
- [ ] **Step 4: Run until green**
- [ ] **Step 5: Commit** — `git commit -am "feat(forms): distribute forms with recipient preview"`

---

## Phase 6 — Documentation, verification and release

### Task 19: RBAC matrix

**Files:**
- Modify: `docs/rbac-matrix.md`

House rule, stated in the file header: every new route or endpoint is added in the same PR that
introduces it. Three additions, each using the existing 8-column header:

1. Page routes: `/projects/[id]/forms` and its children — `W` for owner/admin/PM/contractor/
   inspector/supplier, `R` for client_viewer (distributed only, footnoted).
2. API routes: `/api/projects/[id]/forms/[formId]/report`.
3. A `site-forms.actions.ts` + `site-forms-distribute.actions.ts` action table with a blockquote
   footnote explaining the `FORMS_FIELD_ROLES` vs `ORG_WRITE_ROLES` split.

- [ ] **Step 1: Add all three** — [ ] **Step 2: Commit** — `git commit -am "docs: add site forms to the RBAC matrix"`

---

### Task 20: Full verification sweep

- [ ] **Step 1: Shared tests** — `pnpm --filter @esite/shared test` — expected: all pass, no
      pre-existing failures introduced. Record the count.
- [ ] **Step 2: Web tests** — `pnpm --filter web test` — expected: all pass. Record the count.
- [ ] **Step 3: Type-check** — `pnpm --filter @esite/shared type-check && pnpm --filter web type-check` — clean
- [ ] **Step 4: Lint** — `pnpm lint` — no new warnings
- [ ] **Step 5: Adversarial review**

Dispatch two independent review subagents (see `superpowers:requesting-code-review`), one for
correctness and one for security/RLS. Fix every confirmed finding **before** pushing. Both the
cable-export and legend-card PRs caught real defects this way.

- [ ] **Step 6: Commit any fixes**

---

### Task 21: Apply, deploy, verify in production

Order matters: **migration → merge → deploy → verify**. Applying after merge would serve code against
a schema that does not exist yet.

- [ ] **Step 1: Re-read the migration numbers** and confirm neither was claimed by the concurrent
      session. Renumber if so.
- [ ] **Step 2: Apply 00179 and 00180** via the Supabase Management API
      (`POST /v1/projects/{ref}/database/query`), then log both in `schema_migrations` and confirm
      `NOTIFY pgrst` took effect by querying one new table over REST.
- [ ] **Step 3: Confirm grants landed**

```sql
select table_name, grantee, string_agg(distinct privilege_type,',') as privs
from information_schema.role_table_grants
where table_schema='field' and table_name like 'form%' or table_name='site_forms'
group by 1,2 order by 1,2;
```
Expected: `anon=SELECT`, `authenticated=SELECT,INSERT,UPDATE,DELETE`, `service_role=ALL` on every new
table. **If any table has no grants, stop** — that is the `PGRST002` condition that takes down the
entire REST API, and it must be fixed before the deploy proceeds.

- [ ] **Step 4: Open the PR**, wait for CI green, merge.
- [ ] **Step 5: Verify on production against a throwaway project**

Create a throwaway project and **set `notify_form_email = false` on it first**. Then re-read the row
to confirm the value actually persisted — a `.upsert()` on `project_settings` has twice reported
success while leaving the value unchanged, because PostgREST only performs an upsert when
`Prefer: resolution=merge-duplicates` arrives as an HTTP **header**, not a query parameter. This
column gates outbound email to 12 real people, so it is verified by re-read, never by absence of an
error.

Then, on `www.e-site.live`:
1. As the `rbac-test` contractor fixture: navigate from the project overview → Forms → empty state →
   "+ New form". **Walk the flow from the empty state, not a deep link.** Create a form, fill a
   section, upload a photo, sign, submit. Confirm the Distribute control is absent.
2. As a throwaway probe-admin: distribute. Confirm the recipient preview lists the expected people
   and the count matches.
3. Confirm: `projects.reports` row `kind='site_form'` v1 `status='issued'`; PDF 200 with embedded
   images; `site_form_distributed` notification row inserted; re-distribution issues v2 and marks v1
   superseded.
4. Confirm no email was sent (toggle off), and that the render was exercised by fetching the
   preview route.

- [ ] **Step 6: Tear down to zero residue** — delete the throwaway project, the probe user, its
      membership, and its `public.auth_events` rows. Confirm real data is unchanged.
- [ ] **Step 7: Update `CLAUDE.md`** with a "Shipped" entry recording what was verified, what was
      not, and any gotchas found.

---

## Self-review against the spec

| Spec section | Covered by |
|---|---|
| §4.1 engine reuse | Task 4 (imports `templateSchema`), Task 11 (reuses `FieldRenderer`) |
| §4.3 `field` schema, no PostgREST PATCH | Task 1, verified-facts table |
| §5 all six tables + buckets | Task 1 |
| §6 lifecycle incl. void and re-distribution | Task 1 (CHECK), Task 7, Task 18 |
| §7 all five hard gates | Task 5 (13 tests) |
| §7 §6 sequence lock | Task 11 |
| §8 template, 14 sections, restricted 8B | Task 4, Task 6 |
| §9 all five routes + sidebar | Tasks 9–12, 15 |
| §10 three-layer PDF + non-CoC footer | Tasks 13–15 |
| §11 shared branded layout, signed URLs, toggle, notification type | Tasks 1, 2, 16, 17, 18 |
| §11 recipient preview | Task 18 |
| §12 RBAC + matrix | Tasks 3, 7, 18, 19 |
| §13 testing + verification | Tasks 20, 21 |
