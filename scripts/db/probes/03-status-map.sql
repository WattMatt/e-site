-- 03-status-map.sql — Task 4: status mapping, the due-date floor and the diary
-- negation stop-list (00199 section C). Four pure functions, asserted against
-- production inside one rolled-back transaction:
--   projects.map_source_status(text,text)                — pure vocabulary
--   projects.work_item_status_for_mirror(text,text,bool) — §03 §1.6 triage policy
--   projects.work_item_mirror_due_date(date)             — improvement 6
--   projects.diary_delay_text(text,text)                 — improvement 1
--
-- Run (00199 is not applied, so it is stacked):
--   node --experimental-strip-types scripts/db/rehearse-sql.ts scripts/db/probes/03-status-map.sql \
--     --with apps/edge-functions/supabase/migrations/00199_work_item_source_mirrors_and_backfill.sql
-- Before section C existed this failed with 42883 "function
-- projects.map_source_status(unknown, unknown) does not exist" — the first
-- reference in the `cases` VALUES list.
--
-- "Today" for the due-date floor is the SAST calendar date,
-- (now() AT TIME ZONE 'Africa/Johannesburg')::date — the SAME expression item
-- 2's §5 trigger uses as the start of its working-day arithmetic
-- (00196:670). CURRENT_DATE is the session-timezone (UTC) date, which is
-- yesterday's SAST date for the first two hours of every SA morning; a probe
-- written against CURRENT_DATE would drift from the function in that window.
--
-- Contract: exactly ONE row-producing statement, last in the file. No
-- impersonation; every call runs as postgres (F9) — these functions read no
-- identity, so the service path is the only path.
--
-- Expected: 36 rows (eleven `cases` + twenty-five UNION ALL arms). If the
-- printed `assertions seen:` list is shorter than thirty-six, an arm was
-- dropped — read the list, not the total. The eleven arms added on 2026-09-13
-- (Task 4 review I1/I2/I3/S1 + the un-triage decision) were each watched red
-- under their own mutation before the code changed.
WITH cases(probe, got, want) AS (VALUES
  ('rfi_responded',     projects.map_source_status('rfi','responded'),        'answered'),
  ('rfi_closed',        projects.map_source_status('rfi','closed'),           'closed'),
  ('rfi_draft_null',    projects.map_source_status('rfi','draft'),            NULL),
  ('snag_resolved',     projects.map_source_status('snag','resolved'),        'answered'),
  ('snag_signed_off',   projects.map_source_status('snag','signed_off'),      'closed'),
  ('insp_awaiting',     projects.map_source_status('inspection','awaiting_verification'), 'answered'),
  ('insp_abandoned',    projects.map_source_status('inspection','abandoned'), 'void'),
  ('qc_na_null',        projects.map_source_status('qc_defect','na'),         NULL),
  ('qc_pass_closed',    projects.map_source_status('qc_defect','pass'),       'closed'),
  ('form_distributed',  projects.map_source_status('form_action','distributed'), 'closed'),
  ('diary_always_null', projects.map_source_status('diary_action','anything'), NULL)
)
SELECT probe, got IS NOT DISTINCT FROM want AS ok,
       'got ' || COALESCE(got,'<null>') || ', want ' || COALESCE(want,'<null>') AS detail
FROM cases
UNION ALL
SELECT 'open_never_untriages',
       projects.work_item_status_for_mirror('triage','open',false) = 'triage',
       'an inspection at status=assigned must not empty the Triage queue'
UNION ALL
SELECT 'terminal_overrides_triage',
       projects.work_item_status_for_mirror('triage','closed',false) = 'closed',
       'a source that closed while untriaged still closes'
UNION ALL
SELECT 'insert_without_assignee_is_triage',
       projects.work_item_status_for_mirror(NULL,'open',false) = 'triage',
       '§03 §1.6: born triage when nobody was named'
UNION ALL
SELECT 'insert_with_assignee_is_open',
       projects.work_item_status_for_mirror(NULL,'open',true) = 'open',
       '§03 §1.6: born open when an assignee was named'
UNION ALL
SELECT 'unmapped_leaves_unchanged',
       projects.work_item_status_for_mirror('answered',NULL,false) = 'answered',
       '§03 §1.8: an unmapped source status changes nothing'
UNION ALL
-- Task 4 review I3: the reopen path was unpinned — deleting the
-- `WHEN p_mapped = 'open' THEN 'open'` arm left this probe green.
SELECT 'reopen_from_answered',
       projects.work_item_status_for_mirror('answered','open',false) = 'open',
       'an RFI pulled back from responded to open reopens its item (§03 §1.8)'
UNION ALL
SELECT 'reopen_from_closed',
       projects.work_item_status_for_mirror('closed','open',false) = 'open',
       'a closed source reopened at the source reopens its item — the only legal move out of closed (00196:1706)'
UNION ALL
SELECT 'born_closed_on_insert',
       projects.work_item_status_for_mirror(NULL,'closed',false) = 'closed',
       '#4: the 6 closed live RFIs are born closed on the backfill'
UNION ALL
SELECT 'unmapped_insert_is_triage',
       projects.work_item_status_for_mirror(NULL,NULL,false) = 'triage',
       'a draft RFI / na qc entry / diary entry with no mapping is born triage when nobody was named'
UNION ALL
-- Decided 2026-09-13 (Task 4 review carry-forward 2): a source-side
-- assignment un-triages. Every projection's UPDATE arm passes
-- `<src>.assigned_to IS NOT NULL` as the flag.
SELECT 'source_assignment_untriages',
       projects.work_item_status_for_mirror('triage','open',true) = 'open',
       'a snag whose assigned_to goes NULL → person at the source leaves triage; before this an item sat in triage carrying an assignee_id'
