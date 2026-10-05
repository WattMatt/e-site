-- 00224_tariff_explorer.sql
--
-- E7 (2026-10-05): the tariff explorer, TOU visuals and area-of-supply map.
-- Spec: docs/superpowers/specs/2026-10-05-tariff-explorer-design.md.
--
-- 1. READ ACCESS. 00210 gated every tariffs.* read on caller_has_any_solar_org(),
--    so an organisation without the Solar add-on read nothing. Owner decision D1
--    (2026-10-05, prompt default): the PUBLISHED library is open to every
--    signed-in organisation. Drafts (ingesting / in_review) stay admin-only.
--    The seven reference/year SELECT policies are re-created UNDER THE SAME
--    NAMES and stay PERMISSIVE, so 00210's @verify `policy:` directives still
--    hold. tariff / charge / loss_factor / sseg_rule inherit through EXISTS on
--    their parent and are unchanged. Writes are unchanged.
--
-- 2. HOLIDAY TREATMENT. Eskom bills a public holiday as Saturday or Sunday per
--    HOLIDAY and per TARIFF FAMILY (Schedule of standard prices 2026/27 p12):
--    one tariffs.holiday_rule per calendar cannot say that. tariffs.holiday_treatment
--    holds the dated rows. The Solar engine does not read it yet (follow-up);
--    the Eskom calendars carry NO holiday_rule, so the engine bills a holiday
--    as its own weekday — exact for Homeflex/Ruraflex, which the book says do
--    exactly that, and the documented approximation for the Megaflex family.
--
-- 3. ESKOM TOU CALENDAR. tariffs.tou_calendar was EMPTY in production (0 rows,
--    130 published TOU tariffs). Seeded for both Eskom licensees from the
--    2026/27 Schedule of standard prices, Figure 2 (p56), sampled hour by hour;
--    hours unchanged since 2025/26 (2025/26 schedule p8). Seasons p4.
--
-- 4. MDB CODES. tariffs.licensee.mdb_code was NULL for all 179. Seeded for 166
--    municipal/metro licensees from the reviewed mapping in
--    docs/tariffs/licensee-mdb-mapping.json (MDB 2021 local municipalities). Fills
--    NULL only.

-- ── 1. The read helper and the re-created SELECT policies ──────────────────
CREATE OR REPLACE FUNCTION public.caller_can_read_tariff_library()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT auth.uid() IS NOT NULL AND (
        EXISTS (SELECT 1 FROM public.platform_tariff_admins a WHERE a.user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.user_organisations uo
                    WHERE uo.user_id = auth.uid() AND uo.is_active));
$$;
REVOKE ALL ON FUNCTION public.caller_can_read_tariff_library() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.caller_can_read_tariff_library() FROM anon;
GRANT EXECUTE ON FUNCTION public.caller_can_read_tariff_library() TO authenticated, service_role;

DROP POLICY IF EXISTS licensee_select ON tariffs.licensee;
CREATE POLICY licensee_select ON tariffs.licensee FOR SELECT TO authenticated
    USING ((SELECT public.caller_can_read_tariff_library()));
DROP POLICY IF EXISTS licensee_alias_select ON tariffs.licensee_alias;
CREATE POLICY licensee_alias_select ON tariffs.licensee_alias FOR SELECT TO authenticated
    USING ((SELECT public.caller_can_read_tariff_library()));
DROP POLICY IF EXISTS source_document_select ON tariffs.source_document;
CREATE POLICY source_document_select ON tariffs.source_document FOR SELECT TO authenticated
    USING ((SELECT public.caller_can_read_tariff_library()));
DROP POLICY IF EXISTS tou_calendar_select ON tariffs.tou_calendar;
CREATE POLICY tou_calendar_select ON tariffs.tou_calendar FOR SELECT TO authenticated
    USING ((SELECT public.caller_can_read_tariff_library()));
DROP POLICY IF EXISTS tou_window_select ON tariffs.tou_window;
CREATE POLICY tou_window_select ON tariffs.tou_window FOR SELECT TO authenticated
    USING ((SELECT public.caller_can_read_tariff_library()));
DROP POLICY IF EXISTS holiday_rule_select ON tariffs.holiday_rule;
CREATE POLICY holiday_rule_select ON tariffs.holiday_rule FOR SELECT TO authenticated
    USING ((SELECT public.caller_can_read_tariff_library()));
