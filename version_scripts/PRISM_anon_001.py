#!/usr/bin/env python3
"""
PRISM Anonymizer V001 - PII Detection & Anonymization

Based on PRISM V008 KVP extraction with added anonymization layer.
Compliant with HIPAA Safe Harbor (18 identifiers) and GDPR requirements.

## Features:
- Extracts KVPs using Qwen3-VL (inherited from V008)
- Detects PII using pii_config.json taxonomy
- Multiple anonymization strategies: redact, synthetic, generalize, mask
- Audit trail logging for compliance
- Supports HIPAA, GDPR, CCPA frameworks

## Anonymization Strategies:
- redact:     Replace with [REDACTED] marker
- synthetic:  Replace with realistic fake data (Faker)
- generalize: Reduce precision (DOB->Year, ZIP->3-digit)
- mask:       Partial redaction (***-**-1234)

## Usage:
    python PRISM_ANON_V001.py document.pdf                    # Default: redact mode
    python PRISM_ANON_V001.py document.pdf --mode synthetic   # Faker replacement
    python PRISM_ANON_V001.py document.pdf --mode generalize  # K-anonymity style
    python PRISM_ANON_V001.py document.pdf --audit            # Generate audit log
    python PRISM_ANON_V001.py document.pdf --extract-only     # No anonymization

## Output:
    - *_ANON.json:  Anonymized extraction results
    - *_AUDIT.json: Audit trail (what was anonymized, original hashes)

## References:
- HIPAA Safe Harbor: https://www.hhs.gov/hipaa/for-professionals/privacy/special-topics/de-identification
- GDPR Art 4(5): Pseudonymization requirements
- CCPA 1798.140: Personal information definition
"""

import sys
import os
import json
import re
import time
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List, Any, Tuple

# CRITICAL: Set environment variables BEFORE any CUDA/vLLM imports
os.environ['VLLM_WORKER_MULTIPROC_METHOD'] = 'spawn'
os.environ['VLLM_ENABLE_V1_MULTIPROCESSING'] = '0'
os.environ['NCCL_P2P_DISABLE'] = '0'
os.environ['VLLM_TIMEOUT'] = '300'

from pdf2image import convert_from_path
from vllm import LLM, SamplingParams
from transformers import AutoProcessor
from qwen_vl_utils import process_vision_info

# Try to import Faker for synthetic data generation
try:
    from faker import Faker
    FAKER_AVAILABLE = True
    fake = Faker(['en_US', 'de_DE', 'es_ES', 'fr_FR'])  # Multi-locale support
except ImportError:
    FAKER_AVAILABLE = False
    fake = None

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(message)s")
logger = logging.getLogger("prism_anon")

# ============================================================================
# CACHES (Singleton pattern)
# ============================================================================
_LLM_CACHE = None
_PROCESSOR_CACHE = None
_STANDARD_KVPS_CACHE = None
_PII_CONFIG_CACHE = None

# ============================================================================
# PII CONFIGURATION
# ============================================================================

def load_pii_config(config_path: str = None) -> dict:
    """Load PII configuration for anonymization rules."""
    global _PII_CONFIG_CACHE

    if _PII_CONFIG_CACHE is not None:
        return _PII_CONFIG_CACHE

    script_dir = Path(__file__).parent
    if config_path is None:
        config_path = script_dir / "pii_config.json"

    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            _PII_CONFIG_CACHE = json.load(f)
        logger.info(f"✓ Loaded PII config: {len(_PII_CONFIG_CACHE.get('pii_categories', {}))} categories")
        return _PII_CONFIG_CACHE
    except FileNotFoundError:
        logger.warning(f"⚠️  PII config not found: {config_path}")
        logger.warning("⚠️  Using default HIPAA Safe Harbor identifiers")
        # Fallback to hardcoded HIPAA 18
        _PII_CONFIG_CACHE = get_default_pii_config()
        return _PII_CONFIG_CACHE
    except json.JSONDecodeError as e:
        logger.error(f"❌ Error parsing PII config: {e}")
        _PII_CONFIG_CACHE = get_default_pii_config()
        return _PII_CONFIG_CACHE


def get_default_pii_config() -> dict:
    """Fallback PII config with HIPAA Safe Harbor 18 identifiers."""
    return {
        "pii_categories": {
            "direct_identifiers": {
                "risk_level": "critical",
                "action": "redact_or_synthetic",
                "keys": [
                    "Name", "First Name", "Last Name", "Middle Name", "Patient Name",
                    "SSN", "Social Security Number", "EIN", "Tax ID",
                    "Email", "Phone", "Mobile", "Fax",
                    "Patient ID", "Insurance ID", "Member ID", "Account Number",
                    "Driver License", "Passport Number", "Provider NPI"
                ]
            },
            "quasi_identifiers": {
                "risk_level": "high",
                "action": "generalize",
                "keys": [
                    "Date of Birth", "Age", "Gender",
                    "ZIP Code", "City", "Address", "Street",
                    "Occupation", "Employer", "Job Title",
                    "Admission Date", "Discharge Date", "Date of Service"
                ]
            },
            "sensitive_attributes": {
                "risk_level": "medium",
                "action": "flag_for_review",
                "keys": [
                    "Diagnosis", "Diagnosis Code", "Medication Name", "Procedure",
                    "Blood Type", "Allergies", "Chief Complaint",
                    "Claim Amount", "Total Charges", "Amount Due"
                ]
            },
            "financial_identifiers": {
                "risk_level": "high",
                "action": "redact_or_mask",
                "keys": [
                    "Account Number", "Routing Number", "IBAN", "SWIFT Code",
                    "Credit Card Number", "Bank Account", "Check Number",
                    "Policy Number", "Claim Number"
                ]
            }
        }
    }


def build_pii_lookup(pii_config: dict) -> Tuple[Dict[str, dict], List[str]]:
    """
    Build a lookup map: standardized_key -> pii_info.
    Also returns a list of all PII keywords for substring matching.
    """
    pii_lookup = {}
    pii_keywords = []

    for category_name, category_data in pii_config.get('pii_categories', {}).items():
        risk_level = category_data.get('risk_level', 'medium')
        action = category_data.get('action', 'flag_for_review')

        for key in category_data.get('keys', []):
            key_lower = key.lower()
            pii_lookup[key_lower] = {
                'category': category_name,
                'risk_level': risk_level,
                'action': action,
                'original_key': key
            }
            pii_keywords.append((key_lower, {
                'category': category_name,
                'risk_level': risk_level,
                'action': action,
                'original_key': key
            }))

    return pii_lookup, pii_keywords


