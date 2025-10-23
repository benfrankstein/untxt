#!/bin/bash

#############################################################################
# Test Worker Script
# Creates a test task and watches the worker process it
#############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root directory
PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LOG_DIR="$PROJECT_ROOT/logs"

#############################################################################
# Helper Functions
#############################################################################

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

#############################################################################
# Main Test
#############################################################################

main() {
    clear
    print_header "OCR Worker - End-to-End Test"
    echo ""

    # Check if services are running
    print_info "Checking services..."

    if ! redis-cli ping &> /dev/null; then
        print_error "Redis is not running. Start services first: ./start_services.sh"
        exit 1
    fi
    print_success "Redis is running"

    if ! psql -U ocr_platform_user -d ocr_platform_dev -c "SELECT 1" &> /dev/null; then
        print_error "PostgreSQL is not accessible. Start services first: ./start_services.sh"
        exit 1
    fi
    print_success "PostgreSQL is running"

    echo ""
    print_header "Step 1: Creating Test Task in Database"
    echo ""

    # Get admin user ID
    USER_ID=$(psql -U ocr_platform_user -d ocr_platform_dev -t -c "SELECT id FROM users WHERE username = 'admin' LIMIT 1" 2>/dev/null | xargs)

    if [ -z "$USER_ID" ]; then
        print_error "Admin user not found. Please run database seed script first."
        exit 1
    fi

    print_success "Found admin user: $USER_ID"

    # Create test file
    FILE_ID=$(psql -U ocr_platform_user -d ocr_platform_dev -t -A -c "
        INSERT INTO files (user_id, original_filename, stored_filename, file_path, file_type, file_size, file_hash)
        VALUES (
            '$USER_ID',
            'test_receipt_$(date +%s).png',
            'test_receipt_stored_$(date +%s).png',
            '/path/to/test_receipt.png',
            'image',
            102400,
            'sha256_hash_$(date +%s)'
        )
        RETURNING id;
    " 2>&1 | grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' | head -n 1)

    if [ -z "$FILE_ID" ]; then
        print_error "Failed to create test file"
        exit 1
    fi

    print_success "Created test file: $FILE_ID"

    # Create test task
    TASK_ID=$(psql -U ocr_platform_user -d ocr_platform_dev -t -A -c "
        INSERT INTO tasks (user_id, file_id, status, priority, options)
        VALUES (
            '$USER_ID',
            '$FILE_ID',
            'pending',
            5,
            '{\"test\": true}'::jsonb
        )
        RETURNING id;
    " 2>&1 | grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' | head -n 1)

    if [ -z "$TASK_ID" ]; then
        print_error "Failed to create test task"
        exit 1
    fi

    print_success "Created test task: $TASK_ID"

    echo ""
    print_header "Step 2: Adding Task to Redis Queue"
    echo ""

    redis-cli LPUSH ocr:task:queue "$TASK_ID" > /dev/null
    print_success "Task added to queue"

    QUEUE_LEN=$(redis-cli LLEN ocr:task:queue)
    print_info "Queue length: $QUEUE_LEN"

    echo ""
    print_header "Step 3: Watching Worker Process Task"
    echo ""

    print_info "Task ID: $TASK_ID"
    print_info "Watching worker logs for 15 seconds..."
    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # Watch worker log for this task (15 seconds max)
    timeout 15 tail -f "$LOG_DIR/worker.log" 2>/dev/null | grep --line-buffered "$TASK_ID" || true

    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    sleep 2

    echo ""
    print_header "Step 4: Verifying Results"
    echo ""

    # Check task status
    TASK_STATUS=$(psql -U ocr_platform_user -d ocr_platform_dev -t -c "
        SELECT status FROM tasks WHERE id = '$TASK_ID';
    " 2>/dev/null | xargs)

    print_info "Task status: $TASK_STATUS"

    if [ "$TASK_STATUS" = "completed" ]; then
        print_success "Task completed successfully!"

        # Get result details
        RESULT=$(psql -U ocr_platform_user -d ocr_platform_dev -t -c "
            SELECT
                confidence_score,
                word_count,
                page_count,
                processing_time_ms,
                model_version
            FROM results
            WHERE task_id = '$TASK_ID';
        " 2>/dev/null | xargs)

        if [ -n "$RESULT" ]; then
            echo ""
            print_info "Result details:"
            echo "$RESULT" | awk '{
                print "  • Confidence: " $1
                print "  • Word count: " $2
                print "  • Page count: " $3
                print "  • Processing time: " $4 "ms"
                print "  • Model version: " $5
            }'

            # Check for output file
            OUTPUT_FILE=$(find "$PROJECT_ROOT/output" -name "${TASK_ID}*.html" 2>/dev/null | head -n 1)
            if [ -n "$OUTPUT_FILE" ]; then
                echo ""
                print_success "Output file created: $OUTPUT_FILE"
                print_info "To view: open \"$OUTPUT_FILE\""
            fi
        fi

    elif [ "$TASK_STATUS" = "processing" ]; then
        print_info "Task is still processing... wait a bit longer"
    elif [ "$TASK_STATUS" = "failed" ]; then
        print_error "Task failed!"

        ERROR_MSG=$(psql -U ocr_platform_user -d ocr_platform_dev -t -c "
            SELECT error_message FROM tasks WHERE id = '$TASK_ID';
        " 2>/dev/null | xargs)

        print_error "Error: $ERROR_MSG"
    else
        print_info "Task is pending (worker may not be running)"
    fi

    echo ""
    print_header "Test Complete"
    echo ""
    print_info "Task ID: $TASK_ID"
    print_info "View all results:"
    echo "  psql -U ocr_platform_user -d ocr_platform_dev -c \"SELECT * FROM results WHERE task_id = '$TASK_ID';\""
    echo ""
    print_info "View output files:"
    echo "  ls -lh $PROJECT_ROOT/output/"
    echo ""
}

main
