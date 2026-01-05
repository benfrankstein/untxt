#!/bin/bash

# Test KVP API Endpoints
# This script tests the KVP extraction system APIs

API_URL="http://localhost:8080/api"
SESSION_COOKIE=""

echo "========================================="
echo "KVP API Tests"
echo "========================================="
echo ""

# Test 1: Get all sectors (requires auth - will fail without session)
echo "Test 1: GET /api/kvp/sectors"
echo "-----------------------------------------"
curl -s -X GET "${API_URL}/kvp/sectors" \
  -H "Content-Type: application/json" \
  -w "\nStatus: %{http_code}\n" | jq '.' 2>/dev/null || echo "Failed to parse JSON"
echo ""

echo "========================================="
echo "Note: To test authenticated endpoints, you need to:"
echo "1. Log in via the frontend (http://localhost:3000)"
echo "2. Copy the session cookie"
echo "3. Add it to these curl commands with: -b 'connect.sid=...'"
echo "========================================="
