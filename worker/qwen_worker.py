"""
Qwen3VL Worker Process
Continuously polls Redis queue and processes page tasks
Each worker preloads the model and runs independently
"""

import os
import signal
import logging
import time
from pathlib import Path
from datetime import datetime
from typing import Optional

from config import Config
from redis_client import RedisClient
from db_client import DatabaseClient
from s3_client import S3Client
from model_loader import load_qwen_model
from page_processor import process_html_page, process_json_page, process_kvp_page, process_anon_page

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class QwenWorker:
    """Individual worker that processes page tasks"""

    def __init__(self, worker_id: int, gpu_id: int = 0):
        self.worker_id = worker_id
        self.gpu_id = gpu_id
        self.running = False

        # Set GPU
        os.environ['CUDA_VISIBLE_DEVICES'] = str(gpu_id)

        logger.info(f"[Worker {worker_id}] Initializing...")

        # Initialize clients
        self.redis_client = RedisClient()
        self.db_client = DatabaseClient()
        self.s3_client = S3Client()

        # Create temp directory for downloads
        self.temp_dir = Path(Config.OUTPUT_DIR) / f'worker_{worker_id}_temp'
        self.temp_dir.mkdir(parents=True, exist_ok=True)

        # Preload model (HEAVY - runs once per worker, takes 30-60s)
        logger.info(f"[Worker {worker_id}] Loading Qwen3VL model with MLX...")
        try:
            self.model, self.processor, self.config = load_qwen_model()
            logger.info(f"[Worker {worker_id}] ✓ Model loaded and ready")

            # Signal to pool manager that this worker is ready
            self.redis_client.client.setex(f'ocr:worker:{worker_id}:ready', 60, '1')
            logger.info(f"[Worker {worker_id}] Signaled ready status to pool manager")
        except Exception as e:
            logger.error(f"[Worker {worker_id}] Failed to load model: {e}")
            raise

        # Signal handlers
        signal.signal(signal.SIGTERM, self._handle_shutdown)
        signal.signal(signal.SIGINT, self._handle_shutdown)

    def run(self):
        """Main worker loop - polls Redis continuously"""
        logger.info(f"[Worker {self.worker_id}] Starting main loop...")
        self.running = True

        while self.running:
            try:
                # Poll Redis for task (blocking with timeout)
                task_data = self.redis_client.get_task_from_queue(timeout=5)

                if not task_data:
                    continue  # No task, keep polling

                # Process task
                self._process_task(task_data)

            except KeyboardInterrupt:
                logger.info(f"[Worker {self.worker_id}] Interrupted")
                break
            except Exception as e:
                logger.error(f"[Worker {self.worker_id}] Error in main loop: {e}")
                time.sleep(1)  # Brief pause before continuing
                continue

        self.shutdown()

    def _process_task(self, task_data: dict):
        """Process a single page task"""
        task_id = task_data.get('parent_task_id') or task_data.get('task_id')  # Get parent task ID
        page_number = task_data.get('page_number', 1)
        format_type = task_data.get('format_type', 'html')  # 'html' or 'json'
        user_id = task_data.get('user_id')

        logger.info(f"[Worker {self.worker_id}] Processing task {task_id}, page {page_number}, format {format_type}")

        processing_start_time = time.time()

        try:
            # Update task_pages status to processing (HIPAA compliance)
            self.db_client.update_task_page_status(
                task_id,
                page_number,
                format_type,  # Pass format_type to identify correct record
                'processing',
                worker_id=self.worker_id
            )

            # Also update parent task status via Redis
            self._update_task_status(task_id, user_id, 'processing', f'Processing page {page_number} ({format_type})')

            # Download page image from S3
            page_s3_key = task_data['page_image_s3_key']
            temp_image_path = self._download_page_image(page_s3_key, task_id, page_number)

            # Process based on format type
            if format_type == 'html':
                result = process_html_page(
                    self.model,
                    self.processor,
                    self.config,
                    temp_image_path,
                    page_number
                )
                # Upload HTML to S3
                html_s3_key = self._upload_result(result, task_data)
                result_s3_key = html_s3_key  # For task_pages tracking

                # Also upload TXT format (extracted text)
                if 'text_output' in result:
                    txt_result = {
                        'text_output': result['text_output'],
                        'page_number': page_number,
                        'format_type': 'txt'
                    }
                    txt_s3_key = self._upload_result(txt_result, task_data)

                    # Insert TXT format record in task_pages (derived format, not initially requested)
                    total_pages = task_data.get('total_pages', 1)
                    self.db_client.insert_derived_format_page(
                        task_id=task_id,
                        page_number=page_number,
                        total_pages=total_pages,
                        format_type='txt',
                        status='completed',
                        worker_id=self.worker_id,
                        result_s3_key=txt_s3_key,
                        processing_time_ms=0  # No additional processing time
                    )
                    logger.info(f"[Worker {self.worker_id}] ✓ Uploaded TXT format: {txt_s3_key}")

            elif format_type == 'json':
                result = process_json_page(
                    self.model,
                    self.processor,
                    self.config,
                    temp_image_path,
                    page_number
                )
                # Upload JSON to S3
                result_s3_key = self._upload_result(result, task_data)

            elif format_type == 'kvp':
                # Get selected KVPs from task_data (if user specified custom selection)
                selected_kvps = task_data.get('selected_kvps', None)

                result = process_kvp_page(
                    self.model,
                    self.processor,
                    self.config,
                    temp_image_path,
                    page_number,
                    selected_kvps
                )

                # Upload both KVP JSON and HTML to S3
                # First upload structured JSON
                json_result = {
                    'kvp_output': result['kvp_output'],
                    'page_number': page_number,
                    'format_type': 'kvp_json',
                    'processing_time_ms': result['processing_time_ms']
                }
                kvp_json_s3_key = self._upload_result(json_result, task_data)

                # Then upload HTML for viewing (primary result)
                html_result = {
                    'html_output': result['html_output'],
                    'page_number': page_number,
                    'format_type': 'kvp',
                    'processing_time_ms': result['processing_time_ms']
                }
                result_s3_key = self._upload_result(html_result, task_data)

                logger.info(f"[Worker {self.worker_id}] ✓ Uploaded KVP HTML: {result_s3_key}")
                logger.info(f"[Worker {self.worker_id}] ✓ Uploaded KVP JSON: {kvp_json_s3_key}")

            elif format_type == 'anon':
                # Get anonymization parameters from task_data
                anon_strategy = task_data.get('anon_strategy', 'synthetic')
                anon_generate_audit = task_data.get('anon_generate_audit', False)
                anon_selected_fields = task_data.get('anon_selected_fields', None)

                result = process_anon_page(
                    self.model,
                    self.processor,
                    self.config,
                    temp_image_path,
                    page_number,
                    anon_strategy,
                    anon_generate_audit,
                    anon_selected_fields
                )

                # Upload all anon outputs to S3
                # 1. Anonymized JSON
                anon_json_result = {
                    'anon_json': result['anon_json'],
                    'page_number': page_number,
                    'format_type': 'anon_json'
                }
                anon_json_s3_key = self._upload_result(anon_json_result, task_data)

                # 2. Tokenized TXT
                anon_txt_result = {
                    'anon_txt': result['anon_txt'],
                    'page_number': page_number,
                    'format_type': 'anon_txt'
                }
                anon_txt_s3_key = self._upload_result(anon_txt_result, task_data)

                # 3. Mapping file
                anon_mapping_result = {
                    'anon_mapping': result['anon_mapping'],
                    'page_number': page_number,
                    'format_type': 'anon_mapping'
                }
                anon_mapping_s3_key = self._upload_result(anon_mapping_result, task_data)

                # 4. Audit trail (optional)
                anon_audit_s3_key = None
                if result.get('anon_audit'):
                    anon_audit_result = {
                        'anon_audit': result['anon_audit'],
                        'page_number': page_number,
                        'format_type': 'anon_audit'
                    }
                    anon_audit_s3_key = self._upload_result(anon_audit_result, task_data)

                # Primary result is the JSON
                result_s3_key = anon_json_s3_key

                logger.info(f"[Worker {self.worker_id}] ✓ Uploaded Anon JSON: {anon_json_s3_key}")
                logger.info(f"[Worker {self.worker_id}] ✓ Uploaded Anon TXT: {anon_txt_s3_key}")
                logger.info(f"[Worker {self.worker_id}] ✓ Uploaded Anon Mapping: {anon_mapping_s3_key}")
                if anon_audit_s3_key:
                    logger.info(f"[Worker {self.worker_id}] ✓ Uploaded Anon Audit: {anon_audit_s3_key}")

            else:
                raise ValueError(f"Unknown format type: {format_type}")

            # Calculate processing time
            processing_time_ms = int((time.time() - processing_start_time) * 1000)

            # Update task_pages status to completed (HIPAA compliance)
            # For KVP format, also store the JSON S3 key
            update_params = {
                'task_id': task_id,
                'page_number': page_number,
                'format_type': format_type,
                'status': 'completed',
                'worker_id': self.worker_id,
                'result_s3_key': result_s3_key,
                'processing_time_ms': processing_time_ms
            }

            # Add JSON key for KVP extractions
            if format_type == 'kvp' and 'kvp_json_s3_key' in locals():
                update_params['json_result_s3_key'] = kvp_json_s3_key

            # Add anon S3 keys for anonymization
            if format_type == 'anon':
                update_params['anon_json_s3_key'] = anon_json_s3_key
                update_params['anon_txt_s3_key'] = anon_txt_s3_key
                update_params['anon_mapping_s3_key'] = anon_mapping_s3_key
                if anon_audit_s3_key:
                    update_params['anon_audit_s3_key'] = anon_audit_s3_key
                update_params['anon_strategy'] = anon_strategy
                update_params['anon_generate_audit'] = anon_generate_audit

            self.db_client.update_task_page_status(**update_params)

            # Update database with page result (for results table)
            self._update_page_result(task_data, result_s3_key, result)

            # Clean up temp file
            os.remove(temp_image_path)

            # Update parent task status via Redis
            self._update_task_status(task_id, user_id, 'completed', f'Page {page_number} processed successfully')

            logger.info(f"[Worker {self.worker_id}] ✓ Completed task {task_id}, page {page_number} in {processing_time_ms}ms")

        except Exception as e:
            logger.error(f"[Worker {self.worker_id}] Failed to process task {task_id}, page {page_number}: {e}")

            # Update task_pages status to failed (HIPAA compliance)
            self.db_client.update_task_page_status(
                task_id,
                page_number,
                format_type,  # Pass format_type to identify correct record
                'failed',
                worker_id=self.worker_id,
                error_message=str(e)
            )

            self._handle_task_failure(task_data, str(e))

    def _download_page_image(self, s3_key: str, task_id: str, page_number: int) -> str:
        """Download page image from S3 to temp file"""
        logger.info(f"[Worker {self.worker_id}] Downloading page image from S3: {s3_key}")

        # Create temp file path
        temp_filename = f"{task_id}_page_{page_number}.jpg"
        temp_path = str(self.temp_dir / temp_filename)

        # Download from S3
        success = self.s3_client.download_file(s3_key, temp_path)
        if not success:
            raise Exception(f"Failed to download page image from S3: {s3_key}")

        logger.info(f"[Worker {self.worker_id}] ✓ Downloaded to {temp_path}")
        return temp_path

    def _upload_result(self, result: dict, task_data: dict) -> str:
        """Upload result to S3"""
        task_id = task_data.get('parent_task_id') or task_data.get('task_id')  # Use parent UUID
        user_id = task_data['user_id']
        page_number = result['page_number']
        format_type = result['format_type']

        logger.info(f"[Worker {self.worker_id}] Uploading result to S3...")

        # Generate S3 key for result
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')

        # Determine file extension based on format
        extension_map = {
            'html': 'html',
            'json': 'json',
            'txt': 'txt',
            'kvp': 'html',          # KVP HTML output
            'kvp_json': 'json',     # KVP structured JSON
            'anon_json': 'json',    # Anonymized JSON
            'anon_txt': 'txt',      # Tokenized text
            'anon_mapping': 'json', # Token mapping
            'anon_audit': 'json'    # Audit trail
        }
        extension = extension_map.get(format_type, 'txt')
        filename = f"page_{page_number}_{format_type}_{timestamp}.{extension}"

        s3_result_key = self.s3_client.generate_result_s3_key(
            task_id=task_id,
            user_id=user_id,
            filename=filename
        )

        # Prepare content
        if format_type == 'html':
            content = result['html_output']
            content_type = 'text/html'
        elif format_type == 'txt':
            content = result['text_output']
            content_type = 'text/plain'
        elif format_type == 'kvp':
            # KVP HTML output for viewing
            content = result['html_output']
            content_type = 'text/html'
        elif format_type == 'kvp_json':
            # KVP structured JSON
            import json
            content = json.dumps(result['kvp_output'], indent=2, ensure_ascii=False)
            content_type = 'application/json'
        elif format_type == 'anon_json':
            # Anonymized JSON
            import json
            content = json.dumps(result['anon_json'], indent=2, ensure_ascii=False)
            content_type = 'application/json'
        elif format_type == 'anon_txt':
            # Tokenized text output
            content = result['anon_txt']
            content_type = 'text/plain'
        elif format_type == 'anon_mapping':
            # Token mapping JSON
            import json
            content = json.dumps(result['anon_mapping'], indent=2, ensure_ascii=False)
            content_type = 'application/json'
        elif format_type == 'anon_audit':
            # Audit trail JSON
            import json
            content = json.dumps(result['anon_audit'], indent=2, ensure_ascii=False)
            content_type = 'application/json'
        else:  # json
            import json
            # Check if JSON parsing failed
            if 'error' in result:
                # Upload the raw output with error info for debugging
                content = json.dumps({
                    'error': result['error'],
                    'raw_output': result.get('raw', ''),
                    'page_number': page_number,
                    'message': 'Model generated output but JSON parsing failed'
                }, indent=2, ensure_ascii=False)
            else:
                content = json.dumps(result['json_output'], indent=2, ensure_ascii=False)
            content_type = 'application/json'

        # Upload to S3
        metadata = {
            'task_id': task_id,
            'user_id': user_id,
            'page_number': str(page_number),
            'format_type': format_type,
            'worker_id': str(self.worker_id),
            'timestamp': timestamp
        }

        # Add dimensions if available (for HTML rendering)
        if 'dimensions' in result:
            metadata['width'] = str(result['dimensions']['width'])
            metadata['height'] = str(result['dimensions']['height'])

        success = self.s3_client.upload_string(
            content=content,
            s3_key=s3_result_key,
            content_type=content_type,
            metadata=metadata
        )

        if not success:
            raise Exception(f"Failed to upload result to S3: {s3_result_key}")

        logger.info(f"[Worker {self.worker_id}] ✓ Uploaded to S3: {s3_result_key}")
        return s3_result_key

    def _update_page_result(self, task_data: dict, result_s3_key: str, result: dict):
        """Update page result in database"""
        task_id = task_data.get('parent_task_id') or task_data.get('task_id')  # Use parent UUID, not compound ID
        format_type = result.get('format_type')

        # Update tasks.s3_result_key with HTML or KVP (primary formats) for fast preview access
        if format_type in ('html', 'kvp'):
            self.db_client.update_task_result_key(task_id, result_s3_key)
            logger.info(f"[Worker {self.worker_id}] ✓ Set primary result key: {result_s3_key}")

        # Don't update task status here - task is only complete when ALL formats finish
        # The backend will update overall task status based on task_pages completion

        # Results are already stored in S3 via task_pages table
        # Alternative formats (JSON, TXT, KVP_JSON) are queried from task_pages

    def _update_task_status(self, task_id: str, user_id: str, status: str, message: str):
        """Update task status and publish to WebSocket"""
        # Update Redis metadata
        updates = {
            'status': status,
            'worker_id': f"worker-{self.worker_id}",
            'message': message
        }

        if status == 'processing':
            updates['started_at'] = str(int(datetime.utcnow().timestamp()))
        elif status in ('completed', 'failed'):
            updates['completed_at'] = str(int(datetime.utcnow().timestamp()))

        self.redis_client.update_task_metadata(task_id, updates)

        # Publish real-time update to WebSocket channel
        if user_id:
            self.redis_client.publish_task_update(
                task_id=task_id,
                user_id=user_id,
                status=status,
                message=message
            )

    def _handle_task_failure(self, task_data: dict, error: str):
        """Handle task failure"""
        task_id = task_data['task_id']
        user_id = task_data.get('user_id')

        logger.error(f"[Worker {self.worker_id}] Task {task_id} failed: {error}")

        # Update database
        self.db_client.update_task_status(
            task_id,
            'failed',
            worker_id=f"worker-{self.worker_id}",
            error_message=error
        )

        # Update Redis
        self.redis_client.update_task_metadata(task_id, {
            'status': 'failed',
            'error': error,
            'worker_id': f"worker-{self.worker_id}",
            'completed_at': str(int(datetime.utcnow().timestamp()))
        })

        # Publish failure notification
        if user_id:
            self.redis_client.publish_task_update(
                task_id=task_id,
                user_id=user_id,
                status='failed',
                message='Processing failed',
                error=error
            )

    def _handle_shutdown(self, signum, frame):
        """Handle shutdown signal"""
        logger.info(f"[Worker {self.worker_id}] Received signal {signum}, stopping...")
        self.running = False

    def shutdown(self):
        """Cleanup and shutdown"""
        logger.info(f"[Worker {self.worker_id}] Shutting down...")

        # Clean up temp directory
        try:
            import shutil
            if self.temp_dir.exists():
                shutil.rmtree(self.temp_dir)
        except Exception as e:
            logger.warning(f"[Worker {self.worker_id}] Failed to clean temp dir: {e}")

        # Close connections
        self.redis_client.close()
        self.db_client.close()

        logger.info(f"[Worker {self.worker_id}] Shutdown complete")


# Entry point when run directly (for testing)
if __name__ == '__main__':
    import sys
    worker_id = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    worker = QwenWorker(worker_id=worker_id, gpu_id=0)
    worker.run()
