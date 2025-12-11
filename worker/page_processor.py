"""
Page Processor for HTML and JSON extraction using MLX
Based on PRISM_MASTER_001.py and PRISM_key_values_001.py
"""

import logging
import re
import json
from pathlib import Path
from datetime import datetime
from PIL import Image
from typing import Dict, Any

from model_loader import (
    generate_with_mlx,
    get_generation_params_html,
    get_generation_params_json
)
from prompts import (
    get_html_system_prompt,
    get_html_user_prompt,
    get_json_system_prompt,
    get_json_user_prompt,
    get_language_detection_prompt
)
from html_reconstructor import reconstruct_html_with_positioning

logger = logging.getLogger(__name__)


def extract_plain_text_from_html(html: str) -> str:
    """
    Extract plain text from HTML
    Strips all HTML tags and decodes entities

    Args:
        html: HTML content (with or without tags)

    Returns:
        Plain text string
    """
    from bs4 import BeautifulSoup

    # Parse HTML
    soup = BeautifulSoup(html, 'html.parser')

    # Get text with space separators between elements
    text = soup.get_text(separator=' ', strip=True)

    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text).strip()

    return text

# Setup model output logging directory
MODEL_OUTPUT_LOG_DIR = Path(__file__).parent.parent / 'logs' / 'model_outputs'
MODEL_OUTPUT_LOG_DIR.mkdir(parents=True, exist_ok=True)


def _log_model_output(output: str, task_id: str, page_number: int, format_type: str):
    """Log raw model output to separate file for debugging"""
    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    filename = f"{task_id}_page{page_number}_{format_type}_{timestamp}.txt"
    filepath = MODEL_OUTPUT_LOG_DIR / filename

    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(f"Task ID: {task_id}\n")
            f.write(f"Page: {page_number}\n")
            f.write(f"Format: {format_type}\n")
            f.write(f"Timestamp: {timestamp}\n")
            f.write(f"Output Length: {len(output)} chars\n")
            f.write("=" * 80 + "\n\n")
            f.write(output)
        logger.info(f"Raw model output saved to: {filepath}")
    except Exception as e:
        logger.warning(f"Failed to save model output to file: {e}")


def detect_language(model, processor, config, image_path: str) -> str:
    """
    Detect document language using Qwen VLM with MLX
    From PRISM_MASTER_001.py lines 357-401

    Args:
        model: MLX model
        processor: AutoProcessor
        config: Model config
        image_path: Path to image file

    Returns:
        Detected language (e.g., "English", "German")
    """
    logger.info("Detecting language...")

    system_prompt = "You are a language detection assistant."
    user_prompt = get_language_detection_prompt()

    # Combine prompts for MLX
    full_prompt = f"{system_prompt}\n\n{user_prompt}"

    # Generate with MLX
    output = generate_with_mlx(
        model,
        processor,
        config,
        image_path,
        full_prompt,
        {
            'temp': 0.0,
            'max_tokens': 20,
        }
    )

    language = output.strip().split('\n')[0]  # Take first line only
    logger.info(f"✓ Detected language: {language}")
    return language


