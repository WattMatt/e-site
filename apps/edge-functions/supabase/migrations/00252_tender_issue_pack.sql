-- E5: the tender issue pack (owner, 2026-10-19). WM issues documents with a
-- tender (specifications, drawings, P&G, conditions of tender), the tender
-- carries its particulars (reference, description, site inspection, queries
-- deadline, validity, contact), and every bidder download is receipted.
--
-- Rules:
--   * A pack document may be added or removed only while the tender is a
--     draft: bidders price exactly what was issued.
--   * After issue, a new or revised document can only ride an ADDENDUM
--     (clarification_id -> an unpublished addendum of the same tender). Once
--     that addendum publishes, its documents are as final as its text; the
--     existing machinery already returns submitted bids to draft and refuses
--     re-submission until the bidder acknowledges.
--   * Bidders never read the table: they list through
--     tender_portal_documents() (pack documents plus published-addendum
--     documents) and each download is logged per participant through
--     tender_log_document_download(), so WM holds proof of what each tenderer
--     received.
--   * The particulars are frozen at issue (tenders_status_guard): a change
--     after issue is communicated by addendum.

-- ── 1. Tender particulars ───────────────────────────────────────────────────
ALTER TABLE projects.tenders
  ADD COLUMN reference        text,
  ADD COLUMN description      text,
  ADD COLUMN site_inspection  text,
  ADD COLUMN queries_close_at timestamptz,
  ADD COLUMN validity_days    int,
  ADD COLUMN contact_name     text,
  ADD COLUMN contact_email    text;
ALTER TABLE projects.tenders
  ADD CONSTRAINT tenders_validity_days_range CHECK (validity_days IS NULL OR validity_days BETWEEN 1 AND 365),
  ADD CONSTRAINT tenders_contact_email_shape CHECK (contact_email IS NULL OR contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- Frozen once the tender leaves draft, like the import columns. The body below
-- is 00226's with the particulars block added at the end.
CREATE OR REPLACE FUNCTION projects.tenders_status_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'draft'  AND NEW.status IN ('issued','cancelled'))
    OR (OLD.status = 'issued' AND NEW.status IN ('closed','cancelled'))
    OR (OLD.status = 'closed' AND NEW.status IN ('adjudicated','cancelled'))
  ) THEN
    RAISE EXCEPTION 'a tender cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '55000';
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'a tender cannot move to another project' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'issued' THEN
    IF NEW.closing_at <= now() THEN
      RAISE EXCEPTION 'the closing time must be in the future when a tender is issued' USING ERRCODE = '23514';
    END IF;
    IF NEW.imported_at IS NULL THEN
      RAISE EXCEPTION 'import the BOQ before issuing the tender' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM projects.tender_boq_items i
                WHERE i.tender_id = NEW.id AND i.kind = 'item'
                  AND i.rate_cell_type = 'fixed' AND i.fixed_amount IS NULL) THEN
      RAISE EXCEPTION 'every fixed sum needs its amount before the tender is issued' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD.status <> 'draft' THEN
    IF NEW.closing_at IS DISTINCT FROM OLD.closing_at
       AND (NEW.closing_at IS NULL OR NEW.closing_at < OLD.closing_at) THEN
      RAISE EXCEPTION 'an issued tender''s closing time can only be extended' USING ERRCODE = '55000';
    END IF;
    IF NEW.source_path IS DISTINCT FROM OLD.source_path
       OR NEW.source_filename IS DISTINCT FROM OLD.source_filename
       OR NEW.estimate_path IS DISTINCT FROM OLD.estimate_path
       OR NEW.estimate_filename IS DISTINCT FROM OLD.estimate_filename
       OR NEW.reconciliation IS DISTINCT FROM OLD.reconciliation
       OR NEW.structure_diff IS DISTINCT FROM OLD.structure_diff
       OR NEW.imported_at IS DISTINCT FROM OLD.imported_at
       OR NEW.stated_subtotal IS DISTINCT FROM OLD.stated_subtotal
       OR NEW.stated_vat IS DISTINCT FROM OLD.stated_vat
       OR NEW.stated_total IS DISTINCT FROM OLD.stated_total
       OR NEW.package IS DISTINCT FROM OLD.package
       OR NEW.revision IS DISTINCT FROM OLD.revision THEN
      RAISE EXCEPTION 'the import of an issued tender is frozen' USING ERRCODE = '55000';
    END IF;
    -- The particulars every bidder read when the tender was issued are as
    -- frozen as the BOQ. Changes after issue go out as an addendum.
    IF NEW.reference IS DISTINCT FROM OLD.reference
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.site_inspection IS DISTINCT FROM OLD.site_inspection
       OR NEW.queries_close_at IS DISTINCT FROM OLD.queries_close_at
       OR NEW.validity_days IS DISTINCT FROM OLD.validity_days
       OR NEW.contact_name IS DISTINCT FROM OLD.contact_name
       OR NEW.contact_email IS DISTINCT FROM OLD.contact_email THEN
      RAISE EXCEPTION 'an issued tender''s particulars are frozen; publish an addendum instead' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ── 2. Issued documents ─────────────────────────────────────────────────────
