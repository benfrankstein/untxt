# OCR Platform - Comprehensive Codebase Structure & Credits System Implementation Plan

## EXECUTIVE SUMMARY

This document provides a complete analysis of the untxt OCR platform's architecture, current structure, and a detailed construction plan for implementing a credits-based payment system with Stripe simulation.

**Key Findings:**
- **Backend**: Node.js/Express with PostgreSQL, Redis, and AWS S3
- **Frontend**: Vanilla JavaScript single-page application (no framework)
- **Authentication**: Session-based with bcrypt password hashing
- **File Uploads**: Multipart form data to S3 with Redis task queue
- **Database**: PostgreSQL with comprehensive HIPAA-compliant audit logging
- **Payment System**: Currently NONE - ready for implementation

---

## 1. BACKEND ARCHITECTURE

### 1.1 Project Structure
```
/backend/
├── src/
│   ├── app.js                    # Express app setup & middleware
│   ├── index.js                  # Server startup (HTTP/HTTPS)
│   ├── config/
│   │   └── index.js             # Environment configuration
│   ├── middleware/
│   │   └── auth.middleware.js   # Authentication checks
│   ├── routes/
│   │   ├── auth.routes.js       # User registration/login
│   │   ├── tasks.routes.js      # File upload & OCR processing
│   │   ├── folders.routes.js    # Project organization
│   │   ├── admin.routes.js      # Admin functions
│   │   ├── sessions.routes.js   # Google Docs editing sessions
│   │   └── versions.routes.js   # Document versioning
│   ├── services/
│   │   ├── auth.service.js      # User authentication logic
│   │   ├── db.service.js        # Database queries
│   │   ├── s3.service.js        # S3 upload/download
│   │   ├── redis.service.js     # Task queue management
│   │   ├── session.service.js   # Session tracking
│   │   ├── websocket.service.js # Real-time updates
│   │   ├── audit.service.js     # Audit logging
│   │   └── pdf.service.js       # PDF conversion
│   └── jobs/
│       └── session-cleanup.job.js # Periodic cleanup
├── package.json
└── .env
```

### 1.2 Technology Stack
- **Runtime**: Node.js 18+
- **Framework**: Express.js 4.19
- **Database**: PostgreSQL 14+ (pg driver)
- **Cache/Queue**: Redis 4.7+
- **File Storage**: AWS S3
- **Authentication**: bcrypt 6.0, express-session
- **WebSocket**: ws 8.18
- **PDF Processing**: Puppeteer 24.25

### 1.3 Database Schema Overview

#### Core Tables
```sql
-- USERS: Central authentication table
- id (UUID primary key)
- email, username (unique constraints)
- password_hash (bcrypt)
- role (admin, user, guest)
- is_active, email_verified
- created_at, updated_at, last_login

-- USER_SESSIONS: Activity tracking & session management
- id (UUID)
- user_id, session_token
- ip_address, user_agent
- expires_at, last_activity
- created_at

-- FILES: Uploaded document metadata
- id (UUID)
- user_id (FK to users)
- original_filename, stored_filename
- file_type (pdf, image, document)
- mime_type, file_size
- file_hash (SHA-256 for dedup)
- s3_key (cloud storage reference)
- uploaded_at

-- TASKS: OCR job tracking
- id (UUID)
- user_id, file_id (FKs)
- status (pending, processing, completed, failed, cancelled)
- priority (0-10)
- created_at, started_at, completed_at
- worker_id, attempts, error_message
- folder_id (optional, for project organization)

-- RESULTS: OCR output storage
- id (UUID)
- task_id (unique FK)
- user_id (FK)
- extracted_text, confidence_score
- page_count, word_count
- processing_time_ms, model_version
- s3_result_key (result file storage)
- created_at

-- FOLDERS: Project/document organization
- id (UUID)
- user_id (FK)
- name, description, color
- parent_folder_id (nested folders)
- is_archived
- created_at, updated_at

-- TASK_HISTORY: Audit trail (preserved after task deletion)
- id (UUID)
- task_id, user_id
- status, message, metadata
- created_at

-- Additional audit tables: file_access_log, admin_action_log, folder_audit_log
```

### 1.4 API Routes & Endpoints