-- Drafts stay admin-only. The admin arm is kept explicit (an admin need not be in any org).
DROP POLICY IF EXISTS tariff_year_select ON tariffs.tariff_year;
CREATE POLICY tariff_year_select ON tariffs.tariff_year FOR SELECT TO authenticated
    USING ((SELECT public.is_platform_tariff_admin())
           OR ((SELECT public.caller_can_read_tariff_library()) AND state IN ('published', 'superseded')));

-- ── 2. Per-holiday, per-family treatment ────────────────────────────────────
CREATE TABLE IF NOT EXISTS tariffs.holiday_treatment (
    calendar_id         UUID NOT NULL REFERENCES tariffs.tou_calendar(id) ON DELETE CASCADE,
    tariff_family       TEXT NOT NULL CHECK (btrim(tariff_family) <> ''),
    holiday_date        DATE NOT NULL,
    holiday_name        TEXT NOT NULL CHECK (btrim(holiday_name) <> ''),
    treated_as          TEXT NOT NULL CHECK (treated_as IN ('weekday', 'saturday', 'sunday')),
    source_document_id  UUID REFERENCES tariffs.source_document(id),
    source_locator      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (calendar_id, tariff_family, holiday_date)
);
ALTER TABLE tariffs.holiday_treatment ENABLE ROW LEVEL SECURITY;
ALTER TABLE tariffs.holiday_treatment FORCE ROW LEVEL SECURITY;
REVOKE ALL ON tariffs.holiday_treatment FROM PUBLIC;
REVOKE ALL ON tariffs.holiday_treatment FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON tariffs.holiday_treatment TO authenticated;
GRANT ALL ON tariffs.holiday_treatment TO service_role;
CREATE POLICY holiday_treatment_select ON tariffs.holiday_treatment FOR SELECT TO authenticated
    USING ((SELECT public.caller_can_read_tariff_library()));
CREATE POLICY holiday_treatment_insert ON tariffs.holiday_treatment FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY holiday_treatment_update ON tariffs.holiday_treatment FOR UPDATE TO authenticated
    USING ((SELECT public.is_platform_tariff_admin())) WITH CHECK ((SELECT public.is_platform_tariff_admin()));
CREATE POLICY holiday_treatment_delete ON tariffs.holiday_treatment FOR DELETE TO authenticated
    USING ((SELECT public.is_platform_tariff_admin()));

-- ── 3. The Eskom 2026/27 schedule, and both Eskom calendars ─────────────────
-- The PDF is stored at its sha256 (uploaded 2026-10-05, 7,208,097 bytes, 57 pages).
INSERT INTO tariffs.source_document (licensee_id, kind, title, financial_year, status, published_on, storage_path, sha256, page_count, url, retrieved_at)
SELECT l.id, 'eskom_schedule', 'Eskom Schedule of standard prices 2026/27', '2026/27', 'nersa_approved', DATE '2026-02-26',
       '2026-27/915a93b2d71a453855e76a3ffe2223826f9f63a89bb542d58f92249f52c4d675.pdf', '915a93b2d71a453855e76a3ffe2223826f9f63a89bb542d58f92249f52c4d675', 57,
       'https://www.eskom.co.za/distribution/wp-content/uploads/2026/03/20260226-Schedule-of-standard-prices-for-01-April-2026-Public-1.pdf', TIMESTAMPTZ '2026-10-05 08:28:00+02'
  FROM tariffs.licensee l WHERE l.name = 'Eskom'
ON CONFLICT (sha256) DO NOTHING;

-- Direct supplies from 1 April 2025; local-authority supplies from 1 July 2025.
INSERT INTO tariffs.tou_calendar (licensee_id, valid_from, valid_to, high_season_months, source, source_document_id)
SELECT l.id, v.valid_from, NULL, ARRAY[6,7,8], 'published', d.id
  FROM (VALUES ('Eskom', DATE '2025-04-01'), ('Eskom (Local Authority tariffs)', DATE '2025-07-01')) v(name, valid_from)
  JOIN tariffs.licensee l ON l.name = v.name AND l.kind = 'eskom'
  JOIN tariffs.source_document d ON d.sha256 = '915a93b2d71a453855e76a3ffe2223826f9f63a89bb542d58f92249f52c4d675'
 WHERE NOT EXISTS (SELECT 1 FROM tariffs.tou_calendar c WHERE c.licensee_id = l.id);

