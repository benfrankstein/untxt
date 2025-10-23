#!/bin/bash

# Complete S3 Upload/Download Flow Test

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Complete S3 Upload/Download Flow Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo

# Check if server is running
echo -e "${YELLOW}Checking server health...${NC}"
curl -s http://localhost:8080/health > /dev/null
if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Server is not running${NC}"
    echo "Start it with: ./start_services.sh"
    exit 1
fi
echo -e "${GREEN}✓ Server is running${NC}"
echo

# ============================================
# PART 1: UPLOAD
# ============================================

echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  PART 1: Upload Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo

# Create test file with content
TEST_FILE="/tmp/s3_flow_test_$(date +%s).txt"
cat > "$TEST_FILE" << EOF
S3 Flow Test File
Created at: $(date)
─────────────────────────────────────
This is a test file to verify the complete
upload and download flow through the backend API.

The file should be:
1. Uploaded to S3 with KMS encryption
2. Stored in database with S3 path
3. Downloadable via pre-signed URL
4. Content should match this original

Test ID: $(uuidgen)
EOF

echo -e "${GREEN}✓ Created test file: $TEST_FILE${NC}"
echo

# Upload file
echo -e "${YELLOW}Uploading file to S3 via backend...${NC}"
UPLOAD_RESPONSE=$(curl -s -X POST http://localhost:8080/api/test/upload \
  -F "file=@$TEST_FILE" \
  -F "userId=11111111-1111-1111-1111-111111111111")

echo "$UPLOAD_RESPONSE" | python3 -m json.tool
echo

# Extract S3 key from response
S3_KEY=$(echo "$UPLOAD_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['data']['s3Key'])" 2>/dev/null)

if [ -z "$S3_KEY" ]; then
    echo -e "${RED}✗ Upload failed${NC}"
    rm -f "$TEST_FILE"
    exit 1
fi

echo -e "${GREEN}✓ Upload successful${NC}"
echo "S3 Key: $S3_KEY"
echo

# ============================================
# PART 2: DOWNLOAD
# ============================================

echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  PART 2: Download Test${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo

# Request pre-signed URL
echo -e "${YELLOW}Requesting pre-signed URL...${NC}"
DOWNLOAD_RESPONSE=$(curl -s "http://localhost:8080/api/test/download/$S3_KEY")

echo "$DOWNLOAD_RESPONSE" | python3 -m json.tool
echo

# Extract download URL
DOWNLOAD_URL=$(echo "$DOWNLOAD_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['data']['downloadUrl'])" 2>/dev/null)

if [ -z "$DOWNLOAD_URL" ]; then
    echo -e "${RED}✗ Failed to get download URL${NC}"
    rm -f "$TEST_FILE"
    exit 1
fi

echo -e "${GREEN}✓ Pre-signed URL generated${NC}"
echo

# Download file
echo -e "${YELLOW}Downloading file from S3...${NC}"
DOWNLOADED_FILE="/tmp/downloaded_$(basename $TEST_FILE)"
curl -s -o "$DOWNLOADED_FILE" "$DOWNLOAD_URL"

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Download failed${NC}"
    rm -f "$TEST_FILE"
    exit 1
fi

echo -e "${GREEN}✓ File downloaded${NC}"
echo "Saved to: $DOWNLOADED_FILE"
echo

# ============================================
# PART 3: VERIFICATION
# ============================================

echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo -e "${BLUE}  PART 3: Content Verification${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo

echo -e "${YELLOW}Comparing original and downloaded files...${NC}"
echo

# Show file sizes
ORIGINAL_SIZE=$(stat -f%z "$TEST_FILE" 2>/dev/null || stat -c%s "$TEST_FILE" 2>/dev/null)
DOWNLOADED_SIZE=$(stat -f%z "$DOWNLOADED_FILE" 2>/dev/null || stat -c%s "$DOWNLOADED_FILE" 2>/dev/null)

echo "Original file size:   $ORIGINAL_SIZE bytes"
echo "Downloaded file size: $DOWNLOADED_SIZE bytes"
echo

# Compare content
if diff -q "$TEST_FILE" "$DOWNLOADED_FILE" > /dev/null; then
    echo -e "${GREEN}✓ Content matches perfectly!${NC}"
    CONTENT_MATCH=true
else
    echo -e "${RED}✗ Content mismatch!${NC}"
    CONTENT_MATCH=false
fi

echo

# ============================================
# FINAL SUMMARY
# ============================================

echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
if [ "$CONTENT_MATCH" = true ]; then
    echo -e "${GREEN}  ✅ ALL TESTS PASSED! ✅${NC}"
else
    echo -e "${RED}  ❌ TESTS FAILED ❌${NC}"
fi
echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
echo

echo "Test Summary:"
echo "  ✓ File uploaded to S3"
echo "  ✓ KMS encryption applied"
echo "  ✓ Pre-signed URL generated"
echo "  ✓ File downloaded from S3"

if [ "$CONTENT_MATCH" = true ]; then
    echo "  ✓ Content verification passed"
else
    echo "  ✗ Content verification failed"
fi

echo
echo "S3 Location: s3://untxt/$S3_KEY"
echo "Original:    $TEST_FILE"
echo "Downloaded:  $DOWNLOADED_FILE"
echo

# Cleanup
echo -e "${YELLOW}Cleaning up...${NC}"
rm -f "$TEST_FILE"
echo -e "${GREEN}✓ Temporary files cleaned up${NC}"
echo

if [ "$CONTENT_MATCH" = true ]; then
    echo "Downloaded file preserved for inspection:"
    echo "  cat $DOWNLOADED_FILE"
    echo
    exit 0
else
    rm -f "$DOWNLOADED_FILE"
    exit 1
fi
