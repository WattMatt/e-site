-- ============================================================================
-- 00070 — COC validations audit table
-- ============================================================================
-- Stores the deterministic output of the `validate-coc` edge function — one
-- row per (certificate, rule_code). Append-only audit: the edge function
-- DELETEs prior rows for the certificate then re-INSERTs the fresh batch
-- (idempotent re-runs).
--
-- The 8 rule codes (catalogue Part 4 — SANS 10142-1:2020):
--   EARTH-001 (8.4)            Earth-electrode resistance <= 5 Ω
--   LOOP-001  (8.5)            Earth-loop impedance <= Zs(breaker class)
--   INSUL-001 (8.6)            Insulation resistance >= 1.0 MΩ @ 500 V
--   RCD-001   (8.8)            RCD trip times — 1×: 0-300 ms · 5×: <= 40 ms
--   PSCC-001  (8.3)            Prospective short-circuit current >= 1 kA
--   POL-001   (8.7)            Polarity & continuity pass per circuit
--   REG-001   (issuer)         Registered person reg # present
--   CERT-INCOMPLETE-001 (form) All mandatory fields populated
--
-- RLS: SELECT scoped via inspections.user_has_inspection_read(_inspection_id).
-- INSERT/DELETE flow only through the validate-coc edge function (service-role).
-- ============================================================================

BEGIN;

CREATE TABLE inspections.coc_validations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_id     UUID NOT NULL REFERENCES inspections.certificates(id) ON DELETE CASCADE,
  inspection_id      UUID NOT NULL REFERENCES inspections.inspections(id) ON DELETE CASCADE,
  rule_code          TEXT NOT NULL,
  sans_clause        TEXT NULL,
  rule_label         TEXT NOT NULL,
  result             TEXT NOT NULL CHECK (result IN ('pass','fail','not_applicable','insufficient_data')),
  measured_value     TEXT NULL,
  threshold          TEXT NULL,
  failure_reason     TEXT NULL,
  validated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  validator_version  TEXT NOT NULL DEFAULT 'v1'
);

CREATE INDEX idx_coc_validations_cert ON inspections.coc_validations (certificate_id);
CREATE INDEX idx_coc_validations_inspection ON inspections.coc_validations (inspection_id);

ALTER TABLE inspections.coc_validations ENABLE ROW LEVEL SECURITY;

CREATE POLICY coc_validations_select ON inspections.coc_validations FOR SELECT TO authenticated
  USING (inspections.user_has_inspection_read(inspection_id));

-- INSERT/UPDATE/DELETE only via service-role from the validate-coc edge
-- function — no policy granted to `authenticated`.

GRANT SELECT ON inspections.coc_validations TO authenticated;

COMMIT;
