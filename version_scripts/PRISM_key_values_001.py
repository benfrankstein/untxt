#!/usr/bin/env python3
"""
PRISM Key-Value Extraction V008 - HANDWRITING IMPROVEMENTS (hndwrtng)

Based on V007 with enhanced prompt engineering for handwritten text.
No image preprocessing changes - surgical prompt-only improvements.

## V008 Changes from V007:
- Enhanced prompt with handwriting-specific instructions
- Context-based inference for unclear characters
- Number/letter disambiguation rules (0 vs O, 1 vs l, 5 vs S)
- Phone number format hints (10 digits expected)
- Line overlap handling (descenders/ascenders from adjacent lines)
- Crossed-out text handling
- Unreadable character markers (? for single char, [illegible] for word)
- Anti-hallucination rules (null for missing, only extract visible)
- Structure preservation (reading order maintained)
- "uncertain" flag for low-confidence extractions
- Ignore stamps/signatures/scribbles unless data-bearing

## Philosophy:
- Prompt engineering > image preprocessing
- Context helps decode messy text
- Flag uncertainty, don't guess silently

## Usage:
    python PRISM_key_values_V008_hndwrtng.py invoice.pdf
    python PRISM_key_values_V008_hndwrtng.py doc.pdf --benchmark

## Key Normalization:
    - Uses master_kvps.json with 828+ keys across 23 sectors
    - Each key has explicit aliases (multi-language)
    - Unmatched keys go to "other" category - add aliases to fix
"""

import sys
import os
import json
import re
import time
from pathlib import Path
from datetime import datetime

# CRITICAL: Set environment variables BEFORE any CUDA/vLLM imports
os.environ['VLLM_WORKER_MULTIPROC_METHOD'] = 'spawn'
os.environ['VLLM_ENABLE_V1_MULTIPROCESSING'] = '0'
os.environ['NCCL_P2P_DISABLE'] = '0'
os.environ['VLLM_TIMEOUT'] = '300'

from pdf2image import convert_from_path
from vllm import LLM, SamplingParams
from transformers import AutoProcessor
from qwen_vl_utils import process_vision_info

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
logger = logging.getLogger("prism_v8")

# Model caches (singleton pattern)
_LLM_CACHE = None
_PROCESSOR_CACHE = None
_STANDARD_KVPS_CACHE = None


def build_role_and_task_prompt(standard_keys: list = None, use_standard_mode: bool = True) -> str:
    """
    Build the prompt for KVP extraction.
    V6: Single unified prompt - no schema injection, no classification bias.
    Post-processing handles key normalization using standard_kvps.json.
    """
    # Single prompt for ALL documents - V008 with handwriting improvements
    return """Extract all key-value pairs from this document.

EXTRACTION RULES:

1. NON-TABLE CONTENT
   - Key is typically LEFT of or ABOVE its value
   - Extract the key exactly as written, then its associated value
   - Include labels, field names, headings that have corresponding data

2. TABLE CONTENT
   - Column headers become KEYS
   - Each cell value pairs with its column header
   - Extract row by row, preserving row grouping
   - Example: Header "Qty" + cell "10" → {"key": "Qty", "value": "10"}

3. FIDELITY & ANTI-HALLUCINATION
   - Transcribe EXACTLY as visible (no corrections, no assumptions)
   - Preserve original language, formatting, symbols
   - Preserve original reading order and structure (top-to-bottom, left-to-right)
   - If a field label exists but has NO value, use null - do NOT invent values
   - Only extract what is VISIBLE - never guess or assume missing data

4. HANDWRITTEN TEXT
   - Use surrounding context to infer unclear characters
   - For ambiguous characters, prefer what makes semantic sense:
     * In numbers/amounts: prefer digits (0 not O, 1 not l, 5 not S)
     * In names: prefer letters (O not 0, l not 1)
     * In dates: prefer digits
     * Phone numbers: expect 10 digits, area code + 7 digits (e.g., 973-650-3662)
   - LINE OVERLAP: When descenders (g,y,p,j,q) or ascenders (b,d,f,h,k,l,t) from adjacent
     lines cross into another field, parse each field INDEPENDENTLY based on its label.
     Ignore strokes that clearly belong to text on other lines.
   - CROSSED OUT TEXT: If text is struck through or scribbled over, skip it unless
     the replacement value is clearly written nearby.
   - UNREADABLE CHARACTERS:
     * Single unreadable character → replace with ?
     * Entire word unreadable → use [illegible]
     * Example: "Sm?th" for partially readable name, "[illegible]" for completely unreadable
   - If still uncertain after context analysis, provide best guess and mark "uncertain": true
   - IGNORE: stamps, signatures, scribbles, doodles UNLESS they contain actual data values

5. CONFIDENCE + UNCERTAINTY
   - "high": Clear, sharp, machine-printed
   - "medium": Readable but degraded/small
   - "low": Handwritten, faded, partially obscured
   - Add "uncertain": true ONLY when characters are genuinely ambiguous after context analysis

OUTPUT FORMAT (valid JSON only):

{
  "items": [
    {"key": "Invoice No", "value": "12345", "confidence": "high"},
    {"key": "Date", "value": "15.03.2024", "confidence": "high"},
    {"key": "Amount", "value": "150.00", "confidence": "low", "uncertain": true},
    {"key": "Approved By", "value": "J. Smith", "confidence": "low"}
  ],
  "tables": [
    {
      "headers": ["Pos", "Description", "Qty", "Price", "Amount"],
      "rows": [
        {"Pos": "1", "Description": "Widget A", "Qty": "10", "Price": "5.00", "Amount": "50.00", "confidence": "high"},
        {"Pos": "2", "Description": "Widget B", "Qty": "5", "Price": "8.00", "Amount": "40.00", "confidence": "medium"}
      ]
    }
  ]
}

RULES:
- Extract EVERYTHING visible - do not filter or categorize
- If no tables exist, "tables" can be empty array
- If only tables exist, "items" can be empty array
- Do not add keys that don't exist in the document
- Do not guess or hallucinate values
- Use "uncertain": true sparingly - only for genuinely ambiguous handwriting"""


