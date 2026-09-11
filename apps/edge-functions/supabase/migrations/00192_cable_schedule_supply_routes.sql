-- ---------------------------------------------------------------------------
-- Migration 00192: cable_schedule — supply_routes + route_segments
-- ---------------------------------------------------------------------------
-- Spec: docs/superpowers/specs/2026-09-11-cable-route-measurement-design.md
--
-- Why: 367 of 545 cable strands in production carry no measured_length_m, and
-- the four projects that need it most (ITONKA, PNP FAERIE GLEN, NLC, SAXBY)
-- have not one measured run between them. The measuring already happens — all
-- 178 existing lengths are whole metres, only 36 of them multiples of five, so
-- they were scaled off a drawing and rounded, not estimated — it just happens
-- outside the system, so the traced route is thrown away and the number that
-- lands on a signed schedule has no provenance.
--
-- These two tables make the route a first-class object in cable_schedule. The
-- drawing RENDERS a route; the drawing does not STORE it. A run leaves the
-- sheet it starts on (every drawing is one sheet — 643.E.100 POWER LAYOUT
-- PORTION A … PORTION J), so a route kept as shapes in the per-drawing scene
-- graph could not be totalled without opening every drawing in the project,
-- and "which runs are still unmeasured" could not be asked at all.
--
--   supplies (the logical run A -> B)
--     └── supply_routes      1:1, revision-scoped, holds rise_m + drop_m
--           └── route_segments  1:N, ordered, one per sheet the route crosses
--
-- total_length_m = SUM(segment.length_m) + rise_m + drop_m, and is a STORED
-- generated column so the arithmetic cannot drift between the grid, the PDF
-- and the report.
--
-- This migration creates schema only. It writes nothing to cables — the apply
-- step (applyRouteToScheduleAction) is explicit, app-side, and shows old
-- against new before overwriting any existing length.
--
-- Reversible:
--   DROP TABLE cable_schedule.route_segments;
--   DROP TABLE cable_schedule.supply_routes;
--   DROP FUNCTION cable_schedule.recompute_route_traced_length();
--   DROP FUNCTION cable_schedule.enforce_route_segment_frozen();
--   DROP FUNCTION cable_schedule.bind_supply_route_parents();
--   DROP FUNCTION cable_schedule.bind_route_segment_parent();
--   DROP FUNCTION cable_schedule.user_can_edit_schedule(UUID);
--
-- New tables in an EXISTING schema, so a NOTIFY is enough; no Management-API
-- PostgREST db_schema PATCH is required (that is only for a new schema).
--
-- @verify:begin
-- table: cable_schedule.supply_routes
-- table: cable_schedule.route_segments
-- constraint: supply_routes_supply_id_key ON cable_schedule.supply_routes
-- constraint: supply_routes_rise_m_nonneg ON cable_schedule.supply_routes
-- constraint: supply_routes_drop_m_nonneg ON cable_schedule.supply_routes
-- constraint: supply_routes_traced_length_nonneg ON cable_schedule.supply_routes
-- constraint: route_segments_route_id_seq_key ON cable_schedule.route_segments
-- constraint: route_segments_seq_positive ON cable_schedule.route_segments
-- constraint: route_segments_page_index_positive ON cable_schedule.route_segments
-- constraint: route_segments_points_shape ON cable_schedule.route_segments
-- constraint: route_segments_ppm_positive ON cable_schedule.route_segments
-- constraint: route_segments_length_nonneg ON cable_schedule.route_segments
-- column: cable_schedule.supply_routes.total_length_m is GENERATED ALWAYS STORED
-- index: idx_supply_routes_revision ON cable_schedule.supply_routes
-- index: idx_route_segments_floor_plan ON cable_schedule.route_segments
-- index: route_segments_route_id_seq_key ON cable_schedule.route_segments  -- the UNIQUE constraint IS the (route_id, seq) index; no duplicate created
-- function: cable_schedule.user_can_edit_schedule(uuid)
-- function: cable_schedule.bind_supply_route_parents()
-- function: cable_schedule.bind_route_segment_parent()
-- function: cable_schedule.enforce_route_segment_frozen()
-- function: cable_schedule.recompute_route_traced_length()
-- policy: route_select ON cable_schedule.supply_routes
-- policy: route_write ON cable_schedule.supply_routes
-- policy: route_write_authz_insert ON cable_schedule.supply_routes  -- RESTRICTIVE
-- policy: route_write_authz_update ON cable_schedule.supply_routes  -- RESTRICTIVE
-- policy: route_write_authz_delete ON cable_schedule.supply_routes  -- RESTRICTIVE
-- policy: segment_select ON cable_schedule.route_segments
-- policy: segment_write ON cable_schedule.route_segments
-- policy: segment_write_authz_insert ON cable_schedule.route_segments  -- RESTRICTIVE
-- policy: segment_write_authz_update ON cable_schedule.route_segments  -- RESTRICTIVE
-- policy: segment_write_authz_delete ON cable_schedule.route_segments  -- RESTRICTIVE
-- trigger: supply_routes_bind_parents ON cable_schedule.supply_routes
-- trigger: supply_routes_frozen_guard ON cable_schedule.supply_routes
-- trigger: supply_routes_updated_at ON cable_schedule.supply_routes
-- trigger: route_segments_bind_parent ON cable_schedule.route_segments
-- trigger: route_segments_frozen_guard ON cable_schedule.route_segments
-- trigger: route_segments_traced_length ON cable_schedule.route_segments
-- grant_present: authenticated SELECT ON cable_schedule.supply_routes
-- grant_present: authenticated INSERT ON cable_schedule.supply_routes
-- grant_present: authenticated UPDATE ON cable_schedule.supply_routes
-- grant_present: authenticated DELETE ON cable_schedule.supply_routes
-- grant_present: authenticated SELECT ON cable_schedule.route_segments
-- grant_present: authenticated INSERT ON cable_schedule.route_segments
-- grant_present: authenticated UPDATE ON cable_schedule.route_segments
-- grant_present: authenticated DELETE ON cable_schedule.route_segments
-- grant_present: authenticated EXECUTE ON cable_schedule.user_can_edit_schedule(uuid)
-- grant_absent: anon SELECT ON cable_schedule.supply_routes
-- grant_absent: anon INSERT ON cable_schedule.supply_routes
-- grant_absent: anon UPDATE ON cable_schedule.supply_routes
-- grant_absent: anon DELETE ON cable_schedule.supply_routes
-- grant_absent: anon TRUNCATE ON cable_schedule.supply_routes
-- grant_absent: anon SELECT ON cable_schedule.route_segments
-- grant_absent: anon INSERT ON cable_schedule.route_segments
-- grant_absent: anon UPDATE ON cable_schedule.route_segments
-- grant_absent: anon DELETE ON cable_schedule.route_segments
-- grant_absent: anon TRUNCATE ON cable_schedule.route_segments
-- grant_absent: anon EXECUTE ON cable_schedule.user_can_edit_schedule(uuid)
-- grant_absent: anon EXECUTE ON cable_schedule.bind_supply_route_parents()
-- grant_absent: anon EXECUTE ON cable_schedule.bind_route_segment_parent()
-- grant_absent: anon EXECUTE ON cable_schedule.enforce_route_segment_frozen()
-- grant_absent: anon EXECUTE ON cable_schedule.recompute_route_traced_length()
--   (all five via has_function_privilege('anon', oid, 'EXECUTE') = false, never
--    by reading proacl — a NULL proacl looks empty but IS the PUBLIC grant;
--    this keeps 00186's anon-EXECUTE sweep true for cable_schedule)
-- behaviour: contractor/inspector/supplier/client_viewer INSERT on either table -> denied
-- behaviour: owner/admin/project_manager INSERT on a DRAFT revision -> allowed
-- behaviour: any INSERT/UPDATE/DELETE against an ISSUED revision -> denied (both tables)
-- behaviour: INSERT with a forged organisation_id -> row stores the REVISION's org
-- behaviour: INSERT/UPDATE/DELETE of a segment -> parent traced_length_m and
--            total_length_m recomputed in the same statement
-- @verify:end
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. cable_schedule.supply_routes — one route per supply
-- ===========================================================================

CREATE TABLE IF NOT EXISTS cable_schedule.supply_routes (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supply_id        UUID NOT NULL REFERENCES cable_schedule.supplies(id)  ON DELETE CASCADE,
    revision_id      UUID NOT NULL REFERENCES cable_schedule.revisions(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),

    rise_m           NUMERIC NOT NULL DEFAULT 0,
    drop_m           NUMERIC NOT NULL DEFAULT 0,
    traced_length_m  NUMERIC NOT NULL DEFAULT 0,
    total_length_m   NUMERIC GENERATED ALWAYS AS (traced_length_m + rise_m + drop_m) STORED,

    measured_by      UUID REFERENCES public.profiles(id),
    measured_at      TIMESTAMPTZ,
    notes            TEXT,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT supply_routes_supply_id_key           UNIQUE (supply_id),
    CONSTRAINT supply_routes_rise_m_nonneg           CHECK (rise_m          >= 0),
    CONSTRAINT supply_routes_drop_m_nonneg           CHECK (drop_m          >= 0),
    CONSTRAINT supply_routes_traced_length_nonneg    CHECK (traced_length_m >= 0)
);

COMMENT ON TABLE cable_schedule.supply_routes IS
'The traced physical route of one supply, revision-scoped. One row per supply — supply_id is UNIQUE, so two people measuring the same run collide on a conflict instead of silently creating a second route and a second answer.

Measuring writes here. It does NOT write to cable_schedule.cables: applying a route to the schedule is a separate, explicit step that shows old against new where a length already exists (KINGSWALK holds 162 hand-entered lengths, and a second opinion that overwrites the first without being seen is worse than no tool at all).

revision_id is carried directly, in addition to being reachable through supply_id, for two reasons. It lets 00168 §3b''s enforce_revision_data_frozen() guard this table unchanged, so a route cannot be edited under an ISSUED schedule and make the drawing disagree with the signed document. And it makes the worklist — "supplies in this DRAFT revision with no route, or a route with no segments" — a cheap relational query rather than a walk over every drawing''s scene JSON. A BEFORE trigger binds revision_id to the supply''s own revision, so the two can never disagree.';

COMMENT ON COLUMN cable_schedule.supply_routes.supply_id IS
'The logical run this route belongs to. UNIQUE: one route per supply. Parallel strands share the run and therefore share the route — this is the same shape the grid already uses for measured_length_m, which it treats as run-shared rather than per-strand.';

COMMENT ON COLUMN cable_schedule.supply_routes.revision_id IS
'The revision this route belongs to. Denormalised from supplies.revision_id (a BEFORE trigger binds them together and rejects a mismatch) so that 00168 §3b''s enforce_revision_data_frozen() can guard this table with no new function, and so the unmeasured-runs worklist can be answered with one indexed query.';

COMMENT ON COLUMN cable_schedule.supply_routes.organisation_id IS
'Denormalised org, matching every other cable_schedule table, so the RLS predicates do not need a join. NEVER trusted from the client: the supply_routes_bind_parents BEFORE trigger overwrites whatever was submitted with the revision''s own organisation_id. A client-supplied org id that merely has to satisfy a membership predicate is how a row gets written into an org the writer is not in — the same defect found on field.form_responses in 00179 (PR #160 finding 3).';

COMMENT ON COLUMN cable_schedule.supply_routes.rise_m IS
'Vertical rise at the run, in metres, typed by the measurer. The traced polyline gives the HORIZONTAL route only; a run that climbs 3.5 m up a wall carries that as an explicit, auditable number rather than hiding it inside a slack percentage. Deliberately not an allowance table — a standard per-termination table can be added later and would compute into this same column.';

COMMENT ON COLUMN cable_schedule.supply_routes.drop_m IS
'Vertical drop at the run, in metres, typed by the measurer. Separate from rise_m rather than summed into one "vertical" figure, because a reviewer checking a schedule against a building wants to see each end.';

COMMENT ON COLUMN cable_schedule.supply_routes.traced_length_m IS
'SUM(route_segments.length_m) for this route, in metres. MAINTAINED BY TRIGGER (route_segments_traced_length), never written by the app — a hand-written value would be a second source of truth for a number the segments already determine. It is stored rather than computed on read so that total_length_m can be a STORED generated column, which in turn means the grid, the PDF and the report cannot each arrive at a slightly different total.';

COMMENT ON COLUMN cable_schedule.supply_routes.total_length_m IS
'traced_length_m + rise_m + drop_m, in metres. GENERATED ALWAYS … STORED so there is exactly one definition of the total in the system. This is the number the apply step writes to cables.measured_length_m.';

COMMENT ON COLUMN cable_schedule.supply_routes.measured_by IS
'Who traced the route. Mirrors cables.measured_length_by (00051) so the provenance of a length survives the hop from route to schedule.';

COMMENT ON COLUMN cable_schedule.supply_routes.measured_at IS
'When the route was traced. Distinct from updated_at, which also moves when a segment is re-traced or rise/drop is edited.';

CREATE INDEX IF NOT EXISTS idx_supply_routes_revision
    ON cable_schedule.supply_routes(revision_id);

-- No separate index on supply_id: supply_routes_supply_id_key already is one.

DROP TRIGGER IF EXISTS supply_routes_updated_at ON cable_schedule.supply_routes;
CREATE TRIGGER supply_routes_updated_at
    BEFORE UPDATE ON cable_schedule.supply_routes
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===========================================================================
-- 2. cable_schedule.route_segments — ordered, one per sheet crossed
-- ===========================================================================

CREATE TABLE IF NOT EXISTS cable_schedule.route_segments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id         UUID NOT NULL REFERENCES cable_schedule.supply_routes(id) ON DELETE CASCADE,
    organisation_id  UUID NOT NULL REFERENCES public.organisations(id),

    seq              INTEGER NOT NULL,

    floor_plan_id    UUID REFERENCES tenants.floor_plans(id) ON DELETE SET NULL,
    floor_plan_name  TEXT NOT NULL,
    page_index       INTEGER NOT NULL DEFAULT 1,

    points           JSONB   NOT NULL,
    pixels_per_meter NUMERIC NOT NULL,
    length_m         NUMERIC NOT NULL,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT route_segments_route_id_seq_key   UNIQUE (route_id, seq),
    CONSTRAINT route_segments_seq_positive       CHECK (seq        >= 1),
    CONSTRAINT route_segments_page_index_positive CHECK (page_index >= 1),
    -- CASE, not `jsonb_typeof(...) = 'array' AND jsonb_array_length(...)`:
    -- AND is not guaranteed to short-circuit in a CHECK expression, and
    -- jsonb_array_length() RAISES on a non-array rather than returning NULL,
    -- so the plain conjunction can fail with "cannot get array length of a
    -- non-array" instead of cleanly rejecting the row. CASE has defined
    -- evaluation order.
    CONSTRAINT route_segments_points_shape       CHECK (
        CASE WHEN jsonb_typeof(points) = 'array'
             THEN jsonb_array_length(points) >= 4
              AND jsonb_array_length(points) % 2 = 0
             ELSE FALSE
        END
    ),
    CONSTRAINT route_segments_ppm_positive       CHECK (pixels_per_meter > 0),
    CONSTRAINT route_segments_length_nonneg      CHECK (length_m >= 0)
);

