#!/bin/bash

#############################################################################
# Test S3 Automatic Cleanup on Direct Database Delete
# This script tests that deleting records directly triggers S3 cleanup
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
    print_header "Testing S3 Automatic Cleanup on Direct Database Delete"
    echo ""

    # Check if backend and db-listener are running
    if ! pgrep -f "node src/index.js" > /dev/null; then
        print_error "Backend is not running! Please start services first:"
        echo "  ./start_services.sh"
        exit 1
    fi

    if ! pgrep -f "db-listener.js" > /dev/null; then
        print_error "Database listener is not running! Please start services first:"
        echo "  ./start_services.sh"
        exit 1
    fi

    print_success "Backend is running"
    print_success "Database listener is running"
    echo ""

    # Find a completed task with S3 files
    print_info "Finding a completed task with S3 files..."
    TASK_DATA=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT t.id, t.user_id, f.filename, f.s3_key, r.s3_result_key
         FROM tasks t
         JOIN files f ON f.id = t.file_id
         LEFT JOIN results r ON r.task_id = t.id
         WHERE t.status = 'completed'
         LIMIT 1;" 2>/dev/null)

    if [ -z "$TASK_DATA" ]; then
        print_error "No completed tasks found!"
        echo ""
        print_info "Please:"
        echo "  1. Open http://localhost:3000"
        echo "  2. Upload a PDF file"
        echo "  3. Wait for processing to complete"
        echo "  4. Run this test script again"
        echo ""
        exit 1
    fi

    # Parse task data
    TASK_ID=$(echo "$TASK_DATA" | awk '{print $1}')
    USER_ID=$(echo "$TASK_DATA" | awk '{print $3}')
    FILENAME=$(echo "$TASK_DATA" | awk '{print $5}')
    S3_KEY=$(echo "$TASK_DATA" | awk '{print $7}')
    S3_RESULT_KEY=$(echo "$TASK_DATA" | awk '{print $9}')

    print_success "Found task: $TASK_ID"
    echo "  • File: $FILENAME"
    echo "  • Upload S3 Key: $S3_KEY"
    echo "  • Result S3 Key: $S3_RESULT_KEY"
    echo ""

    # Show current task details
    print_info "Current task in database:"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "SELECT id, filename, status, created_at FROM tasks WHERE id = '$TASK_ID';"
    echo ""

    # Test 1: Delete a task directly
    print_header "Test 1: Direct Task Deletion"
    echo ""
    print_info "This test will:"
    echo "  1. Delete the task directly from PostgreSQL"
    echo "  2. PostgreSQL trigger fires → NOTIFY with S3 keys"
    echo "  3. db-listener receives → publishes to Redis"
    echo "  4. Backend receives → deletes from S3"
    echo ""
    print_info "Open these logs in separate terminals to watch the flow:"
    echo "  Terminal 1: tail -f logs/db-listener.log"
    echo "  Terminal 2: tail -f logs/backend.log"
    echo ""
    print_info "Press Enter to delete the task..."
    read

    print_info "Deleting task from database: $TASK_ID"
    echo ""

    # Execute the DELETE
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "DELETE FROM tasks WHERE id = '$TASK_ID';"

    echo ""
    print_success "Task deleted from database!"
    echo ""

    # Give system time to process
    print_info "Waiting 3 seconds for system to process..."
    sleep 3

    echo ""
    print_header "Expected Results"
    echo ""
    print_info "Check the logs for these messages:"
    echo ""
    echo "db-listener.log should show:"
    echo "  [DB CHANGE] DELETE on tasks - ID: $TASK_ID"
    echo "  ↳ Published to Redis channel: ocr:db:changes"
    echo ""
    echo "backend.log should show:"
    echo "  [DB CHANGE] DELETE on tasks - User: $USER_ID"
    echo "  [S3 CLEANUP] Permanently deleting 2 file(s) from S3: [$S3_KEY, $S3_RESULT_KEY]"
    echo "  [S3 CLEANUP] ✓ Permanently deleted: $S3_KEY"
    echo "  [S3 CLEANUP] ✓ Permanently deleted: $S3_RESULT_KEY"
    echo ""

    # Ask user to verify
    print_info "Did you see the S3 cleanup messages in backend.log? (y/n)"
    read -r response

    if [[ "$response" =~ ^[Yy]$ ]]; then
        print_success "Test 1 PASSED ✓"
        echo ""
        print_info "S3 Files Status:"
        echo "  • Files are PERMANENTLY DELETED from S3 (immediate removal)"
        echo "  • No recovery window - files are gone immediately"
        echo ""
    else
        print_error "Test 1 FAILED"
        echo ""
        print_info "Debug steps:"
        echo "  1. Check if backend is running: ps aux | grep 'node src/index.js'"
        echo "  2. Check if db-listener is running: ps aux | grep 'db-listener.js'"
        echo "  3. Check backend logs: tail -50 logs/backend.log"
        echo "  4. Check db-listener logs: tail -50 logs/db-listener.log"
        echo "  5. Test Redis connection: redis-cli ping"
        echo ""
    fi

    # Test 2: Delete a file directly
    print_header "Test 2: Direct File Deletion (Optional)"
    echo ""
    print_info "Want to test direct file deletion? This will:"
    echo "  • Find another file in the database"
    echo "  • DELETE FROM files directly"
    echo "  • Verify S3 cleanup is triggered"
    echo ""
    print_info "Run test 2? (y/n)"
    read -r response

    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        print_info "Skipping Test 2"
        echo ""
        return
    fi

    # Find another file
    FILE_DATA=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT id, filename, s3_key FROM files LIMIT 1;" 2>/dev/null)

    if [ -z "$FILE_DATA" ]; then
        print_error "No files found in database"
        echo ""
        return
    fi

    FILE_ID=$(echo "$FILE_DATA" | awk '{print $1}')
    FILE_S3_KEY=$(echo "$FILE_DATA" | awk '{print $5}')

    print_info "Deleting file: $FILE_ID"
    print_info "S3 Key: $FILE_S3_KEY"
    echo ""

    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "DELETE FROM files WHERE id = '$FILE_ID';"

    echo ""
    print_info "Waiting for S3 cleanup..."
    sleep 3

    print_info "Check backend.log for S3 cleanup of: $FILE_S3_KEY"
    echo ""

    # Summary
    print_header "Test Complete"
    echo ""
    print_info "Summary:"
    echo "  • Direct database DELETEs trigger automatic S3 cleanup"
    echo "  • Flow: PostgreSQL → db-listener → Redis → Backend → S3"
    echo "  • Files are PERMANENTLY deleted (immediate removal from S3)"
    echo "  • No recovery window - files are gone immediately"
    echo ""
    print_info "Monitor real-time:"
    echo "  • Database listener: tail -f logs/db-listener.log"
    echo "  • Backend: tail -f logs/backend.log"
    echo "  • Frontend UI: http://localhost:3000 (auto-updates)"
    echo ""
}

main