def get_pdf_page_count(pdf_path: str) -> int:
    """Get total number of pages in PDF."""
    try:
        images = convert_from_path(pdf_path, dpi=72)
        return len(images)
    except Exception as e:
        logger.error(f"Error getting page count: {e}")
        return 1


def load_standard_kvps(kvp_path: str = None) -> dict:
    """
    Load standardized KVP list (cached singleton).
    V6: Supports both old standard_kvps.json and new master_kvps.json formats.
    """
    global _STANDARD_KVPS_CACHE

    if _STANDARD_KVPS_CACHE is not None:
        return _STANDARD_KVPS_CACHE

    script_dir = Path(__file__).parent

    # V6: Try master_kvps.json first, fall back to standard_kvps.json
    if kvp_path is None:
        master_path = script_dir / "master_kvps.json"
        standard_path = script_dir / "standard_kvps.json"
        kvp_path = master_path if master_path.exists() else standard_path

    logger.info(f"Loading standardized KVPs from: {kvp_path}")

    try:
        with open(kvp_path, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)

        # V6: Handle new master_kvps.json format (sectors-based)
        if 'sectors' in raw_data:
            # Flatten sectors into unified keys list
            flattened_keys = []
            for sector_id, sector_data in raw_data['sectors'].items():
                sector_name = sector_data.get('name', sector_id)
                for kvp in sector_data.get('kvps', []):
                    flattened_keys.append({
                        'key': kvp['key'],
                        'aliases': kvp.get('aliases', []),
                        'sector': sector_id,
                        'sector_name': sector_name,
                        'category': 'other',  # Will be inferred from key name
                        'required': False
                    })

            _STANDARD_KVPS_CACHE = {
                'version': raw_data.get('version', '1.0'),
                'description': raw_data.get('description', ''),
                'keys': flattened_keys,
                'sectors': raw_data['sectors']  # Keep original for reference
            }
            logger.info(f"✓ Loaded {len(flattened_keys)} KVPs from {len(raw_data['sectors'])} sectors")
        else:
            # Old standard_kvps.json format
            _STANDARD_KVPS_CACHE = raw_data
            logger.info(f"✓ Loaded {len(_STANDARD_KVPS_CACHE['keys'])} standardized keys")

        return _STANDARD_KVPS_CACHE
    except FileNotFoundError:
        logger.warning(f"⚠️  Standard KVP file not found: {kvp_path}")
        logger.warning("⚠️  Falling back to open-ended extraction mode")
        return None
    except json.JSONDecodeError as e:
        logger.error(f"❌ Error parsing KVP JSON: {e}")
        logger.warning("⚠️  Falling back to open-ended extraction mode")
        return None


def load_model(model_path: str = "/workspace/qwen3_vl_8b_model"):
    """
    Load Qwen3-VL model (cached singleton).
    V004: Enhanced with multi-page optimization and speed tweaks.
    """
    global _LLM_CACHE, _PROCESSOR_CACHE

    if _LLM_CACHE is not None and _PROCESSOR_CACHE is not None:
        logger.info("Using cached model")
        return _LLM_CACHE, _PROCESSOR_CACHE

    logger.info(f"Loading Qwen3-VL-8B from: {model_path}")

    _PROCESSOR_CACHE = AutoProcessor.from_pretrained(model_path, trust_remote_code=True)

    # V004: Enhanced with FP8 quantization (if supported) and optimized settings
    # Note: Flash-Attention 2 is handled by vLLM automatically if available
    try:
        _LLM_CACHE = LLM(
            model=model_path,
            limit_mm_per_prompt={"image": 8},  # V004: Increased for multi-page (was 4)
            trust_remote_code=True,
            gpu_memory_utilization=0.75,
            max_model_len=65536,  # V004: Increased for YaRN-style long context (was 32768)
            tensor_parallel_size=1,
            block_size=32,
            dtype="bfloat16",  # V004: Keep bfloat16 (FP8 requires special vLLM build)
            enforce_eager=False,
            max_num_batched_tokens=65536,  # V004: Match max_model_len
            max_num_seqs=1,
            enable_prefix_caching=True,  # V004: Enable for multi-step processing
            enable_chunked_prefill=True,
            disable_log_stats=True,
            max_logprobs=0,
            swap_space=16,
            seed=42
        )
        logger.info("✓ Model loaded successfully with enhanced settings")
    except Exception as e:
        logger.warning(f"⚠️  Enhanced settings failed ({e}), falling back to standard config")
        _LLM_CACHE = LLM(
            model=model_path,
            limit_mm_per_prompt={"image": 4},
            trust_remote_code=True,
            gpu_memory_utilization=0.75,
            max_model_len=32768,
            tensor_parallel_size=1,
            block_size=32,
            dtype="bfloat16",
            enforce_eager=False,
            max_num_batched_tokens=32768,
            max_num_seqs=1,
            enable_prefix_caching=False,
            enable_chunked_prefill=True,
            disable_log_stats=True,
            max_logprobs=0,
            swap_space=16,
            seed=42
        )
        logger.info("✓ Model loaded successfully (standard config)")

    return _LLM_CACHE, _PROCESSOR_CACHE


