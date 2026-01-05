"""
KVP to HTML Converter
Converts KVP extraction JSON into styled HTML for display in frontend viewer

Generates:
- Summary stats badges
- Detected sectors
- Categorized KVP sections (Header, Supplier, Customer, etc.)
- Line items as HTML tables
- Confidence indicators
- Uncertainty flags
"""

import json
from typing import Dict, List


def kvp_json_to_html(kvp_data: Dict) -> str:
    """
    Convert KVP extraction JSON to HTML for viewing.

    Args:
        kvp_data: Either:
                 - Normalized KVP extraction result (full categorized view)
                 - Structured output dict with 'structured' key (selected fields only)

    Returns:
        str: HTML string with styled KVP display
    """
    html_parts = []

    # Add CSS styles
    html_parts.append(_generate_styles())

    # Main container
    html_parts.append('<div class="kvp-results-container">')

    # Check if this is structured output (user selected specific fields)
    if 'structured' in kvp_data:
        structured_output = kvp_data['structured']
        selected_kvps = kvp_data.get('selected_kvps', [])
        html_parts.append(_generate_structured_output_table(structured_output, selected_kvps))
        html_parts.append('</div>')
        return '\n'.join(html_parts)

    # Otherwise, generate full categorized view

    # Summary stats at top
    html_parts.append(_generate_summary_stats(kvp_data.get('extraction_stats', {})))

    # Detected sectors
    sectors = kvp_data.get('sectors_detected', [])
    if sectors:
        html_parts.append(_generate_sectors_section(sectors))

    # Extract fields
    fields = kvp_data.get('fields', {})

    # Generate sections for each category
    category_names = {
        'header': 'Header Information',
        'supplier': 'Supplier Details',
        'customer': 'Customer Details',
        'delivery': 'Delivery Information',
        'totals': 'Totals & Amounts',
        'payment': 'Payment Information',
        'other': 'Other Fields'
    }

    for category, display_name in category_names.items():
        items = fields.get(category, [])
        if items:
            html_parts.append(_generate_kvp_section(display_name, items, category))

    # Line items table
    line_items = fields.get('line_items', [])
    if line_items:
        html_parts.append(_generate_line_items_table(line_items))

    html_parts.append('</div>')  # Close main container

    return '\n'.join(html_parts)


def _generate_styles() -> str:
    """Generate CSS styles for KVP display"""
    return """
<style>
.kvp-results-container {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
    background: #ffffff;
    color: #1a1a1a;
}

.kvp-summary-stats {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 24px;
    padding: 16px;
    background: #f5f5f5;
    border-radius: 8px;
}

.kvp-stat {
    display: flex;
    flex-direction: column;
    padding: 8px 16px;
    background: white;
    border-radius: 6px;
    border: 1px solid #e0e0e0;
}

.kvp-stat-label {
    font-size: 12px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
}

.kvp-stat-value {
    font-size: 20px;
    font-weight: 600;
    color: #1a1a1a;
}

.kvp-sectors {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 24px;
}

.kvp-sector-badge {
    padding: 6px 12px;
    background: #c7ff00;
    color: #1a1a1a;
    border-radius: 16px;
    font-size: 13px;
    font-weight: 500;
}

.kvp-section {
    margin-bottom: 32px;
}

.kvp-section-title {
    font-size: 18px;
    font-weight: 600;
    color: #1a1a1a;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 2px solid #c7ff00;
}

.kvp-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    margin-bottom: 8px;
    background: #f9f9f9;
    border-radius: 6px;
    border-left: 3px solid #e0e0e0;
}

.kvp-item:hover {
    background: #f0f0f0;
}

.kvp-item-left {
    display: flex;
    flex-direction: column;
    flex: 1;
    margin-right: 16px;
}

.kvp-key {
    font-size: 14px;
    font-weight: 500;
    color: #1a1a1a;
    margin-bottom: 4px;
}

.kvp-visible-key {
    font-size: 12px;
    color: #666;
    font-style: italic;
}

.kvp-value {
    font-size: 16px;
    color: #1a1a1a;
    font-weight: 400;
    margin-top: 4px;
}

.kvp-value-null {
    color: #999;
    font-style: italic;
}

.kvp-item-right {
    display: flex;
    gap: 8px;
    align-items: center;
}

.kvp-badge {
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.confidence-high {
    background: #d4edda;
    color: #155724;
}

.confidence-medium {
    background: #fff3cd;
    color: #856404;
}

.confidence-low {
    background: #f8d7da;
    color: #721c24;
}

.uncertain-badge {
    background: #ffeaa7;
    color: #d63031;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
}

.kvp-table-container {
    margin-bottom: 32px;
}

.kvp-table {
    width: 100%;
    border-collapse: collapse;
    background: white;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.kvp-table thead {
    background: #1a1a1a;
    color: white;
}

.kvp-table th {
    padding: 12px 16px;
    text-align: left;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.kvp-table td {
    padding: 12px 16px;
    border-bottom: 1px solid #f0f0f0;
    font-size: 14px;
    color: #1a1a1a;
}

.kvp-table tbody tr:hover {
    background: #f9f9f9;
}

.kvp-table tbody tr:last-child td {
    border-bottom: none;
}

.kvp-empty-message {
    text-align: center;
    padding: 32px;
    color: #999;
    font-style: italic;
}
</style>
"""