INSERT INTO tariffs.tou_window (calendar_id, season, day_type, start_minute, end_minute, period)
SELECT c.id, w.season, w.day_type, w.start_minute, w.end_minute, w.period
  FROM tariffs.tou_calendar c JOIN tariffs.licensee l ON l.id = c.licensee_id AND l.kind = 'eskom'
 CROSS JOIN (VALUES
        ('high', 'weekday', 0, 360, 'off_peak'),
        ('high', 'weekday', 360, 480, 'peak'),
        ('high', 'weekday', 480, 1020, 'standard'),
        ('high', 'weekday', 1020, 1200, 'peak'),
        ('high', 'weekday', 1200, 1320, 'standard'),
        ('high', 'weekday', 1320, 1440, 'off_peak'),
        ('high', 'saturday', 0, 420, 'off_peak'),
        ('high', 'saturday', 420, 720, 'standard'),
        ('high', 'saturday', 720, 1020, 'off_peak'),
        ('high', 'saturday', 1020, 1140, 'standard'),
        ('high', 'saturday', 1140, 1440, 'off_peak'),
        ('high', 'sunday', 0, 1020, 'off_peak'),
        ('high', 'sunday', 1020, 1140, 'standard'),
        ('high', 'sunday', 1140, 1440, 'off_peak'),
        ('low', 'weekday', 0, 360, 'off_peak'),
        ('low', 'weekday', 360, 420, 'standard'),
        ('low', 'weekday', 420, 540, 'peak'),
        ('low', 'weekday', 540, 1080, 'standard'),
        ('low', 'weekday', 1080, 1260, 'peak'),
        ('low', 'weekday', 1260, 1320, 'standard'),
        ('low', 'weekday', 1320, 1440, 'off_peak'),
        ('low', 'saturday', 0, 420, 'off_peak'),
        ('low', 'saturday', 420, 720, 'standard'),
        ('low', 'saturday', 720, 1080, 'off_peak'),
        ('low', 'saturday', 1080, 1200, 'standard'),
        ('low', 'saturday', 1200, 1440, 'off_peak'),
        ('low', 'sunday', 0, 1080, 'off_peak'),
        ('low', 'sunday', 1080, 1200, 'standard'),
        ('low', 'sunday', 1200, 1440, 'off_peak')
       ) w(season, day_type, start_minute, end_minute, period)
 WHERE NOT EXISTS (SELECT 1 FROM tariffs.tou_window x WHERE x.calendar_id = c.id);

-- Megaflex family: WEPS, Megaflex, Megaflex Gen, Municflex, Miniflex (p12). Homeflex,
-- Ruraflex, Ruraflex Gen and Nightsave Rural bill the actual weekday: no rows.
INSERT INTO tariffs.holiday_treatment (calendar_id, tariff_family, holiday_date, holiday_name, treated_as, source_document_id, source_locator)
SELECT c.id, f.family, h.holiday_date, h.holiday_name, h.treated_as, c.source_document_id,
       jsonb_build_object('page', 12, 'label', 'Treatment of public holidays')
  FROM tariffs.tou_calendar c JOIN tariffs.licensee l ON l.id = c.licensee_id AND l.kind = 'eskom'
 CROSS JOIN (VALUES ('WEPS'), ('Megaflex'), ('Megaflex Gen'), ('Municflex'), ('Miniflex')) f(family)
 CROSS JOIN (VALUES
        (DATE '2026-04-03', 'Good Friday', 'sunday'),
        (DATE '2026-04-06', 'Family Day', 'sunday'),
        (DATE '2026-04-27', 'Freedom Day', 'saturday'),
        (DATE '2026-05-01', 'Workers Day', 'saturday'),
        (DATE '2026-06-16', 'Youth Day', 'saturday'),
        (DATE '2026-08-09', 'National Women''s Day', 'sunday'),
        (DATE '2026-08-10', 'Public Holiday', 'saturday'),
        (DATE '2026-09-24', 'Heritage Day', 'saturday'),
        (DATE '2026-12-16', 'Day of Reconciliation', 'saturday'),
        (DATE '2026-12-25', 'Christmas Day', 'sunday'),
        (DATE '2026-12-26', 'Day of Goodwill', 'sunday'),
        (DATE '2027-01-01', 'New Year''s Day', 'sunday'),
        (DATE '2027-03-21', 'Human Rights Day', 'sunday'),
        (DATE '2027-03-22', 'Public Holiday', 'saturday'),
        (DATE '2027-03-26', 'Good Friday', 'sunday'),
        (DATE '2027-03-29', 'Family Day', 'sunday'),
        (DATE '2027-04-27', 'Freedom Day', 'saturday'),
        (DATE '2027-05-01', 'Worker''s Day', 'saturday'),
        (DATE '2027-06-16', 'Youth Day', 'saturday')
       ) h(holiday_date, holiday_name, treated_as)