def build_alias_map(standard_kvps: dict) -> tuple:
    """
    Build lookup maps from standard_kvps.json or master_kvps.json.
    V6: Returns (alias_to_standard, standard_to_info) where info includes sector.
    """
    alias_to_standard = {}
    standard_to_info = {}

    for key_def in standard_kvps['keys']:
        std_key = key_def['key']
        category = key_def.get('category', 'other')
        sector = key_def.get('sector', None)
        sector_name = key_def.get('sector_name', None)

        standard_to_info[std_key] = {
            'category': category,
            'sector': sector,
            'sector_name': sector_name
        }

        # Map all aliases (including the key itself) to the standard key
        for alias in [std_key] + key_def.get('aliases', []):
            alias_to_standard[alias.lower().strip()] = std_key

    return alias_to_standard, standard_to_info


def normalize_extracted_output(raw_output: dict, standard_kvps: dict = None) -> dict:
    """
    V6: Transform raw extraction output {items: [], tables: []}
    into normalized categorized format {fields: {header: [], supplier: [], ...}}.

    Post-processing normalization using standard_kvps.json or master_kvps.json aliases.
    V6: Now includes sector information when using master_kvps.json.
    """
    items = raw_output.get('items', [])
    tables = raw_output.get('tables', [])

    # Initialize output structure
    normalized = {
        'document_type': 'unknown',  # V6: No classification - stays unknown
        'extraction_mode': 'v8_hndwrtng',
        'languages_detected': [],
        'extraction_reasoning': 'V8 single-pass extraction with handwriting improvements',
        'fields': {
            'header': [],
            'supplier': [],
            'customer': [],
            'delivery': [],
            'totals': [],
            'payment': [],
            'line_items': [],
            'other': []
        },
        'sectors_detected': []  # V6: Track which sectors the extracted KVPs belong to
    }

    # Build alias map if standard_kvps available
    alias_to_standard = {}
    standard_to_info = {}  # V6: Now contains {category, sector, sector_name}
    required_keys = set()
    sectors_found = set()

    if standard_kvps:
        alias_to_standard, standard_to_info = build_alias_map(standard_kvps)
        required_keys = {k['key'] for k in standard_kvps['keys'] if k.get('required', False)}

    # Process non-table items
    for item in items:
        raw_key = item.get('key', '')
        value = item.get('value', '')
        confidence = item.get('confidence', 'medium')

        # Normalize key using alias map
        lookup_key = raw_key.lower().strip()
        std_key = alias_to_standard.get(lookup_key, None)

        # V6: Get full info including sector
        key_info = standard_to_info.get(std_key, {}) if std_key else {}
        category = key_info.get('category', 'other')
        sector = key_info.get('sector', None)
        sector_name = key_info.get('sector_name', None)

        # Track detected sectors
        if sector and value:
            sectors_found.add((sector, sector_name))

        normalized_item = {
            'visible_key': raw_key,
            'standardized_key': std_key,
            'value': value,
            'confidence': confidence,
            'required': std_key in required_keys if std_key else False,
            'found': value is not None and value != '',
            'sector': sector,  # V6: Include sector info
            'sector_name': sector_name
        }

        normalized['fields'][category].append(normalized_item)

    # Process tables -> line_items
    for table in tables:
        headers = table.get('headers', [])
        rows = table.get('rows', [])

        for row in rows:
            line_item = {}
            row_confidence = row.get('confidence', 'medium')

            # Each row becomes a line item with normalized column keys
            for header in headers:
                if header in row:
                    lookup_key = header.lower().strip()
                    std_key = alias_to_standard.get(lookup_key, header)
                    line_item[std_key] = row[header]

                    # V6: Track sector from table headers too
                    key_info = standard_to_info.get(std_key, {})
                    sector = key_info.get('sector')
                    sector_name = key_info.get('sector_name')
                    if sector and row.get(header):
                        sectors_found.add((sector, sector_name))

            line_item['confidence'] = row_confidence
            normalized['fields']['line_items'].append(line_item)

    # V6: Add detected sectors to output
    normalized['sectors_detected'] = [
        {'sector_id': s[0], 'sector_name': s[1]}
        for s in sorted(sectors_found, key=lambda x: x[0])
    ]

    # Calculate extraction stats
    total_keys_found = sum(
        1 for cat in normalized['fields'].values()
        for item in cat if isinstance(item, dict) and item.get('found', False)
    )
    required_keys_found = sum(
        1 for cat in normalized['fields'].values()
        for item in cat if isinstance(item, dict)
        and item.get('required', False) and item.get('found', False)
    )

    total_std_keys = len(standard_kvps['keys']) if standard_kvps else 0
    total_required = len(required_keys) if standard_kvps else 5

    normalized['extraction_stats'] = {
        'total_standardized_keys': total_std_keys,
        'keys_found': total_keys_found,
        'line_items_found': len(normalized['fields']['line_items']),
        'required_keys': total_required,
        'required_keys_found': required_keys_found,
        'completeness_pct': round((total_keys_found / total_std_keys) * 100, 1) if total_std_keys > 0 else 0,
        'required_completeness_pct': round((required_keys_found / total_required) * 100, 1) if total_required > 0 else 100.0,
        'sectors_matched': len(sectors_found)  # V6: How many sectors this document matches
    }

    return normalized


