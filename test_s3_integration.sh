#!/bin/bash

# Test S3 Integration - End-to-End
# Tests the complete flow: upload to S3 -> create task -> process -> verify result in S3

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DB_USER="ocr_platform_user"
DB_NAME="ocr_platform_dev"
ADMIN_USER_ID="11111111-1111-1111-1111-111111111111"

# Source environment variables
if [ -f "worker/.env" ]; then
    export $(cat worker/.env | grep -v '^#' | xargs)
fi

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}S3 Integration Test${NC}"
echo -e "${BLUE}=====================================${NC}"
echo

# Step 1: Create a test file
echo -e "${YELLOW}[1/7] Creating test PDF file...${NC}"
TEST_FILENAME="test_receipt_$(date +%s).pdf"
TEST_FILE="/tmp/$TEST_FILENAME"
echo "Mock PDF content for OCR testing" > "$TEST_FILE"
echo -e "${GREEN}✓ Created test file: $TEST_FILE${NC}"
echo

# Step 2: Generate file ID and S3 key
echo -e "${YELLOW}[2/7] Generating file metadata...${NC}"
FILE_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
DATE_PARTITION=$(date -u +%Y-%m)
S3_KEY="uploads/${ADMIN_USER_ID}/${DATE_PARTITION}/${FILE_ID}/${TEST_FILENAME}"
echo -e "${GREEN}✓ File ID: $FILE_ID${NC}"
echo -e "${GREEN}✓ S3 Key: $S3_KEY${NC}"
echo

# Step 3: Upload file to S3
echo -e "${YELLOW}[3/7] Uploading file to S3...${NC}"
python3 << EOF
import boto3
import os

s3 = boto3.client('s3',
    region_name=os.getenv('AWS_REGION'),
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY')
)

bucket_name = os.getenv('S3_BUCKET_NAME')
kms_key_id = os.getenv('KMS_KEY_ID')

with open('$TEST_FILE', 'rb') as f:
    s3.put_object(
        Bucket=bucket_name,
        Key='$S3_KEY',
        Body=f,
        ServerSideEncryption='aws:kms',
        SSEKMSKeyId=kms_key_id,
        Metadata={
            'user_id': '$ADMIN_USER_ID',
            'file_id': '$FILE_ID',
            'original_filename': '$TEST_FILENAME'
        }
    )

print(f"✓ Uploaded to s3://{bucket_name}/$S3_KEY")
EOF
echo

# Step 4: Insert file record into database
echo -e "${YELLOW}[4/7] Creating file record in database...${NC}"
psql -U "$DB_USER" -d "$DB_NAME" -t -A << EOF
INSERT INTO files (id, user_id, original_filename, stored_filename, file_path, s3_key, file_type, mime_type, file_size, file_hash)
VALUES (
    '$FILE_ID',
    '$ADMIN_USER_ID',
    '$TEST_FILENAME',
    'stored_$TEST_FILENAME',
    '$TEST_FILE',
    '$S3_KEY',
    'pdf',
    'application/pdf',
    1024,
    'test_hash_123'
) RETURNING id;
EOF
echo -e "${GREEN}✓ File record created${NC}"
echo

# Step 5: Create task
echo -e "${YELLOW}[5/7] Creating OCR task...${NC}"
TASK_ID=$(psql -U "$DB_USER" -d "$DB_NAME" -t -A << EOF
INSERT INTO tasks (user_id, file_id, status, priority)
VALUES ('$ADMIN_USER_ID', '$FILE_ID', 'pending', 5)
RETURNING id;
EOF
)
TASK_ID=$(echo "$TASK_ID" | grep -E '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' | head -n 1)
echo -e "${GREEN}✓ Task created: $TASK_ID${NC}"
echo

# Step 6: Add task to Redis queue
echo -e "${YELLOW}[6/7] Adding task to Redis queue...${NC}"
redis-cli LPUSH "ocr:task:queue" "$TASK_ID" > /dev/null
echo -e "${GREEN}✓ Task added to queue${NC}"
echo

# Step 7: Wait for task to be processed
echo -e "${YELLOW}[7/7] Waiting for task processing...${NC}"
echo "Checking task status (max 30 seconds)..."

