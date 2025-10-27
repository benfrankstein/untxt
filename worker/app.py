"""
OCR Worker - Flask Application
Phase 2: Processing Layer

This worker:
1. Listens to Redis queue for OCR tasks
2. Simulates Qwen3 model processing (outputs predefined HTML)
3. Stores results in PostgreSQL
4. Publishes completion notifications via Redis Pub/Sub
"""

from flask import Flask, jsonify
import os
import logging
from datetime import datetime

# Configure logging
LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'logs')
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, 'worker.log')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()  # Also log to console
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Configuration from environment variables
app.config['REDIS_HOST'] = os.getenv('REDIS_HOST', 'localhost')
app.config['REDIS_PORT'] = int(os.getenv('REDIS_PORT', 6379))
app.config['REDIS_DB'] = int(os.getenv('REDIS_DB', 0))

app.config['DB_HOST'] = os.getenv('DB_HOST', 'localhost')
app.config['DB_PORT'] = int(os.getenv('DB_PORT', 5432))
app.config['DB_NAME'] = os.getenv('DB_NAME', 'ocr_platform_dev')
app.config['DB_USER'] = os.getenv('DB_USER', 'ocr_platform_user')
app.config['DB_PASSWORD'] = os.getenv('DB_PASSWORD', 'ocr_platform_pass_dev')

app.config['WORKER_ID'] = os.getenv('WORKER_ID', 'worker-001')
app.config['OUTPUT_DIR'] = os.getenv('OUTPUT_DIR', '/Users/benfrankstein/Projects/untxt/output')

logger.info(f"Worker {app.config['WORKER_ID']} initialized")
logger.info(f"Redis: {app.config['REDIS_HOST']}:{app.config['REDIS_PORT']}")
logger.info(f"Database: {app.config['DB_HOST']}:{app.config['DB_PORT']}/{app.config['DB_NAME']}")
logger.info(f"Output directory: {app.config['OUTPUT_DIR']}")


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'worker_id': app.config['WORKER_ID'],
        'timestamp': datetime.utcnow().isoformat(),
        'service': 'OCR Worker',
        'version': '1.0.0'
    }), 200


@app.route('/status', methods=['GET'])
def status():
    """Worker status endpoint"""
    from task_processor import get_queue_length

    try:
        queue_length = get_queue_length()
        return jsonify({
            'worker_id': app.config['WORKER_ID'],
            'status': 'active',
            'queue_length': queue_length,
            'timestamp': datetime.utcnow().isoformat()
        }), 200
    except Exception as e:
        logger.error(f"Error getting status: {e}")
        return jsonify({
            'worker_id': app.config['WORKER_ID'],
            'status': 'error',
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }), 500


if __name__ == '__main__':
    # Ensure output directory exists
    os.makedirs(app.config['OUTPUT_DIR'], exist_ok=True)

    # Start Flask server
    logger.info(f"Starting Flask worker on port 5000")
    app.run(host='127.0.0.1', port=5000, debug=True)
