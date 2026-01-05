"""
KVP Processor - Core key-value pair extraction logic
Extracted from PRISM_key_values_001.py for integration into worker pool

Handles:
- Building KVP extraction prompts
- Loading master KVP definitions
- Normalizing extracted data using aliases
- Mapping raw extractions to standardized keys
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def build_kvp_extraction_prompt(selected_kvps: Optional[List[Dict]] = None) -> str:
    """
    Build the prompt for KVP extraction.
    Optimized for Qwen3-VL 8B: Process-based, concise, CoT-guided with emphasis on thinking mode for deeper reasoning.

    Args:
        selected_kvps: Optional list of KVP objects user selected
                      Each object has either 'key_name' (master) or 'custom_key_name' (custom)
                      e.g. [{'key_name': 'invoice_number'}, {'custom_key_name': 'Ben'}]

    Returns:
        str: Complete extraction prompt for Qwen model
    """
    # Extract key names if selected
    key_names = []
    if selected_kvps:
        for kvp in selected_kvps:
            key_name = kvp.get('key_name') or kvp.get('custom_key_name')
            if key_name:
                key_names.append(key_name)

    # Base process-based prompt, tailored for Qwen3-VL's thinking capabilities
    base_prompt = """<image>You are extracting key-value pairs from this document image or PDF using thinking mode: Think deeply step-by-step before outputting. Follow this process exactly. Output only valid JSON.

PROCESS STEPS:
1. Visually analyze the document layout top-to-bottom, left-to-right. Identify all visible labels, headers, and associated values. For non-table content, keys are typically labels to the left or above values; associate based on proximity and structure (e.g., bullets under headers). For tables, identify headers and row cells. Think: What is the overall structure?

2. Transcribe exactly as visible: No corrections, assumptions, or inventions. If no value, use null. Preserve formatting/symbols. Think: Is this faithful to the image?

3. For ambiguous text (e.g., handwritten, though this doc is printed): Use context to infer (prefer digits in numbers, letters in names). Mark "uncertain": true only if genuinely unclear after deep analysis. Confidence: "high" (clear print), "medium" (degraded), "low" (faded/handwritten). Think: What context confirms this?

4. If tables present: Use headers as keys, extract rows as objects with per-row confidence. Think: Does the layout confirm a table?

5. Final filter: """

    if key_names:
        key_list = ', '.join(f'"{k}"' for k in key_names)
        base_prompt += f"Extract ONLY values for these exact keys: {key_list}. Ignore all other data. If a key has no value, omit it. Think: Does this data match exactly?"
    else:
        base_prompt += "Extract all visible key-value pairs without filtering. Think: Is everything covered without hallucination?"

    base_prompt += """

OUTPUT JSON SCHEMA:
{
  "items": [{"key": "exact_key", "value": "exact_value", "confidence": "high|medium|low", "uncertain": true|false (optional)}],
  "tables": [{"headers": ["header1", ...], "rows": [{"header1": "value", ..., "confidence": "high|medium|low"}, ...]}]
}

EXAMPLES:
- Simple: {"items": [{"key": "Name", "value": "John Doe", "confidence": "high"}], "tables": []}
- Table: {"items": [], "tables": [{"headers": ["Item", "Price"], "rows": [{"Item": "Apple", "Price": "1.00", "confidence": "high"}]}]}

