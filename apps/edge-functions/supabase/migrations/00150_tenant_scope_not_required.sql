-- 00150: tenant scope "not required" override.
--
-- For national tenants where the landlord covers the FULL scope of work, no
-- scope document is ever issued — yet the step is complete. The document-derived
-- scope_status (00118 trigger: awaited/received) cannot represent that, because
-- it only ever flips to 'received' when a scope document revision exists.
--
-- This column is ORTHOGONAL to scope_status: the 00118 trigger never writes it,
-- so the two cannot conflict (spec §3.3 removed the manual scope_status toggle
-- precisely because it fought the trigger). Effective completion is computed in
-- app code as scope_status = 'received' OR scope_not_required.

ALTER TABLE structure.tenant_details
    ADD COLUMN IF NOT EXISTS scope_not_required BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