def normalize_line_item_keys(line_items: list, standard_kvps: dict) -> list:
    """
    Normalize line item column names to standardized English keys.
    V004: Enhanced to strip confidence field before normalization.
    """
    alias_to_standard, _ = build_alias_map(standard_kvps)

    normalized_items = []
    for item in line_items:
        normalized_item = {}
        for col_key, col_value in item.items():
            if col_key == 'confidence':
                # Preserve confidence as-is
                normalized_item['confidence'] = col_value
            else:
                normalized_key = alias_to_standard.get(col_key.lower().strip(), col_key)
                normalized_item[normalized_key] = col_value
        normalized_items.append(normalized_item)

    return normalized_items


def aggregate_page_results(page_files: list, output_path: Path, standard_kvps: dict = None) -> dict:
    """
    Aggregate multiple per-page JSON outputs into a single unified document.
    V6: Enhanced to handle confidence scores, multi-language detection, and sector tracking.
    """
    logger.info(f"Aggregating {len(page_files)} page results...")

    aggregated = {
        'document_type': 'unknown',  # Will be set from first page's detected type
        'extraction_mode': 'standardized_schema_aggregated_v8',
        'languages_detected': [],
        'extraction_reasoning': '',
        'sectors_detected': [],  # V6: Track sectors across pages
        'fields': {
            'header': [],
            'supplier': [],
            'customer': [],
            'delivery': [],
            'totals': [],
            'payment': [],
            'line_items': [],
            'other': []
        }
    }

    seen_keys = set()
    total_line_items = []
    other_items_set = set()
    languages_set = set()
    sectors_set = set()  # V6: Collect sectors from all pages

    for page_file in sorted(page_files):
        try:
            page_data = json.loads(page_file.read_text(encoding='utf-8'))

            # Collect languages
            if 'languages_detected' in page_data:
                languages_set.update(page_data['languages_detected'])

            # V6: Collect sectors from each page
            for sector in page_data.get('sectors_detected', []):
                sectors_set.add((sector.get('sector_id'), sector.get('sector_name')))

            # Collect document_type (use first page's detected type)
            if aggregated['document_type'] == 'unknown' and 'document_type' in page_data:
                aggregated['document_type'] = page_data['document_type']

            # Collect reasoning (use first page's reasoning)
            if not aggregated['extraction_reasoning'] and 'extraction_reasoning' in page_data:
                aggregated['extraction_reasoning'] = page_data['extraction_reasoning']

            for category, items in page_data.get('fields', {}).items():
                if category == 'line_items':
                    total_line_items.extend(items)
                elif category == 'delivery':
                    aggregated['fields'][category].extend(items)
                elif category == 'other':
                    for item in items:
                        item_signature = (item.get('visible_key'), item.get('value'))
                        if item_signature not in other_items_set:
                            aggregated['fields'][category].append(item)
                            other_items_set.add(item_signature)
                else:
                    for item in items:
                        std_key = item.get('standardized_key')
                        has_value = item.get('value') is not None and item.get('value') != ''

                        if std_key:
                            if std_key not in seen_keys:
                                if has_value:
                                    aggregated['fields'][category].append(item)
                                    seen_keys.add(std_key)
                                elif item.get('required', False):
                                    aggregated['fields'][category].append(item)
                                    seen_keys.add(std_key)
                            elif has_value:
                                existing_idx = next((i for i, existing in enumerate(aggregated['fields'][category])
                                                   if existing.get('standardized_key') == std_key), None)
                                if existing_idx is not None:
                                    existing_item = aggregated['fields'][category][existing_idx]
                                    existing_has_value = existing_item.get('value') is not None and existing_item.get('value') != ''
                                    if not existing_has_value:
                                        aggregated['fields'][category][existing_idx] = item
                                        logger.info(f"✓ Replaced null '{std_key}' with value from page")
        except Exception as e:
            logger.warning(f"Error reading {page_file}: {e}")

    aggregated['languages_detected'] = sorted(list(languages_set))

    # V6: Add aggregated sectors
    aggregated['sectors_detected'] = [
        {'sector_id': s[0], 'sector_name': s[1]}
        for s in sorted(sectors_set, key=lambda x: x[0] or '')
    ]

    # Cross-Category Normalization
    if standard_kvps:
        logger.info("Applying cross-category normalization...")
        category_map = {k['key']: k['category'] for k in standard_kvps['keys']}

        for source_category in ['header', 'supplier', 'customer', 'delivery', 'totals', 'payment', 'other']:
            items_to_remove = []
            items_to_move = []

            for item in aggregated['fields'][source_category]:
                std_key = item.get('standardized_key')
                if std_key and std_key in category_map:
                    correct_category = category_map[std_key]
                    if correct_category != source_category:
                        items_to_remove.append(item)
                        items_to_move.append((correct_category, item))

            for item in items_to_remove:
                aggregated['fields'][source_category].remove(item)

            for dest_category, item in items_to_move:
                std_key = item.get('standardized_key')
                if not any(existing.get('standardized_key') == std_key
                          for existing in aggregated['fields'][dest_category]):
                    aggregated['fields'][dest_category].append(item)
                    logger.info(f"✓ Moved '{std_key}' from '{source_category}' to '{dest_category}'")

    # Normalize line items
    if standard_kvps and total_line_items:
        logger.info(f"Normalizing {len(total_line_items)} line items to standardized keys...")
        total_line_items = normalize_line_item_keys(total_line_items, standard_kvps)

    aggregated['fields']['line_items'] = total_line_items

    # Recalculate stats
    total_keys_found = sum(1 for cat in aggregated['fields'].values()
                          for item in cat if item.get('found', False))
    required_keys_found = sum(1 for cat in aggregated['fields'].values()
                              for item in cat if item.get('required', False) and item.get('found', False))
    total_required = sum(1 for cat in aggregated['fields'].values()
                        for item in cat if item.get('required', False))

    # Calculate total standardized keys dynamically from schema
    total_std_keys = len(standard_kvps['keys']) if standard_kvps else 108

    aggregated['extraction_stats'] = {
        'total_standardized_keys': total_std_keys,
        'keys_found': total_keys_found,
        'line_items_found': len(total_line_items),
        'required_keys': total_required if total_required > 0 else 5,
        'required_keys_found': required_keys_found,
        'completeness_pct': round((total_keys_found / total_std_keys) * 100, 1),
        'required_completeness_pct': round((required_keys_found / max(total_required, 5)) * 100, 1),
        'sectors_matched': len(sectors_set)  # V6: How many sectors this document matches
    }

    output_path.write_text(json.dumps(aggregated, indent=2, ensure_ascii=False), encoding='utf-8')

    logger.info(f"✓ Aggregated: {total_keys_found} keys, {len(total_line_items)} line items")
    logger.info(f"✓ Required completeness: {aggregated['extraction_stats']['required_completeness_pct']}%")
    if sectors_set:
        sector_names = [s[1] for s in sectors_set if s[1]]
        logger.info(f"✓ Sectors detected: {len(sectors_set)} ({', '.join(sector_names[:3])}{'...' if len(sector_names) > 3 else ''})")

    return aggregated


