"""
Anonymization Processor - PII Detection & Anonymization
Based on PRISM_anon_001.py with integration into worker pool

Handles:
- Building anonymization extraction prompts
- Applying anonymization strategies (redact, synthetic, generalize, mask)
- Generating tokenized output and mappings
- Creating audit trails for compliance
"""

import json
import re
import hashlib
import logging
from typing import Dict, List, Optional, Tuple
from datetime import datetime

logger = logging.getLogger(__name__)

# Try to import Faker for synthetic data generation
try:
    from faker import Faker
    FAKER_AVAILABLE = True
    fake = Faker(['en_US', 'de_DE', 'es_ES', 'fr_FR'])  # Multi-locale support
except ImportError:
    FAKER_AVAILABLE = False
    fake = None
    logger.warning("⚠️  Faker not installed. Synthetic strategy will fallback to redact.")


def build_anon_extraction_prompt(selected_fields: Optional[List[Dict]] = None) -> str:
    """
    Build the prompt for anonymization extraction.
    Extracts ALL key-value pairs (no filtering) for anonymization.

    Args:
        selected_fields: Optional list of field objects user selected
                        Each object has either 'key_name' (master) or 'custom_key_name' (custom)
                        Note: For anon, we extract ALL fields but this helps prioritize

    Returns:
        str: Complete extraction prompt for Qwen model
    """
    # Base prompt - extract EVERYTHING for anonymization
    base_prompt = """<image>Extract ALL key-value pairs from this document. Output only valid JSON.

EXTRACTION RULES:

1. NON-TABLE CONTENT
   - Key is typically LEFT of or ABOVE its value
   - Extract the key exactly as written, then its associated value
   - Include labels, field names, headings that have corresponding data

2. TABLE CONTENT
   - Column headers become KEYS
   - Each cell value pairs with its column header
   - Extract row by row, preserving row grouping

3. FIDELITY
   - Transcribe EXACTLY as visible (no corrections, no assumptions)
   - Preserve original language, formatting, symbols
   - If a field label exists but has NO value, use null

4. CONFIDENCE
   - "high": Clear, sharp, machine-printed
   - "medium": Readable but degraded/small
   - "low": Handwritten, faded, partially obscured

OUTPUT FORMAT (valid JSON only):

{
  "items": [
    {"key": "Invoice No", "value": "12345", "confidence": "high"},
    {"key": "Customer Name", "value": "John Smith", "confidence": "high"},
    {"key": "Date", "value": "15.03.2025", "confidence": "high"}
  ],
  "tables": [
    {
      "headers": ["Item", "Qty", "Price"],
      "rows": [
        {"Item": "Widget A", "Qty": "10", "Price": "5.00", "confidence": "high"}
      ]
    }
  ]
}

IMPORTANT: Extract EVERYTHING visible. This data will be anonymized for privacy compliance."""

    # If user selected specific fields, add them as a note (but still extract everything)
    if selected_fields and len(selected_fields) > 0:
        key_names = []
        for field in selected_fields:
            key_name = field.get('key_name') or field.get('custom_key_name')
            if key_name:
                key_names.append(key_name)

        if key_names:
            base_prompt += f"""

NOTE: User is particularly interested in these fields: {', '.join(f'"{k}"' for k in key_names)}
However, extract ALL fields for complete anonymization."""

    return base_prompt


# ============================================================================
# ANONYMIZATION STRATEGIES
# ============================================================================

