-- E5: a bidder without a CIDB grading must still be able to complete their
-- company profile and submit (owner, 2026-10-12: "we cannot force them to have
-- a CIDB rating"). 00243 accepted only one grade (e.g. 7EP) and its
-- complete-profile check required cidb_grade to be set, so "Not applicable"
-- could not be saved at all.
--
-- cidb_grade now holds one of:
--   NULL                  not answered yet (a complete profile still needs an answer)
--   'N/A'                 the bidder states they hold no CIDB grading
--   '7EP' / '7EP, 6CE PE' one or more grade + class designations, comma-separated
-- The app normalises input to exactly these shapes (lib/tender/profile.ts).

ALTER TABLE projects.tender_participants DROP CONSTRAINT tender_participants_cidb_shape;
ALTER TABLE projects.tender_participants ADD CONSTRAINT tender_participants_cidb_shape
  CHECK (
    cidb_grade IS NULL
    OR cidb_grade = 'N/A'
    OR cidb_grade ~ '^[1-9][A-Z]{2}( ?PE)?(, [1-9][A-Z]{2}( ?PE)?)*$'
  );

-- @verify:begin
-- constraint: tender_participants_cidb_shape ON projects.tender_participants
-- sql: (SELECT pg_get_constraintdef(c.oid) LIKE '%N/A%' FROM pg_constraint c WHERE c.conname = 'tender_participants_cidb_shape' AND c.conrelid = 'projects.tender_participants'::regclass)
-- sql: (SELECT pg_get_constraintdef(c.oid) LIKE '%, [1-9]%' FROM pg_constraint c WHERE c.conname = 'tender_participants_cidb_shape' AND c.conrelid = 'projects.tender_participants'::regclass)
-- @verify:end
