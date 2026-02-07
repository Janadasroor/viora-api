#!/bin/bash

# Test Database Setup Script
# This script creates and sets up the test database for running repository tests

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up test database...${NC}"

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Database configuration
DB_USER="${TEST_DB_USER:-${DB_USER:-postgres}}"
DB_PASS="${TEST_DB_PASS:-${DB_PASS:-postgres}}"
DB_HOST="${TEST_DB_HOST:-localhost}"
DB_PORT="${TEST_DB_PORT:-5432}"
TEST_DB_NAME="${TEST_DB_NAME:-viora_test}"
MAIN_DB_NAME="viora_pluse_v1"

echo "Database User: $DB_USER"
echo "Database Host: $DB_HOST:$DB_PORT"
echo "Test Database: $TEST_DB_NAME"

# Check if PostgreSQL is running
if ! pg_isready -h $DB_HOST -p $DB_PORT -U $DB_USER > /dev/null 2>&1; then
    echo -e "${RED}Error: PostgreSQL is not running on $DB_HOST:$DB_PORT${NC}"
    echo "Please start PostgreSQL and try again."
    exit 1
fi

echo -e "${GREEN}PostgreSQL is running${NC}"

# Drop test database if it exists
echo "Dropping existing test database (if exists)..."
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "DROP DATABASE IF EXISTS $TEST_DB_NAME;" 2>/dev/null || true

# Create test database
echo "Creating test database..."
PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -c "CREATE DATABASE $TEST_DB_NAME;"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Test database created successfully${NC}"
else
    echo -e "${RED}Failed to create test database${NC}"
    exit 1
fi

# Copy schema from main database to test database
echo "Copying schema from main database..."
PGPASSWORD=$DB_PASS pg_dump -h $DB_HOST -p $DB_PORT -U $DB_USER -d $MAIN_DB_NAME --schema-only | \
    PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $TEST_DB_NAME

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Schema copied successfully${NC}"
else
    echo -e "${YELLOW}Warning: Could not copy schema from main database${NC}"
    echo "You may need to run migrations manually on the test database"
fi

echo -e "${GREEN}Test database setup complete!${NC}"
echo ""
echo "You can now run repository tests with:"
echo "  npm test"
echo ""
echo "To reset the test database, run this script again."
