# SSL/TLS Setup Guide for HIPAA Compliance

This guide explains how to configure SSL/TLS certificates to enable HTTPS and WSS (WebSocket Secure) for HIPAA-compliant secure communication.

## Overview

For HIPAA compliance, all data transmission must be encrypted. This application supports:
- **HTTPS** for API requests
- **WSS** (WebSocket Secure) for real-time updates
- **TLS 1.2 or higher** encryption standards

## Quick Start

### Development (Self-Signed Certificates)

For local development and testing, you can use self-signed certificates:

```bash
# Create certificates directory
mkdir -p backend/certs

# Generate self-signed certificate (valid for 365 days)
openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout backend/certs/server.key \
  -out backend/certs/server.cert \
  -days 365 \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
```

### Production (Trusted SSL Certificates)

For production environments, use certificates from a trusted Certificate Authority (CA):

#### Option 1: Let's Encrypt (Free, Recommended)

```bash
# Install certbot
sudo apt-get update
sudo apt-get install certbot

# Generate certificate for your domain
sudo certbot certonly --standalone -d yourdomain.com

# Certificates will be created at:
# /etc/letsencrypt/live/yourdomain.com/privkey.pem  (private key)
# /etc/letsencrypt/live/yourdomain.com/fullchain.pem (certificate + chain)
```

#### Option 2: Commercial SSL Certificate

Purchase from providers like:
- DigiCert
- Comodo
- GoDaddy
- GlobalSign

Follow their instructions to generate a Certificate Signing Request (CSR) and install the certificates.

## Configuration

### 1. Environment Variables

Create or update your `.env` file in the `backend` directory:

```bash
# SSL/TLS Configuration
SSL_ENABLED=true
SSL_KEY_PATH=/path/to/your/server.key
SSL_CERT_PATH=/path/to/your/server.cert
SSL_CA_PATH=/path/to/your/ca-bundle.crt  # Optional: CA certificate bundle

# For Let's Encrypt
# SSL_KEY_PATH=/etc/letsencrypt/live/yourdomain.com/privkey.pem
# SSL_CERT_PATH=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
```

### 2. Development Mode (HTTP/WS)

For local development without SSL:

```bash
# In backend/.env
SSL_ENABLED=false
```

**⚠️ WARNING:** This mode is NOT HIPAA compliant and should ONLY be used for local development.

### 3. Frontend Configuration

The frontend automatically detects and uses the appropriate protocol:

- When served over HTTPS, it automatically uses HTTPS/WSS
- When served over HTTP (development), it uses HTTP/WS
- You can force secure mode by setting: `localStorage.setItem('forceSecure', 'true')`

## Certificate Requirements for HIPAA Compliance

### Minimum Standards

1. **Key Size**: RSA 2048-bit or higher (4096-bit recommended)
2. **Algorithm**: RSA or ECC (Elliptic Curve)
3. **Protocol**: TLS 1.2 or TLS 1.3
4. **Cipher Suites**: Strong ciphers only (AES-256, SHA-256 or higher)

### Certificate Validation

Ensure your certificates:
- Are issued by a trusted CA (for production)
- Are not expired
- Match your domain name
- Include the full certificate chain

## Testing SSL Configuration

### 1. Test Backend Server

```bash
# Start the backend server
cd backend
npm start

# You should see:
# ✓ SSL/TLS enabled - Running in secure mode (HIPAA compliant)
# Protocol: HTTPS/WSS
# HIPAA Mode: YES ✓
```

### 2. Test HTTPS Connection

```bash
# Test the health endpoint
curl -k https://localhost:8080/health

# For production (without -k flag for certificate validation)
curl https://yourdomain.com/health
```

### 3. Test WSS Connection

Use a WebSocket test client:

```javascript
// In browser console
const ws = new WebSocket('wss://localhost:8080?userId=test-user');
ws.onopen = () => console.log('✓ WSS connection established');
ws.onerror = (err) => console.error('✗ WSS connection failed:', err);
```

## Certificate Renewal

### Let's Encrypt (Automatic)

Let's Encrypt certificates expire after 90 days. Set up automatic renewal:

```bash
# Test renewal
sudo certbot renew --dry-run

# Set up automatic renewal (cron job)
sudo crontab -e

# Add this line to renew twice daily
0 0,12 * * * certbot renew --quiet --post-hook "systemctl restart your-app-service"
```

### Commercial Certificates

- Monitor expiration dates
- Renew 30 days before expiration
- Update certificate files and restart the server

## Production Deployment Checklist

- [ ] SSL certificates are from a trusted CA
- [ ] Certificates are valid and not expired
- [ ] `SSL_ENABLED=true` in production `.env`
- [ ] TLS 1.2 or higher is enforced
- [ ] Certificate files have proper permissions (600 for keys, 644 for certs)
- [ ] Firewall allows HTTPS (443) and WSS traffic
- [ ] Regular certificate renewal is configured
- [ ] All HTTP traffic redirects to HTTPS
- [ ] HSTS header is enabled (Strict-Transport-Security)

## Troubleshooting

### "Failed to load SSL certificates"

**Cause**: Certificate files not found or incorrect permissions

**Solution**:
```bash
# Check file paths
ls -la /path/to/certificates/

# Fix permissions
chmod 600 backend/certs/server.key
chmod 644 backend/certs/server.cert
```

### "Certificate not trusted" in browser

**Cause**: Self-signed certificate or missing CA certificate

**Solution**:
- For development: Accept the certificate warning in browser
- For production: Use certificates from a trusted CA
- Add CA bundle if using intermediate certificates

### "WebSocket connection failed"

**Cause**: Mixed content (HTTPS page trying to connect to WS instead of WSS)

**Solution**:
- Ensure frontend is served over HTTPS
- Check browser console for mixed content warnings
- Verify `WS_PROTOCOL` is set to `wss` in frontend

### Port 443 already in use

**Cause**: Another service is using the HTTPS port

**Solution**:
```bash
# Check what's using port 443
sudo lsof -i :443

# Either stop the conflicting service or use a different port
# Update .env: PORT=8443
```

## Security Best Practices

1. **Never commit private keys** to version control
   - Add `*.key` and `*.pem` to `.gitignore`

2. **Restrict file permissions**
   ```bash
   chmod 600 *.key    # Private keys: owner read/write only
   chmod 644 *.cert   # Certificates: world readable
   ```

3. **Use strong encryption**
   - Minimum RSA 2048-bit keys
   - Prefer RSA 4096-bit or ECC for higher security

4. **Keep certificates updated**
   - Monitor expiration dates
   - Set up automatic renewal

5. **Disable older TLS versions**
   - Use TLS 1.2 or 1.3 only
   - Disable SSL 2.0, SSL 3.0, TLS 1.0, TLS 1.1

6. **Enable HSTS** (HTTP Strict Transport Security)
   - Force browsers to use HTTPS
   - Prevent protocol downgrade attacks

## Additional Resources

- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [HIPAA Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/index.html)
- [NIST TLS Guidelines](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-52r2.pdf)
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/)

## Support

For issues or questions:
1. Check server logs for detailed error messages
2. Verify certificate paths and permissions
3. Test with `openssl s_client -connect localhost:8080`
4. Review HIPAA compliance requirements for your use case
