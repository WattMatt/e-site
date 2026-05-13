-- =============================================================================
-- Migration 00049 — Supplier invoices (procurement handoff to AP)
-- =============================================================================
-- Background:
--   Phase 3 slice 2 — closes the loop from GRN to "supplier paid". One row
--   per supplier invoice; multiple rows possible per procurement_item if
--   the supplier bills in stages.
--
-- Files (the invoice PDF) live in the `quotes` storage bucket — same RLS,
-- same MIME allowlist, same org-prefixed path convention. Reusing it
-- avoids another bucket + a 4th set of identical RLS policies.
--
-- Schema delta:
--   + projects.supplier_invoices
--     - procurement_item_id FK (NOT NULL)
--     - invoice_number, supplier_invoice_date
--     - amount, currency, vat_amount (optional)
--     - status enum: received / approved / paid / disputed
--     - paid_at (TIMESTAMPTZ), payment_reference
--     - file_path (in `quotes` bucket — reuse)
--   Indexes on procurement_item_id + status.
-- =============================================================================

CREATE TABLE IF NOT EXISTS projects.supplier_invoices (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    procurement_item_id     UUID NOT NULL REFERENCES projects.procurement_items(id) ON DELETE CASCADE,
    organisation_id         UUID NOT NULL REFERENCES public.organisations(id),
    invoice_number          TEXT NOT NULL,
    supplier_invoice_date   DATE NOT NULL,
    amount                  NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    vat_amount              NUMERIC(12,2) CHECK (vat_amount IS NULL OR vat_amount >= 0),
    currency                TEXT NOT NULL DEFAULT 'ZAR',
    status                  TEXT NOT NULL DEFAULT 'received'
                            CHECK (status IN ('received', 'approved', 'paid', 'disputed')),
    paid_at                 TIMESTAMPTZ,
    payment_reference       TEXT,
    notes                   TEXT,
    -- Lives in the `quotes` bucket — see migration 00046. Path convention:
    -- <org_id>/<procurement_item_id>/<random>.<ext>
    file_path               TEXT,
    file_size_bytes         BIGINT,
    file_mime               TEXT,
    received_by             UUID REFERENCES public.profiles(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Same invoice can't be recorded twice for the same item.
    UNIQUE (procurement_item_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_item
    ON projects.supplier_invoices(procurement_item_id);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_org_status
    ON projects.supplier_invoices(organisation_id, status)
    WHERE status IN ('received', 'approved');

CREATE TRIGGER supplier_invoices_updated_at
    BEFORE UPDATE ON projects.supplier_invoices
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE projects.supplier_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members and project-scoped client viewers can view supplier invoices"
    ON projects.supplier_invoices FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1
                FROM projects.procurement_items pi
                JOIN projects.project_members pm ON pm.project_id = pi.project_id
                WHERE pi.id = supplier_invoices.procurement_item_id
                  AND pm.user_id = auth.uid()
                  AND pm.is_active = TRUE
            )
        )
    );

CREATE POLICY "Org members can insert supplier invoices"
    ON projects.supplier_invoices FOR INSERT
    WITH CHECK (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can update supplier invoices"
    ON projects.supplier_invoices FOR UPDATE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

CREATE POLICY "Org members can delete supplier invoices"
    ON projects.supplier_invoices FOR DELETE
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer(organisation_id)
    );

NOTIFY pgrst, 'reload schema';