CREATE TABLE projects.tender_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id        uuid NOT NULL REFERENCES projects.tenders(id) ON DELETE CASCADE,
  -- NULL = part of the issued pack; set = attached to that addendum.
  clarification_id uuid REFERENCES projects.tender_clarifications(id) ON DELETE CASCADE,
  category         text NOT NULL CHECK (category IN ('specification','drawing','pg','conditions','returnable','addendum','other')),
  label            text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 300),
  file_name        text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 300),
  file_path        text NOT NULL UNIQUE,
  file_size        bigint NOT NULL CHECK (file_size > 0 AND file_size <= 52428800),
  content_type     text,
  sort_order       int NOT NULL DEFAULT 0,
  uploaded_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tender_documents_tender_idx ON projects.tender_documents(tender_id, sort_order, created_at);
CREATE INDEX tender_documents_clarification_idx ON projects.tender_documents(clarification_id) WHERE clarification_id IS NOT NULL;

-- State rules. The cascade from deleting the tender itself must still work, so
-- (as in tender_children_locked) the lock only applies while the parent exists.
CREATE FUNCTION projects.tender_documents_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tender uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.tender_id ELSE NEW.tender_id END;
  v_clar   uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.clarification_id ELSE NEW.clarification_id END;
  v_status text;
  v_published timestamptz;
BEGIN
  SELECT t.status INTO v_status FROM projects.tenders t WHERE t.id = v_tender;
  IF v_status IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; -- parent gone: cascading
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tender_id IS DISTINCT FROM OLD.tender_id OR NEW.clarification_id IS DISTINCT FROM OLD.clarification_id THEN
      RAISE EXCEPTION 'a tender document cannot be re-pointed' USING ERRCODE = '55000';
    END IF;
    IF NEW.file_path IS DISTINCT FROM OLD.file_path OR NEW.file_name IS DISTINCT FROM OLD.file_name
       OR NEW.file_size IS DISTINCT FROM OLD.file_size OR NEW.content_type IS DISTINCT FROM OLD.content_type
       OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'a tender document''s file is immutable; remove it and upload another' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF v_clar IS NULL THEN
    -- Pack document: the issued pack is exactly what bidders received.
    IF v_status <> 'draft' THEN
      RAISE EXCEPTION 'the issued pack is frozen; attach the document to an addendum' USING ERRCODE = '55000';
    END IF;
  ELSE
    SELECT c.published_at INTO v_published
      FROM projects.tender_clarifications c
     WHERE c.id = v_clar AND c.tender_id = v_tender AND c.kind = 'addendum';
    IF NOT FOUND THEN
      IF TG_OP = 'DELETE' THEN
        RETURN OLD; -- the addendum itself is being deleted: cascading
      END IF;
      RAISE EXCEPTION 'documents attach only to an addendum of the same tender' USING ERRCODE = '23514';
    END IF;
    IF v_published IS NOT NULL THEN
      RAISE EXCEPTION 'published to every bidder, so it is final; publish another addendum instead' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    NEW.uploaded_by := auth.uid();
    NEW.created_at := now();
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER tender_documents_guard BEFORE INSERT OR UPDATE OR DELETE ON projects.tender_documents
  FOR EACH ROW EXECUTE FUNCTION projects.tender_documents_guard();

-- ── 3. Download receipts ────────────────────────────────────────────────────
CREATE TABLE projects.tender_document_downloads (
  document_id    uuid NOT NULL REFERENCES projects.tender_documents(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES projects.tender_participants(id) ON DELETE CASCADE,
  tender_id      uuid NOT NULL REFERENCES projects.tenders(id) ON DELETE CASCADE,
  download_count int NOT NULL DEFAULT 1 CHECK (download_count > 0),
  first_at       timestamptz NOT NULL DEFAULT now(),
  last_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, participant_id)
);
CREATE INDEX tender_document_downloads_tender_idx ON projects.tender_document_downloads(tender_id, participant_id);

