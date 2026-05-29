-- 00110_drop_contractor_companies.sql
--
-- Final deprecation step: drop the `projects.contractor_companies` table and
-- the `public.user_organisations.contractor_company_id` column. Both were
-- introduced by 00108 and superseded by the sub-org model in 00109.
--
-- IMPORTANT: this migration must be applied ONLY after the web code stops
-- referencing the table / column. In the PR-A rollout this happens in Task 14
-- right before pushing the new code — the deploy window is then constrained
-- to Vercel build time (~3 min) rather than the duration of the entire PR.
--
-- On prod (cbskbnvvgcybmfikxgky) the table was empty at migration time and
-- the column was all NULLs — no data loss either way.
--
-- Reversible: re-apply 00108_contractor_companies.sql.

ALTER TABLE public.user_organisations DROP COLUMN IF EXISTS contractor_company_id;
DROP TABLE IF EXISTS projects.contractor_companies CASCADE;
