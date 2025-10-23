#!/usr/bin/env python3
"""
Test script to verify Redis and PostgreSQL connections
Run this before starting the worker to ensure everything is set up correctly
"""

import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import Config
from redis_client import RedisClient
from db_client import DatabaseClient

def test_redis():
    """Test Redis connection"""
    print("🔄 Testing Redis connection...")
    try:
        client = RedisClient()
        if client.ping():
            print("✅ Redis connection successful!")
            queue_len = client.get_queue_length()
            print(f"   Queue length: {queue_len}")
            client.close()
            return True
        else:
            print("❌ Redis connection failed!")
            return False
    except Exception as e:
        print(f"❌ Redis error: {e}")
        return False

def test_database():
    """Test database connection"""
    print("\n🔄 Testing PostgreSQL connection...")
    try:
        client = DatabaseClient()
        if client.ping():
            print("✅ Database connection successful!")
            # Count tasks
            with client.conn.cursor() as cur:
                # First check if tables exist
                cur.execute("""
                    SELECT COUNT(*)
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'tasks'
                """)
                table_exists = cur.fetchone()[0]

                if table_exists == 0:
                    print("❌ Database tables not initialized!")
                    print("   Run: cd database/scripts && ./setup_database.sh")
                    client.close()
                    return False

                cur.execute("SELECT COUNT(*) FROM tasks")
                count = cur.fetchone()[0]
                print(f"   Tasks in database: {count}")
            client.close()
            return True
        else:
            print("❌ Database connection failed!")
            return False
    except Exception as e:
        print(f"❌ Database error: {e}")
        error_str = str(e)

        if "does not exist" in error_str or "relation" in error_str:
            print("   Database tables not initialized!")
            print("   Run: cd database/scripts && ./setup_database.sh")
        elif "authentication failed" in error_str:
            print("   Check database credentials in worker/.env")
        elif "could not connect" in error_str:
            print("   Make sure PostgreSQL is running: pg_isready")
        else:
            print(f"   Check PostgreSQL status: pg_isready")

        return False

def test_output_dir():
    """Test output directory"""
    print("\n🔄 Testing output directory...")
    try:
        output_dir = Config.OUTPUT_DIR
        if os.path.exists(output_dir):
            print(f"✅ Output directory exists: {output_dir}")
            return True
        else:
            print(f"⚠️  Output directory doesn't exist, creating: {output_dir}")
            os.makedirs(output_dir, exist_ok=True)
            print("✅ Output directory created!")
            return True
    except Exception as e:
        print(f"❌ Output directory error: {e}")
        return False

def main():
    """Run all tests"""
    print("=" * 60)
    print("OCR Worker - Connection Test")
    print("=" * 60)
    print(f"\nConfiguration:")
    print(f"  Worker ID: {Config.WORKER_ID}")
    print(f"  Redis: {Config.REDIS_HOST}:{Config.REDIS_PORT}")
    print(f"  Database: {Config.DB_HOST}:{Config.DB_PORT}/{Config.DB_NAME}")
    print(f"  Output Dir: {Config.OUTPUT_DIR}")
    print("\n" + "=" * 60)

    results = []
    results.append(test_redis())
    results.append(test_database())
    results.append(test_output_dir())

    print("\n" + "=" * 60)
    if all(results):
        print("🎉 All tests passed! Worker is ready to start.")
        print("\nTo start the worker, run:")
        print("  python run_worker.py")
        return 0
    else:
        print("⚠️  Some tests failed. Please fix the issues above.")
        print("\nTroubleshooting:")
        if not results[0]:
            print("  Redis:      redis-server")
        if not results[1]:
            print("  PostgreSQL: brew services start postgresql@16")
            print("  Database:   cd database/scripts && ./setup_database.sh")
        return 1

if __name__ == '__main__':
    sys.exit(main())
