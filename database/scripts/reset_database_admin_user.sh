#!/bin/bash

#############################################################################
# Reset Database with Admin User
# Wipes all data and creates a single admin user
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

# Admin user details
ADMIN_USERNAME="benfrankstein"
ADMIN_EMAIL="benjamin.frankstein@gmail.com"
ADMIN_PASSWORD="Banker2b"

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

print_warning() {
    echo -e "${RED}⚠${NC}  $1"
}

main() {
    clear
    print_header "Database Reset - Admin User Setup"
    echo ""

    print_warning "WARNING: This will DELETE ALL DATA from the database!"
    echo ""
    print_info "This will:"
    echo "  • Delete all tasks, files, results, sessions"
    echo "  • Delete all users"
    echo "  • Create a single admin user:"
    echo "    - Username: $ADMIN_USERNAME"
    echo "    - Email: $ADMIN_EMAIL"
    echo "    - Role: admin"
    echo ""
    print_warning "This action CANNOT be undone!"
    echo ""
    print_info "Type 'DELETE ALL DATA' to confirm:"
    read -r confirmation

    if [ "$confirmation" != "DELETE ALL DATA" ]; then
        print_error "Confirmation failed. Aborting."
        exit 1
    fi

    echo ""
    print_header "Step 1: Clearing All Data"
    echo ""

    print_info "Deleting data from all tables..."

    # Delete in correct order (respect foreign keys)
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<SQL
-- Delete all data (cascade will handle related records)
DELETE FROM results;
DELETE FROM tasks;
DELETE FROM files;
DELETE FROM user_sessions;
DELETE FROM users;

-- Verify deletion
SELECT
    'results' as table_name, COUNT(*) as count FROM results
UNION ALL
SELECT 'tasks', COUNT(*) FROM tasks
UNION ALL
SELECT 'files', COUNT(*) FROM files
UNION ALL
SELECT 'user_sessions', COUNT(*) FROM user_sessions
UNION ALL
SELECT 'users', COUNT(*) FROM users;
SQL

    print_success "All data deleted"
    echo ""

    print_header "Step 2: Creating Admin User"
    echo ""

    print_info "Generating password hash..."

    # Hash the password using Node.js (bcrypt)
    # We'll use 10 rounds for bcrypt
    PASSWORD_HASH=$(node -e "
        const bcrypt = require('bcrypt');
        const hash = bcrypt.hashSync('$ADMIN_PASSWORD', 10);
        console.log(hash);
    ")

    if [ -z "$PASSWORD_HASH" ]; then
        print_error "Failed to generate password hash"
        print_info "Make sure bcrypt is installed: cd backend && npm install"
        exit 1
    fi

    print_success "Password hash generated"
    print_info "Creating admin user..."

    # Insert admin user
    ADMIN_ID=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
        INSERT INTO users (
            username,
            email,
            password_hash,
            role,
            is_active,
            email_verified
        ) VALUES (
            '$ADMIN_USERNAME',
            '$ADMIN_EMAIL',
            '$PASSWORD_HASH',
            'admin',
            true,
            true
        ) RETURNING id;
    " | xargs)

    if [ -z "$ADMIN_ID" ]; then
        print_error "Failed to create admin user"
        exit 1
    fi

    print_success "Admin user created with ID: $ADMIN_ID"
    echo ""

    print_header "Step 3: Verification"
    echo ""

    print_info "Database contents:"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
        SELECT
            id,
            username,
            email,
            role,
            is_active,
            email_verified,
            created_at
        FROM users;
    "

    echo ""
    print_success "Database reset complete!"
    echo ""

    print_header "Admin User Credentials"
    echo ""
    echo "  Username:       $ADMIN_USERNAME"
    echo "  Email:          $ADMIN_EMAIL"
    echo "  Password:       $ADMIN_PASSWORD"
    echo "  Role:           admin"
    echo "  User ID:        $ADMIN_ID"
    echo ""
    print_warning "IMPORTANT: Change the password after first login!"
    echo ""

    print_info "Database statistics:"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
        SELECT
            'Users' as table_name, COUNT(*) as count FROM users
        UNION ALL
        SELECT 'Tasks', COUNT(*) FROM tasks
        UNION ALL
        SELECT 'Files', COUNT(*) FROM files
        UNION ALL
        SELECT 'Results', COUNT(*) FROM results
        UNION ALL
        SELECT 'Sessions', COUNT(*) FROM user_sessions;
    "

    echo ""
    print_header "Next Steps"
    echo ""
    print_info "You can now:"
    echo "  • Login with the credentials above"
    echo "  • Upload documents via: http://localhost:3000"
    echo "  • Use this user ID in API requests: $ADMIN_ID"
    echo ""
    print_info "Update frontend app.js to use this user ID:"
    echo "  const USER_ID = '$ADMIN_ID';"
    echo ""
}

main
