# AWS S3 HIPAA-Compliant Setup Guide

Complete step-by-step guide to create a secure, HIPAA-compliant S3 bucket for OCR file storage.

## Prerequisites

- AWS Account with administrative access
- AWS CLI installed and configured
- Business Associate Agreement (BAA) signed with AWS

---

## Part 1: Sign Business Associate Agreement (BAA)

**CRITICAL:** You MUST have a BAA with AWS to be HIPAA compliant.

### Steps:

1. Log into AWS Console
2. Go to: **AWS Artifact** (search in top search bar)
3. Click: **Agreements** → **AWS Business Associate Addendum (BAA)**
4. Review and **Accept** the BAA
5. Download a copy for your records

**Note:** Without a BAA, you CANNOT claim HIPAA compliance, regardless of technical controls.

---

## Part 2: Create IAM User for Application

### 1. Create Dedicated IAM User

```bash
# Via AWS Console:
```

1. Go to **IAM** → **Users** → **Create user**
2. Username: `ocr-platform-app`
3. **DO NOT** enable console access
4. Click **Next**

### 2. Create Custom Policy

1. In permissions, select **Attach policies directly**
2. Click **Create policy**
3. Use JSON editor:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "ListBucket",
            "Effect": "Allow",
            "Action": [
                "s3:ListBucket",
                "s3:GetBucketLocation"
            ],
            "Resource": "arn:aws:s3:::ocr-platform-files-YOUR-UNIQUE-ID"
        },
        {
            "Sid": "ObjectOperations",
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject",
                "s3:PutObjectAcl"
            ],
            "Resource": "arn:aws:s3:::ocr-platform-files-YOUR-UNIQUE-ID/*"
        },
        {
            "Sid": "EncryptionOperations",
            "Effect": "Allow",
            "Action": [
                "kms:Decrypt",
                "kms:Encrypt",
                "kms:GenerateDataKey"
            ],
            "Resource": "arn:aws:kms:us-east-1:YOUR-ACCOUNT-ID:key/*"
        }
    ]
}
```

4. Name: `OCRPlatformS3Access`
5. Create policy
6. Attach to user `ocr-platform-app`

### 3. Create Access Keys

1. Select user `ocr-platform-app`
2. **Security credentials** tab
3. **Create access key**
4. Select: **Application running outside AWS**
5. Save **Access Key ID** and **Secret Access Key** (you won't see secret again)

**Store securely:**
```bash
# Add to worker/.env (NEVER commit to git)
AWS_ACCESS_KEY_ID=your_aws_access_key_here
AWS_SECRET_ACCESS_KEY=your_aws_secret_key_here
AWS_REGION=us-east-1
```

---

## Part 3: Create KMS Key for Encryption

HIPAA requires encryption at rest. Use AWS KMS (Key Management Service).

### 1. Create KMS Key

```bash
# Via AWS Console:
```

1. Go to **KMS** (Key Management Service)
2. Click **Create key**
3. Key type: **Symmetric**
4. Key usage: **Encrypt and decrypt**
5. Click **Next**

### 2. Configure Key

1. **Alias**: `ocr-platform-s3-key`
2. **Description**: "Encryption key for OCR platform S3 bucket (HIPAA)"
3. Click **Next**

### 3. Define Key Administrative Permissions

1. Select administrators who can manage the key
2. Click **Next**

### 4. Define Key Usage Permissions

1. Add IAM user: `ocr-platform-app`
2. Add IAM roles (if using EC2/Lambda)
3. Click **Next**

### 5. Review and Create

1. Review policy
2. Click **Finish**
3. **Copy the Key ARN** (you'll need this)

Example: `arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012`

---

## Part 4: Create S3 Bucket

### 1. Create Bucket

```bash
# Via AWS Console:
```

1. Go to **S3** → **Create bucket**
2. **Bucket name**: `ocr-platform-files-YOUR-UNIQUE-ID`
   - Must be globally unique
   - Use lowercase, numbers, hyphens only
   - Example: `ocr-platform-files-prod-2024`
3. **Region**: Choose closest to your users (e.g., `us-east-1`)

### 2. Object Ownership

1. Keep default: **ACLs disabled (recommended)**

### 3. Block Public Access ⚠️ CRITICAL

**Enable ALL blocks:**

- ✅ Block all public access
  - ✅ Block public access to buckets and objects granted through new access control lists (ACLs)
  - ✅ Block public access to buckets and objects granted through any access control lists (ACLs)
  - ✅ Block public access to buckets and objects granted through new public bucket or access point policies
  - ✅ Block public and cross-account access to buckets and objects through any public bucket or access point policies

**Acknowledge** the warning.

### 4. Bucket Versioning

1. **Enable** versioning
   - Protects against accidental deletion
   - Required for compliance

### 5. Default Encryption

1. **Encryption type**: SSE-KMS (Server-Side Encryption with KMS)
2. **AWS KMS key**: Choose existing → Select `ocr-platform-s3-key`
3. **Bucket Key**: Enable (reduces KMS costs)

### 6. Advanced Settings

**Object Lock**: Disabled (unless you need immutability)

Click **Create bucket**.

---

## Part 5: Configure Bucket Policy

### 1. Add Bucket Policy

1. Select your bucket → **Permissions** tab
2. Scroll to **Bucket policy**
3. Click **Edit**

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "DenyUnencryptedObjectUploads",
            "Effect": "Deny",
            "Principal": "*",
            "Action": "s3:PutObject",
            "Resource": "arn:aws:s3:::ocr-platform-files-YOUR-UNIQUE-ID/*",
            "Condition": {
                "StringNotEquals": {
                    "s3:x-amz-server-side-encryption": "aws:kms"
                }
            }
        },
        {
            "Sid": "DenyInsecureTransport",
            "Effect": "Deny",
            "Principal": "*",
            "Action": "s3:*",
            "Resource": [
                "arn:aws:s3:::ocr-platform-files-YOUR-UNIQUE-ID",
                "arn:aws:s3:::ocr-platform-files-YOUR-UNIQUE-ID/*"
            ],
            "Condition": {
                "Bool": {
                    "aws:SecureTransport": "false"
                }
            }
        },
        {
            "Sid": "DenyPublicAccess",
            "Effect": "Deny",
            "Principal": "*",
            "Action": [
                "s3:GetObject",
                "s3:PutObject"
            ],
            "Resource": "arn:aws:s3:::ocr-platform-files-YOUR-UNIQUE-ID/*",
            "Condition": {
                "StringNotEquals": {
                    "aws:PrincipalArn": [
                        "arn:aws:iam::YOUR-ACCOUNT-ID:user/ocr-platform-app"
                    ]
                }
            }
        }
    ]
}
```

