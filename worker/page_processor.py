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


def process_kvp_page(
    model,
    processor,
    config,
    image_path: str,
    page_number: int,
    selected_kvps: list = None
) -> Dict[str, Any]:
    """
    Process a single page for KVP extraction using PRISM V008 prompt

    Args:
        model: MLX model
        processor: AutoProcessor
        config: Model config
        image_path: Path to page image
        page_number: Page number (for metadata)
        selected_kvps: Optional list of specific KVP keys to extract

    Returns:
        Dict with 'kvp_output', 'html_output', 'processing_time_ms'
    """
    import time
    from kvp_processor import (
        build_kvp_extraction_prompt,
        load_master_kvps,
        normalize_extracted_output,
        build_alias_map,
        build_structured_output
    )
    from kvp_to_html import kvp_json_to_html

    start_time = time.time()

    logger.info(f"Processing page {page_number} for KVP extraction...")

    # Log selected KVPs if provided
    if selected_kvps:
        logger.info(f"Selected KVPs for extraction: {len(selected_kvps)} fields")
        logger.debug(f"Selected KVP list: {selected_kvps}")
    else:
        logger.info("No specific KVPs selected - extracting all fields")

    # Load master KVPs
    master_kvps = load_master_kvps()
    if master_kvps:
        total_keys = len(master_kvps['keys'])
        total_sectors = len(master_kvps['sectors'])
        logger.info(f"✓ Loaded {total_keys} master KVPs from {total_sectors} sectors")
    else:
        logger.warning("⚠ No master KVPs loaded, using open-ended extraction")

    # Build KVP extraction prompt
    prompt = build_kvp_extraction_prompt(selected_kvps)

    # Log the full prompt being sent to Qwen
    logger.info("=" * 80)
    logger.info("PROMPT SENT TO QWEN MODEL:")
    logger.info("=" * 80)
    logger.info(prompt)
    logger.info("=" * 80)

    # Generate KVP extraction with MLX
    logger.info(f"Generating KVP extraction for page {page_number}...")
    output_text = generate_with_mlx(
        model,
        processor,
        config,
        image_path,
        prompt,
        {
            'temp': 0.0,
            'max_tokens': 20480,  # Increased for KVP extraction
        }
    )

    logger.info(f"Generated {len(output_text)} chars of output")

    # Log the raw model output to console
    logger.info("=" * 80)
    logger.info("RAW MODEL OUTPUT (KVP EXTRACTION):")
    logger.info("=" * 80)
    logger.info(output_text[:2000] + ("..." if len(output_text) > 2000 else ""))  # First 2000 chars
    logger.info("=" * 80)

    # Log raw output to file for debugging
    try:
        task_id = Path(image_path).stem.rsplit('_page_', 1)[0] if '_page_' in Path(image_path).stem else 'unknown'
        _log_model_output(output_text, task_id, page_number, 'kvp')
    except Exception as e:
        logger.warning(f"Failed to log model output: {e}")

    # Parse JSON from output
    json_match = re.search(r"\{.*\}", output_text, re.DOTALL)
    if json_match:
        try:
            raw_result = json.loads(json_match.group(0))

            # Check if it's the new format {items: [], tables: []}
            if 'items' in raw_result or 'tables' in raw_result:
                items_count = len(raw_result.get('items', []))
                tables_count = len(raw_result.get('tables', []))
                table_rows = sum(len(t.get('rows', [])) for t in raw_result.get('tables', []))

                logger.info(f"✓ Raw extraction: {items_count} items, {tables_count} tables ({table_rows} rows)")

                # Check if user selected specific KVPs
                if selected_kvps and len(selected_kvps) > 0:
                    # Build alias map for matching
                    alias_map = build_alias_map(master_kvps) if master_kvps else ({}, {})

                    # Build structured output with ONLY selected keys
                    structured_output = build_structured_output(raw_result, selected_kvps, alias_map)

                    logger.info(f"✓ Structured output: {len(structured_output)} selected fields")

                    # Log structured output
                    logger.info("=" * 80)
                    logger.info("STRUCTURED OUTPUT (SELECTED FIELDS ONLY):")
                    logger.info("=" * 80)
                    for key, value in structured_output.items():
                        status = "✓" if value else "✗"
                        logger.info(f"  {status} {key}: {value or '(not found)'}")
                    logger.info("=" * 80)

                    # IMPORTANT: Store RAW extraction (items array) for S3, not structured output
                    # This preserves multiple values for the same key
                    kvp_output = raw_result  # Keep items array format
                    html_output = kvp_json_to_html({'structured': structured_output, 'selected_kvps': selected_kvps})

                else:
                    # No specific KVPs selected - use full categorized output
                    normalized_result = normalize_extracted_output(raw_result, master_kvps)

                    total_pairs = sum(
                        len(items) for cat, items in normalized_result['fields'].items()
                        if cat != 'line_items' and isinstance(items, list)
                    )
                    line_items = normalized_result['fields']['line_items']

                    logger.info(f"✓ Normalized: {total_pairs} KVPs categorized, {len(line_items)} line items")

                    # Log normalized output summary
                    logger.info("=" * 80)
                    logger.info("NORMALIZED OUTPUT SUMMARY:")
                    logger.info("=" * 80)
                    for category, items in normalized_result['fields'].items():
                        if category != 'line_items' and isinstance(items, list):
                            logger.info(f"  {category}: {len(items)} items")
                            for item in items[:3]:  # Show first 3 items
                                logger.info(f"    - {item.get('standardized_key', 'N/A')}: {item.get('value', 'N/A')}")
                            if len(items) > 3:
                                logger.info(f"    ... and {len(items) - 3} more")
                    logger.info(f"  line_items: {len(line_items)} rows")
                    logger.info("=" * 80)

                    # Use normalized result as the KVP output
                    kvp_output = normalized_result
                    html_output = kvp_json_to_html(normalized_result)

                processing_time = int((time.time() - start_time) * 1000)

                logger.info(f"✓ Page {page_number} KVP extraction completed in {processing_time}ms")

                return {
                    'kvp_output': kvp_output,  # Structured KVP data (either structured_output or normalized_result)
                    'html_output': html_output,       # HTML for viewing
                    'processing_time_ms': processing_time,
                    'page_number': page_number,
                    'format_type': 'kvp'
                }
            else:
                logger.error("Unknown JSON format from model")
                processing_time = int((time.time() - start_time) * 1000)
                return {
                    'error': 'unknown format',
                    'raw': output_text,
                    'processing_time_ms': processing_time,
                    'page_number': page_number,
                    'format_type': 'kvp'
                }

        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")
            processing_time = int((time.time() - start_time) * 1000)
            return {
                'error': 'invalid json',
                'raw': output_text,
                'processing_time_ms': processing_time,
                'page_number': page_number,
                'format_type': 'kvp'
            }
    else:
        logger.error("No valid JSON found in output")
        processing_time = int((time.time() - start_time) * 1000)
        return {
            'error': 'no valid json',
            'raw': output_text,
            'processing_time_ms': processing_time,
            'page_number': page_number,
            'format_type': 'kvp'
        }