COMMENT ON TABLE cable_schedule.route_segments IS
'One traced polyline per sheet the route crosses, in order. A run leaves the sheet it starts on, so a route is a list of segments rather than a single polyline: the drawing each segment was traced on is recorded, and the segments in sequence are the whole run.

THE CENTRAL DESIGN DECISION LIVES IN THIS TABLE: each segment stores the calibration that was in force at the moment it was measured (pixels_per_meter) AND the metre figure derived from it (length_m). Neither is ever recomputed. See the column comments for the defect this avoids.

Segments are replaced, not edited in place — re-tracing a sheet deletes and rewrites its row — which is why there is no updated_at. The parent''s traced_length_m is maintained by the route_segments_traced_length trigger on every insert, update and delete.';

COMMENT ON COLUMN cable_schedule.route_segments.seq IS
'Order of this segment within the route, starting at 1. UNIQUE per route. The sequence is what makes a multi-sheet run readable as one run.';

COMMENT ON COLUMN cable_schedule.route_segments.floor_plan_id IS
'The drawing this segment was traced on. NULLABLE ON PURPOSE, via ON DELETE SET NULL: cloud sync deletes and replaces drawings routinely (00175 soft-removed 21 plans on KINGSWALK and 3 on ITONKA in a single run), and a length that has been applied to a schedule must not vanish because the sheet it was scaled from was superseded. When this goes NULL the measurement survives as evidence and only the re-render of the polyline is lost — which is why floor_plan_name is a NOT NULL snapshot rather than a join.';