#### Authentication Routes (`/api/auth/`)
```
POST   /signup              - User registration
POST   /login               - User authentication
POST   /logout              - Session termination
GET    /session             - Check auth status
GET    /sessions            - List active sessions
POST   /sessions/logout-all - Logout all sessions
GET    /password-requirements - Password validation rules
GET    /profile             - Get user profile
```

#### Tasks Routes (`/api/tasks/`)
```
POST   /                    - Upload file & create OCR task
GET    /                    - List user's tasks
GET    /:taskId             - Get task details
GET    /:taskId/preview     - HTML preview of extracted text
GET    /:taskId/download    - Download original file
GET    /:taskId/result      - Download OCR result
DELETE /:taskId             - Delete task & cleanup S3 files
POST   /:taskId/retry       - Retry failed task
```

#### Folders Routes (`/api/folders/`)
```
GET    /                    - List user's folders
POST   /                    - Create folder
PUT    /:folderId           - Update folder
DELETE /:folderId           - Delete folder
POST   /:folderId/tasks/:taskId - Move task to folder
```

#### Other Routes
- `/api/versions/*` - Document versioning & editing
- `/api/sessions/*` - Google Docs editing sessions
- `/api/admin/*` - Administrative functions

### 1.5 Authentication System

**Current Implementation:**
- **Type**: Session-based authentication with express-session
- **Password Security**: bcrypt with 12 salt rounds
- **Session Storage**: Server-side tracking in PostgreSQL
- **Session Timeout**: 15 minutes of inactivity (rolling session)
- **Cookie Security**: 
  - httpOnly flag (XSS prevention)
  - secure flag in production (HTTPS only)
  - sameSite: 'lax' (CSRF protection)

**Password Requirements:**
- Minimum 12 characters
- Uppercase, lowercase, numbers, special characters required
- No spaces allowed
- Maximum 128 characters

### 1.6 File Upload System

**Upload Flow:**
1. User selects file via form
2. Frontend sends multipart/form-data to `POST /api/tasks`
3. Multer middleware validates file (type, size max 10MB)
4. File uploaded to AWS S3 with KMS encryption
5. Database records created for file & task
6. Task enqueued to Redis for worker processing
7. WebSocket notification sent to user

**Storage Strategy:**
- Files stored on S3 with user ID in path: `uploads/{user_id}/{YYYY-MM}/{file_id}/{filename}`
- Results stored as: `results/{user_id}/{YYYY-MM}/{task_id}/{filename}`
- Local file_path field optional (backward compatibility)
- File hash (SHA-256) for deduplication

**Current Usage Tracking:**
- None - all uploads accepted without limitation
- No quota system
- No per-user upload limits
- No tracking of processing costs

### 1.7 Request Authentication

**Current Pattern (Non-Protected Routes):**
```javascript
// Routes accept userId from multiple sources (security risk!)
const userId = req.body.userId || req.headers['x-user-id'];
```

**Should use instead:**
```javascript
// Session-based authentication
const userId = req.session?.userId;

// Protected routes should use requireAuth middleware
router.post('/', requireAuth, (req, res) => {
  const userId = req.session.userId;
  // ...
});
```

### 1.8 WebSocket Architecture

**Channel**: Connected to main Express server
**Protocol**: WS or WSS depending on SSL config
**Messages Supported:**
- Task updates (status, progress, results)
- Database change notifications
- Real-time notifications

**Service File**: `/backend/src/services/websocket.service.js`

---

## 2. FRONTEND ARCHITECTURE

### 2.1 Project Structure
```
/frontend/
├── index.html               # Main dashboard & task viewer
├── app.js                   # Main application logic
├── auth.html                # Login/signup page
├── auth.js                  # Authentication logic
├── account.html             # User profile page
├── account.js               # Profile management
├── style.css                # Main styling
├── account.css              # Profile page styling
└── logo.png                 # Application logo
```

### 2.2 Technology Stack
- **Type**: Vanilla JavaScript (NO framework)
- **DOM Manipulation**: Native DOM APIs
- **HTTP Client**: Fetch API
- **WebSocket**: Native WebSocket API
- **Styling**: CSS3 (custom, no preprocessor)
- **Storage**: localStorage for view preferences
- **State Management**: In-memory JavaScript variables

