-- Assertions for the standards topics + conditions migration. Rolled back:
--   scripts/db/dry-run-migration.sh <migration.sql> scripts/db/assert-standards-topics-conditions.sql
CREATE TEMP TABLE _r (k text, v boolean) ON COMMIT DROP;

DO $$
DECLARE v_std UUID; v_tbl UUID;
BEGIN
  INSERT INTO _r VALUES ('every_table_has_a_topic',
    NOT EXISTS (SELECT 1 FROM cable_schedule.sans_tables WHERE topic IS NULL));
  INSERT INTO _r VALUES ('legacy_ratings_topic',
    (SELECT topic = 'cable_ratings' FROM cable_schedule.sans_tables WHERE code = 'TABLE_6_2'));
  INSERT INTO _r VALUES ('legacy_derating_topic',
    (SELECT topic = 'derating' FROM cable_schedule.sans_tables WHERE code = 'TABLE_6_3_3'));
  INSERT INTO _r VALUES ('legacy_kfactor_topic',
    (SELECT topic = 'earthing_protection' FROM cable_schedule.sans_tables WHERE code = 'TABLE_6_9'));
  INSERT INTO _r VALUES ('extracted_have_conditions_array',
    NOT EXISTS (SELECT 1 FROM cable_schedule.sans_tables WHERE provenance = 'extracted'
                 AND coalesce(jsonb_typeof(conditions), '') <> 'array'));

  SELECT id INTO v_std FROM cable_schedule.ref_standards WHERE code = 'SANS 10142-1' AND edition = '3.1';
  BEGIN
    INSERT INTO cable_schedule.sans_tables (code, title, standard, columns, provenance, standard_id, clause, conditions)
    VALUES ('ZZ_NO_TOPIC', 'p', 'p', '[]', 'extracted', v_std, 'Table 1.1', '[]');
    INSERT INTO _r VALUES ('extracted_without_topic_REFUSED', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES ('extracted_without_topic_REFUSED', true);
  END;
  BEGIN
    INSERT INTO cable_schedule.sans_tables (code, title, standard, columns, provenance, standard_id, clause, topic)
    VALUES ('ZZ_NO_COND', 'p', 'p', '[]', 'extracted', v_std, 'Table 1.1', 'derating');
    INSERT INTO _r VALUES ('extracted_without_conditions_REFUSED', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES ('extracted_without_conditions_REFUSED', true);
  END;
  BEGIN
    INSERT INTO cable_schedule.sans_tables (code, title, standard, columns, topic)
    VALUES ('ZZ_BAD_TOPIC', 'p', 'p', '[]', 'kitchens');
    INSERT INTO _r VALUES ('unknown_topic_REFUSED', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES ('unknown_topic_REFUSED', true);
  END;
  BEGIN
    INSERT INTO cable_schedule.sans_tables (code, title, standard, columns, provenance, standard_id, clause, topic, conditions)
    VALUES ('ZZ_BAD_COND', 'p', 'p', '[]', 'extracted', v_std, 'Table 1.1', 'derating', '[{"label":"Ambient"}]');
    INSERT INTO _r VALUES ('condition_without_page_REFUSED', false);
  EXCEPTION WHEN check_violation THEN INSERT INTO _r VALUES ('condition_without_page_REFUSED', true);
  END;
  INSERT INTO cable_schedule.sans_tables (code, title, standard, columns, provenance, standard_id, clause, topic, conditions)
  VALUES ('ZZ_OK', 'p', 'p', '[]', 'extracted', v_std, 'Table 1.1', 'derating',
          '[{"key":"ambient_c","label":"Ambient temperature","unit":"°C","value":"30","page_pdf":122,"page_printed":118}]')
  RETURNING id INTO v_tbl;
  INSERT INTO _r VALUES ('control_cited_condition_accepted', v_tbl IS NOT NULL);
END $$;

SELECT * FROM (VALUES
  ('every reference table has a topic',                       (SELECT v FROM _r WHERE k='every_table_has_a_topic')),
  ('legacy PVC Cu table is under cable ratings',              (SELECT v FROM _r WHERE k='legacy_ratings_topic')),
  ('legacy grouping table is under derating',                 (SELECT v FROM _r WHERE k='legacy_derating_topic')),
  ('legacy k-factor table is under earthing and protection',  (SELECT v FROM _r WHERE k='legacy_kfactor_topic')),
  ('every extracted table carries a conditions array',        (SELECT v FROM _r WHERE k='extracted_have_conditions_array')),
  ('an extracted table without a topic is refused',           (SELECT v FROM _r WHERE k='extracted_without_topic_REFUSED')),
  ('an extracted table without conditions is refused',        (SELECT v FROM _r WHERE k='extracted_without_conditions_REFUSED')),
  ('an unknown topic is refused',                             (SELECT v FROM _r WHERE k='unknown_topic_REFUSED')),
  ('a condition without its page is refused',                 (SELECT v FROM _r WHERE k='condition_without_page_REFUSED')),
  ('CONTROL: a cited condition is accepted',                  (SELECT v FROM _r WHERE k='control_cited_condition_accepted'))
) AS t("check", ok);
