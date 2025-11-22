# OCR Platform - Quick Reference Guide

## Project Overview
- **Name**: untxt - OCR Platform
- **Type**: Web-based OCR service with document editing capabilities
- **Status**: Active development
- **Current State**: No payment system (ready for implementation)

## Key Technology Stack

### Backend
- **Language**: Node.js (JavaScript)
- **Framework**: Express.js 4.19
- **Server**: HTTP/HTTPS with WebSocket support
- **Port**: 8080
- **Database**: PostgreSQL 14+
- **Cache**: Redis 4.7+
- **File Storage**: AWS S3
- **Authentication**: bcrypt + express-session

### Frontend
- **Language**: Vanilla JavaScript (NO framework)
- **Architecture**: Single-page application (SPA)
- **Communication**: Fetch API + Native WebSocket
- **Styling**: CSS3 (no preprocessor)
- **Pages**: 3 HTML pages (auth, main dashboard, account)

### Processing
- **Workers**: Python Flask (separate from API)
- **OCR Engine**: Qwen3 model
- **Queue**: Redis-based task queue

## Directory Structure

```
/Users/benfrankstein/Projects/untxt/
├── backend/                       # Node.js API server
│   ├── src/
│   │   ├── app.js                # Express setup
│   │   ├── index.js              # Server startup
│   │   ├── config/               # Configuration
│   │   ├── middleware/           # Auth & validation
│   │   ├── routes/               # API endpoints
│   │   ├── services/             # Business logic
│   │   └── jobs/                 # Scheduled tasks
│   └── package.json
│
├── frontend/                      # Vanilla JS SPA
│   ├── index.html                # Main dashboard
│   ├── app.js                    # Dashboard logic
│   ├── auth.html                 # Login/signup
│   ├── auth.js                   # Auth logic
│   ├── account.html              # User profile
│   ├── account.js                # Profile logic
│   └── style.css                 # Main styles
│
├── database/                      # Database schemas
│   ├── schema.sql                # Full schema
│   └── migrations/               # Schema versions
│
├── worker/                        # OCR processing
│
└── docs_md/                       # Documentation
```

## Core API Endpoints

### Authentication (`/api/auth/`)
```
POST   /signup                - Register user
POST   /login                 - User login
POST   /logout                - Session end
GET    /profile               - User info (includes balance when added)
GET    /session               - Check auth status
```

### Tasks (`/api/tasks/`)
```
POST   /                      - Upload file & create task
GET    /                      - List user's tasks
GET    /:taskId               - Get task details
GET    /:taskId/preview       - View extracted text
GET    /:taskId/download      - Download original
GET    /:taskId/result        - Download OCR result
DELETE /:taskId               - Delete task
POST   /:taskId/retry         - Retry failed task
```

### Folders (`/api/folders/`)
```
GET    /                      - List user's folders
POST   /                      - Create folder
PUT    /:folderId             - Update folder
DELETE /:folderId             - Delete folder
```

### Payments (TO BE ADDED)
```
GET    /api/payments/plans             - Pricing plans
POST   /api/payments/checkout          - Buy credits
GET    /api/credits/balance            - User balance
GET    /api/credits/transactions       - Transaction history
```

## Database Schema - Key Tables

### Current Tables (Core)
- `users` - User accounts (UUID primary key)
- `user_sessions` - Session tracking (HIPAA compliant)
- `files` - Uploaded documents metadata
- `tasks` - OCR job tracking
- `results` - OCR output/results
- `folders` - Project organization
- `task_history` - Audit trail
- `file_access_log` - Access audit
- `admin_action_log` - Admin activities
- `folder_audit_log` - Folder operations

### Tables to Add (Credits System)
- `credit_transactions` - Ledger of all credit changes
- `pricing_plans` - Available payment plans
- `payments` - Payment records (Stripe simulation)
- `credit_usage` - Per-task cost tracking
- `download_usage` - Download tracking

## Authentication Flow

1. User fills signup/login form
2. Frontend sends to `/api/auth/signup` or `/api/auth/login`
3. Backend validates credentials
4. bcrypt hashes password (12 salt rounds)
5. Session created in `express-session`
6. Session token stored in database
7. Cookie sent to client (httpOnly, secure, sameSite)
8. Subsequent requests include session cookie
9. `requireAuth` middleware validates session

**Session Timeout**: 15 minutes of inactivity (rolling)

## File Upload Flow

1. User selects file in frontend
2. Frontend sends multipart/form-data to `POST /api/tasks`
3. Multer validates file (type, 10MB max)
4. File uploaded to AWS S3 with KMS encryption
5. File metadata stored in PostgreSQL
6. Task record created (status: pending)
7. Task enqueued to Redis
8. WebSocket notification sent
9. Worker receives task from Redis queue
10. Worker processes with Qwen3
11. Result stored in S3
12. Task status updated to completed
13. WebSocket notifies user

**S3 Path Format**: 
- Uploads: `uploads/{user_id}/{YYYY-MM}/{file_id}/{filename}`
- Results: `results/{user_id}/{YYYY-MM}/{task_id}/{filename}`

## WebSocket Communication

**Endpoint**: `ws://localhost:8080?userId={USER_ID}`

**Messages Sent by Server**:
- Task updates (status, progress, error)
- Database changes (real-time sync)
- Notifications

**State**: Persistent for user session

## Current Security Measures