def process_html_page(
    model,
    processor,
    config,
    image_path: str,
    page_number: int
) -> Dict[str, Any]:
    """
    Process a single page to HTML format using MLX
    Based on PRISM_MASTER_001.py step4_generate_html (lines 761-876)

    Args:
        model: MLX model
        processor: AutoProcessor
        config: Model config
        image_path: Path to page image
        page_number: Page number (for metadata)

    Returns:
        Dict with 'html_output', 'language', 'processing_time_ms'
    """
    import time
    start_time = time.time()

    logger.info(f"Processing page {page_number} for HTML...")

    # Load image to get dimensions
    image = Image.open(image_path).convert("RGB")
    dimensions = {
        'width': image.width,
        'height': image.height,
        'aspect_ratio': image.width / image.height
    }

    # Detect language
    language = detect_language(model, processor, config, image_path)

    # Prepare prompts for HTML generation
    system_prompt = get_html_system_prompt()
    user_prompt = get_html_user_prompt(language)

    # Combine prompts for MLX
    full_prompt = f"{system_prompt}\n\n{user_prompt}"

    # Get generation parameters
    gen_params = get_generation_params_html()

    # Generate HTML with MLX
    logger.info(f"Generating HTML for page {page_number}...")
    qwenvl_html = generate_with_mlx(
        model,
        processor,
        config,
        image_path,
        full_prompt,
        gen_params
    )

    logger.info(f"Generated {len(qwenvl_html)} chars of HTML")

    # Log raw output to file for debugging
    try:
        # Extract task_id from image_path if possible
        task_id = Path(image_path).stem.rsplit('_page_', 1)[0] if '_page_' in Path(image_path).stem else 'unknown'
        _log_model_output(qwenvl_html, task_id, page_number, 'html')
    except Exception as e:
        logger.warning(f"Failed to log model output: {e}")

    # Remove markdown fences if present
    if qwenvl_html.startswith("```"):
        qwenvl_html = re.sub(r'^```(?:html|[a-z]*)\s*\n?', '', qwenvl_html)
        qwenvl_html = re.sub(r'\n?```\s*$', '', qwenvl_html)

    # Extract plain text BEFORE reconstruction (raw HTML with text content)
    logger.info(f"Extracting plain text for page {page_number}...")
    plain_text = extract_plain_text_from_html(qwenvl_html)
    logger.info(f"✓ Extracted {len(plain_text)} chars of text")

    # Reconstruct HTML with absolute positioning (like PRISM_MASTER_001.py)
    logger.info(f"Reconstructing HTML with positioning for page {page_number}...")
    final_html = reconstruct_html_with_positioning(qwenvl_html, dimensions, language)
    logger.info(f"✓ Reconstructed HTML: {len(final_html)} chars")

    processing_time = int((time.time() - start_time) * 1000)

    logger.info(f"✓ Page {page_number} HTML completed in {processing_time}ms")

    return {
        'html_output': final_html,  # Full page with positioning
        'text_output': plain_text,   # Plain text extraction
        'language': language,
        'dimensions': dimensions,
        'processing_time_ms': processing_time,
        'page_number': page_number,
        'format_type': 'html'
    }


def process_json_page(
    model,
    processor,
    config,
    image_path: str,
    page_number: int
) -> Dict[str, Any]:
    """
    Process a single page to JSON key-value format using MLX
    Based on PRISM_key_values_001.py extract() (lines 112-172)

    Args:
        model: MLX model
        processor: AutoProcessor
        config: Model config
        image_path: Path to page image
        page_number: Page number (for metadata)

    Returns:
        Dict with 'json_output', 'document_type', 'extracted_pairs', 'processing_time_ms'
    """
    import time
    start_time = time.time()

    logger.info(f"Processing page {page_number} for JSON...")

    # Prepare prompts for JSON extraction
    system_prompt = get_json_system_prompt()
    user_prompt = get_json_user_prompt()

    # Combine prompts for MLX
    full_prompt = f"{system_prompt}\n\n{user_prompt}"

    # Get generation parameters
    gen_params = get_generation_params_json()

    # Generate JSON with MLX
    logger.info(f"Generating JSON for page {page_number}...")
    output_text = generate_with_mlx(
        model,
        processor,
        config,
        image_path,
        full_prompt,
        gen_params
    )

    logger.info(f"Generated {len(output_text)} chars of output")

    # Log raw output to file for debugging
    try:
        # Extract task_id from image_path if possible
        task_id = Path(image_path).stem.rsplit('_page_', 1)[0] if '_page_' in Path(image_path).stem else 'unknown'
        _log_model_output(output_text, task_id, page_number, 'json')
    except Exception as e:
        logger.warning(f"Failed to log model output: {e}")

    # Parse JSON from output (from PRISM_key_values lines 159-172)
    json_match = re.search(r"\{.*\}", output_text, re.DOTALL)
    if json_match:
        try:
            result = json.loads(json_match.group(0))
            logger.info(f"✓ Extracted {len(result.get('extracted_pairs', []))} key-value pairs")
            logger.info(f"✓ Document type: {result.get('document_type', 'unknown')}")

            processing_time = int((time.time() - start_time) * 1000)

            return {
                'json_output': result,
                'document_type': result.get('document_type', 'unknown'),
                'extracted_pairs': result.get('extracted_pairs', []),
                'processing_time_ms': processing_time,
                'page_number': page_number,
                'format_type': 'json'
            }
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")
            processing_time = int((time.time() - start_time) * 1000)
            return {
                'error': 'invalid json',
                'raw': output_text,
                'processing_time_ms': processing_time,
                'page_number': page_number,
                'format_type': 'json'
            }
    else:
        logger.error("No valid JSON found in output")
        processing_time = int((time.time() - start_time) * 1000)
        return {
            'error': 'no valid json',
            'raw': output_text,
            'processing_time_ms': processing_time,
            'page_number': page_number,
            'format_type': 'json'
        }
