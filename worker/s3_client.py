"""
S3 Client for OCR Worker
Handles file uploads and downloads to/from AWS S3 with KMS encryption
"""

import os
import boto3
import logging
from typing import Optional, BinaryIO
from pathlib import Path
from datetime import datetime
from botocore.exceptions import ClientError
from config import Config

logger = logging.getLogger(__name__)


class S3Client:
    """AWS S3 client for HIPAA-compliant file storage"""

    def __init__(self):
        """Initialize S3 client with credentials from environment"""
        self.bucket_name = os.getenv('S3_BUCKET_NAME')
        self.kms_key_id = os.getenv('KMS_KEY_ID')
        self.region = os.getenv('AWS_REGION', 'us-east-1')

        if not self.bucket_name:
            raise ValueError("S3_BUCKET_NAME not set in environment")

        # Initialize boto3 S3 client
        self.s3 = boto3.client(
            's3',
            region_name=self.region,
            aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY')
        )

        logger.info(f"S3 client initialized for bucket: {self.bucket_name}")

    def upload_file(
        self,
        local_file_path: str,
        s3_key: str,
        metadata: Optional[dict] = None
    ) -> bool:
        """
        Upload a file to S3 with KMS encryption.

        Args:
            local_file_path: Path to local file
            s3_key: S3 object key (path in bucket)
            metadata: Optional metadata dictionary

        Returns:
            True if successful, False otherwise
        """
        try:
            # Prepare upload arguments
            extra_args = {}

            # Add KMS encryption if key is specified
            if self.kms_key_id:
                extra_args['ServerSideEncryption'] = 'aws:kms'
                extra_args['SSEKMSKeyId'] = self.kms_key_id

            # Add metadata if provided
            if metadata:
                extra_args['Metadata'] = {k: str(v) for k, v in metadata.items()}

            # Upload file
            self.s3.upload_file(
                local_file_path,
                self.bucket_name,
                s3_key,
                ExtraArgs=extra_args
            )

            logger.info(f"Uploaded file to s3://{self.bucket_name}/{s3_key}")
            return True

        except ClientError as e:
            logger.error(f"Failed to upload file to S3: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error uploading file: {e}")
            return False

    def download_file(
        self,
        s3_key: str,
        local_file_path: str
    ) -> bool:
        """
        Download a file from S3.

        Args:
            s3_key: S3 object key (path in bucket)
            local_file_path: Local destination path

        Returns:
            True if successful, False otherwise
        """
        try:
            # Ensure directory exists
            os.makedirs(os.path.dirname(local_file_path), exist_ok=True)

            # Download file
            self.s3.download_file(
                self.bucket_name,
                s3_key,
                local_file_path
            )

            logger.info(f"Downloaded file from s3://{self.bucket_name}/{s3_key} to {local_file_path}")
            return True

        except ClientError as e:
            logger.error(f"Failed to download file from S3: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error downloading file: {e}")
            return False

    def upload_string(
        self,
        content: str,
        s3_key: str,
        content_type: str = 'text/html',
        metadata: Optional[dict] = None
    ) -> bool:
        """
        Upload string content directly to S3 (useful for HTML results).

        Args:
            content: String content to upload
            s3_key: S3 object key (path in bucket)
            content_type: MIME type of content
            metadata: Optional metadata dictionary

        Returns:
            True if successful, False otherwise
        """
        try:
            # Prepare upload arguments
            extra_args = {
                'ContentType': content_type
            }

            # Add KMS encryption if key is specified
            if self.kms_key_id:
                extra_args['ServerSideEncryption'] = 'aws:kms'
                extra_args['SSEKMSKeyId'] = self.kms_key_id

            # Add metadata if provided
            if metadata:
                extra_args['Metadata'] = {k: str(v) for k, v in metadata.items()}

            # Upload content
            self.s3.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=content.encode('utf-8'),
                **extra_args
            )

            logger.info(f"Uploaded string content to s3://{self.bucket_name}/{s3_key}")
            return True

        except ClientError as e:
            logger.error(f"Failed to upload string to S3: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error uploading string: {e}")
            return False

    def download_string(self, s3_key: str) -> Optional[str]:
        """
        Download string content from S3.

        Args:
            s3_key: S3 object key (path in bucket)

        Returns:
            String content or None if failed
        """
        try:
            response = self.s3.get_object(
                Bucket=self.bucket_name,
                Key=s3_key
            )

            content = response['Body'].read().decode('utf-8')
            logger.info(f"Downloaded string content from s3://{self.bucket_name}/{s3_key}")
            return content

        except ClientError as e:
            logger.error(f"Failed to download string from S3: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error downloading string: {e}")
            return None

    def delete_file(self, s3_key: str) -> bool:
        """
        Delete a file from S3.

        Args:
            s3_key: S3 object key (path in bucket)

        Returns:
            True if successful, False otherwise
        """
        try:
            self.s3.delete_object(
                Bucket=self.bucket_name,
                Key=s3_key
            )

            logger.info(f"Deleted file from s3://{self.bucket_name}/{s3_key}")
            return True

        except ClientError as e:
            logger.error(f"Failed to delete file from S3: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error deleting file: {e}")
            return False

    def file_exists(self, s3_key: str) -> bool:
        """
        Check if a file exists in S3.

        Args:
            s3_key: S3 object key (path in bucket)

        Returns:
            True if exists, False otherwise
        """
        try:
            self.s3.head_object(
                Bucket=self.bucket_name,
                Key=s3_key
            )
            return True

        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                return False
            logger.error(f"Error checking file existence: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error checking file existence: {e}")
            return False

    def generate_s3_key(
        self,
        user_id: str,
        file_id: str,
        original_filename: str,
        folder: str = 'uploads'
    ) -> str:
        """
        Generate a structured S3 key for file storage.

        Format: {folder}/{user_id}/{YYYY-MM}/{file_id}/{original_filename}

        Args:
            user_id: User UUID
            file_id: File UUID
            original_filename: Original filename
            folder: Root folder (default: 'uploads')

        Returns:
            S3 key string
        """
        # Get current year-month for partitioning
        date_partition = datetime.utcnow().strftime('%Y-%m')

        # Construct S3 key with hierarchical structure
        s3_key = f"{folder}/{user_id}/{date_partition}/{file_id}/{original_filename}"

        return s3_key

    def generate_result_s3_key(
        self,
        task_id: str,
        user_id: str,
        filename: str = None
    ) -> str:
        """
        Generate S3 key for OCR result files.

        Format: results/{user_id}/{YYYY-MM}/{task_id}/{filename}

        Args:
            task_id: Task UUID
            user_id: User UUID
            filename: Optional filename (default: result.html)

        Returns:
            S3 key string
        """
        if not filename:
            filename = f"{task_id}.html"

        date_partition = datetime.utcnow().strftime('%Y-%m')
        s3_key = f"results/{user_id}/{date_partition}/{task_id}/{filename}"

        return s3_key