✓ HTTPS/TLS enforced in production
✓ Password hashing with bcrypt (12 rounds)
✓ Session-based authentication
✓ Cookie: httpOnly, secure, sameSite flags
✓ CSRF protection via sameSite
✓ XSS prevention via httpOnly
✓ Comprehensive audit logging
✓ User ownership verification
✓ Role-based access control (admin/user/guest)

## Frontend State Management

**Global Variables** (in app.js):
```javascript
USER_ID              // Current user ID
tasks                // Cache of user's tasks
currentTask          // Currently viewing task
folders              // User's project folders
currentFolderId      // Active folder filter
ws                   // WebSocket connection
pdfCache             // In-memory PDF cache (HIPAA compliant)
```

**No Framework Used**: Pure vanilla JavaScript
**State Updates**: Direct DOM manipulation + fetch API

## Missing Payment System

### Current Status: NONE EXISTS
- No Stripe integration
- No pricing model
- No credit system
- No transaction tracking
- No balance management

### What to Build
1. Credit tables in database
2. CreditsService (balance, transactions)
3. PaymentService (Stripe simulation)
4. Pricing configuration
5. API endpoints for payments
6. Pricing page UI
7. Checkout form
8. Account page updates

## File Size & Performance

- Single file upload limit: 10MB
- Max file types: PDF, JPEG, PNG, JPG
- Task priority: 0-10 (higher = processed first)
- Queue: Redis-based FIFO

## Environment Variables

### Backend (.env)
```
PORT=8080
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ocr_platform_dev
DB_USER=ocr_platform_user
DB_PASSWORD=ocr_platform_pass_dev
REDIS_HOST=localhost
REDIS_PORT=6379
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=...
SESSION_SECRET=your-secret-key
FRONTEND_URL=http://localhost:3000
```

## Important Code Locations

### Authentication
- Service: `/backend/src/services/auth.service.js`
- Routes: `/backend/src/routes/auth.routes.js`
- Password validation: Lines 15-78 in auth.service.js

### File Upload
- Routes: `/backend/src/routes/tasks.routes.js` (Line 32-148)
- S3 Service: `/backend/src/services/s3.service.js`
- Multer config: `/backend/src/routes/tasks.routes.js` (Line 14-26)

### Database
- Schema: `/database/schema.sql`
- Migrations: `/database/migrations/`
- Service: `/backend/src/services/db.service.js`

### WebSocket
- Service: `/backend/src/services/websocket.service.js`
- Frontend handler: `/frontend/app.js` (initWebSocket function)

### Frontend
- Main app: `/frontend/app.js` (1200+ lines, handles everything)
- Auth UI: `/frontend/auth.js`
- Account: `/frontend/account.js`

## Common Patterns

### Making API Calls
```javascript
// Frontend fetch pattern
fetch('/api/endpoint', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',  // Include session cookie
  body: JSON.stringify(data)
}).then(r => r.json())
```

### Backend route pattern
```javascript
router.post('/endpoint', async (req, res) => {
  try {
    const userId = req.session.userId;
    // Validate user exists
    // Perform operation
    res.status(201).json({ success: true, data: {...} });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

### Database query pattern
```javascript
const query = `SELECT * FROM table WHERE id = $1;`;
const result = await this.pool.query(query, [id]);
return result.rows[0] || null;
```

## Testing the System

### Quick Start
```bash
# Terminal 1: Backend
cd /Users/benfrankstein/Projects/untxt/backend
npm install
npm run dev

# Terminal 2: Frontend (static files)
cd /Users/benfrankstein/Projects/untxt/frontend
# Serve files (any HTTP server)
python -m http.server 3000
# or: npx http-server -p 3000

# Browser
# Navigate to http://localhost:3000
```

### Database
```sql
-- Connect to PostgreSQL
psql -h localhost -U ocr_platform_user -d ocr_platform_dev

-- View users
SELECT id, email, username, role FROM users;

-- View tasks
SELECT id, user_id, status, created_at FROM tasks;

-- View audit log
SELECT * FROM task_history ORDER BY created_at DESC LIMIT 10;
```

## Next Steps for Credits System

1. Review the full construction plan: `CREDITS_SYSTEM_CONSTRUCTION_PLAN.md`
2. Create database migrations for credit tables
3. Implement CreditsService in backend
4. Add payment routes
5. Create pricing page
6. Update account page
7. Add credit checks to upload flow
8. Test end-to-end
9. Deploy

**Estimated Timeline**: 3-4 weeks

## Debugging Tips

### Backend Logs
```bash
# Watch backend output for errors/status
# File: backend/.env for config
# Common issues:
# - DB connection: Check DB_HOST, DB_PORT, credentials
# - Redis connection: Check REDIS_HOST, REDIS_PORT
# - S3 upload: Check AWS credentials and bucket name
```

### Frontend Logs
```javascript
// Browser console (F12)
// Check network tab for API calls
// Check for CORS errors
// Check session cookies are being sent
```

### Session Issues
```sql
-- Check active sessions
SELECT * FROM user_sessions WHERE user_id = 'UUID';

-- Clear stale sessions
DELETE FROM user_sessions WHERE expires_at < NOW();
```

## Key Metrics to Track (Once Payment System Added)

- Active credit-holding users
- Average credits purchased per user
- Credits used per task (by file size, page count)
- Payment conversion rate
- Failed transactions
- Monthly recurring revenue

---

**Last Updated**: 2025-11-14
**Document Version**: 1.0
**Applies to**: untxt OCR Platform main branch

