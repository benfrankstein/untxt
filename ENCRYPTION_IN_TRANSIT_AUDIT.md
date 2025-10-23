# Encryption in Transit Audit - HIPAA Compliance

## Executive Summary

This document audits all network communication in the UNTXT OCR Platform and identifies where encryption in transit must be implemented for HIPAA compliance.

**Status**: ⚠️ **PARTIAL COMPLIANCE** - Several critical connections require TLS/SSL encryption

---

## Network Communication Points

### ✅ 1. Client ↔ Backend API (HTTPS)
**Status**: IMPLEMENTED
**Protocol**: HTTPS with TLS 1.2+
**Implementation**: `backend/src/index.js`

**Configuration**:
```bash
SSL_ENABLED=true
SSL_KEY_PATH=/path/to/server.key
SSL_CERT_PATH=/path/to/server.cert
```

**HIPAA Compliance**: ✅ COMPLIANT (when SSL enabled)

---

### ✅ 2. Client ↔ Backend WebSocket (WSS)
**Status**: IMPLEMENTED
**Protocol**: WSS (WebSocket Secure) over TLS
**Implementation**: `backend/src/services/websocket.service.js`, `frontend/app.js`

**Features**:
- Automatic WSS when HTTPS is enabled
- Real-time encrypted updates
- Secure session management

**HIPAA Compliance**: ✅ COMPLIANT (when SSL enabled)

---

### ❌ 3. Backend ↔ Redis
**Status**: NOT ENCRYPTED
**Current Protocol**: Unencrypted TCP
**Risk Level**: 🔴 **HIGH** - PHI data passes through Redis queues

**Files Affected**:
- `backend/src/services/redis.service.js`
- `worker/redis_client.py`
- `worker/config.py`

**Data at Risk**:
- Task queue messages (contain file IDs, user IDs)
- Session data
- Real-time update notifications
- Task metadata

**HIPAA Compliance**: ❌ **NON-COMPLIANT**

**Recommended Fix**: Enable Redis TLS/SSL

---

### ❌ 4. Backend ↔ PostgreSQL
**Status**: NOT ENCRYPTED
**Current Protocol**: Unencrypted TCP (port 5432)
**Risk Level**: 🔴 **CRITICAL** - Database contains all PHI

**Files Affected**:
- `backend/src/services/db.service.js`
- `backend/src/services/db-listener.js`
- `worker/db_client.py`
- `worker/config.py`

**Data at Risk**:
- User credentials and PII
- Medical records/documents
- Audit logs
- Session tokens
- All PHI stored in database

**HIPAA Compliance**: ❌ **NON-COMPLIANT**

**Recommended Fix**: Enable PostgreSQL SSL/TLS

---

### ❌ 5. Worker ↔ Redis
**Status**: NOT ENCRYPTED
**Current Protocol**: Unencrypted TCP
**Risk Level**: 🔴 **HIGH**

**Files Affected**:
- `worker/redis_client.py`
- `worker/config.py`

**Data at Risk**:
- OCR task data
- Processing status updates
- Result notifications

**HIPAA Compliance**: ❌ **NON-COMPLIANT**

**Recommended Fix**: Enable Redis TLS/SSL

---

### ❌ 6. Worker ↔ PostgreSQL
**Status**: NOT ENCRYPTED
**Current Protocol**: Unencrypted TCP
**Risk Level**: 🔴 **CRITICAL**

**Files Affected**:
- `worker/db_client.py`
- `worker/config.py`

**Data at Risk**:
- Task records
- OCR results
- Extracted text (potentially PHI)
- Processing metadata

**HIPAA Compliance**: ❌ **NON-COMPLIANT**

**Recommended Fix**: Enable PostgreSQL SSL/TLS

---

### ✅ 7. Backend/Worker ↔ AWS S3
**Status**: ENCRYPTED BY DEFAULT
**Protocol**: HTTPS (TLS 1.2+)
**Implementation**: AWS SDK v3

