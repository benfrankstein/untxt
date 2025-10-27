# S3 Deletion & Recovery Strategy

## Overview

This system implements a **soft delete with lifecycle management** strategy for S3 files:

- **Database**: Hard delete (records removed immediately for clean queries)
- **S3 Files**: Soft delete (tagged as deleted, kept for recovery window)
- **Recovery Window**: 30 days before permanent deletion
- **Cost Optimization**: Files moved to Glacier after 7 days

## How It Works

### User Deletes a File

1. **Frontend**: User clicks "Delete" button
2. **Backend**:
   - Deletes records from `tasks` and `files` tables (hard delete)
   - Tags S3 objects with `deleted=true` and `deleted_at=<timestamp>`
3. **S3 Lifecycle Rules**:
   - Day 7: Move to Glacier (cheaper storage)
   - Day 30: Permanently delete

### Recovery Window

```
Day 0: User deletes → S3 object tagged as deleted
Day 1-6: Object in S3 Standard (fast recovery)
Day 7-29: Object in Glacier (slower recovery, cheaper)
Day 30+: Object permanently deleted
```

## Setup Instructions

### 1. Apply S3 Lifecycle Policy

You have two options:

#### Option A: AWS Console (Easiest)

1. Go to AWS S3 Console
2. Select your bucket: `untxt`
3. Go to **Management** tab
4. Click **Create lifecycle rule**
5. Use the configuration from `docs/S3_LIFECYCLE_POLICY.json`

#### Option B: AWS CLI

```bash
# Navigate to docs folder
cd docs

# Apply lifecycle policy
aws s3api put-bucket-lifecycle-configuration \
  --bucket untxt \
  --lifecycle-configuration file://S3_LIFECYCLE_POLICY.json

# Verify it was applied
aws s3api get-bucket-lifecycle-configuration --bucket untxt
```

### 2. Verify Configuration

After applying the policy, verify it's working:

```bash
# Check if policy is active
aws s3api get-bucket-lifecycle-configuration --bucket untxt

# You should see:
# - Rule: DeleteTaggedObjects (Enabled)
# - Rule: TransitionToGlacierBeforeDeletion (Enabled)
# - Rule: CleanupIncompleteMultipartUploads (Enabled)
```

## Recovery Procedures

### Recover a Recently Deleted File (Within 7 Days)

```bash
# 1. List deleted files
aws s3api list-objects-v2 \
  --bucket untxt \
  --prefix "uploads/" \
  --query 'Contents[?Size > 0].[Key]' \
  --output text

# 2. Check tags to find deleted files
aws s3api get-object-tagging \
  --bucket untxt \
  --key "uploads/USER_ID/YYYY-MM/FILE_ID/filename.pdf"

# 3. Remove deletion tags to recover
aws s3api delete-object-tagging \
  --bucket untxt \
  --key "uploads/USER_ID/YYYY-MM/FILE_ID/filename.pdf"

# File is now recovered! But you need to recreate database records.
```

### Recover from Glacier (Day 7-29)

```bash
# 1. Initiate Glacier restore (takes 3-5 hours)
aws s3api restore-object \
  --bucket untxt \
  --key "uploads/USER_ID/YYYY-MM/FILE_ID/filename.pdf" \
  --restore-request Days=7,GlacierJobParameters={Tier=Standard}

# 2. Wait for restore to complete
aws s3api head-object \
  --bucket untxt \
  --key "uploads/USER_ID/YYYY-MM/FILE_ID/filename.pdf"
# Look for: "Restore: ongoing-request="false""

# 3. Remove deletion tags
aws s3api delete-object-tagging \
  --bucket untxt \
  --key "uploads/USER_ID/YYYY-MM/FILE_ID/filename.pdf"

# 4. Recreate database records (manual process)
```

## Lifecycle Policy Breakdown

### Rule 1: Delete Tagged Objects (Day 30)

```json
{
  "Id": "DeleteTaggedObjects",
  "Status": "Enabled",
  "Filter": {
    "Tag": {
      "Key": "deleted",
      "Value": "true"
    }
  },
  "Expiration": {
    "Days": 30
  }
}
```

**Purpose**: Permanently delete files marked as deleted after 30 days.

### Rule 2: Transition to Glacier (Day 7)

```json
{
  "Id": "TransitionToGlacierBeforeDeletion",
  "Status": "Enabled",
  "Filter": {
    "Tag": {
      "Key": "deleted",
      "Value": "true"
    }
  },
  "Transitions": [
    {
      "Days": 7,
      "StorageClass": "GLACIER"
    }
  ]
}
```

**Purpose**: Move deleted files to cheaper Glacier storage after 7 days. Reduces storage costs by ~80%.

