#!/bin/bash

#############################################################################
# Apply S3 Cleanup Triggers
# This script applies PostgreSQL triggers for automatic S3 cleanup on delete
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
MIGRATION_FILE="$SCRIPT_DIR/../migrations/05_add_s3_cleanup_on_delete.sql"

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
    print_header "S3 Cleanup Triggers - Migration"
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

    print_info "This migration will:"
    echo "  • Update notify_table_change() to include S3 keys on DELETE"
    echo "  • Add notify_user_delete() for cascade cleanup"
    echo "  • Add users_change_trigger for user deletion"
    echo ""

    print_info "Press Enter to apply migration..."
    read

    print_info "Applying migration..."
    echo ""

    # Apply the migration
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$MIGRATION_FILE"

    echo ""
    print_success "Migration applied successfully!"
    echo ""

    # Verify installation
    print_info "Verifying installation..."

    NOTIFY_FUNC=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT COUNT(*) FROM pg_proc WHERE proname = 'notify_table_change';" 2>/dev/null | xargs)

    USER_DELETE_FUNC=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT COUNT(*) FROM pg_proc WHERE proname = 'notify_user_delete';" 2>/dev/null | xargs)

    USERS_TRIGGER=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'users_change_trigger';" 2>/dev/null | xargs)

    if [ "$NOTIFY_FUNC" -eq 1 ] && [ "$USER_DELETE_FUNC" -eq 1 ] && [ "$USERS_TRIGGER" -eq 1 ]; then
        print_success "notify_table_change() ✓"
        print_success "notify_user_delete() ✓"
        print_success "users_change_trigger ✓"
        echo ""
        print_header "S3 Cleanup Triggers Active!"
        echo ""
        print_info "What happens now:"
        echo "  • DELETE FROM files → S3 cleanup triggered automatically"
        echo "  • DELETE FROM tasks → S3 cleanup for upload + result"
        echo "  • DELETE FROM results → S3 cleanup for result"
        echo "  • DELETE FROM users → S3 cleanup for ALL user files"
        echo ""
        print_info "Flow:"
        echo "  1. Direct database DELETE (SQL, pgAdmin, etc.)"
        echo "  2. PostgreSQL trigger fires → NOTIFY with S3 keys"
        echo "  3. db-listener receives notification"
        echo "  4. Published to Redis 'ocr:db:changes'"
        echo "  5. Backend subscribes to Redis"
        echo "  6. Backend calls S3 service to permanently delete files"
        echo "  7. S3 files are PERMANENTLY DELETED (immediate removal)"
        echo "  8. No recovery window - files are gone immediately"
        echo ""
        print_info "To test:"
        echo "  ./test_s3_cleanup.sh"
        echo ""
    else
        print_error "Verification failed!"
        print_error "notify_table_change: $NOTIFY_FUNC (expected: 1)"
        print_error "notify_user_delete: $USER_DELETE_FUNC (expected: 1)"
        print_error "users_change_trigger: $USERS_TRIGGER (expected: 1)"
        exit 1
    fi
}

main
