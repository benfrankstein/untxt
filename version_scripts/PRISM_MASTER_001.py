#!/usr/bin/env python3
"""
Single-Pass PDF → HTML (V006: Coordinates Only - No Clipping)

Pipeline:
1. Normalize input (coordinate system)
2. Detect + blank graphics (Qwen3 chokes on images)
3. Detect language (critical for prompt)
4. Generate HTML with VISUAL properties (bounding boxes + font classification)
5. Clean + save

V006 Approach (Coordinates Only - No Bbox Constraints):
- Qwen's height has 75% padding → IGNORE IT
- Qwen's width has 4% padding → USE IT
- font-size = (bbox_width / char_count) × 1.9
- Cluster by char_width to group similar text sizes
- Apply median cluster value for consistency
- **NEW: Use ONLY top-left coordinates for positioning**
- **NO width/height constraints → prevents text clipping**
- Let text flow naturally with white-space:nowrap
- VT323 font for mono
- VLM detects font type: mono/sans/serif/hand

NO validation loops. NO OCR. NO multi-pass. Fast or fail.
"""

import sys
import os
import re
import json
from pathlib import Path
from datetime import datetime
from typing import Tuple
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pdf2image import convert_from_path
import torch

# CRITICAL: Set environment variables BEFORE any CUDA/vLLM imports
os.environ['VLLM_WORKER_MULTIPROC_METHOD'] = 'spawn'
os.environ['VLLM_ENABLE_V1_MULTIPROCESSING'] = '0'
os.environ['NCCL_P2P_DISABLE'] = '0'
os.environ['VLLM_TIMEOUT'] = '300'

from vllm import LLM, SamplingParams
from transformers import AutoProcessor
from qwen_vl_utils import process_vision_info

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
logger = logging.getLogger("single_pass_optimized")

# Model caches
_LLM_CACHE = None
_PROCESSOR_CACHE = None

# Language detection (fast heuristic)
try:
    import langdetect
    _HAS_LANGDETECT = True
except ImportError:
    logger.warning("langdetect not available, will use fallback")
    _HAS_LANGDETECT = False


# ============================================================================
# 1ST-PRINCIPLE APPROACH: NO HELPER FUNCTIONS NEEDED
# Direct bbox height → font-size (no ratios, no clustering, no calibration)
# ============================================================================
# STEP 1: NORMALIZE INPUT (Unified Coordinate System)
# ============================================================================

class UnifiedCoordinateSystem:
    """
    Single source of truth for coordinates.
    Everything stored as 0.0-1.0 ratios.
    """
    def __init__(self, source_width_px: int, source_height_px: int):
        self.source_width = source_width_px
        self.source_height = source_height_px
        self.aspect_ratio = source_width_px / source_height_px

    def normalize_bbox(self, x1: float, y1: float, x2: float, y2: float) -> Tuple[float, float, float, float]:
        """Convert pixel coords to normalized ratios."""
        return (
            x1 / self.source_width,
            y1 / self.source_height,
            x2 / self.source_width,
            y2 / self.source_height
        )

    def denormalize_bbox(self, x1_norm: float, y1_norm: float, x2_norm: float, y2_norm: float) -> Tuple[int, int, int, int]:
        """Convert normalized ratios back to pixel coords."""
        return (
            int(x1_norm * self.source_width),
            int(y1_norm * self.source_height),
            int(x2_norm * self.source_width),
            int(y2_norm * self.source_height)
        )


def step1_normalize_input(pdf_path: str, dpi: int = 300) -> dict:
    """
    Convert PDF to image with unified coordinate system.
    NO cropping, NO preprocessing.
    """
    logger.info(f"[1/4] Normalizing input: {pdf_path}")

    # Convert PDF to image
    images = convert_from_path(pdf_path, dpi=dpi, first_page=1, last_page=1)
    if not images:
        raise ValueError("Failed to convert PDF to image")

    image = images[0].convert("RGB")

    # Create coordinate system
    coords = UnifiedCoordinateSystem(image.width, image.height)

    logger.info(f"  → Image: {image.width}×{image.height}px, aspect: {coords.aspect_ratio:.3f}")

    return {
        "image": image,
        "coords": coords,
        "dimensions": {
            "width": image.width,
            "height": image.height,
            "aspect_ratio": coords.aspect_ratio
        }
    }


# ============================================================================
# STEP 2: DETECT + BLANK GRAPHICS (Qwen3 chokes on images)
# ============================================================================