def find_pii_match(key: str, pii_lookup: Dict[str, dict], pii_keywords: List[tuple]) -> Optional[dict]:
    """
    Find PII match using exact lookup and substring matching.
    Returns pii_info if match found, None otherwise.
    """
    key_lower = key.lower().strip()

    # First try exact match
    if key_lower in pii_lookup:
        return pii_lookup[key_lower]

    # Then try substring matching (for compound keys like "Name, Vorname des Versicherten")
    for keyword, pii_info in pii_keywords:
        # Skip very short keywords to avoid false positives
        if len(keyword) < 3:
            continue
        if keyword in key_lower:
            return pii_info

    return None


# ============================================================================
# ANONYMIZATION STRATEGIES
# ============================================================================

def anonymize_value(value: str, key: str, pii_info: dict, strategy: str = 'redact') -> Tuple[str, dict]:
    """
    Anonymize a single value based on strategy.

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
        'pii_category': pii_info.get('category'),
        'risk_level': pii_info.get('risk_level'),
        'strategy_applied': strategy,
        'timestamp': datetime.now().isoformat()
    }

    if strategy == 'redact':
        anonymized = anonymize_redact(value, key, pii_info)
    elif strategy == 'synthetic':
        anonymized = anonymize_synthetic(value, key, pii_info)
    elif strategy == 'generalize':
        anonymized = anonymize_generalize(value, key, pii_info)
    elif strategy == 'mask':
        anonymized = anonymize_mask(value, key, pii_info)
    else:
        anonymized = f"[REDACTED:{pii_info.get('category', 'PII')}]"

    audit_info['anonymized_length'] = len(str(anonymized))

    return anonymized, audit_info


def anonymize_redact(value: str, key: str, pii_info: dict) -> str:
    """Replace with [REDACTED] marker - most restrictive."""
    category = pii_info.get('category', 'PII')
    return f"[REDACTED:{category.upper()}]"


def anonymize_synthetic(value: str, key: str, pii_info: dict) -> str:
    """Replace with realistic fake data using Faker."""
    if not FAKER_AVAILABLE:
        logger.warning("⚠️  Faker not installed, falling back to redact")
        return anonymize_redact(value, key, pii_info)

    key_lower = key.lower()
    original_key = pii_info.get('original_key', key)

    # Name fields (including German compound keys)
    if any(n in key_lower for n in ['first name', 'given name', 'vorname']):
        return fake.first_name()
    elif any(n in key_lower for n in ['last name', 'surname', 'family name', 'nachname']):
        return fake.last_name()
    elif any(n in key_lower for n in ['name', 'patient name', 'full name', 'versicherten', 'patient']):
        return fake.name()

    # Contact fields
    elif any(n in key_lower for n in ['email', 'e-mail']):
        return fake.email()
    elif any(n in key_lower for n in ['phone', 'mobile', 'telefon', 'tel']):
        return fake.phone_number()
    elif 'fax' in key_lower:
        return fake.phone_number()

    # Address fields
    elif any(n in key_lower for n in ['address', 'street', 'adresse']):
        return fake.street_address()
    elif any(n in key_lower for n in ['city', 'stadt', 'town']):
        return fake.city()
    elif any(n in key_lower for n in ['zip', 'postal', 'plz']):
        return fake.zipcode()
    elif any(n in key_lower for n in ['state', 'province', 'bundesland']):
        return fake.state()
    elif any(n in key_lower for n in ['country', 'land']):
        return fake.country()

    # ID fields
    elif any(n in key_lower for n in ['ssn', 'social security']):
        return fake.ssn()
    elif any(n in key_lower for n in ['ein', 'tax id', 'employer id']):
        return f"{fake.random_int(10, 99)}-{fake.random_int(1000000, 9999999)}"
    elif any(n in key_lower for n in ['account', 'acct']):
        return fake.bban()
    elif any(n in key_lower for n in ['policy', 'member id', 'insurance id', 'versicherten-nr', 'versicherungsnummer']):
        return f"V{fake.random_int(100000000, 999999999)}"
    elif any(n in key_lower for n in ['patient id', 'mrn', 'medical record', 'patienten-id']):
        return f"MRN-{fake.random_int(100000, 999999)}"
    elif any(n in key_lower for n in ['arzt-nr', 'arzt nr', 'provider', 'npi']):
        return f"{fake.random_int(100000000, 999999999)}"

    # Date fields (including German "geb. am" = born on)
    elif any(n in key_lower for n in ['date of birth', 'dob', 'birthdate', 'geburtsdatum', 'geb. am', 'geb am', 'geboren']):
        return fake.date_of_birth(minimum_age=18, maximum_age=90).strftime('%d.%m.%Y')
    elif any(n in key_lower for n in ['date', 'datum']):
        return fake.date_this_year().strftime('%d.%m.%Y')

    # Employment
    elif any(n in key_lower for n in ['employer', 'company', 'firma']):
        return fake.company()
    elif any(n in key_lower for n in ['occupation', 'job', 'title', 'beruf']):
        return fake.job()

    # Default: generate random string of similar length
    else:
        return f"[SYNTHETIC:{len(value)}chars]"


def anonymize_generalize(value: str, key: str, pii_info: dict) -> str:
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
                return "90+"  # HIPAA requires special handling for 90+
        except:
            return "[AGE_RANGE]"

    # Date of birth: keep only year (unless >89, then generalize further)
    elif any(n in key_lower for n in ['date of birth', 'dob', 'birthdate', 'geburtsdatum']):
        try:
            # Try to extract year
            year_match = re.search(r'(19|20)\d{2}', str(value))
            if year_match:
                year = int(year_match.group())
                current_year = datetime.now().year
                age = current_year - year
                if age > 89:
                    return "YEAR_BEFORE_1935"  # HIPAA: ages >89 need special handling
                return str(year)
            return "[YEAR_ONLY]"
        except:
            return "[YEAR_ONLY]"

    # ZIP code: keep first 3 digits (if population >20k)
    elif any(n in key_lower for n in ['zip', 'postal', 'plz']):
        zip_digits = re.sub(r'[^0-9]', '', str(value))
        if len(zip_digits) >= 3:
            return zip_digits[:3] + "XX"
        return "[ZIP_GENERALIZED]"

    # Dates: keep only month and year
    elif any(n in key_lower for n in ['date', 'datum']):
        try:
            # Try various date formats
            for fmt in ['%Y-%m-%d', '%d.%m.%Y', '%m/%d/%Y', '%d/%m/%Y']:
                try:
                    dt = datetime.strptime(str(value), fmt)
                    return dt.strftime('%Y-%m')
                except:
                    pass
            # Fallback: extract year
            year_match = re.search(r'(19|20)\d{2}', str(value))
            if year_match:
                return year_match.group()
            return "[DATE_GENERALIZED]"
        except:
            return "[DATE_GENERALIZED]"

    # Geographic: generalize to region
    elif any(n in key_lower for n in ['city', 'stadt', 'town']):
        return "[CITY_REGION]"
    elif any(n in key_lower for n in ['address', 'street', 'adresse']):
        return "[ADDRESS_REMOVED]"

    # Default: partial redaction
    else:
        if len(str(value)) > 4:
            return str(value)[:2] + "***" + str(value)[-2:]
        return "[GENERALIZED]"


def anonymize_mask(value: str, key: str, pii_info: dict) -> str:
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
    elif any(n in key_lower for n in ['name', 'patient', 'holder']):
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
) -> Tuple[dict, List[dict]]:
    """
    Anonymize ALL extracted values - replace with synthetic equivalents.

    This is NOT PII detection. KVP extraction already grabbed everything.
    We simply replace ALL values with synthetic data, using the key name
    to determine what type of synthetic value to generate.

    Args:
        extracted_data: Output from PRISM KVP extraction
        strategy: 'redact', 'synthetic', 'generalize', 'mask'
        generate_audit: Whether to generate audit trail

    Returns:
        Tuple of (anonymized_data, audit_trail)
    """
    audit_trail = []
    mapping = []  # Before → After mapping for .txt output
    anonymized = json.loads(json.dumps(extracted_data))  # Deep copy

    total_values = 0
    anonymized_count = 0

    # Process ALL fields in ALL categories
    for category, items in anonymized.get('fields', {}).items():
        if not isinstance(items, list):
            continue

        for item in items:
            # Get the key (prefer visible_key, fall back to standardized_key)
            key = item.get('visible_key') or item.get('standardized_key') or ''
            value = item.get('value')

            # Skip empty values
            if not value or str(value).strip() == '':
                continue

            total_values += 1
            original_value = str(value)

            # Generate synthetic replacement based on key name
            synthetic_value = generate_synthetic_value(original_value, key, strategy)

            # Update the value
            item['value'] = synthetic_value
            item['anonymized'] = True

            # Record the mapping (before → after)
            mapping.append({
                'category': category,
                'key': key,
                'original': original_value,
                'synthetic': synthetic_value
            })

            # Audit trail if requested (hashed version)
            if generate_audit:
                audit_trail.append({
                    'category': category,
                    'key': key,
                    'original_hash': hashlib.sha256(original_value.encode()).hexdigest()[:16],
                    'original_length': len(original_value),
                    'strategy': strategy,
                    'timestamp': datetime.now().isoformat()
                })

            anonymized_count += 1

    # Process line items (tables) - anonymize ALL cell values
    line_items = anonymized.get('fields', {}).get('line_items', [])
    for row in line_items:
        for key, value in list(row.items()):
            # Skip metadata fields
            if key in ['confidence', 'anonymized']:
                continue

            if not value or str(value).strip() == '':
                continue

            total_values += 1
            original_value = str(value)

            synthetic_value = generate_synthetic_value(original_value, key, strategy)
            row[key] = synthetic_value

            # Record the mapping
            mapping.append({
                'category': 'line_items',
                'key': key,
                'original': original_value,
                'synthetic': synthetic_value
            })

            if generate_audit:
                audit_trail.append({
                    'category': 'line_items',
                    'key': key,
                    'original_hash': hashlib.sha256(original_value.encode()).hexdigest()[:16],
                    'original_length': len(original_value),
                    'strategy': strategy,
                    'timestamp': datetime.now().isoformat()
                })

            anonymized_count += 1

    # Add metadata
    anonymized['anonymization_metadata'] = {
        'version': 'PRISM_ANON_V002',
        'timestamp': datetime.now().isoformat(),
        'strategy': strategy,
        'total_values_found': total_values,
        'values_anonymized': anonymized_count,
        'audit_trail_generated': generate_audit
    }

    logger.info(f"✓ Anonymization complete: {anonymized_count}/{total_values} values replaced")

    return anonymized, audit_trail, mapping


def generate_synthetic_value(original: str, key: str, strategy: str) -> str:
    """
    Generate synthetic replacement for ANY value based on key name.
    Key name hints at value type (name, date, number, address, etc.)
    """
    if strategy == 'redact':
        return f"[REDACTED:{len(original)}chars]"

    if strategy == 'mask':
        if len(original) > 4:
            return original[0] + '*' * (len(original) - 2) + original[-1]
        return '*' * len(original)

    if strategy == 'generalize':
        # Keep structure, remove specifics
        if re.match(r'^\d+[.,]\d+$', original):
            return '0.00'
        if re.match(r'^\d+$', original):
            return '0'
        return f"[{len(original)}chars]"

    # SYNTHETIC: Generate realistic fake data based on key name
    if not FAKER_AVAILABLE:
        return f"[SYNTHETIC:{len(original)}chars]"

    key_lower = key.lower()

    # === NAMES ===
    if any(k in key_lower for k in ['first name', 'given name', 'vorname', 'prénom', 'nombre']):
        return fake.first_name()
    if any(k in key_lower for k in ['last name', 'surname', 'family name', 'nachname', 'nom', 'apellido']):
        return fake.last_name()
    if any(k in key_lower for k in ['name', 'patient', 'versicherten', 'kunde', 'client', 'customer']):
        # Could be full name or company - check original for hints
        if len(original.split()) >= 2 or any(c in original for c in [',', '&']):
            return fake.name()
        return fake.first_name()

    # === CONTACT ===
    if any(k in key_lower for k in ['email', 'e-mail', 'correo']):
        return fake.email()
    if any(k in key_lower for k in ['phone', 'mobile', 'telefon', 'tel', 'fax', 'teléfono']):
        return fake.phone_number()

    # === ADDRESS ===
    if any(k in key_lower for k in ['street', 'address', 'adresse', 'straße', 'strasse', 'dirección', 'calle']):
        return fake.street_address()
    if any(k in key_lower for k in ['city', 'stadt', 'town', 'ciudad', 'ville', 'ort']):
        return fake.city()
    if any(k in key_lower for k in ['zip', 'postal', 'plz', 'postleitzahl', 'código postal']):
        return fake.zipcode()
    if any(k in key_lower for k in ['state', 'province', 'bundesland', 'provincia', 'région']):
        return fake.state()
    if any(k in key_lower for k in ['country', 'land', 'país', 'pays']):
        return fake.country()

    # === IDs & NUMBERS ===
    if any(k in key_lower for k in ['ssn', 'social security', 'sozialversicherung']):
        return fake.ssn()
    if any(k in key_lower for k in ['ein', 'tax id', 'steuer', 'nif', 'steuernummer']):
        return f"{fake.random_int(10, 99)}-{fake.random_int(1000000, 9999999)}"
    if any(k in key_lower for k in ['account', 'acct', 'konto', 'cuenta', 'iban', 'bban']):
        return fake.iban()
    if any(k in key_lower for k in ['invoice', 'rechnung', 'factura', 'bill', 'receipt']):
        return f"INV-{fake.random_int(100000, 999999)}"
    if any(k in key_lower for k in ['order', 'bestellung', 'pedido', 'commande']):
        return f"ORD-{fake.random_int(100000, 999999)}"
    if any(k in key_lower for k in ['policy', 'member', 'versicherten', 'insurance', 'kranken']):
        return f"POL-{fake.random_int(100000000, 999999999)}"
    if any(k in key_lower for k in ['patient id', 'mrn', 'medical record', 'patienten']):
        return f"MRN-{fake.random_int(100000, 999999)}"
    if any(k in key_lower for k in ['license', 'permit', 'führerschein', 'licencia']):
        return fake.license_plate()

    # === DATES ===
    if any(k in key_lower for k in ['birth', 'dob', 'geboren', 'geburtsdatum', 'geb.', 'nacimiento']):
        return fake.date_of_birth(minimum_age=18, maximum_age=85).strftime('%d.%m.%Y')
    if any(k in key_lower for k in ['date', 'datum', 'fecha', 'jour']):
        return fake.date_this_year().strftime('%d.%m.%Y')

    # === MONEY ===
    if any(k in key_lower for k in ['amount', 'total', 'sum', 'price', 'betrag', 'preis', 'precio', 'netto', 'brutto', 'tax', 'vat', 'mwst']):
        # Try to preserve format (currency symbol, decimal places)
        if '€' in original or 'eur' in original.lower():
            return f"€{fake.random_int(10, 9999)}.{fake.random_int(0, 99):02d}"
        if '$' in original or 'usd' in original.lower():
            return f"${fake.random_int(10, 9999)}.{fake.random_int(0, 99):02d}"
        if re.search(r'\d+[.,]\d{2}', original):
            return f"{fake.random_int(10, 9999)}.{fake.random_int(0, 99):02d}"
        return str(fake.random_int(10, 9999))

    # === QUANTITIES ===
    if any(k in key_lower for k in ['qty', 'quantity', 'menge', 'anzahl', 'cantidad', 'pcs', 'units']):
        return str(fake.random_int(1, 100))

    # === COMPANY/ORG ===
    if any(k in key_lower for k in ['company', 'firm', 'business', 'organization', 'firma', 'empresa', 'supplier', 'vendor', 'lieferant']):
        return fake.company()

    # === JOB/OCCUPATION ===
    if any(k in key_lower for k in ['job', 'occupation', 'title', 'position', 'beruf', 'puesto']):
        return fake.job()

    # === SIGNATURE/STAMP ===
    if any(k in key_lower for k in ['signature', 'unterschrift', 'stamp', 'stempel', 'firma']):
        return f"[SYNTHETIC:{len(original)}chars]"

    # === FALLBACK: Preserve structure ===
    # If it's a number, generate similar number
    if re.match(r'^[\d\s.,/-]+$', original):
        # Numeric - generate similar format
        digits = re.sub(r'[^\d]', '', original)
        if digits:
            return ''.join([str(fake.random_int(0, 9)) for _ in digits])
        return original

    # If it's short text, generate similar length text
    if len(original) < 50:
        return f"[SYNTHETIC:{len(original)}chars]"

    # Long text - just mark as synthetic
    return f"[SYNTHETIC:{len(original)}chars]"


# Token type lookup cache (built from master_kvps.json)
_TOKEN_TYPE_LOOKUP = None

def build_token_type_lookup() -> dict:
    """
    Build a lookup dict: key/alias → token_type using master_kvps.json.
    """
    global _TOKEN_TYPE_LOOKUP
    if _TOKEN_TYPE_LOOKUP is not None:
        return _TOKEN_TYPE_LOOKUP

    # Map canonical keys to token types
    KEY_TO_TOKEN = {
        # Names
        'name': 'NAME', 'full name': 'NAME', 'patient name': 'NAME', 'customer name': 'NAME',
        'client name': 'NAME', 'recipient': 'NAME', 'sender': 'NAME', 'beneficiary': 'NAME',
        'first name': 'FNAME', 'given name': 'FNAME', 'forename': 'FNAME', 'vorname': 'FNAME',
        'last name': 'LNAME', 'surname': 'LNAME', 'family name': 'LNAME', 'nachname': 'LNAME',
        'middle name': 'NAME', 'printed name': 'NAME',
        # Dates
        'date': 'DATE', 'document date': 'DATE', 'transaction date': 'DATE', 'invoice date': 'DATE',
        'billing date': 'DATE', 'statement date': 'DATE', 'issue date': 'DATE', 'datum': 'DATE',
        'date of birth': 'DOB', 'dob': 'DOB', 'birth date': 'DOB', 'birthdate': 'DOB',
        'geburtsdatum': 'DOB', 'geb. am': 'DOB', 'geboren': 'DOB',
        'effective date': 'DATE', 'expiration date': 'DATE', 'due date': 'DATE', 'payment date': 'DATE',
        # Address
        'address': 'ADDR', 'street': 'ADDR', 'street address': 'ADDR', 'mailing address': 'ADDR',
        'adresse': 'ADDR', 'strasse': 'ADDR', 'straße': 'ADDR',
        'city': 'CITY', 'town': 'CITY', 'stadt': 'CITY', 'ort': 'CITY',
        'state': 'STATE', 'province': 'STATE', 'region': 'STATE', 'bundesland': 'STATE',
        'zip code': 'ZIP', 'postal code': 'ZIP', 'postcode': 'ZIP', 'zip': 'ZIP', 'plz': 'ZIP',
        'country': 'COUNTRY', 'nation': 'COUNTRY', 'land': 'COUNTRY',
        # Contact
        'phone': 'PHONE', 'telephone': 'PHONE', 'tel': 'PHONE', 'mobile': 'PHONE', 'cell': 'PHONE',
        'fax': 'PHONE', 'telefon': 'PHONE', 'handy': 'PHONE',
        'email': 'EMAIL', 'e-mail': 'EMAIL', 'correo': 'EMAIL',
        # IDs
        'ssn': 'SSN', 'social security number': 'SSN', 'social security': 'SSN',
        'tax id': 'TAXID', 'tin': 'TAXID', 'ein': 'TAXID', 'employer id': 'TAXID',
        'steuernummer': 'TAXID', 'steuer-id': 'TAXID', 'vat number': 'TAXID', 'ust-id': 'TAXID',
        'account number': 'ACCT', 'account': 'ACCT', 'bank account': 'ACCT', 'iban': 'ACCT',
        'konto': 'ACCT', 'kontonummer': 'ACCT', 'routing number': 'ACCT',
        'invoice number': 'INVNUM', 'invoice no': 'INVNUM', 'invoice #': 'INVNUM',
        'rechnungsnummer': 'INVNUM', 'rechnung nr': 'INVNUM', 'bill number': 'INVNUM',
        'order number': 'ORDNUM', 'order no': 'ORDNUM', 'order #': 'ORDNUM', 'po number': 'ORDNUM',
        'bestellnummer': 'ORDNUM', 'auftragsnummer': 'ORDNUM',
        'policy number': 'POLICYID', 'member id': 'POLICYID', 'insurance id': 'POLICYID',
        'versicherten-nr': 'POLICYID', 'versicherungsnummer': 'POLICYID', 'policennummer': 'POLICYID',
        'patient id': 'MRNID', 'mrn': 'MRNID', 'medical record': 'MRNID', 'chart number': 'MRNID',
        'chart no': 'MRNID', 'patienten-id': 'MRNID',
        'license': 'LICENSE', 'license number': 'LICENSE', 'permit': 'LICENSE', 'führerschein': 'LICENSE',
        'reference number': 'REFNUM', 'ref': 'REFNUM', 'reference': 'REFNUM', 'referenznummer': 'REFNUM',
        'id number': 'ID', 'id': 'ID', 'document number': 'DOCNUM', 'doc no': 'DOCNUM',
        'confirmation number': 'CONFNUM', 'tracking number': 'TRACKNUM',
        # Money
        'amount': 'AMOUNT', 'total': 'AMOUNT', 'subtotal': 'AMOUNT', 'grand total': 'AMOUNT',
        'price': 'AMOUNT', 'unit price': 'AMOUNT', 'net amount': 'AMOUNT', 'gross amount': 'AMOUNT',
        'netto': 'AMOUNT', 'brutto': 'AMOUNT', 'betrag': 'AMOUNT', 'summe': 'AMOUNT',
        'tax': 'AMOUNT', 'vat': 'AMOUNT', 'tax amount': 'AMOUNT', 'mwst': 'AMOUNT', 'ust': 'AMOUNT',
        'balance': 'AMOUNT', 'balance due': 'AMOUNT', 'amount due': 'AMOUNT', 'saldo': 'AMOUNT',
        'payment': 'AMOUNT', 'discount': 'AMOUNT', 'fee': 'AMOUNT', 'charge': 'AMOUNT', 'charges': 'AMOUNT',
        'credit': 'AMOUNT', 'credits': 'AMOUNT', 'debit': 'AMOUNT',
        # Quantities
        'quantity': 'QTY', 'qty': 'QTY', 'count': 'QTY', 'units': 'QTY', 'menge': 'QTY', 'anzahl': 'QTY',
        'page': 'QTY', 'page number': 'QTY', 'seite': 'QTY',
        # Organization
        'company': 'ORG', 'organization': 'ORG', 'business': 'ORG', 'firm': 'ORG', 'firma': 'ORG',
        'employer': 'ORG', 'supplier': 'ORG', 'vendor': 'ORG', 'merchant': 'ORG', 'lieferant': 'ORG',
        # Description
        'description': 'DESC', 'item': 'DESC', 'product': 'DESC', 'service': 'DESC',
        'details': 'DESC', 'notes': 'DESC', 'comments': 'DESC', 'beschreibung': 'DESC',
        'item description': 'DESC', 'product name': 'DESC', 'service description': 'DESC',
        # Signature
        'signature': 'SIG', 'signed by': 'SIG', 'authorized signature': 'SIG', 'unterschrift': 'SIG',
        # Other
        'title': 'TITLE', 'job title': 'TITLE', 'position': 'TITLE', 'beruf': 'TITLE',
        'website': 'URL', 'url': 'URL', 'web': 'URL', 'homepage': 'URL',
    }

    _TOKEN_TYPE_LOOKUP = dict(KEY_TO_TOKEN)

    # Extend with master_kvps.json aliases
    kvps = load_standard_kvps()
    if kvps and 'sectors' in kvps:
        for sector_id, sector_data in kvps['sectors'].items():
            for kvp in sector_data.get('kvps', []):
                canonical = kvp.get('key', '').lower()
                aliases = [a.lower() for a in kvp.get('aliases', [])]

                # If canonical key has a token type, add all its aliases
                if canonical in _TOKEN_TYPE_LOOKUP:
                    token_type = _TOKEN_TYPE_LOOKUP[canonical]
                    for alias in aliases:
                        if alias not in _TOKEN_TYPE_LOOKUP:
                            _TOKEN_TYPE_LOOKUP[alias] = token_type

    logger.info(f"✓ Token type lookup: {len(_TOKEN_TYPE_LOOKUP)} entries")
    return _TOKEN_TYPE_LOOKUP


def classify_token_type(key: str) -> str:
    """
    Classify a key into a token type using master_kvps.json lookup.
    """
    lookup = build_token_type_lookup()
    key_lower = key.lower().strip()

    # Direct match
    if key_lower in lookup:
        return lookup[key_lower]

    # Partial match (key contains a known term)
    for term, token_type in lookup.items():
        if len(term) >= 3 and term in key_lower:
            return token_type

    # Fallback
    return 'DATA'


def looks_like_sensitive_data(text: str) -> bool:
    """
    Check if text looks like actual data rather than a field label.
    Returns True if text appears to be a date, name, number, etc.
    """
    text = text.strip()

    # Common field label words - these are NOT sensitive data
    FIELD_LABEL_WORDS = {
        'date', 'name', 'description', 'item', 'total', 'amount', 'balance',
        'charges', 'credits', 'payment', 'number', 'no', 'id', 'code', 'type',
        'status', 'account', 'address', 'phone', 'email', 'fax', 'city', 'state',
        'zip', 'country', 'transaction', 'patient', 'customer', 'client',
        'invoice', 'order', 'quantity', 'qty', 'price', 'unit', 'tax', 'subtotal',
        'prior', 'previous', 'current', 'new', 'billing', 'chart', 'page', 'enclosed'
    }
    text_lower = text.lower()
    if any(word in text_lower for word in FIELD_LABEL_WORDS):
        return False

    # Date patterns (MM/DD/YYYY, DD.MM.YYYY, YYYY-MM-DD, etc.)
    if re.match(r'^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$', text):
        return True
    if re.match(r'^\d{4}[/.-]\d{1,2}[/.-]\d{1,2}$', text):
        return True

    # Short single-word names (like "Ben", "John", "Maria") - max 12 chars, no spaces
    if re.match(r'^[A-Z][a-z]+$', text) and 2 <= len(text) <= 12:
        return True

    # Two-word names (like "John Smith") - but NOT field labels
    if re.match(r'^[A-Z][a-z]+ [A-Z][a-z]+$', text) and len(text) <= 25:
        return True

    # Phone numbers
    if re.match(r'^[\d\s\-\(\)\.]+$', text) and len(re.sub(r'[^\d]', '', text)) >= 7:
        return True

    # Email
    if '@' in text and '.' in text:
        return True

    # SSN pattern
    if re.match(r'^\d{3}-\d{2}-\d{4}$', text):
        return True

    # Amounts with currency
    if re.match(r'^[\$€£]\s*[\d,]+\.?\d*$', text):
        return True

    return False


def detect_data_type(text: str) -> str:
    """
    Detect what type of data a value is based on its format.
    Used when a key actually contains data.
    """
    text = text.strip()

    # Date patterns
    if re.match(r'^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$', text):
        return 'DATE'
    if re.match(r'^\d{4}[/.-]\d{1,2}[/.-]\d{1,2}$', text):
        return 'DATE'

    # Names
    if re.match(r'^[A-Z][a-z]+$', text) and len(text) <= 15:
        return 'NAME'
    if re.match(r'^[A-Z][a-z]+ [A-Z][a-z]+$', text):
        return 'NAME'

    # Phone
    if re.match(r'^[\d\s\-\(\)\.]+$', text) and len(re.sub(r'[^\d]', '', text)) >= 7:
        return 'PHONE'

    # Email
    if '@' in text and '.' in text:
        return 'EMAIL'

    # SSN
    if re.match(r'^\d{3}-\d{2}-\d{4}$', text):
        return 'SSN'

    # Amount
    if re.match(r'^[\$€£]\s*[\d,]+\.?\d*$', text):
        return 'AMOUNT'

    return 'DATA'


# ============================================================================
# EXTRACTION (inherited from V008)
# ============================================================================

def build_role_and_task_prompt(standard_keys: list = None, use_standard_mode: bool = True) -> str:
    """Build the prompt for KVP extraction (pure extraction, no PII detection)."""
    return """Extract ALL key-value pairs from this document.

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
    {"key": "Customer Name", "value": "John Smith", "confidence": "high"},
    {"key": "Date", "value": "15.03.2025", "confidence": "high"},
    {"key": "Company", "value": "Acme Corp", "confidence": "high"},
    {"key": "Total Amount", "value": "150.00", "confidence": "low"}
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
    """Load standardized KVP list (cached singleton)."""
    global _STANDARD_KVPS_CACHE

    if _STANDARD_KVPS_CACHE is not None:
        return _STANDARD_KVPS_CACHE

    script_dir = Path(__file__).parent

    if kvp_path is None:
        master_path = script_dir / "master_kvps.json"
        standard_path = script_dir / "standard_kvps.json"
        kvp_path = master_path if master_path.exists() else standard_path

    logger.info(f"Loading standardized KVPs from: {kvp_path}")

    try:
        with open(kvp_path, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)

        if 'sectors' in raw_data:
            flattened_keys = []
            for sector_id, sector_data in raw_data['sectors'].items():
                sector_name = sector_data.get('name', sector_id)
                for kvp in sector_data.get('kvps', []):
                    flattened_keys.append({
                        'key': kvp['key'],
                        'aliases': kvp.get('aliases', []),
                        'sector': sector_id,
                        'sector_name': sector_name,
                        'category': 'other',
                        'required': False
                    })

            _STANDARD_KVPS_CACHE = {
                'version': raw_data.get('version', '1.0'),
                'description': raw_data.get('description', ''),
                'keys': flattened_keys,
                'sectors': raw_data['sectors']
            }
            logger.info(f"✓ Loaded {len(flattened_keys)} KVPs from {len(raw_data['sectors'])} sectors")
        else:
            _STANDARD_KVPS_CACHE = raw_data
            logger.info(f"✓ Loaded {len(_STANDARD_KVPS_CACHE['keys'])} standardized keys")

        return _STANDARD_KVPS_CACHE
    except FileNotFoundError:
        logger.warning(f"⚠️  Standard KVP file not found: {kvp_path}")
        return None
    except json.JSONDecodeError as e:
        logger.error(f"❌ Error parsing KVP JSON: {e}")
        return None


