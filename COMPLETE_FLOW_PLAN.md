# Complete Google Docs Flow Plan

## Overview
Every save creates a version. No drafts. Content always editable. Session-based audit logging.

---

## 1. SESSION LIFECYCLE

### Session Start (User Opens Document)
**Trigger:** User clicks on task in dashboard → document loads

**Frontend Actions:**
```javascript
// Generate session ID
currentSessionId = `${USER_ID}_${taskId}_${Date.now()}`;

// Call backend to start session
POST /api/sessions/:taskId/start
Body: { sessionId }
```

**Backend Actions:**
```javascript
// Create session record
INSERT INTO document_edit_sessions (
  task_id,
  user_id,
  username,
  session_id,
  started_at,
  versions_created,
  ip_address,
  user_agent
) VALUES (...);
```

**Database State:**
```sql
-- document_edit_sessions table
session_id: "user123_task456_1698765432000"
started_at: "2025-10-21T10:00:00Z"
ended_at: NULL
versions_created: 0
outcome: NULL
```

---

### Session Active (User Editing)
**What happens:**
- Content is always editable (no "Edit" button needed)
- Auto-save every 3 seconds
- Each auto-save creates a new version
- Session `versions_created` counter increments

**Auto-save triggers:**
- User types (debounced 3s)
- User pastes content
- User deletes content
- Any content modification

---

### Session End
**Triggers:**

1. **Tab/Window Close** (`beforeunload` event)
   ```javascript
   window.addEventListener('beforeunload', endEditSession);
   ```

2. **Navigate to Dashboard** (user clicks "Back to Dashboard")
   ```javascript
   function goToDashboard() {
     endEditSession();
     window.location.href = '/dashboard';
   }
   ```

3. **User Logs Out**
   ```javascript
   function logout() {
     endEditSession();
     // Then logout...
   }
   ```

4. **Tab Hidden** (user switches tabs - mobile behavior)
   ```javascript
   document.addEventListener('visibilitychange', () => {
     if (document.visibilityState === 'hidden') {
       endEditSession();
     }
   });
   ```

5. **Idle Timeout** (optional - 5+ minutes no activity)
   ```javascript
   let idleTimer;
   function resetIdleTimer() {
     clearTimeout(idleTimer);
     idleTimer = setTimeout(() => {
       endEditSession();
       alert('Session ended due to inactivity');
     }, 5 * 60 * 1000); // 5 minutes
   }
   ```

**Frontend Action:**
```javascript
function endEditSession() {
  if (!currentSessionId) return;

  // Use sendBeacon for reliable delivery even if page is closing
  const data = JSON.stringify({ sessionId: currentSessionId });
  navigator.sendBeacon(
    `${API_URL}/api/sessions/${currentTask.id}/end`,
    data
  );

  currentSessionId = null;
}
```

**Backend Action:**
```javascript
// Update session record
UPDATE document_edit_sessions
SET
  ended_at = CURRENT_TIMESTAMP,
  outcome = 'completed'
WHERE session_id = $1;
```

**Database State After End:**
```sql
-- document_edit_sessions table
session_id: "user123_task456_1698765432000"
started_at: "2025-10-21T10:00:00Z"
ended_at: "2025-10-21T10:15:00Z"
versions_created: 12
outcome: "completed"
```

---

## 2. AUTO-SAVE FLOW (Every 3 Seconds)

### What Happens
1. Frontend detects content change
2. Wait 3 seconds (debounce)
3. Get HTML from iframe
4. Send to backend
5. Backend creates version immediately (no draft!)
6. Database + S3 updated