def load_model(model_path: str = "/workspace/qwen3_vl_8b_model"):
    """Load Qwen3-VL model (cached singleton)."""
    global _LLM_CACHE, _PROCESSOR_CACHE

    if _LLM_CACHE is not None and _PROCESSOR_CACHE is not None:
        return _LLM_CACHE, _PROCESSOR_CACHE

    logger.info(f"Loading Qwen3-VL-8B from: {model_path}")

    # Load processor
    _PROCESSOR_CACHE = AutoProcessor.from_pretrained(model_path, trust_remote_code=True)

    # Load vLLM (H100 optimized)
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

    logger.info("✓ Model loaded")
    return _LLM_CACHE, _PROCESSOR_CACHE


def detect_graphics(llm, processor, image: Image.Image) -> list:
    """
    Detect graphics/logos/QR codes using Qwen3-VL visual grounding.
    Returns list of (x, y, w, h, type) tuples in pixel coordinates.

    Approach from BABY_STEPS_012_H100.py
    """
    graphics_prompt = """Locate every non-text graphic element in the image, such as logos, QR codes, barcodes, icons, or decorative visuals. Ignore all text, numbers, and textual content. For each detected graphic, determine its type and provide its bounding box.

Output ONLY a JSON list in this format: [{"type": "QR code", "bbox": [x1, y1, x2, y2]}, ...], where:
- "type" is the graphic type (e.g., "logo", "QR code").
- "bbox" is the bounding box with coordinates normalized to 0-1000 (0,0 is top-left; 1000,1000 is bottom-right).
If no graphics are detected, output []."""

    messages = [
        {"role": "system", "content": "You are a vision-language model specialized in visual grounding and object detection. Focus on non-text graphic elements."},
        {"role": "user", "content": [
            {"type": "image", "image": image},
            {"type": "text", "text": graphics_prompt}
        ]}
    ]

    # CRITICAL: Preprocess with AutoProcessor + process_vision_info
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

    sampling_params = SamplingParams(temperature=0.0, max_tokens=1024)

    logger.info("  → Running Qwen3-VL graphics detection (with preprocessing)...")
    logger.info(f"  → Image size: {image.size[0]}×{image.size[1]} pixels ({image.size[0]*image.size[1]/1e6:.2f}MP)")
    outputs = llm.generate([inputs], sampling_params=sampling_params)
    result = outputs[0].outputs[0].text.strip()

    logger.info(f"  → Graphics detection response:\n{result}")

    # Parse JSON response
    graphic_regions = []
    W, H = image.size

    try:
        import json
        import re

        # Better regex extraction (from BABY_STEPS_012)
        json_match = re.search(r'\[.*?\](?!\S)', result, re.DOTALL)
        if not json_match:
            logger.warning("  → No valid JSON array detected; using empty list")
            return []

        json_str = json_match.group(0).strip()
        graphics_list = json.loads(json_str)

        if not graphics_list:
            logger.info("  → No graphics detected (empty list)")
            return graphic_regions

        for item in graphics_list:
            if not isinstance(item, dict) or 'type' not in item or 'bbox' not in item:
                logger.warning(f"  → Invalid graphic item: {item}")
                continue

            graphic_type = item['type']
            bbox = item['bbox']

            if len(bbox) != 4:
                logger.warning(f"  → Invalid bbox for {graphic_type}: {bbox}")
                continue

            # bbox format: [x1, y1, x2, y2] normalized to 0-1000
            x1_norm, y1_norm, x2_norm, y2_norm = bbox

            # Convert normalized (0-1000) to pixels
            x1 = int(x1_norm * W / 1000)
            y1 = int(y1_norm * H / 1000)
            x2 = int(x2_norm * W / 1000)
            y2 = int(y2_norm * H / 1000)

            # Convert to (x, y, w, h) format
            x = x1
            y = y1
            w = x2 - x1
            h = y2 - y1

            graphic_regions.append((x, y, w, h, graphic_type))
            logger.info(f"  → ✅ Detected '{graphic_type}': bbox=[{x1_norm}, {y1_norm}, {x2_norm}, {y2_norm}]/1000 → ({x},{y}) {w}x{h}px")

    except json.JSONDecodeError as e:
        logger.warning(f"  → Failed to parse JSON response: {e}")
    except Exception as e:
        logger.warning(f"  → Error parsing graphics response: {e}")

    return graphic_regions


