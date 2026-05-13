-- =============================================================================
-- Migration 00051 — Cable Schedule core schema
-- =============================================================================
-- Background:
--   First migration of the LV/MV Cable Schedule Manager (full spec in
--   SPEC DOCS/cable-schedule/WEB_APP_BUILD_PROMPT.md). Lands the 9 core
--   entities the schedule grid + calculations + tag schedule + cost
--   summary all read from. SANS reference data (Tables 4.2, 4.3.x, 5.2.x,
--   6.x) lands in a follow-up migration with its own schema so the
--   reference library stays cleanly separable from project data.
--
-- Schema delta:
--   + new schema `cable_schedule`
--   + revisions          (DRAFT|ISSUED|SUPERSEDED, one DRAFT per project)
--   + sources            (RMU / Mini Sub / Standby / PV / Utility)
--   + boards             (Main Boards + tenant DBs, self-referential)
--   + supplies           (logical feed from Source/Board → Board)
--   + cables             (1..N physical cables per supply, parallel set)
--   + terminations       (gland + lug per cable end)
--   + cable_tags         (one per termination, QR-encoded for site marking)
--   + cost_lines         (per-size supply/install/termination rates per revision)
--   + change_log         (per-field audit, every UPDATE writes a row)
--   + storage.buckets 'cable-schedule-evidence' (50 MB, images + PDF)
--
-- Revisioning model:
--   Each Revision owns its own immutable set of sources/boards/supplies/
--   cables/cost_lines (rows reference revision_id directly). Issuing a
--   draft flips status DRAFT → ISSUED and locks edits via app-side checks;
--   starting the next revision copies all rows into a new DRAFT.
--   Older revisions are read-only and persist forever for the drawing
--   register.
--
-- RLS model:
--   Org members (owner / admin / project_manager / field_worker) read +
--   write within their org. client_viewer scoped to project_members
--   (read-only). Same shape as procurement / RFI / floor plans.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS cable_schedule;

-- ─── helper: PostgREST exposure ─────────────────────────────────────────
GRANT USAGE ON SCHEMA cable_schedule TO authenticated, service_role, anon;

-- ───────────────────────────────────────────────────────────────────────
-- 1. revisions
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cable_schedule.revisions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    code                TEXT NOT NULL,                       -- "Rev 0", "Rev 1", "Rev 8"
    description         TEXT,
    status              TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'ISSUED', 'SUPERSEDED')),
    issued_at           TIMESTAMPTZ,
    issued_by           UUID REFERENCES public.profiles(id),
    change_notes        TEXT,                                -- markdown
    -- Fault level at the source feeder (kA) — drives short-circuit checks
    -- on every cable in the revision. Captured here so each issued snapshot
    -- carries the assumption it was designed under.
    fault_level_ka      NUMERIC,
    created_by          UUID REFERENCES public.profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, code)
);

-- Exactly one DRAFT revision per project at a time.
CREATE UNIQUE INDEX IF NOT EXISTS one_draft_per_project
    ON cable_schedule.revisions(project_id)
    WHERE status = 'DRAFT';

CREATE INDEX IF NOT EXISTS idx_cable_revisions_project
    ON cable_schedule.revisions(project_id);
CREATE INDEX IF NOT EXISTS idx_cable_revisions_status
    ON cable_schedule.revisions(status);

CREATE TRIGGER cable_revisions_updated_at
    BEFORE UPDATE ON cable_schedule.revisions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────