COMMENT ON COLUMN cable_schedule.route_segments.floor_plan_name IS
'Snapshot of the drawing name at measure time, so the condensed legend and any later enquiry can still say which sheet the segment was traced on after the drawing row is gone or renamed. NOT NULL deliberately: a legend that cannot name its sheet is not a legend.';

COMMENT ON COLUMN cable_schedule.route_segments.page_index IS
'1-based page within the drawing (every active drawing in the cable-schedule projects is a PDF, and pages of one PDF can carry different sheet scales). Calibration is therefore per drawing AND page, which is why pixels_per_meter lives here on the segment and not only on tenants.floor_plans.';

COMMENT ON COLUMN cable_schedule.route_segments.points IS
'The traced polyline as a FLAT array [x1,y1,x2,y2,…] of at least two points, in the drawing''s backing-canvas pixel space — the same space MarkupCanvas already uses for every other shape, so a 2x PDF viewport cannot make the coordinates ambiguous. The CHECK enforces array-ness, an even element count and a minimum of two points; element types are not checkable in a CHECK (no subqueries), so the writer validates them.';

COMMENT ON COLUMN cable_schedule.route_segments.pixels_per_meter IS
'THE CALIBRATION IN FORCE WHEN THIS SEGMENT WAS MEASURED, in the same backing-canvas pixel space as points, stored per segment rather than read from tenants.floor_plans.