def blank_graphics(image: Image.Image, graphic_regions: list) -> Image.Image:
    """
    Blank graphics in the image (no coordinate scaling needed - same resolution).

    Args:
        image: PIL Image
        graphic_regions: List of (x, y, w, h, desc) tuples in SAME image coordinates

    Returns:
        PIL Image with graphics blanked out (white rectangles with "GRAPHIC" text)

    Approach from BABY_STEPS_012_H100.py
    """
    if not graphic_regions:
        return image

    blanked_image = image.copy()
    draw = ImageDraw.Draw(blanked_image)

    logger.info(f"  → Blanking {len(graphic_regions)} graphics in image (no scaling needed)")

    # Try to load a font for "GRAPHIC" text
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
    except:
        font = ImageFont.load_default()

    for idx, region in enumerate(graphic_regions):
        if len(region) == 5:
            x, y, w, h, desc = region
        else:
            x, y, w, h = region
            desc = "GRAPHIC"

        # Add 10px padding to avoid text overlap with imprecise bboxes
        x_padded = max(0, x - 10)
        y_padded = max(0, y - 10)
        w_padded = w + 20
        h_padded = h + 20

        # Draw white rectangle with hard black border (with padding)
        draw.rectangle([x_padded, y_padded, x_padded + w_padded, y_padded + h_padded], fill='white', outline='black', width=3)

        # Draw "GRAPHIC" text in center
        text = "GRAPHIC"
        text_x = x + w // 2
        text_y = y + h // 2
        draw.text((text_x, text_y), text, fill='gray', font=font, anchor='mm')

        logger.info(f"  → ✅ Blanked '{desc}': original ({x},{y}) {w}x{h}px → padded ({x_padded},{y_padded}) {w_padded}x{h_padded}px")

    return blanked_image


def step2_detect_and_blank_graphics(llm, processor, image: Image.Image) -> Image.Image:
    """
    Detect and blank graphics (Qwen3 chokes on logos/QR codes).
    """
    logger.info("[2/5] Detecting + blanking graphics...")
    logger.info(f"  → Image size: {image.size[0]}×{image.size[1]}px")

    graphics = detect_graphics(llm, processor, image)

    if not graphics:
        logger.info("  → No graphics detected - returning original image")
        return image

    logger.info(f"  → Successfully detected {len(graphics)} graphics")
    blanked_image = blank_graphics(image, graphics)
    logger.info(f"  → Blanking complete - returning modified image")

    return blanked_image


# ============================================================================
# STEP 3: DETECT LANGUAGE (Using Qwen, not external tools)
# ============================================================================

def step3_detect_language(llm, processor, image: Image.Image) -> str:
    """
    Detect document language using Qwen VLM.
    No external OCR needed - Qwen can read and identify language.
    """
    logger.info("[2/4] Detecting language...")

    system_prompt = "You are a language detection assistant."
    user_prompt = """What language is this document written in?

Reply with ONLY the language name (e.g., "German", "English", "French", etc.). No explanation."""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": [
            {"type": "image", "image": image},
            {"type": "text", "text": user_prompt}
        ]}
    ]

    # Preprocess
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    image_inputs, _, mm_kwargs = process_vision_info(messages, return_video_kwargs=True)
    if mm_kwargs and 'fps' in mm_kwargs and isinstance(mm_kwargs['fps'], list) and len(mm_kwargs['fps']) == 0:
        mm_kwargs['fps'] = None

    inputs = {
        'prompt': text,
        'multi_modal_data': {'image': image_inputs} if image_inputs else {}
    }
    if mm_kwargs:
        inputs['mm_processor_kwargs'] = mm_kwargs

    # Generate
    sampling_params = SamplingParams(
        temperature=0.0,
        max_tokens=20,
        stop=["<|im_end|>", "<|endoftext|>", "\n"]
    )

    outputs = llm.generate([inputs], sampling_params=sampling_params)
    language = outputs[0].outputs[0].text.strip()

    logger.info(f"  → Detected: {language}")
    return language


# ============================================================================
# STEP 4: GENERATE HTML (QwenVL HTML with bboxes)
# ============================================================================

