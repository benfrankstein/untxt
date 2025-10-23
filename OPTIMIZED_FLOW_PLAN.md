# Optimized Google Docs Flow - RDS + S3 Hybrid Storage

## Key Change: Don't Upload to S3 Every 3 Seconds!

### Storage Strategy
- **During editing (active session):** Store HTML content in PostgreSQL (fast, 3-8ms)
- **On session end:** Upload latest version to S3 (durable backup)
- **On download:** Upload that specific version to S3 (user requested it)

---

## 1. DATABASE SCHEMA UPDATE

### Add html_content column to store actual HTML
```sql
-- Migration: Add html_content column for fast storage during editing
ALTER TABLE document_versions
ADD COLUMN html_content TEXT;

COMMENT ON COLUMN document_versions.html_content IS
'HTML content stored in database for fast access during editing.
Uploaded to S3 on session end for durable backup.
NULL if content only exists in S3 (old versions archived).';
```

### Storage Rules
```sql
-- Active versions (recent): html_content NOT NULL, s3_key NULL
-- Archived versions (old): html_content NULL, s3_key NOT NULL
-- Downloaded versions: html_content NOT NULL, s3_key NOT NULL (in both!)
```

---

## 2. AUTO-SAVE FLOW (Every 3 seconds) - DATABASE ONLY

### What Happens
1. Frontend detects content change (debounced 3s)
2. Send HTML to backend
3. Backend stores in **PostgreSQL only** (no S3!)
4. Fast response (3-8ms)
5. Show "Saved" indicator

### Frontend Code (Same as before)
```javascript
async function autoSaveVersion() {
  const iframe = document.querySelector('#previewIframe');
  const htmlContent = iframe.contentDocument.body.innerHTML;

  // Skip if no changes
  if (htmlContent === lastSavedContent) return;

  showSaveStatus('saving');

  try {
    const response = await fetch(`${API_URL}/api/versions/${currentTask.id}/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': USER_ID
      },
      body: JSON.stringify({
        htmlContent,
        sessionId: currentSessionId,
        editReason: 'Auto-save'
      })
    });

    if (response.ok) {
      lastSavedContent = htmlContent;
      showSaveStatus('saved');
    }
  } catch (error) {
    console.error('Auto-save failed:', error);
    showSaveStatus('error');
  }
}
```

### Backend Route: POST /api/versions/:taskId/save
```javascript
router.post('/:taskId/save', async (req, res) => {
  const { taskId } = req.params;
  const { htmlContent, sessionId, editReason } = req.body;
  const userId = req.headers['x-user-id'];

  // Validate
  if (!htmlContent || !sessionId) {
    return res.status(400).json({
      success: false,
      error: 'htmlContent and sessionId required'
    });
  }

  // Get task info
  const task = await dbService.getTaskById(taskId);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  // Calculate metrics
  const characterCount = htmlContent.length;
  const wordCount = htmlContent.split(/\s+/).filter(w => w.length > 0).length;

  // Create version in DATABASE ONLY (no S3 upload!)
  const version = await dbService.createVersion({
    taskId,
    fileId: task.file_id,
    userId,
    htmlContent,              // ← Store in database
    s3Key: null,               // ← No S3 upload during editing
    characterCount,
    wordCount,
    editReason: editReason || 'Auto-save',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    sessionId
  });

  // Increment session counter
  await dbService.incrementSessionVersions(sessionId);

  res.json({
    success: true,
    version: {
      id: version.id,
      version_number: version.version_number,
      created_at: version.created_at
    }
  });

  console.log(`💾 Auto-save v${version.version_number} → Database only (3ms)`);
});
```

### Database Service: createVersion (Updated)
```javascript
// /backend/src/services/db.service.js

async createVersion(versionData) {
  const {
    taskId, fileId, userId,
    htmlContent,        // NEW: HTML content for database storage
    s3Key,             // NULL during auto-save, set on session end/download
    characterCount, wordCount,
    editReason = 'Auto-save',
    ipAddress, userAgent, sessionId
  } = versionData;

  const query = `
    SELECT * FROM create_new_version(
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
    );
  `;

  const result = await this.pool.query(query, [
    taskId,
    fileId,
    userId,
    htmlContent,     // ← Store in database
    s3Key,           // ← NULL for auto-saves
    characterCount,
    wordCount,
    editReason,
    ipAddress,
    userAgent,
    sessionId
  ]);

  return result.rows[0];
}
```

### Database Function: create_new_version (Updated)
```sql
-- Update migration 011 to accept html_content parameter