Why it is stored here rather than looked up: the existing measure tool has a silent-rewrite defect this table must not inherit. MeasureShape (apps/web/src/app/(admin)/projects/[id]/floor-plans/[planId]/MarkupCanvas.tsx:104) stores ONLY points, and the metre readout is recomputed at render from the plan''s CURRENT pixels_per_meter (:1888-1897, `const m = pixelsPerMeter ? px / pixelsPerMeter : null`). Recalibrating a drawing therefore rewrites every measurement ever taken on it, retroactively and with no trace.

A cable length ends up on a signed schedule. It must not move under it. Storing the calibration alongside the pixels keeps the pair self-consistent forever; when the drawing is later recalibrated the app raises a flag offering re-measurement, and a human decides. It never quietly changes the answer.';

COMMENT ON COLUMN cable_schedule.route_segments.length_m IS
'The metre length of this segment, derived at measure time from points and pixels_per_meter, and NEVER RECOMPUTED afterwards.

This is the same decision as pixels_per_meter, stated for the value rather than the divisor: a view that re-derived metres from the drawing''s present calibration would reintroduce exactly the silent rewrite described on that column, on the one number that reaches an issued schedule. Stored and frozen is the point of the design, not an optimisation.

A consequence worth knowing: if points or pixels_per_meter are ever edited without length_m being rewritten by the same writer, the three disagree. Nothing in the DB can detect that, because "correct" is defined by what the measurer saw. Segments are therefore replaced wholesale rather than patched.';

CREATE INDEX IF NOT EXISTS idx_route_segments_floor_plan
    ON cable_schedule.route_segments(floor_plan_id)
    WHERE floor_plan_id IS NOT NULL;

-- No separate (route_id, seq) index: route_segments_route_id_seq_key already
-- is one, and it is the index the ordered read uses. A duplicate would cost a
-- write on every segment insert and buy nothing.

