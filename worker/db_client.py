"""
Database Client for OCR Worker
Handles PostgreSQL database operations
"""

import psycopg2
from psycopg2.extras import RealDictCursor
import logging
from typing import Optional, Dict, Any
from datetime import datetime
from config import Config

logger = logging.getLogger(__name__)


class DatabaseClient:
    """PostgreSQL database client for worker operations"""

    def __init__(self):
        """Initialize database connection"""
        self.conn = None
        self.connect()

    def connect(self):
        """Establish database connection"""
        try:
            self.conn = psycopg2.connect(
                host=Config.DB_HOST,
                port=Config.DB_PORT,
                database=Config.DB_NAME,
                user=Config.DB_USER,
                password=Config.DB_PASSWORD
            )
            logger.info(f"Database connected: {Config.DB_HOST}:{Config.DB_PORT}/{Config.DB_NAME}")
        except Exception as e:
            logger.error(f"Database connection failed: {e}")
            raise

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Get task information from database.

        Args:
            task_id: Task UUID

        Returns:
            Task record or None
        """
        try:
            with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT t.*, f.file_path, f.s3_key, f.original_filename, f.file_type
                    FROM tasks t
                    JOIN files f ON t.file_id = f.id
                    WHERE t.id = %s
                    """,
                    (task_id,)
                )
                result = cur.fetchone()
                if result:
                    logger.info(f"Retrieved task {task_id} from database")
                    return dict(result)
                return None
        except Exception as e:
            logger.error(f"Error getting task from database: {e}")
            return None

    def update_task_status(
        self,
        task_id: str,
        status: str,
        worker_id: Optional[str] = None,
        error_message: Optional[str] = None
    ) -> bool:
        """
        Update task status in database.

        Args:
            task_id: Task UUID
            status: New status ('processing', 'completed', 'failed')
            worker_id: Worker ID (optional)
            error_message: Error message if failed (optional)

        Returns:
            True if successful, False otherwise
        """
        try:
            with self.conn.cursor() as cur:
                updates = ["status = %s"]
                params = [status]

                if status == 'processing':
                    updates.append("started_at = %s")
                    params.append(datetime.utcnow())
                    if worker_id:
                        updates.append("worker_id = %s")
                        params.append(worker_id)

                elif status == 'completed':
                    updates.append("completed_at = %s")
                    params.append(datetime.utcnow())

                elif status == 'failed':
                    updates.append("completed_at = %s")
                    params.append(datetime.utcnow())
                    if error_message:
                        updates.append("error_message = %s")
                        params.append(error_message)

                params.append(task_id)

                query = f"UPDATE tasks SET {', '.join(updates)} WHERE id = %s"
                cur.execute(query, params)
                self.conn.commit()

                logger.info(f"Updated task {task_id} status to {status}")
                return True
        except Exception as e:
            logger.error(f"Error updating task status: {e}")
            self.conn.rollback()
            return False

    def increment_task_attempts(self, task_id: str) -> bool:
        """
        Increment task attempt counter.

        Args:
            task_id: Task UUID

        Returns:
            True if successful, False otherwise
        """
        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    "UPDATE tasks SET attempts = attempts + 1 WHERE id = %s",
                    (task_id,)
                )
                self.conn.commit()
                logger.info(f"Incremented attempts for task {task_id}")
                return True
        except Exception as e:
            logger.error(f"Error incrementing task attempts: {e}")
            self.conn.rollback()
            return False

    def store_result(
        self,
        task_id: str,
        user_id: str,
        extracted_text: str,
        confidence_score: float,
        structured_data: Dict[str, Any],
        page_count: int,
        word_count: int,
        processing_time_ms: int,
        model_version: str,
        result_file_path: Optional[str] = None,
        s3_result_key: Optional[str] = None
    ) -> bool:
        """
        Store OCR result in database.

        Args:
            task_id: Task UUID
            user_id: User UUID
            extracted_text: Extracted text content
            confidence_score: OCR confidence score
            structured_data: Structured data as JSON
            page_count: Number of pages processed
            word_count: Number of words extracted
            processing_time_ms: Processing time in milliseconds
            model_version: Model version used
            result_file_path: Path to result file (optional)
            s3_result_key: S3 object key for result file (optional)

        Returns:
            True if successful, False otherwise
        """
        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO results (
                        task_id, user_id, extracted_text, confidence_score, structured_data,
                        page_count, word_count, processing_time_ms, model_version,
                        result_file_path, s3_result_key
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        task_id, user_id, extracted_text, confidence_score,
                        psycopg2.extras.Json(structured_data),
                        page_count, word_count, processing_time_ms,
                        model_version, result_file_path, s3_result_key
                    )
                )
                self.conn.commit()
                logger.info(f"Stored result for task {task_id}")
                return True
        except Exception as e:
            logger.error(f"Error storing result: {e}")
            self.conn.rollback()
            return False

    def ping(self) -> bool:
        """
        Check if database connection is alive.

        Returns:
            True if connected, False otherwise
        """
        try:
            with self.conn.cursor() as cur:
                cur.execute("SELECT 1")
                return True
        except Exception as e:
            logger.error(f"Database ping failed: {e}")
            return False

    def close(self):
        """Close database connection"""
        try:
            if self.conn:
                self.conn.close()
                logger.info("Database connection closed")
        except Exception as e:
            logger.error(f"Error closing database connection: {e}")
