# UNTXT Platform - Complete Setup Guide

**⚠️ SECURITY WARNING: This document contains sensitive credentials. Do not commit to GitHub or share publicly.**

This guide contains all necessary information to set up and run the UNTXT OCR platform locally.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Clone Repository](#clone-repository)
4. [Database Setup](#database-setup)
5. [Backend Setup](#backend-setup)
6. [Worker Setup](#worker-setup)
7. [Frontend Setup](#frontend-setup)
8. [Running the Application](#running-the-application)
9. [Testing](#testing)
10. [Troubleshooting](#troubleshooting)
11. [Configuration Reference](#configuration-reference)

---

## Overview

UNTXT is a secure OCR platform with:
- **Frontend**: Simple HTTP server (port 3000)
- **Backend**: Node.js/Express API (port 8080)
- **Worker**: Python Flask OCR processor
- **Database**: PostgreSQL + Redis
- **Storage**: AWS S3 with KMS encryption
- **Payments**: Stripe (test mode)

---

## Prerequisites

### Required Software

Install these before proceeding:

```bash
# Node.js 18+
node --version  # Should be 18.x or higher

# Python 3.9+
python3 --version  # Should be 3.9 or higher

# PostgreSQL 14+
psql --version  # Should be 14.x or higher

# Redis 6+
redis-cli --version  # Should be 6.x or higher

# Git
git --version
```

### macOS Installation

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies
brew install node
brew install python@3.11
brew install postgresql@16
brew install redis

# Start services
brew services start postgresql@16
brew services start redis
```

### Linux/Ubuntu Installation

```bash
sudo apt update
sudo apt install -y nodejs npm python3 python3-pip python3-venv postgresql postgresql-contrib redis-server
sudo systemctl start postgresql
sudo systemctl start redis
```

---

## Clone Repository

```bash
# Clone the repository
git clone https://github.com/benfrankstein/untxt.git
cd untxt
```

---

## Database Setup

### 1. Start PostgreSQL

```bash
# macOS
brew services start postgresql@16

# Linux
sudo systemctl start postgresql
```

### 2. Create Database and User

```bash
# Connect as postgres superuser
psql postgres

# Run these commands in psql:
CREATE DATABASE ocr_platform_dev;
CREATE USER ocr_platform_user WITH PASSWORD 'ocr_secure_dev_password_2024';
GRANT ALL PRIVILEGES ON DATABASE ocr_platform_dev TO ocr_platform_user;
\q
```

### 3. Apply Database Schema

```bash
# Navigate to database directory
cd database

# Apply initial schema
psql -U ocr_platform_user -d ocr_platform_dev -f schema.sql

# Apply all migrations in order
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/001_add_s3_fields.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/002_make_local_paths_optional.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/003_add_access_control_and_audit.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/003_add_document_versions.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/004_add_draft_versions.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/005_fix_draft_trigger.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/006_allow_draft_version_number.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/007_fix_create_original_version_trigger.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/008_fix_create_original_version_character_count.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/009_create_document_edit_sessions.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/010_fix_create_original_version_deferrable.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/011_simplify_to_google_docs_flow.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/012_add_html_content_column.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/013_fix_trigger_for_google_docs_flow.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/014_make_s3_key_nullable.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/04_add_change_notifications.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/05_add_s3_cleanup_on_delete.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/06_preserve_task_history.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/07_add_user_id_to_results_and_history.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/015_add_project_folders.sql
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/016_add_credits_system.sql

# Verify tables were created
psql -U ocr_platform_user -d ocr_platform_dev -c "\dt"
```

### 4. Create Database Environment File

```bash
# Navigate back to project root
cd ..

# Create .env.database file
cat > .env.database << 'EOF'
# OCR Platform Database Configuration

# Database Connection
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ocr_platform_dev
DB_USER=ocr_platform_user
DB_PASSWORD=ocr_secure_dev_password_2024

# Full Connection String
DATABASE_URL=postgresql://ocr_platform_user:ocr_secure_dev_password_2024@localhost:5432/ocr_platform_dev

# Connection Pool Settings
DB_POOL_MIN=2
DB_POOL_MAX=10
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=2000
EOF
```

---

## Backend Setup

### 1. Navigate to Backend Directory

```bash
cd backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create Environment File

```bash
cat > .env << 'EOF'
# Server Configuration
PORT=8080
NODE_ENV=development

# AWS S3 Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAX45MOZ3HGNYUTJUS
AWS_SECRET_ACCESS_KEY=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
S3_BUCKET_NAME=untxt
KMS_KEY_ID=arn:aws:kms:us-east-1:543138172622:key/e608ce2c-663a-434a-8e53-7b64de041015

# PostgreSQL Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ocr_platform_dev
DB_USER=ocr_platform_user
DB_PASSWORD=ocr_secure_dev_password_2024

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# File Upload Configuration
MAX_FILE_SIZE=10485760
ALLOWED_FILE_TYPES=application/pdf,image/jpeg,image/png,image/jpg

# Stripe Payment Configuration (TEST MODE)
STRIPE_SECRET_KEY=sk_test_51STc7YHJfMf64wFeS8Q2sEoeFjA38ttmksuif57oABFdBsKvzeFc9EPxu2l1Dk9XpO1wrVdGGgqcVyo4ysFAZWWU00kKMft21i
STRIPE_PUBLISHABLE_KEY=pk_test_51STc7YHJfMf64wFePmCDH0C33nLyQOIlswyyWEdwRPyiNdcnFLlOBJ6rBVd7BIMxuJ9J5rGr4i1tMwYKrL8MyFh500fovMrWLA
STRIPE_WEBHOOK_SECRET=
STRIPE_TEST_MODE=true

# Credits Configuration
INITIAL_USER_CREDITS=10
MIN_CREDIT_PURCHASE=10
CREDITS_PER_PAGE=1

# Frontend URL (for Stripe redirects)
FRONTEND_URL=http://localhost:3000
EOF
```

### 4. Test Backend Connection (Optional)

```bash
# Quick test to verify dependencies are installed
node -e "console.log('Backend setup complete!')"
```

---

## Worker Setup

### 1. Navigate to Worker Directory

```bash
cd ../worker
```

### 2. Create Python Virtual Environment

```bash
# Create virtual environment
python3 -m venv venv

# Activate virtual environment
# macOS/Linux:
source venv/bin/activate

# Windows:
# venv\Scripts\activate
```

### 3. Install Python Dependencies

```bash
pip install -r requirements.txt
```

### 4. Create Environment File

```bash
cat > .env << 'EOF'
# OCR Worker Environment Configuration

# Worker Configuration
WORKER_ID=worker-001
MAX_ATTEMPTS=3
PROCESSING_TIMEOUT=300
POLL_INTERVAL=5

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ocr_platform_dev
DB_USER=ocr_platform_user
DB_PASSWORD=ocr_secure_dev_password_2024

# File Storage (UPDATE THIS PATH TO YOUR LOCAL PATH)
OUTPUT_DIR=/Users/YOUR_USERNAME/Projects/untxt/output

# AWS S3 Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAX45MOZ3HGNYUTJUS
AWS_SECRET_ACCESS_KEY=stusVT4eFaYAyTq8n7SHHJDXwjvuxx4+x/zxs3+7
S3_BUCKET_NAME=untxt
KMS_KEY_ID=arn:aws:kms:us-east-1:543138172622:key/e608ce2c-663a-434a-8e53-7b64de041015
EOF
```

**⚠️ IMPORTANT:** Update the `OUTPUT_DIR` path to match your local system:

```bash
# Create output directory
mkdir -p ../output

# Update the OUTPUT_DIR in .env to the full path
# For example: /Users/yourname/Projects/untxt/output
```

### 5. Test Worker Connection

```bash
python test_connection.py
```

---

## Frontend Setup

### 1. Navigate to Frontend Directory

```bash
cd ../frontend
```

### 2. No Dependencies Required

The frontend uses vanilla JavaScript and a simple Node.js HTTP server with no dependencies beyond Node.js itself.

---

## Running the Application

You'll need **4 terminal windows/tabs** to run all services:

### Terminal 1: Backend

```bash
cd backend
npm run dev
# Should see: Server running on port 8080
```

### Terminal 2: Worker

```bash
cd worker
source venv/bin/activate  # Activate virtual environment
python run_worker.py
# Should see: OCR Worker started
```

### Terminal 3: Frontend

```bash
cd frontend
node server.js
# Should see: UNTXT Frontend Server at http://localhost:3000
```

### Terminal 4: Redis (if not running as service)

```bash
redis-server
# Or if installed via Homebrew:
brew services start redis
```

### Verify Services

Open your browser and navigate to:
- **Frontend**: http://localhost:3000
- **Backend Health**: http://localhost:8080/api/health (if available)

---

## Testing

### Test User Registration

1. Open http://localhost:3000
2. Click "Sign Up"
3. Create a new account
4. Should receive 10 free credits

### Test File Upload

1. Log in with your account
2. Upload a PDF or image file
3. Should see OCR processing begin
4. Check terminal logs for worker processing

### Test Database

```bash
# Connect to database
psql -U ocr_platform_user -d ocr_platform_dev

# Check users
SELECT username, email, credits FROM users;

# Check tasks
SELECT id, status, created_at FROM tasks;

# Exit
\q
```

### Test Redis

```bash
redis-cli
PING  # Should return PONG
KEYS *  # Show all keys
EXIT
```

---

## Troubleshooting

### PostgreSQL Connection Issues

```bash
# Check if PostgreSQL is running
brew services list | grep postgresql
# or
sudo systemctl status postgresql

# Start if not running
brew services start postgresql@16
# or
sudo systemctl start postgresql

# Reset password if needed
psql postgres
ALTER USER ocr_platform_user WITH PASSWORD 'ocr_secure_dev_password_2024';
\q
```

### Redis Connection Issues

```bash
# Check if Redis is running
brew services list | grep redis
# or
sudo systemctl status redis

# Start if not running
brew services start redis
# or
sudo systemctl start redis

# Test connection
redis-cli PING
```

### Port Already in Use

```bash
# Find process using port 8080
lsof -i :8080

# Kill the process
kill -9 <PID>

# Or use different port in backend/.env
PORT=8081
```

### AWS S3 Connection Issues

The AWS credentials provided are for the `untxt` S3 bucket. If you encounter permission issues:

1. Verify the credentials in `.env` files
2. Check AWS console for bucket permissions
3. Test AWS connection:

```bash
# Install AWS CLI (optional)
brew install awscli

# Configure
aws configure
# Use the credentials from the .env file

# Test S3 access
aws s3 ls s3://untxt
```

### Python Virtual Environment Issues

```bash
# If venv activation fails, recreate it
cd worker
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Database Migration Issues

If migrations fail, you can reset the database:

```bash
# ⚠️ WARNING: This deletes all data
psql postgres
DROP DATABASE ocr_platform_dev;
CREATE DATABASE ocr_platform_dev;
GRANT ALL PRIVILEGES ON DATABASE ocr_platform_dev TO ocr_platform_user;
\q

# Then rerun migrations
cd database
psql -U ocr_platform_user -d ocr_platform_dev -f schema.sql
# Apply migrations one by one...
```

### Node.js Version Issues

```bash
# Check Node version
node --version

# If using nvm, install correct version
nvm install 18
nvm use 18
```

---

## Configuration Reference

### Backend Environment Variables

| Variable | Value | Description |
|----------|-------|-------------|
| `PORT` | `8080` | Backend API port |
| `NODE_ENV` | `development` | Environment mode |
| `AWS_ACCESS_KEY_ID` | `AKIAX45MOZ3HGNYUTJUS` | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | `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` | AWS secret key |
| `S3_BUCKET_NAME` | `untxt` | S3 bucket name |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `ocr_platform_dev` | Database name |
| `DB_USER` | `ocr_platform_user` | Database user |
| `DB_PASSWORD` | `ocr_secure_dev_password_2024` | Database password |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `STRIPE_SECRET_KEY` | `sk_test_51STc7YHJfMf64wFeS8Q2sEoeFjA38ttmksuif57oABFdBsKvzeFc9EPxu2l1Dk9XpO1wrVdGGgqcVyo4ysFAZWWU00kKMft21i` | Stripe test secret key |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_51STc7YHJfMf64wFePmCDH0C33nLyQOIlswyyWEdwRPyiNdcnFLlOBJ6rBVd7BIMxuJ9J5rGr4i1tMwYKrL8MyFh500fovMrWLA` | Stripe test publishable key |
| `INITIAL_USER_CREDITS` | `10` | Free credits for new users |
| `FRONTEND_URL` | `http://localhost:3000` | Frontend URL for redirects |

### Service Ports

| Service | Port | URL |
|---------|------|-----|
| Frontend | 3000 | http://localhost:3000 |
| Backend | 8080 | http://localhost:8080 |
| PostgreSQL | 5432 | localhost:5432 |
| Redis | 6379 | localhost:6379 |

---

## Quick Start Commands

Once everything is set up, use these commands to start the application:

```bash
# Terminal 1 - Backend
cd backend && npm run dev

# Terminal 2 - Worker
cd worker && source venv/bin/activate && python run_worker.py

# Terminal 3 - Frontend
cd frontend && node server.js
```

Then open http://localhost:3000 in your browser.

---

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review terminal logs for error messages
3. Verify all services are running
4. Ensure environment files are created correctly
5. Check database connections with test commands

---

## Security Notes

- **AWS Credentials**: These are real credentials with limited permissions to the `untxt` S3 bucket
- **Stripe Keys**: These are test mode keys - safe for development, no real charges
- **Database Password**: Change this for production deployment
- **Never commit this file to GitHub** - it's listed in `.gitignore` already

---

**Last Updated**: November 2024
**Platform Version**: 1.0.0