### Frontend Code
```javascript
let autoSaveTimer;
let lastSavedContent = '';

function setupAutoSave(iframeBody) {
  iframeBody.addEventListener('input', () => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(autoSaveVersion, 3000); // 3 second debounce
  });
}

async function autoSaveVersion() {
  const iframe = document.querySelector('#previewIframe');
  const htmlContent = iframe.contentDocument.body.innerHTML;

  // Skip if no changes
  if (htmlContent === lastSavedContent) return;

  // Show "Saving..." indicator
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
      const result = await response.json();
      lastSavedContent = htmlContent;
      showSaveStatus('saved'); // Show "All changes saved"
      console.log(`✅ Auto-saved as version ${result.version.version_number}`);
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

  // 1. Validate
  if (!htmlContent || !sessionId) {
    return res.status(400).json({
      success: false,
      error: 'htmlContent and sessionId required'
    });
  }

  // 2. Get task info
  const task = await dbService.getTaskById(taskId);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  // 3. Calculate metrics
  const characterCount = htmlContent.length;
  const wordCount = htmlContent.split(/\s+/).filter(w => w.length > 0).length;

  // 4. Get next version number
  const nextVersion = await dbService.getNextVersionNumber(taskId);

  // 5. Upload to S3
  const s3Key = `results/${userId}/${task.file_id}/v${nextVersion}.html`;
  await s3Service.uploadFile(
    Buffer.from(htmlContent, 'utf-8'),
    s3Key,
    'text/html',
    {
      'user-id': userId,
      'task-id': taskId,
      'version': nextVersion.toString(),
      'session-id': sessionId,
      'saved-at': new Date().toISOString()
    }
  );

  // 6. Create version in database
  const version = await dbService.createVersion({
    taskId,
    fileId: task.file_id,
    userId,
    s3Key,
    characterCount,
    wordCount,
    editReason: editReason || 'Auto-save',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    sessionId
  });

  // 7. Increment session counter
  await dbService.incrementSessionVersions(sessionId);

  // 8. Return success
  res.json({
    success: true,
    version: {
      id: version.id,
      version_number: version.version_number,
      created_at: version.created_at
    }
  });

  console.log(`💾 Auto-save: version ${nextVersion} created for session ${sessionId}`);
});
```

### What Gets Saved to Database
```sql
-- document_versions table (NEW ROW for each auto-save)
INSERT INTO document_versions (
  id,                     -- UUID
  task_id,               -- UUID (which document)
  file_id,               -- UUID (original file)
  version_number,        -- 1, 2, 3, 4... (increments)
  s3_key,                -- "results/user123/file456/v1.html"
  character_count,       -- e.g., 5432
  word_count,            -- e.g., 892
  edited_by,             -- UUID (who edited)
  edited_at,             -- "2025-10-21T10:05:23Z"
  edit_reason,           -- "Auto-save"
  ip_address,            -- "192.168.1.1"
  user_agent,            -- "Mozilla/5.0..."
  is_draft,              -- FALSE (no more drafts!)
  is_latest,             -- TRUE (only latest version has this)
  is_original,           -- FALSE (only version 0 is original)
  draft_session_id       -- "user123_task456_1698765432000"
) VALUES (...);

-- Also update previous version to not be latest
UPDATE document_versions
SET is_latest = FALSE
WHERE task_id = $1 AND is_latest = TRUE AND version_number < $2;
```

### What Gets Saved to S3
```
Bucket: untxt-results
Key: results/{userId}/{fileId}/v{versionNumber}.html
Content-Type: text/html
Body: <html>...edited content...</html>

Metadata:
  user-id: "3c8bf409-1992-4156-add2-3d5bb3df6ec1"
  task-id: "acc40a55-a71a-44fb-8b72-6110058534a7"
  version: "5"
  session-id: "user123_task456_1698765432000"
  saved-at: "2025-10-21T10:05:23Z"
```

### Session Counter Update
```sql
-- document_edit_sessions table (UPDATE existing row)
UPDATE document_edit_sessions
SET
  versions_created = versions_created + 1,
  last_activity_at = CURRENT_TIMESTAMP
WHERE session_id = 'user123_task456_1698765432000';
```

**Result:**
```sql
-- Session counter after 5 auto-saves
versions_created: 5
last_activity_at: "2025-10-21T10:05:23Z"
```

---

## 3. DOWNLOAD RESULT FLOW

