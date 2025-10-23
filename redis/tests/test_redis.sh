#!/bin/bash

# OCR Platform - Redis Test Script
# Tests all Redis operations needed for the platform

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}OCR Platform - Redis Test Suite${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Testing Redis at: $REDIS_HOST:$REDIS_PORT"
echo ""

# Helper function to run test
run_test() {
    local test_name="$1"
    local test_command="$2"

    echo -e "${BLUE}Testing:${NC} $test_name"

    if eval "$test_command" &>/dev/null; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}✗ FAIL${NC}"
        ((TESTS_FAILED++))
    fi
    echo ""
}

# Check connection
echo -e "${YELLOW}=== Connection Tests ===${NC}"
echo ""

run_test "Ping Redis" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT ping | grep -q PONG"

run_test "Check Redis version" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT INFO server | grep -q redis_version"

# Basic operations (SET, GET)
echo -e "${YELLOW}=== Basic Operations (SET/GET) ===${NC}"
echo ""

run_test "SET a key" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT SET test:key 'test_value' | grep -q OK"

run_test "GET a key" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT GET test:key | grep -q test_value"

run_test "SET with expiry (EX)" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT SET test:expire 'value' EX 10 | grep -q OK"

run_test "Check TTL" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT TTL test:expire | grep -qE '^[0-9]+$'"

run_test "DEL a key" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT DEL test:key | grep -q 1"

# Task Queue operations (LIST)
echo -e "${YELLOW}=== Task Queue Operations (LPUSH/RPOP) ===${NC}"
echo ""

run_test "LPUSH to queue" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT LPUSH ocr:task:queue 'task_1' | grep -qE '^[0-9]+$'"

run_test "LPUSH multiple tasks" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT LPUSH ocr:task:queue 'task_2' 'task_3' | grep -qE '^[0-9]+$'"

run_test "LLEN check queue length" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT LLEN ocr:task:queue | grep -qE '^[0-9]+$'"

run_test "RPOP from queue (FIFO)" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT RPOP ocr:task:queue | grep -q task_1"

run_test "LRANGE view queue" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT LRANGE ocr:task:queue 0 -1 | grep -q task"

# Clean up queue
redis-cli -h $REDIS_HOST -p $REDIS_PORT DEL ocr:task:queue &>/dev/null

# Hash operations (task metadata)
echo -e "${YELLOW}=== Hash Operations (HSET/HGET) ===${NC}"
echo ""

run_test "HSET task metadata" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT HSET ocr:task:123 user_id 'user-abc' status 'pending' priority 5 | grep -qE '^[0-9]+$'"

run_test "HGET single field" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT HGET ocr:task:123 status | grep -q pending"

run_test "HGETALL all fields" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT HGETALL ocr:task:123 | grep -q user_id"

run_test "HINCRBY increment attempts" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT HINCRBY ocr:task:123 attempts 1 | grep -q 1"

run_test "HEXISTS check field" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT HEXISTS ocr:task:123 user_id | grep -q 1"

run_test "HDEL delete field" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT HDEL ocr:task:123 priority | grep -q 1"

# Clean up hash
redis-cli -h $REDIS_HOST -p $REDIS_PORT DEL ocr:task:123 &>/dev/null

# Pub/Sub operations
echo -e "${YELLOW}=== Pub/Sub Operations ===${NC}"
echo ""

# Start subscriber in background
(redis-cli -h $REDIS_HOST -p $REDIS_PORT SUBSCRIBE ocr:notifications | grep -m 1 -q "task_completed") &
SUBSCRIBER_PID=$!
sleep 1

run_test "PUBLISH to channel" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT PUBLISH ocr:notifications 'task_completed' | grep -qE '^[0-9]+$'"

# Kill subscriber
kill $SUBSCRIBER_PID 2>/dev/null || true
sleep 1

# Sorted Set operations (priority queue)
echo -e "${YELLOW}=== Sorted Set Operations (ZADD/ZPOP) ===${NC}"
echo ""

run_test "ZADD priority queue" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT ZADD ocr:priority:queue 5 'task_low' 8 'task_high' 3 'task_urgent' | grep -q 3"

run_test "ZRANGE ascending order" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT ZRANGE ocr:priority:queue 0 -1 | grep -q task_urgent"

run_test "ZREVRANGE descending order" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT ZREVRANGE ocr:priority:queue 0 -1 | grep -q task_urgent"