4. Replace `YOUR-UNIQUE-ID` and `YOUR-ACCOUNT-ID`
5. Click **Save changes**

---

## Part 6: Enable Logging and Monitoring

### 1. Enable Server Access Logging

1. Create logging bucket first:
   - Name: `ocr-platform-logs-YOUR-UNIQUE-ID`
   - Same security settings as main bucket
   - No need for KMS encryption on logs bucket

2. Back to main bucket → **Properties** tab
3. **Server access logging** → **Edit** → **Enable**
4. **Target bucket**: `ocr-platform-logs-YOUR-UNIQUE-ID`
5. **Target prefix**: `s3-access-logs/`
6. **Save changes**

### 2. Enable CloudTrail (Data Events)

1. Go to **CloudTrail** → **Trails** → **Create trail**
2. **Trail name**: `ocr-platform-s3-trail`
3. **Storage location**: Create new bucket (auto-created)
4. Click **Next**

5. **Event type**:
   - ✅ Management events
   - ✅ Data events
     - Select **S3**
     - Select your bucket: `ocr-platform-files-YOUR-UNIQUE-ID`
     - ✅ Read
     - ✅ Write

6. Click **Next** → **Create trail**

### 3. Enable S3 Object-Level Logging

Already covered by CloudTrail data events.

---

## Part 7: Configure Lifecycle Policies

Automatically manage old files and reduce costs.

### 1. Create Lifecycle Rule

1. Select bucket → **Management** tab
2. **Create lifecycle rule**

3. **Rule name**: `transition-and-expire`
4. **Rule scope**: Apply to all objects (or use prefix filter)