ON CONFLICT DO NOTHING;

-- ── 4. MDB codes ────────────────────────────────────────────────────────────
UPDATE tariffs.licensee l SET mdb_code = v.mdb_code, updated_at = NOW()
  FROM (VALUES
        ('4f5a5386-509a-4903-bfc1-690c06302699'::uuid, 'EC124'),
        ('98052ce6-c649-4736-a9d0-702c36c405f8'::uuid, 'EC102'),
        ('d34f161b-0faf-4983-8ca1-7dd1ad3b7be2'::uuid, 'BUF'),
        ('a3a6d0fd-17e1-4ad6-a338-d1bd2f38a65b'::uuid, 'EC101'),
        ('e0ab0973-6a73-4da4-8676-fe8b1fa6134e'::uuid, 'EC141'),
        ('e391b6ed-d986-449e-a4e1-506b43083584'::uuid, 'EC136'),
        ('179ade63-9dd8-4959-b108-31876979015a'::uuid, 'EC139'),
        ('76d68b06-51fe-4014-b005-a76f1c40a6f5'::uuid, 'EC123'),
        ('bb3770db-1cd2-403d-a135-08418a51acdd'::uuid, 'EC131'),
        ('b8bff666-eaad-4689-bc1f-91e792ad13a1'::uuid, 'EC157'),
        ('c72ae57a-d339-4be5-bf9e-74a32bc2cae1'::uuid, 'EC109'),
        ('670b762f-2ae5-4967-aeab-8db52531cdf0'::uuid, 'EC108'),
        ('04d0f47c-c7b6-46a1-b87b-6bc82768c979'::uuid, 'EC104'),
        ('6fda3ecc-a077-4e98-ae1e-e1ccbf861ea7'::uuid, 'EC441'),
        ('e434cb82-dfa6-46cb-bcbd-f7ea78296563'::uuid, 'EC443'),
        ('b0be7132-9fe9-42e5-865f-4cfd8537a2a7'::uuid, 'EC105'),
        ('823948ae-c052-4b59-ae2c-65aad1960e9c'::uuid, 'NMA'),
        ('72e596aa-23ed-4a2a-8e03-107935b0190c'::uuid, 'EC129'),
        ('f385de4e-d071-425b-8e23-ca8f920d1570'::uuid, 'EC138'),
        ('c8bbcccd-0864-4765-80b0-713994a9759d'::uuid, 'EC142'),
        ('6611dd4f-58ca-4ecc-adfc-0c912235debd'::uuid, 'EC106'),
        ('4446cc78-247b-4bc3-b9d1-446f23e3b1a0'::uuid, 'NC072'),
        ('347bb1b2-101e-402d-8fb1-c7babfefcbc5'::uuid, 'EC145'),
        ('69838a7c-cc9a-48ff-a842-82de8979b35a'::uuid, 'MAN'),
        ('42187da0-0c75-42b9-bf09-382db28f3392'::uuid, 'FS162'),
        ('717ff11d-54ab-420d-940a-0451ff92e204'::uuid, 'FS192'),
        ('5d486eba-cfe1-43a1-977a-9ec43d672fb5'::uuid, 'FS161'),
        ('f8259947-528f-484b-b4a3-19693be8a56a'::uuid, 'FS205'),
        ('068d9ea2-c19c-458e-8555-143d5d7837f0'::uuid, 'FS194'),
        ('4b2d4393-04dc-41d4-b259-e07594ea9847'::uuid, 'FS196'),
        ('11d7d0b2-fc59-4eba-b8ee-54de68ac591d'::uuid, 'FS181'),
        ('b357d80e-289a-4027-8063-ce14ce7ddf2d'::uuid, 'FS184'),
        ('66c2709a-7730-4a56-80b2-174ea2ca1ea7'::uuid, 'FS204'),
        ('85da9056-f614-488a-99ec-b7c9d2226a5a'::uuid, 'FS163'),
        ('bd10862f-d349-4965-a596-66059d2addd7'::uuid, 'FS201'),
        ('d63a50cf-e86e-481c-85d2-4a353ea71523'::uuid, 'FS185'),
        ('8cfc815e-80f3-4419-862a-64e9a3f12f8a'::uuid, 'FS203'),
        ('285b76ba-fe17-423c-a263-c55e65c222d3'::uuid, 'FS193'),
        ('8e919d63-27f2-40d4-96fa-b59f90fce481'::uuid, 'FS195'),
        ('23ff0015-7383-4996-aa38-267a56376354'::uuid, 'FS191'),
        ('4bb682d5-633c-44f5-85bc-ef7c1273b182'::uuid, 'FS182'),
        ('c1010685-b9a2-49b5-a1f1-83db65647a80'::uuid, 'FS183'),
        ('9d3c8e89-3196-4ec1-8d8f-6527cf9760ad'::uuid, 'EKU'),
        ('c3ce8e59-404a-47b8-a6a7-3c47c519d77b'::uuid, 'TSH'),
        ('5558d88f-6b99-4d91-847d-63fc16b47d63'::uuid, 'JHB'),
        ('9db491bc-2af1-4965-8e8f-4b68277d3075'::uuid, 'GT421'),
        ('cfd4e801-e32b-4634-8285-42c77686901b'::uuid, 'GT423'),
        ('40b83cbd-0419-4d58-b988-e52af3be4f92'::uuid, 'GT484'),
        ('2e8793a1-06af-4c4a-b59c-b889d4ff13f6'::uuid, 'GT422'),
        ('6796d610-f6cd-4c36-9313-b36262b046c0'::uuid, 'GT481'),
        ('0ad5714c-77c4-4aaa-a710-6e8163759506'::uuid, 'GT485'),
        ('c57b8860-448c-4709-801a-90a7176408e8'::uuid, 'KZN263'),
        ('44320c25-94e0-4527-ae5d-69641f37cfb4'::uuid, 'KZN238'),
        ('b6de93bd-2c93-472d-ad18-8d4609395bb6'::uuid, 'KZN282'),
        ('3c83ace0-52c6-4f81-a5b3-8afdb24e8255'::uuid, 'KZN261'),
        ('1f0b369f-182e-4f10-9e85-5334dfe4c2c1'::uuid, 'KZN253'),
        ('62deb34f-e979-429e-bd01-ed9e6fb55da9'::uuid, 'KZN241'),
        ('3a8ea740-cba2-499b-a725-e1e12603238f'::uuid, 'ETH'),
        ('3187950d-a318-4596-ac75-491b43dad4d2'::uuid, 'KZN433'),
        ('224b38b9-d98c-4c9d-b01c-3608e4f1d709'::uuid, 'KZN237'),
        ('200372c5-9cfc-4ef1-9e12-db45f733953f'::uuid, 'KZN292'),
        ('272a2d27-8d66-41ba-94cb-56fa0faf13f9'::uuid, 'KZN291'),
        ('72d7a73e-92d6-404c-af85-c3059a00b7ab'::uuid, 'KZN223'),
        ('da9fc0d9-d3f2-464d-b2f4-c9e724fd8144'::uuid, 'KZN225'),
        ('7915efcd-4cfe-4db6-8aad-c39afa15221c'::uuid, 'KZN285'),
        ('e7c6f485-8986-42d5-ab2a-391e0c24606d'::uuid, 'KZN252'),
        ('21c21e2a-fbc1-4a1e-be75-9994ac707083'::uuid, 'KZN286'),
        ('06e293e5-0f68-4edb-a166-b9bba7af2a4b'::uuid, 'KZN242'),
        ('9ac9ed96-7b80-46be-b490-27ae936831cb'::uuid, 'KZN216'),
        ('337e15d1-d43b-494a-9d16-da826c1a2ac2'::uuid, 'KZN266'),
        ('27c3e7a9-9b25-480c-a92d-d94795fd6eb5'::uuid, 'KZN284'),
        ('6572ab8b-b294-4338-ae0d-cfee84bc32f3'::uuid, 'KZN222'),
        ('18c5b37d-4bb9-4d6b-b893-9d0acfe540ac'::uuid, 'KZN214'),
        ('f70db79b-492d-4524-a37e-d0a1eb3dc2fb'::uuid, 'KZN245'),
        ('02a97e70-e329-4450-bc2e-0321e0094536'::uuid, 'KZN262'),
        ('ce3c92df-62a1-48fd-83bc-d8e4a53324f8'::uuid, 'LIM334'),
        ('cf83209a-e514-4ce5-9e63-9faa0f3984ef'::uuid, 'LIM366'),
        ('ac26c8f6-ee0c-411c-bb8c-dbe2c1fd1cd8'::uuid, 'LIM351'),
        ('b398bf7a-9a3c-4115-a1b6-8f4f306da53c'::uuid, 'LIM472'),
        ('79faecc1-38c1-4cc2-ac91-56d70b2e7238'::uuid, 'LIM471'),
        ('8232987b-7d27-470e-aec4-65edb13641cd'::uuid, 'LIM332'),
        ('6ff67ca0-216a-48be-9130-b4bef9042219'::uuid, 'LIM333'),
        ('5ab4456d-065d-4de1-b1dc-6f39bd693786'::uuid, 'LIM362'),
        ('c911d090-bb08-4a6a-8e4b-c8c6e0183016'::uuid, 'LIM344'),
        ('fdeefa1f-f34e-43a1-bdbd-c754e4395cbc'::uuid, 'LIM368'),
        ('ad298a06-b5cd-4283-bcac-ce0d3230e0b0'::uuid, 'LIM367'),
        ('1f19396d-0da5-4d35-99fa-d7c801d07e8a'::uuid, 'LIM353'),
        ('dda1eb81-6dda-4649-ac20-ceb4df7ccca3'::uuid, 'LIM341'),
        ('9c4606bf-16de-437b-a289-8cb1bbeebd86'::uuid, 'LIM354'),
        ('784611f0-9ee7-49e0-b412-718391a7f874'::uuid, 'LIM361'),
        ('894625cf-d19f-4d2b-af37-594d9a9acfec'::uuid, 'MP301'),
        ('accad833-a0d5-4ae6-b896-c399991c3244'::uuid, 'MP326'),
        ('cea75dc1-7ae8-452d-bdf2-b12927f289eb'::uuid, 'MP306'),
        ('424fd50c-944b-4789-bc7b-7c82294f15eb'::uuid, 'MP304'),
        ('da8d15a4-49bc-4a0b-8c16-89f37973c1dd'::uuid, 'MP314'),
        ('bd1659a4-346e-4c65-bbd5-cb22481673fa'::uuid, 'MP312'),
        ('10e64db7-3a83-4371-8854-8341f0613367'::uuid, 'MP307'),
        ('8e13c0bf-900d-4dcc-bc27-7578eaee461d'::uuid, 'MP305'),
        ('31b6ca9b-af44-42a5-b034-011b80308637'::uuid, 'MP303'),
        ('23d0a9c7-2ee2-4fca-81f6-8fde7d8a7d56'::uuid, 'MP302'),
        ('53b8170c-a12e-4483-9834-b972ddc6570e'::uuid, 'MP324'),
        ('10fba053-0e0e-4270-83ca-c0fa3fefaff1'::uuid, 'MP313'),
        ('e84a0d07-ed24-46db-87d9-f87a3d513139'::uuid, 'MP321'),
        ('cf0a922d-a962-4f97-8620-9a3fa75d528a'::uuid, 'MP311'),
        ('452e9fb5-6a20-4b24-b038-fb7899e3e705'::uuid, 'NC087'),
        ('4e1c7b7e-52e3-4210-acf1-8330e76ad61d'::uuid, 'NC092'),
        ('98d51bc2-314a-4759-89ba-88bad92000fd'::uuid, 'NC073'),
        ('932d410d-e152-4bea-b6c2-345e25f591ef'::uuid, 'NC452'),
        ('fb263e8a-eec7-4244-a13e-12be8f6d0525'::uuid, 'NC453'),
        ('23ee6247-ba88-439a-9066-3735d0794705'::uuid, 'NC065'),
        ('023b5d53-2149-4c4f-907f-e84d2e261946'::uuid, 'NC451'),
        ('8cefe0a2-ef4e-434d-834e-b069711515ba'::uuid, 'NC082'),
        ('304215cc-76cd-41c4-9ae0-b8358bd1c1bb'::uuid, 'NC064'),
        ('939d14c7-a36d-4406-98f6-b7abf289c315'::uuid, 'NC074'),
        ('b79d425e-e537-4f52-acae-aefa2e3ab466'::uuid, 'NC066'),
        ('1bfd841c-e653-46cc-a3eb-5b32c97cb0ea'::uuid, 'NC086'),
        ('ea010591-ac05-4dfb-891a-f597a55f3144'::uuid, 'NC067'),
        ('f30dc123-b79f-4419-b787-c861cc9659c9'::uuid, 'NC093'),
        ('69e50736-27be-4943-a64b-a8d0cd60cceb'::uuid, 'NC062'),
        ('4afead26-c84a-4a97-884e-25bcb4f6a02d'::uuid, 'NC094'),
        ('c8f53198-4821-4a32-b0db-01b381d8d001'::uuid, 'NC075'),
        ('455d5d30-6a87-4388-a634-365c7ec15853'::uuid, 'NC061'),
        ('6b2f911a-b61f-494c-854f-3cc551610213'::uuid, 'NC078'),
        ('b051ee57-4570-47ed-b27c-b2c43c4a9d40'::uuid, 'NC077'),
        ('73a68d4e-c8f5-4161-a033-ef534a919601'::uuid, 'NC091'),
        ('37ac28b6-6d25-41cd-8dd6-a6bf68220347'::uuid, 'NC076'),
        ('f1d061b4-8fe4-4117-8505-ef1293a4bc5c'::uuid, 'NC085'),
        ('20cd68ad-6d22-477b-9c62-d9b1c5dc3cdd'::uuid, 'NC071'),
        ('209a75ae-d46f-4215-afed-11a752364410'::uuid, 'NW403'),
        ('6dfc44c2-b590-4d04-a4b6-32e0f41e7b25'::uuid, 'NW384'),
        ('4864d240-0772-4537-b3bf-5728d0edb27f'::uuid, 'NW394'),
        ('fbf14463-71f6-4938-9177-4b8e9857763f'::uuid, 'NW405'),
        ('0338f884-6204-48d6-969d-7a84229ca06d'::uuid, 'NW374'),
        ('c1cb4f2f-caf7-4404-8f29-1685701876dc'::uuid, 'NW396'),
        ('ab1aa573-c09c-4626-ad70-7edccf549de8'::uuid, 'NW372'),
        ('96b09c0c-bd50-4b24-bce3-a5f336a47ee0'::uuid, 'NW393'),
        ('c041e459-9208-44be-93bd-98cfe340ed58'::uuid, 'NW404'),
        ('ec92e3e4-a977-472e-b2df-6cc14fbd3ffa'::uuid, 'NW392'),
        ('43dba330-4902-44c1-bb98-ac6fd60c478a'::uuid, 'NW385'),
        ('a44c4be5-4824-4c7a-8ed3-f5a24ae06c58'::uuid, 'NW373'),
        ('ae24f43c-f481-40c8-a76b-e3d0f80cdb35'::uuid, 'NW382'),
        ('9686d400-f1a7-4681-9ec6-7c91f69691cd'::uuid, 'WC053'),
        ('100a5ca3-bc9c-4862-803c-dec99c81c3b8'::uuid, 'WC013'),
        ('9a7cb71c-bd08-4599-95d3-be3f9429d165'::uuid, 'WC047'),
        ('ccb9ba89-8528-4c8a-815e-e000cf7ff006'::uuid, 'WC025'),
        ('c0c6a69a-a63f-4e62-b3d3-33a8cfe5f73d'::uuid, 'WC033'),
        ('9c100b79-29ad-4e7a-8ee2-e73a01040102'::uuid, 'WC012'),
        ('c54a9fd3-d857-4669-b78b-359ce6e02b86'::uuid, 'CPT'),
        ('a506888d-82b3-44aa-91f2-65b8d50b5bb4'::uuid, 'WC023'),
        ('86b30c8d-0060-4866-b3f6-3bc17b5b30d7'::uuid, 'WC044'),
        ('27698735-a0ef-4689-87c2-8312d36a81e3'::uuid, 'WC042'),
        ('d4c10c72-19a6-4e21-8981-707b19c900ab'::uuid, 'WC041'),
        ('d5111a86-eab0-4060-9d12-a9c31e4e19e7'::uuid, 'WC048'),
        ('0da315c9-4d1a-4ae5-908c-eb2a06a350ac'::uuid, 'WC051'),
        ('ab521fbb-f444-441a-abdd-0b5ab84329f7'::uuid, 'WC026'),
        ('b9f0b1ce-6b43-4eba-8e79-2f85c61a590d'::uuid, 'WC011'),
        ('e98f38aa-61c5-4b2f-b94c-cdee57a4f9a2'::uuid, 'WC043'),
        ('ed94c693-2af3-41d8-ba37-1141d58e9e4b'::uuid, 'WC045'),
        ('01f3ca6f-5135-406d-8a8c-627bc27842a7'::uuid, 'WC032'),
        ('51e829cc-187c-42c1-a76c-ddc434166ce5'::uuid, 'WC052'),
        ('aaca16aa-2179-49be-9237-f3628a370fb5'::uuid, 'WC014'),
        ('9be8c181-3038-4532-915c-52afc6400522'::uuid, 'WC024'),
        ('b26bc5b3-4579-4cdb-aacf-72f6af7ae0d5'::uuid, 'WC015'),
        ('375e06f7-dd29-4b4e-b338-b30d016293bf'::uuid, 'WC034'),
        ('0ca0af87-f071-4fa2-9b43-252a5a04ecb2'::uuid, 'WC031'),
        ('b84e7323-c7ff-4af8-8958-fa64730b7dfa'::uuid, 'WC022')
       ) v(licensee_id, mdb_code)
 WHERE l.id = v.licensee_id AND l.mdb_code IS NULL AND l.kind IN ('municipal', 'metro');

