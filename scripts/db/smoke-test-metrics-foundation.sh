#!/usr/bin/env bash
# Smoke-test the Q1 metrics/presence/calendar foundation AFTER it is applied.
#
#   scripts/db/smoke-test-metrics-foundation.sh
#
# Section 1 runs assert-metrics-foundation-static.sql read-only: it reads only
# applied structure, so every assertion in it is true against a production that
# has not yet had its first Monday tick.
#
# Section 2 runs assert-metrics-foundation-seeded.sql inside its own
# BEGIN … ROLLBACK, because those assertions read rows the file itself seeds
# (tagged, so they count only their own rows next to the genuine product_events,
# user_sessions and platform_metrics_weekly rows the app and the cron write
# after the apply). Zero residue either way, and section 2 proves it.
#
# Sections 3–7 are one Management-API call each, every one of them read-only or
# rolled back. Nothing this script does survives it.
#
# Exit 0 on full green.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }
section() { echo ""; echo "── $1 ──"; }
FAILED=0

TS_ERR="$(mktemp "${TMPDIR:-/tmp}/smoke-metrics.XXXXXX")"
trap 'rm -f "$TS_ERR"' EXIT

# capture <var> <mgmt_query|mgmt_apply_sql_file> <sql-or-file>
#
# One Management-API call, raw response JSON into <var>. mgmt_query surfaces an
# API error — bad token, permission denied, a RAISE that escaped its handler, a
# statement that aborted the transaction — through `jq -e error(…)`, which
# prints to stderr and exits 5 (NOT 1). Under `set -euo pipefail` a bare
# `X=$(mgmt_query …)` would kill the script right there: before the summary,
# with every later section silently unrun and nothing saying so. Capture with
# `|| rc=$?` (the dry-run-migration.sh pattern), print the error, mark the run
# FAILED and return 1 so the caller skips that section's own comparison.
capture() {
  local __var="$1" fn="$2" arg="$3" rc=0 out
  out="$("$fn" "$arg" 2>&1)" || rc=$?
  if [[ $rc -ne 0 ]]; then
    fail "Management API call failed (exit $rc) — section aborted:"
    printf '%s\n' "${out:-(no output)}" | sed 's/^/      /' >&2
    return 1
  fi
  printf -v "$__var" '%s' "$out"
}

# report_checks <json>
#
# Print one line per (check, ok) row; return 1 if any row is not ok. An EMPTY
# array would satisfy `[.[] | select(.ok != true)] | length == 0` vacuously and
# rows of the wrong shape would print as "✗ null" — both are refused by name
# rather than reported green on nothing.
report_checks() {
  local json="$1"
  if ! printf '%s' "$json" | jq -e 'type == "array" and length > 0 and all(has("check") and has("ok"))' > /dev/null 2>&1; then
    fail "response is not a non-empty (check, ok) array — refusing to report green on nothing:"
    printf '%s\n' "$json" | head -c 600 | sed 's/^/      /' >&2
    return 1
  fi
  printf '%s' "$json" | jq -r '.[] | if .ok then "  ✓ \(.check)" else "  ✗ \(.check)" end'
  [[ "$(printf '%s' "$json" | jq '[.[] | select(.ok != true)] | length')" == "0" ]]
}

section "1. Applied structure — objects, RLS, policies, grants, calendar (read-only)"
if capture RES mgmt_apply_sql_file "$SCRIPT_DIR/assert-metrics-foundation-static.sql"; then
  report_checks "$RES" || FAILED=1
fi

section "2. Behaviour — the writer, presence and the rollup (seeded, rolled back)"
if capture SEEDED mgmt_query "BEGIN;
$(cat "$SCRIPT_DIR/assert-metrics-foundation-seeded.sql")
ROLLBACK;"; then
  report_checks "$SEEDED" || FAILED=1