5. **Lifecycle rule actions**:
   - ✅ Transition current versions of objects
   - ✅ Expire current versions of objects
   - ✅ Delete expired object delete markers

6. **Transition current versions**:
   - After **30 days**: Standard-IA (Infrequent Access)
   - After **90 days**: Glacier Flexible Retrieval

7. **Expire current versions**:
   - After **365 days** (adjust based on your retention policy)

8. Click **Create rule**

---

## Part 8: Enable MFA Delete (Optional but Recommended)

Prevents accidental deletion even by admins.

**Note:** Can only be enabled by AWS root account user via AWS CLI.

```bash
# Enable MFA delete (requires root account)
aws s3api put-bucket-versioning \
    --bucket ocr-platform-files-YOUR-UNIQUE-ID \
    --versioning-configuration Status=Enabled,MFADelete=Enabled \
    --mfa "arn:aws:iam::YOUR-ACCOUNT-ID:mfa/root-account-mfa-device XXXXXX"
```

Replace `XXXXXX` with current MFA code.

---

## Part 9: Set Up Bucket Folders

Create logical structure for organization.

### Folder Structure:

```
ocr-platform-files-YOUR-UNIQUE-ID/
├── uploads/
│   ├── {user_id}/
│   │   └── {file_uuid}.pdf
├── results/
│   ├── {user_id}/
│   │   └── {task_uuid}.html
└── temp/
    └── (automatically cleaned by lifecycle)
```

**Create folders:**

1. In S3 console, click **Create folder**
2. Name: `uploads/`
3. Repeat for `results/` and `temp/`

Or via AWS CLI:
```bash
aws s3api put-object \
    --bucket ocr-platform-files-YOUR-UNIQUE-ID \
    --key uploads/
```

---

## Part 10: Test Access from Application

### 1. Install AWS SDK

```bash
cd worker
source ../venv/bin/activate
pip install boto3
```

### 2. Test Script

Create `worker/test_s3.py`:

```python
import boto3
import os
from datetime import datetime

# Load credentials from environment
s3 = boto3.client(
    's3',
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
    region_name=os.getenv('AWS_REGION', 'us-east-1')
)

bucket_name = 'ocr-platform-files-YOUR-UNIQUE-ID'

# Test 1: Upload file
test_content = f"Test upload at {datetime.utcnow()}"
test_key = 'uploads/test/test.txt'

try:
    s3.put_object(
        Bucket=bucket_name,
        Key=test_key,
        Body=test_content.encode('utf-8'),
        ServerSideEncryption='aws:kms'
    )
    print(f"✅ Upload successful: {test_key}")
except Exception as e:
    print(f"❌ Upload failed: {e}")

# Test 2: Download file
try:
    response = s3.get_object(Bucket=bucket_name, Key=test_key)
    content = response['Body'].read().decode('utf-8')
    print(f"✅ Download successful: {content}")
except Exception as e:
    print(f"❌ Download failed: {e}")

# Test 3: List files
try:
    response = s3.list_objects_v2(Bucket=bucket_name, Prefix='uploads/')
    print(f"✅ List successful: {response.get('KeyCount', 0)} objects")
except Exception as e:
    print(f"❌ List failed: {e}")

# Test 4: Delete file
try:
    s3.delete_object(Bucket=bucket_name, Key=test_key)
    print(f"✅ Delete successful")
except Exception as e:
    print(f"❌ Delete failed: {e}")
```

### 3. Run Test

```bash
# Set environment variables
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_REGION=us-east-1

# Run test
python test_s3.py
```

**Expected output:**
```
✅ Upload successful: uploads/test/test.txt
✅ Download successful: Test upload at 2024-10-16 14:30:00
✅ List successful: 1 objects
✅ Delete successful
```

---

## Part 11: Update Application Configuration

### worker/config.py

```python
# AWS S3 Configuration
AWS_ACCESS_KEY_ID = os.getenv('AWS_ACCESS_KEY_ID')
AWS_SECRET_ACCESS_KEY = os.getenv('AWS_SECRET_ACCESS_KEY')
AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')
S3_BUCKET_NAME = os.getenv('S3_BUCKET_NAME', 'ocr-platform-files-YOUR-UNIQUE-ID')

# Storage type (local or s3)
STORAGE_TYPE = os.getenv('STORAGE_TYPE', 'local')  # Change to 's3' in production
```