NOTIFY pgrst, 'reload schema';

-- @verify:begin
-- function: public.caller_can_read_tariff_library()
-- grant_absent: anon EXECUTE ON public.caller_can_read_tariff_library()
-- table: tariffs.holiday_treatment
-- grant_absent: anon SELECT ON tariffs.holiday_treatment
-- policy: licensee_select ON tariffs.licensee PERMISSIVE
-- policy: tariff_year_select ON tariffs.tariff_year PERMISSIVE
-- policy: holiday_treatment_select ON tariffs.holiday_treatment PERMISSIVE
-- policy: holiday_treatment_insert ON tariffs.holiday_treatment PERMISSIVE
-- sql: (SELECT count(*) = 7 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'tariffs' AND p.polcmd = 'r' AND strpos(pg_get_expr(p.polqual, p.polrelid), 'caller_can_read_tariff_library') > 0 AND c.relname <> 'holiday_treatment')
-- sql: (SELECT count(*) = 0 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'tariffs' AND strpos(coalesce(pg_get_expr(p.polqual, p.polrelid), ''), 'caller_has_any_solar_org') > 0)
-- sql: (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c WHERE c.oid = 'tariffs.holiday_treatment'::regclass)
-- sql: (SELECT count(*) = 2 FROM tariffs.tou_calendar c JOIN tariffs.licensee l ON l.id = c.licensee_id WHERE l.kind = 'eskom' AND c.source = 'published')
-- sql: (SELECT count(*) = 58 FROM tariffs.tou_window w JOIN tariffs.tou_calendar c ON c.id = w.calendar_id JOIN tariffs.licensee l ON l.id = c.licensee_id WHERE l.kind = 'eskom')
-- sql: (SELECT count(*) >= 160 FROM tariffs.licensee WHERE mdb_code IS NOT NULL)
-- behaviour: scripts/db/assert-tariff-explorer.sql, every row ok
-- @verify:end