### 2.3 State Management
```javascript
// Global state variables in app.js
let USER_ID = null;                    // Current user ID
let tasks = [];                        // Task list cache
let currentTask = null;                // Currently viewing task
let folders = [];                      // User's folders
let currentFolderId = 'all';          // Active folder filter
let ws = null;                         // WebSocket connection
let pdfCache = new Map();              // HIPAA-compliant in-memory PDF cache
let currentSessionId = null;           // Google Docs session
let autoSaveTimer = null;              // Auto-save interval
let isSaving = false;                  // Save state flag
```

### 2.4 Key Functions

#### Authentication (`auth.js`)
```javascript
async function handleSignup() - User registration
async function handleLogin() - User login
async function logout() - Session termination
async function checkAuth() - Verify authenticated state
function togglePassword() - Show/hide password
function validatePassword() - Client-side validation
```

#### Main App (`app.js`)
```javascript
async function checkAuth() - Redirect if not authenticated
async function loadTasks() - Fetch user's task list
async function loadFolders() - Fetch project folders
async function uploadFile() - Handle file upload
function initWebSocket() - Connect to real-time updates
async function deleteTask() - Remove task
async function downloadResult() - Get OCR output
async function downloadOriginal() - Get uploaded file
async function retryTask() - Reprocess failed task
```

#### Account (`account.js`)
```javascript
async function loadProfile() - Fetch user profile data
async function logout() - User logout
```

### 2.5 Communication with Backend

**API Configuration:**
```javascript
const API_URL = 'http://localhost:8080';  // Hardcoded, should be env var
const WS_URL = 'ws://localhost:8080';     // WebSocket endpoint

// Requests include credentials for session cookies
fetch(url, { credentials: 'include' })
```

**Request Patterns:**
- File uploads: multipart/form-data
- JSON requests: Content-Type: application/json
- Session cookies: Sent automatically with credentials flag

### 2.6 UI Components (No Framework)

**Layout Structure:**
- Header with logo, buttons (Upload, Account, Logout)
- Main dashboard with task grid/list view
- Task viewer with extracted text & download options
- Folder sidebar for project organization
- Upload modal for file selection
- Account page for profile information

**View Modes:**
- Grid view (card layout, default)
- List view (table layout)
- Toggle between original & extracted text preview

### 2.7 Current State Management Issues
- No framework-based state management (Redux, Context, Vuex, etc.)
- Global variables pollute global scope
- No clear separation of concerns
- Risk of state inconsistency
- Difficult to scale or test
- **BUT**: Lightweight and simple for current needs

---

## 3. EXISTING PAYMENT/TRANSACTION SYSTEMS

### 3.1 Current Status
**FINDING: NO payment system currently exists**

**Search Results:**
- No Stripe integration
- No payment processing routes
- No transaction tracking
- No credit/balance system
- No pricing model

**Confirmation Grep:**
```bash
grep -r "payment\|stripe\|transaction\|credit\|balance" /backend/src
# Result: Only found in session.service.js (false positive)
```

### 3.2 User Data Currently Stored
```javascript
// From /api/auth/profile endpoint
{
  id: UUID,
  email: string,
  username: string,
  firstName: string,
  lastName: string,
  phoneNumber: string (optional),
  role: 'user' | 'admin' | 'guest',
  createdAt: ISO date,
  lastLogin: ISO date,
  // NO balance, credits, subscription, or payment info
}
```

### 3.3 Audit Logging System (Ready for Payments)
The application has comprehensive audit logging already in place:

**Audit Tables:**
- `file_access_log` - Who accessed which files
- `admin_action_log` - Admin activities
- `folder_audit_log` - Folder operations
- `task_history` - Task status changes (preserved after deletion)

**Audit Functions:** (`/backend/src/services/audit.service.js`)
```javascript
logAccountCreated(userId, email, ipAddress, userAgent)
logAuthSuccess(userId, ipAddress, userAgent)
logAuthFailure(email, errorMsg, ipAddress, userAgent)
logLogout(userId, ipAddress, userAgent, reason)
logSessionCreated/Destroyed(...)
// And many more...
```

**This provides a strong foundation for payment audit trails.**

---

## 4. CURRENT USAGE PATTERNS

### 4.1 File Upload
**Endpoint**: `POST /api/tasks` (file upload)

