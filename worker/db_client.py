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

    def update_task_result_key(self, task_id: str, s3_result_key: str) -> bool:
        """
        Update task with primary result S3 key (HTML format).

        Args:
            task_id: Task UUID
            s3_result_key: S3 key for HTML result

        Returns:
            True if successful, False otherwise
        """
        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    "UPDATE tasks SET s3_result_key = %s WHERE id = %s",
                    (s3_result_key, task_id)
                )
                self.conn.commit()
                logger.info(f"Updated task {task_id} s3_result_key: {s3_result_key}")
                return True
        except Exception as e:
            logger.error(f"Error updating task result key: {e}")
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

    def insert_derived_format_page(
        self,
        task_id: str,
        page_number: int,
        total_pages: int,
        format_type: str,
        status: str,
        worker_id: str = None,
        result_s3_key: str = None,
        processing_time_ms: int = None,
        page_image_s3_key: str = None
    ) -> bool:
        """
        Insert a new task_pages record for derived formats (e.g., TXT).
        Used when a format is generated during processing but wasn't initially requested.

        Args:
            task_id: Task UUID
            page_number: Page number (1-indexed)
            total_pages: Total number of pages in document
            format_type: Format type (e.g., 'txt')
            status: Status ('completed', 'failed')
            worker_id: Worker ID that processed this page
            result_s3_key: S3 key for the result
            processing_time_ms: Processing time in milliseconds
            page_image_s3_key: S3 key for page image (can be empty string for derived formats)

        Returns:
            True if successful, False otherwise
        """
        try:
            with self.conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO task_pages (
                        task_id, page_number, total_pages, format_type, status,
                        worker_id, result_s3_key, processing_time_ms,
                        page_image_s3_key, started_at, completed_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (task_id, page_number, format_type) DO UPDATE
                    SET status = EXCLUDED.status,
                        worker_id = EXCLUDED.worker_id,
                        result_s3_key = EXCLUDED.result_s3_key,
                        processing_time_ms = EXCLUDED.processing_time_ms,
                        completed_at = CURRENT_TIMESTAMP
                    """,
                    (
                        task_id, page_number, total_pages, format_type, status,
                        worker_id, result_s3_key, processing_time_ms,
                        page_image_s3_key or ''
                    )
                )
                self.conn.commit()
                logger.info(f"Inserted derived format: {task_id} page {page_number} ({format_type}) → {status}")
                return True
        except Exception as e:
            logger.error(f"Error inserting derived format page: {e}")
            self.conn.rollback()
            return False

    def update_task_page_status(
        self,
        task_id: str,
        page_number: int,
        format_type: str,
        status: str,
        worker_id: str = None,
        result_s3_key: str = None,
        processing_time_ms: int = None,
        error_message: str = None
    ) -> bool:
        """
        Update task_pages status for page-level tracking (HIPAA compliance).

        Args:
            task_id: Task UUID
            page_number: Page number (1-indexed)
            format_type: Format type ('html', 'json', or 'txt')
            status: Status ('pending', 'processing', 'completed', 'failed')
            worker_id: Worker ID that processed this page
            result_s3_key: S3 key for the result
            processing_time_ms: Processing time in milliseconds
            error_message: Error message if failed

        Returns:
            True if successful, False otherwise
        """
        try:
            with self.conn.cursor() as cur:
                # Build dynamic SET clause
                set_clauses = ["status = %s"]
                params = [status]

                # Add timestamps based on status
                if status == 'processing':
                    set_clauses.append("started_at = COALESCE(started_at, CURRENT_TIMESTAMP)")
                elif status in ('completed', 'failed'):
                    set_clauses.append("completed_at = CURRENT_TIMESTAMP")

                if worker_id is not None:
                    set_clauses.append("worker_id = %s")
                    params.append(worker_id)

                if result_s3_key is not None:
                    set_clauses.append("result_s3_key = %s")
                    params.append(result_s3_key)

                if processing_time_ms is not None:
                    set_clauses.append("processing_time_ms = %s")
                    params.append(processing_time_ms)

                if error_message is not None:
                    set_clauses.append("error_message = %s")
                    params.append(error_message)

                # Add WHERE clause parameters (now includes format_type)
                params.extend([task_id, page_number, format_type])

                query = f"""
                    UPDATE task_pages
                    SET {', '.join(set_clauses)}
                    WHERE task_id = %s AND page_number = %s AND format_type = %s
                """

                cur.execute(query, params)
                self.conn.commit()

                logger.info(f"Updated task_pages status: {task_id} page {page_number} ({format_type}) → {status}")
                return True

        except Exception as e:
            logger.error(f"Error updating task_pages status: {e}")
            self.conn.rollback()
            return False

    def close(self):
        """Close database connection"""
        try:
            if self.conn:
                self.conn.close()
                logger.info("Database connection closed")
        except Exception as e:
            logger.error(f"Error closing database connection: {e}")
