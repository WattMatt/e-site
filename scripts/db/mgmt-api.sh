#!/usr/bin/env bash
# Supabase Management API helper for the cbskbnvvgcybmfikxgky project.
# Source this file:  . scripts/db/mgmt-api.sh
# Then call:         mgmt_query "SELECT 1;"
#                    mgmt_apply_sql_file path/to/migration.sql

set -euo pipefail

SUPABASE_PROJECT_REF="${SUPABASE_PROJECT_REF:-cbskbnvvgcybmfikxgky}"

# Extract PAT from macOS keychain, handling the go-keyring-base64 prefix.
_get_pat() {
  local raw
  raw=$(security find-generic-password -s "Supabase CLI" -w)
  if [[ "$raw" == go-keyring-base64:* ]]; then
    echo "${raw#go-keyring-base64:}" | base64 -d
  else
    echo "$raw"
  fi
}

# Run an ad-hoc SQL statement and return the raw JSON response.
mgmt_query() {
  local sql="$1"
  local pat
  pat=$(_get_pat)
  curl -s -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${pat}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg q "$sql" '{query: $q}')"
}

# Apply an entire .sql file by reading it and POSTing as one query.
# Returns JSON; non-zero exit if curl fails.
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
    -d "$(jq -n --rawfile q "$file" '{query: $q}')"
}
