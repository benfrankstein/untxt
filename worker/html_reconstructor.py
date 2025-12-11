"""
HTML Reconstructor
Converts raw QwenVL HTML (with data-bbox) to pixel-perfect positioned HTML
Based on PRISM_MASTER_001.py reconstruct_html_with_positioning (lines 493-758)
"""

import re
import logging
from bs4 import BeautifulSoup
from typing import Dict, List, Any
from datetime import datetime

logger = logging.getLogger(__name__)


def reconstruct_html_with_positioning(qwenvl_html: str, dimensions: Dict[str, int], language: str = 'en') -> str:
    """
    Convert data-bbox attributes to absolute positioning styles

    Args:
        qwenvl_html: Raw HTML with data-bbox attributes (0-1000 normalized)
        dimensions: {'width': px, 'height': px} at 300 DPI
        language: Document language for HTML lang attribute

    Returns:
        Complete HTML with page container and absolute positioning
    """
    W = dimensions['width']
    H = dimensions['height']

    logger.info(f"  → Reconstructing HTML with positioning: {W}×{H}px")

    # Parse QwenVL HTML (0-1000 normalized bboxes)
    soup = BeautifulSoup(qwenvl_html, 'html.parser')
    raw_elements = []

    for tag in soup.find_all(['div', 'span', 'p']):
        bbox_attr = tag.get('data-bbox')
        if not bbox_attr:
            continue

        try:
            # Parse normalized coordinates (0-1000 scale)
            x1, y1, x2, y2 = map(float, bbox_attr.split())

            # Convert normalized coordinates to pixels
            x1_px = int(x1 * W / 1000)
            y1_px = int(y1 * H / 1000)
            x2_px = int(x2 * W / 1000)
            y2_px = int(y2 * H / 1000)

            # Calculate bbox dimensions
            width_px = x2_px - x1_px
            height_px = y2_px - y1_px

            # Extract font classification (if available)
            font_type = tag.get('data-font', 'sans')

        except Exception as e:
            logger.warning(f"Failed to parse bbox '{bbox_attr}': {e}")
            continue

        # Get text content
        tag_copy = str(tag)
        tag_copy = tag_copy.replace('<br>', '___LINEBREAK___').replace('<br/>', '___LINEBREAK___').replace('<br />', '___LINEBREAK___')
        temp_soup = BeautifulSoup(tag_copy, 'html.parser')
        text = temp_soup.get_text(strip=False)

        if not text.strip():
            continue

        text = text.replace('\n', '<br>')
        cls = tag.get('class', ['text'])[0] if tag.get('class') else 'text'

        # Calculate character width (key metric!)
        text_len = len(text.replace('___LINEBREAK___', '').replace('<br>', ''))
        if text_len < 1:
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
        return _build_empty_html(W, H, language)

    # Simple font sizing: use character width * 1.9
    # (No clustering for simplicity - can add later if needed)
    elements = []
    for el in raw_elements:
        font_size_px = max(8, min(int(el['char_width'] * 1.9), 200))  # Clamp 8-200px

        # Reduce handwritten text size by 30% (it tends to be too large)
        if el['font_type'] == 'hand':
            font_size_px = int(font_size_px * 0.7)

        # Font family mapping
        font_map = {
            "mono":  "'VT323', monospace",
            "sans":  'system-ui, sans-serif',
            "serif": "'Times New Roman', serif",
            "hand":  "'Courier New', monospace",
            "other": 'system-ui, sans-serif'
        }
        font_family = font_map.get(el['font_type'], font_map['sans'])

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

    logger.info(f"  → Extracted {len(elements)} positioned elements")

    # Build final HTML
    spans_html = ''
    for el in elements:
        import html as html_module
        # Escape HTML entities first (protects all text)
        escaped_text = html_module.escape(el['text'])
        # THEN convert placeholder to actual <br> tags (after escaping)
        escaped_text = escaped_text.replace('___LINEBREAK___', '<br>')

        # Add vertical text styling if detected
        vertical_style = ''
        vertical_class = ''
        if el.get('is_vertical', False):
            vertical_class = ' vertical-text'
            # Use writing-mode for proper vertical text rendering
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

    # Map language name to ISO code
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

    final_html = f'''<!DOCTYPE html>
<html lang="{lang_code}">
<head>
<!--
Generated: {datetime.utcnow().isoformat()}Z
Source: {W}×{H}px (300 DPI)
Display: {int(W * DPI_SCALE)}×{int(H * DPI_SCALE)}px (96 DPI, scaled)
Font Sizing: Width-based (bbox_width / char_count × 1.9)
Pipeline: MLX Qwen3-VL → Positioned HTML
-->
<meta charset="UTF-8">
<title>Document</title>
<link href="https://fonts.googleapis.com/css2?family=VT323&display=swap" rel="stylesheet">
<style>
    * {{ margin:0; padding:0; box-sizing:border-box; }}
    body {{
        background:#f9f9f9;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: 20px;
    }}
    .page-wrapper {{
        width: {int(W * DPI_SCALE)}px;
        height: {int(H * DPI_SCALE)}px;
    }}
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
    .word {{
        position: absolute;
        white-space: nowrap;
        line-height: 1.2 !important;
        margin: 0;
        padding: 0;
        overflow: visible;
    }}
    .vertical-text {{
        writing-mode: vertical-rl;
        text-orientation: mixed;
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


def _build_empty_html(width: int, height: int, language: str) -> str:
    """Build empty HTML page when no elements extracted"""
    DPI_SCALE = 96 / 300

    return f'''<!DOCTYPE html>
<html lang="{language}">
<head>
<meta charset="UTF-8">
<title>Document</title>
<style>
    * {{ margin:0; padding:0; box-sizing:border-box; }}
    body {{
        background:#f9f9f9;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: 20px;
    }}
    .page-wrapper {{
        width: {int(width * DPI_SCALE)}px;
        height: {int(height * DPI_SCALE)}px;
    }}
    .page-container {{
        position: relative;
        width: {width}px;
        height: {height}px;
        background: white;
        margin: 20px auto;
        box-shadow: 0 0 10px rgba(0,0,0,0.1);
        overflow: hidden;
        transform: scale({DPI_SCALE:.4f});
        transform-origin: top left;
    }}
    .error {{
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: #999;
        font-size: 24px;
        text-align: center;
    }}
</style>
</head>
<body>
<div class="page-wrapper">
    <div class="page-container">
        <div class="error">No content extracted</div>
    </div>
</div>
</body>
</html>'''
