"""
Simulated Qwen3 Model Output
This module provides simulated OCR output for local development without running the full model.
"""

import time
import random
import logging

logger = logging.getLogger(__name__)

# Simulated HTML output (provided by user)
SIMULATED_HTML_OUTPUT = """<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Arbeitsunfähigkeitsbescheinigung</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
    <style>
        @page {
            size: A4;
            margin: 12mm;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Roboto', sans-serif;
            font-size: 11px;
            line-height: 1.3;
            color: #333;
            background: #f5f5f5;
            padding: 10px;
        }

        html > body {
            max-width: 21cm;
            margin: 0 auto;
            background: white;
            padding: 15mm;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }

        @media print {
            body {
                background: white;
                padding: 0;
                font-size: 10px;
            }

            html > body {
                max-width: 100%;
                box-shadow: none;
                padding: 12mm;
                margin: 0;
            }

            .section {
                page-break-inside: avoid;
                margin: 6px 0;
                padding: 6px;
            }

            .document, .receipt {
                page-break-inside: avoid;
                margin: 8px 0;
                padding: 6px;
                border: 1px solid #ccc;
            }

            .table {
                page-break-inside: avoid;
                margin: 4px 0;
            }

            table {
                page-break-inside: avoid;
                margin: 4px 0;
            }

            td, th {
                padding: 3px 4px;
                font-size: 9px;
            }

            h1 { font-size: 14px; margin: 6px 0; }
            h2 { font-size: 12px; margin: 4px 0; }
            p { margin: 3px 0; }
        }

        h1, h2, h3 {
            font-weight: 500;
            margin: 8px 0;
            color: #2c3e50;
        }

        h1 {
            font-size: 16px;
            text-align: center;
        }

        h2 {
            font-size: 14px;
        }

        h3 {
            font-size: 12px;
        }

        p {
            margin: 4px 0;
        }

        .section {
            margin: 8px 0;
            padding: 8px;
            background: #fafafa;
            border-left: 2px solid #3498db;
        }

        div {
            margin: 4px 0;
        }

        /* Force documents to stack vertically */
        .document, .receipt {
            display: block;
            width: 100%;
            margin: 12px 0;
            padding: 8px;
            border: 1px solid #ddd;
            background: #fafafa;
            page-break-inside: avoid;
        }

        .table {
            display: block;
            width: 100%;
            margin: 8px 0;
            page-break-inside: avoid;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin: 6px 0;
        }

        td, th {
            padding: 4px 6px;
            border: 1px solid #ddd;
            vertical-align: top;
            text-align: left;
            font-size: 10px;
        }

        th {
            background: #f0f0f0;
            font-weight: 500;
        }

        tbody tr:nth-child(even) {
            background: #f9f9f9;
        }

        input[type="checkbox"] {
            margin-right: 8px;
            width: 16px;
            height: 16px;
            cursor: pointer;
            vertical-align: middle;
        }

        label {
            font-weight: 400;
            cursor: pointer;
            display: inline;
        }

        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 2px solid #ddd;
            font-size: 12px;
            color: #666;
        }

        b, strong {
            font-weight: 500;
        }

        br {
            line-height: 1.8;
        }
    </style>
</head>
<body>
<!-- Document type: Receipt -->
<div class="document" data-bbox="38 19 456 960">
  <div class="header">
    <h1>BUTTSTÄDTER VOLLKORNBAECKEREI GMBH</h1>
    <p>GABELSBERGERSTRASSE 2 99628 BUTTSTÄDT</p>
    <p>TELEFON: 036373/40200</p>
    <p>WWW.BUTTSTAEDTER-VOLLKORNBaeckerei.DE</p>
    <p>STEUER-NR.: 151/106/00612</p>
    <p>Quittung 1249830 vom 17.6.2025 10:48</p>
    <p>Vollkornbäckerei Ka1</p>
    <p>1. Kopie</p>
  </div>
  <div class="items">
    <table>
      <tr>
        <td>grüne Heldin</td>
        <td>19% 6,50€</td>
      </tr>
      <tr>
        <td>2 x 7,95€</td>
      </tr>
      <tr>
        <td>Landfrühstück</td>
        <td>19% 15,90€</td>
      </tr>
      <tr>
        <td>Kürbisbrötchen</td>
      </tr>
      <tr>
        <td>Kürbisbrötchen</td>
      </tr>
      <tr>
        <td>Espresso single</td>
        <td>19% 2,50€</td>
      </tr>
      <tr>
        <td>2 x 3,50€</td>
      </tr>
      <tr>
        <td>eisige Elsa - Früchte Waldmeister BIOTEA</td>
        <td>19% 7,00€</td>
      </tr>
    </table>
  </div>
  <div class="totals">
    <table>
      <tr>
        <td>Total</td>
        <td>31,90€</td>
      </tr>
      <tr>
        <td>Umsatz 19% exkl.</td>
        <td>26,81€</td>
      </tr>
      <tr>
        <td>MwSt 19%</td>
        <td>5,09€</td>
      </tr>
      <tr>
        <td>EC KARTE</td>
        <td>31,90€</td>
      </tr>
    </table>
  </div>
  <div class="footer">
    <p>Datum und Zeit: 17.06.2025 10:48:52</p>
    <p>Seq.-Nr.: 1253284 | S/N: 3035480</p>
    <p>Zertifikat-S/N:</p>
    <p>852CD624791380B82B0F6D00BEC071725D4E558C34F07AD99079BC19A0D575C8</p>
    <p>Beginn/Ende: 17.6.2025 10:47 | 17.6.2025 10:49</p>
    <p>Transaktion: 456565 | Signaturzähler: 1033018</p>
    <p>CDU12-xGx/j-Q/RZs-1mAPu-cEyCL-KIc5h-x0+vY-HZ0AI-jAliz-Ivb1h-7ydUr-EWx3Z-7gXRA-mMX/g-QPjQU-oz3VO-wnxCt-UIkR3-klehu-kyK1B-B0urs-NahW9-Cs5EG-AK/Ld-oDfyN-sHW</p>
    <p>10:48 1249830</p>
    <p>Es bediente Sie 20001919</p>
    <p>Vielen Dank für Ihren Einkauf.</p>
    <p>BITTE PRÜFEN SIE IHR WECHSELGELD SOFORT!!</p>
    <p>SPÄTERE REKLAMATIONEN KÖNNEN NICHT ANERKANNT WERDEN.</p>
  </div>
</div>
<div class="document" data-bbox="540 83 964 977">
  <div class="header">
    <h1>BUTTSTÄDTER VOLLKORNBAECKEREI GMBH</h1>
    <p>GABELSBERGERSTRASSE 2 99628 BUTTSTÄDT</p>
    <p>TELEFON: 036373/40200</p>
    <p>WWW.BUTTSTAEDTER-VOLLKORNBaeckerei.DE</p>
    <p>STEUER-NR.: 151/106/00612</p>
    <p>Quittung 341762 vom 17.6.2025 11:20</p>
    <p>Vollkornbäckerei Ka2</p>
    <p>1. Kopie</p>
  </div>
  <div class="items">
    <table>
      <tr>
        <td>Obstschnitte</td>
        <td>19% 3,00€</td>
      </tr>
      <tr>
        <td>Handelecke</td>
        <td>19% 2,49€</td>
      </tr>
      <tr>
        <td>Espresso single</td>
        <td>19% 2,50€</td>
      </tr>
      <tr>
        <td>Aufschlag Hafermilch</td>
        <td>19% 0,50€</td>
      </tr>
      <tr>
        <td>0,2l Filterkaffee ohne</td>
        <td>19% 2,20€</td>
      </tr>
    </table>
  </div>
  <div class="totals">
    <table>
      <tr>
        <td>Total</td>
        <td>10,69€</td>
      </tr>
      <tr>
        <td>Umsatz 19% exkl.</td>
        <td>8,98€</td>
      </tr>
      <tr>
        <td>MwSt 19%</td>
        <td>1,71€</td>
      </tr>
      <tr>
        <td>EC KARTE</td>
        <td>10,69€</td>
      </tr>
    </table>
  </div>
  <div class="footer">
    <p>Datum und Zeit: 17.06.2025 11:20:26</p>
    <p>Seq.-Nr.: 345263 | S/N: 2003573</p>
    <p>Zertifikat-S/N:</p>
    <p>C34C10886AAD1BFEEA649EB78AD9A5E1753CCBF34D4C966A613338CA1BD606D1</p>
    <p>Beginn/Ende: 17.6.2025 11:20 | 17.6.2025 11:20</p>
    <p>Transaktion: 222586 | Signaturzähler: 564520</p>
    <p>F/Bqj-vH4qE-uulpt-ipSz1-dq3eQ-LxKtw-unGdP-pEUP2-fEXR3-v6ZZ4-+GK1S-kH0kc-MVkxM-A9iTH-kM/06-oH7ne-H10TE-xPh3S-FcR4z-+EsOW-BGnG1-Duu11-CV6iB-cq0cV-BDRb9-2ZI</p>
    <p>11:20 341762</p>
    <p>Es bediente Sie 20002200</p>
    <p>Vielen Dank für Ihren Einkauf.</p>
    <p>BITTE PRÜFEN SIE IHR WECHSELGELD SOFORT!!</p>
    <p>SPÄTERE REKLAMATIONEN KÖNNEN NICHT ANERKANNT WERDEN.</p>
  </div>
</div>
</body>
</html>"""