def parse_qwenvl_html(html_str: str) -> list:
    """
    Extract elements with point coordinates from QwenVL HTML.

    NEW: Point-based positioning using only top-left anchor (X, Y).
    - Each element is a word/fragment with data-point="X Y"
    - Falls back to data-bbox if needed (using top-left corner)
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html_str, 'html.parser')

    # Look for point-based elements first (new format)
    point_elements = soup.find_all(attrs={"data-point": True})

    # Fallback to bbox-based elements (old format)
    bbox_elements = soup.find_all(attrs={"data-bbox": True}) if not point_elements else []

    logger.info(f"  → Found {len(point_elements)} point elements, {len(bbox_elements)} bbox elements")

    elements = []

    # Process point-based elements (preferred)
    for elem in point_elements:
        point_str = elem.get('data-point', '')
        if not point_str:
            continue

        try:
            x, y = map(float, point_str.split())
        except:
            continue

        # Get class
        elem_class = 'text'
        if elem.get('class'):
            elem_class = elem.get('class')[0] if isinstance(elem.get('class'), list) else elem.get('class')

        text = elem.get_text(strip=True)
        if text:
            elements.append({
                "tag": elem.name,
                "class": elem_class,
                "point": [x, y],
                "text": text
            })

    # Fallback: Convert bbox to point (use top-left corner only)
    if not point_elements and bbox_elements:
        logger.info(f"  → Using fallback: converting bbox top-left to point")
        for elem in bbox_elements:
            # Check if leaf node (no bbox children)
            has_bbox_children = any(
                hasattr(child, 'get') and child.get('data-bbox')
                for child in elem.children
            )

            if not has_bbox_children:
                bbox_str = elem.get('data-bbox', '')
                if not bbox_str:
                    continue

                try:
                    x1, y1, x2, y2 = map(float, bbox_str.split())
                except:
                    continue

                elem_class = 'text'
                if elem.get('class'):
                    elem_class = elem.get('class')[0] if isinstance(elem.get('class'), list) else elem.get('class')

                text = elem.get_text(strip=True)
                if text:
                    elements.append({
                        "tag": elem.name,
                        "class": elem_class,
                        "point": [x1, y1],  # Use top-left corner only
                        "text": text
                    })

    logger.info(f"  → Extracted {len(elements)} text fragments")

    return elements


def reconstruct_html_with_positioning(qwenvl_html: str, dimensions: dict, language: str = "en") -> str:
    """
    Pixel-perfect reconstruction using WIDTH-BASED CLUSTERING.

    Key insight: Qwen's height is garbage (75% padding), width is usable (4% padding).
    Strategy: char_width = width / text_length → cluster → median = font_size
    """
    import re
    from bs4 import BeautifulSoup
    from collections import defaultdict
    from sklearn.cluster import KMeans

    W = dimensions['width']
    H = dimensions['height']

    logger.info(f"  → Building pixel-perfect HTML: {W}×{H}px")
    logger.info(f"  → Font sizing: Width-based clustering (no ratios, no height)")

    # Font family mapping (use single quotes for CSS)
    FONT_MAP = {
        "mono":  "'VT323', monospace",
        "sans":  'system-ui, sans-serif',
        "serif": "'Times New Roman', serif",
        "hand":  "'Courier New', monospace",
        "other": 'system-ui, sans-serif'
    }

    # Parse QwenVL HTML (0-1000 normalized bboxes)
    soup = BeautifulSoup(qwenvl_html, 'html.parser')
    raw_elements = []

    for tag in soup.find_all(['div', 'span', 'p']):
        bbox_attr = tag.get('data-bbox')
        if not bbox_attr:
            continue
        try:
            x1, y1, x2, y2 = map(float, bbox_attr.split())

            # Convert normalized coordinates to pixels
            x1_px = int(x1 * W / 1000)
            y1_px = int(y1 * H / 1000)
            x2_px = int(x2 * W / 1000)
            y2_px = int(y2 * H / 1000)

            # Calculate bbox dimensions
            width_px = x2_px - x1_px
            height_px = y2_px - y1_px

            # Extract font classification
            font_type = tag.get('data-font', 'sans')

        except Exception as e:
            continue

        # Get text content
        tag_copy = str(tag)
        tag_copy = tag_copy.replace('<br>', '___LINEBREAK___').replace('<br/>', '___LINEBREAK___').replace('<br />', '___LINEBREAK___')
        from bs4 import BeautifulSoup as BS
        temp_tag = BS(tag_copy, 'html.parser')
        text = temp_tag.get_text(strip=False)
        if not text.strip():
            continue
        text = text.replace('\n', '<br>')
        cls = tag.get('class', ['text'])[0] if tag.get('class') else 'text'

        # Skip tables
        if cls == 'table':
            logger.info(f"  → Skipping table element at {x1_px},{y1_px}")
            continue

        # Calculate character width (key metric!)
        text_len = len(text.replace('___LINEBREAK___', '').replace('<br>', ''))
        if text_len < 1:  # Skip only empty strings
            continue

        char_width = width_px / text_len

        # Detect vertical text
        is_vertical = False
        if height_px > 0 and width_px > 0:
            aspect_ratio = height_px / width_px
            if aspect_ratio > 3.0:
                is_vertical = True
                logger.info(f"  → Detected vertical text: aspect={aspect_ratio:.2f}, text='{text[:30]}...'")

        raw_elements.append({
            'left': x1_px,
            'top': y1_px,
            'width': width_px,
            'height': height_px,
            'text': text,
            'text_len': text_len,
            'char_width': char_width,
            'class': cls,
            'font_type': font_type,
            'is_vertical': is_vertical
        })

    if not raw_elements:
        logger.warning("  → No elements extracted!")
        return ""

    # CLUSTERING: Group by char_width to find consistent font sizes
    char_widths = np.array([el['char_width'] for el in raw_elements]).reshape(-1, 1)
    n_clusters = min(3, len(raw_elements))  # Max 3 size groups (body, bold, title)

    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10).fit(char_widths)
    labels = kmeans.labels_

    # Calculate median char_width per cluster → font_size (1:1, no ratio!)
    cluster_char_widths = defaultdict(list)
    for el, label in zip(raw_elements, labels):
        cluster_char_widths[label].append(el['char_width'])

    cluster_font_sizes = {}
    for label, cws in cluster_char_widths.items():
        median_cw = np.median(cws)
        # Font size = character width (1:1 for monospace)
        # Add slight bump for readability (1.9x empirical)
        font_size = int(round(median_cw * 1.9))
        cluster_font_sizes[label] = max(8, min(font_size, 200))  # Clamp
        logger.info(f"  → Cluster {label}: median_cw={median_cw:.1f}px → font_size={cluster_font_sizes[label]}px")

    # Apply cluster-based font sizes to all elements
    elements = []
    for el, label in zip(raw_elements, labels):
        font_size_px = cluster_font_sizes[label]

        # Reduce handwritten text size by 30% (it tends to be too large)
        if el['font_type'] == 'hand':
            font_size_px = int(font_size_px * 0.7)

        font_family = FONT_MAP.get(el['font_type'], FONT_MAP['sans'])

        elements.append({
            'left': el['left'],
            'top': el['top'],
            'width': el['width'],
            'height': el['height'],
            'text': el['text'],
            'class': el['class'],
            'font_size': font_size_px,
            'font_family': font_family,
            'font_type': el['font_type'],
            'is_vertical': el['is_vertical']
        })

    # Sort by Y, then X
    elements.sort(key=lambda e: (e['top'], e['left']))

    logger.info(f"  → Extracted {len(elements)} elements with width-based font sizing")

    # Map language name to ISO code for HTML lang attribute
    language_map = {
        'english': 'en',
        'german': 'de',
        'french': 'fr',
        'spanish': 'es',
        'italian': 'it',
        'czech': 'cs',
        'polish': 'pl',
        'russian': 'ru',
        'chinese': 'zh',
        'japanese': 'ja',
        'korean': 'ko'
    }
    lang_code = language_map.get(language.lower(), 'en')

    # Build final HTML
    spans_html = ''
    for el in elements:
        import html as html_module
        # Escape HTML entities first (protects all text)
        escaped_text = html_module.escape(el['text'])
        # THEN convert placeholder to actual <br> tags (after escaping)
        # This prevents <br> from being escaped to &lt;br&gt;
        escaped_text = escaped_text.replace('___LINEBREAK___', '<br>')

        # Add vertical text styling if detected
        vertical_style = ''
        vertical_class = ''
        if el.get('is_vertical', False):
            vertical_class = ' vertical-text'
            # Use writing-mode for proper vertical text rendering
            # Add 180° rotation to flip text for bottom-to-top reading (like book spine)
            # This corrects for left-margin vertical text that reads counter-clockwise
            vertical_style = ' writing-mode: vertical-rl; text-orientation: mixed; transform: rotate(180deg);'

        # Build style with ONLY coordinates (no width/height constraints)
        spans_html += (
            f'<span class="word {el["class"]}{vertical_class}" '
            f'style="position:absolute; left:{el["left"]}px; top:{el["top"]}px; '
            f'font-size:{el["font_size"]}px; line-height:1.2; '
            f'font-family:{el["font_family"]}; '
            f'white-space:nowrap;{vertical_style}">'
            f'{escaped_text}</span>\n'
        )

    # Calculate DPI scale factor (300 DPI → 96 DPI for screen display)
    DPI_SCALE = 96 / 300

    final_html = f'''<!DOCTYPE html>
<html lang="{lang_code}">
<head>
<!--
Generated: {datetime.now().isoformat()}
Source: {W}×{H}px (300 DPI)
Display: {int(W * DPI_SCALE)}×{int(H * DPI_SCALE)}px (96 DPI, scaled)
Font Sizing: V006 - Coordinates Only (No Clipping)
  - font-size = (bbox_width / char_count) × 1.9
  - Uses ONLY left/top coordinates for positioning
  - NO width/height constraints → prevents text clipping
  - white-space:nowrap to prevent wrapping
  - VT323 font for mono, width-based clustering for sizing
-->

<meta charset="UTF-8">
<title>Document</title>
<link href="https://fonts.googleapis.com/css2?family=VT323&display=swap" rel="stylesheet">
<style>
    * {{ margin:0; padding:0; box-sizing:border-box; }}
    body {{ background:#f9f9f9; }}
    .page-container {{
        position: relative;
        width: {W}px;
        height: {H}px;
        background: white;
        margin: 20px auto;
        box-shadow: 0 0 10px rgba(0,0,0,0.1);
        overflow: hidden;
        /* Scale 300 DPI → 96 DPI for screen display */
        transform: scale({DPI_SCALE:.4f});
        transform-origin: top left;
    }}
    /* Wrapper to center scaled content */
    body {{
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: 20px;
    }}
    .page-wrapper {{
        width: {int(W * DPI_SCALE)}px;
        height: {int(H * DPI_SCALE)}px;
    }}
    .word {{
        position: absolute;
        white-space: nowrap;
        line-height: 1.2 !important;
        margin: 0;
        padding: 0;
        overflow: hidden;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    }}
</style>
</head>
<body>
<div class="page-wrapper">
    <div class="page-container">
{spans_html}
    </div>
</div>
</body>
</html>'''

    return final_html


def step4_generate_html(llm, processor, image: Image.Image, language: str, dimensions: dict, pdf_name: str = "output") -> str:
    """
    Single-pass HTML generation with VERBATIM text + line-break preservation.
    """
    logger.info("[3/4] Generating HTML (verbatim mode)...")

    # Stage 1: Get QwenVL HTML with bboxes
    system_prompt = "You are a precise document layout extractor. Output ONLY valid HTML with tight data-bbox attributes."

    user_prompt = f"""You are a visual-layout expert. Parse this document and extract text with TIGHT BOUNDING BOXES + FONT CLASSIFICATION.