-- ===========================================================================
-- 3. Parent binding — organisation_id is derived, never accepted
-- ===========================================================================
-- SECURITY INVOKER, deliberately: the parent lookups run under the caller's
-- own RLS, so a write naming a revision or route the caller cannot see fails
-- closed with "not found or not visible" instead of quietly succeeding.
-- SECURITY DEFINER here would ADD reach rather than remove it.

CREATE OR REPLACE FUNCTION cable_schedule.bind_supply_route_parents()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_org_id     UUID;
    v_sup_rev_id UUID;
BEGIN
    -- Cheap exit for the common UPDATE (rise/drop edits, and the traced_length
    -- recompute the segment trigger fires on every segment write).
    IF TG_OP = 'UPDATE'
       AND NEW.revision_id     = OLD.revision_id
       AND NEW.supply_id       = OLD.supply_id
       AND NEW.organisation_id = OLD.organisation_id THEN
        RETURN NEW;
    END IF;

    SELECT r.organisation_id INTO v_org_id
    FROM cable_schedule.revisions r
    WHERE r.id = NEW.revision_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'cable_schedule.supply_routes: revision % not found or not visible', NEW.revision_id
            USING ERRCODE = 'raise_exception';
    END IF;

    SELECT s.revision_id INTO v_sup_rev_id
    FROM cable_schedule.supplies s
    WHERE s.id = NEW.supply_id;

    IF v_sup_rev_id IS NULL THEN
        RAISE EXCEPTION 'cable_schedule.supply_routes: supply % not found or not visible', NEW.supply_id
            USING ERRCODE = 'raise_exception';
    END IF;

    IF v_sup_rev_id <> NEW.revision_id THEN
        RAISE EXCEPTION 'cable_schedule.supply_routes: supply % belongs to revision %, not % — a route must sit in its own supply''s revision', NEW.supply_id, v_sup_rev_id, NEW.revision_id
            USING ERRCODE = 'raise_exception';
    END IF;

    -- Derived, not accepted. Whatever the client sent is discarded.
    NEW.organisation_id := v_org_id;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION cable_schedule.bind_supply_route_parents() IS
'BEFORE INSERT/UPDATE on supply_routes: overwrites organisation_id with the revision''s own org and rejects a route whose supply lives in a different revision. Closes the "client-supplied organisation_id satisfies a membership predicate for an org the writer is not in" hole (00179 / PR #160 finding 3) and keeps the denormalised revision_id honest. SECURITY INVOKER on purpose — the lookups run under the caller''s RLS and fail closed.';

CREATE OR REPLACE FUNCTION cable_schedule.bind_route_segment_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_org_id UUID;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.route_id        = OLD.route_id
       AND NEW.organisation_id = OLD.organisation_id THEN
        RETURN NEW;
    END IF;

    SELECT sr.organisation_id INTO v_org_id
    FROM cable_schedule.supply_routes sr
    WHERE sr.id = NEW.route_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'cable_schedule.route_segments: route % not found or not visible', NEW.route_id
            USING ERRCODE = 'raise_exception';
    END IF;

    NEW.organisation_id := v_org_id;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION cable_schedule.bind_route_segment_parent() IS
'BEFORE INSERT/UPDATE on route_segments: overwrites organisation_id with the parent route''s org, so a segment can never be filed under an org the route does not belong to. SECURITY INVOKER on purpose — see bind_supply_route_parents().';

DROP TRIGGER IF EXISTS supply_routes_bind_parents ON cable_schedule.supply_routes;
CREATE TRIGGER supply_routes_bind_parents
    BEFORE INSERT OR UPDATE ON cable_schedule.supply_routes
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.bind_supply_route_parents();

DROP TRIGGER IF EXISTS route_segments_bind_parent ON cable_schedule.route_segments;
CREATE TRIGGER route_segments_bind_parent
    BEFORE INSERT OR UPDATE ON cable_schedule.route_segments
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.bind_route_segment_parent();

-- ===========================================================================
-- 4. traced_length_m maintenance
-- ===========================================================================

CREATE OR REPLACE FUNCTION cable_schedule.recompute_route_traced_length()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_route_ids UUID[];
    v_route_id  UUID;
BEGIN
    -- Nothing that affects the sum changed.
    IF TG_OP = 'UPDATE'
       AND NEW.route_id = OLD.route_id
       AND NEW.length_m = OLD.length_m THEN
        RETURN NULL;
    END IF;

    v_route_ids := CASE
        WHEN TG_OP = 'INSERT' THEN ARRAY[NEW.route_id]
        WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.route_id]
        ELSE ARRAY[OLD.route_id, NEW.route_id]   -- a re-pointed segment touches both
    END;

    FOR v_route_id IN SELECT DISTINCT x FROM unnest(v_route_ids) AS x LOOP
        UPDATE cable_schedule.supply_routes sr
        SET traced_length_m = COALESCE((
                SELECT SUM(rs.length_m)
                FROM cable_schedule.route_segments rs
                WHERE rs.route_id = sr.id
            ), 0),
            updated_at = now()
        WHERE sr.id = v_route_id;
    END LOOP;

    RETURN NULL;   -- AFTER trigger: return value is ignored
END;
$$;