def _generate_summary_stats(stats: Dict) -> str:
    """Generate summary statistics badges"""
    if not stats:
        return ''

    keys_found = stats.get('keys_found', 0)
    total_keys = stats.get('total_standardized_keys', 0)
    completeness = stats.get('completeness_pct', 0)
    required_completeness = stats.get('required_completeness_pct', 0)
    line_items = stats.get('line_items_found', 0)
    sectors_matched = stats.get('sectors_matched', 0)

    return f"""
<div class="kvp-summary-stats">
    <div class="kvp-stat">
        <div class="kvp-stat-label">Keys Found</div>
        <div class="kvp-stat-value">{keys_found}/{total_keys}</div>
    </div>
    <div class="kvp-stat">
        <div class="kvp-stat-label">Completeness</div>
        <div class="kvp-stat-value">{completeness}%</div>
    </div>
    <div class="kvp-stat">
        <div class="kvp-stat-label">Required Fields</div>
        <div class="kvp-stat-value">{required_completeness}%</div>
    </div>
    <div class="kvp-stat">
        <div class="kvp-stat-label">Line Items</div>
        <div class="kvp-stat-value">{line_items}</div>
    </div>
    <div class="kvp-stat">
        <div class="kvp-stat-label">Sectors Matched</div>
        <div class="kvp-stat-value">{sectors_matched}</div>
    </div>
</div>
"""


def _generate_sectors_section(sectors: List[Dict]) -> str:
    """Generate detected sectors badges"""
    badges = []
    for sector in sectors:
        sector_name = sector.get('sector_name', sector.get('sector_id', 'Unknown'))
        badges.append(f'<div class="kvp-sector-badge">{sector_name}</div>')

    return f"""
<div class="kvp-sectors">
    {''.join(badges)}
</div>
"""


def _generate_kvp_section(title: str, items: List[Dict], category: str) -> str:
    """Generate a section of KVP items"""
    if not items:
        return ''

    items_html = []
    for item in items:
        items_html.append(_generate_kvp_item(item))

    return f"""
<div class="kvp-section kvp-category-{category}">
    <h3 class="kvp-section-title">{title}</h3>
    {''.join(items_html)}
</div>
"""


def _generate_kvp_item(item: Dict) -> str:
    """Generate a single KVP item"""
    visible_key = item.get('visible_key', '')
    standardized_key = item.get('standardized_key')
    value = item.get('value')
    confidence = item.get('confidence', 'medium')
    uncertain = item.get('uncertain', False)

    # Display key (prefer standardized, fall back to visible)
    display_key = standardized_key if standardized_key else visible_key

    # Value display
    if value is None or value == '':
        value_html = '<span class="kvp-value kvp-value-null">(not found)</span>'
    else:
        value_html = f'<div class="kvp-value">{_escape_html(str(value))}</div>'

    # Show visible key if different from standardized
    visible_key_html = ''
    if visible_key and standardized_key and visible_key != standardized_key:
        visible_key_html = f'<div class="kvp-visible-key">Original: {_escape_html(visible_key)}</div>'

    # Badges
    badges = []
    badges.append(f'<span class="kvp-badge confidence-{confidence}">{confidence}</span>')
    if uncertain:
        badges.append('<span class="uncertain-badge">Uncertain</span>')

    return f"""
<div class="kvp-item">
    <div class="kvp-item-left">
        <div class="kvp-key">{_escape_html(display_key)}</div>
        {visible_key_html}
        {value_html}
    </div>
    <div class="kvp-item-right">
        {''.join(badges)}
    </div>
</div>
"""


