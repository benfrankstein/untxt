#!/bin/bash

#############################################################################
# OCR Platform Service Launcher
# Starts all Phase 1 and Phase 2 services in the correct order
#############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root directory
PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WORKER_DIR="$PROJECT_ROOT/worker"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
LOG_DIR="$PROJECT_ROOT/logs"
PID_DIR="$PROJECT_ROOT/pids"

# Create directories
mkdir -p "$LOG_DIR"
mkdir -p "$PID_DIR"
mkdir -p "$PROJECT_ROOT/output"

# Log files
POSTGRES_LOG="$LOG_DIR/postgresql.log"
REDIS_LOG="$LOG_DIR/redis.log"
WORKER_LOG="$LOG_DIR/worker.log"
FLASK_LOG="$LOG_DIR/flask.log"
BACKEND_LOG="$LOG_DIR/backend.log"
DB_LISTENER_LOG="$LOG_DIR/db-listener.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

# PID files
REDIS_PID="$PID_DIR/redis.pid"
WORKER_PID="$PID_DIR/worker.pid"
FLASK_PID="$PID_DIR/flask.pid"
BACKEND_PID="$PID_DIR/backend.pid"
DB_LISTENER_PID="$PID_DIR/db-listener.pid"
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

check_command() {
    if command -v "$1" &> /dev/null; then
        return 0
    else
        return 1
    fi
}

wait_for_service() {
    local service=$1
    local check_command=$2
    local max_wait=$3
    local waited=0

    print_info "Waiting for $service to be ready..."

    while [ $waited -lt $max_wait ]; do
        if eval "$check_command" &> /dev/null; then
            print_success "$service is ready"
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done

    print_error "$service failed to start within ${max_wait}s"
    return 1
}

#############################################################################
# Service Control Functions
#############################################################################

start_postgresql() {
    print_header "Phase 1.1: Starting PostgreSQL"

    if ! check_command psql; then
        print_error "PostgreSQL not found. Please install it first."
        exit 1
    fi

    # Check if PostgreSQL is already running
    if pg_isready -q 2>/dev/null; then
        print_success "PostgreSQL is already running"
    else
        # Start PostgreSQL
        print_info "Starting PostgreSQL..."
        if check_command brew; then
            brew services start postgresql@16 > /dev/null 2>&1
        else
            pg_ctl start -D /usr/local/var/postgresql@16 -l "$POSTGRES_LOG" &
        fi

        # Wait for PostgreSQL to be ready
        wait_for_service "PostgreSQL" "pg_isready" 30
    fi

    # Check if database exists
    if psql -U ocr_platform_user -d ocr_platform_dev -c "SELECT 1" &> /dev/null; then
        print_success "Database 'ocr_platform_dev' is accessible"
    else
        print_error "Database 'ocr_platform_dev' not found"
        echo ""
        print_info "Database needs to be initialized. Would you like to set it up now? (y/n)"
        read -r response

        if [[ "$response" =~ ^[Yy]$ ]]; then
            print_info "Running database setup..."
            echo ""

            if [ -f "$PROJECT_ROOT/database/scripts/setup_database.sh" ]; then
                cd "$PROJECT_ROOT/database/scripts"
                bash setup_database.sh
                cd "$PROJECT_ROOT"
                echo ""
                print_success "Database setup complete!"
            else
                print_error "Database setup script not found at database/scripts/setup_database.sh"
                exit 1
            fi
        else
            print_error "Database setup required. Please run: cd database/scripts && ./setup_database.sh"
            exit 1
        fi
    fi

    # Verify tables exist
    TABLE_COUNT=$(psql -U ocr_platform_user -d ocr_platform_dev -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | xargs)
    if [ "$TABLE_COUNT" -gt 0 ]; then
        print_success "Database schema verified ($TABLE_COUNT tables)"
    else
        print_error "Database schema not initialized"
        print_info "Please run: cd database/scripts && ./setup_database.sh"
        exit 1
    fi
}

start_redis() {
    print_header "Phase 1.2: Starting Redis"

    if ! check_command redis-server; then
        print_error "Redis not found. Please install it first."
        exit 1
    fi

    # Check if Redis is already running
    if redis-cli ping &> /dev/null; then
        print_success "Redis is already running"
        return 0
    fi

    # Start Redis
    print_info "Starting Redis server..."
    redis-server --daemonize yes \
                 --pidfile "$REDIS_PID" \
                 --logfile "$REDIS_LOG" \
                 --dir "$PROJECT_ROOT/redis" \
                 --port 6379

    # Wait for Redis to be ready
    wait_for_service "Redis" "redis-cli ping" 10

    print_success "Redis server started (PID: $(cat $REDIS_PID))"
}

