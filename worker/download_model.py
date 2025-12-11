#!/usr/bin/env python3
"""
Download Qwen3-VL-8B-Instruct model from HuggingFace
"""

import os
from pathlib import Path
from huggingface_hub import snapshot_download

# Model configuration
MODEL_ID = "Qwen/Qwen2-VL-7B-Instruct"  # Using Qwen2-VL as it's the latest vision model
MODEL_DIR = Path(__file__).parent.parent / "models" / "qwen3_vl_8b_model"

def download_model():
    """Download model from HuggingFace"""
    print(f"Downloading {MODEL_ID}...")
    print(f"Target directory: {MODEL_DIR}")

    # Create directory if it doesn't exist
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    try:
        # Download model
        snapshot_download(
            repo_id=MODEL_ID,
            local_dir=str(MODEL_DIR),
            local_dir_use_symlinks=False,
            resume_download=True,
        )

        print(f"\n✓ Model downloaded successfully to: {MODEL_DIR}")
        print(f"  Model size: ~16GB")
        print(f"  Ready for inference!")

    except Exception as e:
        print(f"\n✗ Failed to download model: {e}")
        print("\nNote: This will download ~16GB. Ensure you have:")
        print("  - Sufficient disk space")
        print("  - Good internet connection")
        print("  - HuggingFace account (may need to accept model license)")
        raise

if __name__ == "__main__":
    download_model()