def enforce_schema(extracted_data: dict, standard_kvps: dict) -> dict:
    """
    Post-process extracted data to enforce standardized schema.
    V004: Enhanced to handle confidence scores and extraction_reasoning.
    """
    if not standard_kvps or "error" in extracted_data:
        return extracted_data

    document_type = extracted_data.get('document_type', 'other')

    # V004: Check extraction_reasoning for fallback recommendation
    reasoning = extracted_data.get('extraction_reasoning', '')
    if 'non-financial' in reasoning.lower() or 'not applicable' in reasoning.lower():
        logger.warning(f"⚠️  Model suggests fallback mode: {reasoning}")

    if 'fields' in extracted_data and isinstance(extracted_data['fields'], dict):
        fields = extracted_data['fields']

        found_keys = 0
        found_required = 0

        for category in ['header', 'supplier', 'customer', 'delivery', 'totals', 'payment', 'other']:
            if category in fields:
                for item in fields[category]:
                    std_key = item.get('standardized_key')
                    if std_key:
                        key_def = next((k for k in standard_kvps['keys'] if k['key'] == std_key), None)
                        if key_def:
                            item['required'] = key_def.get('required', False)
                            item['found'] = item.get('value') is not None and item.get('value') != ''

                            if item['found']:
                                found_keys += 1
                                if item['required']:
                                    found_required += 1
                        else:
                            item['required'] = False
                            item['found'] = item.get('value') is not None and item.get('value') != ''
                            if item['found']:
                                found_keys += 1

        line_items = fields.get('line_items', [])

        structured_output = {
            'document_type': document_type,
            'extraction_mode': 'standardized_schema_v8',
            'languages_detected': extracted_data.get('languages_detected', []),
            'extraction_reasoning': reasoning,
            'fields': fields
        }

        # Add nulls for missing required fields
        for key_def in standard_kvps['keys']:
            category = key_def.get('category', 'other')
            if category == 'line_items':
                continue

            if category not in structured_output['fields']:
                structured_output['fields'][category] = []

            std_key = key_def['key']
            exists = any(item.get('standardized_key') == std_key
                        for item in structured_output['fields'][category])

            if not exists and key_def.get('required', False):
                structured_output['fields'][category].append({
                    'standardized_key': std_key,
                    'visible_key': None,
                    'value': None,
                    'confidence': None,
                    'required': True,
                    'found': False
                })
    else:
        # Old format fallback
        extracted_pairs = extracted_data.get('extracted_pairs', [])

        extracted_map = {}
        for pair in extracted_pairs:
            if 'standardized_key' in pair:
                extracted_map[pair['standardized_key']] = {
                    'visible_key': pair.get('visible_key', pair.get('key', '')),
                    'value': pair.get('value'),
                    'confidence': pair.get('confidence')
                }

        by_category = {}
        for key_def in standard_kvps['keys']:
            category = key_def.get('category', 'other')
            if category not in by_category:
                by_category[category] = []

            std_key = key_def['key']

            if std_key in extracted_map:
                by_category[category].append({
                    'standardized_key': std_key,
                    'visible_key': extracted_map[std_key]['visible_key'],
                    'value': extracted_map[std_key]['value'],
                    'confidence': extracted_map[std_key].get('confidence'),
                    'required': key_def.get('required', False),
                    'found': True
                })
            else:
                if key_def.get('required', False):
                    by_category[category].append({
                        'standardized_key': std_key,
                        'visible_key': None,
                        'value': None,
                        'confidence': None,
                        'required': True,
                        'found': False
                    })

        line_items = extracted_data.get('line_items', [])
        by_category['line_items'] = line_items

        structured_output = {
            'document_type': document_type,
            'extraction_mode': 'standardized_schema_v8',
            'languages_detected': extracted_data.get('languages_detected', []),
            'extraction_reasoning': extracted_data.get('extraction_reasoning', ''),
            'fields': by_category
        }

        found_keys = sum(1 for pair in extracted_pairs if 'standardized_key' in pair)
        found_required = sum(1 for pair in extracted_pairs
                            if 'standardized_key' in pair
                            and any(k['key'] == pair['standardized_key'] and k.get('required', False)
                                    for k in standard_kvps['keys']))

    # Add summary stats
    total_keys = len(standard_kvps['keys'])
    required_keys = sum(1 for k in standard_kvps['keys'] if k.get('required', False))

    structured_output['extraction_stats'] = {
        'total_standardized_keys': total_keys,
        'keys_found': found_keys,
        'line_items_found': len(line_items),
        'required_keys': required_keys,
        'required_keys_found': found_required,
        'completeness_pct': round((found_keys / total_keys) * 100, 1),
        'required_completeness_pct': round((found_required / required_keys) * 100, 1) if required_keys > 0 else 100.0
    }

    logger.info(f"✓ Schema enforcement: {found_keys}/{total_keys} keys found ({structured_output['extraction_stats']['completeness_pct']}%)")
    logger.info(f"✓ Line items: {len(line_items)} extracted")
    logger.info(f"✓ Required fields: {found_required}/{required_keys} found ({structured_output['extraction_stats']['required_completeness_pct']}%)")

    return structured_output