**Current Behavior:**
```javascript
// From /backend/src/routes/tasks.routes.js
router.post('/', upload.single('file'), async (req, res) => {
  // 1. Validate file exists
  // 2. Get userId (SECURITY ISSUE: from body or headers!)
  // 3. Generate IDs (fileId, taskId)
  // 4. Upload to S3
  // 5. Create file record in DB
  // 6. Create task record in DB
  // 7. Enqueue to Redis for worker
  // 8. Send WebSocket notification
  // 9. Return 201 with task details
});
```

**What's Missing:**
- No credit/cost check before upload
- No usage limit enforcement
- No payment validation
- No quota checking
- No pricing calculation

### 4.2 OCR Processing
**Worker receives task from Redis queue and:**
1. Downloads file from S3
2. Processes with Qwen3 model
3. Generates extracted text
4. Stores result in S3
5. Updates task status to 'completed'
6. Publishes to Redis pub/sub (triggers WebSocket update)

**Cost Points:**
- File size (storage)
- Processing time (compute)
- API calls (if applicable)
- Could be measured in "credits"

### 4.3 Result Download
**Endpoints:**
- `GET /api/tasks/:taskId/download` - Original file
- `GET /api/tasks/:taskId/result` - OCR output
- `GET /api/tasks/:taskId/preview` - HTML preview

**Current Behavior:**
- No access control beyond basic ownership check
- No logging of downloads for audit
- HIPAA-compliant PDF caching in browser

**Missing:**
- Credit deduction for downloads
- Download quota limiting
- Per-download logging for monetization

---

## 5. DATABASE DESIGN READINESS

### 5.1 Existing Infrastructure
- ✓ PostgreSQL with UUID support
- ✓ Comprehensive indexing
- ✓ Audit logging system
- ✓ Transaction support
- ✓ Triggers & stored procedures
- ✓ Role-based user system

### 5.2 Available Patterns
- ✓ User relationship established
- ✓ Timestamp tracking (created_at, updated_at)
- ✓ JSONB for flexible metadata
- ✓ Audit trail precedent (task_history table)

### 5.3 What Needs to be Added
- Credits/balance table
- Transaction ledger table
- Pricing model table
- Payment history table
- Subscription/plan table (if offering plans)
- Usage/metering table

---

## 6. AUTHENTICATION & SECURITY CONSIDERATIONS

### 6.1 Current Security Model
- ✓ HTTPS/TLS enforced in production (HIPAA compliant)
- ✓ Session-based auth with secure cookies
- ✓ Password hashing with bcrypt (12 rounds)
- ✓ CSRF protection (sameSite cookies)
- ✓ XSS prevention (httpOnly cookies)
- ✓ Audit logging for all operations
- ✓ User ownership verification for resources

### 6.2 Authentication Middleware
```javascript
// From /backend/src/middleware/auth.middleware.js
async function requireAuth(req, res, next) {
  if (req.session?.userId) {
    await sessionService.updateSessionActivity(req.sessionID);
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
}

async function requireAdmin(req, res, next) {
  // Similar pattern with role check
}
```

### 6.3 Integration Points for Payments
- Session already validates user identity
- Can verify user before charging
- Audit system ready for payment logging
- No conflicts with existing auth flow

---

## 7. CONSTRUCTION PLAN FOR CREDITS SYSTEM

### 7.1 Database Migrations