-- 2. sources  (upstream feeders)
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cable_schedule.sources (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id         UUID NOT NULL REFERENCES cable_schedule.revisions(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    code                TEXT NOT NULL,                       -- "MINI SUB 1", "RMU"
    type                TEXT NOT NULL CHECK (type IN ('MINISUB','STANDBY','PV','UTILITY','RMU')),
    rating_kva          NUMERIC,
    voltage_v           NUMERIC,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (revision_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cable_sources_revision
    ON cable_schedule.sources(revision_id);

CREATE TRIGGER cable_sources_updated_at
    BEFORE UPDATE ON cable_schedule.sources
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────
-- 3. boards  (Main Boards + tenant DBs)
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cable_schedule.boards (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id         UUID NOT NULL REFERENCES cable_schedule.revisions(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    code                TEXT NOT NULL,                       -- "MAIN BOARD 1.1", "DB-12"
    tenant_name         TEXT,
    area_m2             NUMERIC,
    breaker_rating_a    NUMERIC,
    pole_config         TEXT CHECK (pole_config IS NULL OR pole_config IN ('SP','TP')),
    section             TEXT CHECK (section IS NULL OR section IN ('NORMAL','EMERGENCY','MIXED')),
    parent_board_id     UUID REFERENCES cable_schedule.boards(id) ON DELETE SET NULL,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (revision_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cable_boards_revision
    ON cable_schedule.boards(revision_id);
CREATE INDEX IF NOT EXISTS idx_cable_boards_parent
    ON cable_schedule.boards(parent_board_id)
    WHERE parent_board_id IS NOT NULL;

CREATE TRIGGER cable_boards_updated_at
    BEFORE UPDATE ON cable_schedule.boards
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────
-- 4. supplies  (logical feed)
-- ───────────────────────────────────────────────────────────────────────
-- A supply has exactly ONE origin: from_source_id XOR from_board_id.
-- The CHECK enforces it so we never end up with both or neither.
CREATE TABLE IF NOT EXISTS cable_schedule.supplies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id         UUID NOT NULL REFERENCES cable_schedule.revisions(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    from_source_id      UUID REFERENCES cable_schedule.sources(id) ON DELETE CASCADE,
    from_board_id       UUID REFERENCES cable_schedule.boards(id)  ON DELETE CASCADE,
    to_board_id         UUID NOT NULL REFERENCES cable_schedule.boards(id) ON DELETE CASCADE,
    voltage_v           NUMERIC NOT NULL CHECK (voltage_v IN (230, 400, 525, 1000, 3300, 6600, 11000)),
    design_load_a       NUMERIC NOT NULL CHECK (design_load_a > 0),
    section             TEXT CHECK (section IS NULL OR section IN ('NORMAL','EMERGENCY')),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- exactly one origin
    CHECK ((from_source_id IS NOT NULL)::int + (from_board_id IS NOT NULL)::int = 1)
);

CREATE INDEX IF NOT EXISTS idx_cable_supplies_revision
    ON cable_schedule.supplies(revision_id);
CREATE INDEX IF NOT EXISTS idx_cable_supplies_from_board
    ON cable_schedule.supplies(from_board_id)
    WHERE from_board_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cable_supplies_from_source
    ON cable_schedule.supplies(from_source_id)
    WHERE from_source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cable_supplies_to_board
    ON cable_schedule.supplies(to_board_id);

CREATE TRIGGER cable_supplies_updated_at
    BEFORE UPDATE ON cable_schedule.supplies
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────
-- 5. cables  (physical cable, N per supply for parallel runs)
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cable_schedule.cables (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supply_id                   UUID NOT NULL REFERENCES cable_schedule.supplies(id) ON DELETE CASCADE,
    revision_id                 UUID NOT NULL REFERENCES cable_schedule.revisions(id) ON DELETE CASCADE,
    organisation_id             UUID NOT NULL REFERENCES public.organisations(id),
    cable_no                    INTEGER NOT NULL CHECK (cable_no >= 1),
    -- physical
    size_mm2                    NUMERIC NOT NULL CHECK (size_mm2 > 0),
    cores                       TEXT NOT NULL CHECK (cores IN ('3','3+E','4')),
    conductor                   TEXT NOT NULL CHECK (conductor IN ('CU','AL')),
    insulation                  TEXT NOT NULL CHECK (insulation IN ('PVC','XLPE','PILC')),
    armour                      TEXT CHECK (armour IS NULL OR armour IN ('SWA','UNARMOURED')),
    standard                    TEXT,                        -- "SANS 1507-3", "SANS 1339"…
    -- design length (Designer role)
    measured_length_m           NUMERIC CHECK (measured_length_m IS NULL OR measured_length_m >= 0),
    measured_length_by          UUID REFERENCES public.profiles(id),
    measured_length_at          TIMESTAMPTZ,
    measured_length_method      TEXT CHECK (measured_length_method IS NULL
                                            OR measured_length_method IN ('CAD','SCALE_RULE','MANUAL')),
    -- site length (Site Operator + Verifier roles)
    confirmed_length_m          NUMERIC CHECK (confirmed_length_m IS NULL OR confirmed_length_m >= 0),
    confirmed_length_by         UUID REFERENCES public.profiles(id),
    confirmed_length_at         TIMESTAMPTZ,
    confirmed_length_method     TEXT CHECK (confirmed_length_method IS NULL
                                            OR confirmed_length_method IN ('PULL_TAPE','LASER','DRUM_MARKING','REEL_LABEL')),
    length_status               TEXT NOT NULL DEFAULT 'UNMEASURED'
                                CHECK (length_status IN ('UNMEASURED','MEASURED','CONFIRMED','DISCREPANCY')),
    confirmation_evidence_url   TEXT,                        -- path in 'cable-schedule-evidence' bucket
    confirmation_notes          TEXT,
    -- installation
    installation_method         TEXT CHECK (installation_method IS NULL
                                            OR installation_method IN ('DIRECT_IN_GROUND','DUCT','LADDER','TRAY','CLIPPED')),
    depth_mm                    INTEGER,
    grouped_with                INTEGER NOT NULL DEFAULT 1 CHECK (grouped_with >= 1),
    ambient_temp_c              NUMERIC NOT NULL DEFAULT 30,
    thermal_resistivity_kmw     NUMERIC NOT NULL DEFAULT 1.0,
    -- electrical
    ohm_per_km                  NUMERIC,
    x_per_km                    NUMERIC,
    derate_depth                NUMERIC,
    derate_thermal              NUMERIC,
    derate_grouping             NUMERIC,
    derate_temp                 NUMERIC,
    derated_current_rating_a    NUMERIC,
    -- overrides + audit
    tag_override                TEXT,                        -- user-supplied tag (e.g. when B column was used)
    manual_override             BOOLEAN NOT NULL DEFAULT FALSE,  -- user typed ohm_per_km manually
    size_derived_from_load      BOOLEAN NOT NULL DEFAULT FALSE,  -- size came from an IF-chain on load (importer)
    import_warning              BOOLEAN NOT NULL DEFAULT FALSE,  -- import had a #VALUE!/#N/A on this row
    notes                       TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (supply_id, cable_no)
);

CREATE INDEX IF NOT EXISTS idx_cables_revision        ON cable_schedule.cables(revision_id);
CREATE INDEX IF NOT EXISTS idx_cables_supply          ON cable_schedule.cables(supply_id);
CREATE INDEX IF NOT EXISTS idx_cables_length_status   ON cable_schedule.cables(length_status)
    WHERE length_status IN ('MEASURED','DISCREPANCY');
CREATE INDEX IF NOT EXISTS idx_cables_size            ON cable_schedule.cables(revision_id, size_mm2);

CREATE TRIGGER cables_updated_at
    BEFORE UPDATE ON cable_schedule.cables
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────
-- 6. terminations
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cable_schedule.terminations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cable_id            UUID NOT NULL REFERENCES cable_schedule.cables(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    end_position        TEXT NOT NULL CHECK (end_position IN ('FROM','TO')),
    gland_type          TEXT,                                -- "BW", "CW", "E1W" …
    lug_size_mm2        NUMERIC,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cable_id, end_position)
);

CREATE INDEX IF NOT EXISTS idx_terminations_cable
    ON cable_schedule.terminations(cable_id);

-- ───────────────────────────────────────────────────────────────────────
-- 7. cable_tags  (Critchley-style site marking)
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cable_schedule.cable_tags (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cable_id            UUID NOT NULL REFERENCES cable_schedule.cables(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    end_position        TEXT NOT NULL CHECK (end_position IN ('FROM','TO')),
    tag_text            TEXT NOT NULL,                       -- "{FROM}-{TO}-{SIZE}-{N}"
    qr_payload          JSONB NOT NULL,                      -- {p, s, c, r}
    printed             BOOLEAN NOT NULL DEFAULT FALSE,
    printed_at          TIMESTAMPTZ,
    printed_by          UUID REFERENCES public.profiles(id),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (cable_id, end_position)
);

CREATE INDEX IF NOT EXISTS idx_cable_tags_unprinted
    ON cable_schedule.cable_tags(cable_id)
    WHERE printed = FALSE;

-- ───────────────────────────────────────────────────────────────────────
-- 8. cost_lines  (per revision, per size)
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cable_schedule.cost_lines (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id                 UUID NOT NULL REFERENCES cable_schedule.revisions(id) ON DELETE CASCADE,
    organisation_id             UUID NOT NULL REFERENCES public.organisations(id),
    size_mm2                    NUMERIC NOT NULL CHECK (size_mm2 > 0),
    supply_rate_per_m           NUMERIC NOT NULL DEFAULT 0 CHECK (supply_rate_per_m >= 0),
    install_rate_per_m          NUMERIC NOT NULL DEFAULT 0 CHECK (install_rate_per_m >= 0),
    termination_rate_each       NUMERIC NOT NULL DEFAULT 0 CHECK (termination_rate_each >= 0),
    contingency_pct             NUMERIC,                     -- only the revision-level one carries this
    vat_pct                     NUMERIC,
    notes                       TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (revision_id, size_mm2)
);

CREATE INDEX IF NOT EXISTS idx_cost_lines_revision
    ON cable_schedule.cost_lines(revision_id);

CREATE TRIGGER cost_lines_updated_at
    BEFORE UPDATE ON cable_schedule.cost_lines
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ───────────────────────────────────────────────────────────────────────
-- 9. change_log  (per-field audit; importer + length workflow + every UPDATE)
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cable_schedule.change_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id         UUID NOT NULL REFERENCES cable_schedule.revisions(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    entity_type         TEXT NOT NULL,                       -- "cable", "supply", "import", "length-confirmation"…
    entity_id           UUID,                                -- nullable for project-level events (e.g. "import")
    field_name          TEXT,
    old_value           JSONB,
    new_value           JSONB,
    reason              TEXT,
    changed_by          UUID REFERENCES public.profiles(id),
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_change_log_revision
    ON cable_schedule.change_log(revision_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_log_entity
    ON cable_schedule.change_log(entity_type, entity_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_log_user
    ON cable_schedule.change_log(changed_by, changed_at DESC);

-- ===========================================================================
-- Row-level security
-- ===========================================================================

-- Tables that carry organisation_id directly: rev / src / boards / supplies /
-- cables / cost_lines / change_log / cable_tags / terminations (denormalised).
-- The policy shape mirrors tenants.documents / projects.procurement_quotes
-- from earlier migrations.

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'revisions', 'sources', 'boards', 'supplies', 'cables',
        'terminations', 'cable_tags', 'cost_lines', 'change_log'
    ])
    LOOP
        EXECUTE format('ALTER TABLE cable_schedule.%I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

-- revisions
CREATE POLICY "rev_select_org_and_scoped_clients"
    ON cable_schedule.revisions FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM projects.project_members pm
                WHERE pm.project_id = revisions.project_id
                  AND pm.user_id   = auth.uid()
                  AND pm.is_active = TRUE
            )
        )
    );
CREATE POLICY "rev_write_org_members"
    ON cable_schedule.revisions FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids())
                AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids())
                AND NOT public.user_is_client_viewer(organisation_id));

-- sources / boards / supplies / cables / cost_lines / change_log: scoped
-- through their own revision_id column.
CREATE POLICY "src_select"
    ON cable_schedule.sources FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM cable_schedule.revisions r
                JOIN projects.project_members pm ON pm.project_id = r.project_id
                WHERE r.id = sources.revision_id
                  AND pm.user_id = auth.uid() AND pm.is_active = TRUE
            )
        )
    );