COMMENT ON FUNCTION cable_schedule.recompute_route_traced_length() IS
'AFTER INSERT/UPDATE/DELETE on route_segments: rewrites the parent route''s traced_length_m as COALESCE(SUM(length_m), 0) and bumps updated_at, so total_length_m (a STORED generated column) is recomputed in the same statement. Both the old and the new parent are refreshed when a segment is moved between routes.

SECURITY INVOKER, deliberately. The UPDATE runs under the caller''s own RLS and grants on supply_routes — which the writer necessarily satisfies, having just written a segment of that route — and it therefore also passes back through supply_routes'' own freeze guard, so a route total can never be nudged under an ISSUED revision by a side door. A SECURITY DEFINER version would bypass both and would be the more privileged thing, not the safer one. (If one is ever needed, note 00168''s rule: current_user reports the function OWNER inside a definer function and must never be used for authorisation — read the `role` GUC instead.)

Deleting a route cascades its segments; the UPDATE then matches zero rows, which is correct and cheap.';

DROP TRIGGER IF EXISTS route_segments_traced_length ON cable_schedule.route_segments;
CREATE TRIGGER route_segments_traced_length
    AFTER INSERT OR UPDATE OR DELETE ON cable_schedule.route_segments
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.recompute_route_traced_length();

-- ===========================================================================
-- 5. Revision freeze (00168 §3b / §3c)
-- ===========================================================================
-- 00168's guards are attached PER TABLE with an explicit CREATE TRIGGER —
-- there is no event trigger and no "all children" mechanism, so a new child
-- table is UNPROTECTED until it is named here. Both new tables are named.
--
-- supply_routes -> reuse cable_schedule.enforce_revision_data_frozen() (§3b)
-- verbatim. That function is generic over any table carrying a revision_id
-- column: it reads NEW/OLD.revision_id, looks the status up, allows the
-- v_status IS NULL path (an authorised ON DELETE CASCADE, where the parent row
-- is already gone), and re-checks the target on a revision_id change. Nothing
-- in it is specific to sources / supplies / cables / cost_lines. Reusing it is
-- also why supply_routes carries revision_id at all.
--
-- route_segments -> needs a SIBLING function. §3c's enforce_cable_child_frozen()
-- is the right SHAPE (child reaches the revision through a parent id) but is
-- hardcoded to cable_id, joins through cable_schedule.cables, and carries the
-- cable_tags printed-bookkeeping exemption. Generalising it would mean either
-- a second signature or dynamic SQL over TG_TABLE_NAME, and would put the tag
-- exemption on a code path that must never have one. enforce_route_segment_frozen()
-- below is §3c with the cable_id join swapped for the route_id join and the
-- exemption dropped — there is no legitimate post-issue mutation of a route
-- segment, unlike printing a tag.
--
-- Role detection copied from 00168 verbatim and for the same reason: inside a
-- SECURITY DEFINER function current_user reports the function OWNER, so it
-- cannot identify the caller and MUST NOT be used for authorisation. The `role`
-- GUC can — PostgREST issues SET ROLE per request, and entering a definer
-- function does not change it. Direct connections (migrations, psql) read
-- 'none' and bypass, which is what lets a later repair migration fix data.

DROP TRIGGER IF EXISTS supply_routes_frozen_guard ON cable_schedule.supply_routes;
CREATE TRIGGER supply_routes_frozen_guard
    BEFORE INSERT OR UPDATE OR DELETE ON cable_schedule.supply_routes
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.enforce_revision_data_frozen();

CREATE OR REPLACE FUNCTION cable_schedule.enforce_route_segment_frozen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_route_id UUID;
    v_status   TEXT;
