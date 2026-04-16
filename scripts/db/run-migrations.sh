#!/usr/bin/env bash
# =============================================================================
# run-migrations.sh — Apply pending Supabase migrations in order
#
# Applies migrations 00017–00023 (Sprint 2–6) to a target Supabase project.
# Idempotent: every migration uses IF NOT EXISTS / DO $$ guards so it is safe
# to re-run against a DB that already has some of them applied.
#
# Usage:
#   SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" \
#   bash scripts/db/run-migrations.sh
#
# Or with a .env file:
#   source .env.staging && bash scripts/db/run-migrations.sh
#
# Required env:
#   SUPABASE_DB_URL  — full psql connection string (including password)
#
# Optional env:
#   DRY_RUN=true     — print SQL paths without executing
#   MIGRATIONS_DIR   — override default migration directory
#                      (default: apps/edge-functions/supabase/migrations)
# =============================================================================

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-${REPO_ROOT}/apps/edge-functions/supabase/migrations}"
DRY_RUN="${DRY_RUN:-false}"

# Migrations that need to be applied in order.
# Earlier migrations (00001–00016) should already be on the target DB.
PENDING_MIGRATIONS=(
  "00017_diary_entry_types.sql"
  "00018_coc_review_notes.sql"
  "00019_notifications.sql"
  "00020_billing_eft.sql"
  "00021_supplier_ratings.sql"
  "00022_schema_patches.sql"
  "00023_performance_indexes.sql"
)

# ─── Validation ──────────────────────────────────────────────────────────────

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "ERROR: SUPABASE_DB_URL is not set."
  echo ""
  echo "  Export your Supabase direct connection string, e.g.:"
  echo "  export SUPABASE_DB_URL=\"postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres\""
  echo ""
  echo "  Find it at: Supabase dashboard → Project Settings → Database → Connection string (URI)"
  exit 1
fi

if ! command -v psql &>/dev/null; then
  echo "ERROR: psql not found. Install PostgreSQL client tools first."
  echo "  macOS:  brew install libpq && brew link --force libpq"
  echo "  Ubuntu: apt-get install -y postgresql-client"
  exit 1
fi

# ─── Helpers ─────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[✓]${NC} $*"; }
warning() { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; }

# ─── Pre-flight check ────────────────────────────────────────────────────────

echo ""
echo "E-Site Migration Runner"
echo "========================"
echo "Migrations dir : ${MIGRATIONS_DIR}"
echo "Dry run        : ${DRY_RUN}"
echo ""

# Verify all migration files exist before we start
MISSING=0
for migration in "${PENDING_MIGRATIONS[@]}"; do
  path="${MIGRATIONS_DIR}/${migration}"
  if [[ ! -f "${path}" ]]; then
    error "Migration file not found: ${path}"
    MISSING=$((MISSING + 1))
  fi
done

if [[ $MISSING -gt 0 ]]; then
  error "Aborting: ${MISSING} migration file(s) missing."
  exit 1
fi

info "All ${#PENDING_MIGRATIONS[@]} migration files found."
echo ""

# ─── Apply migrations ────────────────────────────────────────────────────────

APPLIED=0
FAILED=0

for migration in "${PENDING_MIGRATIONS[@]}"; do
  path="${MIGRATIONS_DIR}/${migration}"
  echo "→ Applying: ${migration}"

  if [[ "${DRY_RUN}" == "true" ]]; then
    warning "  DRY RUN — would execute: psql \$SUPABASE_DB_URL < ${path}"
    APPLIED=$((APPLIED + 1))
    continue
  fi

  if PGPASSWORD="" psql "${SUPABASE_DB_URL}" \
      --single-transaction \
      --set ON_ERROR_STOP=on \
      --file="${path}" \
      --quiet 2>&1; then
    info "  Applied successfully."
    APPLIED=$((APPLIED + 1))
  else
    error "  FAILED. Stopping — previous migrations were already committed."
    FAILED=$((FAILED + 1))
    break
  fi
done

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "========================"
if [[ $FAILED -eq 0 ]]; then
  info "Done. ${APPLIED}/${#PENDING_MIGRATIONS[@]} migrations applied."
  echo ""
  echo "Next steps:"
  echo "  1. Run ANALYZE if this is a fresh restore from production data"
  echo "  2. Verify pg_trgm extension is enabled (required by 00023):"
  echo "     psql \$SUPABASE_DB_URL -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'"
  echo "  3. Deploy the web app to Vercel staging"
  echo "  4. Run smoke tests (see docs/staging-deployment-checklist.md)"
else
  error "${FAILED} migration(s) failed. ${APPLIED} were applied before the failure."
  exit 1
fi