def load_model(model_path: str = "/workspace/qwen3_vl_8b_model"):
    """Load Qwen3-VL model (cached singleton)."""
    global _LLM_CACHE, _PROCESSOR_CACHE

    if _LLM_CACHE is not None and _PROCESSOR_CACHE is not None:
        logger.info("Using cached model")
        return _LLM_CACHE, _PROCESSOR_CACHE

    logger.info(f"Loading Qwen3-VL-8B from: {model_path}")

    _PROCESSOR_CACHE = AutoProcessor.from_pretrained(model_path, trust_remote_code=True)

    try:
        _LLM_CACHE = LLM(
            model=model_path,
            limit_mm_per_prompt={"image": 8},
            trust_remote_code=True,
            gpu_memory_utilization=0.75,
            max_model_len=65536,
            tensor_parallel_size=1,
            block_size=32,
            dtype="bfloat16",
            enforce_eager=False,
            max_num_batched_tokens=65536,
            max_num_seqs=1,
            enable_prefix_caching=True,
            enable_chunked_prefill=True,
            disable_log_stats=True,
            max_logprobs=0,
            swap_space=16,
            seed=42
        )
        logger.info("✓ Model loaded successfully")
    except Exception as e:
        logger.warning(f"⚠️  Enhanced settings failed ({e}), falling back")
        _LLM_CACHE = LLM(
            model=model_path,
            limit_mm_per_prompt={"image": 4},
            trust_remote_code=True,
            gpu_memory_utilization=0.75,
            max_model_len=32768,
            tensor_parallel_size=1,
            dtype="bfloat16",
            enforce_eager=False,
            disable_log_stats=True,
            seed=42
        )

    return _LLM_CACHE, _PROCESSOR_CACHE