-- tender_id is derived, never supplied.
CREATE FUNCTION projects.tender_document_downloads_bind() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  SELECT d.tender_id INTO NEW.tender_id FROM projects.tender_documents d WHERE d.id = NEW.document_id;
  IF NEW.tender_id IS NULL THEN
    RAISE EXCEPTION 'unknown tender document' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM projects.tender_participants tp
                  WHERE tp.id = NEW.participant_id AND tp.tender_id = NEW.tender_id) THEN
    RAISE EXCEPTION 'that participant does not belong to this tender' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tender_document_downloads_bind BEFORE INSERT OR UPDATE ON projects.tender_document_downloads
  FOR EACH ROW EXECUTE FUNCTION projects.tender_document_downloads_bind();

-- ── 4. What a bidder sees, and the receipt ──────────────────────────────────
-- A document is visible to the caller (a participant of its tender) when it is
-- part of the issued pack, or attached to a PUBLISHED addendum.
CREATE FUNCTION projects.tender_document_visible(p_document_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects.tender_documents d
     WHERE d.id = p_document_id
       AND projects.tender_participant_can_read(d.tender_id)
       AND (d.clarification_id IS NULL
            OR EXISTS (SELECT 1 FROM projects.tender_clarifications c
                        WHERE c.id = d.clarification_id AND c.published_at IS NOT NULL)))
$$;

