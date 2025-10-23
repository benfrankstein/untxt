# Development Order: OCR Platform Implementation

This guide outlines the recommended development order for implementing the OCR platform. Follow these steps sequentially to build from the foundation up, ensuring each layer is tested before moving to the next.

## Phase 0: Project Setup

### Prerequisites Installation
1. Install base development tools:
   - Git for version control
   - Docker (optional, for containerization)
   - Package manager (apt, brew, etc.)
   - Text editor or IDE

2. Install runtime environments:
   - Node.js 18+ and npm/yarn
   - Python 3.9+ and pip
   - PostgreSQL 14+ client tools
   - Redis client tools

3. Project initialization:
   - Create project directory structure
   - Initialize Git repository
   - Set up .gitignore and README.md
   - Create development branch strategy

### Environment Configuration
- Create environment variable templates (.env.example)
- Document required configuration values
- Set up local development certificates (self-signed for testing)
- Prepare directory structure for logs and temporary files

---

## Phase 1: Data Layer (Foundation)

Build the data layer first as it provides the foundation for all other services.

### PostgreSQL Database
1. Install PostgreSQL locally
2. Create development database and user
3. Design database schema:
   - Users table (authentication, roles)
   - Tasks table (OCR job tracking)
   - Results table (processed OCR output)
   - Files metadata table
4. Write migration scripts
5. Create seed data for testing
6. Test CRUD operations directly

### Redis Setup
1. Install Redis locally
2. Configure Redis for:
   - Task queue (job management)
   - Pub/Sub (real-time notifications)
   - Session storage
3. Test basic operations (SET, GET, LPUSH, LPOP)
4. Document Redis data structures and key naming conventions

### File Storage (AWS S3)
1. Set up AWS S3 bucket for file storage
2. Configure KMS encryption for HIPAA compliance
3. Create IAM user with minimal S3/KMS permissions
4. Implement S3 client for upload/download operations
5. Design hierarchical S3 key structure (uploads/, results/)
6. Update database schema to include s3_key fields
7. Test S3 upload/download with encryption
8. Create temporary local directory for processing (auto-cleanup)

**Milestone**: Data layer services running and verified with direct testing. ✅ PHASE 1 COMPLETE

---

## Phase 2: Processing Layer (OCR Workers)

Build the OCR processing engine that will consume tasks from the queue.

### Flask Worker Setup
1. Create Python Flask application structure
2. Set up virtual environment
3. Install Flask and dependencies
4. Implement basic health check endpoint
5. Configure to bind on localhost:5000

### Qwen3 Model Integration
1. Download or prepare Qwen3 model files
2. Implement model loading and initialization
3. Create text extraction function
4. Test model inference with sample images
5. Optimize model performance (batch size, memory usage)

### S3 Integration
1. Implement S3 client module (s3_client.py)
2. Add boto3 dependency for AWS operations
3. Create methods for:
   - upload_file() - Upload with KMS encryption
   - download_file() - Download from S3
   - upload_string() - Upload HTML content directly
   - generate_s3_key() - Generate hierarchical paths
4. Load AWS credentials from .env file
5. Test S3 operations independently

### Task Processing Pipeline
1. Implement Redis queue consumer (BRPOP with timeout)
2. Create task processing workflow:
   - Fetch task ID from Redis queue
   - Retrieve task details from PostgreSQL (includes s3_key)
   - **Download input file from S3 to temp directory**
   - Run OCR (Qwen3 inference) on downloaded file
   - Parse and structure output
   - **Upload result HTML directly to S3** (no local storage)
   - **Store result metadata in PostgreSQL** (includes s3_result_key)
   - Update task status to 'completed'
   - **Clean up temporary files**
   - Publish completion notification via Redis Pub/Sub
3. Add error handling and retry logic
4. Implement logging for debugging
5. Configure dotenv to load .env file for AWS credentials

### Worker Testing
1. Test with sample images of varying complexity
2. Verify queue consumption and task completion
3. Check result accuracy and format
4. Test error scenarios (corrupted files, timeouts)
5. Monitor resource usage (CPU, memory)
6. **Run S3 integration test** (test_s3_integration.sh):
   - Upload test file to S3
   - Create database records with S3 paths
   - Enqueue task to Redis
   - Verify worker downloads from S3
   - Verify worker uploads result to S3
   - Verify S3 paths stored in database
   - Verify KMS encryption on files