fi
# Prove the rollback: nothing the seeded file wrote may survive it. Runs even
# when the seeded call aborted — an aborted multi-statement request is exactly
# when an open BEGIN is most likely to have been left behind.
#
# NOT `count(*) = 0` over the tables: after the apply the app writes real
# user_sessions / user_presence rows on every page load and real product_events
# rows on every RFI, so an empty-table check goes red for a healthy production.
# Count only what the seeded file itself writes — it TAGS its rows
# (properties.seeded_by on product_events, user_agent on user_sessions) and its
# rollup runs compute exactly ISO weeks 28 and 36 of 2026, which the Monday job
# never writes (it computes only the week just ended, and the first tick is
# later than both).
if capture RESIDUE_JSON mgmt_query "SELECT (SELECT count(*) FROM public.product_events
                                            WHERE properties->>'seeded_by' = 'assert-metrics-foundation-seeded')
                                         + (SELECT count(*) FROM public.user_sessions
                                            WHERE user_agent = 'assert-metrics-foundation-seeded')
                                         + (SELECT count(*) FROM public.platform_metrics_weekly
                                            WHERE iso_year = 2026 AND iso_week IN (28, 36) AND NOT is_baseline) AS n;"; then
  RESIDUE=$(printf '%s' "$RESIDUE_JSON" | jq -r '.[0].n')
  [[ "$RESIDUE" == "0" ]] && pass "seeded section left zero residue" \
                          || fail "seeded section left $RESIDUE row(s) behind — the ROLLBACK did not take"
fi

section "3. An unseeded year RAISES rather than falling back to calendar days"
if capture RAISED_JSON mgmt_query "
DO \$\$
BEGIN
  PERFORM projects.working_days_between(timestamptz '2040-01-05 08:00+02', timestamptz '2040-01-12 08:00+02',
    (SELECT project_id FROM projects.project_settings ORDER BY project_id LIMIT 1), 'office');
  RAISE EXCEPTION 'DID NOT RAISE';
EXCEPTION WHEN no_data_found THEN
  NULL;
END \$\$;
SELECT true AS raised;"; then
  RAISED=$(printf '%s' "$RAISED_JSON" | jq -r '.[0].raised')
  [[ "$RAISED" == "true" ]] && pass "2040 raises no_data_found" || fail "unseeded year did NOT raise"
fi

section "4. The SQL calendar agrees with the TypeScript mirror, on the SAME settings"
# Both sides read the SAME project's actual working_days and extra_holidays.
# Sampling an unordered `LIMIT 1` project and hard-coding [1,2,3,4,5] in the TS
# side compares two different configurations and passes only by luck.
if capture CFG mgmt_query "SELECT project_id::text AS pid,
                                  working_days AS wd,
                                  COALESCE(array_to_json(extra_holidays)::text,'[]') AS eh
                             FROM projects.project_settings ORDER BY project_id LIMIT 1;"; then
  PROJ=$(printf '%s' "$CFG" | jq -r '.[0].pid')
  WD=$(printf '%s' "$CFG" | jq -c '.[0].wd')
  EH=$(printf '%s' "$CFG" | jq -r '.[0].eh')
  if capture SQL_N_JSON mgmt_query "SELECT projects.working_days_between(timestamptz '2026-01-01 08:00+02', timestamptz '2026-12-31 08:00+02', '$PROJ', 'office') AS n;"; then
    SQL_N=$(printf '%s' "$SQL_N_JSON" | jq -r '.[0].n')
    # Node's stderr (a typeless-package warning on every run) goes to a file
    # and is shown only when the mirror fails to run.
    if TS_N=$(node --experimental-strip-types -e "
    const wd = $WD; const eh = $EH;
    Promise.all([
      import('$SCRIPT_DIR/../../packages/shared/src/lib/calendar/working-days.ts'),
      import('$SCRIPT_DIR/../../packages/shared/src/lib/jbcc/sa-public-holidays.ts'),
    ]).then(([m, h]) => {
      const holidays = new Set(); const years = new Set()
      for (let y = 2024; y <= 2035; y++) { years.add(y); for (const x of h.listHolidaysNamed(y)) holidays.add(x.date.toISOString().slice(0,10)) }
      const cal = m.buildCalendar({ workingDays: wd, extraHolidays: eh, calendar: 'office', holidays, seededYears: years })
      console.log(m.workingDaysBetween(new Date('2026-01-01T06:00:00Z'), new Date('2026-12-31T06:00:00Z'), cal))
    })" 2>"$TS_ERR"); then
      [[ "$SQL_N" == "$TS_N" ]] && pass "SQL and TS agree on project $PROJ: $SQL_N office working days in 2026" \
                                || fail "SQL says $SQL_N, TypeScript says $TS_N — one of them is wrong"
    else
      fail "the TypeScript mirror did not run:"
      sed 's/^/      /' "$TS_ERR" >&2
    fi
  fi
fi

section "5. The RESTRICTIVE read gate holds for a real contractor"
# No password anywhere: impersonate through request.jwt.claims inside a
# rolled-back transaction — the PR #157 pattern.
#
# The probe row is labelled ISO week 2: 2026-01-05 IS week 2 of 2026 (week 1
# starts Mon 29 Dec 2025; `extract(week from date '2026-01-05')` = 2 on
# production). platform_metrics_weekly_iso_matches_window CHECKs the label
# against window_start, so a week-1 label would abort the INSERT, abort the
# transaction, and turn this control into an API error instead of a 0/1.
if capture CONTRACTOR_JSON mgmt_query "
BEGIN;
INSERT INTO public.platform_metrics_weekly (metric_key, iso_year, iso_week, window_start, window_end, value, status)
VALUES ('weekly_active', 2026, 2, DATE '2026-01-05', DATE '2026-01-12', 0.5, 'measured');
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT id::text FROM public.profiles WHERE email='rbac-test@e-site.live'),
                    'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT count(*)::int AS n FROM public.platform_metrics_weekly;