Language: {language}

CRITICAL RULES (1st-Principle + Font-Aware):
1. Every text element MUST have:
   - data-bbox="x1 y1 x2 y2" (normalized 0-1000 scale, 0,0=top-left)
   - data-font="type" (font classification - see below)

2. Format: <span class="type" data-bbox="x1 y1 x2 y2" data-font="mono">text</span>

3. **TIGHT BOUNDING BOXES** (Critical):
   - The bbox MUST tightly wrap the VISUAL EXTENT of the ink only
   - Top (y1): Top of tallest character (including ascenders like 'h', 'b')
   - Bottom (y2): Bottom of lowest character (including descenders like 'g', 'p', 'y')
   - Left (x1): Left edge of leftmost character
   - Right (x2): Right edge of rightmost character
   - NO extra padding, NO line spacing, just the INK BOUNDARY

4. **FONT CLASSIFICATION** (New - Critical for character width):
   Classify the font style with ONE of these tags for data-font:
   - "mono"  → fixed-width, every glyph same width (typical receipt printers, code)
   - "sans"  → proportional sans-serif (Helvetica, Arial, clean modern fonts)
   - "serif" → proportional serif (Times, Georgia, fonts with tails/feet)
   - "hand"  → hand-written or cursive appearance
   - "other" → anything else / uncertain

   Examples:
   - Receipt text with aligned columns → data-font="mono"
   - Modern invoice headers → data-font="sans"
   - Old contract text → data-font="serif"
   - Signature or cursive → data-font="hand"

