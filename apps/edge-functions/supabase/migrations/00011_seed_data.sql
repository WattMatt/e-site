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

-- Seed catalogue categories for marketplace browsing
INSERT INTO suppliers.suppliers (id, name, categories, is_verified)
VALUES
    ('00000000-0000-0000-0000-000000000010', 'Voltex (Demo)', ARRAY['electrical'], TRUE),
    ('00000000-0000-0000-0000-000000000011', 'Acme Cables (Demo)', ARRAY['electrical', 'cable'], TRUE)
ON CONFLICT DO NOTHING;