def extract(pdf_path: str, page_number: int = 1, use_standard_schema: bool = True) -> dict:
    """
    Extract key-value pairs from a specific page of a PDF.
    V6: Single-pass VLM extraction - no multi-step overhead.
    """
    logger.info(f"Processing: {pdf_path} (Page {page_number})")

    standard_kvps = None
    if use_standard_schema:
        standard_kvps = load_standard_kvps()
        if standard_kvps:
            logger.info(f"✓ Using standardized schema mode ({len(standard_kvps['keys'])} keys)")
        else:
            logger.info("✓ Using open-ended extraction mode (fallback)")

    llm, processor = load_model()

    logger.info(f"Converting PDF page {page_number} to image (300 DPI)...")
    img = convert_from_path(pdf_path, dpi=300, first_page=page_number, last_page=page_number)[0]
    logger.info(f"Image size: {img.size[0]}×{img.size[1]}px")

    # V6: Single-pass extraction - VLM handles OCR/layout/structure internally
    use_standard_mode = standard_kvps is not None and use_standard_schema
    prompt = build_role_and_task_prompt(
        standard_keys=standard_kvps['keys'] if standard_kvps else None,
        use_standard_mode=use_standard_mode
    )

    messages = [{"role": "user", "content": [
        {"type": "image", "image": img},
        {"type": "text", "text": prompt}
    ]}]

    logger.info("Preprocessing image inputs...")
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    image_inputs, _, mm_kwargs = process_vision_info(
        messages,
        return_video_kwargs=True
    )

    if mm_kwargs and 'fps' in mm_kwargs and isinstance(mm_kwargs['fps'], list) and len(mm_kwargs['fps']) == 0:
        mm_kwargs['fps'] = None

    inputs = {
        'prompt': text,
        'multi_modal_data': {'image': image_inputs} if image_inputs else {}
    }
    if mm_kwargs:
        inputs['mm_processor_kwargs'] = mm_kwargs

    # V004: Increased max_tokens to 20K for longer reasoning chains
    sampling_params = SamplingParams(temperature=0.0, max_tokens=20480)

    logger.info("Generating key-value extraction...")
    outputs = llm.generate([inputs], sampling_params=sampling_params)
    output = outputs[0].outputs[0].text.strip()

    logger.info(f"Raw output length: {len(output)} chars")

    json_match = re.search(r"\{.*\}", output, re.DOTALL)
    if json_match:
        try:
            result = json.loads(json_match.group(0))

            # V6: Detect output format and normalize
            if 'items' in result or 'tables' in result:
                # New V6 format: {items: [], tables: []}
                items_count = len(result.get('items', []))
                tables_count = len(result.get('tables', []))
                table_rows = sum(len(t.get('rows', [])) for t in result.get('tables', []))

                logger.info(f"✓ V6 raw extraction: {items_count} items, {tables_count} tables ({table_rows} rows)")

                # Normalize to categorized format using standard_kvps aliases
                result = normalize_extracted_output(result, standard_kvps)

                total_pairs = sum(len(items) for cat, items in result['fields'].items()
                                 if cat != 'line_items' and isinstance(items, list))
                line_items = result['fields']['line_items']
                logger.info(f"✓ Normalized: {total_pairs} KVPs categorized, {len(line_items)} line items")

            elif 'fields' in result and isinstance(result['fields'], dict):
                # Old categorized format (backwards compatibility)
                total_pairs = sum(len(items) for cat, items in result['fields'].items()
                                 if cat != 'line_items' and isinstance(items, list))
                line_items = result.get('fields', {}).get('line_items', [])
                logger.info(f"✓ Extracted {total_pairs} key-value pairs (categorized)")
                logger.info(f"✓ Extracted {len(line_items)} line items")

                if use_standard_mode:
                    result = enforce_schema(result, standard_kvps)
            else:
                # Legacy format
                logger.info(f"✓ Extracted {len(result.get('extracted_pairs', []))} key-value pairs")
                logger.info(f"✓ Extracted {len(result.get('line_items', []))} line items")

                if use_standard_mode:
                    result = enforce_schema(result, standard_kvps)

            logger.info(f"✓ Document type: {result.get('document_type', 'unknown')}")

            return result
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")
            logger.warning("⚠️  Attempting pattern-based error recovery...")

            # Enhanced error recovery (same as V002)
            try:
                salvaged_data = {
                    'document_type': 'invoice',
                    'languages_detected': [],
                    'extraction_reasoning': 'Salvaged from malformed JSON',
                    'fields': {
                        'header': [], 'supplier': [], 'customer': [],
                        'delivery': [], 'totals': [], 'payment': [],
                        'line_items': [],
                        'other': []
                    }
                }

                line_items_match = re.search(r'"line_items"\s*:\s*\[(.*?)\]', output, re.DOTALL)
                if line_items_match:
                    items_text = line_items_match.group(1)
                    item_chunks = re.split(r'\},\s*\{', items_text)
                    for chunk in item_chunks:
                        chunk = '{' + chunk.strip().strip('{').strip('}') + '}'
                        try:
                            salvaged_data['fields']['line_items'].append(json.loads(chunk))
                        except (json.JSONDecodeError, ValueError):
                            pass

                for category in ['header', 'supplier', 'customer', 'delivery', 'totals', 'payment', 'other']:
                    category_match = re.search(rf'"{category}"\s*:\s*\[(.*?)\]', output, re.DOTALL)
                    if category_match:
                        kvp_text = category_match.group(1)
                        kvp_chunks = re.split(r'\},\s*\{', kvp_text)
                        for chunk in kvp_chunks:
                            chunk = '{' + chunk.strip().strip('{').strip('}') + '}'
                            try:
                                salvaged_data['fields'][category].append(json.loads(chunk))
                            except (json.JSONDecodeError, ValueError):
                                pass

                total_salvaged = sum(len(items) for cat, items in salvaged_data['fields'].items()
                                    if cat != 'line_items' and isinstance(items, list))
                line_items_salvaged = len(salvaged_data['fields']['line_items'])

                if total_salvaged > 0 or line_items_salvaged > 0:
                    logger.info(f"✓ Pattern recovery: {line_items_salvaged} line items, {total_salvaged} KVPs")
                    return salvaged_data
                else:
                    logger.warning("⚠️  Pattern recovery found no data")

            except Exception as recovery_error:
                logger.error(f"Pattern recovery failed: {recovery_error}")

            return {"error": "invalid json", "raw": output}
    else:
        logger.error("No valid JSON found in output")
        return {"error": "no valid json", "raw": output}


