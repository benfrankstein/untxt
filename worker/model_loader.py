"""
Model Loader for Qwen3-VL using MLX (Apple Silicon optimized)
Handles model initialization and caching
Based on PRISM_MASTER_001.py and PRISM_key_values_001.py
"""

import os
import logging
from pathlib import Path
from typing import Tuple, Dict, Any

from mlx_vlm import load, generate
from mlx_vlm.prompt_utils import apply_chat_template
from mlx_vlm.utils import load_config
from transformers import AutoProcessor

logger = logging.getLogger(__name__)

# Model caches (singleton pattern)
_MODEL_CACHE = None
_PROCESSOR_CACHE = None
_CONFIG_CACHE = None


def load_qwen_model(model_path: str = None) -> Tuple[Any, AutoProcessor, Dict]:
    """
    Load Qwen3-VL model with MLX (cached singleton)

    MLX is optimized for Apple Silicon and provides:
    - 5-10x faster inference vs CPU-only vLLM
    - Native Metal GPU acceleration
    - Lower memory footprint

    Args:
        model_path: Path to model directory. If None, uses env var or default.

    Returns:
        Tuple of (model, processor, config)
    """
    global _MODEL_CACHE, _PROCESSOR_CACHE, _CONFIG_CACHE

    # Return cached if available
    if _MODEL_CACHE is not None and _PROCESSOR_CACHE is not None:
        logger.info("Using cached model")
        return _MODEL_CACHE, _PROCESSOR_CACHE, _CONFIG_CACHE

    # Determine model path
    if model_path is None:
        # Default to local models directory
        default_path = str(Path(__file__).parent.parent / 'models' / 'qwen3_vl_8b_model')
        model_path = os.getenv('MODEL_PATH', default_path)

    logger.info(f"Loading Qwen3-VL-8B from: {model_path}")
    logger.info("Using MLX (Apple Silicon optimized)")

    # Validate model path exists
    if not Path(model_path).exists():
        raise FileNotFoundError(
            f"Model not found at {model_path}. "
            "Please run download_model.py first."
        )

    try:
        # Load model with MLX
        logger.info("Loading model with MLX (this may take 30-60 seconds)...")

        # MLX load returns (model, processor)
        _MODEL_CACHE, _PROCESSOR_CACHE = load(model_path)

        # Load config for model metadata
        _CONFIG_CACHE = load_config(model_path)

        logger.info("✓ Model loaded successfully with MLX")
        logger.info(f"  Model: {model_path}")
        logger.info(f"  Ready for inference on Apple Silicon GPU")

        return _MODEL_CACHE, _PROCESSOR_CACHE, _CONFIG_CACHE

    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        raise


def get_generation_params_html() -> Dict[str, Any]:
    """
    Get generation parameters for HTML generation
    From PRISM_MASTER_001.py lines 845-852
    """
    return {
        'temp': 0.1,
        'max_tokens': 16384,
        'repetition_penalty': 1.05,
        'top_p': 0.4,
    }


def get_generation_params_json() -> Dict[str, Any]:
    """
    Get generation parameters for JSON extraction
    From PRISM_key_values_001.py line 151
    """
    return {
        'temp': 0.0,
        'max_tokens': 4096,
    }


def generate_with_mlx(model, processor, config, image_path: str, prompt: str, generation_params: Dict[str, Any]) -> str:
    """
    Generate text using MLX model

    Args:
        model: MLX model instance
        processor: Processor instance
        config: Model config
        image_path: Path to image file
        prompt: Text prompt
        generation_params: Generation parameters (temp, max_tokens, etc.)

    Returns:
        Generated text
    """
    # Apply chat template to format prompt correctly
    formatted_prompt = apply_chat_template(
        processor,
        config,
        prompt,
        num_images=1
    )

    # Generate with MLX
    # Correct signature: generate(model, processor, prompt, image=..., **kwargs)
    result = generate(
        model,
        processor,
        formatted_prompt,
        image=image_path,
        **generation_params,
        verbose=False
    )

    # Extract text from GenerationResult object
    return result.text


def unload_model():
    """Unload model from memory (for testing/cleanup)"""
    global _MODEL_CACHE, _PROCESSOR_CACHE, _CONFIG_CACHE

    if _MODEL_CACHE is not None:
        del _MODEL_CACHE
        _MODEL_CACHE = None

    if _PROCESSOR_CACHE is not None:
        del _PROCESSOR_CACHE
        _PROCESSOR_CACHE = None

    if _CONFIG_CACHE is not None:
        del _CONFIG_CACHE
        _CONFIG_CACHE = None

    logger.info("Model unloaded from cache")