**Migration 1: Add Credits & User Balance**
```sql
-- 1. Add balance tracking to users table
ALTER TABLE users ADD COLUMN 
  credits_balance DECIMAL(10, 4) DEFAULT 0 NOT NULL;

-- 2. Create transactions ledger
CREATE TABLE credit_transactions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL FK,
  transaction_type ENUM('purchase', 'usage', 'refund', 'bonus'),
  amount DECIMAL(10, 4) NOT NULL,
  related_task_id UUID FK (nullable),
  related_payment_id VARCHAR FK (nullable),
  description TEXT,
  created_at TIMESTAMP,
  metadata JSONB
);

-- 3. Create pricing/plans table
CREATE TABLE pricing_plans (
  id UUID PRIMARY KEY,
  name VARCHAR(100),
  description TEXT,
  credits_amount INT,
  price_cents INT, -- in cents for Stripe
  is_active BOOLEAN,
  created_at TIMESTAMP
);

-- 4. Create payments table (Stripe simulation)
CREATE TABLE payments (
  id VARCHAR PRIMARY KEY, -- Stripe payment ID or UUID
  user_id UUID NOT NULL FK,
  plan_id UUID NOT NULL FK,
  amount_cents INT,
  status ENUM('pending', 'completed', 'failed', 'refunded'),
  stripe_session_id VARCHAR (nullable, for simulation),
  payment_method VARCHAR (simulated payment method),
  created_at TIMESTAMP,
  completed_at TIMESTAMP,
  metadata JSONB
);

-- 5. Create usage tracking table
CREATE TABLE credit_usage (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL FK,
  task_id UUID NOT NULL FK,
  file_size_mb INT,
  pages INT,
  processing_time_seconds INT,
  credits_used DECIMAL(10, 4),
  cost_reason VARCHAR(255), -- e.g., "OCR processing: 10 pages"
  created_at TIMESTAMP
);

-- 6. Track download usage
CREATE TABLE download_usage (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL FK,
  task_id UUID NOT NULL FK,
  download_type ENUM('original', 'result', 'preview'),
  credits_used DECIMAL(10, 4),
  downloaded_at TIMESTAMP
);
```

### 7.2 Backend Implementation

#### New Service: Credits Service
**File**: `/backend/src/services/credits.service.js`

```javascript
class CreditsService {
  // Get user balance
  async getUserBalance(userId) { }
  
  // Check if user has enough credits
  async hasEnoughCredits(userId, creditsNeeded) { }
  
  // Deduct credits from user
  async deductCredits(userId, amount, taskId, reason) { }
  
  // Add credits (purchase or bonus)
  async addCredits(userId, amount, reason, paymentId) { }
  
  // Get transaction history
  async getTransactionHistory(userId, limit, offset) { }
  
  // Get usage statistics
  async getUsageStats(userId, period) { }
  
  // Calculate cost for task
  async calculateTaskCost(fileSize, pageCount, processingTime) { }
}
```

#### New Service: Payment Service (Stripe Simulation)
**File**: `/backend/src/services/payment.service.js`

```javascript
class PaymentService {
  // Create checkout session (simulated)
  async createCheckoutSession(userId, planId) { }
  
  // Process payment (simulate Stripe webhook)
  async processPayment(paymentData) { }
  
  // Get payment history
  async getPaymentHistory(userId) { }
  
  // Simulate Stripe webhook
  async handleWebhookEvent(event) { }
  
  // Refund payment
  async refundPayment(paymentId) { }
  
  // Get available plans
  async getPricingPlans() { }
}
```

#### New Routes: Payments API
**File**: `/backend/src/routes/payments.routes.js`

```javascript
// New endpoints
POST   /api/payments/plans             - Get pricing plans
POST   /api/payments/checkout          - Create checkout session
POST   /api/payments/webhook           - Stripe webhook (simulated)
GET    /api/payments/history           - Payment history
GET    /api/credits/balance            - Get user balance
GET    /api/credits/usage-stats        - Usage statistics
POST   /api/credits/add-bonus          - Admin: Add credits
GET    /api/credits/transactions       - Transaction history
```

#### Update Existing Routes

**Tasks Route - Add Credit Check:**
```javascript
router.post('/', upload.single('file'), requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    
    // NEW: Calculate cost for this file
    const estimatedCost = await creditsService.calculateTaskCost(
      req.file.size,
      estimatedPages,
      estimatedTime
    );
    
    // NEW: Check if user has credits
    const hasEnough = await creditsService.hasEnoughCredits(userId, estimatedCost);
    if (!hasEnough) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        required: estimatedCost,
        available: balance,
        upgradeUrl: '/payments/plans'
      });
    }
    
    // ... existing upload code ...
    
    // NEW: Deduct credits after successful upload
    await creditsService.deductCredits(userId, actualCost, taskId, 'OCR processing');
  }
});
```

#### Worker Integration
**Update**: `/worker/app.py` or equivalent

```python
# After OCR processing completes
actual_cost = calculate_cost(
  file_size=task.file_size,
  page_count=result.page_count,
  processing_time=time.time() - start_time
)

# Update credit usage record
db.execute("""
  INSERT INTO credit_usage 
  VALUES (...actual_cost...)
""")
```

