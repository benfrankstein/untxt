#!/usr/bin/env python3
"""
OCR Worker Runner
Starts the worker process that consumes tasks from Redis queue
"""

import sys
import os
import logging
from pathlib import Path
from dotenv import load_dotenv
from task_processor import TaskProcessor

# Load environment variables from .env file
env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=env_path)

# Configure logging
LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'logs')
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, 'worker.log')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE)
    ]
)

logger = logging.getLogger(__name__)


def main():
    """Main entry point"""
    logger.info("=" * 60)
    logger.info("OCR Worker Starting")
    logger.info("=" * 60)

    try:
        processor = TaskProcessor()
        processor.run_worker_loop()
    except KeyboardInterrupt:
        logger.info("Worker stopped by user")
    except Exception as e:
        logger.error(f"Worker crashed: {e}")
        sys.exit(1)

    logger.info("Worker shutdown complete")


if __name__ == '__main__':
    main()
