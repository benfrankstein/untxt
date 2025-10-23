#!/bin/bash

#############################################################################
# Apply Database Change Notifications
# This script applies PostgreSQL triggers for real-time database changes
#############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Database configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-ocr_platform_dev}"
DB_USER="${DB_USER:-ocr_platform_user}"

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
MIGRATION_FILE="$SCRIPT_DIR/../migrations/04_add_change_notifications.sql"

print_header() {
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${YELLOW}→${NC} $1"
}

main() {
    clear
    print_header "Database Change Notifications - Migration"
    echo ""

    # Check if migration file exists
    if [ ! -f "$MIGRATION_FILE" ]; then
        print_error "Migration file not found: $MIGRATION_FILE"
        exit 1
    fi

    print_info "Migration file: $MIGRATION_FILE"
    print_info "Database: $DB_NAME"
    print_info "User: $DB_USER"
    echo ""

    # Check if triggers already exist
    print_info "Checking if triggers already exist..."
    TRIGGER_EXISTS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'tasks_change_trigger';" 2>/dev/null | xargs)

    if [ "$TRIGGER_EXISTS" -gt 0 ]; then
        echo ""
        print_info "Triggers already exist. Do you want to recreate them? (y/n)"
        read -r response

        if [[ ! "$response" =~ ^[Yy]$ ]]; then
            print_info "Migration cancelled."
            exit 0
        fi

        print_info "Dropping existing triggers and function..."
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<EOF
            DROP TRIGGER IF EXISTS tasks_change_trigger ON tasks;
            DROP TRIGGER IF EXISTS files_change_trigger ON files;
            DROP TRIGGER IF EXISTS results_change_trigger ON results;
            DROP FUNCTION IF EXISTS notify_table_change();
EOF
        print_success "Existing triggers dropped"
    else
        print_success "No existing triggers found"
    fi

    echo ""
    print_info "Applying migration..."
    echo ""

    # Apply the migration
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$MIGRATION_FILE"

    echo ""
    print_success "Migration applied successfully!"
    echo ""

    # Verify installation
    print_info "Verifying installation..."
    FUNCTION_EXISTS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT COUNT(*) FROM pg_proc WHERE proname = 'notify_table_change';" 2>/dev/null | xargs)

    TRIGGER_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT COUNT(*) FROM pg_trigger WHERE tgname IN ('tasks_change_trigger', 'files_change_trigger', 'results_change_trigger');" 2>/dev/null | xargs)

    if [ "$FUNCTION_EXISTS" -eq 1 ] && [ "$TRIGGER_COUNT" -eq 3 ]; then
        print_success "Function: notify_table_change() ✓"
        print_success "Triggers: tasks, files, results (3 total) ✓"
        echo ""
        print_header "Database Change Notifications Active!"
        echo ""
        print_info "What happens now:"
        echo "  • Any INSERT, UPDATE, or DELETE on tasks, files, or results"
        echo "  • Triggers a NOTIFY event on the 'db_changes' channel"
        echo "  • The db-listener service receives it"
        echo "  • Publishes to Redis 'ocr:db:changes' channel"
        echo "  • Backend forwards to WebSocket clients"
        echo "  • Frontend UI updates automatically"
        echo ""
        print_info "To test, make a direct database change:"
        echo "  psql -U $DB_USER -d $DB_NAME"
        echo "  UPDATE tasks SET status = 'completed' WHERE id = '<some-task-id>';"
        echo ""
    else
        print_error "Verification failed!"
        print_error "Function exists: $FUNCTION_EXISTS (expected: 1)"
        print_error "Trigger count: $TRIGGER_COUNT (expected: 3)"
        exit 1
    fi
}

main