### 7.3 Frontend Implementation

#### New Page: Pricing/Plans
**File**: `/frontend/pricing.html` & `pricing.js`

```html
<div class="pricing-plans">
  <div class="plan-card">
    <h3>Starter</h3>
    <p class="price">$5</p>
    <p class="credits">100 Credits</p>
    <button onclick="purchasePlan('plan-starter')">Purchase</button>
  </div>
  <!-- More plans... -->
</div>
```

#### Update: Account Page
**File**: `/frontend/account.html` & `account.js`

Add sections for:
```html
<section class="credits-section">
  <h3>Available Credits</h3>
  <p class="balance" id="creditsBalance">0</p>
  <button onclick="goToPricing()">Buy More Credits</button>
</section>

<section class="usage-section">
  <h3>Usage This Month</h3>
  <p id="usageStats">Loading...</p>
</section>

<section class="transaction-section">
  <h3>Transaction History</h3>
  <table id="transactionTable"><!-- populated by JS --></table>
</section>
```

#### New Component: Payment Checkout
**File**: `/frontend/checkout.html` & `checkout.js`

```html
<div class="checkout-form">
  <h2>Purchase Credits</h2>
  <select id="planSelect" onchange="updatePrice()">
    <option value="plan-starter">Starter - $5 (100 credits)</option>
    <!-- More options... -->
  </select>
  
  <form id="paymentForm">
    <!-- Stripe card element would go here -->
    <!-- For simulation, we'll use mock credit card input -->
    <input id="cardNumber" placeholder="Card Number">
    <input id="cardExpiry" placeholder="MM/YY">
    <input id="cardCvc" placeholder="CVC">
    <button type="submit">Complete Purchase</button>
  </form>
</div>
```

#### Update: Main Dashboard (`app.js`)

Add credit check before upload:
```javascript
async function uploadFile(file) {
  // Get current balance
  const balance = await fetch('/api/credits/balance', 
    { credentials: 'include' }
  ).then(r => r.json());
  
  // Estimate cost
  const estimatedCost = estimateUploadCost(file);
  
  // Check balance
  if (balance.data.available < estimatedCost) {
    showModal('Insufficient Credits', 
      `This upload will cost ${estimatedCost} credits. 
       You have ${balance.data.available} available. 
       Purchase more?`, 
      ['Buy Credits', 'Cancel']);
    return;
  }
  
  // Proceed with upload
  // ...
}
```

### 7.4 Configuration & Pricing Model

**New Config File**: `/backend/src/config/pricing.js`

```javascript
module.exports = {
  pricing: {
    plans: [
      {
        id: 'plan-starter',
        name: 'Starter',
        creditAmount: 100,
        priceCents: 500, // $5.00
        description: 'Perfect for trying out the platform'
      },
      {
        id: 'plan-professional',
        name: 'Professional',
        creditAmount: 500,
        priceCents: 2000, // $20.00
        description: 'For regular users'
      },
      {
        id: 'plan-enterprise',
        name: 'Enterprise',
        creditAmount: 2000,
        priceCents: 6000, // $60.00
        description: 'High-volume processing'
      }
    ],
    
    creditCosts: {
      perPageOCR: 0.5,           // 0.5 credits per page
      perMBStorage: 0.1,         // 0.1 credits per MB
      downloadResult: 0.1,       // 0.1 credits per download
      baseCost: 1                // Minimum 1 credit per task
    },
    
    // Optional: Tiered pricing
    volumeDiscounts: {
      '500+': 0.95,  // 5% discount
      '1000+': 0.90, // 10% discount
      '5000+': 0.85  // 15% discount
    }
  }
};
```

### 7.5 Stripe Simulation (Development)

**Mock Stripe Service**: `/backend/src/services/stripe-simulator.js`