def anonymize_value(value: str, key: str, strategy: str = 'synthetic') -> Tuple[str, dict]:
    """
    Anonymize a single value based on strategy.

    Args:
        value: Original value to anonymize
        key: Field name (helps determine value type)
        strategy: 'redact', 'synthetic', 'generalize', 'mask'

    Returns:
        Tuple of (anonymized_value, audit_info)
    """
    if value is None or value == '':
        return value, None

    original_hash = hashlib.sha256(str(value).encode()).hexdigest()[:16]

    audit_info = {
        'key': key,
        'original_hash': original_hash,
        'original_length': len(str(value)),
        'strategy_applied': strategy,
        'timestamp': datetime.now().isoformat()
    }

    if strategy == 'redact':
        anonymized = anonymize_redact(value, key)
    elif strategy == 'synthetic':
        anonymized = anonymize_synthetic(value, key)
    elif strategy == 'generalize':
        anonymized = anonymize_generalize(value, key)
    elif strategy == 'mask':
        anonymized = anonymize_mask(value, key)
    else:
        anonymized = f"[REDACTED:{len(value)}chars]"

    audit_info['anonymized_length'] = len(str(anonymized))

    return anonymized, audit_info


def anonymize_redact(value: str, key: str) -> str:
    """Replace with [REDACTED] marker - most restrictive."""
    return f"[REDACTED:{len(value)}chars]"


def anonymize_synthetic(value: str, key: str) -> str:
    """
    Replace with realistic fake data using Faker.
    Uses key name to determine appropriate synthetic value type.
    """
    if not FAKER_AVAILABLE:
        logger.warning("⚠️  Faker not installed, falling back to redact")
        return anonymize_redact(value, key)

    key_lower = key.lower()

    # === NAMES ===
    if any(k in key_lower for k in ['first name', 'given name', 'vorname', 'prénom', 'nombre']):
        return fake.first_name()
    if any(k in key_lower for k in ['last name', 'surname', 'family name', 'nachname', 'nom', 'apellido']):
        return fake.last_name()
    if any(k in key_lower for k in ['name', 'patient', 'customer', 'client', 'versicherten']):
        if len(value.split()) >= 2:
            return fake.name()
        return fake.first_name()

    # === CONTACT ===
    if any(k in key_lower for k in ['email', 'e-mail', 'correo']):
        return fake.email()
    if any(k in key_lower for k in ['phone', 'mobile', 'telefon', 'tel', 'fax', 'teléfono']):
        return fake.phone_number()

    # === ADDRESS ===
    if any(k in key_lower for k in ['street', 'address', 'adresse', 'straße', 'strasse', 'dirección']):
        return fake.street_address()
    if any(k in key_lower for k in ['city', 'stadt', 'town', 'ciudad', 'ville']):
        return fake.city()
    if any(k in key_lower for k in ['zip', 'postal', 'plz', 'postleitzahl']):
        return fake.zipcode()
    if any(k in key_lower for k in ['state', 'province', 'bundesland', 'provincia']):
        return fake.state()
    if any(k in key_lower for k in ['country', 'land', 'país', 'pays']):
        return fake.country()

    # === IDs & NUMBERS ===
    if any(k in key_lower for k in ['ssn', 'social security']):
        return fake.ssn()
    if any(k in key_lower for k in ['ein', 'tax id', 'steuer', 'nif']):
        return f"{fake.random_int(10, 99)}-{fake.random_int(1000000, 9999999)}"
    if any(k in key_lower for k in ['account', 'acct', 'konto', 'iban']):
        return fake.iban()
    if any(k in key_lower for k in ['invoice', 'rechnung', 'factura']):
        return f"INV-{fake.random_int(100000, 999999)}"
    if any(k in key_lower for k in ['order', 'bestellung', 'pedido']):
        return f"ORD-{fake.random_int(100000, 999999)}"
    if any(k in key_lower for k in ['policy', 'member', 'insurance', 'versicherten']):
        return f"POL-{fake.random_int(100000000, 999999999)}"
    if any(k in key_lower for k in ['patient id', 'mrn', 'medical record']):
        return f"MRN-{fake.random_int(100000, 999999)}"
    if any(k in key_lower for k in ['license', 'permit', 'führerschein']):
        return fake.license_plate()

    # === DATES ===
    if any(k in key_lower for k in ['birth', 'dob', 'geboren', 'geburtsdatum', 'geb.']):
        return fake.date_of_birth(minimum_age=18, maximum_age=85).strftime('%d.%m.%Y')
    if any(k in key_lower for k in ['date', 'datum', 'fecha']):
        return fake.date_this_year().strftime('%d.%m.%Y')

    # === MONEY ===
    if any(k in key_lower for k in ['amount', 'total', 'sum', 'price', 'betrag', 'preis', 'tax', 'vat']):
        # Preserve currency format
        if '€' in value or 'eur' in value.lower():
            return f"€{fake.random_int(10, 9999)}.{fake.random_int(0, 99):02d}"
        if '$' in value or 'usd' in value.lower():
            return f"${fake.random_int(10, 9999)}.{fake.random_int(0, 99):02d}"
        if re.search(r'\d+[.,]\d{2}', value):
            return f"{fake.random_int(10, 9999)}.{fake.random_int(0, 99):02d}"
        return str(fake.random_int(10, 9999))

    # === QUANTITIES ===
    if any(k in key_lower for k in ['qty', 'quantity', 'menge', 'anzahl', 'cantidad']):
        return str(fake.random_int(1, 100))

    # === COMPANY/ORG ===
    if any(k in key_lower for k in ['company', 'firm', 'organization', 'firma', 'empresa']):
        return fake.company()

    # === JOB ===
    if any(k in key_lower for k in ['job', 'occupation', 'title', 'position', 'beruf']):
        return fake.job()

    # === FALLBACK: Preserve structure ===
    if re.match(r'^[\d\s.,/-]+$', value):
        # Numeric - generate similar format
        digits = re.sub(r'[^\d]', '', value)
        if digits:
            return ''.join([str(fake.random_int(0, 9)) for _ in digits])

    # Default: Mark as synthetic with length
    return f"[SYNTHETIC:{len(value)}chars]"