7. Download result HTML from S3 and verify content

**Milestone**: Workers successfully process OCR tasks end-to-end with S3 storage. ✅ PHASE 2 COMPLETE

---

## Phase 3: Application Layer - Backend

Build the API and WebSocket server that coordinates the system.

### Node.js Backend Setup
1. Create Express application structure
2. Install dependencies (express, ws, redis client, pg client)
3. Configure to bind on localhost:8080
4. Set up middleware (CORS, body parsing, logging)

### Database Integration
1. Implement PostgreSQL connection pool
2. Create data access layer (models/repositories)
3. Write queries for:
   - User management
   - Task CRUD operations
   - Result retrieval
4. Test database operations

### Redis Integration
1. Implement Redis client connection
2. Create task queue management functions:
   - Enqueue new OCR tasks
   - Check task status
   - Retrieve results
3. Set up Pub/Sub for real-time updates

### S3 Integration (Backend)
1. Install AWS SDK for Node.js (@aws-sdk/client-s3)
2. Create S3 client module
3. Implement file upload to S3:
   - Receive file from multipart/form-data
   - Generate S3 key (uploads/{user_id}/{date}/{file_id}/{filename})
   - Upload to S3 with KMS encryption
   - Store s3_key in files table
4. Implement file download from S3:
   - Generate pre-signed URLs for temporary access
   - OR download and stream to client
5. Implement file deletion from S3:
   - Delete from S3 when task is deleted
   - Clean up both input and result files

### REST API Endpoints
1. Implement authentication endpoints:
   - POST /api/auth/login
   - POST /api/auth/register
   - POST /api/auth/logout