```javascript
class StripeSimulator {
  // Mock checkout session creation
  async createCheckoutSession(planId, email) {
    return {
      id: `cs_test_${Date.now()}`,
      client_secret: `cs_secret_test_${Date.now()}`,
      payment_intent_id: `pi_test_${Date.now()}`,
      url: `http://localhost:3000/checkout?session=${sessionId}`
    };
  }
  
  // Mock payment completion
  async completePayment(sessionId) {
    return {
      id: `ch_test_${Date.now()}`,
      amount: 500,
      currency: 'usd',
      status: 'succeeded',
      payment_method: {
        type: 'card',
        card: { brand: 'visa', last4: '4242' }
      }
    };
  }
  
  // Simulate webhook
  async simulateWebhook(event) {
    // Trigger payment processing
  }
}
```

---

## 8. IMPLEMENTATION ROADMAP

### Phase 1: Database (Week 1)
- Create migrations for credits tables
- Add balance tracking to users table
- Create pricing plans table
- Set up transaction ledger tables
- Create indexes for performance
- **Duration**: 2-3 days

### Phase 2: Backend Services (Week 1-2)
- Implement CreditsService
- Implement PaymentService
- Create pricing calculations
- Implement Stripe simulator
- Write unit tests
- **Duration**: 3-4 days

### Phase 3: Backend API Routes (Week 2)
- Create payments routes
- Create credits routes
- Update authentication middleware for payment validation
- Implement webhook handling
- Add credit checks to upload/download endpoints
- **Duration**: 2-3 days

### Phase 4: Frontend - Pricing Page (Week 2-3)
- Design pricing page UI
- Implement plan selection
- Create checkout form
- Add Stripe integration (or simulator)
- **Duration**: 2-3 days

### Phase 5: Frontend - Account Updates (Week 3)
- Add credits balance display
- Show usage statistics
- Transaction history table
- Buy credits button/link
- **Duration**: 1-2 days

### Phase 6: Frontend - Dashboard Integration (Week 3)
- Add credit check before upload
- Show cost estimate on file selection
- Insufficient credits modal
- Update account page with credits info
- **Duration**: 1-2 days

### Phase 7: Testing & Refinement (Week 4)
- End-to-end testing
- Security audit
- Performance testing
- User acceptance testing
- **Duration**: 3-4 days

### Phase 8: Deployment (Week 4)
- Deploy migrations
- Deploy backend changes
- Deploy frontend changes
- Configure Stripe (if using real)
- **Duration**: 1 day

**Total Estimated Timeline**: 3-4 weeks for full implementation

---

## 9. FILE PATHS & KEY CODE LOCATIONS

### Backend Files to Create
```
/backend/src/services/credits.service.js        (NEW)
/backend/src/services/payment.service.js        (NEW)
/backend/src/services/stripe-simulator.js       (NEW)
/backend/src/routes/payments.routes.js          (NEW)
/backend/src/config/pricing.js                  (NEW)
/backend/src/middleware/payment.middleware.js   (NEW)
/database/migrations/016_add_credits_system.sql (NEW)
```

### Backend Files to Modify
```
/backend/src/app.js                    (Add payments routes)
/backend/src/routes/tasks.routes.js    (Add credit checks)
/backend/src/config/index.js           (Add pricing config)
/backend/src/services/auth.service.js  (Optional: add payment methods)
```

### Frontend Files to Create
```
/frontend/pricing.html                 (NEW)
/frontend/pricing.js                   (NEW)
/frontend/checkout.html                (NEW)
/frontend/checkout.js                  (NEW)
```

### Frontend Files to Modify
```
/frontend/account.html                 (Add credits section)
/frontend/account.js                   (Load credits & transactions)
/frontend/app.js                       (Credit check before upload)
/frontend/index.html                   (Add navigation to pricing)
/frontend/style.css                    (Add pricing & checkout styles)
/frontend/account.css                  (Add credits section styles)
```

### Database Files to Create
```
/database/migrations/016_add_credits_system.sql
/database/migrations/017_add_payment_tables.sql
/database/migrations/018_add_usage_tracking.sql
```

---

## 10. KEY CONSIDERATIONS & BEST PRACTICES

### 10.1 Security Considerations
- ✓ All payment operations require authentication
- ✓ Validate credits before any operation
- ✓ Log all credit transactions for audit
- ✓ Use HTTPS only for payment data
- ✓ Never expose Stripe keys in frontend code
- ✓ Validate amounts on backend (never trust client)
- ✓ Implement rate limiting on payment endpoints
- ✓ Handle failed payments gracefully

### 10.2 Data Consistency
- ✓ Use database transactions for credit updates
- ✓ Implement idempotent payment processing
- ✓ Handle concurrent credit modifications
- ✓ Preserve transaction history (never delete)
- ✓ Keep audit trail of all money-related operations

### 10.3 Error Handling
- ✓ Gracefully handle Stripe connection failures
- ✓ Retry failed transactions
- ✓ Clear error messages for payment failures
- ✓ Log all errors for debugging
- ✓ Refund on processing errors

### 10.4 User Experience
- ✓ Clear pricing display
- ✓ Show cost estimates before charge
- ✓ Instant balance updates after purchase
- ✓ Simple checkout process
- ✓ Email receipts for purchases
- ✓ Easy navigation to buy credits from anywhere

### 10.5 Stripe Integration (Real vs. Simulated)
**For Development**: Use stripe-simulator.js to mock responses
**For Production**: 
- Use real Stripe API keys
- Implement webhook signature verification
- Handle Stripe events (charge.succeeded, charge.failed, etc.)
- Store payment method tokens securely

---

## 11. METRICS & MONITORING

### Track These Metrics
- Active credit-holding users
- Average credits purchased per user
- Average credits used per task
- Payment conversion rate
- Failed payment attempts
- Refund rate
- Monthly recurring revenue (MRR)

### Query Examples
```sql
-- User statistics with credits
SELECT 
  u.id, u.username, u.email,
  u.credits_balance,
  COUNT(DISTINCT p.id) as total_purchases,
  COALESCE(SUM(p.amount_cents)/100.0, 0) as total_spent,
  COUNT(DISTINCT t.id) as total_tasks,
  COALESCE(SUM(cu.credits_used), 0) as total_credits_used