CREATE OR REPLACE FUNCTION create_new_version(
  p_task_id UUID,
  p_file_id UUID,
  p_user_id UUID,
  p_html_content TEXT,          -- NEW: HTML content
  p_s3_key TEXT,                 -- NULL during editing
  p_character_count INTEGER,
  p_word_count INTEGER,
  p_edit_reason TEXT DEFAULT 'Auto-save',
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_session_id TEXT DEFAULT NULL
)
RETURNS document_versions AS $$
DECLARE
  v_next_version INTEGER;
  v_new_version document_versions;
BEGIN
  -- Get next version number
  SELECT COALESCE(MAX(version_number), -1) + 1 INTO v_next_version
  FROM document_versions
  WHERE task_id = p_task_id;

  -- Create new version
  INSERT INTO document_versions (
    task_id,
    file_id,
    version_number,
    html_content,       -- Store HTML in database
    s3_key,             -- NULL during editing
    character_count,
    word_count,
    edited_by,
    edited_at,
    edit_reason,
    ip_address,
    user_agent,
    is_draft,
    is_latest,
    is_original,
    draft_session_id
  ) VALUES (
    p_task_id,
    p_file_id,
    v_next_version,
    p_html_content,     -- ← Store here
    p_s3_key,           -- ← NULL for auto-saves
    p_character_count,
    p_word_count,
    p_user_id,
    CURRENT_TIMESTAMP,
    p_edit_reason,
    p_ip_address,
    p_user_agent,
    FALSE,
    TRUE,
    FALSE,
    p_session_id
  )
  RETURNING * INTO v_new_version;

  -- Mark previous versions as not latest
  UPDATE document_versions
  SET is_latest = FALSE
  WHERE task_id = p_task_id
    AND id != v_new_version.id
    AND is_latest = TRUE;

  RETURN v_new_version;
END;
$$ LANGUAGE plpgsql;
```

### What Gets Saved (Auto-save)
**Database:**
```sql
-- document_versions table
version_number: 5
html_content: '<html>...5KB of HTML...</html>'  ← Stored in PostgreSQL
s3_key: NULL                                     ← No S3 upload
character_count: 5234
word_count: 891
edit_reason: 'Auto-save'
edited_at: '2025-10-21T10:05:23Z'
```

**S3:**
```
Nothing! (No upload during auto-save)
```

**Performance:**
```
Auto-save response time: 3-8ms (just database write)
vs OLD approach: 80-150ms (S3 upload)
= 20x faster! 🚀
```

---

## 3. DOWNLOAD RESULT FLOW - SAVES TO S3

### What Happens
1. User clicks "Download Result"
2. Frontend sends HTML to backend
3. Backend converts HTML → PDF
4. Backend streams PDF to user
5. **Backend uploads HTML to S3** (user requested it, archive it!)
6. Backend stores version in database with **both html_content AND s3_key**

### Backend Route: POST /api/tasks/:taskId/download-result
```javascript
router.post('/:taskId/download-result', async (req, res) => {
  const { taskId } = req.params;
  const { htmlContent, sessionId } = req.body;
  const userId = req.headers['x-user-id'];

  // Get task info
  const task = await dbService.getTaskById(taskId);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  // Convert HTML to PDF
  const pdfBuffer = await pdfService.htmlToPdf(htmlContent, {
    format: 'A4',
    printBackground: true
  });

  // Get next version number
  const nextVersion = await dbService.getNextVersionNumber(taskId);

  // Upload HTML to S3 (user is downloading, so archive it!)
  const s3Key = `results/${userId}/${task.file_id}/v${nextVersion}.html`;
  await s3Service.uploadFile(
    Buffer.from(htmlContent, 'utf-8'),
    s3Key,
    'text/html',
    {
      'user-id': userId,
      'task-id': taskId,
      'version': nextVersion.toString(),
      'download-triggered': 'true',
      'saved-at': new Date().toISOString()
    }
  );

  // Stream PDF to user
  const baseFilename = task.filename.replace(/\.[^/.]+$/, '');
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': pdfBuffer.length,
    'Content-Disposition': `attachment; filename="${baseFilename}_result.pdf"`,
    'X-Version-Number': nextVersion,
    'X-Saved-To-S3': 'true'
  });
  res.end(pdfBuffer, 'binary');

  // Create version with BOTH html_content AND s3_key
  const characterCount = htmlContent.length;
  const wordCount = htmlContent.split(/\s+/).filter(w => w.length > 0).length;

  await dbService.createVersion({
    taskId,
    fileId: task.file_id,
    userId,
    htmlContent,           // Store in database
    s3Key,                 // AND in S3 (downloaded version = important!)
    characterCount,
    wordCount,
    editReason: 'Downloaded by user',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    sessionId
  });

  await dbService.incrementSessionVersions(sessionId);

  console.log(`📥 Download v${nextVersion} → Database + S3 (both!)`);
});
```

### What Gets Saved (Download)
**Database:**
```sql
-- document_versions table
version_number: 6
html_content: '<html>...5KB of HTML...</html>'  ← Stored in PostgreSQL
s3_key: 'results/user123/file456/v6.html'      ← ALSO in S3
character_count: 5678
word_count: 934
edit_reason: 'Downloaded by user'
```

**S3:**
```
Bucket: untxt-results
Key: results/user123/file456/v6.html
Content: <html>...downloaded content...</html>
```

**Why both?**
- Database: Fast access for next edit
- S3: Durable backup of downloaded version

---

## 4. SESSION END FLOW - UPLOADS LATEST TO S3

### What Happens
1. User closes tab, navigates away, logs out, etc.
2. Frontend calls `endEditSession()`
3. Backend gets latest version from database
4. Backend uploads HTML to S3 (durable backup)
5. Backend updates session end time

### Frontend Code
```javascript
function endEditSession() {
  if (!currentSessionId) return;

  // Use sendBeacon for reliable delivery
  const data = JSON.stringify({ sessionId: currentSessionId });
  navigator.sendBeacon(
    `${API_URL}/api/sessions/${currentTask.id}/end`,
    data
  );

  currentSessionId = null;
}