CREATE POLICY "src_write" ON cable_schedule.sources FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

CREATE POLICY "brd_select"
    ON cable_schedule.boards FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM cable_schedule.revisions r
                JOIN projects.project_members pm ON pm.project_id = r.project_id
                WHERE r.id = boards.revision_id
                  AND pm.user_id = auth.uid() AND pm.is_active = TRUE
            )
        )
    );
CREATE POLICY "brd_write" ON cable_schedule.boards FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

CREATE POLICY "sup_select"
    ON cable_schedule.supplies FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM cable_schedule.revisions r
                JOIN projects.project_members pm ON pm.project_id = r.project_id
                WHERE r.id = supplies.revision_id
                  AND pm.user_id = auth.uid() AND pm.is_active = TRUE
            )
        )
    );
CREATE POLICY "sup_write" ON cable_schedule.supplies FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

CREATE POLICY "cab_select"
    ON cable_schedule.cables FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM cable_schedule.revisions r
                JOIN projects.project_members pm ON pm.project_id = r.project_id
                WHERE r.id = cables.revision_id
                  AND pm.user_id = auth.uid() AND pm.is_active = TRUE
            )
        )
    );
CREATE POLICY "cab_write" ON cable_schedule.cables FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

CREATE POLICY "cl_select"
    ON cable_schedule.cost_lines FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM cable_schedule.revisions r
                JOIN projects.project_members pm ON pm.project_id = r.project_id
                WHERE r.id = cost_lines.revision_id
                  AND pm.user_id = auth.uid() AND pm.is_active = TRUE
            )
        )
    );
