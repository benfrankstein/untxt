# Setup Guide

Complete setup instructions for deploying the OCR Platform on a new machine.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Detailed Setup](#detailed-setup)
- [Database Setup](#database-setup)
- [Environment Configuration](#environment-configuration)
- [Running the Application](#running-the-application)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Ensure you have the following installed:

- **Node.js** 18+ and npm
- **Python** 3.9+
- **PostgreSQL** 14+
- **Redis** 6+
- **Git**

### macOS Installation
```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install prerequisites
brew install node python postgresql@14 redis git
```

### Linux (Ubuntu/Debian) Installation
```bash
sudo apt update
sudo apt install -y nodejs npm python3 python3-pip python3-venv postgresql postgresql-contrib redis-server git
```

---

## Quick Start

For experienced developers who want to get up and running quickly:

```bash
# 1. Clone the repository
git clone <repository-url>
cd untxt

# 2. Set up database
cd database
cp .env.example ../.env.database
# Edit .env.database with your credentials
./setup_complete.sh

# 3. Install dependencies
cd ../backend
npm install

cd ../frontend
npm install

cd ../worker
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# 4. Start services
./start_services.sh
```

---

## Detailed Setup

### 1. Clone the Repository

```bash
git clone <repository-url>
cd untxt
```

### 2. Database Setup

#### Create Database Configuration

1. Copy the example environment file:
   ```bash
   cd database
   cp .env.example ../.env.database
   ```

2. Edit `.env.database` with your credentials:
   ```bash
   nano ../.env.database  # or use your preferred editor
   ```

   Example configuration:
   ```env
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=ocr_platform_dev
   DB_USER=ocr_platform_user
   DB_PASSWORD=your_secure_password_here

   DATABASE_URL=postgresql://ocr_platform_user:your_secure_password_here@localhost:5432/ocr_platform_dev

   DB_POOL_MIN=2
   DB_POOL_MAX=10
   ```

#### Run Database Setup Script

This script will:
- Create the database and user
- Apply the base schema
- Run all migrations in order
- Verify the installation

```bash
cd database
./setup_complete.sh
```

**Note**: You'll be prompted for the PostgreSQL superuser (postgres) password to create the database and user.

#### Manual Database Setup (if automatic setup fails)

If the automatic setup script fails, you can set up the database manually:

```bash
# 1. Connect to PostgreSQL as superuser
psql -U postgres

# 2. Create user and database
CREATE USER ocr_platform_user WITH PASSWORD 'your_password_here';
CREATE DATABASE ocr_platform_dev OWNER ocr_platform_user;
GRANT ALL PRIVILEGES ON DATABASE ocr_platform_dev TO ocr_platform_user;
\q

# 3. Apply schema
psql -U ocr_platform_user -d ocr_platform_dev -f database/schema.sql

# 4. Apply migrations in order
psql -U ocr_platform_user -d ocr_platform_dev -f database/migrations/001_add_s3_fields.sql
psql -U ocr_platform_user -d ocr_platform_dev -f database/migrations/002_make_local_paths_optional.sql
# ... continue with other migrations in order
```

### 3. Redis Setup

#### Start Redis

```bash
# macOS
brew services start redis

# Linux
sudo systemctl start redis
sudo systemctl enable redis  # Start on boot
```

#### Verify Redis is Running

```bash
redis-cli ping
# Should return: PONG
```

### 4. Install Application Dependencies

#### Backend (Node.js)

```bash
cd backend
npm install
```

#### Frontend (Next.js)

```bash
cd frontend
npm install
```

#### Worker (Python)

```bash
cd worker
python -m venv venv

# Activate virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
# venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

---

## Environment Configuration

### Backend Configuration

Create `.env` file in the `backend` directory:

```bash
cd backend
cp .env.example .env
```

Edit with your configuration:
```env
# Server
PORT=8080
NODE_ENV=development

# Database
DATABASE_URL=postgresql://ocr_platform_user:your_password@localhost:5432/ocr_platform_dev

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# AWS S3 (if using cloud storage)
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-bucket-name
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# JWT Secret
JWT_SECRET=your-jwt-secret-here
SESSION_SECRET=your-session-secret-here
```

### Frontend Configuration

Create `.env.local` file in the `frontend` directory:

```bash
cd frontend
cp .env.example .env.local
```

Edit with your configuration:
```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

### Worker Configuration

Create `.env` file in the `worker` directory:

```bash
cd worker
cp .env.example .env
```

Edit with your configuration:
```env
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Database
DATABASE_URL=postgresql://ocr_platform_user:your_password@localhost:5432/ocr_platform_dev

# Model path
MODEL_PATH=/path/to/qwen/model
```

---

## Running the Application

### Using Service Scripts

The repository includes convenient scripts to manage all services:

```bash
# Start all services (backend, frontend, worker)
./start_services.sh

# Check status of all services
./status.sh

# Stop all services
./stop_services.sh
```

### Running Services Individually

#### Backend
```bash
cd backend
npm run dev  # Development mode
# or
npm start    # Production mode
```

#### Frontend
```bash
cd frontend
npm run dev  # Development mode with hot reload
# or
npm run build && npm start  # Production mode
```

#### Worker
```bash
cd worker
source venv/bin/activate  # Activate virtual environment
python app.py
```

### Verify Services Are Running

```bash
# Check all services
./status.sh

# Or check individually:

# Backend
curl http://localhost:8080/health

# Frontend
curl http://localhost:3000

# Redis
redis-cli ping
```

---

## Troubleshooting

### Database Connection Issues

**Problem**: Cannot connect to PostgreSQL

**Solutions**:
1. Verify PostgreSQL is running:
   ```bash
   # macOS
   brew services list | grep postgresql

   # Linux
   sudo systemctl status postgresql
   ```

2. Check PostgreSQL is listening on the correct port:
   ```bash
   psql -U postgres -c "SHOW port;"
   ```

3. Verify your credentials in `.env.database`

4. Test connection manually:
   ```bash
   psql -U ocr_platform_user -d ocr_platform_dev -h localhost
   ```

### Redis Connection Issues

**Problem**: Cannot connect to Redis

**Solutions**:
1. Verify Redis is running:
   ```bash
   redis-cli ping
   ```

2. Start Redis if not running:
   ```bash
   # macOS
   brew services start redis

   # Linux
   sudo systemctl start redis
   ```

### Port Already in Use

**Problem**: Port 8080 (or other port) is already in use

**Solutions**:
1. Find process using the port:
   ```bash
   # macOS/Linux
   lsof -i :8080

   # Kill the process
   kill -9 <PID>
   ```

2. Or change the port in your `.env` file

### Migration Errors

**Problem**: Database migrations fail

**Solutions**:
1. Check if migrations were already applied:
   ```bash
   psql -U ocr_platform_user -d ocr_platform_dev -c "\dt"
   ```

2. Manually apply specific migration:
   ```bash
   psql -U ocr_platform_user -d ocr_platform_dev -f database/migrations/<migration-file>.sql
   ```

3. Reset database completely (WARNING: destroys all data):
   ```bash
   dropdb -U postgres ocr_platform_dev
   ./database/setup_complete.sh
   ```

### Node Modules Issues

**Problem**: Node.js dependencies not installing or running

**Solutions**:
1. Clear npm cache and reinstall:
   ```bash
   rm -rf node_modules package-lock.json
   npm cache clean --force
   npm install
   ```

2. Ensure Node.js version is 18+:
   ```bash
   node --version
   ```

### Python Virtual Environment Issues

**Problem**: Cannot activate virtual environment or install packages

**Solutions**:
1. Recreate virtual environment:
   ```bash
   cd worker
   rm -rf venv
   python3 -m venv venv
   source venv/bin/activate
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

2. Check Python version:
   ```bash
   python3 --version  # Should be 3.9+
   ```

---

## Additional Resources

- [Database Schema Documentation](database/README.md)
- [API Documentation](docs/API.md)
- [Architecture Overview](SYSTEM_ARCHITECTURE.md)
- [Development Guide](development_order.md)

---

## Getting Help

If you encounter issues not covered in this guide:

1. Check the [Issues](../../issues) page for similar problems
2. Review the logs:
   ```bash
   # Backend logs
   tail -f backend/logs/app.log

   # Worker logs
   tail -f worker/logs/worker.log
   ```

3. Enable debug mode for more verbose logging:
   ```bash
   # In .env files
   LOG_LEVEL=debug
   ```
