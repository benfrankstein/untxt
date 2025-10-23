"""
Task Processor for OCR Worker
Main processing pipeline: fetch task -> process -> store -> notify
"""

import os
import logging
from datetime import datetime
from typing import Optional
from pathlib import Path

from config import Config
from redis_client import RedisClient
from db_client import DatabaseClient
from s3_client import S3Client
from simulated_qwen3 import simulate_qwen3_inference, get_model_info

logger = logging.getLogger(__name__)


class TaskProcessor:
    """Main task processor for OCR worker"""

    def __init__(self):
        """Initialize task processor"""
        self.redis_client = RedisClient()
        self.db_client = DatabaseClient()
        self.s3_client = S3Client()
        self.worker_id = Config.WORKER_ID

        # Ensure output directory exists (for temporary processing)
        os.makedirs(Config.OUTPUT_DIR, exist_ok=True)

        # Create temp directory for downloaded files
        self.temp_dir = Path(Config.OUTPUT_DIR) / 'temp'
        os.makedirs(self.temp_dir, exist_ok=True)

        logger.info(f"Task processor initialized for worker {self.worker_id}")
        logger.info(f"Model info: {get_model_info()}")

    def process_single_task(self) -> bool:
        """
        Process a single task from the queue.

        Returns:
            True if a task was processed, False if queue was empty
        """
        # Get task from queue (blocking for 5 seconds)
        task_data = self.redis_client.get_task_from_queue(timeout=5)

        if not task_data:
            return False

        # Extract task_id from the task data
        task_id = task_data.get('task_id')
        if not task_id:
            logger.error("Task data missing task_id")
            return False

        logger.info(f"[{task_id}] Starting task processing")

        try:
            # Increment attempts
            self.db_client.increment_task_attempts(task_id)

            # Get task details from database (need user_id for status updates)
            task = self.db_client.get_task(task_id)
            if not task:
                raise Exception(f"Task {task_id} not found in database")

            user_id = task['user_id']
            logger.info(f"[{task_id}] Task details: file={task['original_filename']}, user={user_id}")

            # Update status to processing
            self._update_status(task_id, 'processing', user_id=user_id)

            # Simulate OCR processing
            result = self._run_ocr(task_id, task)

            # Save HTML output to file and upload to S3
            output_file_path, s3_result_key = self._save_output(
                task_id,
                user_id,
                result['html_output']
            )

            # Store result in database
            self._store_result(task_id, user_id, result, output_file_path, s3_result_key)

            # Update status to completed
            self._update_status(task_id, 'completed', user_id=user_id)

            # Publish completion notification
            self._publish_completion_notification(task_id, task['user_id'], result)

            # Set expiry on Redis metadata (cleanup after 24 hours)
            self.redis_client.set_task_expiry(task_id, 86400)

            # Update statistics
            self.redis_client.increment_stat('ocr:stats:tasks:completed')

            logger.info(f"[{task_id}] Task completed successfully")
            return True

        except Exception as e:
            logger.error(f"[{task_id}] Task processing failed: {e}")
            self._handle_task_failure(task_id, str(e))
            return True

    def _run_ocr(self, task_id: str, task: dict) -> dict:
        """
        Run OCR processing (simulated).

        Args:
            task_id: Task UUID
            task: Task dictionary with file information

        Returns:
            OCR result dictionary
        """
        local_file_path = None
        temp_file = False

        try:
            # Check if file is in S3
            if task.get('s3_key'):
                logger.info(f"[{task_id}] Downloading file from S3: {task['s3_key']}")

                # Create temp file path
                local_file_path = str(self.temp_dir / f"{task_id}_{task['original_filename']}")

                # Download from S3
                success = self.s3_client.download_file(task['s3_key'], local_file_path)
                if not success:
                    raise Exception(f"Failed to download file from S3: {task['s3_key']}")

                temp_file = True
                logger.info(f"[{task_id}] File downloaded to {local_file_path}")
            else:
                # Use local file path (backward compatibility)
                local_file_path = task['file_path']
                logger.info(f"[{task_id}] Using local file: {local_file_path}")

            # Run OCR processing
            logger.info(f"[{task_id}] Running OCR on {local_file_path}")
            result = simulate_qwen3_inference(local_file_path)

            logger.info(f"[{task_id}] OCR completed: confidence={result['confidence_score']}, words={result['word_count']}")

            return result

        finally:
            # Clean up temp file if downloaded from S3
            if temp_file and local_file_path and os.path.exists(local_file_path):
                try:
                    os.remove(local_file_path)
                    logger.info(f"[{task_id}] Cleaned up temp file: {local_file_path}")
                except Exception as e:
                    logger.warning(f"[{task_id}] Failed to clean up temp file: {e}")

    def _save_output(self, task_id: str, user_id: str, html_content: str) -> tuple:
        """
        Upload HTML output directly to S3 (no local storage).

        Args:
            task_id: Task UUID
            user_id: User UUID
            html_content: HTML content to save

        Returns:
            Tuple of (None, s3_key) - local path is None as we only use S3
        """
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        filename = f"{task_id}_{timestamp}.html"

        # Generate S3 key for result
        s3_result_key = self.s3_client.generate_result_s3_key(
            task_id=task_id,
            user_id=user_id,
            filename=filename
        )

        # Upload directly to S3 (no local storage)
        success = self.s3_client.upload_string(
            content=html_content,
            s3_key=s3_result_key,
            content_type='text/html',
            metadata={
                'task_id': task_id,
                'user_id': user_id,
                'timestamp': timestamp,
                'worker_id': self.worker_id
            }
        )

        if not success:
            raise Exception(f"Failed to upload result to S3: {s3_result_key}")

        logger.info(f"[{task_id}] Uploaded result to S3: {s3_result_key}")

        # Return None for local path since we're not storing locally
        return None, s3_result_key

    def _store_result(
        self,
        task_id: str,
        user_id: str,
        result: dict,
        output_file_path: str,
        s3_result_key: str
    ) -> bool:
        """
        Store OCR result in database.

        Args:
            task_id: Task UUID
            user_id: User UUID
            result: OCR result dictionary
            output_file_path: Path to output file
            s3_result_key: S3 key for result file

        Returns:
            True if successful
        """
        success = self.db_client.store_result(
            task_id=task_id,
            user_id=user_id,
            extracted_text=result['extracted_text'],
            confidence_score=result['confidence_score'],
            structured_data=result['structured_data'],
            page_count=result['page_count'],
            word_count=result['word_count'],
            processing_time_ms=result['processing_time_ms'],
            model_version=result['model_version'],
            result_file_path=output_file_path,
            s3_result_key=s3_result_key
        )

        if not success:
            raise Exception("Failed to store result in database")

        logger.info(f"[{task_id}] Result stored in database")
        return True

    def _update_status(self, task_id: str, status: str, user_id: str = None, message: str = None):
        """
        Update task status in both database and Redis, and publish to WebSocket channel.

        Args:
            task_id: Task UUID
            status: New status
            user_id: User UUID (optional, will be fetched from DB if not provided)
            message: Optional status message for WebSocket clients
        """
        # Update in database
        self.db_client.update_task_status(task_id, status, worker_id=self.worker_id)

        # Update in Redis metadata
        updates = {
            'status': status,
            'worker_id': self.worker_id
        }

        if status == 'processing':
            updates['started_at'] = str(int(datetime.utcnow().timestamp()))
        elif status in ('completed', 'failed'):
            updates['completed_at'] = str(int(datetime.utcnow().timestamp()))

        self.redis_client.update_task_metadata(task_id, updates)

        # Get user_id if not provided
        if not user_id:
            task = self.db_client.get_task(task_id)
            user_id = task.get('user_id') if task else None

        # Publish real-time update to WebSocket channel
        if user_id:
            status_messages = {
                'processing': 'OCR processing started',
                'completed': 'OCR processing completed successfully',
                'failed': 'OCR processing failed'
            }
            update_message = message or status_messages.get(status, f'Task status: {status}')
            self.redis_client.publish_task_update(
                task_id=task_id,
                user_id=user_id,
                status=status,
                message=update_message
            )

        logger.info(f"[{task_id}] Status updated to {status}")

    def _publish_completion_notification(self, task_id: str, user_id: str, result: dict):
        """
        Publish task completion notification.

        Args:
            task_id: Task UUID
            user_id: User UUID
            result: OCR result dictionary
        """
        notification = {
            'type': 'task_completed',
            'task_id': task_id,
            'user_id': user_id,
            'status': 'completed',
            'result': {
                'confidence': result['confidence_score'],
                'word_count': result['word_count'],
                'page_count': result['page_count'],
                'processing_time_ms': result['processing_time_ms']
            },
            'timestamp': int(datetime.utcnow().timestamp())
        }

        self.redis_client.publish_notification(notification)
        logger.info(f"[{task_id}] Published completion notification")

    def _handle_task_failure(self, task_id: str, error_message: str):
        """
        Handle task failure.

        Args:
            task_id: Task UUID
            error_message: Error message
        """
        # Get user_id for WebSocket update
        task = self.db_client.get_task(task_id)
        user_id = task.get('user_id') if task else None

        # Update status to failed
        self.db_client.update_task_status(task_id, 'failed', worker_id=self.worker_id, error_message=error_message)

        # Update Redis metadata
        self.redis_client.update_task_metadata(task_id, {
            'status': 'failed',
            'error': error_message,
            'completed_at': str(int(datetime.utcnow().timestamp()))
        })

        # Publish real-time update to WebSocket channel
        if user_id:
            self.redis_client.publish_task_update(
                task_id=task_id,
                user_id=user_id,
                status='failed',
                message='OCR processing failed',
                error=error_message
            )

        # Update statistics
        self.redis_client.increment_stat('ocr:stats:tasks:failed')

        # Publish failure notification
        notification = {
            'type': 'task_failed',
            'task_id': task_id,
            'status': 'failed',
            'error': error_message,
            'timestamp': int(datetime.utcnow().timestamp())
        }
        self.redis_client.publish_notification(notification)

        logger.error(f"[{task_id}] Task failed: {error_message}")

    def run_worker_loop(self):
        """
        Main worker loop - continuously process tasks from queue.
        """
        logger.info(f"Worker {self.worker_id} starting main loop")

        try:
            while True:
                try:
                    self.process_single_task()
                except KeyboardInterrupt:
                    logger.info("Received interrupt signal, shutting down...")
                    break
                except Exception as e:
                    logger.error(f"Unexpected error in worker loop: {e}")
                    continue

        finally:
            self.shutdown()

    def shutdown(self):
        """Cleanup and shutdown"""
        logger.info(f"Worker {self.worker_id} shutting down")
        self.redis_client.close()
        self.db_client.close()


# Helper function for Flask app
def get_queue_length() -> int:
    """Get current queue length (for status endpoint)"""
    try:
        redis_client = RedisClient()
        return redis_client.get_queue_length()
    except Exception as e:
        logger.error(f"Error getting queue length: {e}")
        return -1