// Attach to all session end events
window.addEventListener('beforeunload', endEditSession);
window.addEventListener('pagehide', endEditSession);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    endEditSession();
  }
});
```

### Backend Route: POST /api/sessions/:taskId/end
```javascript
router.post('/sessions/:taskId/end', async (req, res) => {
  const { sessionId, outcome } = req.body;
  const { taskId } = req.params;
  const userId = req.headers['x-user-id'];

  try {
    // 1. Get latest version for this session (from database)
    const latestVersion = await dbService.getLatestVersionForSession(sessionId);

    if (latestVersion && latestVersion.html_content && !latestVersion.s3_key) {
      // 2. Latest version is in database but not S3 → upload it!
      const task = await dbService.getTaskById(taskId);
      const s3Key = `results/${userId}/${task.file_id}/v${latestVersion.version_number}.html`;

      await s3Service.uploadFile(
        Buffer.from(latestVersion.html_content, 'utf-8'),
        s3Key,
        'text/html',
        {
          'user-id': userId,
          'task-id': taskId,
          'version': latestVersion.version_number.toString(),
          'session-end-backup': 'true',
          'archived-at': new Date().toISOString()
        }
      );

      // 3. Update version record with s3_key
      await dbService.updateVersionS3Key(latestVersion.id, s3Key);

      console.log(`☁️ Session end: Uploaded v${latestVersion.version_number} to S3`);
    }

    // 4. Close session
    await dbService.closeEditSession({
      sessionId,
      outcome: outcome || 'completed'
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});
```

### Database Service: New Helper Functions
```javascript
// Get latest version for a session
async getLatestVersionForSession(sessionId) {
  const query = `
    SELECT * FROM document_versions
    WHERE draft_session_id = $1
    ORDER BY version_number DESC
    LIMIT 1;
  `;
  const result = await this.pool.query(query, [sessionId]);
  return result.rows[0];
}

// Update version with S3 key after upload
async updateVersionS3Key(versionId, s3Key) {
  const query = `
    UPDATE document_versions
    SET s3_key = $1
    WHERE id = $2
    RETURNING *;
  `;
  const result = await this.pool.query(query, [s3Key, versionId]);
  return result.rows[0];
}
```

### What Gets Updated (Session End)
**Before:**
```sql
-- Latest version in database only
version_number: 8
html_content: '<html>...</html>'
s3_key: NULL
```

**After:**
```sql
-- Latest version now in both database and S3
version_number: 8
html_content: '<html>...</html>'
s3_key: 'results/user123/file456/v8.html'
```

**Session record:**
```sql
-- document_edit_sessions
ended_at: '2025-10-21T10:15:00Z'
outcome: 'completed'
versions_created: 8
```

---

## 5. VERSION LIFECYCLE SUMMARY

### Version Storage States

| Version Type | html_content | s3_key | When |
|-------------|--------------|--------|------|
| **Active (editing)** | ✅ NOT NULL | ❌ NULL | Auto-save during session |
| **Downloaded** | ✅ NOT NULL | ✅ NOT NULL | User clicked download |
| **Archived (session end)** | ✅ NOT NULL | ✅ NOT NULL | Session ended |
| **Old (cleaned up)** | ❌ NULL | ✅ NOT NULL | Database cleanup ran |

### Example Timeline
```
Session starts
├─ v1: Auto-save → Database only (html_content ✓, s3_key ✗)
├─ v2: Auto-save → Database only (html_content ✓, s3_key ✗)
├─ v3: Auto-save → Database only (html_content ✓, s3_key ✗)
├─ v4: Download → Database + S3 (html_content ✓, s3_key ✓)
├─ v5: Auto-save → Database only (html_content ✓, s3_key ✗)
├─ v6: Auto-save → Database only (html_content ✓, s3_key ✗)
└─ Session ends → v6 uploaded to S3 (html_content ✓, s3_key ✓)

Result:
- v1, v2, v3: Database only (fast auto-saves)
- v4: Database + S3 (user downloaded it)
- v5: Database only (auto-save after download)
- v6: Database + S3 (latest version backed up on session end)
```

---

## 6. S3 UPLOAD SUMMARY

### When HTML is uploaded to S3:

| Event | Upload to S3? | Why |
|-------|--------------|-----|
| Auto-save (every 3s) | ❌ NO | Too slow (80-150ms), store in database |
| User downloads result | ✅ YES | User requested it, archive it |
| Session ends | ✅ YES | Backup latest version to durable storage |
| Version 0 (OCR complete) | ✅ YES | Worker uploads original result |

### S3 Structure (Sparse, not every version!)
```
s3://untxt-results/
├── results/
│   ├── {userId}/
│   │   ├── {fileId}/
│   │   │   ├── v0.html          ← Original OCR (always in S3)
│   │   │   ├── v4.html          ← Downloaded by user (in S3)
│   │   │   └── v8.html          ← Latest when session ended (in S3)
│   │   │
│   │   │   (v1, v2, v3, v5, v6, v7 = database only, not in S3)
```

---

## 7. LOADING DOCUMENT (GET LATEST VERSION)

### Frontend: Load Document
```javascript
async function showDocumentContent(task) {
  currentTask = task;

  // Get latest version
  const response = await fetch(`${API_URL}/api/versions/${task.id}/latest`, {
    headers: { 'x-user-id': USER_ID }
  });

  const htmlContent = await response.text();

  // Load into iframe
  const iframe = document.querySelector('#previewIframe');
  iframe.onload = () => {
    makeIframeEditable();
  };
  iframe.srcdoc = htmlContent;

  // Start session
  startEditSession();
}
```

### Backend Route: GET /api/versions/:taskId/latest
```javascript
router.get('/:taskId/latest', async (req, res) => {
  const { taskId } = req.params;
  const userId = req.headers['x-user-id'];

  // Get latest version from database
  const version = await dbService.getLatestVersion(taskId);

  if (!version) {
    return res.status(404).json({ error: 'No version found' });
  }

  let htmlContent;

  // Check where content is stored
  if (version.html_content) {
    // Content in database (fast!)
    htmlContent = version.html_content;
    console.log(`📖 Loaded v${version.version_number} from Database (3ms)`);
  } else if (version.s3_key) {
    // Content in S3 only (older version)
    const fileData = await s3Service.streamFileDownload(version.s3_key);
    const chunks = [];
    for await (const chunk of fileData.stream) {
      chunks.push(chunk);
    }
    htmlContent = Buffer.concat(chunks).toString('utf-8');
    console.log(`📖 Loaded v${version.version_number} from S3 (80ms)`);
  } else {
    return res.status(404).json({ error: 'Content not found' });
  }

  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'X-Version-Number': version.version_number,
    'X-Content-Source': version.html_content ? 'database' : 's3',
    'Cache-Control': 'no-cache'
  });
  res.send(htmlContent);
});
```

### Database Service: getLatestVersion
```javascript
async getLatestVersion(taskId) {
  const query = `
    SELECT * FROM document_versions
    WHERE task_id = $1 AND is_latest = TRUE
    ORDER BY version_number DESC
    LIMIT 1;
  `;
  const result = await this.pool.query(query, [taskId]);
  return result.rows[0];
}
```

---

## 8. DATABASE CLEANUP (OPTIONAL)

### Archive Old Versions to S3 Only (Free up database space)
```javascript
// Run nightly: Move html_content to S3, clear from database for old versions

async function archiveOldVersions() {
  // Get versions older than 30 days that are in database but not S3
  const query = `
    SELECT * FROM document_versions
    WHERE html_content IS NOT NULL
      AND s3_key IS NULL
      AND created_at < NOW() - INTERVAL '30 days'
      AND version_number < (
        SELECT MAX(version_number) - 10
        FROM document_versions dv2
        WHERE dv2.task_id = document_versions.task_id
      );
  `;

  const versions = await dbService.pool.query(query);

  for (const version of versions.rows) {
    // Upload to S3
    const s3Key = `results/${version.user_id}/${version.file_id}/v${version.version_number}.html`;
    await s3Service.uploadFile(
      Buffer.from(version.html_content, 'utf-8'),
      s3Key,
      'text/html'
    );

    // Update database: set s3_key, clear html_content
    await dbService.pool.query(
      `UPDATE document_versions
       SET s3_key = $1, html_content = NULL
       WHERE id = $2`,
      [s3Key, version.id]
    );

    console.log(`📦 Archived v${version.version_number} to S3, cleared from database`);
  }
}
```

---

## 9. PERFORMANCE COMPARISON

### Auto-save (every 3s)
```
OLD approach (upload to S3):
- 80-150ms per save
- 1000 auto-saves = 80-150 seconds of latency
- User sees "Saving..." for noticeable time

NEW approach (database only):
- 3-8ms per save
- 1000 auto-saves = 3-8 seconds of latency
- User sees instant "Saved" ⚡
- 20x faster!
```

### Session end (upload latest to S3)
```
- Happens once per session
- ~80ms upload time
- User already closed tab (doesn't wait)
- Uses sendBeacon (reliable)
```

### Download (upload to S3)
```
- User gets PDF instantly (convert from HTML in memory)
- S3 upload happens after user gets file
- ~80ms extra (user doesn't notice)
```

---

## 10. COST COMPARISON

### OLD: S3 Upload on Every Auto-save
```
Assumptions:
- 100 users/day
- 10 documents/user
- 20 auto-saves/document
= 20,000 S3 PUT requests/day

Cost:
- PUT requests: $0.005 per 1,000 = $0.10/day = $3/month
- Data transfer: Negligible
```

### NEW: Database During Editing, S3 on Session End
```
Assumptions:
- 100 users/day
- 10 documents/user
- 1 session end/document
- 1 download/document (50% of docs)
= 1,500 S3 PUT requests/day

Cost:
- PUT requests: $0.005 per 1,000 = $0.008/day = $0.24/month
- Database storage: $0.115/GB-month
- Average doc: 5KB → 1000 docs = 5MB = $0.0006/month

Total savings: $3/month → $0.25/month = 92% cheaper!
```

---

## Summary

### ✅ What Changed

| Action | OLD | NEW |
|--------|-----|-----|
| Auto-save (3s) | → S3 (80-150ms) | → Database (3-8ms) ⚡ |
| Download | → S3 then download | → PDF instant, then S3 📥 |
| Session end | Nothing | → Upload latest to S3 ☁️ |
| Loading doc | From S3 | From Database (fast!) 🚀 |

### ✅ Benefits
- **20x faster auto-save** (3ms vs 80ms)
- **92% cheaper** ($0.25/month vs $3/month)
- **Same durability** (S3 backup on session end)
- **Same audit trail** (all versions in database)

### ✅ S3 Uploads Only When Needed
1. User downloads result → Upload that version
2. Session ends → Upload latest version
3. OCR completes → Upload version 0 (worker does this)

### ✅ Database Stores Everything
- All versions with full audit trail
- Recent versions have html_content for fast access
- Old versions can be cleared (keep s3_key only)
