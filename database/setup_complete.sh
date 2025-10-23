#!/bin/bash

# =============================================
# Complete Database Setup Script
# =============================================
# This script sets up the entire database schema including all migrations
# Run this when setting up the project on a new machine
#
# Usage:
#   ./setup_complete.sh
#
# Prerequisites:
#   - PostgreSQL 14+ installed
#   - Create a .env.database file with your database credentials (see .env.example)
# =============================================

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Load database configuration
if [ -f "$SCRIPT_DIR/.env.example" ]; then
    source "$SCRIPT_DIR/.env.example"
else
    echo -e "${RED}Error: .env.example not found${NC}"
    exit 1
fi

# Check if user has created their own .env.database
if [ ! -f "$PROJECT_ROOT/.env.database" ]; then
    echo -e "${YELLOW}Warning: .env.database not found. Using defaults from .env.example${NC}"
    echo -e "${YELLOW}It's recommended to create your own .env.database file${NC}"
    echo ""
fi

# Override with actual .env.database if it exists
if [ -f "$PROJECT_ROOT/.env.database" ]; then
    source "$PROJECT_ROOT/.env.database"
    echo -e "${GREEN}Using configuration from .env.database${NC}"
fi

echo "=========================================="
echo "Database Setup for OCR Platform"
echo "=========================================="
echo "Database: $DB_NAME"
echo "User: $DB_USER"
echo "Host: $DB_HOST"
echo "Port: $DB_PORT"
echo "=========================================="
echo ""

# Function to run SQL command
run_sql() {
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -v ON_ERROR_STOP=1 "$@"
}

# Function to run SQL command as postgres superuser (for database creation)
run_sql_as_postgres() {
    psql -h $DB_HOST -p $DB_PORT -U postgres -v ON_ERROR_STOP=1 "$@"
}

# Step 1: Create database and user (requires postgres superuser)
echo -e "${YELLOW}Step 1: Creating database and user...${NC}"
echo "Note: This requires postgres superuser access. Enter postgres password when prompted."

psql -h $DB_HOST -p $DB_PORT -U postgres -v ON_ERROR_STOP=0 <<SQL
-- Create user if not exists
DO \$\$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = '$DB_USER') THEN
      CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
   END IF;
END
\$\$;

-- Create database if not exists
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
SQL

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Database and user created/verified${NC}"
else
    echo -e "${YELLOW}⚠ Could not create database (may already exist or insufficient permissions)${NC}"
fi

echo ""

# Step 2: Apply base schema
echo -e "${YELLOW}Step 2: Applying base schema...${NC}"
if [ -f "$SCRIPT_DIR/schema.sql" ]; then
    run_sql -f "$SCRIPT_DIR/schema.sql"
    echo -e "${GREEN}✓ Base schema applied${NC}"
else
    echo -e "${RED}Error: schema.sql not found${NC}"
    exit 1
fi

echo ""

# Step 3: Apply migrations in order
echo -e "${YELLOW}Step 3: Applying migrations...${NC}"

MIGRATIONS=(
    "001_add_s3_fields.sql"
    "002_make_local_paths_optional.sql"
    "003_add_access_control_and_audit.sql"
    "003_add_document_versions.sql"
    "004_add_draft_versions.sql"
    "add_change_notifications.sql"
    "04_add_change_notifications.sql"
    "005_fix_draft_trigger.sql"
    "05_add_s3_cleanup_on_delete.sql"
    "006_allow_draft_version_number.sql"
    "06_preserve_task_history.sql"
    "007_fix_create_original_version_trigger.sql"
    "07_add_user_id_to_results_and_history.sql"
    "008_fix_create_original_version_character_count.sql"
    "009_create_document_edit_sessions.sql"
    "010_fix_create_original_version_deferrable.sql"
    "011_simplify_to_google_docs_flow.sql"
    "012_add_html_content_column.sql"
    "013_fix_trigger_for_google_docs_flow.sql"
    "014_make_s3_key_nullable.sql"
)

MIGRATIONS_APPLIED=0
MIGRATIONS_SKIPPED=0
MIGRATIONS_FAILED=0

for migration in "${MIGRATIONS[@]}"; do
    migration_file="$SCRIPT_DIR/migrations/$migration"

    if [ -f "$migration_file" ]; then
        echo "  Applying $migration..."
        if run_sql -f "$migration_file" 2>&1 | grep -q "ERROR"; then
            echo -e "    ${YELLOW}⚠ Migration may have already been applied or failed${NC}"
            ((MIGRATIONS_SKIPPED++))
        else
            echo -e "    ${GREEN}✓ Applied${NC}"
            ((MIGRATIONS_APPLIED++))
        fi
    else
        echo -e "    ${YELLOW}⚠ Migration file not found: $migration${NC}"
        ((MIGRATIONS_SKIPPED++))
    fi
done

echo ""
echo -e "${GREEN}Migration Summary:${NC}"
echo "  Applied: $MIGRATIONS_APPLIED"
echo "  Skipped: $MIGRATIONS_SKIPPED"
echo "  Failed: $MIGRATIONS_FAILED"
echo ""

# Step 4: Verify installation
echo -e "${YELLOW}Step 4: Verifying installation...${NC}"

# Count tables
TABLE_COUNT=$(run_sql -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
echo "  Tables created: $TABLE_COUNT"

# List main tables
echo "  Main tables:"
run_sql -c "\dt" | grep -E "(users|files|tasks|results|document_versions)" || echo "    Note: Some tables may not be created yet"

echo ""

# Step 5: Create admin user (optional)
echo -e "${YELLOW}Step 5: Creating admin user (optional)...${NC}"
read -p "Do you want to create an admin user? (y/N) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Creating admin user..."
    "$SCRIPT_DIR/scripts/reset_database_admin_user.sh"
else
    echo "Skipping admin user creation"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}Database setup complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Configure your application's database connection"
echo "  2. Start the backend server"
echo "  3. Run tests to verify everything works"
echo ""
echo "Connection string:"
echo "  postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"
echo ""