BEGIN
    IF COALESCE(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon') THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    v_route_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.route_id ELSE OLD.route_id END;

    SELECT rev.status INTO v_status
    FROM cable_schedule.supply_routes sr
    JOIN cable_schedule.revisions rev ON rev.id = sr.revision_id
    WHERE sr.id = v_route_id;

    -- Parent route already gone -> part of an authorised ON DELETE CASCADE
    -- (the route delete itself was guarded by supply_routes_frozen_guard).
    IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'cable_schedule.route_segments: revision is % — the issued snapshot is frozen; start a new revision to re-measure', v_status
            USING ERRCODE = 'raise_exception';
    END IF;

    -- Re-pointing a segment at another route must also target a DRAFT route.
    IF TG_OP = 'UPDATE' AND NEW.route_id IS DISTINCT FROM OLD.route_id THEN
        SELECT rev.status INTO v_status
        FROM cable_schedule.supply_routes sr
        JOIN cable_schedule.revisions rev ON rev.id = sr.revision_id
        WHERE sr.id = NEW.route_id;
        IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
            RAISE EXCEPTION 'cable_schedule.route_segments: target route belongs to a % revision — cannot move segments into a frozen revision', v_status
                USING ERRCODE = 'raise_exception';
        END IF;
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

COMMENT ON FUNCTION cable_schedule.enforce_route_segment_frozen() IS
'Sibling of 00168 §3c''s enforce_cable_child_frozen(), for the route_id parent path. Blocks INSERT/UPDATE/DELETE of a route segment whose revision is ISSUED or SUPERSEDED, for the PostgREST end-user roles only.

Why a sibling rather than a reuse: §3c hardcodes cable_id, joins through cable_schedule.cables, and carries the cable_tags printed-bookkeeping exemption — the one legitimate post-issue mutation in that family. A route segment has no such exemption and must not sit on a code path that has one. §3b''s enforce_revision_data_frozen() IS reused unchanged for supply_routes, which carries revision_id directly.

Authorisation reads the `role` GUC, never current_user: inside a SECURITY DEFINER function current_user is the function OWNER and is true for every caller, which is exactly how the 00179 state-transition trigger shipped inert (PR #160 finding 2).';

DROP TRIGGER IF EXISTS route_segments_frozen_guard ON cable_schedule.route_segments;
CREATE TRIGGER route_segments_frozen_guard
    BEFORE INSERT OR UPDATE OR DELETE ON cable_schedule.route_segments
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.enforce_route_segment_frozen();

-- ===========================================================================
-- 6. Write authority helper
-- ===========================================================================
-- The role set that may edit a DRAFT cable schedule is ORG_WRITE_ROLES —
-- owner / admin / project_manager (packages/shared/src/types/index.ts:37).
-- Every cable-schedule server action reaches it the same way:
-- requireRoleForRevision(supabase, revisionId, ROLES_ENGINEER)
-- (apps/web/src/lib/cable-schedule/require-role.ts), where ROLES_ENGINEER is
-- an alias of ORG_WRITE_ROLES and requireRole() reads public.user_organisations
-- for the revision's org. Hence: org-level role, not effective project role.
--
-- Page gating is not a gate. PostgREST is a public HTTP surface and an
-- authenticated session can POST straight at these tables, so the same set is
-- enforced here.
--
-- NOTE that this is TIGHTER than the 00051 sibling policies (sup_write /
-- cab_write), which allow ANY org member who is not a client_viewer — that
-- means contractor, inspector and supplier can rewrite a DRAFT schedule over
-- raw REST today. That gap is not in scope to fix here, but it is deliberately
-- not inherited: these tables are new, so there is no existing caller to break.

CREATE OR REPLACE FUNCTION cable_schedule.user_can_edit_schedule(p_organisation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_organisations uo
    WHERE uo.user_id         = auth.uid()
      AND uo.organisation_id = p_organisation_id
      AND uo.is_active
      AND uo.role IN ('owner', 'admin', 'project_manager')
  );
$function$;

COMMENT ON FUNCTION cable_schedule.user_can_edit_schedule(UUID) IS
'TRUE when the caller holds an active owner / admin / project_manager role in the given organisation — ORG_WRITE_ROLES, the exact set requireRoleForRevision(…, ROLES_ENGINEER) enforces on every cable-schedule write action. Returns FALSE (never NULL) for a non-member, so it is safe inside a RESTRICTIVE USING clause: NULL IN (…) is NULL, and a NULL there reads as "no row" rather than "denied", which is the trap 00183 hit with user_effective_project_role.

SECURITY DEFINER with row_security off so the lookup does not depend on the caller''s visibility of public.user_organisations.';

REVOKE ALL ON FUNCTION cable_schedule.user_can_edit_schedule(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cable_schedule.user_can_edit_schedule(UUID) TO authenticated, service_role;

-- Trigger functions are invoked by the trigger machinery, not called by name,
-- so they need no EXECUTE grant to anybody. REVOKE from PUBLIC *and* explicitly
-- from anon: Supabase's bootstrap ALTER DEFAULT PRIVILEGES grants anon EXECUTE
-- DIRECTLY at creation time, which is a separate grant that REVOKE … FROM PUBLIC
-- does not touch (the 00162 finding; 00186 then swept the whole database).
-- Verify with has_function_privilege('anon', oid, 'EXECUTE'), never by reading
-- proacl — a NULL proacl looks empty but IS the PUBLIC grant.
REVOKE ALL ON FUNCTION cable_schedule.bind_supply_route_parents()    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION cable_schedule.bind_route_segment_parent()    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION cable_schedule.enforce_route_segment_frozen() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION cable_schedule.recompute_route_traced_length() FROM PUBLIC, anon;

-- ===========================================================================
-- 7. Row-level security
-- ===========================================================================

ALTER TABLE cable_schedule.supply_routes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cable_schedule.route_segments ENABLE ROW LEVEL SECURITY;

-- ── SELECT — mirrors sup_select / cab_select (00051) exactly ────────────────
-- Org members read their org's routes; a client_viewer reads only where they
-- hold an active projects.project_members row for the revision's project. The
-- condensed legend and the read-only schedule view both need routes wherever
-- supplies are already readable, so the read surface matches supplies rather
-- than being narrower.

DROP POLICY IF EXISTS "route_select" ON cable_schedule.supply_routes;
CREATE POLICY "route_select"
    ON cable_schedule.supply_routes FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM cable_schedule.revisions r
                JOIN projects.project_members pm ON pm.project_id = r.project_id
                WHERE r.id = supply_routes.revision_id
                  AND pm.user_id = auth.uid() AND pm.is_active = TRUE
            )
        )
    );

