# Redis TLS Setup Guide

This guide provides step-by-step instructions to enable TLS encryption for Redis connections in the UNTXT OCR Platform for HIPAA compliance.

## Overview

Redis TLS encrypts all data in transit between:
- Backend API ↔ Redis
- Worker Service ↔ Redis

This ensures that sensitive data (session tokens, task queues, PHI metadata) is encrypted during transmission.

---

## Quick Start

### Option 1: Development (Self-Signed Certificates)

For local development and testing:

```bash
# Create certificates directory
mkdir -p certs/redis

# Navigate to certs directory
cd certs/redis

# Generate CA certificate
openssl genrsa -out ca-key.pem 4096
openssl req -new -x509 -days 3650 -key ca-key.pem -out ca-cert.pem \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=Redis-CA"

# Generate Redis server certificate
openssl genrsa -out redis-server-key.pem 4096
openssl req -new -key redis-server-key.pem -out redis-server.csr \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Sign the server certificate with CA
openssl x509 -req -days 3650 -in redis-server.csr \
  -CA ca-cert.pem -CAkey ca-key.pem -set_serial 01 \
  -out redis-server-cert.pem

# Generate client certificate (optional - for mutual TLS)
openssl genrsa -out redis-client-key.pem 4096
openssl req -new -key redis-client-key.pem -out redis-client.csr \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=redis-client"

# Sign the client certificate with CA
openssl x509 -req -days 3650 -in redis-client.csr \
  -CA ca-cert.pem -CAkey ca-key.pem -set_serial 02 \
  -out redis-client-cert.pem

# Set proper permissions
chmod 600 *.key.pem
chmod 644 *.cert.pem ca-cert.pem

# Clean up CSR files
rm *.csr

echo "✓ Redis TLS certificates generated successfully"
```

### Option 2: Production (AWS ElastiCache)

AWS ElastiCache for Redis provides built-in TLS encryption:

1. Create Redis cluster with encryption in transit enabled
2. Download AWS ElastiCache CA certificate:
   ```bash
   wget https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
   ```
3. No additional certificates needed - AWS manages this

---

## Redis Server Configuration

### For Self-Hosted Redis (Redis 6.0+)

Edit your `redis.conf`:

```conf
################################## TLS/SSL #####################################

# Enable TLS on port 6379 (disable regular port)
port 0
tls-port 6379

# Server certificate and key
tls-cert-file /path/to/certs/redis/redis-server-cert.pem
tls-key-file /path/to/certs/redis/redis-server-key.pem

# CA certificate to verify clients (if using client certificates)
tls-ca-cert-file /path/to/certs/redis/ca-cert.pem

# Require clients to authenticate with certificates (optional)
# Set to 'no' to allow TLS without client certificates
# Set to 'yes' for mutual TLS authentication
tls-auth-clients no

# TLS protocols (TLS 1.2 and 1.3 only for HIPAA)
tls-protocols "TLSv1.2 TLSv1.3"

# Strong cipher suites (HIPAA compliant)
tls-ciphers DEFAULT:!MEDIUM:!LOW:!aNULL:!eNULL
tls-ciphersuites TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256

# Prefer server ciphers
tls-prefer-server-ciphers yes

# DH parameters for additional security (optional)
# openssl dhparam -out /path/to/dh2048.pem 2048
# tls-dh-params-file /path/to/dh2048.pem

################################################################################
```

### Start Redis with TLS

```bash
# Using redis.conf
redis-server /path/to/redis.conf

# Or with command-line arguments
redis-server \
  --port 0 \
  --tls-port 6379 \
  --tls-cert-file /path/to/certs/redis/redis-server-cert.pem \
  --tls-key-file /path/to/certs/redis/redis-server-key.pem \
  --tls-ca-cert-file /path/to/certs/redis/ca-cert.pem \
  --tls-auth-clients no
```

### Verify Redis TLS

```bash
# Test TLS connection
redis-cli --tls \
  --cert /path/to/certs/redis/redis-client-cert.pem \
  --key /path/to/certs/redis/redis-client-key.pem \
  --cacert /path/to/certs/redis/ca-cert.pem \
  PING

# Should return: PONG

# Check TLS info
redis-cli --tls \
  --cacert /path/to/certs/redis/ca-cert.pem \
  INFO server | grep ssl
```

---

## Application Configuration

### Backend Configuration

Create or update `backend/.env`:

