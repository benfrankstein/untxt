"""
Configuration for OCR Worker
"""

import os
from pathlib import Path

class Config:
    """Worker configuration"""

    # Redis Configuration
    REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
    REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
    REDIS_DB = int(os.getenv('REDIS_DB', 0))

    # Redis TLS Configuration (HIPAA Compliance)
    REDIS_TLS_ENABLED = os.getenv('REDIS_TLS_ENABLED', 'false').lower() == 'true'
    REDIS_TLS_CA_CERT = os.getenv('REDIS_TLS_CA_CERT', None)
    REDIS_TLS_CERT = os.getenv('REDIS_TLS_CERT', None)
    REDIS_TLS_KEY = os.getenv('REDIS_TLS_KEY', None)
    REDIS_TLS_VERIFY = os.getenv('REDIS_TLS_VERIFY', 'true').lower() == 'true'

    # Database Configuration
    DB_HOST = os.getenv('DB_HOST', 'localhost')
    DB_PORT = int(os.getenv('DB_PORT', 5432))
    DB_NAME = os.getenv('DB_NAME', 'ocr_platform_dev')
    DB_USER = os.getenv('DB_USER', 'ocr_platform_user')
    DB_PASSWORD = os.getenv('DB_PASSWORD', 'ocr_platform_pass_dev')

    # Worker Configuration
    WORKER_ID = os.getenv('WORKER_ID', 'worker-001')
    MAX_ATTEMPTS = int(os.getenv('MAX_ATTEMPTS', 3))
    PROCESSING_TIMEOUT = int(os.getenv('PROCESSING_TIMEOUT', 300))  # 5 minutes
    POLL_INTERVAL = int(os.getenv('POLL_INTERVAL', 5))  # seconds

    # File Storage
    OUTPUT_DIR = os.getenv('OUTPUT_DIR', str(Path(__file__).parent.parent / 'output'))

    # Model Configuration (simulated for now)
    MODEL_NAME = 'Qwen3-VL-3B'
    MODEL_VERSION = 'v1.0-simulated'

    # Redis Key Patterns
    TASK_QUEUE_KEY = 'ocr:task:queue'
    TASK_DATA_KEY_PREFIX = 'ocr:task:data:'
    NOTIFICATIONS_CHANNEL = 'ocr:notifications'
    USER_NOTIFICATIONS_CHANNEL_PREFIX = 'ocr:notifications:user:'
    TASK_UPDATES_CHANNEL = 'ocr:task:updates'  # Real-time task status updates for WebSocket

    @staticmethod
    def get_database_url():
        """Get PostgreSQL connection URL"""
        return f"postgresql://{Config.DB_USER}:{Config.DB_PASSWORD}@{Config.DB_HOST}:{Config.DB_PORT}/{Config.DB_NAME}"
