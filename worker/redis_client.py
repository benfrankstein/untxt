"""
Redis Client for OCR Worker
Handles Redis queue operations and pub/sub messaging
"""

import redis
import json
import logging
from typing import Optional, Dict, Any
from config import Config

logger = logging.getLogger(__name__)


class RedisClient:
    """Redis client for task queue and pub/sub operations"""

    def __init__(self):
        """Initialize Redis client with TLS support"""
        connection_params = {
            'host': Config.REDIS_HOST,
            'port': Config.REDIS_PORT,
            'db': Config.REDIS_DB,
            'decode_responses': True
        }

        # Add TLS configuration if enabled
        if Config.REDIS_TLS_ENABLED:
            import ssl

            # Create SSL context
            ssl_context = ssl.create_default_context()

            # Set certificate verification
            if Config.REDIS_TLS_VERIFY:
                ssl_context.check_hostname = True
                ssl_context.verify_mode = ssl.CERT_REQUIRED
            else:
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE

            # Load CA certificate if provided
            if Config.REDIS_TLS_CA_CERT:
                try:
                    ssl_context.load_verify_locations(cafile=Config.REDIS_TLS_CA_CERT)
                    logger.info(f"✓ Loaded Redis TLS CA certificate: {Config.REDIS_TLS_CA_CERT}")
                except Exception as e:
                    logger.error(f"✗ Failed to load Redis CA certificate: {e}")
                    raise

            # Load client certificate and key if provided
            if Config.REDIS_TLS_CERT and Config.REDIS_TLS_KEY:
                try:
                    ssl_context.load_cert_chain(
                        certfile=Config.REDIS_TLS_CERT,
                        keyfile=Config.REDIS_TLS_KEY
                    )
                    logger.info(f"✓ Loaded Redis TLS client certificate")
                except Exception as e:
                    logger.error(f"✗ Failed to load Redis client certificate: {e}")
                    raise

            connection_params['ssl'] = True
            connection_params['ssl_cert_reqs'] = ssl.CERT_REQUIRED if Config.REDIS_TLS_VERIFY else ssl.CERT_NONE

            if Config.REDIS_TLS_CA_CERT:
                connection_params['ssl_ca_certs'] = Config.REDIS_TLS_CA_CERT
            if Config.REDIS_TLS_CERT:
                connection_params['ssl_certfile'] = Config.REDIS_TLS_CERT
            if Config.REDIS_TLS_KEY:
                connection_params['ssl_keyfile'] = Config.REDIS_TLS_KEY

            logger.info(f"✓ Redis TLS enabled (HIPAA compliant)")
        else:
            logger.warning("⚠ Redis TLS disabled - NOT HIPAA compliant")
            logger.warning("  Set REDIS_TLS_ENABLED=true in production")

        self.client = redis.Redis(**connection_params)

        # Test connection
        try:
            self.client.ping()
            tls_status = "with TLS" if Config.REDIS_TLS_ENABLED else "without TLS"
            logger.info(f"Redis client connected to {Config.REDIS_HOST}:{Config.REDIS_PORT} {tls_status}")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise

    def get_task_from_queue(self, timeout: int = 5) -> Optional[Dict[str, Any]]:
        """
        Get a task from the queue (blocking operation).

        Args:
            timeout: Timeout in seconds for blocking pop

        Returns:
            Task dictionary or None if timeout
        """
        try:
            result = self.client.brpop(Config.TASK_QUEUE_KEY, timeout=timeout)
            if result:
                _, task_data = result
                logger.info(f"Retrieved task from queue: {task_data}")

                # Parse JSON task data
                try:
                    task = json.loads(task_data)
                    return task
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse task JSON: {e}")
                    return None
            return None
        except Exception as e:
            logger.error(f"Error getting task from queue: {e}")
            return None

    def get_queue_length(self) -> int:
        """
        Get the current queue length.

        Returns:
            Number of tasks in queue
        """
        try:
            return self.client.llen(Config.TASK_QUEUE_KEY)
        except Exception as e:
            logger.error(f"Error getting queue length: {e}")
            return 0

    def get_task_metadata(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Get task metadata from Redis.

        Args:
            task_id: Task UUID

        Returns:
            Task metadata dictionary or None
        """
        try:
            key = f"{Config.TASK_DATA_KEY_PREFIX}{task_id}"
            data = self.client.hgetall(key)
            if data:
                logger.info(f"Retrieved metadata for task {task_id}")
                return data
            return None
        except Exception as e:
            logger.error(f"Error getting task metadata: {e}")
            return None

    def update_task_metadata(self, task_id: str, updates: Dict[str, Any]) -> bool:
        """
        Update task metadata in Redis.

        Args:
            task_id: Task UUID
            updates: Dictionary of field updates

        Returns:
            True if successful, False otherwise
        """
        try:
            key = f"{Config.TASK_DATA_KEY_PREFIX}{task_id}"
            self.client.hset(key, mapping=updates)
            logger.info(f"Updated metadata for task {task_id}: {updates}")
            return True
        except Exception as e:
            logger.error(f"Error updating task metadata: {e}")
            return False

    def set_task_expiry(self, task_id: str, seconds: int = 86400) -> bool:
        """
        Set expiry time for task metadata (default 24 hours).

        Args:
            task_id: Task UUID
            seconds: Seconds until expiry

        Returns:
            True if successful, False otherwise
        """
        try:
            key = f"{Config.TASK_DATA_KEY_PREFIX}{task_id}"
            self.client.expire(key, seconds)
            logger.info(f"Set expiry for task {task_id}: {seconds}s")
            return True
        except Exception as e:
            logger.error(f"Error setting task expiry: {e}")
            return False

    def publish_notification(self, notification: Dict[str, Any]) -> bool:
        """
        Publish notification to Redis pub/sub channel.

        Args:
            notification: Notification dictionary

        Returns:
            True if successful, False otherwise
        """
        try:
            # Publish to general notifications channel
            message = json.dumps(notification)
            subscribers = self.client.publish(Config.NOTIFICATIONS_CHANNEL, message)
            logger.info(f"Published notification to {subscribers} subscribers")

            # Publish to user-specific channel if user_id present
            if 'user_id' in notification:
                user_channel = f"{Config.USER_NOTIFICATIONS_CHANNEL_PREFIX}{notification['user_id']}"
                self.client.publish(user_channel, message)
                logger.info(f"Published user-specific notification to {user_channel}")

            return True
        except Exception as e:
            logger.error(f"Error publishing notification: {e}")
            return False

    def publish_task_update(self, task_id: str, user_id: str, status: str, message: str = None, progress: int = None, error: str = None) -> bool:
        """
        Publish real-time task status update to WebSocket channel.

        Args:
            task_id: Task UUID
            user_id: User UUID
            status: Task status (queued, processing, completed, failed)
            message: Optional status message
            progress: Optional progress percentage (0-100)
            error: Optional error message if failed

        Returns:
            True if successful, False otherwise
        """
        try:
            update = {
                'taskId': task_id,
                'userId': user_id,
                'status': status,
            }

            if message:
                update['message'] = message
            if progress is not None:
                update['progress'] = progress
            if error:
                update['error'] = error

            message_json = json.dumps(update)
            subscribers = self.client.publish(Config.TASK_UPDATES_CHANNEL, message_json)
            logger.info(f"Published task update for {task_id} ({status}) to {subscribers} subscribers")

            return True
        except Exception as e:
            logger.error(f"Error publishing task update: {e}")
            return False

    def increment_stat(self, stat_key: str, amount: int = 1) -> bool:
        """
        Increment a statistics counter.

        Args:
            stat_key: Statistics key
            amount: Amount to increment

        Returns:
            True if successful, False otherwise
        """
        try:
            self.client.incrby(stat_key, amount)
            return True
        except Exception as e:
            logger.error(f"Error incrementing stat {stat_key}: {e}")
            return False

    def ping(self) -> bool:
        """
        Check if Redis connection is alive.

        Returns:
            True if connected, False otherwise
        """
        try:
            return self.client.ping()
        except Exception as e:
            logger.error(f"Redis ping failed: {e}")
            return False

    def close(self):
        """Close Redis connection"""
        try:
            self.client.close()
            logger.info("Redis client connection closed")
        except Exception as e:
            logger.error(f"Error closing Redis connection: {e}")
