#!/bin/bash

# OCR Platform - Database Setup Script
# This script creates the database, user, and applies the initial schema

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DB_NAME="${DB_NAME:-ocr_platform_dev}"
DB_USER="${DB_USER:-ocr_platform_user}"
DB_PASSWORD="${DB_PASSWORD:-ocr_platform_pass_dev}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATABASE_DIR="$(dirname "$SCRIPT_DIR")"
SCHEMA_FILE="$DATABASE_DIR/schema.sql"
SEED_FILE="$DATABASE_DIR/seeds/seed_data.sql"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}OCR Platform - Database Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Configuration:"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo "  Host: $DB_HOST"
echo "  Port: $DB_PORT"
echo ""

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo -e "${RED}Error: PostgreSQL is not installed or not in PATH${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: Checking PostgreSQL connection...${NC}"
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$USER" -d postgres -c '\q' 2>/dev/null; then
    echo -e "${RED}Error: Cannot connect to PostgreSQL server${NC}"
    echo "Please ensure PostgreSQL is running:"
    echo "  brew services start postgresql@16  (macOS with Homebrew)"
    echo "  sudo systemctl start postgresql    (Linux with systemd)"
    exit 1
fi
echo -e "${GREEN}✓ PostgreSQL connection successful${NC}"
echo ""

# Check if database already exists
echo -e "${YELLOW}Step 2: Checking if database exists...${NC}"
if psql -h "$DB_HOST" -p "$DB_PORT" -U "$USER" -d postgres -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    echo -e "${YELLOW}Warning: Database '$DB_NAME' already exists${NC}"
    read -p "Do you want to drop and recreate it? (yes/no): " CONFIRM
    if [ "$CONFIRM" = "yes" ]; then
        echo "Dropping existing database..."
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME;" 2>/dev/null || true
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$USER" -d postgres -c "DROP USER IF EXISTS $DB_USER;" 2>/dev/null || true
        echo -e "${GREEN}✓ Existing database dropped${NC}"
    else
        echo -e "${YELLOW}Setup cancelled${NC}"
        exit 0
    fi
fi
echo ""

# Create database user
echo -e "${YELLOW}Step 3: Creating database user...${NC}"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$USER" -d postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';" 2>/dev/null || {
    echo -e "${YELLOW}User already exists, skipping...${NC}"
}
echo -e "${GREEN}✓ Database user ready${NC}"
echo ""

# Create database
echo -e "${YELLOW}Step 4: Creating database...${NC}"
psql -h "$DB_HOST" -p "$DB_PORT" -U "$USER" -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
echo -e "${GREEN}✓ Database created${NC}"
echo ""

# Apply schema
echo -e "${YELLOW}Step 5: Applying database schema...${NC}"
if [ ! -f "$SCHEMA_FILE" ]; then
    echo -e "${RED}Error: Schema file not found: $SCHEMA_FILE${NC}"
    exit 1
fi
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$SCHEMA_FILE"
echo -e "${GREEN}✓ Schema applied successfully${NC}"
echo ""

# Ask about seed data
echo -e "${YELLOW}Step 6: Seed data${NC}"
read -p "Do you want to load seed data for testing? (yes/no): " LOAD_SEEDS
if [ "$LOAD_SEEDS" = "yes" ]; then
    if [ ! -f "$SEED_FILE" ]; then
        echo -e "${RED}Error: Seed file not found: $SEED_FILE${NC}"
        exit 1
    fi
    echo "Loading seed data..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$SEED_FILE"
    echo -e "${GREEN}✓ Seed data loaded${NC}"
else
    echo -e "${YELLOW}Skipping seed data${NC}"
fi
echo ""

# Create .env file
echo -e "${YELLOW}Step 7: Creating .env file...${NC}"
ENV_FILE="$DATABASE_DIR/../.env.database"
cat > "$ENV_FILE" << EOF
# Database Configuration for OCR Platform
# Generated: $(date)

DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

# Connection String
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME

# Pool Configuration
DB_POOL_MIN=2
DB_POOL_MAX=10
EOF
echo -e "${GREEN}✓ Environment file created: $ENV_FILE${NC}"
echo ""

# Verify installation
echo -e "${YELLOW}Step 8: Verifying installation...${NC}"
TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
echo "  Tables created: $TABLE_COUNT"

if [ "$LOAD_SEEDS" = "yes" ]; then
    USER_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM users;")
    TASK_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM tasks;")
    echo "  Users: $USER_COUNT"
    echo "  Tasks: $TASK_COUNT"
fi
echo -e "${GREEN}✓ Verification complete${NC}"
echo ""

# Summary
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Database Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Connection Details:"
echo "  Host: $DB_HOST:$DB_PORT"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo ""
echo "To connect manually:"
echo "  psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME"
echo ""
echo "Environment file:"
echo "  $ENV_FILE"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "  1. Source the environment file in your application"
echo "  2. Run CRUD tests: ./database/scripts/test_crud.sh"
echo "  3. Start developing your application"
echo ""