def anonymize_generalize(value: str, key: str) -> str:
    """Reduce precision for k-anonymity style protection."""
    key_lower = key.lower()

    # Age: generalize to ranges
    if 'age' in key_lower:
        try:
            age = int(re.search(r'\d+', str(value)).group())
            if age < 18:
                return "0-17"
            elif age < 30:
                return "18-29"
            elif age < 45:
                return "30-44"
            elif age < 60:
                return "45-59"
            elif age < 75:
                return "60-74"
            elif age < 90:
                return "75-89"
            else:
                return "90+"  # HIPAA: ages >89
        except:
            return "[AGE_RANGE]"

    # Date of birth: keep only year
    elif any(n in key_lower for n in ['date of birth', 'dob', 'birthdate', 'geburtsdatum']):
        try:
            year_match = re.search(r'(19|20)\d{2}', str(value))
            if year_match:
                year = int(year_match.group())
                current_year = datetime.now().year
                age = current_year - year
                if age > 89:
                    return "YEAR_BEFORE_1935"
                return str(year)
            return "[YEAR_ONLY]"
        except:
            return "[YEAR_ONLY]"

    # ZIP code: keep first 3 digits
    elif any(n in key_lower for n in ['zip', 'postal', 'plz']):
        zip_digits = re.sub(r'[^0-9]', '', str(value))
        if len(zip_digits) >= 3:
            return zip_digits[:3] + "XX"
        return "[ZIP_GENERALIZED]"

    # Dates: keep only month and year
    elif any(n in key_lower for n in ['date', 'datum']):
        try:
            for fmt in ['%Y-%m-%d', '%d.%m.%Y', '%m/%d/%Y']:
                try:
                    dt = datetime.strptime(str(value), fmt)
                    return dt.strftime('%Y-%m')
                except:
                    pass
            year_match = re.search(r'(19|20)\d{2}', str(value))
            if year_match:
                return year_match.group()
            return "[DATE_GENERALIZED]"
        except:
            return "[DATE_GENERALIZED]"

    # Geographic: generalize
    elif any(n in key_lower for n in ['city', 'stadt', 'town']):
        return "[CITY_REGION]"
    elif any(n in key_lower for n in ['address', 'street', 'adresse']):
        return "[ADDRESS_REMOVED]"

    # Default: partial redaction
    else:
        if len(str(value)) > 4:
            return str(value)[:2] + "***" + str(value)[-2:]
        return "[GENERALIZED]"


