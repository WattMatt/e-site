-- 00118: multiple drawings per tenant — tenant_documents + revisions

-- 1) Tables
CREATE TABLE structure.tenant_documents (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id     UUID        NOT NULL REFERENCES structure.nodes(id) ON DELETE CASCADE,
    kind        TEXT        NOT NULL CHECK (kind IN ('layout','scope')),
    title       TEXT        NOT NULL,
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_documents_node_kind ON structure.tenant_documents (node_id, kind, sort_order);
CREATE TRIGGER tenant_documents_updated_at BEFORE UPDATE ON structure.tenant_documents
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE structure.tenant_document_revisions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_document_id  UUID        NOT NULL REFERENCES structure.tenant_documents(id) ON DELETE CASCADE,
    rev_label           TEXT        NOT NULL,
    storage_path        TEXT        NOT NULL,
    file_name           TEXT        NOT NULL,
    note                TEXT,
    issued_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    uploaded_by         UUID        REFERENCES auth.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_doc_revisions_doc ON structure.tenant_document_revisions (tenant_document_id, issued_at DESC);

-- 2) Status-derive function + triggers (kind-aware enums: layout not_issued/issued, scope awaited/received)
CREATE OR REPLACE FUNCTION structure.recompute_tenant_doc_status(p_node_id UUID, p_kind TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_issued_at TIMESTAMPTZ;
BEGIN
    SELECT MIN(r.issued_at) INTO v_issued_at
    FROM structure.tenant_documents d
    JOIN structure.tenant_document_revisions r ON r.tenant_document_id = d.id
    WHERE d.node_id = p_node_id AND d.kind = p_kind;
    INSERT INTO structure.tenant_details (node_id) VALUES (p_node_id) ON CONFLICT (node_id) DO NOTHING;
    IF p_kind = 'layout' THEN
        UPDATE structure.tenant_details
           SET layout_status     = CASE WHEN v_issued_at IS NOT NULL THEN 'issued' ELSE 'not_issued' END,
               layout_issued_at  = v_issued_at::date
         WHERE node_id = p_node_id;
    ELSIF p_kind = 'scope' THEN
        UPDATE structure.tenant_details
           SET scope_status = CASE WHEN v_issued_at IS NOT NULL THEN 'received' ELSE 'awaited' END
         WHERE node_id = p_node_id;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION structure.tenant_doc_revision_status_trg()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_node UUID; v_kind TEXT;
BEGIN
    SELECT node_id, kind INTO v_node, v_kind
      FROM structure.tenant_documents WHERE id = COALESCE(NEW.tenant_document_id, OLD.tenant_document_id);
    IF v_node IS NOT NULL THEN PERFORM structure.recompute_tenant_doc_status(v_node, v_kind); END IF;
    RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER tenant_doc_revision_status
    AFTER INSERT OR DELETE ON structure.tenant_document_revisions
    FOR EACH ROW EXECUTE FUNCTION structure.tenant_doc_revision_status_trg();

CREATE OR REPLACE FUNCTION structure.tenant_doc_delete_status_trg()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    PERFORM structure.recompute_tenant_doc_status(OLD.node_id, OLD.kind);
    RETURN OLD;
END $$;
CREATE TRIGGER tenant_doc_delete_status
    AFTER DELETE ON structure.tenant_documents
    FOR EACH ROW EXECUTE FUNCTION structure.tenant_doc_delete_status_trg();

-- 3) RLS — mirror tenant_details: read via user_has_project_access, write via user_can_manage_project (00085).
ALTER TABLE structure.tenant_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE structure.tenant_document_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_documents_select ON structure.tenant_documents FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM structure.nodes n WHERE n.id = node_id
                   AND public.user_has_project_access(n.project_id)
                   AND NOT public.user_is_client_viewer(n.organisation_id)));
CREATE POLICY tenant_documents_write ON structure.tenant_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM structure.nodes n WHERE n.id = node_id AND public.user_can_manage_project(n.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM structure.nodes n WHERE n.id = node_id AND public.user_can_manage_project(n.project_id)));
CREATE POLICY tenant_doc_revisions_select ON structure.tenant_document_revisions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM structure.tenant_documents d JOIN structure.nodes n ON n.id = d.node_id
                   WHERE d.id = tenant_document_id AND public.user_has_project_access(n.project_id)
                     AND NOT public.user_is_client_viewer(n.organisation_id)));
CREATE POLICY tenant_doc_revisions_write ON structure.tenant_document_revisions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM structure.tenant_documents d JOIN structure.nodes n ON n.id = d.node_id
                   WHERE d.id = tenant_document_id AND public.user_can_manage_project(n.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM structure.tenant_documents d JOIN structure.nodes n ON n.id = d.node_id
                   WHERE d.id = tenant_document_id AND public.user_can_manage_project(n.project_id)));
GRANT SELECT, INSERT, UPDATE, DELETE ON structure.tenant_documents, structure.tenant_document_revisions TO authenticated;
GRANT ALL ON structure.tenant_documents, structure.tenant_document_revisions TO service_role;

-- 4) Backfill existing single files → one document + one revision each (KEEP old columns).
INSERT INTO structure.tenant_documents (id, node_id, kind, title, sort_order)
  SELECT gen_random_uuid(), td.node_id, 'layout', 'Layout', 0
    FROM structure.tenant_details td WHERE td.layout_drawing_path IS NOT NULL;
INSERT INTO structure.tenant_document_revisions (tenant_document_id, rev_label, storage_path, file_name, issued_at)
  SELECT d.id, 'Rev A', td.layout_drawing_path,
         regexp_replace(split_part(td.layout_drawing_path, '/', -1), '^[0-9]+-', ''),
         COALESCE(td.layout_issued_at::timestamptz, now())
    FROM structure.tenant_details td
    JOIN structure.tenant_documents d ON d.node_id = td.node_id AND d.kind = 'layout'
   WHERE td.layout_drawing_path IS NOT NULL;
INSERT INTO structure.tenant_documents (id, node_id, kind, title, sort_order)
  SELECT gen_random_uuid(), td.node_id, 'scope', 'Scope of work', 0
    FROM structure.tenant_details td WHERE td.scope_document_path IS NOT NULL;
INSERT INTO structure.tenant_document_revisions (tenant_document_id, rev_label, storage_path, file_name, issued_at)
  SELECT d.id, 'Rev A', td.scope_document_path,
         regexp_replace(split_part(td.scope_document_path, '/', -1), '^[0-9]+-', ''), now()
    FROM structure.tenant_details td
    JOIN structure.tenant_documents d ON d.node_id = td.node_id AND d.kind = 'scope'
   WHERE td.scope_document_path IS NOT NULL;

NOTIFY pgrst, 'reload schema';
