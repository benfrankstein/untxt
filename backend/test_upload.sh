#!/bin/bash

# Test Backend S3 Upload

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}Backend S3 Upload Test${NC}"
echo -e "${BLUE}================================${NC}"
echo

# Step 1: Check if server is running
echo -e "${YELLOW}[1/3] Checking server health...${NC}"
HEALTH=$(curl -s http://localhost:8080/health)
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Server is running${NC}"
    echo "$HEALTH" | python3 -m json.tool
else
    echo -e "\033[0;31m✗ Server is not running. Start it with: npm start${NC}"
    exit 1
fi

echo

# Step 2: Create a test file
echo -e "${YELLOW}[2/3] Creating test file...${NC}"
TEST_FILE="/tmp/backend_test_$(date +%s).txt"
echo "This is a test file for backend S3 upload testing." > "$TEST_FILE"
echo "Created at: $(date)" >> "$TEST_FILE"
echo -e "${GREEN}✓ Created: $TEST_FILE${NC}"

echo

# Step 3: Upload file to S3 via backend
echo -e "${YELLOW}[3/3] Uploading file to S3...${NC}"
RESPONSE=$(curl -s -X POST http://localhost:8080/api/test/upload \
  -F "file=@$TEST_FILE" \
  -F "userId=11111111-1111-1111-1111-111111111111")

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Upload request sent${NC}"
    echo
    echo "Response:"
    echo "$RESPONSE" | python3 -m json.tool

    # Extract S3 key from response
    S3_KEY=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['data']['s3Key'])" 2>/dev/null)

    if [ ! -z "$S3_KEY" ]; then
        echo
        echo -e "${BLUE}================================${NC}"
        echo -e "${GREEN}✅ SUCCESS! File uploaded to S3${NC}"
        echo -e "${BLUE}================================${NC}"
        echo
        echo "S3 Location: s3://untxt/$S3_KEY"
        echo
        echo "To download, visit:"
        echo "  http://localhost:8080/api/test/download/$S3_KEY"
    fi
else
    echo -e "\033[0;31m✗ Upload failed${NC}"
fi

# Cleanup
rm -f "$TEST_FILE"

echo
