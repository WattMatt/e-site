-- Assertions for 00196 §11: projects.append_work_item_event() — the ONLY
-- writer of work_item_events and of work_item_watchers. Run inside the
-- rolled-back transaction opened by try-work-item-spine.sh.
--
-- The event-generating half runs AS A REAL AUTHENTICATED PROJECT MEMBER — the
-- rbac-test contractor (018f2d31-bbe8-4cc1-bbdd-63af0187081e, contractor on
-- WM-Consulting and (643) KINGSWALK, the permanent prod RBAC fixture; never
-- invite it, never email it) — not as the owner. A file that never switches
-- role runs every statement as the table owner, which bypasses RLS and holds
-- every grant: removing SECURITY DEFINER from the trigger would change
-- nothing and the mutation proof would be decorative.
--
-- ⚠ A temp table created as postgres is unreadable after SET LOCAL ROLE
-- authenticated (42501). The fixture is GRANTed to authenticated and the
-- grant is asserted first in the role-scoped block.
--
-- ⚠ set_config(…, true) is TRANSACTION-local: after RESET ROLE, auth.uid()
-- still returns the last impersonated user. Every row a postgres block seeds
-- (the calendar, and assertion 13's void rfi item) is therefore seeded BEFORE
-- the first SET LOCAL ROLE — §5's opened_at stamp keys on auth.uid() IS NOT
-- NULL, and the void item is meant to travel the service path (actor NULL).
--
-- ⚠ Every id the role-scoped block needs is captured HERE, as postgres. Under
-- the contractor's role projects.rfis and project_members are RLS-filtered.
CREATE TEMP TABLE _e AS
SELECT pm.project_id, p.organisation_id,
       '018f2d31-bbe8-4cc1-bbdd-63af0187081e'::uuid AS actor_id,
       projects.resolve_project_pm(pm.project_id) AS pm_id,
       -- A THIRD person: not the actor, not the PM, not a client viewer. Not
       -- the PM because the PM is already a watcher from creation (as the
       -- gatekeeper), so a reassignment TO the PM would hit ON CONFLICT DO
       -- NOTHING and the reassign-watcher arm could vanish undetected
       -- (assertion 8's third check, mutation-tested). Not a client viewer
       -- because §7's membership check needs an effective role and the type's
       -- write set excludes them.
       (SELECT m.user_id FROM projects.project_members m
         WHERE m.project_id = pm.project_id AND m.is_active
           AND m.user_id <> '018f2d31-bbe8-4cc1-bbdd-63af0187081e'
           AND m.user_id IS DISTINCT FROM projects.resolve_project_pm(pm.project_id)
           AND m.role <> 'client_viewer'
         ORDER BY m.created_at, m.user_id
         LIMIT 1) AS other_id,
       -- Assertion 13's source row: a real rfi on the fixture project.
       (SELECT r.id FROM projects.rfis r WHERE r.project_id = pm.project_id
         ORDER BY r.created_at, r.id LIMIT 1) AS rfi_id
  FROM projects.project_members pm
  JOIN projects.projects p ON p.id = pm.project_id
 WHERE pm.user_id = '018f2d31-bbe8-4cc1-bbdd-63af0187081e' AND pm.is_active
 ORDER BY pm.created_at, pm.project_id
 LIMIT 1;
GRANT SELECT ON _e TO authenticated;

DO $$
DECLARE e record; v_void uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _e) THEN
    RAISE EXCEPTION 'the rbac-test fixture has no project membership; the event assertions cannot run as a real user';
  END IF;
  SELECT * INTO e FROM _e;
  IF e.pm_id IS NULL THEN
    RAISE EXCEPTION 'resolve_project_pm(%) is NULL — the fixture project has nobody to gatekeep', e.project_id;
  END IF;
  IF e.pm_id = e.actor_id THEN
    RAISE EXCEPTION 'the fixture is the project PM — assertion 5 (assignee -> gatekeeper handover) needs two different people';
  END IF;
  IF e.other_id IS NULL THEN
    RAISE EXCEPTION 'no third non-client_viewer member (not the fixture, not the PM) on project %; the reassigned/assigned verbs and the reassign-watcher arm cannot all be reached', e.project_id;
  END IF;
  IF e.rfi_id IS NULL THEN
    RAISE EXCEPTION 'no RFI on the fixture project % — assertion 13 needs a real rfi_id captured as postgres', e.project_id;
  END IF;
  -- Pinned, so a fixture elevation fails with the cause named rather than as
  -- a wrong-role assertion 7.
  IF public.user_effective_project_role(e.project_id, e.actor_id) IS DISTINCT FROM 'contractor' THEN
    RAISE EXCEPTION 'the rbac-test fixture''s effective role on % is % rather than contractor',
      e.project_id, public.user_effective_project_role(e.project_id, e.actor_id);
  END IF;

  -- Every insert runs work_items_set_due_date -> add_working_days, which
  -- raises no_data_found on an unseeded year. Rolled back with everything else.
  INSERT INTO projects.calendar_years (year)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int), (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
  ON CONFLICT DO NOTHING;

  -- Assertion 13's setup, on the SERVICE path (auth.uid() is NULL here — this
  -- runs before the first impersonation). Item 3's delete-to-void shape: a
  -- source row deleted after its mirrored item was voided runs the RI
  -- ON DELETE SET NULL as an UPDATE of the void row that changes ONLY a source
  -- FK. §11 must fire no arm for it and return cleanly, or every such delete
  -- writes a phantom event (Task 11's guard must admit the same update).
  -- opened_at is a historical date, kept by §5 on the service path (its stamp
  -- keys on auth.uid() IS NOT NULL) — 13c pins that the created event is
  -- dated there, not at the moment the backfill ran.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by,
     rfi_id, status, void_reason, origin, opened_at)
  VALUES (e.organisation_id, e.project_id, 'rfi', 'void rfi subject', e.actor_id, e.pm_id, e.pm_id,
          e.rfi_id, 'void', 'assertion', 'mirror', now() - interval '30 days')
  RETURNING id INTO v_void;
  UPDATE projects.work_items SET rfi_id = NULL WHERE id = v_void;
  IF (SELECT rfi_id FROM projects.work_items WHERE id = v_void) IS NOT NULL THEN
    RAISE EXCEPTION 'the SET NULL update on the void rfi item did not take';
  END IF;