def build_alias_map(standard_kvps: dict) -> tuple:
    """Build lookup maps from standard_kvps.json."""
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

        for alias in [std_key] + key_def.get('aliases', []):
            alias_to_standard[alias.lower().strip()] = std_key

    return alias_to_standard, standard_to_info


def normalize_extracted_output(raw_output: dict, standard_kvps: dict = None) -> dict:
    """Transform raw extraction output into normalized categorized format."""
    items = raw_output.get('items', [])
    tables = raw_output.get('tables', [])

    normalized = {
        'document_type': 'unknown',
        'extraction_mode': 'prism_anon_v001',
        'languages_detected': [],
        'extraction_reasoning': 'PRISM Anonymizer V001 extraction',
        'fields': {
            'header': [], 'supplier': [], 'customer': [],
            'delivery': [], 'totals': [], 'payment': [],
            'line_items': [], 'other': []
        },
        'sectors_detected': []
    }

    alias_to_standard = {}
    standard_to_info = {}
    sectors_found = set()

    if standard_kvps:
        alias_to_standard, standard_to_info = build_alias_map(standard_kvps)

    for item in items:
        raw_key = item.get('key', '')
        value = item.get('value', '')
        confidence = item.get('confidence', 'medium')

        lookup_key = raw_key.lower().strip()
        std_key = alias_to_standard.get(lookup_key, None)

        key_info = standard_to_info.get(std_key, {}) if std_key else {}
        category = key_info.get('category', 'other')
        sector = key_info.get('sector', None)
        sector_name = key_info.get('sector_name', None)

        if sector and value:
            sectors_found.add((sector, sector_name))

        normalized_item = {
            'visible_key': raw_key,
            'standardized_key': std_key,
            'value': value,
            'confidence': confidence,
            'found': value is not None and value != '',
            'sector': sector,
            'sector_name': sector_name
        }

        # Preserve model's PII detection from Qwen
        if item.get('pii'):
            normalized_item['pii'] = True
            normalized_item['pii_type'] = item.get('pii_type', 'direct')

        normalized['fields'][category].append(normalized_item)

    for table in tables:
        headers = table.get('headers', [])
        rows = table.get('rows', [])

        for row in rows:
            line_item = {}
            row_confidence = row.get('confidence', 'medium')

            for header in headers:
                if header in row:
                    lookup_key = header.lower().strip()
                    std_key = alias_to_standard.get(lookup_key, header)
                    line_item[std_key] = row[header]

            line_item['confidence'] = row_confidence
            normalized['fields']['line_items'].append(line_item)

    normalized['sectors_detected'] = [
        {'sector_id': s[0], 'sector_name': s[1]}
        for s in sorted(sectors_found, key=lambda x: x[0] or '')
    ]

    total_keys_found = sum(
        1 for cat in normalized['fields'].values()
        for item in cat if isinstance(item, dict) and item.get('found', False)
    )

    normalized['extraction_stats'] = {
        'total_keys_found': total_keys_found,
        'line_items_found': len(normalized['fields']['line_items']),
        'sectors_matched': len(sectors_found)
    }

    return normalized


