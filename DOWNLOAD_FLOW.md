# Download Result Flow - Google Docs Style

## User Story
User is editing a document → clicks "Download Result" → gets PDF instantly → HTML auto-saved as version

## Flow Diagram

```
User editing document (session active)
         ↓
User clicks "Download Result"
         ↓
Frontend: Get HTML from iframe.contentDocument.body.innerHTML
         ↓
Frontend: Send HTML to backend POST /api/tasks/:taskId/download-result
         ↓
Backend: Convert HTML → PDF (using puppeteer)
         ↓
Backend: Send PDF to user (stream download)
         ↓
Backend: Save HTML to S3 as new version (async, non-blocking)
         ↓
Backend: Call createVersion() to record in database
         ↓
Backend: Increment session versions_created counter
         ↓
Session continues (user can keep editing)
```

## Why This Flow?

### ✅ Pros:
1. **Fast download** - User gets PDF immediately, no S3 round-trip
2. **Atomic** - Download triggers save (ensures downloaded content is archived)
3. **Non-blocking** - S3 upload happens after user gets file
4. **Session continues** - User can download multiple times, keep editing
5. **Audit trail** - Every download creates a version (HIPAA compliance)

### ❌ Alternatives Rejected:

**Option A: Save to S3 first, then download from S3**
- Slower (extra round-trip)
- User waits for S3 upload before getting file
- If S3 fails, user doesn't get file

**Option B: Download from latest version in S3**
- Doesn't include user's current unsaved changes
- User would have to manually save first

## API Endpoint

### POST /api/tasks/:taskId/download-result

**Request:**
```javascript
{
  htmlContent: "<html>...</html>",  // From iframe
  sessionId: "user123_task456_1234567890",
  editReason: "Downloaded by user"
}
```

**Response:**
```javascript
// Streams PDF file directly
Content-Type: application/pdf
Content-Disposition: attachment; filename="document_result.pdf"

// Headers:
X-Version-Number: 5
X-Version-Id: "uuid-here"
X-Download-Triggered-Save: "true"
```

**Backend Logic:**
```javascript
router.post('/:taskId/download-result', async (req, res) => {
  const { taskId } = req.params;
  const { htmlContent, sessionId } = req.body;
  const userId = req.headers['x-user-id'];

  // 1. Convert HTML to PDF
  const pdfBuffer = await pdfService.htmlToPdf(htmlContent);

  // 2. Stream PDF to user immediately
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${task.filename}_result.pdf"`,
  });
  res.send(pdfBuffer);

  // 3. Save HTML to S3 (async, after user gets file)
  const task = await dbService.getTaskById(taskId);
  const nextVersion = await dbService.getNextVersionNumber(taskId);
  const s3Key = `results/${userId}/${task.file_id}/v${nextVersion}.html`;

  await s3Service.uploadFile(htmlContent, s3Key, 'text/html');

  // 4. Create version record
  const version = await dbService.createVersion({
    taskId,
    fileId: task.file_id,
    userId,
    s3Key,
    characterCount: htmlContent.length,
    wordCount: htmlContent.split(/\s+/).length,
    editReason: 'Downloaded by user',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    sessionId
  });

  // 5. Increment session counter
  await dbService.incrementSessionVersions(sessionId);

  console.log(`📥 Download triggered version save: v${nextVersion}`);
});
```

## Frontend Implementation

```javascript
async function downloadResult() {
  const iframe = document.querySelector('#previewIframe');
  const htmlContent = iframe.contentDocument.body.innerHTML;

  // Show loading indicator
  showDownloadStatus('preparing');

  try {
    const response = await fetch(`${API_URL}/api/tasks/${currentTask.id}/download-result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': USER_ID
      },
      body: JSON.stringify({
        htmlContent,
        sessionId: currentSessionId,
        editReason: 'Downloaded by user'
      })
    });

    if (!response.ok) throw new Error('Download failed');

    // Download PDF
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentTask.filename}_result.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    // Show success
    showDownloadStatus('success');

    // Also show that a version was created
    const versionNumber = response.headers.get('X-Version-Number');
    alert(`✅ Downloaded! Auto-saved as version ${versionNumber}`);

  } catch (error) {
    console.error('Download failed:', error);
    showDownloadStatus('error');
    alert('Download failed. Please try again.');
  }
}
```

## Session Tracking

### Download does NOT end session:
- User might want to keep editing after downloading
- User might download multiple times (iterative edits)
- Session ends only when:
  - User closes tab (`beforeunload`)
  - User navigates away
  - User logs out
  - Idle timeout (5+ minutes)

### Version Counter:
```javascript
// Session starts
{
  session_id: "user123_task456_1234567890",
  versions_created: 0,
  started_at: "2025-10-21T10:00:00Z",
  ended_at: null
}

// User auto-saves 5 times
versions_created: 5

// User downloads
versions_created: 6  // Download triggers version save

// User keeps editing, auto-saves 3 more times
versions_created: 9

// User closes tab → session ends
{
  ended_at: "2025-10-21T10:15:00Z",
  outcome: "completed",
  versions_created: 9
}
```

## HIPAA Compliance

✅ **What we track:**
- Every download creates a version with full audit trail
- WHO: `edited_by`, `user_id`
- WHAT: `s3_key` (full HTML content), `version_number`
- WHEN: `edited_at`, `created_at`
- WHERE: `ip_address`, `user_agent`
- WHY: `edit_reason = "Downloaded by user"`

✅ **Session tracking:**
- Download counts as a version in session
- Total downloads tracked in `versions_created`
- Distinct from auto-saves (different edit_reason)

## Testing Checklist

- [ ] User editing → clicks download → gets PDF instantly
- [ ] Downloaded PDF contains current edits (not stale version)
- [ ] New version created in database after download
- [ ] Session `versions_created` incremented
- [ ] S3 contains HTML content at correct key
- [ ] User can continue editing after download (session doesn't end)
- [ ] Multiple downloads create multiple versions
- [ ] Version history shows download versions with reason "Downloaded by user"
- [ ] Session ends properly when user closes tab (not on download)