start_worker() {
    print_header "Phase 2.1: Starting OCR Worker"

    # Check if virtual environment exists
    if [ ! -f "$PROJECT_ROOT/venv/bin/activate" ]; then
        print_error "Virtual environment not found at $PROJECT_ROOT/venv"
        print_info "Creating virtual environment..."
        python3 -m venv "$PROJECT_ROOT/venv"
        source "$PROJECT_ROOT/venv/bin/activate"
        pip install -q -r "$WORKER_DIR/requirements.txt"
    else
        source "$PROJECT_ROOT/venv/bin/activate"
    fi

    # Check if worker dependencies are installed
    if ! python -c "import flask" 2>/dev/null; then
        print_info "Installing worker dependencies..."
        pip install -q -r "$WORKER_DIR/requirements.txt"
    fi

    # Test connections
    print_info "Testing connections..."
    cd "$WORKER_DIR"
    if ! python test_connection.py > /dev/null 2>&1; then
        print_error "Connection test failed. Check Redis and PostgreSQL."
        exit 1
    fi

    # Check if worker is already running
    if [ -f "$WORKER_PID" ] && kill -0 $(cat "$WORKER_PID") 2>/dev/null; then
        print_success "Worker is already running (PID: $(cat $WORKER_PID))"
        return 0
    fi

    # OLD WORKER DISABLED - Backend now automatically starts MLX worker pool
    print_info "Skipping old worker (backend starts MLX worker pool automatically)..."
    # cd "$WORKER_DIR"
    # nohup python run_worker.py > "$WORKER_LOG" 2>&1 &
    # echo $! > "$WORKER_PID"

    # Worker pool is managed by backend - no verification needed here
    print_success "Worker pool will be started by backend (check backend logs)"
}

start_flask() {
    print_header "Phase 2.2: Starting Flask Health Check Server"

    source "$PROJECT_ROOT/venv/bin/activate"

    # Check if Flask is already running
    if [ -f "$FLASK_PID" ] && kill -0 $(cat "$FLASK_PID") 2>/dev/null; then
        print_success "Flask server is already running (PID: $(cat $FLASK_PID))"
        return 0
    fi

    # Start Flask
    print_info "Starting Flask server on port 5000..."
    cd "$WORKER_DIR"
    nohup python app.py > "$FLASK_LOG" 2>&1 &
    echo $! > "$FLASK_PID"

    sleep 2

    # Verify Flask started
    if kill -0 $(cat "$FLASK_PID") 2>/dev/null; then
        print_success "Flask server started (PID: $(cat $FLASK_PID))"
        print_info "Health check: http://localhost:5000/health"
        print_info "Logs: $FLASK_LOG"
    else
        print_error "Flask server failed to start. Check logs: $FLASK_LOG"
        exit 1
    fi
}

start_db_listener() {
    print_header "Phase 2.3: Starting Database Change Listener"

    # Check if Node.js is installed
    if ! check_command node; then
        print_error "Node.js not found. Please install it first."
        exit 1
    fi

    # Check if backend directory exists
    if [ ! -d "$BACKEND_DIR" ]; then
        print_error "Backend directory not found at $BACKEND_DIR"
        exit 1
    fi

    # Check if db-listener is already running
    if [ -f "$DB_LISTENER_PID" ] && kill -0 $(cat "$DB_LISTENER_PID") 2>/dev/null; then
        print_success "Database listener is already running (PID: $(cat $DB_LISTENER_PID))"
        return 0
    fi

    # Start db-listener
    print_info "Starting database change listener..."
    cd "$BACKEND_DIR"
    nohup node src/services/db-listener.js > "$DB_LISTENER_LOG" 2>&1 &
    echo $! > "$DB_LISTENER_PID"

    sleep 2

    # Verify db-listener started
    if kill -0 $(cat "$DB_LISTENER_PID") 2>/dev/null; then
        print_success "Database listener started (PID: $(cat $DB_LISTENER_PID))"
        print_info "Listening for direct database changes (SQL, pgAdmin, etc.)"
        print_info "Logs: $DB_LISTENER_LOG"
    else
        print_error "Database listener failed to start. Check logs: $DB_LISTENER_LOG"
        exit 1
    fi
}

start_backend() {
    print_header "Phase 3: Starting Backend API Server"

    # Check if Node.js is installed
    if ! check_command node; then
        print_error "Node.js not found. Please install it first."
        exit 1
    fi

    # Check if backend directory exists
    if [ ! -d "$BACKEND_DIR" ]; then
        print_error "Backend directory not found at $BACKEND_DIR"
        exit 1
    fi

    # Check if node_modules exists
    if [ ! -d "$BACKEND_DIR/node_modules" ]; then
        print_info "Installing backend dependencies..."
        cd "$BACKEND_DIR"
        npm install --cache /tmp/npm-cache > /dev/null 2>&1
    fi

    # Check if backend is already running
    if [ -f "$BACKEND_PID" ] && kill -0 $(cat "$BACKEND_PID") 2>/dev/null; then
        print_success "Backend API is already running (PID: $(cat $BACKEND_PID))"
        return 0
    fi

    # Start backend
    print_info "Starting Backend API server on port 8080..."
    cd "$BACKEND_DIR"
    nohup npm start > "$BACKEND_LOG" 2>&1 &
    echo $! > "$BACKEND_PID"

    sleep 3

    # Verify backend started
    if kill -0 $(cat "$BACKEND_PID") 2>/dev/null; then
        print_success "Backend API started (PID: $(cat $BACKEND_PID))"
        print_info "API endpoint: http://localhost:8080/health"
        print_info "Logs: $BACKEND_LOG"
    else
        print_error "Backend API failed to start. Check logs: $BACKEND_LOG"
        exit 1
    fi
}