END $$;

-- Generate the events AS A REAL USER. auth.uid() must be a person, or actor_id
-- and actor_role are both NULL and assertions 6 and 7 pass vacuously.
SELECT set_config('request.jwt.claims',
  json_build_object('sub','018f2d31-bbe8-4cc1-bbdd-63af0187081e','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE e record; v_id uuid;
BEGIN
  -- The fixture must be readable in this role, or the block dies on its first
  -- statement and proves nothing.
  BEGIN
    PERFORM 1 FROM _e;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'fixture _e is unreadable as authenticated — add GRANT SELECT ON _e TO authenticated';
  END;
  SELECT * INTO e FROM _e;
  IF auth.uid() IS DISTINCT FROM e.actor_id THEN
    RAISE EXCEPTION 'impersonation did not take: auth.uid() is %', auth.uid();
  END IF;

  -- Create, then move it through every arm the trigger has. origin = 'manual'
  -- is what every client insert must say (§9 gate arm (c)); the 'mirror'
  -- default is refused for a client, and that refusal is Task 9's, not this
  -- file's. Every UPDATE is checked with FOUND: under RLS an UPDATE that
  -- matches no row does NOT raise, and a later "no event" failure would then
  -- be about the wrong layer.
  INSERT INTO projects.work_items
    (organisation_id, project_id, item_type, title, assignee_id, gatekeeper_id, created_by, origin)
  VALUES (e.organisation_id, e.project_id, 'task', 'event subject', e.actor_id, e.pm_id, e.actor_id, 'manual')
  RETURNING id INTO v_id;

  UPDATE projects.work_items SET assignee_id = e.other_id WHERE id = v_id;    -- triage   -> 'assigned'
  IF NOT FOUND THEN RAISE EXCEPTION 'the triage handoff UPDATE matched no row under RLS'; END IF;
  UPDATE projects.work_items SET status = 'open'            WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the triage -> open UPDATE matched no row under RLS'; END IF;
  UPDATE projects.work_items SET assignee_id = e.actor_id   WHERE id = v_id;    -- open     -> 'reassigned'
  IF NOT FOUND THEN RAISE EXCEPTION 'the reassignment UPDATE matched no row under RLS'; END IF;
  UPDATE projects.work_items SET due_date = due_date + 3    WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the due-date UPDATE matched no row under RLS'; END IF;
  UPDATE projects.work_items SET status = 'answered'        WHERE id = v_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the open -> answered UPDATE matched no row under RLS'; END IF;
  -- A gatekeeper correction while answered: the ball moves with the column
  -- (ball_in_court_id = gatekeeper_id in 'answered'), and a write-role holder
  -- may correct either person column in any live state (improvement 10).
  UPDATE projects.work_items SET gatekeeper_id = e.other_id WHERE id = v_id;    -- answered -> 'gatekeeper_changed'
  IF NOT FOUND THEN RAISE EXCEPTION 'the gatekeeper-correction UPDATE matched no row under RLS'; END IF;
END $$;

RESET ROLE;

DO $$
DECLARE v_id uuid; v_void uuid; n int; e record;
BEGIN
  SELECT * INTO e FROM _e;
  SELECT id INTO v_id FROM projects.work_items WHERE title = 'event subject';
  IF v_id IS NULL THEN RAISE EXCEPTION 'the contractor''s insert left no row; nothing below can be asserted'; END IF;

  -- 1. Creation writes exactly one 'created' event carrying the opening state,
  --    including the ball-in-court the item was born holding.
  SELECT count(*) INTO n FROM projects.work_item_events
   WHERE work_item_id = v_id AND verb = 'created';
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 created event, found %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id = v_id AND verb = 'created'
                    AND to_status = 'triage' AND to_user_id = e.actor_id
                    AND to_due_date IS NOT NULL AND to_ball_in_court_id = e.actor_id)
  THEN RAISE EXCEPTION 'the created event did not carry the opening status/assignee/due date/ball-in-court'; END IF;
  -- 1b. Its timestamps agree with the ROW: §5 stamps opened_at for a client
  --     session (a client-supplied backdate is overwritten before the AFTER
  --     trigger sees NEW), so the event is dated at the stamped moment, and
  --     the due date it records is the one the due_changed event later says
  --     it was changed FROM — the history is self-consistent.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events ev
                  JOIN projects.work_items wi ON wi.id = ev.work_item_id
                  WHERE ev.work_item_id = v_id AND ev.verb = 'created'
                    AND ev.created_at = wi.opened_at)
  THEN RAISE EXCEPTION 'the created event is not dated at the row''s stamped opened_at'; END IF;
  -- 1c. Total order. now() is transaction-constant, so every event this
  --     transaction wrote carries the SAME created_at and id is random; only
  --     seq (identity) orders them. By (created_at, seq) the first event is
  --     the creation and the last is the gatekeeper correction.
  SELECT count(DISTINCT created_at) INTO n FROM projects.work_item_events WHERE work_item_id = v_id;
  IF n <> 1 THEN RAISE EXCEPTION 'one transaction wrote this history but % distinct created_at values appear; the (created_at, seq) ordering premise is wrong', n; END IF;
  IF (SELECT verb FROM projects.work_item_events WHERE work_item_id = v_id ORDER BY created_at, seq LIMIT 1) <> 'created'
     OR (SELECT from_user_id = e.pm_id AND to_user_id = e.other_id FROM projects.work_item_events
          WHERE work_item_id = v_id ORDER BY created_at DESC, seq DESC LIMIT 1) IS NOT TRUE
  THEN RAISE EXCEPTION 'ordering the history by (created_at, seq) does not replay the writes in order'; END IF;

  -- 2. Triage assignment writes 'assigned'; a later change writes 'reassigned'.
  --    Both verbs must be reachable or one of them is decorative.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id = v_id AND verb = 'assigned'
                    AND from_user_id = e.actor_id AND to_user_id = e.other_id)
  THEN RAISE EXCEPTION 'the triage handoff wrote no assigned event with both endpoints'; END IF;
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id = v_id AND verb = 'reassigned'
                    AND from_user_id = e.other_id AND to_user_id = e.actor_id)
  THEN RAISE EXCEPTION 'a post-triage reassignment wrote no reassigned event with both endpoints'; END IF;
  -- 2b. The gatekeeper arm answers on its own, under its OWN verb: a
  --     gatekeeper correction on an answered item writes 'gatekeeper_changed'
  --     with both people AND the ball-in-court move it caused (the ball sits
  --     with the gatekeeper in 'answered'). 'reassigned' would make a change
  --     of who signs off indistinguishable from a change of who does the work.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id = v_id AND verb = 'gatekeeper_changed'
                    AND from_user_id = e.pm_id AND to_user_id = e.other_id
                    AND from_ball_in_court_id = e.pm_id AND to_ball_in_court_id = e.other_id)
  THEN RAISE EXCEPTION 'a gatekeeper correction wrote no gatekeeper_changed event carrying both people and the ball-in-court move'; END IF;
  -- 2c. The open-state reassignment moved the ball WITH the assignee: from the
  --     old assignee to the new one. This is the row that tells the assignee
  --     arm reading the GENERATED column apart from one writing a person
  --     column — NEW.gatekeeper_id would put the PM here, and nothing above
  --     would notice.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id = v_id AND verb = 'reassigned'
                    AND from_user_id = e.other_id AND to_user_id = e.actor_id
                    AND from_ball_in_court_id = e.other_id AND to_ball_in_court_id = e.actor_id)
  THEN RAISE EXCEPTION 'the open-state reassignment does not carry the ball-in-court move from the old to the new assignee'; END IF;

  -- 3. A due-date change is recorded with both endpoints...
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id = v_id AND verb = 'due_changed'
                    AND from_due_date IS NOT NULL AND to_due_date = from_due_date + 3)
  THEN RAISE EXCEPTION 'a due-date change wrote no due_changed event with both endpoints'; END IF;
  -- 3b. ...and its FROM is the date the created event recorded.
  IF (SELECT to_due_date FROM projects.work_item_events WHERE work_item_id = v_id AND verb = 'created')
     <> (SELECT from_due_date FROM projects.work_item_events WHERE work_item_id = v_id AND verb = 'due_changed')
  THEN RAISE EXCEPTION 'the created event''s due date is not the one the due_changed event says it was changed from'; END IF;

  -- 4. METRIC 4's ROW. The first open -> answered transition must be findable by
  --    (from_status, to_status). A log that only recorded a verb would pass every
  --    assertion above and make the median-days-to-respond metric unanswerable.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id = v_id AND from_status = 'open' AND to_status = 'answered')
  THEN RAISE EXCEPTION 'no (open -> answered) event row; metric 4 has no numerator'; END IF;

  -- 5. METRIC 5's DENOMINATOR. The open -> answered move handed the ball from
  --    the assignee to the gatekeeper, and the event must say so ON ITS OWN —
  --    reconstructing it from the row's CURRENT gatekeeper_id is the error §15
  --    §(b) forbids, and it is wrong for every item whose gatekeeper was ever
  --    corrected (this very item's gatekeeper is corrected two statements
  --    later). This CANNOT be backfilled.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id = v_id AND from_status = 'open' AND to_status = 'answered'
                    AND from_ball_in_court_id = e.actor_id
                    AND to_ball_in_court_id   = e.pm_id)
  THEN RAISE EXCEPTION 'the open -> answered event does not carry the ball-in-court handover; metric 5 has no denominator'; END IF;
  -- 5b. The triage -> open move did NOT move the ball: it stayed with the
  --     assignee (other_id at that moment), who is NOT the gatekeeper. On the
  --     open -> answered row the ball lands on the gatekeeper either way, so
  --     only THIS row tells the status arm reading the GENERATED column apart
  --     from one writing NEW.gatekeeper_id.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events
                  WHERE work_item_id = v_id AND from_status = 'triage' AND to_status = 'open'
                    AND from_ball_in_court_id = e.other_id AND to_ball_in_court_id = e.other_id)
  THEN RAISE EXCEPTION 'the triage -> open event does not carry the (unchanged) assignee ball-in-court on both sides'; END IF;

  -- 6. ATTRIBUTION. Every event names the real actor, from auth.uid().
  SELECT count(*) INTO n FROM projects.work_item_events
   WHERE work_item_id = v_id AND actor_id IS DISTINCT FROM e.actor_id;
  IF n <> 0 THEN RAISE EXCEPTION '% event(s) name the wrong actor (or none)', n; END IF;

  -- 7. METRIC 2a's ROLE. actor_role is stamped AT EVENT TIME. Contractor
  --    activity on work items is the only first-party evidence the spine
  --    reached the contractor accounts (13 on 2026-09-10): public.email_events
  --    (00185, the Resend webhook) records opens and bounces per message, but
  --    nothing joins an open to a work item, so per-item email engagement is
  --    unmeasurable and this column is the signal.
  SELECT count(*) INTO n FROM projects.work_item_events
   WHERE work_item_id = v_id AND actor_role IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION '% event(s) have no actor_role stamped', n; END IF;
  -- One actor acted, so one role must appear; guarded before the scalar
  -- comparison so a two-role history fails with a sentence rather than
  -- "more than one row returned by a subquery".
  SELECT count(DISTINCT actor_role) INTO n FROM projects.work_item_events WHERE work_item_id = v_id;
  IF n <> 1 THEN RAISE EXCEPTION 'one actor wrote this history but % distinct actor_role values appear', n; END IF;
  IF (SELECT DISTINCT actor_role FROM projects.work_item_events WHERE work_item_id = v_id)
     <> public.user_effective_project_role(e.project_id, e.actor_id)
  THEN RAISE EXCEPTION 'actor_role does not match the actor''s effective role on the project'; END IF;

  -- 8. WATCHERS ARE POPULATED. Nothing else in Q1 writes this table, so without
  --    the seeding arm the SELECT policy's watcher clause is dead code and item
  --    4 inherits an empty subscription list. Each check pins the REASON, not
  --    just the row: a person subscribed by a later arm for a later reason is
  --    a different fact (the actor is re-added by the reassign arm, other_id
  --    by the gatekeeper arm), and without the reason each of those arms
  --    would mask the loss of the one being asserted — measured in review.
  --    Creation ranks creator > assignee > gatekeeper, so the actor (creator
  --    AND assignee) carries 'creator'; ON CONFLICT DO NOTHING means the first
  --    reason a person was subscribed for is the one that stays.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_watchers
                  WHERE work_item_id = v_id AND user_id = e.actor_id AND reason = 'creator')
  THEN RAISE EXCEPTION 'the creator/assignee was not auto-added as a watcher (as creator, the creation seed''s first-ranked reason)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_watchers
                  WHERE work_item_id = v_id AND user_id = e.pm_id AND reason = 'gatekeeper')
  THEN RAISE EXCEPTION 'the gatekeeper was not auto-added as a watcher'; END IF;
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_watchers
                  WHERE work_item_id = v_id AND user_id = e.other_id AND reason = 'assignee')
  THEN RAISE EXCEPTION 'the incoming assignee was not added as a watcher on reassignment (as assignee — the later gatekeeper correction is the wrong moment and the wrong reason)'; END IF;
  -- One row per person, even though the actor is creator AND assignee.
  SELECT count(*) INTO n FROM projects.work_item_watchers
   WHERE work_item_id = v_id AND user_id = e.actor_id;
  IF n <> 1 THEN RAISE EXCEPTION 'the actor has % watcher rows; the primary key should make that impossible', n; END IF;

  -- 9. NO write policy on work_item_events. An INSERT policy would let a client
  --    forge the history the metrics and the audit trail are read from.
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'projects' AND tablename = 'work_item_events' AND cmd <> 'SELECT';
  IF n <> 0 THEN RAISE EXCEPTION 'work_item_events carries % write policy/policies', n; END IF;

  -- 10. The append function must not reference current_user anywhere.
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
       WHERE nsp.nspname = 'projects' AND p.proname = 'append_work_item_event') ILIKE '%current_user%'
  THEN RAISE EXCEPTION 'append_work_item_event references current_user — under SECURITY DEFINER that is the OWNER'; END IF;

  -- 11. It must be SECURITY DEFINER, or the first event insert dies.
  IF NOT (SELECT prosecdef FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
           WHERE nsp.nspname = 'projects' AND p.proname = 'append_work_item_event')
  THEN RAISE EXCEPTION 'append_work_item_event is SECURITY INVOKER; with no write policy and no grant it cannot insert'; END IF;

  -- 12. Item 2 writes NO notification. That is item 4's, added by CREATE OR REPLACE.
  IF (SELECT prosrc FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
       WHERE nsp.nspname = 'projects' AND p.proname = 'append_work_item_event') ILIKE '%public.notifications%'
  THEN RAISE EXCEPTION 'the append trigger writes notifications; that is item 4 and it is out of scope here'; END IF;

  -- 13. A VOID item whose only change was a source FK being nulled (item 3's
  --     delete-to-void ON DELETE SET NULL shape, seeded and updated as
  --     postgres before the first impersonation) wrote NO event beyond its
  --     own 'created' row, and the trigger returned cleanly.
  SELECT id INTO v_void FROM projects.work_items WHERE title = 'void rfi subject';
  IF v_void IS NULL THEN RAISE EXCEPTION 'the void rfi item was not seeded; assertion 13 has nothing to read'; END IF;
  SELECT count(*) INTO n FROM projects.work_item_events WHERE work_item_id = v_void AND verb = 'created';
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly one created event on the void rfi item, found %', n; END IF;
  SELECT count(*) INTO n FROM projects.work_item_events WHERE work_item_id = v_void AND verb <> 'created';
  IF n <> 0 THEN RAISE EXCEPTION 'nulling a source FK on a void item wrote % event(s); item 3''s delete-to-void SET NULL would write a phantom event on every source delete', n; END IF;
  -- 13b. That row travelled the service path: no person, no role — NULL, not
  --      the owner and not a forged 'contractor'.
  IF EXISTS (SELECT 1 FROM projects.work_item_events
              WHERE work_item_id = v_void AND (actor_id IS NOT NULL OR actor_role IS NOT NULL))
  THEN RAISE EXCEPTION 'the service-path created event on the void item names an actor or a role; auth.uid() was NULL when it was written'; END IF;
  -- 13c. ...and it is dated at the row's HISTORICAL opened_at (30 days ago,
  --      supplied by the seed and kept by §5 on the service path), not at the
  --      moment the insert ran. A backfilled arrival dated at backfill time
  --      would pile every historical item into one week of metric 5's
  --      denominator.
  IF NOT EXISTS (SELECT 1 FROM projects.work_item_events ev
                  JOIN projects.work_items wi ON wi.id = ev.work_item_id
                  WHERE ev.work_item_id = v_void AND ev.verb = 'created'
                    AND wi.opened_at < now() - interval '29 days'
                    AND ev.created_at = wi.opened_at)
  THEN RAISE EXCEPTION 'the service-path created event is not dated at the row''s historical opened_at'; END IF;

  RAISE NOTICE 'work-item-events: 13/13 assertions passed';
END $$;