Think deeply about the entire process, then output only the JSON object. No extra text."""

    return base_prompt


def load_master_kvps(kvp_json_path: Optional[Path] = None) -> Optional[Dict]:
    """
    Load master KVP definitions from JSON file.
    Supports master_kvps.json format with sectors.

    Args:
        kvp_json_path: Path to master_kvps.json (defaults to worker/master_kvps.json)

    Returns:
        dict: Master KVP data or None if not found
    """
    if kvp_json_path is None:
        kvp_json_path = Path(__file__).parent / "master_kvps.json"

    if not kvp_json_path.exists():
        logger.warning(f"Master KVP file not found: {kvp_json_path}")
        logger.warning("Falling back to open-ended extraction mode")
        return None

    try:
        with open(kvp_json_path, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)

        # Handle master_kvps.json format (sectors-based)
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

            master_kvps = {
                'version': raw_data.get('version', '1.0'),
                'description': raw_data.get('description', ''),
                'keys': flattened_keys,
                'sectors': raw_data['sectors']  # Keep original for reference
            }

            logger.info(f"✓ Loaded {len(flattened_keys)} KVPs from {len(raw_data['sectors'])} sectors")
            return master_kvps
        else:
            logger.warning("Unknown master KVP format")
            return None

    except json.JSONDecodeError as e:
        logger.error(f"Error parsing master KVP JSON: {e}")
        return None
    except Exception as e:
        logger.error(f"Error loading master KVPs: {e}")
        return None


def build_alias_map(master_kvps: Dict) -> Tuple[Dict[str, str], Dict[str, Dict]]:
    """
    Build lookup maps from master_kvps data.

    Args:
        master_kvps: Master KVP data from load_master_kvps()

    Returns:
        tuple: (alias_to_standard, standard_to_info)
            - alias_to_standard: Maps any alias -> canonical key
            - standard_to_info: Maps canonical key -> {category, sector, sector_name}
    """
    alias_to_standard = {}
    standard_to_info = {}

    for key_def in master_kvps['keys']:
        std_key = key_def['key']
        category = key_def.get('category', 'other')
        sector = key_def.get('sector')
        sector_name = key_def.get('sector_name')

        standard_to_info[std_key] = {
            'category': category,
            'sector': sector,
            'sector_name': sector_name
        }

        # Map all aliases (including the key itself) to the standard key
        for alias in [std_key] + key_def.get('aliases', []):
            alias_to_standard[alias.lower().strip()] = std_key

    return alias_to_standard, standard_to_info


def normalize_extracted_output(raw_output: Dict, master_kvps: Optional[Dict] = None) -> Dict:
    """
    Transform raw extraction output {items: [], tables: []}
    into normalized categorized format {fields: {header: [], supplier: [], ...}}.

    Post-processing normalization using master_kvps aliases.

    Args:
        raw_output: Raw JSON from model {items: [...], tables: [...]}
        master_kvps: Master KVP definitions (optional)

    Returns:
        dict: Normalized extraction with categorized fields
    """
    items = raw_output.get('items', [])
    tables = raw_output.get('tables', [])

    # Initialize output structure
    normalized = {
        'document_type': 'unknown',
        'extraction_mode': 'v8_kvp',
        'languages_detected': [],
        'extraction_reasoning': 'V8 single-pass KVP extraction',
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
        'sectors_detected': []
    }

    # Build alias map if master_kvps available
    alias_to_standard = {}
    standard_to_info = {}
    required_keys = set()
    sectors_found = set()

    if master_kvps:
        alias_to_standard, standard_to_info = build_alias_map(master_kvps)
        required_keys = {k['key'] for k in master_kvps['keys'] if k.get('required', False)}

    # Process non-table items
    for item in items:
        raw_key = item.get('key', '')
        value = item.get('value', '')
        confidence = item.get('confidence', 'medium')
        uncertain = item.get('uncertain', False)

        # Normalize key using alias map
        lookup_key = raw_key.lower().strip()
        std_key = alias_to_standard.get(lookup_key, None)

        # Get full info including sector
        key_info = standard_to_info.get(std_key, {}) if std_key else {}
        category = key_info.get('category', 'other')
        sector = key_info.get('sector')
        sector_name = key_info.get('sector_name')

        # Track detected sectors
        if sector and value:
            sectors_found.add((sector, sector_name))

        normalized_item = {
            'visible_key': raw_key,
            'standardized_key': std_key,
            'value': value,
            'confidence': confidence,
            'uncertain': uncertain,
            'required': std_key in required_keys if std_key else False,
            'found': value is not None and value != '',
            'sector': sector,
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

                    # Track sector from table headers too
                    key_info = standard_to_info.get(std_key, {})
                    sector = key_info.get('sector')
                    sector_name = key_info.get('sector_name')
                    if sector and row.get(header):
                        sectors_found.add((sector, sector_name))

            line_item['confidence'] = row_confidence
            normalized['fields']['line_items'].append(line_item)

    # Add detected sectors to output
    normalized['sectors_detected'] = [
        {'sector_id': s[0], 'sector_name': s[1]}
        for s in sorted(sectors_found, key=lambda x: x[0] or '')
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

    total_std_keys = len(master_kvps['keys']) if master_kvps else 0
    total_required = len(required_keys) if master_kvps else 5

    normalized['extraction_stats'] = {
        'total_standardized_keys': total_std_keys,
        'keys_found': total_keys_found,
        'line_items_found': len(normalized['fields']['line_items']),
        'required_keys': total_required,
        'required_keys_found': required_keys_found,
        'completeness_pct': round((total_keys_found / total_std_keys) * 100, 1) if total_std_keys > 0 else 0,
        'required_completeness_pct': round((required_keys_found / total_required) * 100, 1) if total_required > 0 else 100.0,
        'sectors_matched': len(sectors_found)
    }

    return normalized


def build_structured_output(
    raw_extraction: Dict,
    selected_kvps: List[Dict],
    alias_map: Tuple[Dict[str, str], Dict[str, Dict]]
) -> Dict[str, str]:
    """
    Build structured output with ONLY selected keys.
    Returns a simple dict mapping key_name -> value (or "" if not found).

    Args:
        raw_extraction: Raw model output with 'items' and 'tables'
        selected_kvps: List of selected KVP objects from user
                      e.g. [{'key_name': 'invoice_number'}, {'custom_key_name': 'Ben'}]
        alias_map: Tuple of (alias_to_standard, standard_to_info) from build_alias_map()

    Returns:
        dict: Simple key-value mapping, e.g. {'invoice_number': 'INV-123', 'date': ''}
    """
    alias_to_standard, standard_to_info = alias_map

    # Initialize output with all selected keys set to empty string
    output = {}
    for kvp in selected_kvps:
        key_name = kvp.get('key_name') or kvp.get('custom_key_name')
        if key_name:
            output[key_name] = ""

    # Extract items from raw output
    items = raw_extraction.get('items', [])

    # Fill in values from extraction using alias matching
    for item in items:
        raw_key = item.get('key', '').lower().strip()
        value = item.get('value', '')
        confidence = item.get('confidence', 'medium')

        # Try to match using alias map
        std_key = alias_to_standard.get(raw_key)

        # If we found a match and it's in our selected keys, use it
        if std_key and std_key in output:
            # Only overwrite if we don't have a value yet, or this one has higher confidence
            if not output[std_key] or confidence == 'high':
                output[std_key] = value

        # Also try direct match (for custom fields)
        for selected_key in output.keys():
            selected_lower = selected_key.lower().replace('_', ' ').replace('-', ' ')
            raw_lower = raw_key.replace('_', ' ').replace('-', ' ')

            if selected_lower == raw_lower:
                if not output[selected_key] or confidence == 'high':
                    output[selected_key] = value

    return output
