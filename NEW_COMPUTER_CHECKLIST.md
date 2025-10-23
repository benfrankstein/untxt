# New Computer Setup Checklist

Quick reference for setting up the OCR Platform on a fresh machine.

## ✅ Prerequisites Installation

### macOS
```bash
# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install all prerequisites
brew install node python postgresql@14 redis git
```

### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install -y nodejs npm python3 python3-pip python3-venv postgresql postgresql-contrib redis-server git
```

## ✅ Repository Setup

```bash
# 1. Clone the repository
git clone https://github.com/benfrankstein/untxt.git
cd untxt

# 2. Verify all files are present
ls -la
# Should see: backend/, frontend/, worker/, database/, start_services.sh, etc.
```

## ✅ Database Setup

```bash
# 1. Start PostgreSQL
# macOS:
brew services start postgresql
# Linux:
sudo systemctl start postgresql

# 2. Copy and configure database environment
cp database/.env.example .env.database
nano .env.database  # Edit with your credentials

# 3. Run automated database setup
cd database
./setup_complete.sh
# This will:
# - Create database and user
# - Apply base schema
# - Run all migrations
# - Verify installation

cd ..
```

## ✅ Redis Setup

```bash
# macOS:
brew services start redis

# Linux:
sudo systemctl start redis

# Verify Redis is running:
redis-cli ping
# Should return: PONG
```

## ✅ Backend Setup

```bash
cd backend

# 1. Copy and configure environment
cp .env.example .env
nano .env  # Edit with your credentials

# 2. Install dependencies
npm install

cd ..
```

## ✅ Worker Setup

```bash
cd worker

# 1. Copy and configure environment
cp .env.example .env
nano .env  # Edit with your credentials

# 2. Create virtual environment
python3 -m venv venv

# 3. Activate virtual environment
source venv/bin/activate  # macOS/Linux
# OR on Windows:
# venv\Scripts\activate

# 4. Install dependencies
pip install -r requirements.txt

deactivate  # Exit venv
cd ..
```

## ✅ Frontend Setup

**No setup needed!** Frontend uses only Node.js built-in modules.

## ✅ Start All Services

```bash
# Start everything with one command
./start_services.sh

# Check status
./status.sh

# Stop everything
./stop_services.sh
```

## ✅ Verify Everything Works

```bash
# 1. Check backend is running
curl http://localhost:8080/health

# 2. Check frontend is accessible
open http://localhost:3000
# Or manually visit in browser

# 3. Check Redis
redis-cli ping

# 4. Check database
psql -U ocr_platform_user -d ocr_platform_dev -c "SELECT COUNT(*) FROM users;"
```

## 🎯 Quick Start (TL;DR)

For experienced developers:

```bash
# Install prerequisites (macOS)
brew install node python postgresql@14 redis git

# Clone and setup
git clone https://github.com/benfrankstein/untxt.git
cd untxt

# Configure environment
cp database/.env.example .env.database
cp backend/.env.example backend/.env
cp worker/.env.example worker/.env
# Edit all three .env files with your credentials

# Setup database
brew services start postgresql redis
./database/setup_complete.sh

# Install dependencies
cd backend && npm install && cd ..
cd worker && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && deactivate && cd ..

# Start everything
./start_services.sh
```

## 📋 Environment Files Checklist

Make sure you've created these three files:

- [ ] `.env.database` (root directory)
- [ ] `backend/.env`
- [ ] `worker/.env`

**Never commit these files - they're in .gitignore!**

## 🔍 Troubleshooting

### PostgreSQL won't start
```bash
# Check if already running
ps aux | grep postgres

# Check logs
tail -f /usr/local/var/log/postgresql.log  # macOS
# OR
sudo tail -f /var/log/postgresql/postgresql-14-main.log  # Linux
```

### Redis won't start
```bash
# Check if already running
ps aux | grep redis

# Start manually
redis-server
```

### Port already in use
```bash
# Find what's using port 8080
lsof -i :8080

# Kill it
kill -9 <PID>
```

### Database connection fails
```bash
# Test connection manually
psql -U ocr_platform_user -d ocr_platform_dev -h localhost

# If user doesn't exist, create it:
psql -U postgres
CREATE USER ocr_platform_user WITH PASSWORD 'your_password';
CREATE DATABASE ocr_platform_dev OWNER ocr_platform_user;
\q
```

## 📚 Additional Resources

- Full setup guide: `SETUP.md`
- Architecture overview: `SYSTEM_ARCHITECTURE.md`
- Database details: `database/README.md`
- GitHub push guide: `GITHUB_PUSH_CHECKLIST.md`

## ✨ You're Done!

Visit http://localhost:3000 to use the application!

- Frontend: http://localhost:3000
- Backend API: http://localhost:8080
- Backend Health: http://localhost:8080/health