def _generate_line_items_table(line_items: List[Dict]) -> str:
    """Generate HTML table for line items"""
    if not line_items:
        return ''

    # Extract all unique column names (excluding 'confidence')
    all_columns = set()
    for item in line_items:
        all_columns.update(k for k in item.keys() if k != 'confidence')

    columns = sorted(all_columns)

    # Generate table header
    header_cells = [f'<th>{_escape_html(col)}</th>' for col in columns]
    header_html = f"<tr>{''.join(header_cells)}</tr>"

    # Generate table rows
    rows_html = []
    for item in line_items:
        cells = []
        for col in columns:
            value = item.get(col, '')
            cells.append(f'<td>{_escape_html(str(value))}</td>')
        rows_html.append(f"<tr>{''.join(cells)}</tr>")

    return f"""
<div class="kvp-table-container">
    <h3 class="kvp-section-title">Line Items</h3>
    <table class="kvp-table">
        <thead>{header_html}</thead>
        <tbody>{''.join(rows_html)}</tbody>
    </table>
</div>
"""


def _escape_html(text: str) -> str:
    """Escape HTML special characters"""
    return (text
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('"', '&quot;')
            .replace("'", '&#39;'))


def _generate_structured_output_table(structured_output: Dict[str, str], selected_kvps: List[Dict]) -> str:
    """
    Generate simple table view for structured output (selected fields only).

    Args:
        structured_output: Dict mapping key_name -> value (or "")
        selected_kvps: List of selected KVP objects with key_name

    Returns:
        str: HTML table showing selected fields and their values
    """
    html = []

    # Title
    total_fields = len(structured_output)
    found_fields = sum(1 for v in structured_output.values() if v)
    html.append(f'''
    <div class="structured-output-header">
        <h2>📋 Selected Fields Extraction</h2>
        <div class="structured-stats">
            <span class="stat-badge">Fields Requested: {total_fields}</span>
            <span class="stat-badge success">Found: {found_fields}</span>
            <span class="stat-badge">Missing: {total_fields - found_fields}</span>
        </div>
    </div>
    ''')

    # Table
    html.append('<table class="structured-kvp-table">')
    html.append('<thead><tr><th style="width: 50px;">Status</th><th>Field Name</th><th>Value</th></tr></thead>')
    html.append('<tbody>')

    # Iterate in order of selection
    for key, value in structured_output.items():
        status_icon = '✓' if value else '✗'
        status_class = 'found' if value else 'missing'
        display_value = _escape_html(str(value)) if value else '<span style="color: #999; font-style: italic;">(not found)</span>'
        display_key = _escape_html(key.replace('_', ' ').title())

        html.append(f'''
        <tr class="kvp-row {status_class}">
            <td class="status-cell">{status_icon}</td>
            <td class="key-cell">{display_key}</td>
            <td class="value-cell">{display_value}</td>
        </tr>
        ''')

    html.append('</tbody>')
    html.append('</table>')

    # Add additional styles for structured view
    html.append('''
    <style>
    .structured-output-header {
        margin-bottom: 20px;
        padding: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 8px;
        color: white;
    }

    .structured-output-header h2 {
        margin: 0 0 15px 0;
        font-size: 24px;
    }

    .structured-stats {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
    }

    .stat-badge {
        padding: 6px 12px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
        font-size: 14px;
        font-weight: 500;
    }

    .stat-badge.success {
        background: rgba(72, 187, 120, 0.3);
    }

    .structured-kvp-table {
        width: 100%;
        border-collapse: collapse;
        background: white;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .structured-kvp-table thead {
        background: #f7fafc;
    }

    .structured-kvp-table th {
        text-align: left;
        padding: 12px 16px;
        font-weight: 600;
        color: #2d3748;
        border-bottom: 2px solid #e2e8f0;
    }

    .structured-kvp-table tbody tr {
        border-bottom: 1px solid #e2e8f0;
    }

    .structured-kvp-table tbody tr:hover {
        background: #f7fafc;
    }

    .structured-kvp-table td {
        padding: 12px 16px;
    }

    .status-cell {
        text-align: center;
        font-size: 18px;
        font-weight: bold;
    }

    .kvp-row.found .status-cell {
        color: #48bb78;
    }

    .kvp-row.missing .status-cell {
        color: #f56565;
    }

    .key-cell {
        font-weight: 600;
        color: #2d3748;
    }

    .value-cell {
        color: #4a5568;
        font-family: 'Monaco', 'Courier New', monospace;
    }
    </style>
    ''')

    return '\n'.join(html)
