# PDF Conversion Setup

## Overview

The `/api/tasks/:taskId/result` endpoint now converts HTML results to PDF before downloading.

**Workflow**:
1. HTML stored in S3 (original format preserved)
2. On download request:
   - Backend downloads HTML from S3
   - Converts HTML → PDF using Puppeteer
   - Streams PDF to user
3. Access control and audit logging still apply

---

## Installation

### Install Puppeteer

You need to install Puppeteer for HTML→PDF conversion:

```bash
# Fix npm cache permissions first (run with your password)
sudo chown -R $(id -u):$(id -g) ~/.npm

# Install puppeteer
cd backend
npm install puppeteer
```

**Note**: Puppeteer will download Chromium (~170MB) during installation.

---

## Fallback Behavior

If Puppeteer is not installed or PDF conversion fails:
- Endpoint returns HTML file instead
- User gets `.html` download instead of `.pdf`
- Logs indicate PDF conversion failed
- System continues to work (graceful degradation)

---

## Testing

### 1. With Puppeteer Installed
```bash
# Download result
curl -X GET http://localhost:8080/api/tasks/TASK_ID/result \
  -H "x-user-id: USER_ID" \
  -o result.pdf

# Check headers
curl -I http://localhost:8080/api/tasks/TASK_ID/result \
  -H "x-user-id: USER_ID"

# Should show:
# Content-Type: application/pdf
# Content-Disposition: attachment; filename="..."
# X-PDF-Conversion: success
```

### 2. Without Puppeteer (Fallback)
```bash
# Same request returns HTML
curl -X GET http://localhost:8080/api/tasks/TASK_ID/result \
  -H "x-user-id: USER_ID" \
  -o result.html

# Headers show:
# Content-Type: text/html
# X-PDF-Conversion: failed
```

---

## Production Considerations

### Docker Setup

If running in Docker, add Puppeteer dependencies:

**Dockerfile**:
```dockerfile
FROM node:18

# Install Puppeteer dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

CMD ["npm", "start"]
```

### Performance

**PDF conversion adds overhead**:
- ~1-3 seconds per conversion (depends on HTML complexity)
- ~200-300MB RAM per concurrent conversion
- Consider caching PDFs if same file downloaded multiple times

**Optimization options**:
1. **Cache PDFs**: Store generated PDF in S3 alongside HTML
2. **Queue conversions**: Use worker queue for large files
3. **Rate limit**: Prevent abuse of conversion endpoint

---

## Alternative: Cache PDFs

If you want to avoid converting on every download:

### Option 1: Generate PDF in Worker (Recommended)

Modify worker to generate both HTML and PDF:

```python
# worker/task_processor.py
def _save_output(self, task_id, user_id, html_content):
    # Upload HTML
    html_key = self.s3_client.upload_string(html_content, ...)

    # Convert to PDF and upload
    pdf_content = self.convert_html_to_pdf(html_content)
    pdf_key = self.s3_client.upload_bytes(pdf_content, ...)

    return html_key, pdf_key
```

### Option 2: Cache After First Download

Modify backend to cache PDF in S3 after first conversion:

```javascript
// Check if PDF already exists in S3
const pdfKey = task.s3_result_key.replace('.html', '.pdf');
const pdfExists = await s3Service.fileExists(pdfKey);

if (pdfExists) {
  // Stream cached PDF
  const pdfData = await s3Service.streamFileDownload(pdfKey);
  pdfData.stream.pipe(res);
} else {
  // Convert and cache
  const pdfBuffer = await pdfService.htmlToPdf(htmlContent);
  await s3Service.uploadBuffer(pdfBuffer, pdfKey);
  res.send(pdfBuffer);
}
```

---

## Troubleshooting

### Error: "Puppeteer not installed"

**Solution**: Install puppeteer
```bash
cd backend
npm install puppeteer
```

### Error: "Failed to launch browser"

**Cause**: Missing system dependencies (Linux)

**Solution**: Install Chromium dependencies
```bash
# Ubuntu/Debian
sudo apt-get install -y chromium-browser

# Or install all dependencies
npx puppeteer browsers install chrome
```

### Error: Permission denied

**Cause**: npm cache owned by root

**Solution**:
```bash
sudo chown -R $(id -u):$(id -g) ~/.npm
```

### High Memory Usage

**Cause**: Puppeteer launches browser instances

**Solutions**:
1. Limit concurrent conversions
2. Add rate limiting
3. Use worker queue
4. Cache PDFs (see above)

---

## Audit Logging

PDF conversions are logged in `file_access_log`:

```sql
SELECT
  username,
  filename,
  download_duration_ms,
  metadata->'format' as format,
  metadata->'convertedFromHtml' as converted
FROM file_access_log
WHERE access_result = 'allowed'
ORDER BY accessed_at DESC;
```

**Example log entry**:
```json
{
  "username": "john@example.com",
  "filename": "document.pdf",
  "access_result": "allowed",
  "download_duration_ms": 2500,
  "metadata": {
    "format": "pdf",
    "convertedFromHtml": true
  }
}
```

If PDF conversion fails:
```json
{
  "metadata": {
    "pdfConversionFailed": true
  }
}
```

---

## Summary

✅ **Implemented**: HTML→PDF conversion on download
✅ **Preserved**: Original HTML in S3 for future editing
✅ **Graceful**: Falls back to HTML if conversion fails
✅ **Logged**: All downloads audited in database
✅ **Secure**: Access control still enforced

**Next Steps**:
1. Install Puppeteer: `npm install puppeteer`
2. Test download endpoint
3. (Optional) Implement PDF caching for performance
