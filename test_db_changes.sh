#!/bin/bash

#############################################################################
# Test Database Change Notifications
# This script simulates direct database changes to test real-time updates
#############################################################################

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
    print_header "Testing Database Change Notifications"
    echo ""

    # Get a random task to modify
    print_info "Finding a task to modify..."
    TASK_ID=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT id FROM tasks LIMIT 1;" 2>/dev/null | xargs)

    if [ -z "$TASK_ID" ]; then
        print_error "No tasks found in database!"
        echo ""
        print_info "Please upload a file through the UI first:"
        echo "  1. Open http://localhost:3000"
        echo "  2. Upload a PDF file"
        echo "  3. Run this test script again"
        echo ""
        exit 1
    fi

    print_success "Found task ID: $TASK_ID"
    echo ""

    # Get current task details
    print_info "Current task status:"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "SELECT id, filename, status, created_at FROM tasks WHERE id = '$TASK_ID';"
    echo ""

    # Test 1: Update task status
    print_header "Test 1: Update Task Status"
    echo ""
    print_info "This will update the task status directly in the database."
    print_info "Watch your browser at http://localhost:3000"
    print_info "The UI should update automatically within 1 second!"
    echo ""
    print_info "Press Enter to continue..."
    read

    print_info "Updating task status to 'processing'..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "UPDATE tasks SET status = 'processing' WHERE id = '$TASK_ID';"

    print_success "Database updated!"
    echo ""
    print_info "Check your browser - did the status change? (y/n)"
    read -r response

    if [[ "$response" =~ ^[Yy]$ ]]; then
        print_success "Test 1 PASSED ✓"
    else
        print_error "Test 1 FAILED - Check logs:"
        echo "  • Database Listener: tail -f logs/db-listener.log"
        echo "  • Backend: tail -f logs/backend.log"
    fi
    echo ""

    # Test 2: Update to completed status
    print_header "Test 2: Update to Completed"
    echo ""
    print_info "Updating task status to 'completed'..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "UPDATE tasks SET status = 'completed' WHERE id = '$TASK_ID';"

    print_success "Database updated!"
    echo ""
    print_info "Check your browser - did the status change to completed? (y/n)"
    read -r response

    if [[ "$response" =~ ^[Yy]$ ]]; then
        print_success "Test 2 PASSED ✓"
    else
        print_error "Test 2 FAILED"
    fi
    echo ""

    # Test 3: Update back to pending
    print_header "Test 3: Reset to Pending"
    echo ""
    print_info "Resetting task status to 'pending'..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "UPDATE tasks SET status = 'pending' WHERE id = '$TASK_ID';"

    print_success "Database updated!"
    echo ""
    print_info "Check your browser - did it reset to pending? (y/n)"
    read -r response

    if [[ "$response" =~ ^[Yy]$ ]]; then
        print_success "Test 3 PASSED ✓"
    else
        print_error "Test 3 FAILED"
    fi
    echo ""

    # Summary
    print_header "Test Summary"
    echo ""
    print_info "What was tested:"
    echo "  1. PostgreSQL triggers fired on UPDATE"
    echo "  2. NOTIFY sent to 'db_changes' channel"
    echo "  3. db-listener received notification"
    echo "  4. Published to Redis 'ocr:db:changes'"
    echo "  5. Backend received from Redis"
    echo "  6. WebSocket sent to browser"
    echo "  7. Frontend updated UI automatically"
    echo ""
    print_info "Full data flow tested: PostgreSQL → db-listener → Redis → Backend → WebSocket → Browser"
    echo ""

    print_info "To monitor the system in real-time:"
    echo "  • Frontend: http://localhost:3000"
    echo "  • Database Listener logs: tail -f logs/db-listener.log"
    echo "  • Backend logs: tail -f logs/backend.log"
    echo "  • Browser console: Open DevTools → Console"
    echo ""

    print_info "To test INSERT/DELETE:"
    echo "  psql -U $DB_USER -d $DB_NAME"
    echo "  DELETE FROM tasks WHERE id = '$TASK_ID';"
    echo ""
}

main