```bash
# Redis TLS Configuration
REDIS_TLS_ENABLED=true
REDIS_TLS_CA_PATH=/absolute/path/to/certs/redis/ca-cert.pem

# Optional: Client certificates for mutual TLS
# REDIS_TLS_CERT_PATH=/absolute/path/to/certs/redis/redis-client-cert.pem
# REDIS_TLS_KEY_PATH=/absolute/path/to/certs/redis/redis-client-key.pem

# For AWS ElastiCache
# REDIS_HOST=your-cluster.cache.amazonaws.com
# REDIS_PORT=6379
# REDIS_TLS_ENABLED=true
# REDIS_TLS_CA_PATH=/path/to/global-bundle.pem
```

### Worker Configuration

Create or update `worker/.env`:

```bash
# Redis TLS Configuration
REDIS_TLS_ENABLED=true
REDIS_TLS_CA_CERT=/absolute/path/to/certs/redis/ca-cert.pem
REDIS_TLS_VERIFY=true

# Optional: Client certificates for mutual TLS
# REDIS_TLS_CERT=/absolute/path/to/certs/redis/redis-client-cert.pem
# REDIS_TLS_KEY=/absolute/path/to/certs/redis/redis-client-key.pem

# For development with self-signed certs, you can disable verification
# REDIS_TLS_VERIFY=false

# For AWS ElastiCache
# REDIS_HOST=your-cluster.cache.amazonaws.com
# REDIS_PORT=6379
# REDIS_TLS_ENABLED=true
# REDIS_TLS_CA_CERT=/path/to/global-bundle.pem
```

---

## Testing TLS Connection

### Test Backend Connection

```bash
# Start backend
cd backend
npm start

# Look for these log messages:
# ✓ Loaded Redis TLS CA certificate
# ✓ Redis TLS enabled (HIPAA compliant)
# Redis connected with TLS
```

### Test Worker Connection

```bash
# Start worker
cd worker
python run_worker.py

# Look for these log messages:
# ✓ Loaded Redis TLS CA certificate
# ✓ Redis TLS enabled (HIPAA compliant)
# Redis client connected to localhost:6379 with TLS
```

### Verify Encryption

Use network monitoring to verify TLS:

```bash
# Monitor Redis traffic (should be encrypted)
sudo tcpdump -i lo0 -A -s 0 'port 6379'

# Before TLS: You'll see readable commands (PING, GET, SET, etc.)
# After TLS: You'll see encrypted gibberish
```

---

## Docker Configuration

### docker-compose.yml Example

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - ./certs/redis:/certs/redis:ro
    command: >
      redis-server
      --port 0
      --tls-port 6379
      --tls-cert-file /certs/redis/redis-server-cert.pem
      --tls-key-file /certs/redis/redis-server-key.pem
      --tls-ca-cert-file /certs/redis/ca-cert.pem
      --tls-auth-clients no
      --tls-protocols "TLSv1.2 TLSv1.3"

  backend:
    build: ./backend
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - REDIS_TLS_ENABLED=true
      - REDIS_TLS_CA_PATH=/certs/redis/ca-cert.pem
    volumes:
      - ./certs/redis:/certs/redis:ro

  worker:
    build: ./worker
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - REDIS_TLS_ENABLED=true
      - REDIS_TLS_CA_CERT=/certs/redis/ca-cert.pem
    volumes:
      - ./certs/redis:/certs/redis:ro
```

---

## AWS ElastiCache Configuration

### Create TLS-Enabled Cluster

**Using AWS Console:**

1. Go to ElastiCache → Create Redis cluster
2. Enable "Encryption in-transit"
3. Choose "Redis AUTH token" for additional security
4. Note the cluster endpoint

**Using AWS CLI:**

```bash
aws elasticache create-replication-group \
  --replication-group-id untxt-redis \
  --replication-group-description "UNTXT Redis Cluster" \
  --engine redis \
  --cache-node-type cache.t3.medium \
  --num-cache-clusters 2 \
  --transit-encryption-enabled \
  --auth-token "YourSecureToken123!" \
  --at-rest-encryption-enabled