CREATE POLICY "cl_write" ON cable_schedule.cost_lines FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

CREATE POLICY "chg_select"
    ON cable_schedule.change_log FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM cable_schedule.revisions r
                JOIN projects.project_members pm ON pm.project_id = r.project_id
                WHERE r.id = change_log.revision_id
                  AND pm.user_id = auth.uid() AND pm.is_active = TRUE
            )
        )
    );
CREATE POLICY "chg_write" ON cable_schedule.change_log FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

-- terminations + cable_tags reach the revision via their cable.
CREATE POLICY "trm_select"
    ON cable_schedule.terminations FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1
                FROM cable_schedule.cables c
                JOIN cable_schedule.revisions r ON r.id = c.revision_id
                JOIN projects.project_members pm ON pm.project_id = r.project_id
                WHERE c.id = terminations.cable_id
                  AND pm.user_id = auth.uid() AND pm.is_active = TRUE
            )
        )
    );
CREATE POLICY "trm_write" ON cable_schedule.terminations FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

CREATE POLICY "tag_select"
    ON cable_schedule.cable_tags FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1
                FROM cable_schedule.cables c
                JOIN cable_schedule.revisions r ON r.id = c.revision_id
                JOIN projects.project_members pm ON pm.project_id = r.project_id
                WHERE c.id = cable_tags.cable_id
                  AND pm.user_id = auth.uid() AND pm.is_active = TRUE
            )
        )
    );
CREATE POLICY "tag_write" ON cable_schedule.cable_tags FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

-- ===========================================================================
-- Storage bucket: cable-schedule-evidence
-- ===========================================================================
-- Holds confirmation photos / pull-sheets / signed-off drawings attached to
-- length confirmations + revision-issue change notes. 50 MB cap; PDF +
-- common image MIMEs.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'cable-schedule-evidence',
    'cable-schedule-evidence',
    false,
    52428800,  -- 50 MB
    ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/heic',
        'image/tiff'
    ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "cable_ev_read_org"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'cable-schedule-evidence'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
    );

CREATE POLICY "cable_ev_insert_org"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'cable-schedule-evidence'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

CREATE POLICY "cable_ev_update_org"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'cable-schedule-evidence'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

CREATE POLICY "cable_ev_delete_org"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'cable-schedule-evidence'
        AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_org_ids())
        AND NOT public.user_is_client_viewer((storage.foldername(name))[1]::uuid)
    );

NOTIFY pgrst, 'reload schema';
