# Database Quick Start Guide

Get your OCR Platform database up and running in under 5 minutes.

## Step 1: Start PostgreSQL

```bash
# Check if PostgreSQL is running
brew services list | grep postgresql

# If not running, start it
brew services start postgresql@16
```

## Step 2: Run Setup Script

```bash
cd database/scripts
./setup_database.sh
```

**What it does:**
- Creates database: `ocr_platform_dev`
- Creates user: `ocr_platform_user`
- Applies full schema (tables, indexes, triggers, views)
- Offers to load seed data (7 users, 8 files, 9 tasks)
- Generates `.env.database` config file

**When prompted:**
- "Load seed data?" → Type `yes` (recommended for development)

## Step 3: Verify Installation

```bash
./test_crud.sh
```

This runs comprehensive tests on all database operations.

**Expected output:**
```
✓ CREATE tests completed
✓ READ tests completed
✓ UPDATE tests completed
✓ Complex query tests completed
✓ Constraint tests completed
✓ Cascade delete tests completed
✓ DELETE tests completed

All tests passed!
```

## Step 4: Connect and Explore

```bash
psql -U ocr_platform_user -d ocr_platform_dev
```

**Try these queries:**

```sql
-- View all users
SELECT username, email, role FROM users;

-- View active tasks
SELECT * FROM active_tasks_view;

-- View completed tasks with results
SELECT * FROM completed_tasks_view;

-- Get user statistics
SELECT * FROM user_stats_view;

-- List all tables
\dt

-- Exit
\q
```

## Default Credentials

**Seed Data Login Credentials:**
- Username: `admin`, `johndoe`, `janesmith`, etc.
- Password (all users): `Password123!`
- Password hash is already in database

**Database Connection:**
- Host: `localhost`
- Port: `5432`
- Database: `ocr_platform_dev`
- User: `ocr_platform_user`
- Password: `ocr_platform_pass_dev`

## What's Included

### Database Schema
- **Users**: 7 sample users (admin, regular, guest)
- **Files**: 8 uploaded files (PDFs, images)
- **Tasks**: 9 OCR jobs (completed, processing, pending, failed)
- **Results**: 5 OCR results with realistic extracted text
- **History**: Audit trail of all task changes
- **Stats**: System metrics

### Features
- UUID primary keys
- Automatic timestamps
- Status change logging (via triggers)
- Cascade deletes
- JSON support for flexible data
- Pre-built views for common queries
- Comprehensive constraints and validations

## Next Steps

1. **For Backend Development:**
   ```bash
   source ../.env.database
   echo $DATABASE_URL
   # Use this URL in your Node.js app
   ```

2. **Review Schema:**
   ```bash
   less ../schema.sql
   # or
   less ../README.md
   ```

3. **Connect Your App:**
   - Node.js: Use `pg` or `sequelize`
   - Python: Use `psycopg2` or `SQLAlchemy`
   - Any language: Use the `DATABASE_URL` from `.env.database`

## Common Commands

```bash
# Connect to database
psql -U ocr_platform_user -d ocr_platform_dev

# Run migration
psql -U ocr_platform_user -d ocr_platform_dev -f migrations/001_initial_schema.sql

# Load seed data
psql -U ocr_platform_user -d ocr_platform_dev -f seeds/seed_data.sql

# Run tests
./test_crud.sh

# Backup database
pg_dump -U ocr_platform_user -d ocr_platform_dev -F c -f backup.dump

# Drop database (WARNING: deletes everything)
psql -U postgres -d postgres -c "DROP DATABASE ocr_platform_dev;"
```

## Troubleshooting

**PostgreSQL not running?**
```bash
brew services start postgresql@16
```

**Permission denied?**
```bash
# Make scripts executable
chmod +x scripts/*.sh
```

**Database already exists?**
```bash
# The setup script will prompt you to drop it
./setup_database.sh
# Answer "yes" when asked
```

**Need to reset?**
```bash
psql -U postgres -d postgres
DROP DATABASE IF EXISTS ocr_platform_dev;
DROP USER IF EXISTS ocr_platform_user;
\q

# Then run setup again
./setup_database.sh
```

## Support

- Full documentation: `database/README.md`
- Schema details: `database/schema.sql`
- Test suite: `database/tests/test_crud.sql`

---

**Ready to build!** Your database is now set up and ready for application development.