def extract(pdf_path: str, page_number: int = 1, use_standard_schema: bool = True) -> dict:
    """Extract key-value pairs from a specific page of a PDF."""
    logger.info(f"Processing: {pdf_path} (Page {page_number})")

    standard_kvps = load_standard_kvps() if use_standard_schema else None
    llm, processor = load_model()

    logger.info(f"Converting PDF page {page_number} to image (300 DPI)...")
    img = convert_from_path(pdf_path, dpi=300, first_page=page_number, last_page=page_number)[0]
    logger.info(f"Image size: {img.size[0]}×{img.size[1]}px")

    prompt = build_role_and_task_prompt()

    messages = [{"role": "user", "content": [
        {"type": "image", "image": img},
        {"type": "text", "text": prompt}
    ]}]

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

    # Qwen3-VL recommended params for vision-language tasks
    sampling_params = SamplingParams(
        temperature=0.7,
        top_p=0.8,
        top_k=20,
        presence_penalty=1.5,
        max_tokens=20480
    )

    logger.info("Generating key-value extraction...")
    outputs = llm.generate([inputs], sampling_params=sampling_params)
    output = outputs[0].outputs[0].text.strip()

    logger.info(f"Raw output length: {len(output)} chars")

    json_match = re.search(r"\{.*\}", output, re.DOTALL)
    if json_match:
        try:
            result = json.loads(json_match.group(0))

            if 'items' in result or 'tables' in result:
                items_count = len(result.get('items', []))
                tables_count = len(result.get('tables', []))
                logger.info(f"✓ Raw extraction: {items_count} items, {tables_count} tables")
                result = normalize_extracted_output(result, standard_kvps)

            return result
        except json.JSONDecodeError as e:
            logger.error(f"JSON parse error: {e}")
            return {"error": "invalid json", "raw": output}
    else:
        logger.error("No valid JSON found in output")
        return {"error": "no valid json", "raw": output}


