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
}

# --- Backend build ---
build_backend() {
    log "Building backend..."
    cd "$MONIZE_DIR/backend"
    npm run build
    log "Backend build complete."
}

# --- Frontend build + standalone static copy ---
build_frontend() {
    log "Building frontend..."
    cd "$MONIZE_DIR/frontend"
    npm run build

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
case "${1:-all}" in
    --migrate-only)
        check_migrations
        ;;
    --backend-only)
        check_migrations
        build_backend
        restart_services backend
        ;;
    --frontend-only)
        build_frontend
        restart_services frontend
        ;;
    *)
        check_migrations
        build_backend
        build_frontend
        restart_services all
        log "Full rebuild complete."
        ;;
esac