**Cost Example**:
- S3 Standard: $0.023/GB/month
- Glacier: $0.004/GB/month
- **Savings**: ~$0.019/GB/month

### Rule 3: Cleanup Incomplete Uploads

```json
{
  "Id": "CleanupIncompleteMultipartUploads",
  "Status": "Enabled",
  "Filter": {},
  "AbortIncompleteMultipartUpload": {
    "DaysAfterInitiation": 7
  }
}
```

**Purpose**: Remove failed/incomplete multipart uploads after 7 days to prevent accumulating storage charges.

## Monitoring & Alerts

### CloudWatch Metrics

Monitor S3 lifecycle actions:

```bash
# View lifecycle transition metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/S3 \
  --metric-name BucketSizeBytes \
  --dimensions Name=BucketName,Value=untxt Name=StorageType,Value=GlacierStorage \
  --start-time 2025-10-01T00:00:00Z \
  --end-time 2025-10-31T23:59:59Z \
  --period 86400 \
  --statistics Average
```

### Set Up Alerts

Create SNS topic for lifecycle events:

```bash
# Create SNS topic
aws sns create-topic --name s3-lifecycle-alerts

# Subscribe to email
aws sns subscribe \
  --topic-arn arn:aws:sns:us-east-1:ACCOUNT_ID:s3-lifecycle-alerts \
  --protocol email \
  --notification-endpoint your-email@example.com

# Enable S3 event notifications
aws s3api put-bucket-notification-configuration \
  --bucket untxt \
  --notification-configuration file://s3-notifications.json
```

## Cost Analysis

### Before Lifecycle Policy

All deleted files stored in S3 Standard indefinitely:
- 1TB deleted files/month × $0.023/GB = **$23/month**

### After Lifecycle Policy (30-day retention)

Average across lifecycle stages:
- Days 1-7 (S3 Standard): 1TB × $0.023/GB × 7/30 = **$5.37**
- Days 8-30 (Glacier): 1TB × $0.004/GB × 23/30 = **$3.07**
- **Total: $8.44/month** (63% savings!)

## Best Practices

### For Development

Keep shorter retention for faster testing:
- Modify expiration to 1-3 days
- Skip Glacier transition

### For Production

Use the full 30-day window:
- 7 days in S3 Standard (fast recovery)
- 23 days in Glacier (cost savings)
- Total 30 days for compliance

### For HIPAA Compliance

Extend retention if required:
- Change `Days: 30` to `Days: 2555` (7 years)
- Consider Glacier Deep Archive for long-term storage

## Troubleshooting

### Files Not Being Deleted

**Check**:
1. Verify lifecycle policy is enabled
2. Check tag format (must be exact: `deleted=true`)
3. Wait 24-48 hours (lifecycle runs daily)

```bash
# Check if policy exists
aws s3api get-bucket-lifecycle-configuration --bucket untxt
```

### Recovery Failed

**Check**:
1. File may already be permanently deleted (>30 days)
2. Glacier restore may not be complete
3. Tags may not have been removed

```bash
# Check object status
aws s3api head-object --bucket untxt --key "path/to/file.pdf"
```

### Unexpected Costs

**Check**:
1. Too many files in Glacier (restore costs apply)
2. Frequent Glacier restores ($0.01/GB)
3. Incomplete multipart uploads not cleaned up

```bash
# Check Glacier storage size
aws s3api list-objects-v2 \
  --bucket untxt \
  --query 'sum(Contents[].Size)' \
  --output text
```

## Future Enhancements

### Admin Dashboard (Optional)

Add admin-only endpoints for:
- List deleted files with recovery option
- Bulk recovery operations
- View lifecycle statistics
- Manual permanent deletion

### Automated Notifications

Send emails when:
- Files about to be permanently deleted (Day 28 warning)
- Large files transitioned to Glacier
- User requests file recovery

## Security Considerations

### Access Control

Only admins should be able to:
- View deleted files
- Recover deleted files
- Permanently delete files before lifecycle

### Audit Logging

Enable CloudTrail to log:
- Who deleted files
- Who recovered files
- When lifecycle rules ran

```bash
# Enable CloudTrail for S3 data events
aws cloudtrail put-event-selectors \
  --trail-name ocr-platform-trail \
  --event-selectors file://cloudtrail-config.json
```

## Summary

✅ **Database**: Hard delete (clean queries)
✅ **S3 Files**: Soft delete with 30-day recovery window
✅ **Cost Savings**: 63% reduction on deleted file storage
✅ **Recovery**: Fast (0-7 days) or Glacier restore (7-30 days)
✅ **Compliance**: Configurable retention periods

**Next Steps**:
1. Apply S3 lifecycle policy (see Setup Instructions above)
2. Test delete/recovery with a sample file
3. Monitor CloudWatch metrics for lifecycle actions
4. Document recovery procedures for your team
