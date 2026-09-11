#!/usr/bin/env bash
# Freeze the ONE baseline row per metric over the four weeks to 30 Sept 2026.
# Idempotent by construction: platform_metrics_weekly_baseline_uk is a partial
# unique index on (metric_key, method_version) WHERE is_baseline, so a second
# run raises rather than quietly writing a second "frozen" answer.
#
# ⚠ Run on or after 1 October 2026. Before then compute_platform_metrics_weekly
# RAISES `refusing to freeze a baseline over an incomplete window (ends
# 2026-10-01, today is …)`; the Management API returns that as an error object,
# mgmt_query surfaces it through `jq -e error(…)` and exits 5 (jq's error code,
# not 1), and `set -euo pipefail` stops this script there with nothing written.
# That failure IS the guard working — test for a non-zero exit, not for 1.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/mgmt-api.sh"

echo "── freezing the baseline over 2026-09-03 → 2026-10-01 ──"
mgmt_query "SELECT public.compute_platform_metrics_weekly(DATE '2026-09-03', DATE '2026-10-01', true) AS rows_written;" \
  | jq -r '"  rows written: \(.[0].rows_written)"'

echo ""
echo "| Metric | Numerator | Denominator | Value (weekly rate / ratio) | Status | Note |"
echo "|---|---|---|---|---|---|"
mgmt_query "
SELECT metric_key, COALESCE(numerator::text,'—') AS n, COALESCE(denominator::text,'—') AS d,
       COALESCE(value::text,'—') AS v, status, COALESCE(note,'') AS note
  FROM public.platform_metrics_weekly WHERE is_baseline ORDER BY metric_key;" \
  | jq -r '.[] | "| `\(.metric_key)` | \(.n) | \(.d) | \(.v) | \(.status) | \(.note) |"'

echo ""
echo "── detail payloads (the bounds, recorded rather than rounded into numbers) ──"
mgmt_query "SELECT metric_key, detail::text AS detail FROM public.platform_metrics_weekly
             WHERE is_baseline AND detail <> '{}'::jsonb ORDER BY metric_key;" \
  | jq -r '.[] | "  \(.metric_key): \(.detail)"'
