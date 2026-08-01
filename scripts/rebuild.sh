#!/bin/bash
# Monize rebuild script — Manor bare-metal deployment
# Handles: migration check, backend build, frontend build + standalone static copy
# Usage: ./scripts/rebuild.sh [--backend-only | --frontend-only | --migrate-only]

set -euo pipefail

MONIZE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$MONIZE_DIR/database/migrations"
DB_NAME="${DATABASE_NAME:-monize}"
DB_USER="${DATABASE_USER:-monize_user}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[rebuild]${NC} $1"; }
warn() { echo -e "${YELLOW}[rebuild]${NC} $1"; }
err()  { echo -e "${RED}[rebuild]${NC} $1"; }

# --- Build memory guard ---
# zforge has 31 GiB RAM but only 4 GiB swap. An unbounded `next build` fills both,
# at which point the kernel thrashes in page reclaim rather than OOM-killing
# anything: the whole desktop locks up and the machine needs a physical reset.
# That happened twice on 2026-08-01. Nothing lands in dmesg (the reset clears it),
# so the absence of an OOM message is not evidence it wasn't memory.
#
# BUILD_HEAP_MB bounds the *main* Node heap. Note it does NOT bound Next's worker
# pool, so the pre-flight headroom check below is the actual safety net -- keep
# both. Override either via the environment if a build legitimately needs more.
BUILD_HEAP_MB="${MONIZE_BUILD_HEAP_MB:-4096}"
MIN_FREE_MB="${MONIZE_MIN_FREE_MB:-8192}"

preflight_memory() {
    local avail
    avail=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)
    log "Memory pre-flight: ${avail} MiB available; heap cap ${BUILD_HEAP_MB} MiB, floor ${MIN_FREE_MB} MiB."
    if [ "$avail" -lt "$MIN_FREE_MB" ]; then
        err "Only ${avail} MiB available, need ${MIN_FREE_MB} MiB to build safely."
        err "Close memory-heavy apps first, or override: MONIZE_MIN_FREE_MB=<mb> $0 ..."
        exit 1
    fi
}

# --- Migration check ---
check_migrations() {
    log "Checking for unapplied migrations..."

    # Get applied migrations from the schema_migrations table (if it exists)
    local applied
    applied=$(psql -U postgres -d "$DB_NAME" -t -A -c \
        "SELECT filename FROM schema_migrations ORDER BY filename;" 2>/dev/null || echo "")

    local pending=0
    for migration in "$MIGRATIONS_DIR"/*.sql; do
        [ -f "$migration" ] || continue
        local basename
        basename=$(basename "$migration")

        if [ -n "$applied" ] && echo "$applied" | grep -qF "$basename"; then
            continue
        fi

        # Try to detect if migration has already been applied by checking column/table existence
        # For safety, just run with IF NOT EXISTS / IF EXISTS guards (all our migrations use them)
        warn "Applying migration: $basename"
        psql -U postgres -d "$DB_NAME" -f "$migration" 2>&1 | grep -v "^$" || true
        pending=$((pending + 1))
    done

    if [ "$pending" -eq 0 ]; then
        log "All migrations up to date."
    else
        log "Applied $pending migration(s)."
    fi

    ensure_ownership
}

# --- Ensure the app role owns objects created by postgres-run migrations ---
# Migrations apply as `postgres` (superuser), so any NEW table/sequence is born
# postgres-owned and $DB_USER (the app role) is locked out of it -- a real
# INSERT-time "permission denied" (hit live 2026-07-05: import_match_candidate
# from migration 091 blocked the first OFX import that staged matches). Reassign
# everything in public to $DB_USER after each migration run. Idempotent no-op
# when ownership is already correct.
ensure_ownership() {
    log "Ensuring $DB_USER owns all public tables/sequences..."
    psql -U postgres -d "$DB_NAME" -t -A -c \
        "SELECT format('ALTER TABLE %I OWNER TO %I;', tablename, '$DB_USER') \
         FROM pg_tables WHERE schemaname='public' AND tableowner <> '$DB_USER';" \
        | psql -U postgres -d "$DB_NAME" -q -v ON_ERROR_STOP=1
    psql -U postgres -d "$DB_NAME" -t -A -c \
        "SELECT format('ALTER SEQUENCE %I OWNER TO %I;', sequencename, '$DB_USER') \
         FROM pg_sequences WHERE schemaname='public' AND sequenceowner <> '$DB_USER';" \
        | psql -U postgres -d "$DB_NAME" -q -v ON_ERROR_STOP=1
}

# --- Backend build ---
build_backend() {
    log "Building backend..."
    cd "$MONIZE_DIR/backend"
    NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=$BUILD_HEAP_MB" npm run build
    log "Backend build complete."
}

# --- Frontend build + standalone static copy ---
build_frontend() {
    log "Building frontend..."
    cd "$MONIZE_DIR/frontend"
    NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=$BUILD_HEAP_MB" npm run build

    log "Copying static files to standalone output..."
    # v1.11.3: next.config pins turbopack.root to this app, so standalone output
    # is flat (.next/standalone/server.js) rather than nested (.next/standalone/frontend/).
    cp -r .next/static .next/standalone/.next/static
    [ -d public ] && cp -r public .next/standalone/public

    log "Frontend build complete (standalone + static files)."
}

# --- Service restart ---
restart_services() {
    local target="${1:-all}"

    if [ "$target" = "all" ] || [ "$target" = "backend" ]; then
        log "Restarting monize-backend..."
        rc-service --user monize-backend restart
    fi

    if [ "$target" = "all" ] || [ "$target" = "frontend" ]; then
        log "Restarting monize-frontend..."
        rc-service --user monize-frontend restart
    fi
}

# --- Main ---
# The memory gate runs before check_migrations for every build target: refusing a
# build should not leave the database already migrated for code that never got
# compiled. --migrate-only skips it (no Node build involved).
case "${1:-all}" in
    --migrate-only)
        check_migrations
        ;;
    --backend-only)
        preflight_memory
        check_migrations
        build_backend
        restart_services backend
        ;;
    --frontend-only)
        preflight_memory
        build_frontend
        restart_services frontend
        ;;
    *)
        preflight_memory
        check_migrations
        build_backend
        # Re-check: the backend build has just run, so headroom has moved, and the
        # frontend build is the one that actually takes the machine down.
        preflight_memory
        build_frontend
        restart_services all
        log "Full rebuild complete."
        ;;
esac
