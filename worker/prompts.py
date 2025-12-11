"""
Prompts for Qwen3-VL Processing
Extracted from PRISM_MASTER_001.py and PRISM_key_values_001.py
"""


def get_html_system_prompt() -> str:
    """
    System prompt for HTML generation
    From PRISM_MASTER_001.py line 768
    """
    return "You are a precise document layout extractor. Output ONLY valid HTML with tight data-bbox attributes."


def get_html_user_prompt(language: str) -> str:
    """
    User prompt for HTML generation with bounding boxes
    Extracted from PRISM_MASTER_001.py lines 770-822

    Args:
        language: Detected document language (e.g., "English", "German")

    Returns:
        Complete HTML generation prompt
    """
    return f"""You are a visual-layout expert. Parse this document and extract text with TIGHT BOUNDING BOXES + FONT CLASSIFICATION at the LINE LEVEL.

Language: {language}

CRITICAL RULES (1st-Principle + Font-Aware):
1. Every text element MUST be at the individual line level—do NOT merge multiple lines into one element, even if they form a paragraph. Provide a separate span for each visual horizontal line of text.
   - For multi-line paragraphs, output each line as its own <span> with a unique tight bbox.
   - If a line wraps or has natural breaks, treat as separate lines based on visual baselines.

2. Every element MUST have:
   - data-bbox="x1 y1 x2 y2" (normalized 0-1000 scale, 0,0=top-left)—tightly around the line's ink only, NO extra vertical padding for line spacing.
   - data-font="type" (font classification - see below)

3. Format: <span class="type" data-bbox="x1 y1 x2 y2" data-font="mono">exact text of the line</span>
   - Do NOT insert <br> or placeholders; each line is independent.

4. **TIGHT BOUNDING BOXES** (Critical for Lines):
   - Top (y1): Top of tallest ascender in the line (e.g., 'h', 'b').
   - Bottom (y2): Bottom of lowest descender in the line (e.g., 'g', 'p').
   - Left (x1): Left edge of leftmost character.
   - Right (x2): Right edge of rightmost character.
   - Box per line only—NO block boxes for paragraphs.
   - Include bounding boxes for even the smallest or isolated text elements, such as single digits or characters in table cells.

5. **FONT CLASSIFICATION** (New - Critical for character width):
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

6. **TEXT PRESERVATION**:
   - Extract VERBATIM text per line—NO merging, NO rewrapping.
   - Preserve ALL hyphens, numbers, punctuation as seen.
   - Accurately recognize digits vs letters: e.g., '0' as zero (not 'o' or 'O'), especially in numerical values, tables, and mono fonts.
   - Do not skip or ignore small, isolated, or single-character text; extract every visible character, including standalone digits in tables or forms.
   - Do NOT "fix" or reformat anything.

7. **Special elements**:
   - Checkboxes: [x] if checked, [ ] if unchecked
   - Tables: Each cell line separately (not entire table)
   - In tables, prioritize numerical accuracy for cell values—treat isolated characters as digits if context suggests (e.g., line totals as '0' not 'o').
   - For tables and forms, extract all cell contents explicitly, even if they are single digits, zeros, or appear isolated in columns—treat them as separate text elements with tight bboxes.

Classes (for semantic context only):
- title: Large headings
- header: Section headers
- label: Form labels
- value: Form values
- text: Regular text
- small: Fine print

Extract EVERY line of text with TIGHT line-level bounding boxes AND font classification (no padding, no line spacing). Output ONLY the HTML spans—NO extra text or wrappers."""


def get_json_system_prompt() -> str:
    """
    System prompt for JSON extraction
    From PRISM_key_values_001.py (implicit in role)
    """
    return "You are an expert forensic document reader. Extract key-value pairs with perfect fidelity."


def get_json_user_prompt() -> str:
    """
    User prompt for key-value JSON extraction
    Extracted from PRISM_key_values_001.py lines 40-71

    Returns:
        Complete JSON extraction prompt
    """
    return """You are an expert forensic document reader working for a global archiving & compliance team.
You process millions of scanned invoices, receipts, delivery notes, contracts, ID cards, bank statements and forms in any language, handwriting, and layout.

Your only job right now:
1. Instantly recognise what kind of document this is.
2. Extract every single visible key–value pair with 100 % fidelity.

You are multilingual by birth and never translate or rephrase anything.

Output exactly this JSON and nothing else — no markdown, no explanations, no extra text:

{
  "document_type": "invoice",
  "extracted_pairs": [
    {"key": "Rechnungsnummer:", "value": "2025-98765"},
    {"key": "Datum:", "value": "21.11.2025"},
    {"key": "Gesamtbetrag:", "value": "1.234,56 €"},
    {"key": "IBAN:", "value": "DE89 3704 0044 0532 0130 00"},
    {"key": "Kundennummer", "value": "K-445566"},
    ...
  ]
}

Rules you never break:
- document_type = one short lowercase English word (invoice / receipt / delivery_note / bank_statement / id_card / contract / form / certificate / letter / other)
- If unsure → "form"
- key = copied character-perfect from the page (language, case, punctuation, colon yes/no)
- value = everything that visually belongs to that key; if empty → null
- Never invent keys that are not visible
- One array entry per visual key on the page
- Raw JSON only"""


def get_language_detection_prompt() -> str:
    """
    Prompt for language detection
    From PRISM_MASTER_001.py lines 365-367
    """
    return """What language is this document written in?

Reply with ONLY the language name (e.g., "German", "English", "French", etc.). No explanation."""


def get_graphics_detection_prompt() -> str:
    """
    Prompt for detecting non-text graphics
    From PRISM_MASTER_001.py lines 180-185
    """
    return """Locate every non-text graphic element in the image, such as logos, QR codes, barcodes, icons, or decorative visuals. Ignore all text, numbers, and textual content. For each detected graphic, determine its type and provide its bounding box.

Output ONLY a JSON list in this format: [{"type": "QR code", "bbox": [x1, y1, x2, y2]}, ...], where:
- "type" is the graphic type (e.g., "logo", "QR code").
- "bbox" is the bounding box with coordinates normalized to 0-1000 (0,0 is top-left; 1000,1000 is bottom-right).
If no graphics are detected, output []."""
