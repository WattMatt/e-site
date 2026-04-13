-- =============================================================================
-- Migration: 00005_suppliers_schema.sql
-- Description: suppliers + marketplace schemas — suppliers, organisation_suppliers,
--              supplier_users, supplier_contacts, catalogue_items, orders.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- suppliers.suppliers  (supplier organisations — may also be an org record)
-- ---------------------------------------------------------------------------
CREATE TABLE suppliers.suppliers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID REFERENCES public.organisations(id), -- null = external supplier
    name            TEXT NOT NULL,
    trading_name    TEXT,
    registration_no TEXT,
    vat_number      TEXT,
    province        TEXT,
    address         TEXT,
    website         TEXT,
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    categories      TEXT[] NOT NULL DEFAULT '{}', -- ['electrical', 'mechanical', 'civil']
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER suppliers_updated_at
    BEFORE UPDATE ON suppliers.suppliers
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- suppliers.organisation_suppliers  (contractor ↔ supplier relationship)
-- ---------------------------------------------------------------------------
CREATE TABLE suppliers.organisation_suppliers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contractor_org_id   UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    supplier_id         UUID NOT NULL REFERENCES suppliers.suppliers(id) ON DELETE CASCADE,
    account_number      TEXT,
    credit_limit        NUMERIC(12,2),
    currency            TEXT NOT NULL DEFAULT 'ZAR',
    payment_terms_days  INTEGER,
    is_preferred        BOOLEAN NOT NULL DEFAULT FALSE,
    linked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contractor_org_id, supplier_id)
);

-- ---------------------------------------------------------------------------
-- suppliers.supplier_contacts
-- ---------------------------------------------------------------------------
CREATE TABLE suppliers.supplier_contacts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id UUID NOT NULL REFERENCES suppliers.suppliers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    role        TEXT,
    email       TEXT,
    phone       TEXT,
    is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill FK on procurement_items now that suppliers.suppliers exists
ALTER TABLE projects.procurement_items
    ADD CONSTRAINT procurement_items_supplier_fk
    FOREIGN KEY (supplier_id) REFERENCES suppliers.suppliers(id);

-- ---------------------------------------------------------------------------
-- marketplace.catalogue_items
-- ---------------------------------------------------------------------------
CREATE TABLE marketplace.catalogue_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id         UUID NOT NULL REFERENCES suppliers.suppliers(id) ON DELETE CASCADE,
    supplier_org_id     UUID REFERENCES public.organisations(id), -- null = external supplier
    sku                 TEXT,
    name                TEXT NOT NULL,
    description         TEXT,
    category            TEXT NOT NULL,
    unit                TEXT NOT NULL DEFAULT 'each',
    unit_price          NUMERIC(10,2) NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'ZAR',
    min_order_qty       INTEGER NOT NULL DEFAULT 1,
    lead_time_days      INTEGER,
    marketplace_visible BOOLEAN NOT NULL DEFAULT FALSE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER catalogue_items_updated_at
    BEFORE UPDATE ON marketplace.catalogue_items
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- marketplace.orders
-- ---------------------------------------------------------------------------
CREATE TABLE marketplace.orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contractor_org_id   UUID NOT NULL REFERENCES public.organisations(id),
    supplier_org_id     UUID REFERENCES public.organisations(id),
    supplier_id         UUID NOT NULL REFERENCES suppliers.suppliers(id),
    project_id          UUID REFERENCES projects.projects(id),
    status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'submitted', 'confirmed', 'in_transit', 'delivered', 'invoiced', 'cancelled')),
    total_amount        NUMERIC(14,2),
    currency            TEXT NOT NULL DEFAULT 'ZAR',
    -- Paystack payment fields
    paystack_reference  TEXT UNIQUE,
    paystack_split_code TEXT, -- Transaction Splits API
    commission_rate     NUMERIC(5,4), -- e.g. 0.06 = 6%
    commission_amount   NUMERIC(12,2),
    payment_status      TEXT NOT NULL DEFAULT 'pending'
                        CHECK (payment_status IN ('pending', 'paid', 'refunded', 'failed')),
    paid_at             TIMESTAMPTZ,
    notes               TEXT,
    created_by          UUID NOT NULL REFERENCES public.profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER orders_updated_at
    BEFORE UPDATE ON marketplace.orders
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- marketplace.order_items
-- ---------------------------------------------------------------------------
CREATE TABLE marketplace.order_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES marketplace.orders(id) ON DELETE CASCADE,
    catalogue_item_id UUID REFERENCES marketplace.catalogue_items(id),
    description     TEXT NOT NULL,
    quantity        NUMERIC NOT NULL,
    unit            TEXT NOT NULL DEFAULT 'each',
    unit_price      NUMERIC(10,2) NOT NULL,
    line_total      NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
