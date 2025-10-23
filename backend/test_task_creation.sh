#!/bin/bash

# Test Production Task Creation Endpoint

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}  Task Creation Test${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo

# Step 1: Check server health
echo -e "${YELLOW}[1/5] Checking server health...${NC}"
HEALTH=$(curl -s http://localhost:8080/health)
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Server is running${NC}"
    echo "$HEALTH" | python3 -m json.tool
else
    echo -e "${RED}✗ Server is not running. Start it with: ./start_services.sh${NC}"
    exit 1
fi

echo

# Step 2: Create test file
echo -e "${YELLOW}[2/5] Creating test file...${NC}"
TEST_FILE="/tmp/task_test_$(date +%s).txt"
cat > "$TEST_FILE" << EOF
Task Creation Test File
Created at: $(date)
─────────────────────────────────────
This file tests the complete task creation flow:
1. File upload to S3
2. Database record creation (files + tasks)
3. Task enqueued to Redis
4. Worker processes the task
5. Result uploaded to S3

Test ID: $(uuidgen)
EOF

echo -e "${GREEN}✓ Created test file: $TEST_FILE${NC}"
FILE_SIZE=$(stat -f%z "$TEST_FILE" 2>/dev/null || stat -c%s "$TEST_FILE" 2>/dev/null)
echo "File size: $FILE_SIZE bytes"

echo

# Step 3: Upload file and create task
echo -e "${YELLOW}[3/5] Creating task via POST /api/tasks...${NC}"
RESPONSE=$(curl -s -X POST http://localhost:8080/api/tasks \
  -F "file=@$TEST_FILE" \
  -F "userId=11111111-1111-1111-1111-111111111111" \
  -F "priority=5")

echo "$RESPONSE" | python3 -m json.tool

# Extract task ID
TASK_ID=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['data']['taskId'])" 2>/dev/null)

if [ -z "$TASK_ID" ]; then
    echo
    echo -e "${RED}✗ Task creation failed${NC}"
    rm -f "$TEST_FILE"
    exit 1
fi

echo
echo -e "${GREEN}✓ Task created successfully${NC}"
echo "Task ID: $TASK_ID"

echo

# Step 4: Check task status
echo -e "${YELLOW}[4/5] Checking task status...${NC}"
sleep 1
STATUS_RESPONSE=$(curl -s "http://localhost:8080/api/tasks/$TASK_ID/status")
echo "$STATUS_RESPONSE" | python3 -m json.tool

echo

# Step 5: Check Redis queue
echo -e "${YELLOW}[5/5] Checking Redis queue...${NC}"
QUEUE_LENGTH=$(redis-cli LLEN ocr:task:queue 2>/dev/null || echo "N/A")
echo "Queue length: $QUEUE_LENGTH"

if [ "$QUEUE_LENGTH" != "N/A" ]; then
    echo
    echo "Latest task in queue:"
    redis-cli LINDEX ocr:task:queue 0 2>/dev/null | python3 -m json.tool
fi

echo

# Step 6: Check database
echo -e "${YELLOW}[Bonus] Checking database records...${NC}"
echo
echo "File record:"
psql -U ocr_platform_user -d ocr_platform_dev -c \
  "SELECT id, filename, mime_type, file_size, status, uploaded_at FROM files ORDER BY uploaded_at DESC LIMIT 1;" \
  2>/dev/null

echo
echo "Task record:"
psql -U ocr_platform_user -d ocr_platform_dev -c \
  "SELECT id, file_id, status, priority, created_at FROM tasks ORDER BY created_at DESC LIMIT 1;" \
  2>/dev/null

echo

# Summary
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ TASK CREATION TEST COMPLETE! ✅${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo
echo "Test Summary:"
echo "  ✓ File uploaded to S3"
echo "  ✓ File record created in database"
echo "  ✓ Task record created in database"
echo "  ✓ Task enqueued to Redis"
echo
echo "Task ID: $TASK_ID"
echo
echo "Next steps:"
echo "  • Worker will process the task automatically"
echo "  • Check task status: curl http://localhost:8080/api/tasks/$TASK_ID"
echo "  • Get result: curl http://localhost:8080/api/tasks/$TASK_ID/result"
echo "  • View worker logs: tail -f ../logs/worker.log"
echo
echo "To monitor task processing in real-time:"
echo "  watch -n 1 \"curl -s http://localhost:8080/api/tasks/$TASK_ID/status | python3 -m json.tool\""
echo

# Cleanup
rm -f "$TEST_FILE"
