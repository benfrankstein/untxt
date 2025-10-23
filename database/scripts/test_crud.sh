#!/bin/bash

# OCR Platform - CRUD Testing Script
# Runs comprehensive CRUD tests on the database

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
DB_NAME="${DB_NAME:-ocr_platform_dev}"
DB_USER="${DB_USER:-ocr_platform_user}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATABASE_DIR="$(dirname "$SCRIPT_DIR")"
TEST_FILE="$DATABASE_DIR/tests/test_crud.sql"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}OCR Platform - CRUD Test Suite${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Testing database: $DB_NAME"
echo "As user: $DB_USER"
echo ""

# Check if database exists
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    echo -e "${RED}Error: Database '$DB_NAME' does not exist${NC}"
    echo "Please run setup_database.sh first"
    exit 1
fi

# Check if test file exists
if [ ! -f "$TEST_FILE" ]; then
    echo -e "${RED}Error: Test file not found: $TEST_FILE${NC}"
    exit 1
fi

# Run tests
echo -e "${YELLOW}Running CRUD tests...${NC}"
echo ""

if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$TEST_FILE"; then
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}All tests passed!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "Your database is functioning correctly."
    exit 0
else
    echo ""
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}Tests failed!${NC}"
    echo -e "${RED}========================================${NC}"
    echo ""
    echo "Please review the error messages above."
    exit 1
fi
