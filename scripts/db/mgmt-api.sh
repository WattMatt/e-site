#!/usr/bin/env bash
# Supabase Management API helper for the cbskbnvvgcybmfikxgky project.
# Source this file:  . scripts/db/mgmt-api.sh
# Then call:         mgmt_query "SELECT 1;"
#                    mgmt_apply_sql_file path/to/migration.sql

set -euo pipefail

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
  raw=$(security find-generic-password -s "Supabase CLI" -w)
  if [[ "$raw" == go-keyring-base64:* ]]; then
    echo "${raw#go-keyring-base64:}" | base64 -d
  else
    echo "$raw"
  fi
}

# Run an ad-hoc SQL statement and return the raw JSON response.
# Fails non-zero if the API returns an error object (e.g., 401/403/permission denied).
mgmt_query() {
  local sql="$1"
  local pat
  pat=$(_get_pat)
  curl -s -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${pat}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg q "$sql" '{query: $q}')" \
    | jq -e 'if type == "object" and has("message") then error("Supabase API error: " + (.message // "unknown")) else . end'
}

# Apply an entire .sql file by reading it and POSTing as one query.
# Returns JSON; non-zero exit if curl fails or the API returns an error object.
mgmt_apply_sql_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "ERROR: SQL file not found: $file" >&2
    return 1
  fi
  local pat
  pat=$(_get_pat)
  curl -s -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${pat}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --rawfile q "$file" '{query: $q}')" \
    | jq -e 'if type == "object" and has("message") then error("Supabase API error: " + (.message // "unknown")) else . end'
}