CREATE FUNCTION projects.tender_portal_documents(p_tender_id uuid)
RETURNS TABLE (id uuid, clarification_id uuid, category text, label text, file_name text,
               file_size bigint, sort_order int, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.id, d.clarification_id, d.category, d.label, d.file_name, d.file_size, d.sort_order, d.created_at
    FROM projects.tender_documents d
   WHERE d.tender_id = p_tender_id
     AND projects.tender_participant_can_read(p_tender_id)
     AND (d.clarification_id IS NULL
          OR EXISTS (SELECT 1 FROM projects.tender_clarifications c
                      WHERE c.id = d.clarification_id AND c.published_at IS NOT NULL))
   ORDER BY d.clarification_id NULLS FIRST, d.sort_order, d.created_at
$$;

-- Called by the download action as the signed-in bidder, after visibility is
-- confirmed and before the signed URL is handed over.
CREATE FUNCTION projects.tender_log_document_download(p_document_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tender uuid;
  v_part   uuid;
BEGIN
  SELECT d.tender_id INTO v_tender FROM projects.tender_documents d WHERE d.id = p_document_id;
  v_part := projects.tender_my_participant_id(v_tender);
  IF v_part IS NULL OR NOT projects.tender_document_visible(p_document_id) THEN
    RAISE EXCEPTION 'that document is not available to you' USING ERRCODE = '42501';
  END IF;
  INSERT INTO projects.tender_document_downloads (document_id, participant_id)
  VALUES (p_document_id, v_part)
  ON CONFLICT (document_id, participant_id)
  DO UPDATE SET download_count = projects.tender_document_downloads.download_count + 1, last_at = now();
END $$;

-- ── 5. The portal summary gains the particulars ─────────────────────────────
DROP FUNCTION projects.tender_portal_summary(uuid);
CREATE FUNCTION projects.tender_portal_summary(p_tender_id uuid)
RETURNS TABLE (id uuid, project_name text, package text, title text, revision text,
               status text, closing_at timestamptz, organisation_name text,
               reference text, description text, site_inspection text,
               queries_close_at timestamptz, validity_days int,
               contact_name text, contact_email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id, p.name, t.package, t.title, t.revision, t.status, t.closing_at, o.name,
         t.reference, t.description, t.site_inspection,
         t.queries_close_at, t.validity_days, t.contact_name, t.contact_email
    FROM projects.tenders t
    JOIN projects.projects p ON p.id = t.project_id
    JOIN public.organisations o ON o.id = t.organisation_id
   WHERE t.id = p_tender_id
     AND projects.tender_participant_can_read(p_tender_id)
$$;

-- ── 6. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE projects.tender_documents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_document_downloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_documents          FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_document_downloads FORCE ROW LEVEL SECURITY;

-- WM manages documents; bidders read only through the portal functions above.
CREATE POLICY tender_documents_select ON projects.tender_documents FOR SELECT TO authenticated
  USING (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_documents_insert ON projects.tender_documents FOR INSERT TO authenticated
  WITH CHECK (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_documents_update ON projects.tender_documents FOR UPDATE TO authenticated
  USING (projects.user_can_manage_tender(tender_id)) WITH CHECK (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_documents_delete ON projects.tender_documents FOR DELETE TO authenticated
  USING (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_document_downloads_select ON projects.tender_document_downloads FOR SELECT TO authenticated
  USING (projects.user_can_manage_tender(tender_id));

-- WM may discard an addendum DRAFT (never a published one, never a bidder's
-- question). 00244 granted no DELETE on clarifications; this is the one case.
CREATE POLICY tender_clarifications_delete_wm ON projects.tender_clarifications FOR DELETE TO authenticated
  USING (projects.user_can_manage_tender(tender_id) AND kind = 'addendum' AND published_at IS NULL);
GRANT DELETE ON projects.tender_clarifications TO authenticated;

-- Site scope (00238): same shape as the other post-00238 tender tables. The
-- coverage check (scripts/db/assert-site-scope-coverage.sql) requires a policy
-- by this name; bidders have no permissive policy here, so no participant arm.
CREATE POLICY site_scope ON projects.tender_documents AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(public.site_project_of_tender(tender_id)))
  WITH CHECK (public.user_has_project_access(public.site_project_of_tender(tender_id)));
CREATE POLICY site_scope ON projects.tender_document_downloads AS RESTRICTIVE FOR ALL
  USING (public.user_has_project_access(public.site_project_of_tender(tender_id)))
  WITH CHECK (public.user_has_project_access(public.site_project_of_tender(tender_id)));

-- ── 7. Grants ───────────────────────────────────────────────────────────────
REVOKE ALL ON projects.tender_documents, projects.tender_document_downloads FROM anon, authenticated;
GRANT SELECT ON projects.tender_documents TO authenticated;
GRANT INSERT (tender_id, clarification_id, category, label, file_name, file_path, file_size, content_type, sort_order)
  ON projects.tender_documents TO authenticated;
GRANT UPDATE (label, category, sort_order) ON projects.tender_documents TO authenticated;
GRANT DELETE ON projects.tender_documents TO authenticated;
GRANT SELECT ON projects.tender_document_downloads TO authenticated;
GRANT ALL ON projects.tender_documents, projects.tender_document_downloads TO service_role;

REVOKE ALL ON FUNCTION projects.tender_documents_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.tender_documents_guard() FROM anon, authenticated;
REVOKE ALL ON FUNCTION projects.tender_document_downloads_bind() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.tender_document_downloads_bind() FROM anon, authenticated;
REVOKE ALL ON FUNCTION projects.tender_document_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_document_visible(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_portal_documents(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_portal_documents(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_log_document_download(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_log_document_download(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION projects.tender_portal_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION projects.tender_portal_summary(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- @verify:begin
-- table: projects.tender_documents
-- table: projects.tender_document_downloads
-- column: projects.tenders.reference
-- column: projects.tenders.site_inspection
-- column: projects.tenders.queries_close_at
-- column: projects.tenders.validity_days
-- column: projects.tenders.contact_email
-- constraint: tenders_validity_days_range ON projects.tenders
-- constraint: tenders_contact_email_shape ON projects.tenders
-- trigger: tender_documents_guard ON projects.tender_documents
-- trigger: tender_document_downloads_bind ON projects.tender_document_downloads
-- function: projects.tenders_status_guard()
-- function: projects.tender_documents_guard()
-- function: projects.tender_document_downloads_bind()
-- function: projects.tender_document_visible(uuid)
-- function: projects.tender_portal_documents(uuid)
-- function: projects.tender_log_document_download(uuid)
-- function: projects.tender_portal_summary(uuid)
-- policy: tender_documents_select ON projects.tender_documents
-- policy: tender_clarifications_delete_wm ON projects.tender_clarifications
-- policy: site_scope ON projects.tender_documents RESTRICTIVE
-- policy: site_scope ON projects.tender_document_downloads RESTRICTIVE
-- sql: (SELECT prosrc LIKE '%particulars are frozen%' FROM pg_proc WHERE oid = 'projects.tenders_status_guard()'::regprocedure)
-- sql: (SELECT pg_get_function_result('projects.tender_portal_summary(uuid)'::regprocedure) LIKE '%validity_days integer%')
-- sql: (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class WHERE oid IN ('projects.tender_documents'::regclass, 'projects.tender_document_downloads'::regclass))
-- sql: (SELECT NOT has_table_privilege('authenticated', 'projects.tender_document_downloads'::regclass, 'INSERT'))
-- sql: (SELECT NOT has_table_privilege('authenticated', 'projects.tender_document_downloads'::regclass, 'UPDATE'))
-- grant_absent: anon SELECT ON projects.tender_documents
-- grant_absent: anon EXECUTE ON projects.tender_portal_documents(uuid)
-- grant_absent: anon EXECUTE ON projects.tender_log_document_download(uuid)
-- grant_absent: anon EXECUTE ON projects.tender_document_visible(uuid)
-- @verify:end