UNION ALL
-- Reconciliation #3: void is terminal on the mirror side too.
SELECT 'void_is_terminal',
       projects.work_item_status_for_mirror('void','open',false) = 'void'
   AND projects.work_item_status_for_mirror('void','answered',false) = 'void'
   AND projects.work_item_status_for_mirror('void','closed',false) = 'void',
       'an inspection going abandoned → re-inspect_required (or certified) must not un-void its item (00196:1701-1709 makes void terminal; the mirror bypasses (c))'
UNION ALL
-- Improvement 6. "Today" is the SAST date, the same day §5 starts counting from.
SELECT 'past_due_becomes_null',
       projects.work_item_mirror_due_date((now() AT TIME ZONE 'Africa/Johannesburg')::date - 30) IS NULL,
       'a past source date must not arrive overdue; item 2''s trigger computes the type default instead'
UNION ALL
SELECT 'today_becomes_null',
       projects.work_item_mirror_due_date((now() AT TIME ZONE 'Africa/Johannesburg')::date) IS NULL,
       'RFI "Drawings" was created AND due 2026-07-23; a same-day due date is not a deadline'
UNION ALL
SELECT 'future_due_passes_through',
       projects.work_item_mirror_due_date((now() AT TIME ZONE 'Africa/Johannesburg')::date + 14)
         = (now() AT TIME ZONE 'Africa/Johannesburg')::date + 14,
       'a real future deadline the raiser set is honoured'
UNION ALL
SELECT 'null_due_stays_null',
       projects.work_item_mirror_due_date(NULL) IS NULL,
       'no source date at all: item 2''s trigger computes A(b)''s offset'
UNION ALL
-- Improvement 1. Every one of these is a live value, re-read on 2026-09-13
-- (6 of 57 site_diary_entries carry a non-empty `delays`; the 2 non-empty
-- `delay_notes` are both 'None' beside a 'None').
SELECT 'diary_none_is_not_a_delay',
       projects.diary_delay_text('None,', NULL) IS NULL
   AND projects.diary_delay_text('None', NULL) IS NULL
   AND projects.diary_delay_text('NO', NULL) IS NULL
   AND projects.diary_delay_text(NULL, 'n/a') IS NULL
   AND projects.diary_delay_text('  none.  ', NULL) IS NULL,
       'all 6 of 6 live "delays" are negations: None, / None, / None / None / NO / "No delays or info required…"'
UNION ALL
SELECT 'diary_long_negation_is_not_a_delay',
       projects.diary_delay_text('No delays or info required was noted in the site walk and or meeting', NULL) IS NULL,
       'the 2026-06-02 entry: a sentence, not a token, so a token stop-list alone is not enough'
UNION ALL
SELECT 'diary_real_delay_survives',
       projects.diary_delay_text('Crane stood down 4h awaiting sparks', NULL)
         = 'Crane stood down 4h awaiting sparks',
       'a real delay must still project, or the stop-list has eaten the feature'
UNION ALL
-- Task 4 review I1: the earlier sentence rule (a negation word, then a delay
-- noun anywhere within 80 characters) swallowed real delays that START with a
-- negation. The rule now requires the noun IMMEDIATELY after the word.
SELECT 'diary_real_delay_starting_with_no_survives',
       projects.diary_delay_text('No power on site — issue with Eskom', NULL)
         = 'No power on site — issue with Eskom'
   AND projects.diary_delay_text('No sparks on site so the electrical problem stays', NULL)
         = 'No sparks on site so the electrical problem stays',
       'a real delay that begins with "No" must survive — the old rule returned NULL for both (rehearsed 2026-09-13)'
UNION ALL
SELECT 'diary_real_delay_starting_with_none_survives',
       projects.diary_delay_text('None of the DB-04 deliveries arrived, delay of 2 days', NULL)
         = 'None of the DB-04 deliveries arrived, delay of 2 days'
   AND projects.diary_delay_text('Nothing delivered; the info from the supplier was wrong', NULL)
         = 'Nothing delivered; the info from the supplier was wrong',
       'a real delay that begins with "None"/"Nothing" must survive — the old rule returned NULL for both (rehearsed 2026-09-13)'
UNION ALL
SELECT 'diary_no_issues_noted_is_negation',
       projects.diary_delay_text('No issues noted', NULL) IS NULL
   AND projects.diary_delay_text('None noted', NULL) IS NULL
   AND projects.diary_delay_text('No delay', NULL) IS NULL,
       'the narrow rule still catches the short negations a foreman types'
UNION ALL
SELECT 'diary_nothing_to_report_is_negation',
       projects.diary_delay_text('Nothing to report', NULL) IS NULL,
       '"to report" is the one non-noun completion the rule admits'
UNION ALL
SELECT 'diary_notes_fallback',
       projects.diary_delay_text(NULL, 'Late delivery of DB-04A') = 'Late delivery of DB-04A',
       'delay_notes (00017:18) is the second source, added after the original column'
UNION ALL
-- Task 4 review I2: the stop-list is applied per column; a 'None' in `delays`
-- must not silence a real `delay_notes`.
SELECT 'diary_notes_survive_none_in_delays',
       projects.diary_delay_text('None', 'Late delivery of DB-04A') = 'Late delivery of DB-04A',
       'the first-non-empty COALESCE returned NULL here (rehearsed 2026-09-13): the negation in `delays` ate the real note'
UNION ALL
-- Task 4 review S1: TRIM strips spaces only.
SELECT 'diary_leading_newline_none_is_negation',
       projects.diary_delay_text(E'\nNone', NULL) IS NULL,
       'E''\nNone'' survived TRIM as a delay; btrim with an explicit whitespace set catches it';
