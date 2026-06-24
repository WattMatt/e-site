-- =============================================================================
-- Migration: 00011_seed_data.sql
-- Description: Development seed data. DO NOT run in production.
--              Creates a demo org, two users, and sample project data.
-- =============================================================================

-- NOTE: This seed runs AFTER auth users are created via Supabase Auth API.
-- In local dev: supabase db seed
-- In CI: skipped unless SEED_DATA=true

-- Demo org
INSERT INTO public.organisations (id, name, slug, province, subscription_tier)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Watson Mattheus Demo Co',
    'wm-demo',
    'Gauteng',
    'professional'
) ON CONFLICT DO NOTHING;

-- WM-Consulting platform-owner org. Referenced (but never inserted) by
-- 00097/00098/00125/00131/00133/00138/00139 — it is gate-exempt and owns the
-- canonical inspection templates. Must exist before 00138's org-scoped template
-- INSERTs or db:reset fails on templates_organisation_id_fkey (23503). In
-- production this row is created out-of-band and already present; here it only
-- unblocks fresh local/CI resets.
INSERT INTO public.organisations (id, name, slug, province, subscription_tier)
VALUES (
    'dddddddd-0000-0000-0000-000000000001',
    'WM Consulting',
    'wm-consulting',
    'Gauteng',
    'enterprise'
) ON CONFLICT DO NOTHING;

-- Seed catalogue categories for marketplace browsing
INSERT INTO suppliers.suppliers (id, name, categories, is_verified)
VALUES
    ('00000000-0000-0000-0000-000000000010', 'Voltex (Demo)', ARRAY['electrical'], TRUE),
    ('00000000-0000-0000-0000-000000000011', 'Acme Cables (Demo)', ARRAY['electrical', 'cable'], TRUE)
ON CONFLICT DO NOTHING;