def simulate_qwen3_inference(image_path: str) -> dict:
    """
    Simulate Qwen3 model inference.
    In production, this would load the actual model and process the image.
    For local development, we return simulated HTML output.

    Args:
        image_path: Path to the input image file

    Returns:
        dict: Simulated OCR result with HTML output and metadata
    """
    logger.info(f"[SIMULATION] Processing image: {image_path}")

    # Simulate processing time (1-3 seconds)
    processing_start = time.time()
    time.sleep(random.uniform(1.0, 3.0))
    processing_end = time.time()

    processing_time_ms = int((processing_end - processing_start) * 1000)

    # Extract text content (simplified extraction for word count)
    text_content = """
    BUTTSTÄDTER VOLLKORNBAECKEREI GMBH
    Quittung 1249830 vom 17.6.2025
    grüne Heldin 6,50€
    Landfrühstück 15,90€
    Espresso single 2,50€
    eisige Elsa - Früchte Waldmeister BIOTEA 7,00€
    Total 31,90€

    Quittung 341762 vom 17.6.2025
    Obstschnitte 3,00€
    Handelecke 2,49€
    Espresso single 2,50€
    Total 10,69€
    """

    word_count = len(text_content.split())

    # Simulate confidence score (0.85 - 0.98)
    confidence = round(random.uniform(0.85, 0.98), 4)

    result = {
        'html_output': SIMULATED_HTML_OUTPUT,
        'extracted_text': text_content.strip(),
        'confidence_score': confidence,
        'word_count': word_count,
        'page_count': 2,  # Two receipts in the HTML
        'processing_time_ms': processing_time_ms,
        'model_version': 'Qwen3-VL-3B-simulated',
        'structured_data': {
            'document_type': 'receipt',
            'receipts': [
                {
                    'receipt_number': '1249830',
                    'date': '17.06.2025',
                    'time': '10:48',
                    'total': '31,90€',
                    'merchant': 'BUTTSTÄDTER VOLLKORNBAECKEREI GMBH'
                },
                {
                    'receipt_number': '341762',
                    'date': '17.06.2025',
                    'time': '11:20',
                    'total': '10,69€',
                    'merchant': 'BUTTSTÄDTER VOLLKORNBAECKEREI GMBH'
                }
            ]
        }
    }

    logger.info(f"[SIMULATION] Processing complete. Time: {processing_time_ms}ms, Confidence: {confidence}")

    return result


def get_model_info() -> dict:
    """
    Get information about the simulated model.

    Returns:
        dict: Model information
    """
    return {
        'name': 'Qwen3-VL-3B',
        'version': 'v1.0-simulated',
        'mode': 'simulation',
        'description': 'Simulated Qwen3 output for local development'
    }