**Files**:
- `backend/src/services/s3.service.js`
- `worker/s3_client.py`

**Features**:
- AWS SDK enforces HTTPS by default
- TLS 1.2+ encryption
- Server-side encryption (KMS)
- Pre-signed URLs use HTTPS

**HIPAA Compliance**: ✅ COMPLIANT

---

## Priority Action Items

### 🔴 CRITICAL (Must Fix Immediately)

#### 1. PostgreSQL SSL/TLS Encryption
**Impact**: Database contains all PHI - highest priority

**Implementation Required**:
1. Configure PostgreSQL to require SSL
2. Generate/obtain SSL certificates
3. Update all database clients (backend + worker)
4. Test connections

**Files to Update**:
- `database/postgresql.conf`
- `backend/src/services/db.service.js`
- `backend/src/services/db-listener.js`
- `backend/src/config/index.js`
- `worker/db_client.py`
- `worker/config.py`

---

#### 2. Redis TLS Encryption
**Impact**: PHI and session data in transit

**Implementation Required**:
1. Configure Redis to enable TLS
2. Generate/obtain TLS certificates
3. Update all Redis clients (backend + worker)
4. Test connections

**Files to Update**:
- `redis.conf` (if self-hosted)
- `backend/src/services/redis.service.js`
- `backend/src/config/index.js`
- `worker/redis_client.py`
- `worker/config.py`

---

## Detailed Implementation Plans

### PostgreSQL SSL/TLS Setup

#### Step 1: Configure PostgreSQL Server

```bash
# Generate self-signed certificates (development)
cd /var/lib/postgresql/data
openssl req -new -x509 -days 365 -nodes -text \
  -out server.crt \
  -keyout server.key \
  -subj "/CN=localhost"

chmod 600 server.key
chown postgres:postgres server.key server.crt
```

#### Step 2: Update postgresql.conf

```conf
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file = 'server.key'
ssl_prefer_server_ciphers = on
ssl_ciphers = 'HIGH:MEDIUM:+3DES:!aNULL'
ssl_min_protocol_version = 'TLSv1.2'
```

#### Step 3: Update pg_hba.conf

```conf
# TYPE  DATABASE        USER            ADDRESS                 METHOD
hostssl all             all             0.0.0.0/0               md5
hostssl all             all             ::/0                    md5
```

#### Step 4: Update Backend Configuration

**`backend/src/config/index.js`**:
```javascript
database: {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'ocr_platform_dev',
  user: process.env.DB_USER || 'ocr_platform_user',
  password: process.env.DB_PASSWORD || 'ocr_platform_pass_dev',
  ssl: process.env.DB_SSL_ENABLED === 'true' ? {
    rejectUnauthorized: process.env.NODE_ENV === 'production',
    ca: process.env.DB_SSL_CA_PATH ?
        require('fs').readFileSync(process.env.DB_SSL_CA_PATH).toString() : undefined
  } : false,
},
```

**`backend/src/services/db.service.js`**:
```javascript
this.pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  ssl: config.database.ssl, // Add this line
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

#### Step 5: Update Worker Configuration

**`worker/config.py`**:
```python
# Database Configuration
DB_SSL_ENABLED = os.getenv('DB_SSL_ENABLED', 'true').lower() == 'true'
DB_SSL_MODE = os.getenv('DB_SSL_MODE', 'require')  # disable, allow, prefer, require, verify-ca, verify-full
DB_SSL_ROOT_CERT = os.getenv('DB_SSL_ROOT_CERT', None)
```

**`worker/db_client.py`**:
```python
def connect(self):
    """Establish database connection with SSL"""
    try:
        conn_params = {
            'host': Config.DB_HOST,
            'port': Config.DB_PORT,
            'database': Config.DB_NAME,
            'user': Config.DB_USER,
            'password': Config.DB_PASSWORD,
        }

        # Add SSL configuration
        if Config.DB_SSL_ENABLED:
            conn_params['sslmode'] = Config.DB_SSL_MODE
            if Config.DB_SSL_ROOT_CERT:
                conn_params['sslrootcert'] = Config.DB_SSL_ROOT_CERT

        self.conn = psycopg2.connect(**conn_params)
        logger.info(f"Database connected with SSL: {Config.DB_SSL_ENABLED}")
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        raise
```

---

### Redis TLS Setup

#### Step 1: Configure Redis Server

**For Redis 6.0+** (`redis.conf`):
```conf
# Enable TLS
port 0
tls-port 6379
tls-cert-file /path/to/redis.crt
tls-key-file /path/to/redis.key
tls-ca-cert-file /path/to/ca.crt