def process_anon_page(
    model,
    processor,
    config,
    image_path: str,
    page_number: int,
    strategy: str = 'synthetic',
    generate_audit: bool = False,
    selected_fields: list = None
) -> Dict[str, Any]:
    """
    Process a single page for PII anonymization.
    First extracts ALL key-value pairs, then applies anonymization strategy.

    Args:
        model: MLX model
        processor: AutoProcessor
        config: Model config
        image_path: Path to page image
        page_number: Page number (for metadata)
        strategy: Anonymization strategy ('synthetic', 'redact', 'generalize', 'mask')
        generate_audit: Whether to generate compliance audit trail
        selected_fields: Optional list of fields user is interested in (for logging)

    Returns:
        Dict with 'anon_json', 'anon_txt', 'anon_mapping', 'anon_audit' (optional)
    """
    import time
    from anon_processor import (
        build_anon_extraction_prompt,
        anonymize_extracted_data,
        generate_tokenized_output
    )

    start_time = time.time()

    logger.info(f"Processing page {page_number} for anonymization (strategy: {strategy})...")

    if selected_fields:
        logger.info(f"User interested in: {len(selected_fields)} fields")
    else:
        logger.info("Extracting ALL fields for anonymization")

    # Build anonymization extraction prompt (extracts everything)
    prompt = build_anon_extraction_prompt(selected_fields)

    # Log prompt
    logger.info("=" * 80)
    logger.info("ANONYMIZATION PROMPT:")
    logger.info("=" * 80)
    logger.info(prompt[:500] + "..." if len(prompt) > 500 else prompt)
    logger.info("=" * 80)

    # Generate extraction with MLX
    logger.info(f"Extracting ALL fields from page {page_number}...")
    output_text = generate_with_mlx(
        model,
        processor,
        config,
        image_path,
        prompt,
        {
            'temp': 0.0,
            'max_tokens': 20480,
        }
    )

    logger.info(f"Generated {len(output_text)} chars of output")

    # Log raw output
    logger.info("=" * 80)
    logger.info("RAW EXTRACTION OUTPUT:")
    logger.info("=" * 80)
    logger.info(output_text[:1000] + ("..." if len(output_text) > 1000 else ""))
    logger.info("=" * 80)

    # Log to file
    try:
        task_id = Path(image_path).stem.rsplit('_page_', 1)[0] if '_page_' in Path(image_path).stem else 'unknown'
        _log_model_output(output_text, task_id, page_number, 'anon_extraction')
    except Exception as e:
        logger.warning(f"Failed to log model output: {e}")

    # Parse JSON
    json_match = re.search(r"\{.*\}", output_text, re.DOTALL)
    if json_match:
        try:
            raw_extraction = json.loads(json_match.group(0))

            # Check format
            if 'items' in raw_extraction or 'tables' in raw_extraction:
                items_count = len(raw_extraction.get('items', []))
                tables_count = len(raw_extraction.get('tables', []))

                logger.info(f"✓ Extracted: {items_count} items, {tables_count} tables")

                # Apply anonymization
                logger.info(f"Applying {strategy} anonymization...")
                anonymized_data, audit_trail, mapping = anonymize_extracted_data(
                    raw_extraction,
                    strategy=strategy,
                    generate_audit=generate_audit
                )

                logger.info(f"✓ Anonymized {len(mapping)} values")

                # Generate tokenized output
                redacted_lines, token_map = generate_tokenized_output(mapping)

                # Create TXT output
                anon_txt = "\n".join(redacted_lines)

                # Create mapping output
                anon_mapping = {
                    'tokens': token_map,
                    'strategy': strategy,
                    'page_number': page_number,
                    'timestamp': datetime.now().isoformat()
                }

                processing_time = int((time.time() - start_time) * 1000)

                logger.info(f"✓ Page {page_number} anonymization completed in {processing_time}ms")

                result = {
                    'anon_json': anonymized_data,           # Anonymized JSON (with synthetic values)
                    'anon_txt': anon_txt,                   # Tokenized TXT ([NAME_001]: [DATE_001])
                    'anon_mapping': anon_mapping,           # Token → Original mapping
                    'processing_time_ms': processing_time,
                    'page_number': page_number,
                    'format_type': 'anon',
                    'strategy': strategy
                }

                # Add audit trail if requested
                if generate_audit and audit_trail:
                    result['anon_audit'] = {
                        'version': 'ANON_V001',
                        'timestamp': datetime.now().isoformat(),
                        'strategy': strategy,
                        'page_number': page_number,
                        'total_fields': len(audit_trail),
                        'entries': audit_trail
                    }
                    logger.info(f"✓ Generated audit trail with {len(audit_trail)} entries")

                return result

            else:
                logger.error("Unknown JSON format from model")
                processing_time = int((time.time() - start_time) * 1000)
                return {
                    'error': 'unknown format',
                    'raw': output_text,
                    'processing_time_ms': processing_time,
                    'page_number': page_number,
                    'format_type': 'anon'
                }

        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")
            processing_time = int((time.time() - start_time) * 1000)
            return {
                'error': 'invalid json',
                'raw': output_text,
                'processing_time_ms': processing_time,
                'page_number': page_number,
                'format_type': 'anon'
            }
    else:
        logger.error("No valid JSON found in output")
        processing_time = int((time.time() - start_time) * 1000)
        return {
            'error': 'no valid json',
            'raw': output_text,
            'processing_time_ms': processing_time,
            'page_number': page_number,
            'format_type': 'anon'
        }