def save_benchmark_log(pdf_stem: str, extraction_stats: dict, processing_time: float, output_dir: Path):
    """
    V004: Save benchmark results for testing and comparison.
    """
    benchmark_file = output_dir / "benchmark_log.jsonl"

    benchmark_entry = {
        "timestamp": datetime.now().isoformat(),
        "file": pdf_stem,
        "processing_time_seconds": round(processing_time, 2),
        "stats": extraction_stats
    }

    try:
        with open(benchmark_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(benchmark_entry, ensure_ascii=False) + '\n')
        logger.info(f"✓ Benchmark logged to: {benchmark_file}")
    except Exception as e:
        logger.warning(f"⚠️  Failed to save benchmark: {e}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python PRISM_key_values_V008_hndwrtng.py <pdf_path> [options]")
        print("\nOptions:")
        print("  --no-schema      Use open-ended extraction instead of standardized schema")
        print("  --debug          Save raw model outputs for debugging")
        print("  --benchmark      Enable benchmark logging for performance tracking")
        print("\nV8 Features (Handwriting Improvements):")
        print("  - Single-pass VLM extraction (no multi-step overhead)")
        print("  - Fluid document classification (no financial bias)")
        print("  - ~15s per page (vs 60s with multi-step)")
        sys.exit(1)

    pdf = Path(sys.argv[1])
    use_schema = '--no-schema' not in sys.argv
    debug_mode = '--debug' in sys.argv
    benchmark_mode = '--benchmark' in sys.argv

    if not pdf.exists():
        logger.error(f"PDF not found: {pdf}")
        sys.exit(1)

    logger.info("="*70)
    logger.info("PRISM Key-Value Extraction V8 - HANDWRITING IMPROVEMENTS (Single-Pass VLM)")
    logger.info("="*70)

    logger.info("Detecting page count...")
    total_pages = get_pdf_page_count(str(pdf))
    logger.info(f"✓ PDF has {total_pages} page(s)")

    timestamp = datetime.now().strftime("%y%m%d_%H%M%S")
    output_dir = Path("/root/03_OUTPUT")
    output_dir.mkdir(parents=True, exist_ok=True)

    # V004: Start timing for benchmark
    start_time = time.time()

    for page_num in range(1, total_pages + 1):
        logger.info("="*70)
        logger.info(f"Processing page {page_num}/{total_pages}")
        logger.info("="*70)

        data = extract(str(pdf), page_number=page_num, use_standard_schema=use_schema)

        output_filename = f"{timestamp}_{pdf.stem}_page{page_num:03d}_v8.json"
        out = output_dir / output_filename

        out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

        logger.info(f"✓ Output saved: {out}")

        # Save raw model output for debugging if requested
        if debug_mode and 'raw' in data:
            debug_file = output_dir / f"{timestamp}_{pdf.stem}_page{page_num:03d}_DEBUG_RAW.txt"
            debug_file.write_text(data['raw'], encoding="utf-8")
            logger.info(f"✓ Debug raw output saved: {debug_file}")

    logger.info("="*70)
    logger.info(f"✓ All {total_pages} page(s) processed successfully")
    logger.info("="*70)

    # Aggregate
    page_files = list(output_dir.glob(f"{timestamp}_{pdf.stem}_page*_v8.json"))
    aggregated_path = output_dir / f"{timestamp}_{pdf.stem}_AGGREGATED_v8.json"

    logger.info("="*70)
    logger.info("AGGREGATING MULTI-PAGE RESULTS")
    logger.info("="*70)

    standard_kvps = load_standard_kvps() if use_schema else None
    aggregated_data = aggregate_page_results(page_files, aggregated_path, standard_kvps)

    # V004: Enhanced validation with fluid classification metrics
    completeness = aggregated_data.get('extraction_stats', {}).get('completeness_pct', 0)
    required_completeness = aggregated_data.get('extraction_stats', {}).get('required_completeness_pct', 0)
    line_items_found = aggregated_data.get('extraction_stats', {}).get('line_items_found', 0)
    keys_found = aggregated_data.get('extraction_stats', {}).get('keys_found', 0)

    logger.info("="*70)
    logger.info("POST-PROCESSING VALIDATION (V6)")
    logger.info("="*70)

    # V004: Check for fallback recommendations (fluid classification improvement)
    reasoning = aggregated_data.get('extraction_reasoning', '')
    if 'recommend' in reasoning.lower() and 'fallback' in reasoning.lower():
        logger.warning(f"⚠️  Model recommends fallback mode: {reasoning}")
        logger.warning(f"    Try rerunning with: python {sys.argv[0]} {pdf} --no-schema")

    # Language detection
    languages = aggregated_data.get('languages_detected', [])
    if languages:
        logger.info(f"✓ Detected languages: {', '.join(languages)}")

    if total_pages > 1 and line_items_found < total_pages * 5:
        logger.warning(f"⚠️  Low line item count ({line_items_found} items across {total_pages} pages).")
        logger.warning(f"    Expected: ~{total_pages * 10} items for table-heavy document.")

    # V005: Adjusted thresholds (target 30-40% overall, 90% required for financial docs)
    if completeness < 30:
        logger.warning(f"⚠️  Low completeness ({completeness}%)! V6 target is 30-40%.")
        logger.warning(f"    Consider rerunning with --no-schema for unusual layouts or non-financial docs.")
    elif completeness >= 30:
        logger.info(f"✓ Good completeness ({completeness}%) - meeting V6 target!")

    if required_completeness < 90:
        logger.warning(f"⚠️  Missing required fields ({required_completeness}% found)! V6 target is 90%.")
        missing_required = []
        for category in aggregated_data.get('fields', {}).values():
            if isinstance(category, list):
                for item in category:
                    if item.get('required', False) and not item.get('found', False):
                        missing_required.append(item.get('standardized_key', 'Unknown'))
        if missing_required:
            logger.warning(f"    Missing: {', '.join(set(missing_required))}")
    else:
        logger.info(f"✓ Excellent required field coverage ({required_completeness}%) - exceeds V6 target!")

    if keys_found > 0 and line_items_found > 0:
        logger.info(f"✓ Pattern-based extraction successful: {keys_found} keys, {line_items_found} line items")

    logger.info("="*70)
    logger.info(f"✓ Final aggregated output: {aggregated_path}")
    logger.info(f"✓ Output directory: {output_dir}")
    logger.info("="*70)

    # V004: Calculate total processing time and save benchmark
    total_time = time.time() - start_time
    logger.info(f"✓ Total processing time: {total_time:.2f} seconds ({total_time/total_pages:.2f}s per page)")

    if benchmark_mode:
        logger.info("="*70)
        logger.info("SAVING BENCHMARK RESULTS")
        logger.info("="*70)
        save_benchmark_log(
            pdf_stem=pdf.stem,
            extraction_stats=aggregated_data.get('extraction_stats', {}),
            processing_time=total_time,
            output_dir=output_dir
        )

    print("\n" + "="*70)
    print("AGGREGATED RESULTS (V8)")
    print("="*70)
    print(json.dumps(aggregated_data, indent=2, ensure_ascii=False))
