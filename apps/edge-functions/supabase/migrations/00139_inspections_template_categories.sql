-- 00139_inspections_template_categories.sql
-- Group the existing Watson Mattheus inspection templates under library
-- categories (the `category` column was added in 00137; the 5 MV forms were
-- already set to 'medium_voltage' by 00138). Idempotent UPDATE by template_id,
-- scoped to the WM-Consulting org. Any template not listed here stays
-- uncategorised and renders under the "General" heading.
UPDATE inspections.templates SET category = 'medium_voltage'
  WHERE organisation_id = 'dddddddd-0000-0000-0000-000000000001'
    AND template_id IN (
      'mv-phasing-test-record', 'mv-megger-insulation-test', 'mv-cable-test-certificate',
      'mv-protection-settings-summary', 'mv-safety-report-annex-b',
      'mini-sub-pre-post-fat', 'rmu-snagging'
    );

UPDATE inspections.templates SET category = 'generators'
  WHERE organisation_id = 'dddddddd-0000-0000-0000-000000000001'
    AND template_id IN ('generator-installation-nrs048', 'generator-fat');

UPDATE inspections.templates SET category = 'solar_pv'
  WHERE organisation_id = 'dddddddd-0000-0000-0000-000000000001'
    AND template_id = 'solar-pv-standalone';

UPDATE inspections.templates SET category = 'low_voltage'
  WHERE organisation_id = 'dddddddd-0000-0000-0000-000000000001'
    AND template_id IN ('lv-line-shop-board-audit', 'line-shop-handover', 'electrical-meter-nrs057');

UPDATE inspections.templates SET category = 'reports_site'
  WHERE organisation_id = 'dddddddd-0000-0000-0000-000000000001'
    AND template_id IN ('standard-progress-report', 'site-drawing-inspection', 'site-summary-report');

NOTIFY pgrst, 'reload schema';
