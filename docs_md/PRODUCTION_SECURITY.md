# Production Security Guide

## Table of Contents
1. [Credential Management](#credential-management)
2. [Environment Variables](#environment-variables)
3. [KMS Encryption Details](#kms-encryption-details)
4. [Deployment Options](#deployment-options)
5. [Security Checklist](#security-checklist)

---

## Credential Management

### **Option 1: IAM Roles (RECOMMENDED for AWS deployments)**

If deploying to AWS (EC2, ECS, Lambda, etc.):

**Architecture:**
```
Your Application (EC2/ECS)
    ↓
IAM Role attached to instance
    ↓
AWS automatically provides temporary credentials
    ↓
No need to store access keys!
```

**Benefits:**
- ✅ No credentials in code or config files
- ✅ Automatic credential rotation (every 15 minutes)
- ✅ Credentials never leave AWS infrastructure
- ✅ Per-environment isolation (dev/staging/prod have different roles)

**Setup:**

1. **Create IAM Role** (one-time setup):
```bash
# Create role with trust policy for EC2
aws iam create-role \
  --role-name untxt-worker-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ec2.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# Attach your existing IAM policy
aws iam attach-role-policy \
  --role-name untxt-worker-role \
  --policy-arn arn:aws:iam::543138172622:policy/untxt-s3-kms-policy

# Create instance profile
aws iam create-instance-profile \
  --instance-profile-name untxt-worker-profile

aws iam add-role-to-instance-profile \
  --instance-profile-name untxt-worker-profile \
  --role-name untxt-worker-role
```

2. **Attach to EC2 Instance**:
```bash
# When launching EC2
aws ec2 run-instances \
  --iam-instance-profile Name=untxt-worker-profile \
  ...
```

3. **Update Application Code** (no changes needed!):
```python
# boto3 automatically uses IAM role credentials
s3 = boto3.client('s3', region_name='us-east-1')
# No access keys needed!
```

4. **Environment Variables** (NO SECRETS):
```bash
# /etc/environment or systemd service file
AWS_REGION=us-east-1
S3_BUCKET_NAME=untxt
KMS_KEY_ID=arn:aws:kms:us-east-1:543138172622:key/e608ce2c-663a-434a-8e53-7b64de041015

# Note: NO AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY needed!
```

---

### **Option 2: AWS Secrets Manager (RECOMMENDED for non-AWS servers)**

If deploying to your own server (not AWS):

**Architecture:**
```
Your Server
    ↓
Application reads secret ARN from env var
    ↓
Fetches credentials from Secrets Manager (encrypted in transit)
    ↓
Credentials cached locally (memory only)
    ↓
Auto-refresh before expiration
```

**Setup:**

1. **Store Credentials in Secrets Manager**:
```bash
aws secretsmanager create-secret \
  --name untxt/production/aws-credentials \
  --description "AWS credentials for untxt worker" \
  --secret-string '{
    "AWS_ACCESS_KEY_ID": "YOUR_AWS_ACCESS_KEY_ID_HERE",
    "AWS_SECRET_ACCESS_KEY": "YOUR_AWS_SECRET_ACCESS_KEY_HERE"
  }'
```

2. **Environment Variables** (only reference, no secrets):
```bash
AWS_REGION=us-east-1
S3_BUCKET_NAME=untxt
KMS_KEY_ID=arn:aws:kms:us-east-1:543138172622:key/e608ce2c-663a-434a-8e53-7b64de041015
AWS_SECRET_ARN=arn:aws:secretsmanager:us-east-1:543138172622:secret:untxt/production/aws-credentials
```

3. **Update Code to Fetch Secrets**:

Create `worker/secrets_manager.py`:
```python
import boto3
import json
import os
from botocore.exceptions import ClientError

def get_aws_credentials():
    """Fetch AWS credentials from Secrets Manager"""
    secret_arn = os.getenv('AWS_SECRET_ARN')

    if not secret_arn:
        # Development mode - use environment variables
        return {
            'aws_access_key_id': os.getenv('AWS_ACCESS_KEY_ID'),
            'aws_secret_access_key': os.getenv('AWS_SECRET_ACCESS_KEY')
        }

    # Production mode - fetch from Secrets Manager
    session = boto3.session.Session()
    client = session.client(
        service_name='secretsmanager',
        region_name=os.getenv('AWS_REGION')
    )

    try:
        response = client.get_secret_value(SecretId=secret_arn)
        secret = json.loads(response['SecretString'])
        return {
            'aws_access_key_id': secret['AWS_ACCESS_KEY_ID'],
            'aws_secret_access_key': secret['AWS_SECRET_ACCESS_KEY']
        }
    except ClientError as e:
        raise Exception(f"Failed to retrieve secrets: {e}")
```

Update `worker/s3_client.py`:
```python
from secrets_manager import get_aws_credentials

class S3Client:
    def __init__(self):
        self.bucket_name = os.getenv('S3_BUCKET_NAME')
        self.kms_key_id = os.getenv('KMS_KEY_ID')
        self.region = os.getenv('AWS_REGION', 'us-east-1')

        # Get credentials (from Secrets Manager or env vars)
        creds = get_aws_credentials()

        self.s3 = boto3.client(
            's3',
            region_name=self.region,
            **creds  # aws_access_key_id and aws_secret_access_key
        )
```

**Cost**: ~$0.40/month (for 1 secret + ~10K API calls)

---

### **Option 3: System Environment Variables (BASIC)**

For small deployments or development:

1. **Set in systemd service file**:
```ini
# /etc/systemd/system/untxt-worker.service
[Service]
Environment="AWS_REGION=us-east-1"
Environment="S3_BUCKET_NAME=untxt"
Environment="KMS_KEY_ID=arn:aws:kms:us-east-1:543138172622:key/..."
Environment="AWS_ACCESS_KEY_ID=YOUR_KEY_HERE"
Environment="AWS_SECRET_ACCESS_KEY=YOUR_SECRET_HERE"

ExecStart=/usr/bin/python3 /opt/untxt/worker/run_worker.py
```

2. **Or use /etc/environment** (system-wide):
```bash
# /etc/environment
AWS_REGION=us-east-1
S3_BUCKET_NAME=untxt
AWS_ACCESS_KEY_ID=YOUR_KEY_HERE
AWS_SECRET_ACCESS_KEY=YOUR_SECRET_HERE
```

⚠️ **Security Concerns**:
- File permissions must be strict: `chmod 600`
- Anyone with root access can read
- Harder to audit access
- Manual rotation required

---

## Environment Variables

### **Safe to Store Publicly** (not secrets):
```bash
# Configuration (can be in git, docker-compose, etc.)
AWS_REGION=us-east-1
S3_BUCKET_NAME=untxt
KMS_KEY_ID=arn:aws:kms:us-east-1:543138172622:key/e608ce2c-663a-434a-8e53-7b64de041015
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ocr_platform_prod
REDIS_HOST=localhost
REDIS_PORT=6379
```

**Why these are safe:**
- KMS Key ARN is not sensitive (access controlled by IAM policies, not knowledge of ARN)
- S3 bucket name is public anyway
- Region/database names are just identifiers

### **MUST Keep Secret** (never in git):
```bash
# Secrets (use IAM roles, Secrets Manager, or secure env vars)
AWS_ACCESS_KEY_ID=YOUR_KEY_HERE
AWS_SECRET_ACCESS_KEY=YOUR_SECRET_HERE
DB_USER=ocr_platform_user
DB_PASSWORD=ocr_platform_pass_prod
```

---

## KMS Encryption Details

### **How Your KMS Key Works:**

**Key Hierarchy:**
```
KMS Master Key (never leaves AWS HSM)
  arn:aws:kms:us-east-1:543138172622:key/e608ce2c-663a-434a-8e53-7b64de041015
  ↓
Data Encryption Keys (DEK) - unique per file
  ↓
Your Encrypted Files in S3
```

### **Key Policies:**

Your KMS key has policies that control who can:
- **Encrypt**: Create new encrypted objects
- **Decrypt**: Read encrypted objects
- **Manage**: Modify key policies, schedule deletion

**Check your KMS key policy:**
```bash
aws kms get-key-policy \
  --key-id e608ce2c-663a-434a-8e53-7b64de041015 \
  --policy-name default
```

**Best Practice Key Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Enable IAM policies",
      "Effect": "Allow",
      "Principal": {"AWS": "arn:aws:iam::543138172622:root"},
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "Allow untxt worker to encrypt/decrypt",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::543138172622:user/untxt"
      },
      "Action": [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey",
        "kms:DescribeKey"
      ],
      "Resource": "*"
    }
  ]
}
```

### **Encryption Metadata:**

Every file in S3 stores:
```json
{
  "x-amz-server-side-encryption": "aws:kms",
  "x-amz-server-side-encryption-aws-kms-key-id": "arn:aws:kms:us-east-1:543138172622:key/...",
  "x-amz-server-side-encryption-bucket-key-enabled": "true"
}
```

### **Bucket Keys Feature** (ENABLED):
- Reduces KMS API calls by 99%
- S3 bucket maintains a key for ~5 hours
- Uses this bucket key to generate DEKs locally
- Cost: ~$0.03/month instead of ~$3/month

---

## Deployment Options

### **Recommended: AWS EC2 with IAM Role**

**Architecture:**
```
EC2 Instance (t3.medium or t3a.medium)
├── IAM Role: untxt-worker-role
├── Security Group: Allow only necessary ports
├── OS: Ubuntu 22.04 LTS
├── Python 3.9+ (via venv)
├── PostgreSQL (RDS or self-hosted)
├── Redis (ElastiCache or self-hosted)
└── Worker Process (systemd service)
```

**Deployment Steps:**

1. **Launch EC2 with IAM Role**:
```bash
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t3.medium \
  --iam-instance-profile Name=untxt-worker-profile \
  --security-group-ids sg-xxx \
  --subnet-id subnet-xxx \
  --key-name your-key-pair \
  --user-data file://setup-script.sh
```

2. **Setup Script** (`setup-script.sh`):
```bash
#!/bin/bash
set -e

# Install dependencies
apt-get update
apt-get install -y python3.9 python3-pip postgresql-client redis-tools

# Create app directory
mkdir -p /opt/untxt
cd /opt/untxt

# Clone repo (or copy files)
# git clone https://github.com/yourorg/untxt.git .

# Create virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r worker/requirements.txt

# Set environment variables (NO SECRETS - using IAM role)
cat > /etc/environment << EOF
AWS_REGION=us-east-1
S3_BUCKET_NAME=untxt
KMS_KEY_ID=arn:aws:kms:us-east-1:543138172622:key/e608ce2c-663a-434a-8e53-7b64de041015
DB_HOST=your-rds-endpoint.rds.amazonaws.com
DB_NAME=ocr_platform_prod
DB_USER=ocr_platform_user
DB_PASSWORD=<from-secrets-manager>
REDIS_HOST=your-elasticache-endpoint.cache.amazonaws.com
EOF

# Create systemd service
cat > /etc/systemd/system/untxt-worker.service << EOF
[Unit]
Description=Untxt OCR Worker
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/untxt/worker
EnvironmentFile=/etc/environment
ExecStart=/opt/untxt/venv/bin/python3 run_worker.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Start service
systemctl daemon-reload
systemctl enable untxt-worker
systemctl start untxt-worker
```

3. **Verify Deployment**:
```bash
# Check IAM role is attached
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/

# Test S3 access (should work without access keys!)
aws s3 ls s3://untxt/

# Check worker logs
journalctl -u untxt-worker -f
```

---

### **Alternative: Docker Container**

**Dockerfile:**
```dockerfile
FROM python:3.9-slim

WORKDIR /app

# Install dependencies
COPY worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY worker/ .

# Non-root user
RUN useradd -m -u 1000 worker && chown -R worker:worker /app
USER worker

# Run worker
CMD ["python", "run_worker.py"]
```

**docker-compose.yml** (production):
```yaml
version: '3.8'

services:
  worker:
    build: .
    environment:
      - AWS_REGION=us-east-1
      - S3_BUCKET_NAME=untxt
      - KMS_KEY_ID=arn:aws:kms:us-east-1:543138172622:key/...
      # Credentials from Secrets Manager or IAM role
      - AWS_SECRET_ARN=arn:aws:secretsmanager:...
      - DB_HOST=postgres
      - REDIS_HOST=redis
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  postgres:
    image: postgres:16
    environment:
      - POSTGRES_DB=ocr_platform_prod
      - POSTGRES_USER=ocr_platform_user
      - POSTGRES_PASSWORD_FILE=/run/secrets/db_password
    secrets:
      - db_password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: unless-stopped

secrets:
  db_password:
    external: true

volumes:
  postgres_data:
```

---

## Security Checklist

### **Before Production:**

- [ ] **Remove .env file** from production server
- [ ] **Add .env to .gitignore** (verify it's never committed)
- [ ] **Rotate access keys** (the ones in this doc are compromised)
- [ ] **Use IAM roles** (if on AWS) or Secrets Manager (if not)
- [ ] **Enable CloudTrail** for KMS key usage audit logs
- [ ] **Set up KMS key rotation** (automatic annual rotation)
- [ ] **Restrict KMS key policy** to only untxt IAM user/role
- [ ] **Enable S3 bucket versioning** (recover from accidental deletions)
- [ ] **Enable S3 access logging** (audit all S3 operations)
- [ ] **Set up alerts** for failed KMS decrypt attempts
- [ ] **Use separate AWS accounts** for dev/staging/prod (optional but recommended)
- [ ] **Implement least-privilege IAM policies** (current policy is good)
- [ ] **Set up backup/disaster recovery** for RDS and S3
- [ ] **Enable MFA** on AWS root account
- [ ] **Use AWS Organizations** for multi-account management (optional)

### **Regular Maintenance:**

- [ ] **Rotate access keys every 90 days** (if not using IAM roles)
- [ ] **Review CloudTrail logs monthly** for suspicious activity
- [ ] **Update dependencies** (pip, OS packages)
- [ ] **Test backup restoration** quarterly
- [ ] **Review IAM policies** for least privilege
- [ ] **Audit S3 bucket permissions** (ensure not public)

---

## Summary

### **Recommended Production Setup:**

| Component | Recommended Solution | Why |
|-----------|---------------------|-----|
| **AWS Credentials** | IAM Roles (if AWS) or Secrets Manager | No plaintext secrets, automatic rotation |
| **Config Values** | System environment variables | Safe to store, not sensitive |
| **KMS Key** | Customer-managed key with Bucket Keys | HIPAA compliance, audit trail, cost-effective |
| **Database Credentials** | Secrets Manager or RDS IAM auth | Secure, rotatable |
| **Deployment** | EC2 with systemd or ECS Fargate | Scalable, manageable |

### **Environment Variables in Production:**

**In systemd service file or /etc/environment:**
```bash
# Configuration (NOT secrets)
AWS_REGION=us-east-1
S3_BUCKET_NAME=untxt
KMS_KEY_ID=arn:aws:kms:us-east-1:543138172622:key/e608ce2c-663a-434a-8e53-7b64de041015

# For Secrets Manager approach:
AWS_SECRET_ARN=arn:aws:secretsmanager:us-east-1:543138172622:secret:untxt/prod/credentials

# For IAM role approach:
# (no credentials needed - automatically provided!)
```

**Never store in environment variables:**
- AWS_ACCESS_KEY_ID (use IAM role or Secrets Manager)
- AWS_SECRET_ACCESS_KEY (use IAM role or Secrets Manager)

---

## Questions?

Common questions about this setup:

**Q: Can someone steal my data if they know the KMS key ARN?**
A: No. The ARN is just an identifier. Access is controlled by IAM policies. They'd need valid AWS credentials with kms:Decrypt permissions.

**Q: How much does this cost?**
A: ~$1/month for KMS key + $0.40/month for Secrets Manager (if used) + S3 storage costs (~$0.023/GB).

**Q: What happens if AWS is down?**
A: S3 has 99.99% uptime. For critical apps, implement S3 transfer acceleration and multi-region replication.

**Q: Can I use the same credentials for dev and prod?**
A: No! Create separate IAM users/roles for each environment with different permissions.

**Q: What if my access keys are compromised?**
A: Immediately delete them in IAM console, create new ones, update Secrets Manager. CloudTrail will show unauthorized usage.
