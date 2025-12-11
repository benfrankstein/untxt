#!/usr/bin/env python3
"""
Worker Pool Manager
Spawns and manages persistent Qwen3VL workers
Started by backend on initialization, runs until backend shutdown
"""

import os
import sys
import signal
import logging
import multiprocessing as mp
from typing import List
import time

from config import Config
from qwen_worker import QwenWorker
from redis_client import RedisClient

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('worker_pool_manager')


def _worker_target(worker_id: int):
    """Worker target function - must be at module level for pickling"""
    worker = QwenWorker(worker_id=worker_id, gpu_id=0)
    worker.run()


class WorkerPoolManager:
    """Manages a pool of persistent Qwen3VL workers"""

    def __init__(self):
        self.workers: List[mp.Process] = []
        self.running = False
        self.worker_count = self._determine_worker_count()
        self.redis_client = None

        # Register signal handlers for graceful shutdown
        signal.signal(signal.SIGTERM, self._handle_shutdown)
        signal.signal(signal.SIGINT, self._handle_shutdown)

        logger.info(f"Worker Pool Manager initialized (will spawn {self.worker_count} workers)")

    def _determine_worker_count(self) -> int:
        """Determine number of workers based on environment and VRAM"""
        env = os.getenv('NODE_ENV', 'development')

        if env == 'production':
            # Auto-detect VRAM and calculate worker count
            try:
                import torch
                if torch.cuda.is_available():
                    vram_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
                    logger.info(f"Detected {vram_gb:.1f}GB VRAM")

                    # Conservative calculation: ~28GB per worker
                    # Model (16GB) + KV cache/activations (8-12GB) = ~24-28GB
                    # Use 75% of available VRAM to leave headroom
                    GB_PER_WORKER = 28
                    worker_count = int((vram_gb * 0.75) / GB_PER_WORKER)

                    # Clamp between 1-4 workers for safety
                    worker_count = max(1, min(worker_count, 4))

                    logger.info(f"Calculated {worker_count} workers for {vram_gb:.1f}GB VRAM")
                    logger.info(f"  → Estimated memory per worker: {GB_PER_WORKER}GB")
                    logger.info(f"  → Total estimated usage: {worker_count * GB_PER_WORKER}GB / {vram_gb:.1f}GB")

                    return worker_count
                else:
                    logger.warning("No CUDA GPU detected, using 1 worker")
                    return 1
            except Exception as e:
                logger.error(f"Failed to detect VRAM: {e}, defaulting to 1 worker")
                return 1
        else:
            # Development: use 1 worker
            logger.info("Development mode: using 1 worker")
            return 1

    def _spawn_worker(self, worker_id: int) -> mp.Process:
        """Spawn a single worker process"""
        process = mp.Process(
            target=_worker_target,
            args=(worker_id,),
            name=f'qwen-worker-{worker_id}',
            daemon=False  # Not daemon - we want graceful shutdown
        )
        process.start()
        logger.info(f"Spawned worker {worker_id} (PID: {process.pid})")
        return process

    def _wait_for_worker_ready(self, worker_id: int, timeout: int = 120) -> bool:
        """Wait for worker to signal it's ready (model loaded)"""
        redis_client = RedisClient()
        ready_key = f'ocr:worker:{worker_id}:ready'

        logger.info(f"Waiting for worker {worker_id} to finish loading model...")
        start_time = time.time()

        while (time.time() - start_time) < timeout:
            if redis_client.client.get(ready_key):
                elapsed = time.time() - start_time
                logger.info(f"✓ Worker {worker_id} ready (model loaded in {elapsed:.1f}s)")
                redis_client.close()
                return True
            time.sleep(0.5)  # Poll every 500ms

        logger.error(f"✗ Worker {worker_id} failed to signal ready within {timeout}s")
        redis_client.close()
        return False

    def start(self):
        """Start all workers"""
        logger.info(f"Starting {self.worker_count} workers...")
        self.running = True

        # Spawn workers sequentially to avoid concurrent model loading
        for i in range(self.worker_count):
            worker_process = self._spawn_worker(worker_id=i+1)
            self.workers.append(worker_process)

            # Wait for this worker to load model before spawning next
            if i < self.worker_count - 1:
                if not self._wait_for_worker_ready(worker_id=i+1):
                    logger.error(f"Worker {i+1} failed to initialize properly")
                    # Continue anyway, but log the issue

        # Register workers in Redis (heartbeat)
        self._register_workers()

        logger.info(f"✓ All {self.worker_count} workers started")

        # Monitor workers and restart if they crash
        self._monitor_workers()

    def _ensure_redis_connection(self):
        """Ensure Redis connection is alive, reconnect if needed"""
        try:
            # Test if connection exists and is alive
            if self.redis_client is not None:
                self.redis_client.client.ping()
                return True
        except Exception:
            # Connection dead, will reconnect below
            pass

        # Create new connection
        try:
            self.redis_client = RedisClient()
            logger.info("Redis connection established for heartbeat")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            return False

    def _register_workers(self):
        """Register workers in Redis for backend to detect"""
        try:
            # Ensure connection is alive
            if not self._ensure_redis_connection():
                return

            # Update heartbeat
            self.redis_client.client.setex(
                'ocr:workers:count',
                60,  # Heartbeat every 60s
                str(self.worker_count)
            )
        except Exception as e:
            logger.error(f"Failed to register workers in Redis: {e}")
            # Reset connection for next attempt
            self.redis_client = None

    def _monitor_workers(self):
        """Monitor workers and restart if crashed"""
        while self.running:
            try:
                # Check each worker
                for i, worker_process in enumerate(self.workers):
                    if not worker_process.is_alive():
                        logger.error(f"Worker {i+1} crashed! Restarting...")

                        # Restart worker
                        new_process = self._spawn_worker(worker_id=i+1)
                        self.workers[i] = new_process

                # Update heartbeat in Redis
                self._register_workers()

                # Sleep before next check
                time.sleep(5)

            except Exception as e:
                logger.error(f"Error in worker monitor: {e}")
                time.sleep(5)

    def _handle_shutdown(self, signum, frame):
        """Handle shutdown signals"""
        logger.info(f"Received signal {signum}, shutting down...")
        self.stop()

    def stop(self):
        """Stop all workers gracefully"""
        if not self.running:
            return

        logger.info("Stopping all workers...")
        self.running = False

        # Send SIGTERM to all workers
        for worker_process in self.workers:
            if worker_process.is_alive():
                logger.info(f"Sending SIGTERM to worker PID {worker_process.pid}")
                worker_process.terminate()

        # Wait for graceful shutdown
        for worker_process in self.workers:
            worker_process.join(timeout=10)
            if worker_process.is_alive():
                logger.warning(f"Worker PID {worker_process.pid} did not stop, forcing kill")
                worker_process.kill()

        # Close Redis connection
        if self.redis_client is not None:
            try:
                self.redis_client.close()
                logger.info("Redis connection closed")
            except Exception as e:
                logger.warning(f"Error closing Redis connection: {e}")

        logger.info("✓ All workers stopped")
        sys.exit(0)


def main():
    """Main entry point"""
    logger.info("="*60)
    logger.info("Qwen3VL Worker Pool Manager")
    logger.info("="*60)

    # Create and start manager
    manager = WorkerPoolManager()
    manager.start()


if __name__ == '__main__':
    # Required for multiprocessing on some platforms
    mp.set_start_method('spawn', force=True)
    main()