def anonymize_mask(value: str, key: str) -> str:
    """Partial masking - show some characters for verification."""
    key_lower = key.lower()
    val_str = str(value)

    # SSN: show last 4 digits
    if any(n in key_lower for n in ['ssn', 'social security']):
        digits = re.sub(r'[^0-9]', '', val_str)
        if len(digits) >= 4:
            return f"***-**-{digits[-4:]}"
        return "***-**-****"

    # Phone: show last 4 digits
    elif any(n in key_lower for n in ['phone', 'mobile', 'tel', 'fax']):
        digits = re.sub(r'[^0-9]', '', val_str)
        if len(digits) >= 4:
            return f"(***) ***-{digits[-4:]}"
        return "(***) ***-****"

    # Email: show domain only
    elif any(n in key_lower for n in ['email', 'e-mail']):
        if '@' in val_str:
            domain = val_str.split('@')[-1]
            return f"***@{domain}"
        return "***@***.***"

    # Account numbers: show last 4
    elif any(n in key_lower for n in ['account', 'acct', 'iban', 'routing']):
        alnum = re.sub(r'[^0-9A-Za-z]', '', val_str)
        if len(alnum) >= 4:
            return f"****{alnum[-4:]}"
        return "********"

    # Names: show initials
    elif any(n in key_lower for n in ['name', 'patient', 'customer']):
        words = val_str.split()
        if len(words) >= 2:
            return f"{words[0][0]}. {words[-1][0]}."
        elif len(words) == 1 and len(words[0]) > 0:
            return f"{words[0][0]}."
        return "*. *."

    # Default: show first and last char
    else:
        if len(val_str) > 4:
            return val_str[0] + "*" * (len(val_str) - 2) + val_str[-1]
        elif len(val_str) > 0:
            return val_str[0] + "*" * (len(val_str) - 1)
        return "****"


# ============================================================================
# MAIN ANONYMIZATION PIPELINE
# ============================================================================

def anonymize_extracted_data(
    extracted_data: dict,
    strategy: str = 'synthetic',
    generate_audit: bool = False
) -> Tuple[dict, List[dict], List[dict]]:
    """
    Anonymize ALL extracted values using the specified strategy.

    Args:
        extracted_data: Output from extraction (items array format)
        strategy: 'redact', 'synthetic', 'generalize', 'mask'
        generate_audit: Whether to generate audit trail

    Returns:
        Tuple of (anonymized_data, audit_trail, mapping)
    """
    audit_trail = []
    mapping = []  # Before → After mapping for token generation
    anonymized = json.loads(json.dumps(extracted_data))  # Deep copy

    total_values = 0
    anonymized_count = 0

    # Process items array
    if 'items' in anonymized and isinstance(anonymized['items'], list):
        for item in anonymized['items']:
            key = item.get('key', '')
            value = item.get('value')

            if not value or str(value).strip() == '':
                continue

            total_values += 1
            original_value = str(value)

            # Anonymize the value
            anonymized_value, audit_info = anonymize_value(original_value, key, strategy)

            # Update the item
            item['value'] = anonymized_value
            item['anonymized'] = True

            # Record mapping
            mapping.append({
                'key': key,
                'original': original_value,
                'anonymized': anonymized_value
            })

            # Audit trail
            if generate_audit and audit_info:
                audit_trail.append(audit_info)

            anonymized_count += 1

    # Process tables
    if 'tables' in anonymized and isinstance(anonymized['tables'], list):
        for table in anonymized['tables']:
            headers = table.get('headers', [])
            rows = table.get('rows', [])

            for row in rows:
                for header in headers:
                    if header in row:
                        value = row[header]
                        if not value or str(value).strip() == '':
                            continue

                        total_values += 1
                        original_value = str(value)

                        anonymized_value, audit_info = anonymize_value(original_value, header, strategy)
                        row[header] = anonymized_value

                        mapping.append({
                            'key': header,
                            'original': original_value,
                            'anonymized': anonymized_value
                        })

                        if generate_audit and audit_info:
                            audit_trail.append(audit_info)

                        anonymized_count += 1

    # Add metadata
    anonymized['anonymization_metadata'] = {
        'version': 'ANON_V001',
        'timestamp': datetime.now().isoformat(),
        'strategy': strategy,
        'total_values_found': total_values,
        'values_anonymized': anonymized_count,
        'audit_trail_generated': generate_audit
    }

    logger.info(f"✓ Anonymization complete: {anonymized_count}/{total_values} values replaced")

    return anonymized, audit_trail, mapping