FROM users u
LEFT JOIN payments p ON u.id = p.user_id
LEFT JOIN tasks t ON u.id = t.user_id
LEFT JOIN credit_usage cu ON u.id = cu.user_id
GROUP BY u.id;

-- Revenue tracking
SELECT 
  DATE(p.completed_at) as date,
  COUNT(*) as transactions,
  SUM(p.amount_cents)/100.0 as revenue
FROM payments p
WHERE p.status = 'completed'
GROUP BY DATE(p.completed_at)
ORDER BY date DESC;
```

---

## 12. RECOMMENDED NEXT STEPS

1. **Review this plan with the team** - Validate approach
2. **Create database migrations** - Set up table structure
3. **Implement CreditsService** - Core business logic
4. **Build payment routes** - API endpoints
5. **Create pricing page** - User-facing UI
6. **Integration testing** - Full workflow testing
7. **Deployment preparation** - Environment setup
8. **Launch with monitoring** - Watch metrics

---

## APPENDIX: Code Examples

### Example: Deducting Credits on Task Completion
```javascript
// In worker processing
async function completeOCRTask(taskId, result) {
  try {
    // Calculate actual cost based on results
    const costData = {
      pageCount: result.pageCount,
      fileSize: result.fileSize,
      processingTime: Date.now() - task.startTime
    };
    
    const actualCost = calculateCredits(costData);
    
    // Deduct credits from user
    await creditsService.deductCredits(
      task.user_id,
      actualCost,
      taskId,
      `OCR Processing: ${result.pageCount} pages`
    );
    
    // Store result
    await dbService.createResult({
      taskId,
      userId: task.user_id,
      extractedText: result.text,
      // ...
    });
    
  } catch (error) {
    // Handle error, possibly refund credits
    logger.error('Task completion error:', error);
  }
}
```

### Example: Checking Credits Before Upload
```javascript
// In frontend app.js
async function handleFileSelect(file) {
  try {
    // Get user balance
    const balanceResp = await fetch('/api/credits/balance', {
      credentials: 'include'
    });
    const balanceData = await balanceResp.json();
    
    // Estimate cost
    const estimatedCredits = estimateUploadCost(file);
    
    // Check if sufficient
    if (balanceData.available < estimatedCredits) {
      showInsufficientCreditsModal(
        balanceData.available,
        estimatedCredits
      );
      return;
    }
    
    // Proceed with upload
    await uploadFile(file);
    
  } catch (error) {
    showError('Failed to check balance');
  }
}
```

---

**End of Analysis Document**

