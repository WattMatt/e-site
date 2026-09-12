#!/usr/bin/env bash
# Supabase Management API helper for the cbskbnvvgcybmfikxgky project.
# Source this file:  . scripts/db/mgmt-api.sh
# Then call:         mgmt_query "SELECT 1;"
#                    mgmt_apply_sql_file path/to/migration.sql

# Strict mode only when this file is EXECUTED directly. When it is SOURCED —
# the documented use — the caller keeps its own shell options: an ad-hoc
# `bash -c '. scripts/db/mgmt-api.sh; mgmt_query A; mgmt_query B'` must reach
# B and print A's error rather than die silently after it. Every script under
# scripts/db that sources this sets `set -euo pipefail` itself, before the
# source line. So that nothing here depends on errexit or pipefail in the
# caller, every function below returns an explicit non-zero code on failure:
# mgmt_query and mgmt_apply_sql_file return 5 (jq's error() code) on an API
# error object, another non-zero code on a transport or local failure, and 0
# only with a result set.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then set -euo pipefail; fi

# Hard-require jq. Compatible with both `source`d and `bash`-executed use.
if ! command -v jq > /dev/null 2>&1; then
  echo "ERROR: jq is required by scripts/db/mgmt-api.sh (brew install jq)" >&2
  return 1 2>/dev/null || exit 1
fi

SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-cbskbnvvgcybmfikxgky}"

# Resolve the Management API PAT. CI / non-macOS (no keychain) sets the
# SUPABASE_ACCESS_TOKEN env var (the deploy-migrations workflow already exposes
# it as a repo secret); locally we read it from the macOS keychain, handling the
# go-keyring-base64 prefix.
_get_pat() {
  if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
    printf '%s' "$SUPABASE_ACCESS_TOKEN"
    return 0
  fi
  local raw
  raw=$(security find-generic-password -s "Supabase CLI" -w) || {
    echo "ERROR: SUPABASE_ACCESS_TOKEN is unset and the 'Supabase CLI' keychain item could not be read" >&2
    return 1
  }
  if [[ "$raw" == go-keyring-base64:* ]]; then
    echo "${raw#go-keyring-base64:}" | base64 -d
  else
    echo "$raw"
  fi
}

# Run an ad-hoc SQL statement and return the raw JSON response.
# Fails non-zero if the API returns an error object (e.g., 401/403/permission denied).
#
# The SQL body and the JSON request body are both written to mode-600 temp
# files rather than passed as process arguments (to jq --arg / curl -d): a
# migration-plus-assertions payload (try-work-item-spine.sh concatenates two
# full migrations plus an assertion file) can comfortably exceed ARG_MAX.
# curl reads the JSON body with --data-binary @file. Both temp files are
# removed by a function-local RETURN trap, which fires however the function
# exits (normal completion or a failing command under `set -e` in a context
# where the caller is checking the result, e.g. `mgmt_query ... || rc=$?`)
# without touching any EXIT trap a caller script has already installed.
mgmt_query() {
  local sql="${1-}"
  if [[ -z "$sql" ]]; then
    echo "usage: mgmt_query <sql>" >&2
    return 2
  fi
  local pat
  pat=$(_get_pat) || return 1

  local sql_tmp json_tmp
  sql_tmp="$(mktemp "${TMPDIR:-/tmp}/mgmt.XXXXXX")" || return 1
  json_tmp="$(mktemp "${TMPDIR:-/tmp}/mgmt.XXXXXX")" || { rm -f "$sql_tmp"; return 1; }
  chmod 600 "$sql_tmp" "$json_tmp"
  trap 'rm -f "$sql_tmp" "$json_tmp"' RETURN

  printf '%s' "$sql" > "$sql_tmp"
  jq -n --rawfile q "$sql_tmp" '{query: $q}' > "$json_tmp" || return 1

  # The pipeline's status is returned explicitly so it holds without errexit
  # or pipefail in the caller: 5 when jq's error() fires on an API error
  # object, another non-zero code when curl produced no parseable JSON, 0
  # only with a result set.
  local rc=0
  curl -s -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${pat}" \
    -H "Content-Type: application/json" \
    --data-binary @"$json_tmp" \
    | jq -e 'if type == "object" and has("message") then error("Supabase API error: " + (.message // "unknown")) else . end' || rc=$?
  return "$rc"
}

# Apply an entire .sql file by reading it and POSTing as one query.
# Returns JSON; non-zero exit if curl fails or the API returns an error object.
#
# Same ARG_MAX fix as mgmt_query: the JSON request body goes to a mode-600
# temp file (jq reads the SQL file itself via --rawfile, so it never touches
# argv either) and curl sends it with --data-binary @file. The temp file is
# removed by a function-local RETURN trap on every exit path.
mgmt_apply_sql_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: SQL file not found: $file" >&2
    return 1
  fi
  local pat
  pat=$(_get_pat) || return 1

  local json_tmp
  json_tmp="$(mktemp "${TMPDIR:-/tmp}/mgmt.XXXXXX")" || return 1
  chmod 600 "$json_tmp"
  trap 'rm -f "$json_tmp"' RETURN

  jq -n --rawfile q "$file" '{query: $q}' > "$json_tmp" || return 1

  # Same explicit-status contract as mgmt_query (5 on an API error object).
  local rc=0
  curl -s -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${pat}" \
    -H "Content-Type: application/json" \
    --data-binary @"$json_tmp" \
    | jq -e 'if type == "object" and has("message") then error("Supabase API error: " + (.message // "unknown")) else . end' || rc=$?
  return "$rc"
}