def classify_token_type(key: str) -> str:
    """
    Classify a key into a token type for tokenized output.
    Returns abbreviated token type (NAME, DATE, AMOUNT, etc.)
    """
    key_lower = key.lower().strip()

    # Names
    if any(k in key_lower for k in ['first name', 'given name', 'vorname']):
        return 'FNAME'
    if any(k in key_lower for k in ['last name', 'surname', 'nachname']):
        return 'LNAME'
    if any(k in key_lower for k in ['name', 'patient', 'customer', 'client']):
        return 'NAME'

    # Dates
    if any(k in key_lower for k in ['birth', 'dob', 'geburtsdatum']):
        return 'DOB'
    if any(k in key_lower for k in ['date', 'datum']):
        return 'DATE'

    # Contact
    if any(k in key_lower for k in ['email', 'e-mail']):
        return 'EMAIL'
    if any(k in key_lower for k in ['phone', 'mobile', 'tel', 'fax']):
        return 'PHONE'

    # Address
    if any(k in key_lower for k in ['address', 'street', 'adresse']):
        return 'ADDR'
    if any(k in key_lower for k in ['city', 'stadt']):
        return 'CITY'
    if any(k in key_lower for k in ['zip', 'postal', 'plz']):
        return 'ZIP'
    if any(k in key_lower for k in ['state', 'province']):
        return 'STATE'
    if any(k in key_lower for k in ['country', 'land']):
        return 'COUNTRY'

    # IDs
    if any(k in key_lower for k in ['ssn', 'social security']):
        return 'SSN'
    if any(k in key_lower for k in ['tax', 'ein', 'tin']):
        return 'TAXID'
    if any(k in key_lower for k in ['account', 'acct', 'iban']):
        return 'ACCT'
    if any(k in key_lower for k in ['invoice', 'rechnung']):
        return 'INVNUM'
    if any(k in key_lower for k in ['order', 'bestellung']):
        return 'ORDNUM'
    if any(k in key_lower for k in ['policy', 'member', 'insurance']):
        return 'POLICYID'
    if any(k in key_lower for k in ['patient', 'mrn', 'medical']):
        return 'MRNID'

    # Money
    if any(k in key_lower for k in ['amount', 'total', 'price', 'betrag', 'tax', 'vat']):
        return 'AMOUNT'

    # Other
    if any(k in key_lower for k in ['company', 'organization', 'firma']):
        return 'ORG'
    if any(k in key_lower for k in ['description', 'item']):
        return 'DESC'

    # Default
    return 'DATA'


def generate_tokenized_output(mapping: List[dict]) -> Tuple[List[str], dict]:
    """
    Generate tokenized document and token mapping.

    Args:
        mapping: List of {key, original, anonymized} dicts

    Returns:
        Tuple of (redacted_lines, token_mapping)
    """
    token_counters = {}
    token_map = {}
    redacted_lines = []

    for entry in mapping:
        key = entry['key']
        original = entry['original']

        # Determine token type based on key
        token_type = classify_token_type(key)

        # Increment counter
        if token_type not in token_counters:
            token_counters[token_type] = 0
        token_counters[token_type] += 1

        # Generate token
        token = f"[{token_type}_{token_counters[token_type]:03d}]"

        # Store mapping
        token_map[token] = {
            'key': key,
            'original': original,
            'type': token_type
        }

        # Add to redacted document
        redacted_lines.append(f"{key}: {token}")

    return redacted_lines, token_map
