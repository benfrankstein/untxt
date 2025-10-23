#!/bin/bash

# Test Backend S3 Download (Pre-signed URL)

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}Backend S3 Download Test${NC}"
echo -e "${BLUE}================================${NC}"
echo

# Check if S3 key provided as argument
if [ -z "$1" ]; then
    echo -e "${YELLOW}Usage: $0 <s3-key>${NC}"
    echo
    echo "Example:"
    echo "  $0 uploads/11111111.../2025-10/.../file.txt"
    echo
    echo -e "${YELLOW}Trying to get latest file from database...${NC}"

    # Get latest S3 key from database
    S3_KEY=$(psql -U ocr_platform_user -d ocr_platform_dev -t -A -c \
        "SELECT s3_key FROM files WHERE s3_key IS NOT NULL ORDER BY uploaded_at DESC LIMIT 1;" 2>/dev/null)

    if [ -z "$S3_KEY" ]; then
        echo -e "${RED}✗ No S3 key found in database${NC}"
        echo
        echo "Please:"
        echo "  1. Upload a file first: ./test_upload.sh"
        echo "  2. Or provide S3 key: $0 <s3-key>"
        exit 1
    fi

    echo -e "${GREEN}✓ Found latest file: $S3_KEY${NC}"
else
    S3_KEY="$1"
fi

echo

# Step 1: Check if server is running
echo -e "${YELLOW}[1/4] Checking server health...${NC}"
HEALTH=$(curl -s http://localhost:8080/health)
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Server is running${NC}"
else
    echo -e "${RED}✗ Server is not running. Start it with: npm start${NC}"
    exit 1
fi

echo

# Step 2: Request pre-signed URL from backend
echo -e "${YELLOW}[2/4] Requesting pre-signed URL...${NC}"
echo "S3 Key: $S3_KEY"

RESPONSE=$(curl -s "http://localhost:8080/api/test/download/$S3_KEY")

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Request successful${NC}"
    echo
    echo "Response:"
    echo "$RESPONSE" | python3 -m json.tool

    # Extract download URL
    DOWNLOAD_URL=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['data']['downloadUrl'])" 2>/dev/null)

    if [ -z "$DOWNLOAD_URL" ]; then
        echo
        echo -e "${RED}✗ Failed to get download URL${NC}"
        exit 1
    fi
else
    echo -e "${RED}✗ Request failed${NC}"
    exit 1
fi

echo

# Step 3: Download file from S3 using pre-signed URL
echo -e "${YELLOW}[3/4] Downloading file from S3...${NC}"

# Extract filename from S3 key
FILENAME=$(basename "$S3_KEY")
OUTPUT_FILE="/tmp/downloaded_$FILENAME"

curl -s -o "$OUTPUT_FILE" "$DOWNLOAD_URL"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ File downloaded${NC}"
    echo "Saved to: $OUTPUT_FILE"
else
    echo -e "${RED}✗ Download failed${NC}"
    exit 1
fi

echo

# Step 4: Verify file content
echo -e "${YELLOW}[4/4] Verifying file content...${NC}"

if [ -f "$OUTPUT_FILE" ]; then
    FILE_SIZE=$(stat -f%z "$OUTPUT_FILE" 2>/dev/null || stat -c%s "$OUTPUT_FILE" 2>/dev/null)
    echo -e "${GREEN}✓ File exists${NC}"
    echo "Size: $FILE_SIZE bytes"
    echo
    echo "Content preview:"
    echo "─────────────────────────────"
    head -n 10 "$OUTPUT_FILE"
    echo "─────────────────────────────"
else
    echo -e "${RED}✗ File not found${NC}"
    exit 1
fi

echo
echo -e "${BLUE}================================${NC}"
echo -e "${GREEN}✅ DOWNLOAD TEST PASSED! ✅${NC}"
echo -e "${BLUE}================================${NC}"
echo
echo "Downloaded file: $OUTPUT_FILE"
echo "Original S3 location: s3://untxt/$S3_KEY"
echo
echo "To view full file:"
echo "  cat $OUTPUT_FILE"
echo
echo "To open in editor:"
echo "  open $OUTPUT_FILE"
echo