start_frontend() {
    print_header "Phase 4: Starting Frontend Server"

    # Check if Node.js is installed
    if ! check_command node; then
        print_error "Node.js not found. Please install it first."
        exit 1
    fi

    # Check if frontend directory exists
    if [ ! -d "$FRONTEND_DIR" ]; then
        print_error "Frontend directory not found at $FRONTEND_DIR"
        exit 1
    fi

    # Check if frontend is already running
    if [ -f "$FRONTEND_PID" ] && kill -0 $(cat "$FRONTEND_PID") 2>/dev/null; then
        print_success "Frontend server is already running (PID: $(cat $FRONTEND_PID))"
        return 0
    fi

    # Start frontend
    print_info "Starting Frontend server on port 3000..."
    cd "$FRONTEND_DIR"
    nohup node server.js > "$FRONTEND_LOG" 2>&1 &
    echo $! > "$FRONTEND_PID"

    sleep 2

    # Verify frontend started
    if kill -0 $(cat "$FRONTEND_PID") 2>/dev/null; then
        print_success "Frontend server started (PID: $(cat $FRONTEND_PID))"
        print_info "Web UI: http://localhost:3000"
        print_info "Logs: $FRONTEND_LOG"
    else
        print_error "Frontend server failed to start. Check logs: $FRONTEND_LOG"
        exit 1
    fi
}

#############################################################################
# Status Check
#############################################################################

check_status() {
    print_header "Service Status"

    # PostgreSQL
    if pg_isready -q 2>/dev/null; then
        print_success "PostgreSQL: Running"
    else
        print_error "PostgreSQL: Not running"
    fi

    # Redis
    if redis-cli ping &> /dev/null; then
        QUEUE_LEN=$(redis-cli LLEN ocr:task:queue 2>/dev/null || echo "0")
        print_success "Redis: Running (Queue length: $QUEUE_LEN)"
    else
        print_error "Redis: Not running"
    fi

    # Worker
    if [ -f "$WORKER_PID" ] && kill -0 $(cat "$WORKER_PID") 2>/dev/null; then
        print_success "Worker: Running (PID: $(cat $WORKER_PID))"
    else
        print_error "Worker: Not running"
    fi

    # Flask
    if [ -f "$FLASK_PID" ] && kill -0 $(cat "$FLASK_PID") 2>/dev/null; then
        print_success "Flask: Running (PID: $(cat $FLASK_PID))"
    else
        print_error "Flask: Not running"
    fi

    # Database Listener
    if [ -f "$DB_LISTENER_PID" ] && kill -0 $(cat "$DB_LISTENER_PID") 2>/dev/null; then
        print_success "Database Listener: Running (PID: $(cat $DB_LISTENER_PID))"
    else
        print_error "Database Listener: Not running"
    fi

    # Backend
    if [ -f "$BACKEND_PID" ] && kill -0 $(cat "$BACKEND_PID") 2>/dev/null; then
        print_success "Backend: Running (PID: $(cat $BACKEND_PID))"
    else
        print_error "Backend: Not running"
    fi

    # Frontend
    if [ -f "$FRONTEND_PID" ] && kill -0 $(cat "$FRONTEND_PID") 2>/dev/null; then
        print_success "Frontend: Running (PID: $(cat $FRONTEND_PID))"
    else
        print_error "Frontend: Not running"
    fi

    echo ""
    print_info "Logs directory: $LOG_DIR"
    print_info "PID directory: $PID_DIR"
}

#############################################################################
# Main Execution
#############################################################################

main() {
    clear
    print_header "OCR Platform - Starting All Services"
    echo ""
    echo "Project root: $PROJECT_ROOT"
    echo ""

    # Start services in order
    start_postgresql
    echo ""

    start_redis
    echo ""

    start_worker
    echo ""

    start_flask
    echo ""

    start_db_listener
    echo ""

    start_backend
    echo ""

    start_frontend
    echo ""

    # Show status
    check_status
    echo ""

    print_header "All Services Started Successfully!"
    echo ""
    print_info "Service URLs:"
    echo "  • Frontend Web UI:    http://localhost:3000"
    echo "  • Backend API:        http://localhost:8080/health"
    echo "  • Flask Health Check: http://localhost:5000/health"
    echo "  • Flask Status:       http://localhost:5000/status"
    echo ""
    print_info "Useful Commands:"
    echo "  • View worker logs:   tail -f $WORKER_LOG"
    echo "  • View flask logs:    tail -f $FLASK_LOG"
    echo "  • View backend logs:  tail -f $BACKEND_LOG"
    echo "  • View frontend logs: tail -f $FRONTEND_LOG"
    echo "  • Check queue:        redis-cli LLEN ocr:task:queue"
    echo "  • Stop all services:  ./stop_services.sh"
    echo ""
    print_info "To test the system:"
    echo "  Open http://localhost:3000 in your browser"
    echo ""
}

main
