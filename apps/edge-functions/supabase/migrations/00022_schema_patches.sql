-- ---------------------------------------------------------------------------
-- Migration 00022: Schema patches
-- Adds missing columns identified during Sprint 5 build
-- ---------------------------------------------------------------------------

-- organisations: add type, vat_number, popia-related fields
ALTER TABLE public.organisations
    ADD COLUMN IF NOT EXISTS type                TEXT NOT NULL DEFAULT 'contractor'
        CHECK (type IN ('contractor', 'subcontractor', 'developer', 'consulting', 'supplier', 'other')),
    ADD COLUMN IF NOT EXISTS vat_number          TEXT,
    ADD COLUMN IF NOT EXISTS website             TEXT,
    ADD COLUMN IF NOT EXISTS phone               TEXT,
    ADD COLUMN IF NOT EXISTS address             TEXT,
    ADD COLUMN IF NOT EXISTS city                TEXT;

-- Rename registration_no → keep both for compatibility
-- organisations already has registration_no; add registration_number as alias
ALTER TABLE public.organisations
    ADD COLUMN IF NOT EXISTS registration_number TEXT;

-- Sync existing data
UPDATE public.organisations
    SET registration_number = registration_no
    WHERE registration_number IS NULL AND registration_no IS NOT NULL;

-- profiles: add popia_consent_at if not present
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS popia_consent_at TIMESTAMPTZ;

-- profiles: add field_worker role support (user_organisations allows it via check)
-- Current role check includes contractor — field_worker maps to contractor role
-- The role CHECK in 00001 allows: owner, admin, project_manager, contractor, inspector, supplier, client_viewer
-- field_worker and supervisor are aliases for contractor/inspector in practice
-- Extend the role enum to include them:
ALTER TABLE public.user_organisations
    DROP CONSTRAINT IF EXISTS user_organisations_role_check;

ALTER TABLE public.user_organisations
    ADD CONSTRAINT user_organisations_role_check
    CHECK (role IN (
        'owner', 'admin', 'project_manager', 'contractor',
        'inspector', 'supplier', 'client_viewer',
        'field_worker', 'supervisor', 'viewer', 'member'
    ));

-- organisations: add slug default if missing (was required NOT NULL in 00001)
-- Applications may have inserted without slug — add unique slug generation function
CREATE OR REPLACE FUNCTION public.ensure_org_slug()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.slug IS NULL OR NEW.slug = '' THEN
        NEW.slug := lower(regexp_replace(NEW.name, '[^a-zA-Z0-9]', '-', 'g'))
                    || '-' || substr(gen_random_uuid()::text, 1, 8);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organisations_ensure_slug ON public.organisations;

CREATE TRIGGER organisations_ensure_slug
    BEFORE INSERT ON public.organisations
    FOR EACH ROW EXECUTE FUNCTION public.ensure_org_slug();

-- Marketplace: refresh function for supplier rating summary
CREATE OR REPLACE FUNCTION marketplace.refresh_supplier_rating_summary()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY marketplace.supplier_rating_summary;
END;
$$;