### worker/.env

```bash
# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_aws_access_key_here
AWS_SECRET_ACCESS_KEY=your_aws_secret_key_here
AWS_REGION=us-east-1
S3_BUCKET_NAME=ocr-platform-files-prod-2024

# Storage type
STORAGE_TYPE=s3
```

---

## HIPAA Compliance Checklist

### ✅ Technical Safeguards

- [x] **Encryption at rest** - KMS with customer-managed keys
- [x] **Encryption in transit** - HTTPS only (enforced by bucket policy)
- [x] **Access controls** - IAM user with minimal permissions
- [x] **Audit logging** - CloudTrail + S3 access logs
- [x] **Versioning** - Enabled for data recovery
- [x] **MFA delete** - Optional but recommended
- [x] **Private bucket** - All public access blocked

### ✅ Administrative Safeguards

- [x] **BAA signed** - Business Associate Agreement with AWS
- [x] **Access management** - Dedicated IAM user, not root
- [x] **Monitoring** - CloudTrail for all API calls
- [x] **Incident response** - CloudWatch alarms (set up separately)

### ✅ Physical Safeguards

- [x] **AWS infrastructure** - SOC 2 Type II certified data centers
- [x] **Region selection** - Data stays in specified region

---

## Ongoing Maintenance

### Daily/Weekly:
- Monitor CloudWatch metrics for unusual activity
- Review CloudTrail logs for unauthorized access attempts

### Monthly:
- Review IAM access keys rotation (rotate every 90 days)
- Check S3 access logs for anomalies
- Verify lifecycle policies are working

### Quarterly:
- Audit user access (add/remove as needed)
- Review and update bucket policies
- Test backup/restore procedures

### Annually:
- Renew BAA with AWS (if required)
- Security audit by third party
- Disaster recovery drill

---

## Cost Estimation

For 1,000 users processing 10 documents/month:

| Service | Monthly Cost |
|---------|--------------|
| S3 Storage (100 GB) | ~$2.30 |
| KMS Key (1 key) | $1.00 |
| KMS Requests | ~$0.10 |
| CloudTrail | $2.00 |
| Data Transfer Out | ~$0.90 |
| **Total** | **~$6.30/month** |

**Note:** Costs scale with usage. Monitor with AWS Cost Explorer.

---

## Troubleshooting

### Access Denied Errors

```bash
# Check IAM user permissions
aws iam get-user-policy --user-name ocr-platform-app --policy-name OCRPlatformS3Access

# Check bucket policy
aws s3api get-bucket-policy --bucket ocr-platform-files-YOUR-UNIQUE-ID
```

### KMS Encryption Errors

```bash
# Verify KMS key permissions
aws kms describe-key --key-id YOUR-KEY-ID

# Check if user can use key
aws kms list-grants --key-id YOUR-KEY-ID
```

### Connection Timeout

- Check security groups (if using EC2)
- Verify region matches bucket region
- Check VPC endpoint configuration (if using private VPC)

---

## Security Best Practices

1. **Never commit AWS credentials to git**
   - Add `.env` to `.gitignore`
   - Use environment variables or AWS Secrets Manager

2. **Rotate access keys every 90 days**
   ```bash
   aws iam create-access-key --user-name ocr-platform-app
   # Update application with new key
   aws iam delete-access-key --user-name ocr-platform-app --access-key-id OLD_KEY
   ```

3. **Use VPC endpoints for private communication**
   - Keeps traffic within AWS network
   - Reduces data transfer costs

4. **Enable CloudWatch alarms**
   ```bash
   # Alert on high number of failed requests
   # Alert on unusual data transfer
   # Alert on bucket policy changes
   ```

5. **Implement least privilege**
   - Only grant permissions actually needed
   - Review permissions quarterly

---

## Resources

- [AWS HIPAA Compliance](https://aws.amazon.com/compliance/hipaa-compliance/)
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [S3 Security Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
- [KMS Best Practices](https://docs.aws.amazon.com/kms/latest/developerguide/best-practices.html)

---

**Setup Complete!** Your S3 bucket is now configured for HIPAA-compliant file storage.

Next: Integrate with your OCR worker to upload/download files.