run_test "ZPOPMAX get highest priority" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT ZPOPMAX ocr:priority:queue | grep -q task_high"

run_test "ZCARD count members" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT ZCARD ocr:priority:queue | grep -q 2"

# Clean up sorted set
redis-cli -h $REDIS_HOST -p $REDIS_PORT DEL ocr:priority:queue &>/dev/null

# Session storage (with expiry)
echo -e "${YELLOW}=== Session Storage ===${NC}"
echo ""

run_test "Store session with expiry" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT SETEX ocr:session:abc123 3600 '{\"user_id\":\"user-1\",\"role\":\"user\"}' | grep -q OK"

run_test "Get session data" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT GET ocr:session:abc123 | grep -q user_id"

run_test "Check session TTL" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT TTL ocr:session:abc123 | grep -qE '^[0-9]+$'"

run_test "Delete session (logout)" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT DEL ocr:session:abc123 | grep -q 1"

# Key pattern operations
echo -e "${YELLOW}=== Key Pattern Operations ===${NC}"
echo ""

# Create test keys
redis-cli -h $REDIS_HOST -p $REDIS_PORT SET ocr:test:1 'value1' &>/dev/null
redis-cli -h $REDIS_HOST -p $REDIS_PORT SET ocr:test:2 'value2' &>/dev/null
redis-cli -h $REDIS_HOST -p $REDIS_PORT SET ocr:test:3 'value3' &>/dev/null

run_test "KEYS pattern match" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT KEYS 'ocr:test:*' | grep -q ocr:test"

run_test "SCAN cursor-based iteration" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT SCAN 0 MATCH 'ocr:test:*' | grep -q ocr:test"

# Clean up test keys
redis-cli -h $REDIS_HOST -p $REDIS_PORT DEL ocr:test:1 ocr:test:2 ocr:test:3 &>/dev/null

# Transaction operations
echo -e "${YELLOW}=== Transaction Operations (MULTI/EXEC) ===${NC}"
echo ""

run_test "MULTI/EXEC transaction" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT --raw << EOF
MULTI
SET ocr:trans:key1 value1
SET ocr:trans:key2 value2
INCR ocr:trans:counter
EXEC
EOF" | grep -q OK

run_test "Verify transaction results" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT GET ocr:trans:key1 | grep -q value1"

# Clean up transaction keys
redis-cli -h $REDIS_HOST -p $REDIS_PORT DEL ocr:trans:key1 ocr:trans:key2 ocr:trans:counter &>/dev/null

# Atomic operations
echo -e "${YELLOW}=== Atomic Operations ===${NC}"
echo ""

run_test "INCR counter" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT INCR ocr:stats:tasks:total | grep -qE '^[0-9]+$'"

run_test "INCRBY counter by N" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT INCRBY ocr:stats:tasks:total 5 | grep -qE '^[0-9]+$'"

run_test "DECR counter" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT DECR ocr:stats:tasks:pending | grep -qE '^-?[0-9]+$'"

# Clean up counters
redis-cli -h $REDIS_HOST -p $REDIS_PORT DEL ocr:stats:tasks:total ocr:stats:tasks:pending &>/dev/null

# Cleanup test data
echo -e "${YELLOW}=== Cleanup ===${NC}"
echo ""

run_test "Flush test database (DB 0)" \
    "redis-cli -h $REDIS_HOST -p $REDIS_PORT FLUSHDB | grep -q OK"

# Summary
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Test Summary${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Tests Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests Failed: ${RED}$TESTS_FAILED${NC}"
echo -e "Total Tests:  $((TESTS_PASSED + TESTS_FAILED))"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed! ✓${NC}"
    echo ""
    echo "Redis is ready for the OCR platform:"
    echo "  ✓ Basic operations (SET/GET)"
    echo "  ✓ Task queue (LPUSH/RPOP)"
    echo "  ✓ Task metadata (HASH)"
    echo "  ✓ Pub/Sub notifications"
    echo "  ✓ Priority queues (Sorted Sets)"
    echo "  ✓ Session storage"
    echo "  ✓ Transactions"
    echo "  ✓ Atomic operations"
    echo ""
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    echo ""
    echo "Check Redis status:"
    echo "  redis-cli -h $REDIS_HOST -p $REDIS_PORT INFO"
    echo ""
    exit 1
fi