for i in {1..30}; do
    STATUS=$(psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "SELECT status FROM tasks WHERE id = '$TASK_ID';")
    echo -n "."

    if [ "$STATUS" = "completed" ]; then
        echo
        echo -e "${GREEN}✓ Task completed!${NC}"
        break
    elif [ "$STATUS" = "failed" ]; then
        echo
        ERROR_MSG=$(psql -U "$DB_USER" -d "$DB_NAME" -t -A -c "SELECT error_message FROM tasks WHERE id = '$TASK_ID';")
        echo -e "${RED}✗ Task failed: $ERROR_MSG${NC}"
        exit 1
    fi

    sleep 1
done

if [ "$STATUS" != "completed" ]; then
    echo
    echo -e "${RED}✗ Task did not complete within 30 seconds (status: $STATUS)${NC}"
    exit 1
fi

echo

# Step 8: Verify result in database
echo -e "${BLUE}Verifying results...${NC}"
echo

RESULT=$(psql -U "$DB_USER" -d "$DB_NAME" -t -A << EOF
SELECT
    confidence_score,
    word_count,
    page_count,
    processing_time_ms,
    result_file_path,
    s3_result_key
FROM results
WHERE task_id = '$TASK_ID';
EOF
)

if [ -z "$RESULT" ]; then
    echo -e "${RED}✗ No result found in database${NC}"
    exit 1
fi

IFS='|' read -r CONFIDENCE WORD_COUNT PAGE_COUNT PROC_TIME LOCAL_PATH S3_RESULT_KEY <<< "$RESULT"

echo -e "${GREEN}Result Details:${NC}"
echo -e "  Confidence Score: ${CONFIDENCE}"
echo -e "  Word Count: ${WORD_COUNT}"
echo -e "  Page Count: ${PAGE_COUNT}"
echo -e "  Processing Time: ${PROC_TIME}ms"
echo -e "  Local Path: ${LOCAL_PATH}"
echo -e "  S3 Result Key: ${S3_RESULT_KEY}"
echo

# Step 9: Verify result file exists in S3
echo -e "${YELLOW}Verifying result in S3...${NC}"
python3 << EOF
import boto3
import os
import sys

s3 = boto3.client('s3',
    region_name=os.getenv('AWS_REGION'),
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY')
)

bucket_name = os.getenv('S3_BUCKET_NAME')
s3_key = '$S3_RESULT_KEY'

try:
    response = s3.head_object(Bucket=bucket_name, Key=s3_key)

    print(f"✓ Result file exists in S3")
    print(f"  Size: {response['ContentLength']} bytes")
    print(f"  Content-Type: {response.get('ContentType', 'N/A')}")
    print(f"  Encryption: {response.get('ServerSideEncryption', 'N/A')}")

    # Download and check content
    obj = s3.get_object(Bucket=bucket_name, Key=s3_key)
    content = obj['Body'].read().decode('utf-8')

    if '<html>' in content and 'Bäckerei' in content:
        print(f"✓ HTML content validated (contains expected German receipt data)")
    else:
        print(f"⚠ HTML content may be incomplete")

except Exception as e:
    print(f"✗ Error accessing S3 result: {e}")
    sys.exit(1)
EOF

echo

# Step 10: Cleanup
echo -e "${YELLOW}Cleaning up...${NC}"
rm -f "$TEST_FILE"
echo -e "${GREEN}✓ Local test file removed${NC}"

# Optionally delete from S3 (commented out to preserve test results)
# python3 << EOF
# import boto3, os
# s3 = boto3.client('s3')
# s3.delete_object(Bucket=os.getenv('S3_BUCKET_NAME'), Key='$S3_KEY')
# s3.delete_object(Bucket=os.getenv('S3_BUCKET_NAME'), Key='$S3_RESULT_KEY')
# EOF

echo
echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}✅ S3 INTEGRATION TEST PASSED! ✅${NC}"
echo -e "${GREEN}=====================================${NC}"
echo
echo "Summary:"
echo "  • File uploaded to S3: s3://${S3_BUCKET_NAME}/${S3_KEY}"
echo "  • Task processed successfully"
echo "  • Result uploaded to S3: s3://${S3_BUCKET_NAME}/${S3_RESULT_KEY}"
echo "  • All data stored in PostgreSQL with S3 paths"
echo
echo "Next steps:"
echo "  1. Check the S3 console to view uploaded files"
echo "  2. Query the database to see file and result records"
echo "  3. Download result HTML from S3 using the s3_result_key"
echo