ROLLBACK;" \
&& capture OWNER_JSON mgmt_query "
BEGIN;
INSERT INTO public.platform_metrics_weekly (metric_key, iso_year, iso_week, window_start, window_end, value, status)
VALUES ('weekly_active', 2026, 2, DATE '2026-01-05', DATE '2026-01-12', 0.5, 'measured');
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT user_id::text FROM public.user_organisations WHERE role='owner' AND is_active LIMIT 1),
                    'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT count(*)::int AS n FROM public.platform_metrics_weekly;
ROLLBACK;"; then
  CONTRACTOR=$(printf '%s' "$CONTRACTOR_JSON" | jq -r '.[0].n')
  OWNER=$(printf '%s' "$OWNER_JSON" | jq -r '.[0].n')
  [[ "$CONTRACTOR" == "0" && "$OWNER" == "1" ]] \
    && pass "contractor sees 0, org owner sees 1 — the gate is the gate, not a broken deploy" \
    || fail "expected contractor=0 owner=1, got contractor=$CONTRACTOR owner=$OWNER"
fi

section "6. product_events is ORG-SCOPED, not merely admin-gated"
# An owner of org A must NOT read a row belonging to org B. The zero-arg admin
# check would pass this row to them; the one-arg check does not. Both counts
# come from the same transaction, so a zero cannot be an empty table.
if capture XORG_JSON mgmt_query "
BEGIN;
SELECT set_config('x.owner', (SELECT user_id::text FROM public.user_organisations WHERE role='owner' AND is_active ORDER BY user_id LIMIT 1), true);
SELECT set_config('x.own_org', (SELECT organisation_id::text FROM public.user_organisations WHERE user_id = current_setting('x.owner')::uuid AND is_active LIMIT 1), true);
SELECT set_config('x.other_org', (SELECT id::text FROM public.organisations WHERE id <> current_setting('x.own_org')::uuid ORDER BY id LIMIT 1), true);
INSERT INTO public.product_events (actor_id, project_id, organisation_id, event)
VALUES (NULL, NULL, current_setting('x.own_org')::uuid, 'backfill_completed'),
       (NULL, NULL, current_setting('x.other_org')::uuid, 'backfill_completed');
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('x.owner'), 'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT count(*)::int AS n FROM public.product_events;
ROLLBACK;"; then
  XORG=$(printf '%s' "$XORG_JSON" | jq -r '.[0].n')
  [[ "$XORG" == "1" ]] \
    && pass "org owner sees their OWN org's event and not the other org's (1 of 2)" \
    || fail "expected 1 of 2 rows visible, got $XORG — the read gate is not org-scoped"
fi

section "7. The cron job is scheduled and active"
if capture ACTIVE_JSON mgmt_query "SELECT active FROM cron.job WHERE jobname='platform-metrics-weekly';"; then
  ACTIVE=$(printf '%s' "$ACTIVE_JSON" | jq -r '.[0].active // "missing"')
  [[ "$ACTIVE" == "true" ]] && pass "platform-metrics-weekly is scheduled and active" \
                            || fail "cron job is '$ACTIVE' — cloud-sync-poll all over again"
fi

echo ""
if [[ "$FAILED" == "0" ]]; then echo "✓ ALL SMOKE TESTS PASSED"; exit 0; else echo "✗ SMOKE TESTS FAILED"; exit 1; fi