5. **TEXT PRESERVATION**:
   - NEVER merge words split across lines
   - Keep ALL hyphens at line ends
   - Insert <br> ONLY between different horizontal baselines
   - Preserve ALL line breaks as seen
   - Do NOT "fix" or reformat anything

6. **Special elements**:
   - Checkboxes: [x] if checked, [ ] if unchecked
   - Tables: Each cell separately (not entire table)

Classes (for semantic context only):
- title: Large headings
- header: Section headers
- label: Form labels
- value: Form values
- text: Regular text
- small: Fine print

Extract EVERY piece of text with TIGHT bounding boxes AND font classification (no padding, no line spacing)."""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": [
            {"type": "image", "image": image},
            {"type": "text", "text": user_prompt}
        ]}
    ]

    # Preprocess
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    image_inputs, _, mm_kwargs = process_vision_info(messages, return_video_kwargs=True)
    if mm_kwargs and 'fps' in mm_kwargs and isinstance(mm_kwargs['fps'], list) and len(mm_kwargs['fps']) == 0:
        mm_kwargs['fps'] = None

    inputs = {
        'prompt': text,
        'multi_modal_data': {'image': image_inputs} if image_inputs else {}
    }
    if mm_kwargs:
        inputs['mm_processor_kwargs'] = mm_kwargs

    # Generate
    sampling_params = SamplingParams(
        temperature=0.1,
        max_tokens=16384,
        repetition_penalty=1.05,
        top_p=0.4,
        stop=["<|im_end|>", "<|endoftext|>"]
    )

    logger.info(f"  → Generating QwenVL HTML (image: {image.size[0]}×{image.size[1]}px)")
    outputs = llm.generate([inputs], sampling_params=sampling_params)
    qwenvl_html = outputs[0].outputs[0].text.strip()

    logger.info(f"  → Generated {len(qwenvl_html)} chars of QwenVL HTML")

    # Remove markdown fences if present
    if qwenvl_html.startswith("```"):
        qwenvl_html = re.sub(r'^```(?:html|[a-z]*)\s*\n?', '', qwenvl_html)
        qwenvl_html = re.sub(r'\n?```\s*$', '', qwenvl_html)
        logger.info("  → Stripped markdown fences")

    # DEBUG: Save raw QwenVL HTML
    debug_path = Path(f"/root/03_OUTPUT/{pdf_name}_debug_qwenvl.html")
    debug_path.write_text(qwenvl_html, encoding='utf-8')
    logger.info(f"  → DEBUG: Raw QwenVL HTML saved to {debug_path}")

    # Stage 2: Reconstruct with positioning
    logger.info("  → Reconstructing HTML with absolute positioning...")
    final_html = reconstruct_html_with_positioning(qwenvl_html, dimensions, language)
    logger.info(f"  → Final HTML: {len(final_html)} chars")

    return final_html


# ============================================================================
# STEP 4: CLEAN + SAVE
# ============================================================================

def step5_clean_and_save(html: str, output_path: Path, dimensions: dict) -> str:
    """
    Minimal post-processing. Don't break what works.
    """
    logger.info("[4/4] Cleaning + saving...")

    # Remove markdown fences
    if html.startswith("```"):
        html = re.sub(r'^```(?:html|[a-z]*)\s*\n?', '', html)
        html = re.sub(r'\n?```\s*$', '', html)

    # Ensure DOCTYPE
    if not html.strip().startswith('<!DOCTYPE'):
        html = '<!DOCTYPE html>\n' + html

    # Add metadata comment
    metadata = f"""<!--