DROP POLICY IF EXISTS "segment_select" ON cable_schedule.route_segments;
CREATE POLICY "segment_select"
    ON cable_schedule.route_segments FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1
                FROM cable_schedule.supply_routes sr
                JOIN cable_schedule.revisions r      ON r.id = sr.revision_id
                JOIN projects.project_members pm     ON pm.project_id = r.project_id
                WHERE sr.id = route_segments.route_id
                  AND pm.user_id = auth.uid() AND pm.is_active = TRUE
            )
        )
    );

-- ── Writes — permissive (00051 family shape) ────────────────────────────────
-- Kept in the sibling tables' shape so the family reads consistently. This is
-- NOT the effective gate; the RESTRICTIVE trio below is. Both predicates must
-- pass, so if someone later copies a 00051-shaped policy onto these tables the
-- role gate still holds.

DROP POLICY IF EXISTS "route_write" ON cable_schedule.supply_routes;
CREATE POLICY "route_write" ON cable_schedule.supply_routes FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids())
                AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids())
                AND NOT public.user_is_client_viewer(organisation_id));

DROP POLICY IF EXISTS "segment_write" ON cable_schedule.route_segments;
CREATE POLICY "segment_write" ON cable_schedule.route_segments FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids())
                AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids())
                AND NOT public.user_is_client_viewer(organisation_id));

-- ── Writes — RESTRICTIVE role gate (the 00177 pattern) ──────────────────────
-- Scoped to INSERT / UPDATE / DELETE only. A RESTRICTIVE FOR ALL would also
-- restrict SELECT and would cut off exactly the project-scoped client_viewer
-- read that route_select deliberately allows.
-- organisation_id is safe to key on here because the BEFORE triggers in §3
-- derive it from the parent, so it is the revision's org and not the client's
-- claim by the time these WITH CHECKs run.

DROP POLICY IF EXISTS "route_write_authz_insert" ON cable_schedule.supply_routes;
DROP POLICY IF EXISTS "route_write_authz_update" ON cable_schedule.supply_routes;
DROP POLICY IF EXISTS "route_write_authz_delete" ON cable_schedule.supply_routes;

CREATE POLICY "route_write_authz_insert" ON cable_schedule.supply_routes
    AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (cable_schedule.user_can_edit_schedule(organisation_id));

CREATE POLICY "route_write_authz_update" ON cable_schedule.supply_routes
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING      (cable_schedule.user_can_edit_schedule(organisation_id))
    WITH CHECK (cable_schedule.user_can_edit_schedule(organisation_id));

CREATE POLICY "route_write_authz_delete" ON cable_schedule.supply_routes
    AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (cable_schedule.user_can_edit_schedule(organisation_id));

DROP POLICY IF EXISTS "segment_write_authz_insert" ON cable_schedule.route_segments;
DROP POLICY IF EXISTS "segment_write_authz_update" ON cable_schedule.route_segments;
DROP POLICY IF EXISTS "segment_write_authz_delete" ON cable_schedule.route_segments;

CREATE POLICY "segment_write_authz_insert" ON cable_schedule.route_segments
    AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (cable_schedule.user_can_edit_schedule(organisation_id));

CREATE POLICY "segment_write_authz_update" ON cable_schedule.route_segments
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING      (cable_schedule.user_can_edit_schedule(organisation_id))
    WITH CHECK (cable_schedule.user_can_edit_schedule(organisation_id));

CREATE POLICY "segment_write_authz_delete" ON cable_schedule.route_segments
    AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (cable_schedule.user_can_edit_schedule(organisation_id));

-- ===========================================================================
-- 8. Grants
-- ===========================================================================
-- Supabase's bootstrap ALTER DEFAULT PRIVILEGES grants anon AND authenticated
-- arwdDxtm on a new table — INSERT, UPDATE, DELETE and TRUNCATE, not merely
-- SELECT — and 00052 adds its own schema-level defaults on top for
-- cable_schedule. A new table here is therefore born writable by anon. REVOKE
-- ALL first, then grant back exactly what the policies gate.
--
-- Verify with has_table_privilege('anon', 'cable_schedule.supply_routes',
-- 'INSERT') and friends. NEVER by reading relacl: a NULL relacl is not "no
-- grants", it is the default PUBLIC grant.
--
-- anon gets nothing at all. RLS already returns zero rows to anon
-- (get_user_org_ids() is empty without a session), but 00168 §2 removed the
-- standing anon SELECT across this schema precisely so a future RLS slip
-- cannot leak to anonymous callers; these tables start in that state.

REVOKE ALL ON cable_schedule.supply_routes  FROM anon, authenticated;
REVOKE ALL ON cable_schedule.route_segments FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON cable_schedule.supply_routes  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON cable_schedule.route_segments TO authenticated;

GRANT ALL ON cable_schedule.supply_routes  TO service_role;
GRANT ALL ON cable_schedule.route_segments TO service_role;

-- New tables in an existing schema: the schema cache reload is enough.
NOTIFY pgrst, 'reload schema';
