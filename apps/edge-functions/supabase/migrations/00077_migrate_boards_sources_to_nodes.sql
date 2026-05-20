-- =============================================================================
-- Migration 00077 — Collapse cable_schedule boards + sources into structure.nodes
-- =============================================================================
-- Background:
--   Populates structure.nodes from the two revision-scoped cable-schedule
--   tables that serve as the de-facto node registry today:
--
--     cable_schedule.boards  → kind 'tenant_db' | 'main_board'
--     cable_schedule.sources → kind 'rmu'       | 'mini_sub'
--                              (type UTILITY, PV, STANDBY — stay in sources)
--
-- Collapse rule:
--   Boards and sources are scoped to a revision; the same logical board/source
--   repeats across revisions with the same code. We collapse to one node per
--   (project_id, code) using DISTINCT ON ordered by revisions.created_at DESC
--   so the LATEST revision's metadata wins.
--
-- Collision policy:
--   No ON CONFLICT clause — a genuine (project_id, code) collision (e.g. a
--   board and a source sharing a code on the same project) must error loudly so
--   a human can re-classify before the migration proceeds.
--
-- NOTE: do NOT apply this migration manually. It is applied as part of
--   Task 1.8 in the E-Site Structure build plan.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Part A — boards → structure.nodes
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per distinct (project_id, code). Latest revision's board row wins.
-- kind logic:
--   tenant_name IS NOT NULL AND tenant_name <> '' → 'tenant_db'
--   otherwise                                     → 'main_board'
-- Tenant facet columns (shop_name, shop_number, shop_area_m2) are only
-- populated for tenant_db rows; main_board rows leave them NULL.
INSERT INTO structure.nodes (
    project_id,
    organisation_id,
    kind,
    code,
    name,
    coc_required,
    status,
    shop_name,
    shop_number,
    shop_area_m2,
    breaker_rating_a,
    pole_config,
    section,
    notes
)
SELECT DISTINCT ON (r.project_id, b.code)
    r.project_id,
    b.organisation_id,
    CASE
        WHEN b.tenant_name IS NOT NULL AND b.tenant_name <> ''
            THEN 'tenant_db'
        ELSE 'main_board'
    END                         AS kind,
    b.code,
    b.code                      AS name,
    false                       AS coc_required,
    'active'                    AS status,
    -- Tenant facet — only for tenant_db
    CASE
        WHEN b.tenant_name IS NOT NULL AND b.tenant_name <> ''
            THEN b.tenant_name
        ELSE NULL
    END                         AS shop_name,
    CASE
        WHEN b.tenant_name IS NOT NULL AND b.tenant_name <> ''
            THEN b.code
        ELSE NULL
    END                         AS shop_number,
    CASE
        WHEN b.tenant_name IS NOT NULL AND b.tenant_name <> ''
            THEN b.area_m2
        ELSE NULL
    END                         AS shop_area_m2,
    b.breaker_rating_a,
    b.pole_config,
    b.section,
    b.notes
FROM cable_schedule.boards  b
JOIN cable_schedule.revisions r ON r.id = b.revision_id
ORDER BY r.project_id, b.code, r.created_at DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- Part B — equipment sources (RMU + MINISUB only) → structure.nodes
-- ─────────────────────────────────────────────────────────────────────────────
-- UTILITY, PV, and STANDBY source types stay in cable_schedule.sources and are
-- NOT migrated here.
-- One row per distinct (project_id, code). Latest revision wins.
INSERT INTO structure.nodes (
    project_id,
    organisation_id,
    kind,
    code,
    name,
    coc_required,
    status,
    rating_kva,
    voltage_v,
    notes
)
SELECT DISTINCT ON (r.project_id, s.code)
    r.project_id,
    s.organisation_id,
    CASE s.type
        WHEN 'RMU'     THEN 'rmu'
        WHEN 'MINISUB' THEN 'mini_sub'
    END                         AS kind,
    s.code,
    s.code                      AS name,
    false                       AS coc_required,
    'active'                    AS status,
    s.rating_kva,
    s.voltage_v,
    s.notes
FROM cable_schedule.sources   s
JOIN cable_schedule.revisions r ON r.id = s.revision_id
WHERE s.type IN ('RMU', 'MINISUB')
ORDER BY r.project_id, s.code, r.created_at DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- Part C — summary report
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_total         INTEGER;
    v_tenant_db     INTEGER;
    v_main_board    INTEGER;
    v_rmu           INTEGER;
    v_mini_sub      INTEGER;
    v_code          TEXT;
BEGIN
    SELECT COUNT(*)                                         INTO v_total      FROM structure.nodes;
    SELECT COUNT(*) FILTER (WHERE kind = 'tenant_db')      INTO v_tenant_db  FROM structure.nodes;
    SELECT COUNT(*) FILTER (WHERE kind = 'main_board')     INTO v_main_board FROM structure.nodes;
    SELECT COUNT(*) FILTER (WHERE kind = 'rmu')            INTO v_rmu        FROM structure.nodes;
    SELECT COUNT(*) FILTER (WHERE kind = 'mini_sub')       INTO v_mini_sub   FROM structure.nodes;

    RAISE NOTICE '=== 00077 migration summary ===';
    RAISE NOTICE 'Total nodes created : %', v_total;
    RAISE NOTICE '  tenant_db         : %', v_tenant_db;
    RAISE NOTICE '  main_board        : %', v_main_board;
    RAISE NOTICE '  rmu               : %', v_rmu;
    RAISE NOTICE '  mini_sub          : %', v_mini_sub;

    RAISE NOTICE '--- main_board codes (review for mis-classified equipment) ---';
    FOR v_code IN
        SELECT code FROM structure.nodes WHERE kind = 'main_board' ORDER BY code
    LOOP
        RAISE NOTICE '  [main_board] %', v_code;
    END LOOP;

    RAISE NOTICE '--- rmu codes ---';
    FOR v_code IN
        SELECT code FROM structure.nodes WHERE kind = 'rmu' ORDER BY code
    LOOP
        RAISE NOTICE '  [rmu] %', v_code;
    END LOOP;

    RAISE NOTICE '--- mini_sub codes ---';
    FOR v_code IN
        SELECT code FROM structure.nodes WHERE kind = 'mini_sub' ORDER BY code
    LOOP
        RAISE NOTICE '  [mini_sub] %', v_code;
    END LOOP;
    RAISE NOTICE '=== end 00077 summary ===';
END $$;