def save_audit_log(audit_trail: List[dict], output_path: Path):
    """Save audit trail for compliance."""
    audit_data = {
        'version': 'PRISM_ANON_V001',
        'generated_at': datetime.now().isoformat(),
        'compliance_note': 'This audit log does NOT contain original PII values, only hashes and metadata',
        'total_pii_fields': len(audit_trail),
        'entries': audit_trail
    }

    output_path.write_text(json.dumps(audit_data, indent=2, ensure_ascii=False), encoding='utf-8')
    logger.info(f"✓ Audit log saved: {output_path}")


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("""
PRISM Anonymizer V001 - PII Detection & Anonymization
======================================================

Usage: python PRISM_ANON_V001.py <pdf_path> [options]

Options:
  --mode <strategy>   Anonymization strategy (default: redact)
                      - redact:     Replace with [REDACTED] marker
                      - synthetic:  Replace with Faker-generated data
                      - generalize: Reduce precision (k-anonymity style)
                      - mask:       Partial masking (show last 4 digits)

  --audit             Generate compliance audit log
  --extract-only      Extract without anonymization (for testing)
  --no-schema         Use open-ended extraction
  --benchmark         Enable performance logging

Compliance:
  - HIPAA Safe Harbor (18 identifiers)
  - GDPR Article 4(5) Pseudonymization
  - CCPA 1798.140 Personal Information

Examples:
  python PRISM_ANON_V001.py invoice.pdf                    # Default redact
  python PRISM_ANON_V001.py medical.pdf --mode synthetic   # Faker replacement
  python PRISM_ANON_V001.py form.pdf --mode generalize     # K-anonymity
  python PRISM_ANON_V001.py doc.pdf --audit                # With audit trail
""")
        sys.exit(1)

    pdf = Path(sys.argv[1])

    # Parse arguments
    strategy = 'redact'
    if '--mode' in sys.argv:
        mode_idx = sys.argv.index('--mode')
        if mode_idx + 1 < len(sys.argv):
            strategy = sys.argv[mode_idx + 1]

    generate_audit = '--audit' in sys.argv
    extract_only = '--extract-only' in sys.argv
    use_schema = '--no-schema' not in sys.argv
    benchmark_mode = '--benchmark' in sys.argv

    if not pdf.exists():
        logger.error(f"PDF not found: {pdf}")
        sys.exit(1)

    if strategy == 'synthetic' and not FAKER_AVAILABLE:
        logger.error("❌ Faker not installed. Run: pip install faker")
        logger.info("   Falling back to 'redact' strategy")
        strategy = 'redact'

    logger.info("="*70)
    logger.info("PRISM Anonymizer V001 - PII Detection & Anonymization")
    logger.info("="*70)
    logger.info(f"Strategy: {strategy}")
    logger.info(f"Audit log: {'enabled' if generate_audit else 'disabled'}")
    logger.info(f"Compliance: HIPAA Safe Harbor + GDPR + CCPA")

    # Load PII config
    pii_config = load_pii_config()

    # Get page count
    logger.info("Detecting page count...")
    total_pages = get_pdf_page_count(str(pdf))
    logger.info(f"✓ PDF has {total_pages} page(s)")

    timestamp = datetime.now().strftime("%y%m%d_%H%M%S")
    output_dir = Path("/root/03_OUTPUT")
    output_dir.mkdir(parents=True, exist_ok=True)

    start_time = time.time()
    all_audit_entries = []

    # Process each page
    for page_num in range(1, total_pages + 1):
        logger.info("="*70)
        logger.info(f"Processing page {page_num}/{total_pages}")
        logger.info("="*70)

        # Extract
        extracted_data = extract(str(pdf), page_number=page_num, use_standard_schema=use_schema)

        if 'error' in extracted_data:
            logger.error(f"Extraction failed: {extracted_data.get('error')}")
            continue

        # Anonymize (unless extract-only mode)
        if extract_only:
            anonymized_data = extracted_data
            audit_trail = []
            mapping = []
            logger.info("✓ Extract-only mode - no anonymization applied")
        else:
            anonymized_data, audit_trail, mapping = anonymize_extracted_data(
                extracted_data,
                strategy=strategy,
                generate_audit=generate_audit
            )
            all_audit_entries.extend(audit_trail)

        # Save page output (JSON)
        suffix = '_EXTRACT' if extract_only else '_ANON'
        output_filename = f"{timestamp}_{pdf.stem}_page{page_num:03d}{suffix}.json"
        out = output_dir / output_filename
        out.write_text(json.dumps(anonymized_data, indent=2, ensure_ascii=False), encoding='utf-8')
        logger.info(f"✓ Output saved: {out}")

        # Save redacted document (TXT) - document in reading order with tokenized placeholders
        if mapping and not extract_only:
            redacted_filename = f"{timestamp}_{pdf.stem}_page{page_num:03d}_REDACTED.txt"
            redacted_path = output_dir / redacted_filename

            # Generate tokens and build redacted document
            token_counters = {}
            token_map = []
            redacted_lines = []

            for entry in mapping:
                key = entry['key']
                original = entry['original']

                # Determine token type based on KEY (tells us what kind of value this is)
                token_type = classify_token_type(key)

                # Increment counter for this type
                if token_type not in token_counters:
                    token_counters[token_type] = 0
                token_counters[token_type] += 1

                # Generate token for the VALUE
                value_token = f"[{token_type}_{token_counters[token_type]:03d}]"

                # Check if KEY itself is sensitive (date, name, etc.)
                key_is_sensitive = looks_like_sensitive_data(key)
                if key_is_sensitive:
                    key_type = detect_data_type(key)
                    if key_type not in token_counters:
                        token_counters[key_type] = 0
                    token_counters[key_type] += 1
                    key_token = f"[{key_type}_{token_counters[key_type]:03d}]"

                    # Add KEY to mapping
                    token_map.append({
                        'token': key_token,
                        'type': key_type,
                        'key': '(key)',
                        'original': key
                    })
                    display_key = key_token
                else:
                    display_key = key

                # Add VALUE to mapping
                token_map.append({
                    'token': value_token,
                    'type': token_type,
                    'key': key,
                    'original': original
                })

                # Add to redacted document
                redacted_lines.append(f"{display_key}: {value_token}")

            # Write REDACTED.txt - clean anonymized document (safe for public LLM)
            with open(redacted_path, 'w', encoding='utf-8') as f:
                for line in redacted_lines:
                    f.write(f"{line}\n")

            logger.info(f"✓ Anonymized TXT saved: {redacted_path}")

            # Write MAPPING.json - token legend (internal use only)
            mapping_filename = f"{timestamp}_{pdf.stem}_page{page_num:03d}_MAPPING.json"
            mapping_path = output_dir / mapping_filename
            mapping_data = {
                'source': pdf.name,
                'page': page_num,
                'timestamp': datetime.now().isoformat(),
                'tokens': {t['token']: t['original'] for t in token_map},
                'token_types': dict(token_counters)
            }
            with open(mapping_path, 'w', encoding='utf-8') as f:
                json.dump(mapping_data, f, indent=2, ensure_ascii=False)

            logger.info(f"✓ Token mapping saved: {mapping_path}")

    # Save audit log
    if generate_audit and all_audit_entries:
        audit_path = output_dir / f"{timestamp}_{pdf.stem}_AUDIT.json"
        save_audit_log(all_audit_entries, audit_path)

    total_time = time.time() - start_time
    logger.info("="*70)
    logger.info(f"✓ Processing complete: {total_time:.2f}s ({total_time/total_pages:.2f}s per page)")
    logger.info(f"✓ Total PII fields anonymized: {len(all_audit_entries)}")
    logger.info(f"✓ Output directory: {output_dir}")
    logger.info("="*70)

    # Print summary
    print("\n" + "="*70)
    print("ANONYMIZATION SUMMARY")
    print("="*70)
    print(f"Strategy:        {strategy}")
    print(f"Pages processed: {total_pages}")
    print(f"PII fields found: {len(all_audit_entries)}")
    print(f"Processing time: {total_time:.2f}s")
    print(f"Output:          {output_dir}")
    if generate_audit:
        print(f"Audit log:       {timestamp}_{pdf.stem}_AUDIT.json")
    print("="*70)