2. Implement OCR task endpoints:
   - POST /api/tasks (upload file to S3, create task, enqueue to Redis)
   - GET /api/tasks (list user's tasks)
   - GET /api/tasks/:id (get task details with S3 paths)
   - GET /api/tasks/:id/result (download result HTML from S3)
   - DELETE /api/tasks/:id (delete files from S3, remove from DB)
3. Add request validation and error handling
4. Implement file upload validation (size, type, MIME check)

### WebSocket Server
1. Set up WebSocket server alongside Express
2. Implement connection authentication
3. Subscribe to Redis Pub/Sub for task updates
4. Broadcast real-time task status to connected clients
5. Handle client disconnections gracefully

### Backend Testing
1. Test API endpoints with Postman or curl
2. Verify file upload to S3 with KMS encryption
3. Verify task creation and queuing to Redis
4. Test WebSocket connections and real-time updates
5. Simulate full workflow: upload → S3 → queue → process → S3 result → download
6. Test error handling and edge cases
7. Verify S3 file deletion when tasks are deleted
8. Test pre-signed URL generation for file downloads

**Milestone**: Backend API functional with WebSocket real-time updates and S3 integration.

---

## Phase 4: Application Layer - Frontend

Build the public-facing web interface.

### Next.js Frontend Setup
1. Create Next.js application
2. Install dependencies (react, axios, socket.io-client, UI library)
3. Configure to run on localhost:3000
4. Set up routing structure

### UI Components
1. Create authentication pages:
   - Login page
   - Registration page
   - Password reset (optional)
2. Create main application pages:
   - Dashboard (task list)
   - Upload page (file selection, task creation)
   - Task detail page (status, results)
   - Results viewer (formatted OCR output)
3. Implement reusable components:
   - Navigation/header
   - File upload component
   - Task status indicator
   - Result display component

### API Integration
1. Create API client service (axios wrapper)
2. Implement authentication flow
3. Connect upload form to backend API
4. Fetch and display task list
5. Retrieve and display OCR results

### WebSocket Integration
1. Set up WebSocket client connection
2. Subscribe to task status updates
3. Update UI in real-time when tasks complete
4. Handle connection errors and reconnection

### Frontend Testing
1. Test user authentication flow
2. Test file upload and task creation
3. Verify real-time status updates
4. Test result viewing and downloading
5. Check responsive design on different screen sizes
6. Test error states and user feedback

**Milestone**: Functional web interface with real-time OCR processing.

---

## Phase 5: Application Layer - Admin UI

Build the Electron desktop application for system administration.

### Electron Application Setup
1. Create Electron application structure
2. Configure build and packaging
3. Set up IPC (main/renderer communication)
4. Configure to connect to backend (localhost:8080)

### Admin Features
1. Implement authentication for admin users
2. Create dashboard views:
   - System health monitoring
   - Active tasks and queue status
   - User management
   - System statistics
3. Add administrative functions:
   - View all users and tasks
   - Cancel/retry tasks
   - Configure system settings
   - View logs

### Backend API Extensions
1. Add admin-specific API endpoints
2. Implement role-based access control
3. Add system monitoring endpoints:
   - GET /api/admin/health
   - GET /api/admin/stats
   - GET /api/admin/users
   - POST /api/admin/tasks/:id/retry

### Admin UI Testing
1. Test admin authentication and authorization
2. Verify monitoring displays accurate data
3. Test administrative actions (user management, task control)
4. Test desktop application on target platforms

**Milestone**: Admin UI operational with system management capabilities.

---

## Phase 6: Reverse Proxy Layer

Configure Nginx to expose the system securely.

### Local Nginx Setup
1. Install Nginx locally
2. Create configuration for development:
   - Listen on port 8443 (or use system port 443)
   - Proxy / to frontend (localhost:3000)
   - Proxy /api to backend (localhost:8080)
   - Proxy /ws to WebSocket server (localhost:8080)
3. Configure SSL with self-signed certificates
4. Enable basic logging

### Rate Limiting
1. Configure Nginx rate limiting rules
2. Set limits for:
   - API requests per IP
   - File uploads per IP
   - WebSocket connections
3. Test rate limiting with load tools

### Security Headers
1. Add security headers:
   - HSTS (Strict-Transport-Security)
   - X-Content-Type-Options
   - X-Frame-Options
   - CSP (Content-Security-Policy)
2. Configure CORS properly
3. Test header presence and correctness

### Nginx Testing
1. Verify HTTP to HTTPS redirect
2. Test proxying to all backend services
3. Confirm rate limiting works
4. Check SSL/TLS configuration (use SSL Labs or similar)
5. Verify all internal services remain inaccessible externally

**Milestone**: Nginx reverse proxy operational with security measures.

---

## Phase 7: Integration Testing

Test the complete system as a whole.

### End-to-End Testing
1. Start all services in order:
   - PostgreSQL and Redis
   - Flask workers
   - Node.js backend
   - Next.js frontend
   - Nginx reverse proxy
2. Test complete user workflows:
   - User registration and login
   - Upload document through frontend
   - Monitor real-time status updates
   - View and download OCR results
   - Admin monitoring and management
3. Test edge cases:
   - Large files
   - Corrupted files
   - Invalid formats
   - Concurrent users
   - Network interruptions

### Performance Testing
1. Use Apache Bench or k6 for load testing
2. Test with multiple concurrent users
3. Monitor resource usage across all services
4. Identify bottlenecks and optimize
5. Verify rate limiting under load

### Security Testing
1. Verify all services bound to localhost (except Nginx)
2. Test authentication and authorization
3. Attempt to access internal services directly
4. Check for common vulnerabilities (SQL injection, XSS, etc.)
5. Verify file upload restrictions and validation

### Documentation
1. Document API endpoints (OpenAPI/Swagger)
2. Create developer setup guide
3. Write troubleshooting guide
4. Document configuration options
5. Create user manual for frontend

**Milestone**: Complete system tested and documented.

---

## Phase 8: Production Deployment

Deploy the platform to a production server.

### Server Preparation
1. Provision server (VPS from AWS, DigitalOcean, etc.)
2. Update system packages
3. Harden security:
   - Configure firewall (ufw or iptables)
   - Set up fail2ban
   - Configure SSH (disable password auth, use keys)
4. Obtain domain name
5. Point DNS to server IP

### Service Installation
1. Install all required services:
   - Node.js
   - Python
   - PostgreSQL
   - Redis
   - Nginx
2. Configure services to start on boot (systemd)
3. Create service user accounts (principle of least privilege)

### Application Deployment
1. Transfer code to server (Git clone or SCP)
2. Install dependencies for all components
3. Configure environment variables for production
4. Set up log directories with proper permissions
5. Create file storage directory

### Database Migration
1. Run database migrations on production PostgreSQL
2. Create production database users with limited permissions
3. (Optional) Import initial data

### SSL Certificate Setup
1. Install certbot (Let's Encrypt client)
2. Obtain SSL certificate for domain
3. Configure Nginx to use production certificates
4. Set up automatic certificate renewal

### Service Configuration
1. Configure all services to bind localhost only
2. Configure Nginx to listen on 0.0.0.0:443
3. Update connection strings to use production values
4. Set appropriate log levels for production

### Starting Services
1. Start services in order:
   - PostgreSQL
   - Redis
   - Flask workers (via systemd)
   - Node.js backend (via systemd or PM2)
   - Next.js frontend (built and served)
   - Nginx
2. Verify all services are running
3. Check logs for errors

### Production Testing
1. Test complete workflow from public domain
2. Verify SSL certificate and HTTPS
3. Test rate limiting
4. Monitor resource usage
5. Test admin UI connection to production backend

**Milestone**: Production deployment complete and operational.

---

## Phase 9: Post-Deployment

Set up monitoring, backups, and maintenance procedures.

### Monitoring Setup
1. Install monitoring tools (Prometheus, Grafana, or similar)
2. Configure metrics collection:
   - System resources (CPU, RAM, disk)
   - Service health checks
   - Application metrics (queue length, task completion rate)
3. Set up alerting for critical issues
4. Create monitoring dashboards

### Backup Configuration
1. Set up automated PostgreSQL backups:
   - Daily full backups
   - Transaction log archiving
   - Backup retention policy
2. Configure file storage backups
3. Store backups in separate location (offsite or cloud)
4. Test backup restoration procedure

### Log Management
1. Configure log rotation (logrotate)
2. Set up centralized logging (optional)
3. Define log retention policies
4. Create log analysis procedures for debugging

### Maintenance Procedures
1. Document update procedures for each component
2. Create rollback plan for failed deployments
3. Schedule regular security updates
4. Plan for scaling (if needed)

### Performance Optimization
1. Analyze production metrics
2. Optimize database queries and indexes
3. Tune worker concurrency and batch sizes
4. Optimize Nginx caching (if applicable)
5. Consider CDN for static assets

**Milestone**: Production system monitored, backed up, and optimized.

---

## Phase 10: Iteration and Scaling

Continuously improve and scale the platform.

### Feature Enhancements
1. Gather user feedback
2. Prioritize new features
3. Implement in development environment
4. Test thoroughly before production deployment

### Scaling Strategies
1. Monitor growth and resource usage
2. Implement scaling as needed:
   - Add more worker instances (already S3-ready)
   - Implement Redis Cluster for distributed queue
   - Use PostgreSQL replication for read scaling
   - S3 storage already implemented with KMS encryption ✅
   - Deploy multiple backend instances with load balancing
   - Implement S3 CloudFront CDN for faster downloads
3. Test scaled architecture thoroughly

### Continuous Improvement
1. Regular security audits
2. Performance profiling and optimization
3. Code refactoring and technical debt reduction
4. Documentation updates
5. Dependency updates and vulnerability patches

---

## Quick Reference: Development Order Summary

1. **Data Layer**: PostgreSQL + Redis + AWS S3 (KMS encrypted) ✅ COMPLETE
2. **Processing Layer**: Flask Workers + Qwen3 OCR + S3 Integration ✅ COMPLETE
3. **Backend API**: Node.js REST API + WebSocket + S3 Upload/Download ⏳ NEXT
4. **Frontend**: Next.js Web Interface
5. **Admin UI**: Electron Desktop Application
6. **Reverse Proxy**: Nginx Configuration
7. **Integration Testing**: End-to-end validation
8. **Production Deployment**: Server setup and deployment
9. **Post-Deployment**: Monitoring, backups, optimization
10. **Iteration**: Continuous improvement and scaling

**Current Status**: Phases 1-2 complete with full S3 integration. All files stored in S3 with KMS encryption. Worker processes tasks by downloading from S3, running OCR, and uploading results back to S3. Database stores S3 paths (no local file storage).

Each phase should be completed and tested before moving to the next to ensure a stable, functional system at every stage.