# Require TLS
tls-auth-clients yes

# TLS protocols
tls-protocols "TLSv1.2 TLSv1.3"
tls-ciphers DEFAULT:!MEDIUM:!LOW:!aNULL:!eNULL
```

#### Step 2: Generate Certificates

```bash
# Generate CA
openssl genrsa -out ca-key.pem 4096
openssl req -new -x509 -days 3650 -key ca-key.pem -out ca-cert.pem

# Generate Redis server certificate
openssl genrsa -out redis-key.pem 4096
openssl req -new -key redis-key.pem -out redis.csr
openssl x509 -req -days 3650 -in redis.csr -CA ca-cert.pem \
  -CAkey ca-key.pem -set_serial 01 -out redis-cert.pem
```

#### Step 3: Update Backend Configuration

**`backend/src/config/index.js`**:
```javascript
redis: {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  db: parseInt(process.env.REDIS_DB) || 0,
  tls: process.env.REDIS_TLS_ENABLED === 'true' ? {
    rejectUnauthorized: process.env.NODE_ENV === 'production',
    ca: process.env.REDIS_TLS_CA_PATH ?
        require('fs').readFileSync(process.env.REDIS_TLS_CA_PATH) : undefined,
    cert: process.env.REDIS_TLS_CERT_PATH ?
        require('fs').readFileSync(process.env.REDIS_TLS_CERT_PATH) : undefined,
    key: process.env.REDIS_TLS_KEY_PATH ?
        require('fs').readFileSync(process.env.REDIS_TLS_KEY_PATH) : undefined,
  } : undefined,
},
```

**`backend/src/services/redis.service.js`**:
```javascript
this.client = redis.createClient({
  socket: {
    host: config.redis.host,
    port: config.redis.port,
    tls: config.redis.tls, // Add this line
  },
  database: config.redis.db,
});
```

#### Step 4: Update Worker Configuration

**`worker/config.py`**:
```python
# Redis TLS Configuration
REDIS_TLS_ENABLED = os.getenv('REDIS_TLS_ENABLED', 'true').lower() == 'true'
REDIS_TLS_CA_CERT = os.getenv('REDIS_TLS_CA_CERT', None)
REDIS_TLS_CERT = os.getenv('REDIS_TLS_CERT', None)
REDIS_TLS_KEY = os.getenv('REDIS_TLS_KEY', None)
```

**`worker/redis_client.py`**:
```python
def __init__(self):
    """Initialize Redis client with TLS"""
    connection_params = {
        'host': Config.REDIS_HOST,
        'port': Config.REDIS_PORT,
        'db': Config.REDIS_DB,
        'decode_responses': True
    }

    # Add TLS configuration
    if Config.REDIS_TLS_ENABLED:
        import ssl
        connection_params['ssl'] = True
        connection_params['ssl_cert_reqs'] = ssl.CERT_REQUIRED
        if Config.REDIS_TLS_CA_CERT:
            connection_params['ssl_ca_certs'] = Config.REDIS_TLS_CA_CERT
        if Config.REDIS_TLS_CERT:
            connection_params['ssl_certfile'] = Config.REDIS_TLS_CERT
        if Config.REDIS_TLS_KEY:
            connection_params['ssl_keyfile'] = Config.REDIS_TLS_KEY

    self.client = redis.Redis(**connection_params)
    logger.info(f"Redis client connected with TLS: {Config.REDIS_TLS_ENABLED}")
