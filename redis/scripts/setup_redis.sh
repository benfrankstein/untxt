#!/bin/bash

# OCR Platform - Redis Setup Script
# Configures and starts Redis for development

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REDIS_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$REDIS_DIR/config/redis.conf"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}OCR Platform - Redis Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Configuration:"
echo "  Host: $REDIS_HOST"
echo "  Port: $REDIS_PORT"
echo ""

# Check if Redis is installed
echo -e "${YELLOW}Step 1: Checking Redis installation...${NC}"
if ! command -v redis-server &> /dev/null; then
    echo -e "${RED}Error: Redis is not installed${NC}"
    echo ""
    echo "Install Redis:"
    echo "  macOS:  brew install redis"
    echo "  Ubuntu: sudo apt-get install redis-server"
    echo "  CentOS: sudo yum install redis"
    exit 1
fi

REDIS_VERSION=$(redis-server --version | grep -oE 'v=[0-9]+\.[0-9]+\.[0-9]+' | cut -d= -f2)
echo -e "${GREEN}✓ Redis $REDIS_VERSION installed${NC}"
echo ""

# Check if Redis is already running
echo -e "${YELLOW}Step 2: Checking if Redis is running...${NC}"
if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping &>/dev/null; then
    echo -e "${YELLOW}Redis is already running on $REDIS_HOST:$REDIS_PORT${NC}"
    read -p "Do you want to restart it? (yes/no): " RESTART
    if [ "$RESTART" != "yes" ]; then
        echo -e "${GREEN}Using existing Redis instance${NC}"
        echo ""
        echo -e "${YELLOW}Step 3: Testing connection...${NC}"
        redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping
        echo -e "${GREEN}✓ Redis is ready${NC}"
        exit 0
    fi

    echo "Stopping Redis..."
    if [ "$(uname)" == "Darwin" ]; then
        brew services stop redis &>/dev/null || true
    else
        sudo systemctl stop redis &>/dev/null || true
    fi
    sleep 2
fi
echo ""

# Start Redis
echo -e "${YELLOW}Step 3: Starting Redis...${NC}"
if [ "$(uname)" == "Darwin" ]; then
    # macOS with Homebrew
    brew services start redis
    echo -e "${GREEN}✓ Redis started via Homebrew services${NC}"
else
    # Linux with systemd
    sudo systemctl start redis
    sudo systemctl enable redis
    echo -e "${GREEN}✓ Redis started via systemd${NC}"
fi
echo ""

# Wait for Redis to be ready
echo -e "${YELLOW}Step 4: Waiting for Redis to be ready...${NC}"
for i in {1..10}; do
    if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping &>/dev/null; then
        echo -e "${GREEN}✓ Redis is ready${NC}"
        break
    fi
    if [ $i -eq 10 ]; then
        echo -e "${RED}Error: Redis did not start in time${NC}"
        exit 1
    fi
    sleep 1
done
echo ""

# Test connection
echo -e "${YELLOW}Step 5: Testing Redis connection...${NC}"
PONG=$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping)
if [ "$PONG" == "PONG" ]; then
    echo -e "${GREEN}✓ Connection successful${NC}"
else
    echo -e "${RED}Error: Failed to connect to Redis${NC}"
    exit 1
fi
echo ""

# Get Redis info
echo -e "${YELLOW}Step 6: Redis information...${NC}"
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" INFO SERVER | grep -E "redis_version|redis_mode|os|tcp_port"
echo ""

# Configure Redis for OCR Platform
echo -e "${YELLOW}Step 7: Configuring Redis for OCR Platform...${NC}"

# Set maxmemory policy
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" CONFIG SET maxmemory-policy allkeys-lru &>/dev/null
echo "  ✓ Memory policy: allkeys-lru"

# Enable keyspace notifications for session expiry
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" CONFIG SET notify-keyspace-events Ex &>/dev/null
echo "  ✓ Keyspace notifications: enabled"

# Set save policy
redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" CONFIG SET save "900 1 300 10 60 10000" &>/dev/null
echo "  ✓ Save policy: configured"

echo -e "${GREEN}✓ Configuration complete${NC}"
echo ""

# Create .env file
echo -e "${YELLOW}Step 8: Creating .env file...${NC}"
ENV_FILE="$REDIS_DIR/../.env.redis"
cat > "$ENV_FILE" << EOF
# Redis Configuration for OCR Platform
# Generated: $(date)

REDIS_HOST=$REDIS_HOST
REDIS_PORT=$REDIS_PORT

# Connection URL
REDIS_URL=redis://$REDIS_HOST:$REDIS_PORT

# Optional: Password (uncomment for production)
# REDIS_PASSWORD=your_secure_password

# Connection Pool
REDIS_MAX_CONNECTIONS=50
REDIS_MIN_CONNECTIONS=5

# Timeouts (milliseconds)
REDIS_CONNECT_TIMEOUT=5000
REDIS_COMMAND_TIMEOUT=3000

# Key Prefixes
REDIS_TASK_QUEUE_PREFIX=ocr:task:queue
REDIS_TASK_DATA_PREFIX=ocr:task:data
REDIS_SESSION_PREFIX=ocr:session
REDIS_PUBSUB_CHANNEL=ocr:notifications
EOF
echo -e "${GREEN}✓ Environment file created: $ENV_FILE${NC}"
echo ""

# Summary
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Redis Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Connection Details:"
echo "  Host: $REDIS_HOST"
echo "  Port: $REDIS_PORT"
echo "  URL: redis://$REDIS_HOST:$REDIS_PORT"
echo ""
echo "Test Redis:"
echo "  redis-cli -h $REDIS_HOST -p $REDIS_PORT"
echo "  redis-cli ping"
echo ""
echo "Stop Redis:"
if [ "$(uname)" == "Darwin" ]; then
    echo "  brew services stop redis"
else
    echo "  sudo systemctl stop redis"
fi
echo ""
echo "View logs:"
if [ "$(uname)" == "Darwin" ]; then
    echo "  tail -f /opt/homebrew/var/log/redis.log"
else
    echo "  sudo journalctl -u redis -f"
fi
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "  1. Run tests: ./redis/scripts/test_redis.sh"
echo "  2. Review data structures: ./redis/docs/data_structures.md"
echo "  3. Start developing with Redis!"
echo ""
