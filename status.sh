#!/bin/bash

#############################################################################
# Service Status Checker
# Shows the current status of all services
#############################################################################

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Project root directory
PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PID_DIR="$PROJECT_ROOT/pids"
LOG_DIR="$PROJECT_ROOT/logs"

# PID files
REDIS_PID="$PID_DIR/redis.pid"
WORKER_PID="$PID_DIR/worker.pid"
FLASK_PID="$PID_DIR/flask.pid"

print_header() {
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
}

print_running() {
    echo -e "${GREEN}●${NC} $1"
}

print_stopped() {
    echo -e "${RED}●${NC} $1"
}

print_info() {
    echo -e "  ${CYAN}→${NC} $1"
}

main() {
    clear
    print_header "OCR Platform - Service Status"
    echo ""

    # PostgreSQL
    if pg_isready -q 2>/dev/null; then
        print_running "PostgreSQL: RUNNING"
        DB_SIZE=$(psql -U ocr_platform_user -d ocr_platform_dev -t -c "SELECT pg_size_pretty(pg_database_size('ocr_platform_dev'));" 2>/dev/null | xargs)
        TASK_COUNT=$(psql -U ocr_platform_user -d ocr_platform_dev -t -c "SELECT COUNT(*) FROM tasks;" 2>/dev/null | xargs)
        RESULT_COUNT=$(psql -U ocr_platform_user -d ocr_platform_dev -t -c "SELECT COUNT(*) FROM results;" 2>/dev/null | xargs)
        print_info "Database size: $DB_SIZE"
        print_info "Total tasks: $TASK_COUNT"
        print_info "Total results: $RESULT_COUNT"
    else
        print_stopped "PostgreSQL: STOPPED"
    fi
    echo ""

    # Redis
    if redis-cli ping &> /dev/null; then
        print_running "Redis: RUNNING"
        QUEUE_LEN=$(redis-cli LLEN ocr:task:queue 2>/dev/null || echo "0")
        TOTAL_TASKS=$(redis-cli GET ocr:stats:tasks:total 2>/dev/null || echo "0")
        COMPLETED=$(redis-cli GET ocr:stats:tasks:completed 2>/dev/null || echo "0")
        FAILED=$(redis-cli GET ocr:stats:tasks:failed 2>/dev/null || echo "0")
        print_info "Queue length: $QUEUE_LEN tasks"
        print_info "Statistics: $COMPLETED completed, $FAILED failed (total: $TOTAL_TASKS)"
        if [ -f "$REDIS_PID" ]; then
            print_info "PID: $(cat $REDIS_PID)"
        fi
        print_info "Log: $LOG_DIR/redis.log"
    else
        print_stopped "Redis: STOPPED"
    fi
    echo ""

    # Worker
    if [ -f "$WORKER_PID" ] && kill -0 $(cat "$WORKER_PID") 2>/dev/null; then
        print_running "OCR Worker: RUNNING"
        print_info "PID: $(cat $WORKER_PID)"
        print_info "Log: $LOG_DIR/worker.log"
        if [ -f "$LOG_DIR/worker.log" ]; then
            LAST_LINE=$(tail -n 1 "$LOG_DIR/worker.log" 2>/dev/null)
            print_info "Last log: ${LAST_LINE:0:60}..."
        fi
    else
        print_stopped "OCR Worker: STOPPED"
    fi
    echo ""

    # Flask
    if [ -f "$FLASK_PID" ] && kill -0 $(cat "$FLASK_PID") 2>/dev/null; then
        print_running "Flask Health Check: RUNNING"
        print_info "PID: $(cat $FLASK_PID)"
        print_info "URL: http://localhost:5000/health"
        print_info "Log: $LOG_DIR/flask.log"

        # Try to get health status
        if command -v curl &> /dev/null; then
            HEALTH=$(curl -s http://localhost:5000/health 2>/dev/null | python3 -m json.tool 2>/dev/null | head -n 5)
            if [ -n "$HEALTH" ]; then
                print_info "Health check response:"
                echo "$HEALTH" | sed 's/^/    /'
            fi
        fi
    else
        print_stopped "Flask Health Check: STOPPED"
    fi
    echo ""

    # Output directory
    print_header "Output Files"
    echo ""
    if [ -d "$PROJECT_ROOT/output" ]; then
        FILE_COUNT=$(ls -1 "$PROJECT_ROOT/output"/*.html 2>/dev/null | wc -l | xargs)
        if [ "$FILE_COUNT" -gt 0 ]; then
            echo -e "${GREEN}$FILE_COUNT${NC} HTML output file(s) in $PROJECT_ROOT/output/"
            echo ""
            echo "Recent files:"
            ls -lth "$PROJECT_ROOT/output"/*.html 2>/dev/null | head -n 5 | awk '{print "  " $9 " (" $5 ", " $6 " " $7 " " $8 ")"}'
        else
            echo "No output files yet"
        fi
    else
        echo "Output directory not found"
    fi
    echo ""

    # Quick actions
    print_header "Quick Actions"
    echo ""
    echo "  ./start_services.sh    - Start all services"
    echo "  ./stop_services.sh     - Stop all services"
    echo "  ./test_worker.sh       - Run end-to-end test"
    echo "  ./status.sh            - Show this status (refresh)"
    echo ""
    echo "  tail -f $LOG_DIR/worker.log    - Watch worker logs"
    echo "  redis-cli MONITOR                           - Watch Redis commands"
    echo ""
}

main