```

---

## Environment Variables Summary

### Backend `.env`

```bash
# HTTPS/WSS
SSL_ENABLED=true
SSL_KEY_PATH=./certs/server.key
SSL_CERT_PATH=./certs/server.cert

# PostgreSQL SSL
DB_SSL_ENABLED=true
DB_SSL_CA_PATH=./certs/postgres-ca.crt

# Redis TLS
REDIS_TLS_ENABLED=true
REDIS_TLS_CA_PATH=./certs/redis-ca.pem
```

### Worker `.env`

```bash
# PostgreSQL SSL
DB_SSL_ENABLED=true
DB_SSL_MODE=require
DB_SSL_ROOT_CERT=./certs/postgres-ca.crt

# Redis TLS
REDIS_TLS_ENABLED=true
REDIS_TLS_CA_CERT=./certs/redis-ca.pem
```

---

## Testing Encryption

### Test PostgreSQL SSL

```bash
# Verify SSL is required
psql "postgresql://user:pass@localhost:5432/dbname?sslmode=disable"
# Should fail if SSL is required

# Connect with SSL
psql "postgresql://user:pass@localhost:5432/dbname?sslmode=require"

# Check SSL status
psql -c "SELECT * FROM pg_stat_ssl WHERE pid = pg_backend_pid();"
```

### Test Redis TLS

```bash
# Test connection with TLS
redis-cli --tls \
  --cert ./certs/redis-cert.pem \
  --key ./certs/redis-key.pem \
  --cacert ./certs/ca-cert.pem \
  PING

# Should return PONG
```

---

## HIPAA Compliance Checklist

- [x] Client to Backend API (HTTPS)
- [x] Client to Backend WebSocket (WSS)
- [ ] Backend to Redis (TLS) - **REQUIRED**
- [ ] Backend to PostgreSQL (SSL) - **REQUIRED**
- [ ] Worker to Redis (TLS) - **REQUIRED**
- [ ] Worker to PostgreSQL (SSL) - **REQUIRED**
- [x] Backend/Worker to S3 (HTTPS)

**Current Compliance**: 3/7 connections encrypted (43%)
**Target Compliance**: 7/7 connections encrypted (100%)

---

## Additional Security Recommendations

1. **Network Segmentation**: Use VPC/private networks for internal communication
2. **Firewall Rules**: Restrict database/Redis access to application servers only
3. **Certificate Management**: Implement automated certificate rotation
4. **Monitoring**: Log all connection attempts and failed authentications
5. **Audit Trails**: Track all encryption configuration changes

---

## Production Deployment Notes

### AWS RDS PostgreSQL
- SSL is available by default
- Download RDS CA certificate
- Set `sslmode=verify-full` for production

### AWS ElastiCache Redis
- Use TLS-enabled ElastiCache clusters
- In-transit encryption available
- Auth tokens for authentication

### Managed Services
Both AWS RDS and ElastiCache provide built-in encryption in transit with minimal configuration required.

---

## Next Steps

1. ✅ Implement PostgreSQL SSL (Backend)
2. ✅ Implement PostgreSQL SSL (Worker)
3. ✅ Implement Redis TLS (Backend)
4. ✅ Implement Redis TLS (Worker)
5. ✅ Test all encrypted connections
6. ✅ Update documentation
7. ✅ Deploy to staging environment
8. ✅ Security audit
9. ✅ Deploy to production

---

## References

- [PostgreSQL SSL Documentation](https://www.postgresql.org/docs/current/ssl-tcp.html)
- [Redis TLS Documentation](https://redis.io/docs/manual/security/encryption/)
- [HIPAA Security Rule - Encryption Standards](https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html)
- [AWS RDS SSL/TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)
- [AWS ElastiCache Encryption in Transit](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/in-transit-encryption.html)
