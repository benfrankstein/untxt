#!/bin/bash

#############################################################################
# OCR Platform Service Stopper
# Stops all running services gracefully
#############################################################################

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root directory
PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PID_DIR="$PROJECT_ROOT/pids"

# PID files
REDIS_PID="$PID_DIR/redis.pid"
WORKER_PID="$PID_DIR/worker.pid"
FLASK_PID="$PID_DIR/flask.pid"
DB_LISTENER_PID="$PID_DIR/db-listener.pid"
BACKEND_PID="$PID_DIR/backend.pid"
FRONTEND_PID="$PID_DIR/frontend.pid"

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

stop_process() {
    local name=$1
    local pid_file=$2

    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            print_info "Stopping $name (PID: $pid)..."
            kill "$pid" 2>/dev/null

            # Wait for process to stop (max 10 seconds)
            for i in {1..10}; do
                if ! kill -0 "$pid" 2>/dev/null; then
                    print_success "$name stopped"
                    rm -f "$pid_file"
                    return 0
                fi
                sleep 1
            done

            # Force kill if still running
            print_info "Force stopping $name..."
            kill -9 "$pid" 2>/dev/null
            rm -f "$pid_file"
            print_success "$name stopped (forced)"
        else
            print_info "$name is not running"
            rm -f "$pid_file"
        fi
    else
        print_info "$name PID file not found (not running)"
    fi
}

#############################################################################
# Main Execution
#############################################################################

main() {
    clear
    print_header "OCR Platform - Stopping All Services"
    echo ""

    # Stop Frontend first (Phase 4)
    if [ -f "$FRONTEND_PID" ]; then
        stop_process "Frontend Server" "$FRONTEND_PID"
    fi
    echo ""

    # Stop Backend (Phase 3)
    if [ -f "$BACKEND_PID" ]; then
        stop_process "Backend API Server" "$BACKEND_PID"
    fi
    echo ""

    # Stop Database Listener (Phase 2.3)
    if [ -f "$DB_LISTENER_PID" ]; then
        stop_process "Database Change Listener" "$DB_LISTENER_PID"
    fi
    echo ""

    # Stop Flask (Phase 2)
    if [ -f "$FLASK_PID" ]; then
        stop_process "Flask Health Check Server" "$FLASK_PID"
    fi
    echo ""

    # Stop MLX Worker Pool (Phase 2)
    print_info "Stopping MLX Worker Pool..."

    # Find and kill worker_pool_manager process
    POOL_PID=$(pgrep -f "worker_pool_manager.py" | head -1)
    if [ -n "$POOL_PID" ]; then
        print_info "Stopping worker pool manager (PID: $POOL_PID)..."
        kill "$POOL_PID" 2>/dev/null

        # Wait for graceful shutdown (max 15 seconds)
        for i in {1..15}; do
            if ! kill -0 "$POOL_PID" 2>/dev/null; then
                print_success "Worker pool stopped"
                break
            fi
            sleep 1
        done

        # Force kill if still running
        if kill -0 "$POOL_PID" 2>/dev/null; then
            print_info "Force stopping worker pool..."
            kill -9 "$POOL_PID" 2>/dev/null
            print_success "Worker pool stopped (forced)"
        fi
    else
        print_info "Worker pool is not running"
    fi

    # Clean up any remaining qwen_worker processes
    WORKER_PIDS=$(pgrep -f "qwen_worker" | tr '\n' ' ')
    if [ -n "$WORKER_PIDS" ]; then
        print_info "Cleaning up remaining worker processes..."
        pkill -f "qwen_worker"
        sleep 1
        print_success "Worker processes cleaned up"
    fi

    # Clean up old worker PID file if it exists
    rm -f "$WORKER_PID"
    echo ""

    # Stop Redis (Phase 1)
    print_info "Stopping Redis..."
    if command -v redis-cli &> /dev/null && redis-cli ping &> /dev/null; then
        redis-cli shutdown 2>/dev/null
        sleep 1
        if redis-cli ping &> /dev/null; then
            print_error "Redis failed to stop"
        else
            print_success "Redis stopped"
            rm -f "$REDIS_PID"
        fi
    else
        print_info "Redis is not running"
    fi
    echo ""

    # Stop PostgreSQL (optional - usually left running)
    print_info "PostgreSQL management:"
    echo "  • PostgreSQL is typically left running for development"
    echo "  • To stop: brew services stop postgresql@16"
    echo ""

    print_header "All Services Stopped"
    echo ""
    print_info "To restart services, run: ./start_services.sh"
    echo ""
}

main