### What Happens
1. User clicks "Download Result" button
2. Frontend gets current HTML from iframe
3. Send to backend
4. Backend converts HTML → PDF
5. Backend streams PDF to user
6. **THEN** backend saves HTML to S3 as a version
7. Session continues (download doesn't end session)

### Frontend Code
```javascript
async function downloadResult() {
  const iframe = document.querySelector('#previewIframe');
  const htmlContent = iframe.contentDocument.body.innerHTML;

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

    showDownloadStatus('success');

    // Show version number
    const versionNumber = response.headers.get('X-Version-Number');
    console.log(`✅ Downloaded! Auto-saved as version ${versionNumber}`);

  } catch (error) {
    console.error('Download failed:', error);
    showDownloadStatus('error');
    alert('Download failed. Please try again.');
  }
}
```

### Backend Route: POST /api/tasks/:taskId/download-result
```javascript
router.post('/:taskId/download-result', async (req, res) => {
  const { taskId } = req.params;
  const { htmlContent, sessionId, editReason } = req.body;
  const userId = req.headers['x-user-id'];

  // 1. Get task info
  const task = await dbService.getTaskById(taskId);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  // 2. Convert HTML to PDF
  const pdfBuffer = await pdfService.htmlToPdf(htmlContent, {
    format: 'A4',
    printBackground: true
  });

  // 3. Get next version number (for response header)
  const nextVersion = await dbService.getNextVersionNumber(taskId);

  // 4. Stream PDF to user IMMEDIATELY
  const baseFilename = task.filename.replace(/\.[^/.]+$/, '');
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': pdfBuffer.length,
    'Content-Disposition': `attachment; filename="${baseFilename}_result.pdf"`,
    'X-Task-Id': taskId,
    'X-Version-Number': nextVersion,
    'X-Download-Triggered-Save': 'true'
  });
  res.end(pdfBuffer, 'binary');

  // 5. AFTER user gets file, save HTML to S3 (async)
  const s3Key = `results/${userId}/${task.file_id}/v${nextVersion}.html`;
  await s3Service.uploadFile(
    Buffer.from(htmlContent, 'utf-8'),
    s3Key,
    'text/html'
  );

  // 6. Create version record
  const characterCount = htmlContent.length;
  const wordCount = htmlContent.split(/\s+/).filter(w => w.length > 0).length;

  const version = await dbService.createVersion({
    taskId,
    fileId: task.file_id,
    userId,
    s3Key,
    characterCount,
    wordCount,
    editReason: editReason || 'Downloaded by user',
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    sessionId
  });

  // 7. Increment session counter
  await dbService.incrementSessionVersions(sessionId);

  console.log(`📥 Download triggered version save: v${nextVersion}`);
});
```

### What Gets Tracked
**Database (document_versions):**
```sql
-- New version created (same as auto-save, but different edit_reason)
version_number: 6
edit_reason: "Downloaded by user"
s3_key: "results/user123/file456/v6.html"
character_count: 5678
word_count: 934
edited_at: "2025-10-21T10:10:00Z"
```

**Database (document_edit_sessions):**
```sql
-- Session counter incremented
versions_created: 6  (was 5, now 6)
last_activity_at: "2025-10-21T10:10:00Z"
```

**S3:**
```
Key: results/user123/file456/v6.html
Content: <html>...downloaded content...</html>
```

**User Gets:**
```
File: document_result.pdf
Size: ~1.2MB
Format: PDF (converted from HTML)
```

---

## 4. VERSION HISTORY (What's in Database)

### Example Session Timeline
```
Session starts at 10:00:00
├─ v1: Auto-save at 10:00:15 (3s after first edit)
├─ v2: Auto-save at 10:00:45 (user typed more)
├─ v3: Auto-save at 10:01:12 (user typed more)
├─ v4: Auto-save at 10:01:45 (user typed more)
├─ v5: Auto-save at 10:02:23 (user typed more)
├─ v6: Download at 10:10:00 (user clicked download)
├─ v7: Auto-save at 10:11:05 (user kept editing)
├─ v8: Auto-save at 10:11:38 (user typed more)
└─ Session ends at 10:15:00 (user closed tab)

Final state:
- 8 versions created
- 1 download
- Session duration: 15 minutes
- versions_created: 8
```

### Database Query: Get All Versions
```sql
SELECT
  version_number,
  edit_reason,
  edited_at,
  character_count,
  word_count,
  s3_key
FROM document_versions
WHERE task_id = 'acc40a55-a71a-44fb-8b72-6110058534a7'
ORDER BY version_number DESC;
```

**Result:**
```
version | edit_reason          | edited_at           | chars | words
--------|---------------------|---------------------|-------|-------
8       | Auto-save           | 2025-10-21 10:11:38 | 6234  | 1042
7       | Auto-save           | 2025-10-21 10:11:05 | 6123  | 1021
6       | Downloaded by user  | 2025-10-21 10:10:00 | 5678  | 934
5       | Auto-save           | 2025-10-21 10:02:23 | 5634  | 928
4       | Auto-save           | 2025-10-21 10:01:45 | 5456  | 912
3       | Auto-save           | 2025-10-21 10:01:12 | 5234  | 891
2       | Auto-save           | 2025-10-21 10:00:45 | 5123  | 876
1       | Auto-save           | 2025-10-21 10:00:15 | 5012  | 856
0       | Original OCR output | 2025-10-21 09:55:00 | 4892  | 834
```

---

## 5. S3 UPDATE POLICY

### When HTML is Uploaded to S3:

1. **Auto-save (every 3s)** → Upload to S3
   ```
   Key: results/{userId}/{fileId}/v{N}.html
   Reason: Durable backup of every version
   ```

2. **Download Result** → Upload to S3
   ```
   Key: results/{userId}/{fileId}/v{N}.html
   Reason: Archive downloaded content
   ```

3. **Version 0 (OCR complete)** → Already in S3
   ```
   Key: results/{userId}/{fileId}/v0.html
   Reason: Created by OCR worker
   ```

### S3 Structure
```
s3://untxt-results/
├── results/
│   ├── {userId}/
│   │   ├── {fileId}/
│   │   │   ├── v0.html          (original OCR output)
│   │   │   ├── v1.html          (first auto-save)
│   │   │   ├── v2.html          (second auto-save)
│   │   │   ├── v3.html          (third auto-save)
│   │   │   ├── v4.html          (fourth auto-save)
│   │   │   ├── v5.html          (fifth auto-save)
│   │   │   ├── v6.html          (download)
│   │   │   ├── v7.html          (auto-save after download)
│   │   │   └── v8.html          (latest auto-save)
```

### S3 Lifecycle (Optional - Cost Optimization)
```
Rule: Archive old versions after 90 days
- Versions < (latest - 10) → Move to S3 Glacier after 90 days
- Versions < (latest - 10) → Delete after 365 days

Keep forever:
- Version 0 (original OCR output)
- Latest 10 versions (recent work)
- Any version with edit_reason = "Downloaded by user"
```

---

## 6. SESSION END TRACKING

### What Constitutes Session End?

| Event | Session End? | Why |
|-------|-------------|-----|
| User closes tab/window | ✅ YES | `beforeunload` event |
| User navigates to dashboard | ✅ YES | Explicit navigation |
| User logs out | ✅ YES | User action |
| User switches tabs | ✅ YES (mobile) | `visibilitychange` event |
| User downloads result | ❌ NO | User might keep editing |
| User idle 5+ minutes | ✅ YES (optional) | Inactivity timeout |
| Browser crash | ❌ NO | Can't detect, session stays open |
| Network disconnect | ❌ NO | Can't communicate with backend |

### Frontend Event Listeners
```javascript
// Track all session end events
window.addEventListener('beforeunload', endEditSession);
window.addEventListener('pagehide', endEditSession);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    endEditSession();
  }
});

// Manual navigation
function goToDashboard() {
  endEditSession();
  window.location.href = '/dashboard';
}

function logout() {
  endEditSession();
  // Then logout...
}
```

### Backend Session End
```javascript
router.post('/sessions/:taskId/end', async (req, res) => {
  const { sessionId, outcome } = req.body;

  await dbService.closeEditSession({
    sessionId,
    outcome: outcome || 'completed'
  });

  res.json({ success: true });
});
```

### Database Update on Session End
```sql
UPDATE document_edit_sessions
SET
  ended_at = CURRENT_TIMESTAMP,
  outcome = $1  -- 'completed', 'abandoned', 'timeout'
WHERE session_id = $2;
```

---

## 7. COMPLETE DATABASE SCHEMA

### document_versions
```sql
CREATE TABLE document_versions (
  id UUID PRIMARY KEY,
  task_id UUID REFERENCES tasks(id),
  file_id UUID REFERENCES files(id),
  version_number INTEGER NOT NULL,
  s3_key TEXT NOT NULL,
  character_count INTEGER,
  word_count INTEGER,
  edited_by UUID REFERENCES users(id),
  edited_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  edit_reason TEXT,
  ip_address INET,
  user_agent TEXT,
  is_draft BOOLEAN DEFAULT FALSE,        -- DEPRECATED (always FALSE)
  is_latest BOOLEAN DEFAULT FALSE,
  is_original BOOLEAN DEFAULT FALSE,
  draft_session_id TEXT,                 -- Links to document_edit_sessions.session_id
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### document_edit_sessions
```sql
CREATE TABLE document_edit_sessions (
  id UUID PRIMARY KEY,
  task_id UUID REFERENCES tasks(id),
  user_id UUID REFERENCES users(id),
  username TEXT NOT NULL,
  session_id TEXT UNIQUE NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP WITH TIME ZONE,
  versions_created INTEGER DEFAULT 0,     -- Count of versions created
  outcome TEXT,                           -- 'completed', 'abandoned', 'timeout'
  ip_address INET,
  user_agent TEXT
);
```

---

## 8. HIPAA AUDIT TRAIL

### What We Track (Per Version)
```sql
-- Every version has full audit trail
SELECT
  version_number,           -- WHAT: Which version
  edited_by,                -- WHO: User UUID
  edited_at,                -- WHEN: Timestamp
  ip_address,               -- WHERE: IP address
  user_agent,               -- WHERE: Browser/device
  edit_reason,              -- WHY: "Auto-save" or "Downloaded by user"
  s3_key,                   -- WHAT: Full content location
  character_count,          -- WHAT: Size of change
  word_count                -- WHAT: Size of change
FROM document_versions
WHERE task_id = $1
ORDER BY version_number DESC;
```

### What We Track (Per Session)
```sql
-- Aggregated session metrics
SELECT
  session_id,               -- Session identifier
  user_id,                  -- WHO: User UUID
  username,                 -- WHO: Username
  started_at,               -- WHEN: Session start
  ended_at,                 -- WHEN: Session end
  versions_created,         -- WHAT: Number of edits
  outcome,                  -- HOW: How session ended
  ip_address,               -- WHERE: IP address
  user_agent                -- WHERE: Browser/device
FROM document_edit_sessions
WHERE task_id = $1
ORDER BY started_at DESC;
```

### HIPAA Compliance Checklist
- ✅ WHO accessed/modified: `edited_by`, `user_id`, `username`
- ✅ WHAT was accessed/modified: `s3_key`, `version_number`, `character_count`
- ✅ WHEN: `edited_at`, `started_at`, `ended_at`
- ✅ WHERE: `ip_address`, `user_agent`
- ✅ WHY: `edit_reason` ("Auto-save", "Downloaded by user")
- ✅ HOW: `outcome` (completed, abandoned, timeout)
- ✅ Immutable audit log: INSERT only, never UPDATE/DELETE versions

---

## 9. API ENDPOINTS SUMMARY

### New Endpoints (Google Docs Flow)
```
POST   /api/versions/:taskId/save              - Create version (auto-save)
POST   /api/tasks/:taskId/download-result      - Download PDF + save version
POST   /api/sessions/:taskId/start             - Start edit session
POST   /api/sessions/:taskId/end               - End edit session
GET    /api/versions/:taskId/latest            - Get latest version
```

### Removed Endpoints (Old Draft Flow)
```
❌ GET    /api/versions/:taskId/draft           - Get draft
❌ POST   /api/versions/:taskId/draft           - Save draft
❌ POST   /api/versions/:taskId/publish         - Publish draft
❌ DELETE /api/versions/:taskId/draft           - Cancel draft
```

### Kept Endpoints (Still Useful)
```
GET    /api/versions/:taskId                   - Get all versions
GET    /api/versions/:taskId/:versionNumber    - Get specific version
GET    /api/versions/:taskId/permissions       - Check edit permissions
GET    /api/versions/:taskId/logs              - Get edit logs
```

---

## 10. TESTING CHECKLIST

### Auto-Save Flow
- [ ] Upload document → version 0 created automatically
- [ ] Open document → content is immediately editable
- [ ] Type changes → auto-saves after 3s
- [ ] See "Saving..." → "All changes saved" indicator
- [ ] Check database → new version created with correct version_number
- [ ] Check S3 → HTML file uploaded to correct key
- [ ] Check session → versions_created incremented

### Download Flow
- [ ] Click "Download Result" → get PDF instantly
- [ ] PDF contains current edits (not stale version)
- [ ] Check database → new version created with reason "Downloaded by user"
- [ ] Check S3 → HTML saved to S3
- [ ] Check session → versions_created incremented
- [ ] Can continue editing after download (session doesn't end)

### Session Tracking
- [ ] Open document → session starts in database
- [ ] Close tab → session ends properly
- [ ] Navigate to dashboard → session ends
- [ ] Logout → session ends
- [ ] Check database → ended_at timestamp set
- [ ] Check database → outcome = "completed"
- [ ] Check database → versions_created matches actual count

### Version History
- [ ] Get all versions → returns correct list
- [ ] Each version has full audit trail (who/what/when/where/why)
- [ ] Version numbers increment correctly (0, 1, 2, 3...)
- [ ] is_latest flag only on latest version
- [ ] Can view any previous version

### Edge Cases
- [ ] Network disconnect during auto-save → retry works
- [ ] Browser crash → session stays open (expected - can't detect)
- [ ] Multiple tabs open same document → separate sessions
- [ ] Download multiple times → each creates a version
- [ ] No changes made → no versions created (just v0)

---

## Summary

**Auto-save:** Every 3s → Creates version → Saves to S3 + Database
**Download:** Get HTML → Convert to PDF → Stream to user → Save HTML to S3 + Database
**Session End:** Tab close, navigate away, logout, tab switch, idle timeout
**Database Tracking:** Every version has full audit trail (who/what/when/where/why)
**S3 Updates:** Every auto-save and download uploads HTML to S3
**No Drafts:** Every save is a version (Google Docs flow)