Generated: {datetime.now().isoformat()}
Source: {dimensions['width']}×{dimensions['height']}px (aspect: {dimensions['aspect_ratio']:.3f})
Pipeline: Single-pass optimized (sub-15sec)
-->
"""
    # Inject after <head> if present
    if '<head>' in html:
        html = html.replace('<head>', f'<head>\n{metadata}')
    else:
        html = metadata + html

    # Save
    output_path.write_text(html, encoding='utf-8')
    logger.info(f"  → Saved: {output_path}")

    return html


# ============================================================================
# MAIN PIPELINE
# ============================================================================

def render_html_to_jpg(html_path: Path, output_jpg: Path, dimensions: dict, timeout_ms: int = 30000):
    """
    Render HTML to JPG with pixel-perfect dimensions.
    Uses exact input dimensions for viewport.
    """
    try:
        from playwright.sync_api import sync_playwright

        logger.info(f"  → Rendering HTML to JPG...")

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(
                viewport={'width': dimensions['width'], 'height': dimensions['height']}
            )
            page.set_default_timeout(timeout_ms)
            page.goto(f'file://{html_path.absolute()}', wait_until='load')

            png_path = output_jpg.with_suffix('.png')
            page.screenshot(path=str(png_path), full_page=True)

            from PIL import Image
            with Image.open(png_path) as img:
                img.convert('RGB').save(output_jpg, 'JPEG', quality=95)

            logger.info(f"  → JPG saved: {output_jpg} ({dimensions['width']}×{dimensions['height']}px)")

            png_path.unlink()
            browser.close()

    except Exception as e:
        logger.warning(f"  → Rendering failed: {e}")


def convert_pdf_to_html(pdf_path: str, output_path: str = None, model_path: str = "/workspace/qwen3_vl_8b_model") -> dict:
    """
    Complete single-pass pipeline. Sub-15 seconds on H100.

    NO validation loops. NO OCR. NO multi-pass. Trust Qwen3 or fail fast.
    """
    import time
    start = time.time()

    logger.info("="*60)
    logger.info("Single-Pass PDF → HTML (Optimized)")
    logger.info("="*60)

    # Load model (cached after first run)
    llm, processor = load_model(model_path)

    # Step 1: Normalize input
    normalized = step1_normalize_input(pdf_path)
    image = normalized['image']
    coords = normalized['coords']
    dimensions = normalized['dimensions']

    # Extract PDF name for logging
    pdf_name = Path(pdf_path).stem

    # Step 2: Detect and blank graphics
    logger.info("[2/5] Graphics detection step...")
    blanked_image = step2_detect_and_blank_graphics(llm, processor, image)

    # Save blanked image for debugging
    blanked_path = Path(f"/root/03_OUTPUT/{pdf_name}_blanked.jpg")
    blanked_image.save(blanked_path, quality=95)
    logger.info(f"  → Blanked image saved: {blanked_path}")

    # Use blanked image for text extraction
    image = blanked_image

    # Step 3: Detect language (using Qwen)
    language = step3_detect_language(llm, processor, image)

    # Save preprocessed image passed to HTML generation
    preprocessed_path = Path(f"/root/03_OUTPUT/{pdf_name}_preprocessed.jpg")
    image.save(preprocessed_path, quality=95)
    logger.info(f"  → Preprocessed image saved: {preprocessed_path}")

    # Step 4: Generate HTML with bounding boxes
    html = step4_generate_html(llm, processor, image, language, dimensions, pdf_name)

    # Step 5: Clean + save
    if output_path is None:
        timestamp = datetime.now().strftime("%y%m%d_%H%M%S")
        output_path = Path(f"/root/03_OUTPUT/{pdf_name}_{timestamp}_output.html")
    else:
        output_path = Path(output_path)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Setup file logging (include PDF name)
    log_file = output_path.parent / f"{output_path.stem}.log"
    file_handler = logging.FileHandler(log_file, mode='w', encoding='utf-8')
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(logging.Formatter("%(asctime)s - %(message)s"))
    logger.addHandler(file_handler)
    logger.info(f"📝 Log file: {log_file}")

    final_html = step5_clean_and_save(html, output_path, dimensions)

    # Render to JPG
    jpg_path = output_path.with_suffix('.jpg')
    render_html_to_jpg(output_path, jpg_path, dimensions)

    elapsed = time.time() - start

    logger.info("="*60)
    logger.info(f"✓ Complete in {elapsed:.1f}s")
    logger.info(f"  HTML: {output_path}")
    logger.info(f"  JPG: {jpg_path}")
    logger.info(f"  Size: {len(final_html)} chars")
    logger.info("="*60)

    return {
        "html": final_html,
        "output_path": str(output_path),
        "elapsed_seconds": elapsed,
        "language": language,
        "dimensions": dimensions
    }


# ============================================================================
# CLI
# ============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Single-pass PDF → HTML (sub-15 sec)")
    parser.add_argument("pdf_path", help="Input PDF file")
    parser.add_argument("-o", "--output", help="Output HTML file (default: timestamped)")
    parser.add_argument("--model", default="/workspace/qwen3_vl_8b_model", help="Model path")

    args = parser.parse_args()

    # Validate input
    if not Path(args.pdf_path).exists():
        logger.error(f"PDF not found: {args.pdf_path}")
        sys.exit(1)

    # Convert
    result = convert_pdf_to_html(
        pdf_path=args.pdf_path,
        output_path=args.output,
        model_path=args.model
    )

    sys.exit(0)