```

### Configure Application for ElastiCache

**Backend `.env`:**

```bash
REDIS_HOST=untxt-redis.xxxxxx.use1.cache.amazonaws.com
REDIS_PORT=6379
REDIS_TLS_ENABLED=true
REDIS_TLS_CA_PATH=/path/to/global-bundle.pem
```

**Worker `.env`:**

```bash
REDIS_HOST=untxt-redis.xxxxxx.use1.cache.amazonaws.com
REDIS_PORT=6379
REDIS_TLS_ENABLED=true
REDIS_TLS_CA_CERT=/path/to/global-bundle.pem
REDIS_TLS_VERIFY=true
```

### Download ElastiCache CA Bundle

```bash
wget https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -O /path/to/certs/global-bundle.pem
```

---

## Troubleshooting

### Error: "Connection refused"

**Cause:** Redis not listening on TLS port

**Solution:**
```bash
# Check Redis is running on TLS port
redis-cli --tls --cacert /path/to/ca-cert.pem PING

# Verify port configuration
netstat -an | grep 6379
```

### Error: "SSL certificate verify failed"

**Cause:** CA certificate not found or invalid

**Solution:**
```bash
# Verify CA certificate path
ls -la /path/to/ca-cert.pem

# Check certificate validity
openssl x509 -in /path/to/ca-cert.pem -text -noout
```

### Error: "NOAUTH Authentication required"

**Cause:** Redis requires password but none provided

**Solution:**
```bash
# For self-hosted Redis, set requirepass in redis.conf
requirepass YourSecurePassword

# Update environment variables
REDIS_PASSWORD=YourSecurePassword
```

### Warning: "TLS disabled - NOT HIPAA compliant"

**Cause:** REDIS_TLS_ENABLED not set to 'true'

**Solution:**
```bash
# Ensure environment variable is set correctly
echo "REDIS_TLS_ENABLED=true" >> .env
```

### Development: Self-Signed Certificate Warnings

For development with self-signed certificates:

**Backend:** Set `NODE_ENV=development` (already configured to skip verification)

**Worker:** Set `REDIS_TLS_VERIFY=false` in development only

**⚠️ NEVER use `REDIS_TLS_VERIFY=false` in production!**

---

## Security Best Practices

### Certificate Management

1. **Rotate certificates regularly** (every 90 days recommended)
2. **Use strong keys** (RSA 4096-bit or ECC 256-bit minimum)
3. **Store private keys securely** (chmod 600, encrypted volumes)
4. **Never commit certificates** to version control

Add to `.gitignore`:
```
certs/
*.pem
*.key
*.crt
*.csr
```

### TLS Configuration

1. **Use TLS 1.2 or 1.3 only** (disable older versions)
2. **Use strong cipher suites** (AES-256, ChaCha20)
3. **Require certificate verification** in production
4. **Enable mutual TLS** for maximum security (optional)

### Monitoring

Monitor Redis TLS connections:

```bash
# Check active TLS connections
redis-cli --tls --cacert /path/to/ca-cert.pem CLIENT LIST | grep ssl

# Monitor for connection errors
tail -f /var/log/redis/redis-server.log | grep -i "ssl\|tls"
```

---

## Performance Considerations

### TLS Overhead

- TLS adds ~5-10% latency for small operations
- Use connection pooling to minimize handshake overhead
- Consider Redis cluster for high-throughput applications

### Optimizations

1. **Enable TCP keepalive** to reduce reconnections
2. **Use pipelining** for batch operations
3. **Monitor connection pool** sizes

---

## Compliance Checklist

- [ ] TLS 1.2 or higher enabled
- [ ] Strong cipher suites configured
- [ ] Certificates from trusted CA (production)
- [ ] Certificate expiration monitoring in place
- [ ] Backend TLS enabled and tested
- [ ] Worker TLS enabled and tested
- [ ] Connection verification enabled (production)
- [ ] Private keys secured (chmod 600)
- [ ] Certificates excluded from version control
- [ ] Regular certificate rotation scheduled
- [ ] TLS connection monitoring active
- [ ] Audit logs enabled for Redis access

---

## Additional Resources

- [Redis TLS Documentation](https://redis.io/docs/manual/security/encryption/)
- [Redis Security Best Practices](https://redis.io/docs/manual/security/)
- [AWS ElastiCache Encryption](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/in-transit-encryption.html)
- [HIPAA Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/index.html)
- [OpenSSL Documentation](https://www.openssl.org/docs/)

---

## Support

For issues:
1. Check Redis logs: `/var/log/redis/redis-server.log`
2. Verify certificates: `openssl verify -CAfile ca-cert.pem redis-server-cert.pem`
3. Test connection: `redis-cli --tls --cacert ca-cert.pem PING`
4. Review application logs for TLS errors
