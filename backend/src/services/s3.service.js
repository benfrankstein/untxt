const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, PutObjectTaggingCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../config');
const crypto = require('crypto');

class S3Service {
  constructor() {
    this.client = new S3Client({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    });
    this.bucketName = config.aws.s3BucketName;
    this.kmsKeyId = config.aws.kmsKeyId;
  }

  /**
   * Generate S3 key for uploaded file
   * Format: uploads/{user_id}/{YYYY-MM}/{file_id}/{filename}
   */
  generateUploadKey(userId, fileId, filename) {
    const date = new Date();
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return `uploads/${userId}/${yearMonth}/${fileId}/${filename}`;
  }

  /**
   * Generate S3 key for result file
   * Format: results/{user_id}/{YYYY-MM}/{task_id}/{filename}
   */
  generateResultKey(userId, taskId, filename) {
    const date = new Date();
    const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return `results/${userId}/${yearMonth}/${taskId}/${filename}`;
  }

  /**
   * Upload file to S3 with KMS encryption
   */
  async uploadFile(buffer, s3Key, mimeType, metadata = {}) {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: s3Key,
        Body: buffer,
        ContentType: mimeType,
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: this.kmsKeyId,
        Metadata: metadata,
      };

      const command = new PutObjectCommand(params);
      await this.client.send(command);

      console.log(`✓ Uploaded file to s3://${this.bucketName}/${s3Key}`);
      return true;
    } catch (error) {
      console.error('S3 upload error:', error);
      throw new Error(`Failed to upload file to S3: ${error.message}`);
    }
  }

  /**
   * Generate a pre-signed URL for downloading a file
   * URL expires in 1 hour
   * @deprecated Use streamFileDownload for HIPAA-compliant proxied downloads
   */
  async getPresignedDownloadUrl(s3Key, expiresIn = 3600) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      const url = await getSignedUrl(this.client, command, { expiresIn });
      console.log(`✓ Generated pre-signed URL for s3://${this.bucketName}/${s3Key}`);
      return url;
    } catch (error) {
      console.error('S3 presigned URL error:', error);
      throw new Error(`Failed to generate presigned URL: ${error.message}`);
    }
  }

  /**
   * Stream file download from S3 (HIPAA-compliant proxied download)
   * Backend streams file to user with full access control and audit logging
   */
  async streamFileDownload(s3Key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      const response = await this.client.send(command);

      console.log(`✓ Streaming file from s3://${this.bucketName}/${s3Key}`);

      return {
        stream: response.Body,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        metadata: response.Metadata,
        lastModified: response.LastModified,
      };
    } catch (error) {
      console.error('S3 stream download error:', error);
      throw new Error(`Failed to stream file from S3: ${error.message}`);
    }
  }

  /**
   * Get file metadata without downloading
   * Useful for checking file existence and getting size before streaming
   */
  async getFileMetadata(s3Key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      const response = await this.client.send(command);

      return {
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        lastModified: response.LastModified,
        metadata: response.Metadata,
        etag: response.ETag,
      };
    } catch (error) {
      if (error.name === 'NoSuchKey') {
        return null;
      }
      console.error('S3 metadata error:', error);
      throw new Error(`Failed to get file metadata: ${error.message}`);
    }
  }

  /**
   * Tag file as deleted (soft delete for recovery window)
   * S3 lifecycle rules will permanently delete tagged objects after retention period
   */
  async deleteFile(s3Key) {
    try {
      // Tag the object as deleted instead of immediate deletion
      const timestamp = new Date().toISOString();

      const command = new PutObjectTaggingCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Tagging: {
          TagSet: [
            {
              Key: 'deleted',
              Value: 'true'
            },
            {
              Key: 'deleted_at',
              Value: timestamp
            }
          ]
        }
      });

      await this.client.send(command);
      console.log(`✓ Marked file as deleted in s3://${this.bucketName}/${s3Key} (will be removed by lifecycle rule)`);
      return true;
    } catch (error) {
      console.error('S3 delete tagging error:', error);
      throw new Error(`Failed to tag file as deleted in S3: ${error.message}`);
    }
  }

  /**
   * Permanently delete file from S3 (admin only)
   * Used for immediate removal or cleanup operations
   */
  async permanentlyDeleteFile(s3Key) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      await this.client.send(command);
      console.log(`✓ Permanently deleted file from s3://${this.bucketName}/${s3Key}`);
      return true;
    } catch (error) {
      console.error('S3 permanent delete error:', error);
      throw new Error(`Failed to permanently delete file from S3: ${error.message}`);
    }
  }

  /**
   * Calculate file hash (SHA-256)
   */
  calculateFileHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
}

module.exports = new S3Service();
